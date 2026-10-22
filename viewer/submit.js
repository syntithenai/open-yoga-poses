/**
 * Turns an edit into a GitHub issue that carries the 3D data, so tools/apply_edit.py (run by the
 * "Apply 3D edit" workflow when a maintainer labels the issue `apply-edit`) can apply it.
 *
 * The data is an `open-yoga-edit/1` JSON envelope (see docs/FORMAT.md). It goes into the issue form's
 * 3D data field as plain JSON when the link stays short, or deflate-compressed as one `OYE1.<base64url>`
 * line when that's shorter. If even that is too long for a link, it's copied to the clipboard for the
 * person to paste.
 */

export const REPO = 'https://github.com/syntithenai/open-yoga-poses'
export const EDIT_FORMAT = 'open-yoga-edit/1'
const MAX_URL = 7500
const PASTE_HINT = 'The 3D data is on your clipboard. Select this line and paste over it.'

const SAME = 1e-4
const sameQuat = (a, b) => !!a && !!b && Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]) > 1 - SAME

function sameProps(a, b) {
  try {
    return JSON.stringify(a || []) === JSON.stringify(b || [])
  } catch {
    return false
  }
}

/** Only the bones / root / props that differ from the published pose. */
export function poseEnvelope(id, published, edited) {
  const bones = {}
  for (const [n, q] of Object.entries(edited.bones)) {
    if (!sameQuat(q, published.bones?.[n])) bones[n] = q
  }
  const env = { format: EDIT_FORMAT, kind: 'pose', pose: id, bones }
  const head = edited.root?.head
  const was = published.root?.head
  if (head && (!was || head.some((v, i) => Math.abs(v - was[i]) > 1e-4))) env.root = { head }
  if (Array.isArray(edited.props) && !sameProps(edited.props, published.props)) env.props = edited.props
  return env
}

export function moveEnvelope(from, to, transition) {
  return { format: EDIT_FORMAT, kind: 'move', from, to, transition }
}

/**
 * Full app-pose envelope (3D + teaching fields + credit) for signed-in submits.
 * `sourcePoseId` empty means a new pose.
 */
export function appPoseEnvelope({ pose, sourcePoseId = '', copyId = '', creditName = '', bones, root, props, fields = {}, animations }) {
  const env = {
    format: EDIT_FORMAT,
    kind: 'app-pose',
    pose,
    sourcePoseId: sourcePoseId || '',
    copyId: copyId || '',
    creditName: String(creditName || '').trim(),
    bones: bones || {},
    fields: fields || {},
  }
  if (root?.head) env.root = { head: root.head }
  if (Array.isArray(props)) env.props = props
  if (Array.isArray(animations) && animations.length) env.animations = animations
  return env
}

/**
 * Signed-in submit via synth-resolver → GitHub issue (no admin queue).
 * Returns { number, url, state }.
 */
export async function githubSubmit({ apiBase, accessToken, licenceAccepted, envelope, authorEmail, authorName }) {
  const base = String(apiBase || '').replace(/\/+$/, '')
  if (!base) throw new Error('API base is not configured')
  if (!licenceAccepted) throw new Error('CC BY-SA 4.0 agreement is required')
  if (!envelope?.bones || !Object.keys(envelope.bones).length) {
    throw new Error('A 3D body shape is required before submitting')
  }
  const snapshot = {
    ...(envelope.fields || {}),
    name: envelope.fields?.name || envelope.pose,
    pose3d: {
      format: 'yoga-pose/1',
      pose: envelope.pose,
      bones: envelope.bones,
      ...(envelope.root ? { root: envelope.root } : {}),
      ...(Array.isArray(envelope.props) ? { props: envelope.props } : {}),
    },
    ...(envelope.animations ? { animations: envelope.animations } : {}),
  }
  const record = {
    kind: envelope.sourcePoseId ? 'poseEdit' : 'poseNew',
    copyId: envelope.copyId || `tp-viewer-${envelope.pose}`,
    sourcePoseId: envelope.sourcePoseId || '',
    authorEmail: authorEmail || '',
    authorName: authorName || envelope.creditName || '',
    updatedAt: new Date().toISOString(),
    changes: [],
    snapshot,
  }
  const res = await fetch(`${base}/yoga/pose-edits/github-submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      licenceAccepted: true,
      creditName: envelope.creditName || authorName || '',
      record,
    }),
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).detail || ''
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Submit failed (${res.status})`)
  }
  return res.json()
}

async function deflate(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function encodings(env) {
  const json = JSON.stringify(env)
  const out = [json]
  if (typeof CompressionStream === 'function') out.push(`OYE1.${await deflate(json)}`)
  return out.sort((a, b) => a.length - b.length)
}

const issueUrl = (params) => `${REPO}/issues/new?${new URLSearchParams(params)}`

/**
 * Opens a prefilled issue with the edit's 3D data. `params` holds the form template and other fields.
 * Returns 'linked' or 'clipboard' (data too long for a link; the person pastes it).
 */
export async function openIssueWithData(params, env) {
  const options = await encodings(env)
  for (const data of options) {
    const url = issueUrl({ ...params, 'edit-data': data })
    if (url.length <= MAX_URL) {
      window.open(url, '_blank', 'noopener')
      return 'linked'
    }
  }
  await navigator.clipboard.writeText(options[0])
  window.open(issueUrl({ ...params, 'edit-data': PASTE_HINT }), '_blank', 'noopener')
  return 'clipboard'
}

export function download(name, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 1)}\n`], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
