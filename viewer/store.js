/**
 * Edits kept in this browser (localStorage), so nothing is lost between visits:
 *   poses: { [poseId]: { bones, root, updatedAt, submittedAt? } }      edited shape of a library pose
 *   moves: { ["from>to"]: { transition, updatedAt, submittedAt? } }    edited keyframed move
 *   meta:  { [poseId]: { fields, isNew?, basePoseId?, creditName?, updatedAt } }  teaching fields
 * `submittedAt` is when Suggest last opened GitHub / called github-submit with the edit.
 */

const KEY = 'open-yoga-poses:edits:v1'

function read() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { poses: data.poses || {}, moves: data.moves || {}, meta: data.meta || {} }
  } catch {
    return { poses: {}, moves: {}, meta: {} }
  }
}

let data = read()
const listeners = new Set()

function write() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
  } catch {
    // Storage full or blocked (private browsing): edits last until the page closes.
  }
  for (const fn of listeners) fn()
}

window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return
  data = read()
  for (const fn of listeners) fn()
})

export const onEditsChange = (fn) => listeners.add(fn)

export const editedPose = (id) => data.poses[id] || null
export const editedPoseIds = () => Object.keys(data.poses)
const submitted = (entry) => (entry?.submittedAt ? { submittedAt: entry.submittedAt } : {})

export function savePose(id, shape) {
  data.poses[id] = { bones: shape.bones, root: shape.root, updatedAt: new Date().toISOString(), ...submitted(data.poses[id]) }
  write()
}
export function discardPose(id) {
  delete data.poses[id]
  delete data.meta[id]
  write()
}

export const editedMove = (key) => data.moves[key] || null
export const editedMoveKeys = () => Object.keys(data.moves)
export function saveMove(key, transition) {
  data.moves[key] = { transition, updatedAt: new Date().toISOString(), ...submitted(data.moves[key]) }
  write()
}
export function discardMove(key) {
  delete data.moves[key]
  write()
}

/** Records that Suggest opened GitHub with this pose's or move's edit just now. */
export function markSubmitted(kind, key) {
  const entry = (kind === 'move' ? data.moves : data.poses)[key]
  if (!entry) return
  entry.submittedAt = new Date().toISOString()
  write()
}

export const poseMeta = (id) => data.meta[id] || null
export const metaPoseIds = () => Object.keys(data.meta)
export const newPoseIds = () => Object.keys(data.meta).filter((id) => data.meta[id]?.isNew)

export function saveMeta(id, meta) {
  data.meta[id] = {
    ...(data.meta[id] || {}),
    ...meta,
    fields: { ...(data.meta[id]?.fields || {}), ...(meta.fields || {}) },
    updatedAt: new Date().toISOString(),
  }
  write()
}

export function discardMeta(id) {
  delete data.meta[id]
  write()
}

export const countEdits = () => Object.keys(data.poses).length + Object.keys(data.moves).length

/** Empty teaching-field bag used by the metadata dialog. */
export function emptyFields(seed = {}) {
  return {
    name: '',
    sanskrit: '',
    chineseName: '',
    altNames: [],
    category: 'standing',
    tags: [],
    discipline: 'yoga',
    intensity: 2,
    description: '',
    goodFor: '',
    muscles: [],
    breathCue: '',
    transitionIn: '',
    breathPattern: '',
    props: [],
    modifications: [],
    deepen: [],
    avoidIf: [],
    commonMistakes: [],
    alignmentCues: [],
    defaultHoldSec: 30,
    minHoldSec: undefined,
    drishti: '',
    basePoseId: '',
    ...seed,
  }
}
