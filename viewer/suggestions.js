/**
 * Suggestions made on GitHub and how far each has got. A suggestion is an issue from the pose correction or
 * move form (its title or form fields name the pose or move); the "Apply 3D edit" workflow turns it into a
 * pull request whose body says "Applied from #<issue>". Status:
 *   waiting   the issue is open and has no open pull request
 *   review    a pull request with the change is open
 *   merged    the pull request was merged, or the issue was closed as completed: the library has it
 *   closed    closed without the change
 *
 * Read from the GitHub API without a token, which allows 60 requests an hour per IP address, so the list is
 * kept in localStorage for a few minutes and an older copy is used when GitHub says no.
 */

import { REPO } from './submit.js'

const API = `${REPO.replace('https://github.com/', 'https://api.github.com/repos/')}/issues`
const KEY = 'open-yoga-poses:suggestions:v1'
const FRESH_MS = 5 * 60 * 1000
const MIN_GAP_MS = 30 * 1000
const MAX_PAGES = 5
const PENDING = new Set(['waiting', 'review'])

export const STATUS_LABELS = {
  waiting: 'Pending review',
  review: 'Pending: pull request open',
  merged: 'Integrated',
  closed: 'Closed, not integrated',
}

export const isPending = (s) => PENDING.has(s.status)

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const POSE_FORM = /^\s*Pose correction\b/i
const POSE_TITLE = /^\s*Pose correction:\s*([a-z0-9]+(?:-[a-z0-9]+)*)/i
const APP_TITLE = /^\s*App pose submission:\s*([a-z0-9]+(?:-[a-z0-9]+)*)/i
const MOVE_TITLE = /^\s*Move:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s+to\s+([a-z0-9]+(?:-[a-z0-9]+)*)/i
const APPLIED_FROM = /Applied from #(\d+)/
const APP_POSE_LINE = /^-\s*Pose:\s*`([a-z0-9]+(?:-[a-z0-9]+)*)`/m
const CREDIT_LINE = /^-\s*Credit:\s*(.+)$/m

/** A pose id answered under `### <label>` in an issue form body, or ''. */
function field(body, label) {
  const m = new RegExp(`^###\\s+${label}\\s*\\n+([^\\n]*)`, 'm').exec(body)
  const v = (m?.[1] || '').replace(/`/g, '').trim().toLowerCase()
  return ID.test(v) ? v : ''
}

function describe(issue) {
  const body = issue.body || ''
  const title = issue.title || ''
  const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l?.name) || '')
  const move = MOVE_TITLE.exec(title)
  const from = field(body, 'From pose id') || move?.[1]?.toLowerCase()
  const to = field(body, 'To pose id') || move?.[2]?.toLowerCase()
  if (from && to) return { kind: 'move', from, to }
  const appPose =
    APP_TITLE.exec(title)?.[1]?.toLowerCase() ||
    (labels.includes('app-submission') ? APP_POSE_LINE.exec(body)?.[1]?.toLowerCase() : '') ||
    ''
  if (appPose && ID.test(appPose)) {
    const credit = (CREDIT_LINE.exec(body)?.[1] || '').trim()
    return { kind: 'pose', pose: appPose, creditName: credit }
  }
  if (!POSE_FORM.test(title) && !/^###\s+What should change\?/m.test(body)) return null
  const pose = field(body, 'Pose id') || POSE_TITLE.exec(title)?.[1]?.toLowerCase()
  return pose ? { kind: 'pose', pose } : null
}

function statusOf(issue, pr) {
  if (pr?.merged) return 'merged'
  if (issue.state === 'closed') return issue.state_reason === 'completed' && !pr ? 'merged' : 'closed'
  return pr?.state === 'open' ? 'review' : 'waiting'
}

/** Suggestions from one listing of the repo's issues, which includes its pull requests. */
export function parseIssues(rows) {
  const prs = new Map()
  for (const r of rows) {
    if (!r.pull_request) continue
    const n = Number(APPLIED_FROM.exec(r.body || '')?.[1])
    if (!n) continue
    const pr = { number: r.number, url: r.html_url, state: r.state, merged: !!r.pull_request.merged_at }
    const had = prs.get(n)
    // A merged or open pull request says more than an older closed one.
    if (!had || pr.merged || (pr.state === 'open' && !had.merged)) prs.set(n, pr)
  }
  const out = []
  for (const r of rows) {
    if (r.pull_request) continue
    const what = describe(r)
    if (!what) continue
    const pr = prs.get(r.number) || null
    out.push({
      ...what,
      number: r.number,
      url: r.html_url,
      user: r.user?.login || '',
      creditName: what.creditName || '',
      createdAt: r.created_at,
      pr: pr && { number: pr.number, url: pr.url },
      status: statusOf(r, pr),
    })
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null')
    return c && Array.isArray(c.items) ? c : null
  } catch {
    return null
  }
}

function writeCache(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch {
    // Storage full or blocked: the list lasts until the page closes.
  }
}

let current = readCache()
let inFlight = null

/**
 * The last list fetched, possibly from an earlier visit, or null: { items, checkedAt, triedAt, error }.
 * `checkedAt` is the last successful check (0 if none); `error` is set when the latest try failed.
 */
export const cachedSuggestions = () => current

async function fetchAll() {
  const rows = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${API}?state=all&per_page=100&page=${page}`, { headers: { Accept: 'application/vnd.github+json' } })
    if (!res.ok) throw new Error(res.status === 403 || res.status === 429 ? 'GitHub is busy, try again later' : `GitHub said ${res.status}`)
    const batch = await res.json()
    rows.push(...batch)
    if (batch.length < 100) break
  }
  return parseIssues(rows)
}

/**
 * Loads the list, from the cache when it's recent. `force` checks GitHub again unless it was asked moments
 * ago. Never throws: a failure keeps the previous items and sets `error`.
 */
export function loadSuggestions({ force = false } = {}) {
  const age = current ? Date.now() - (current.triedAt || current.checkedAt) : Infinity
  if (current && age < (force || current.error ? MIN_GAP_MS : FRESH_MS)) return Promise.resolve(current)
  inFlight ??= fetchAll()
    .then((items) => (current = { items, checkedAt: Date.now(), triedAt: Date.now(), error: '' }))
    .catch(
      (e) =>
        (current = {
          items: current?.items || [],
          checkedAt: current?.checkedAt || 0,
          triedAt: Date.now(),
          error: e.message || String(e),
        }),
    )
    .then((c) => {
      if (!c.error) writeCache(c)
      inFlight = null
      return c
    })
  return inFlight
}

export const forPose = (items, id) => items.filter((s) => s.kind === 'pose' && s.pose === id)

/** Suggestions for a move, in either direction (the viewer edits a reversed move in place). */
export const forMove = (items, from, to) =>
  items.filter((s) => s.kind === 'move' && ((s.from === from && s.to === to) || (s.from === to && s.to === from)))

/** Pose ids with a suggestion still pending, including either end of a pending move. */
export function pendingPoseIds(items) {
  const ids = new Set()
  for (const s of items) {
    if (!isPending(s)) continue
    if (s.kind === 'pose') ids.add(s.pose)
    else ids.add(s.from).add(s.to)
  }
  return ids
}

/**
 * The issue most likely made from this browser's Suggest press at `submittedAt`: the first one for the same
 * pose or move opened after it (the person may take a while to write the description).
 */
export function findOwn(matches, submittedAt) {
  if (!submittedAt) return null
  const after = new Date(new Date(submittedAt).getTime() - 60 * 1000).toISOString()
  return [...matches].filter((s) => s.createdAt >= after).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] || null
}
