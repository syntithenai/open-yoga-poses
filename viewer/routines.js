/**
 * Routines page: pick a library routine, edit a draft in the browser, download open-yoga-routine/1
 * JSON for SynthYoga, or submit it to the open library (GitHub issue → apply-edit → routines/).
 */
import { accessToken, bindAuthBar, creditName, getUser, onAuthChange } from './auth.js'
import { download, openIssueWithData, REPO } from './submit.js'

const DRAFTS_KEY = 'open-yoga-poses:routines:v1'
const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const clone = (v) => JSON.parse(JSON.stringify(v))

const slug = (value) =>
  String(value || 'routine')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'routine'

async function json(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

function readDrafts() {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeDrafts(map) {
  try {
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(map))
  } catch {
    /* private browsing */
  }
}

/** @type {{ catalog: object[], byId: Map<string, object>, library: object[], drafts: Record<string, object>, current: object | null, source: 'library'|'draft'|null }} */
const state = {
  catalog: [],
  byId: new Map(),
  library: [],
  drafts: readDrafts(),
  current: null,
  source: null,
}

function message(text) {
  const el = $('routines-message')
  el.hidden = !text
  el.textContent = text || ''
}

function emptyRoutine() {
  const user = getUser()
  return {
    format: 'open-yoga-routine/1',
    id: `routine-${Date.now().toString(36)}`,
    title: 'My routine',
    description: '',
    author: {
      name: creditName() || user?.name || '',
      ...(user?.email ? { email: user.email } : {}),
    },
    level: 1,
    language: 'en',
    tags: [],
    steps: [],
  }
}

function normalizeDoc(raw) {
  if (!raw || raw.format !== 'open-yoga-routine/1') throw new Error('Not an open-yoga-routine/1 file')
  const steps = (raw.steps || []).map((s) => ({
    ...(s.section ? { section: String(s.section) } : {}),
    ...(s.pose ? { pose: String(s.pose) } : {}),
    holdSec: Math.min(600, Math.max(1, Number(s.holdSec) || 30)),
    ...(s.side === 'right' || s.side === 'left' ? { side: s.side } : {}),
    ...(s.cue ? { cue: String(s.cue) } : {}),
  }))
  const author = { ...(raw.author || {}) }
  if (author.email) author.email = String(author.email).trim().toLowerCase()
  return {
    format: 'open-yoga-routine/1',
    id: slug(raw.id || raw.title),
    title: String(raw.title || raw.id || 'Routine'),
    description: String(raw.description || ''),
    author,
    level: Math.min(5, Math.max(1, Number(raw.level) || 1)),
    language: String(raw.language || 'en'),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    steps,
  }
}

function saveCurrent() {
  if (!state.current) return
  readFormIntoCurrent()
  state.current.id = slug(state.current.title || state.current.id)
  const user = getUser()
  if (user?.email) state.current.author = { ...state.current.author, email: user.email }
  if (!state.current.author?.name && creditName()) {
    state.current.author = { ...state.current.author, name: creditName() }
  }
  state.drafts[state.current.id] = {
    ...clone(state.current),
    updatedAt: new Date().toISOString(),
  }
  writeDrafts(state.drafts)
  state.source = 'draft'
  renderLists()
}

function readFormIntoCurrent() {
  const doc = state.current
  if (!doc) return
  doc.title = $('r-title').value.trim() || doc.title
  doc.description = $('r-desc').value.trim()
  doc.level = Number($('r-level').value) || 1
  doc.author = { ...doc.author, name: $('r-author').value.trim() }
  const user = getUser()
  if (user?.email) doc.author.email = user.email
}

function openDoc(doc, source) {
  state.current = clone(doc)
  state.source = source
  $('editor').hidden = false
  $('editor-empty').hidden = true
  $('r-title').value = doc.title || ''
  $('r-desc').value = doc.description || ''
  $('r-level').value = String(doc.level || 1)
  $('r-author').value = doc.author?.name || creditName() || ''
  const user = getUser()
  $('r-email-hint').textContent = user?.email
    ? `Submissions are credited to ${user.email}. In SynthYoga, sign in with that email to claim this routine.`
    : 'Sign in so your email is stored with the routine and you can claim it in SynthYoga later.'
  renderSteps()
  renderLists()
  message('')
}

function renderLists() {
  const lib = $('library-list')
  lib.innerHTML = state.library
    .map((r) => {
      const active = state.source === 'library' && state.current?.id === r.id
      return `<li><button type="button" class="routine-pick${active ? ' selected' : ''}" data-lib="${esc(r.id)}"><strong>${esc(r.title)}</strong><span>${r.steps} steps${r.author?.name ? ` · ${esc(r.author.name)}` : ''}</span></button></li>`
    })
    .join('')

  const ids = Object.keys(state.drafts).sort((a, b) => (state.drafts[b].updatedAt || '').localeCompare(state.drafts[a].updatedAt || ''))
  $('draft-list').innerHTML = ids
    .map((id) => {
      const r = state.drafts[id]
      const active = state.source === 'draft' && state.current?.id === id
      return `<li><button type="button" class="routine-pick${active ? ' selected' : ''}" data-draft="${esc(id)}"><strong>${esc(r.title || id)}</strong><span>${(r.steps || []).length} steps</span></button></li>`
    })
    .join('')
  $('draft-empty').hidden = ids.length > 0
}

function poseLabel(id) {
  const p = state.byId.get(id)
  return p ? `${p.name} (${id})` : id
}

function renderSteps() {
  const steps = state.current?.steps || []
  $('step-empty').hidden = steps.length > 0
  $('step-list').innerHTML = steps
    .map((s, i) => {
      const name = s.pose ? poseLabel(s.pose) : '(cue only)'
      return `<li class="step-row" data-i="${i}">
        <div class="step-main">
          <label class="field tight">Section <input data-f="section" value="${esc(s.section || '')}" placeholder="optional" /></label>
          <p class="step-pose"><strong>${esc(name)}</strong></p>
          <label class="field tight">Hold (s) <input data-f="holdSec" type="number" min="1" max="600" value="${s.holdSec}" /></label>
          <label class="field tight">Side
            <select data-f="side">
              <option value="" ${!s.side ? 'selected' : ''}>Both / n/a</option>
              <option value="right" ${s.side === 'right' ? 'selected' : ''}>Right</option>
              <option value="left" ${s.side === 'left' ? 'selected' : ''}>Left</option>
            </select>
          </label>
          <label class="field tight">Cue <input data-f="cue" value="${esc(s.cue || '')}" /></label>
        </div>
        <div class="step-ops">
          <button type="button" data-op="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
          <button type="button" data-op="down" ${i === steps.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button>
          <button type="button" data-op="remove" aria-label="Remove">✕</button>
        </div>
      </li>`
    })
    .join('')
}

function resolvePoseQuery(q) {
  const raw = q.trim()
  if (!raw) return null
  const m = /\(([a-z0-9-]+)\)\s*$/i.exec(raw)
  if (m && state.byId.has(m[1])) return m[1]
  if (state.byId.has(raw)) return raw
  const folded = fold(raw)
  return state.catalog.find((p) => fold(p.name) === folded || fold(p.sanskrit) === folded)?.id || null
}

async function loadLibraryRoutine(id) {
  const meta = state.library.find((r) => r.id === id)
  if (!meta) return
  message('Loading…')
  const doc = normalizeDoc(await json(`routines/${meta.file || `${id}.json`}`))
  openDoc(doc, 'library')
}

function addPose() {
  if (!state.current) return
  const id = resolvePoseQuery($('pose-q').value)
  if (!id) {
    message('Pick a pose from the list (or type its id).')
    return
  }
  readFormIntoCurrent()
  state.current.steps.push({ pose: id, holdSec: 30 })
  $('pose-q').value = ''
  saveCurrent()
  renderSteps()
  message(`Added ${poseLabel(id)}.`)
}

async function submitRoutine() {
  if (!state.current) return
  saveCurrent()
  const doc = normalizeDoc(state.current)
  if (!doc.steps.length) {
    message('Add at least one step before submitting.')
    return
  }
  if (!doc.author?.name) {
    message('Add a credit name before submitting.')
    return
  }
  const user = getUser()
  if (!user) {
    message('Sign in with Google so the routine can be claimed in SynthYoga with your email.')
    return
  }
  doc.author.email = user.email
  const env = { format: 'open-yoga-edit/1', kind: 'routine', routine: doc }
  message('Opening GitHub…')
  try {
    // Prefer signed-in path when API is available; fall back to prefilled issue.
    await accessToken().catch(() => null)
    const how = await openIssueWithData(
      {
        template: 'new-routine.yml',
        title: `Routine: ${doc.title}`,
        'routine-title': doc.title,
        author: `${doc.author.name}${doc.author.email ? ` <${doc.author.email}>` : ''}`,
        level: String(doc.level),
        steps: doc.steps
          .map((s) => [s.section && `[${s.section}]`, s.pose || '', `${s.holdSec}s`, s.side, s.cue].filter(Boolean).join(', '))
          .join('\n'),
      },
      env,
    )
    message(
      how === 'clipboard'
        ? `GitHub issue opened — paste the routine data from your clipboard into the form. Or download the JSON and open a pull request at ${REPO}.`
        : 'GitHub issue opened with your routine. A maintainer can apply it with the apply-edit label.',
    )
  } catch (e) {
    message(e instanceof Error ? e.message : 'Could not open GitHub')
  }
}

function bindEditor() {
  for (const id of ['r-title', 'r-desc', 'r-level', 'r-author']) {
    $(id).addEventListener('change', () => {
      saveCurrent()
    })
  }
  $('add-pose').addEventListener('click', addPose)
  $('pose-q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addPose()
    }
  })
  $('download-routine').addEventListener('click', () => {
    saveCurrent()
    const doc = normalizeDoc(state.current)
    download(`${doc.id}.json`, doc)
    message(`Downloaded ${doc.id}.json — in SynthYoga open Routines → Import file.`)
  })
  $('submit-routine').addEventListener('click', () => void submitRoutine())
  $('discard-draft').addEventListener('click', () => {
    if (!state.current) return
    const id = state.current.id
    delete state.drafts[id]
    writeDrafts(state.drafts)
    state.current = null
    state.source = null
    $('editor').hidden = true
    $('editor-empty').hidden = false
    renderLists()
    message('Draft discarded.')
  })
  $('step-list').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-op]')
    if (!btn || !state.current) return
    const li = btn.closest('[data-i]')
    const i = Number(li?.dataset.i)
    if (Number.isNaN(i)) return
    readFormIntoCurrent()
    const steps = state.current.steps
    if (btn.dataset.op === 'remove') steps.splice(i, 1)
    else if (btn.dataset.op === 'up' && i > 0) [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]
    else if (btn.dataset.op === 'down' && i < steps.length - 1) [steps[i + 1], steps[i]] = [steps[i], steps[i + 1]]
    saveCurrent()
    renderSteps()
  })
  $('step-list').addEventListener('change', (e) => {
    const input = e.target.closest('[data-f]')
    if (!input || !state.current) return
    const li = input.closest('[data-i]')
    const i = Number(li?.dataset.i)
    const step = state.current.steps[i]
    if (!step) return
    const f = input.dataset.f
    if (f === 'holdSec') step.holdSec = Math.min(600, Math.max(1, Number(input.value) || 30))
    else if (f === 'side') {
      if (input.value === 'right' || input.value === 'left') step.side = input.value
      else delete step.side
    } else if (f === 'section') {
      if (input.value.trim()) step.section = input.value.trim()
      else delete step.section
    } else if (f === 'cue') {
      if (input.value.trim()) step.cue = input.value.trim()
      else delete step.cue
    }
    saveCurrent()
  })
}

async function start() {
  bindAuthBar($('auth'), () => {
    if (state.current) openDoc(state.current, state.source || 'draft')
  })
  onAuthChange(() => {
    if (state.current) openDoc(state.current, state.source || 'draft')
  })

  const [catalog, library] = await Promise.all([json('catalog.json'), json('routines/index.json').catch(() => [])])
  state.catalog = catalog
  for (const p of catalog) state.byId.set(p.id, p)
  state.library = library
  $('pose-options').innerHTML = catalog.map((p) => `<option value="${esc(p.name)} (${p.id})"></option>`).join('')

  renderLists()
  bindEditor()

  $('new-routine').addEventListener('click', () => {
    openDoc(emptyRoutine(), 'draft')
    saveCurrent()
    message('New routine — add steps, then download or submit.')
  })
  $('import-file').addEventListener('change', (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    void f.text().then((text) => {
      try {
        const doc = normalizeDoc(JSON.parse(text))
        openDoc(doc, 'draft')
        saveCurrent()
        message(`Imported “${doc.title}”.`)
      } catch (err) {
        message(err instanceof Error ? err.message : 'Could not read that file')
      }
    })
  })
  $('library-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lib]')
    if (b) void loadLibraryRoutine(b.dataset.lib)
  })
  $('draft-list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-draft]')
    if (!b) return
    const doc = state.drafts[b.dataset.draft]
    if (doc) openDoc(normalizeDoc(doc), 'draft')
  })
}

start().catch((e) => message(`Couldn't start (${e.message}).`))
