import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { accessToken, bindAuthBar, creditName, getUser } from './auth.js'
import { config } from './config.js'
import { createEditor, JOINTS } from './editor.js'
import { applyHandShape, captureBothHandsLocal, handShapeOptionsHtml } from './hands.js'
import { detailsFieldsHtml, openMetaDialog, openSubmitCreditDialog, readDetailsForm, slugify } from './meta.js'
import { limbFrom } from './limbs.js'
import { mirrorPoseDoc } from './mirror.js'
import { fixHips, levelHips, straightenLimb, straightenSpine, symmetrizePose } from './poseEdit.js'
import {
  applyPose,
  bodyBounds,
  capturePose,
  disposeBody,
  loadBody,
  setBodyLook,
  skeletonFromBody,
} from './pose.js'
import { loadPrefs, openSettingsDialog, savePrefs } from './settings.js'
import * as store from './store.js'
import { appPoseEnvelope, download, githubSubmit, moveEnvelope, openIssueWithData, poseEnvelope, REPO } from './submit.js'
import { cachedSuggestions, findOwn, forMove, forPose, loadSuggestions, pendingPoseIds, STATUS_LABELS } from './suggestions.js'
import { DEFAULT_EASE, EASE_LABELS, keyRestAxes, MAX_KEYS, sampleTransition } from './transition.js'
import { BLOCK_STANDS, PROP_LABEL, blockStandOf } from './props.js'

const CATEGORY_LABELS = {
  standing: 'Standing',
  floor: 'Floor',
  'arm-balance': 'Arm balance',
  inversion: 'Inversion',
  chair: 'Chair',
  breath: 'Breath',
  transition: 'Transition',
}
const EDITED = '__edited'
const WITH_MOVES = '__moves'
const PENDING = '__pending'
const NEW_MOVE = { durationSec: 2.5, keys: [], endEase: DEFAULT_EASE }
const SUGGESTIONS_SHOWN = 5

const $ = (id) => document.getElementById(id)
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clone = (v) => JSON.parse(JSON.stringify(v))

const state = {
  catalog: [],
  byId: new Map(),
  characters: [],
  styles: [],
  moves: {},
  category: '',
  selected: '',
  character: '',
  style: 'classic',
  /** 'standard' | 'high' — high loads the MPFB body with a detailed face when published. */
  bodyDetail: 'standard',
  editing: false,
  /** When true, the details form replaces the 3D view. */
  detailsOpen: false,
  /** Hand-shape dropdowns (UI only; bones are baked into the pose JSON). */
  handShape: { L: '', R: '' },
  /** Local finger/metacarpal quats when the current pose was last applied (“as fitted”). */
  handFitted: {},
  /** Open move: { key, from, to }. While set, the stage shows the move at time `u`. */
  move: null,
  u: 0,
  playing: null,
  keyIndex: -1,
  message: '',
  /** Suggestions on GitHub (suggestions.js), or null before the first check. */
  suggestions: cachedSuggestions(),
  checking: false,
}
const poseCache = new Map()
const loaded = new Map()
const undo = new Map()

async function json(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

// --- Pose data ------------------------------------------------------------

function published(id) {
  if (!poseCache.has(id)) {
    const meta = store.poseMeta(id)
    if (meta?.isNew || state.byId.get(id)?._draft) {
      const edit = store.editedPose(id)
      const doc = {
        format: 'yoga-pose/1',
        pose: id,
        bones: edit?.bones || { root: [1, 0, 0, 0] },
        root: edit?.root || { head: [0, 0, 0] },
      }
      loaded.set(id, doc)
      poseCache.set(id, Promise.resolve(doc))
    } else {
      poseCache.set(
        id,
        json(`poses/${id}.json`).then((doc) => {
          loaded.set(id, doc)
          return doc
        }),
      )
    }
  }
  return poseCache.get(id)
}

/** Snapshot of a local pose edit for the undo stack. */
function editSnap(edit) {
  if (!edit) return null
  return {
    bones: edit.bones,
    root: edit.root,
    ...(Array.isArray(edit.props) ? { props: clone(edit.props) } : {}),
  }
}

/** Whether the published pose already has this browser's edit (false until the pose has loaded). */
function poseInLibrary(id, edit) {
  const doc = loaded.get(id)
  if (!doc) return false
  const env = poseEnvelope(id, doc, edit)
  return !Object.keys(env.bones).length && !env.root && !env.props
}

/** Deep equality with a little slack on numbers, for comparing a move with the published one. */
function sameValue(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 1e-3
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => sameValue(a[k], b[k]))
  }
  return a === b
}

const moveInLibrary = (key, edit) => !!state.moves[key] && sameValue(edit.transition, state.moves[key])

/** The published pose with this browser's edit on top. */
async function effective(id) {
  const doc = await published(id)
  const edit = store.editedPose(id)
  if (!edit) return doc
  return {
    ...doc,
    bones: edit.bones,
    root: edit.root,
    ...(Array.isArray(edit.props) ? { props: edit.props } : {}),
  }
}

const moveKey = (from, to) => `${from}>${to}`
const currentMove = () => (state.move ? (store.editedMove(state.move.key)?.transition ?? state.moves[state.move.key] ?? NEW_MOVE) : null)
const poseName = (id) => state.byId.get(id)?.name || id

// --- 3D stage -------------------------------------------------------------

const view = $('view')
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
view.prepend(renderer.domElement)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

scene.add(new THREE.HemisphereLight(0xfff4e6, 0x8a7663, 1.6))
const sun = new THREE.DirectionalLight(0xffffff, 2.2)
sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 12 })
scene.add(sun, sun.target)

let body = null

const editor = createEditor({
  scene,
  camera,
  renderer,
  controls,
  onStart: () => stopPlaying(),
  onEnd: () => void editEnded(),
  onSelect: (joint) => {
    if ($('joint')) $('joint').value = joint || ''
    syncToolsMenu()
  },
  onPropSelect: () => {
    if ($('joint')) $('joint').value = ''
    renderInfo()
  },
})

function syncToolsMenu() {
  const tools = $('pose-tools')
  if (!tools) return
  const wrap = tools.parentElement
  if (!wrap) return
  const html = toolsMenuHtml()
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  tools.replaceWith(tmp.firstElementChild)
}

function resize() {
  const { clientWidth: w, clientHeight: h } = view
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
}
new ResizeObserver(resize).observe(view)

function frameBody() {
  if (!body) return
  const box = bodyBounds(body)
  const center = box.getCenter(new THREE.Vector3())
  const size = box.getSize(new THREE.Vector3())
  const front = new THREE.Vector3(0, -1, 0).transformDirection(body.frame.matrixWorld)
  const up = new THREE.Vector3(0, 0, 1).transformDirection(body.frame.matrixWorld)
  const span = Math.max(size.x, size.y, size.z)
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect)
  const dist = (span / (2 * tanHalf)) * 1.2
  // Look down on lying poses so they aren't seen edge-on.
  const flatness = 1 - Math.min(1, Math.abs(size.dot(up)) / span)
  camera.up.copy(up)
  camera.position.copy(center).addScaledVector(front, dist).addScaledVector(up, dist * (0.08 + 0.5 * flatness))
  controls.target.copy(center)
  controls.update()
  sun.position.copy(center).addScaledVector(up, 4).addScaledVector(front, 1.5).add(new THREE.Vector3(1, 0, 0))
  sun.target.position.copy(center)
}

function currentCharacter() {
  return state.characters.find((x) => x.id === state.character) || state.characters[0]
}

function currentStyle() {
  return state.styles.find((x) => x.id === state.style) || state.styles[0]
}

function syncLookSummary() {
  const el = $('look-summary')
  if (!el) return
  const c = currentCharacter()
  const s = currentStyle()
  const detail = state.bodyDetail === 'high' && c?.hdFile ? ' · High detail' : ''
  el.textContent = c && s ? `${c.label} · ${s.label}${detail}` : ''
}

function applyCurrentLook() {
  if (!body) return
  const c = currentCharacter()
  setBodyLook(body, currentStyle(), c?.palette)
  syncLookSummary()
}

function persistLook() {
  savePrefs({ character: state.character, style: state.style, bodyDetail: state.bodyDetail })
}

function bodyUrlFor(c) {
  if (state.bodyDetail === 'high' && c?.hdFile) return `characters/${c.hdFile}`
  return `characters/${c.file}`
}

async function setCharacter(id) {
  const c = state.characters.find((x) => x.id === id) || state.characters[0]
  state.character = c.id
  if (state.bodyDetail === 'high' && !c.hdFile) state.bodyDetail = 'standard'
  status(state.bodyDetail === 'high' ? 'Loading high-detail body…' : 'Loading body…')
  const next = await loadBody(bodyUrlFor(c), { renderer })
  if (body) {
    scene.remove(body.root)
    disposeBody(body)
  }
  body = next
  scene.add(body.root)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.MeshStandardMaterial({ color: 0xead7bd, roughness: 1 }))
  floor.receiveShadow = true
  floor.position.z = -0.001
  body.frame.add(floor)
  editor.setBody(body)
  applyCurrentLook()
  persistLook()
  await refreshStage({ frame: true })
}

function setStyle(id) {
  const s = state.styles.find((x) => x.id === id) || state.styles[0]
  state.style = s.id
  applyCurrentLook()
  persistLook()
}

async function openSettings() {
  const picked = await openSettingsDialog({
    characters: state.characters,
    styles: state.styles,
    character: state.character,
    style: state.style,
    bodyDetail: state.bodyDetail,
  })
  if (!picked) return
  const characterChanged = picked.character !== state.character
  const detailChanged = picked.bodyDetail !== state.bodyDetail
  state.style = picked.style
  state.bodyDetail = picked.bodyDetail === 'high' ? 'high' : 'standard'
  persistLook()
  if (characterChanged || detailChanged) await setCharacter(picked.character)
  else {
    setStyle(picked.style)
    renderInfo()
  }
}

/** Puts the selected pose, or the open move at time u, on the body. */
async function refreshStage({ frame = false } = {}) {
  if (!body || !state.selected) return status('')
  try {
    if (state.move) {
      const [a, b] = await Promise.all([effective(state.move.from), effective(state.move.to)])
      applyPose(body, sampleTransition(a, b, currentMove(), state.u))
    } else {
      applyPose(body, await effective(state.selected))
    }
    state.handFitted = captureBothHandsLocal(body)
    if (frame) frameBody()
    status('')
  } catch (e) {
    status(`Couldn't load this pose (${e.message}).`)
  }
}

async function setHand(side, key) {
  if (!body || !state.selected || state.move) return
  const id = state.selected
  const base = await published(id)
  const before = store.editedPose(id)
  const stack = undo.get(id) || []
  stack.push(editSnap(before))
  undo.set(id, stack.slice(-50))
  applyHandShape(body, side, key, state.handFitted)
  const settled = capturePose(body, base)
  store.savePose(id, settled)
  state.handShape[side] = key
  state.message = ''
  renderInfo()
  renderList()
}

function status(text) {
  $('status').textContent = text
  $('status').hidden = !text
}

renderer.setAnimationLoop((now) => {
  if (state.playing && state.move) {
    const tr = currentMove()
    const u = (now - state.playing.start) / (tr.durationSec * 1000)
    state.u = Math.min(1, u)
    if (u >= 1) state.playing = null
    void refreshStage()
    syncTimeline()
  }
  controls.update()
  renderer.render(scene, camera)
})

// --- Editing --------------------------------------------------------------

/** After a joint drag: save the pose edit, or key the move at the current time. */
async function editEnded() {
  if (!body || !state.selected) return
  if (state.move) return keyCurrentShape()
  const id = state.selected
  const base = await published(id)
  const before = store.editedPose(id)
  let shape = capturePose(body, base)
  // Settle on the floor, then keep the settled shape.
  applyPose(body, { ...base, ...shape })
  shape = capturePose(body, base)
  const stack = undo.get(id) || []
  stack.push(editSnap(before))
  undo.set(id, stack.slice(-50))
  store.savePose(id, shape)
  state.message = ''
  renderInfo()
  renderList()
}

async function keyCurrentShape() {
  const { from, to, key } = state.move
  const [a, b] = await Promise.all([effective(from), effective(to)])
  const t = Math.round(Math.min(0.99, Math.max(0.01, state.u)) * 1e4) / 1e4
  const keep = [...new Set([...Object.keys(a.bones), ...Object.keys(b.bones)])]
  const axes = keyRestAxes(a, b, t)
  let shape = capturePose(body, { restAxes: axes }, keep)
  applyPose(body, { ...shape, restAxes: axes })
  shape = capturePose(body, { restAxes: axes }, keep)
  const tr = clone(currentMove())
  const at = tr.keys.findIndex((k) => Math.abs(k.t - t) < 0.005)
  if (at >= 0) {
    tr.keys[at] = { ...tr.keys[at], pose: shape }
  } else if (tr.keys.length >= MAX_KEYS) {
    state.message = `A move can have up to ${MAX_KEYS} keys. Select a key to change it instead.`
    renderInfo()
    return refreshStage()
  } else {
    tr.keys.push({ t, pose: shape })
  }
  tr.keys.sort((x, y) => x.t - y.t)
  state.keyIndex = tr.keys.findIndex((k) => Math.abs(k.t - t) < 0.005)
  store.saveMove(key, tr)
  state.message = ''
  renderInfo()
}

function setEditing(on) {
  state.editing = on
  editor.setEnabled(on)
  if (!on) editor.select(null)
  // Details form replaces the 3D view — hide it so Edit 3D actually shows the body.
  if (on && state.detailsOpen) setDetailsOpen(false)
  renderInfo()
}

async function undoPose() {
  const id = state.selected
  const stack = undo.get(id) || []
  if (!stack.length) return
  const prev = stack.pop()
  if (prev) store.savePose(id, prev)
  else store.discardPose(id)
  state.handShape = { L: '', R: '' }
  await refreshStage()
  renderInfo()
  renderList()
}

async function discardPose() {
  const id = state.selected
  const wasNew = store.poseMeta(id)?.isNew || state.byId.get(id)?._draft
  if (!confirm(`Discard your changes to ${poseName(id)}? This can't be undone.`)) return
  store.discardPose(id)
  undo.delete(id)
  poseCache.delete(id)
  loaded.delete(id)
  if (wasNew) {
    state.byId.delete(id)
    state.catalog = state.catalog.filter((p) => p.id !== id)
    const fallback = state.byId.has('warrior-ii') ? 'warrior-ii' : state.catalog[0]?.id
    if (fallback) await select(fallback)
    else {
      state.selected = ''
      renderInfo()
    }
  } else {
    await refreshStage()
    renderInfo()
  }
  renderList()
}

/** Prefer a local edit when it has content; otherwise keep the catalog value. */
function coalesceField(localVal, catalogVal) {
  if (localVal === undefined || localVal === null) return catalogVal
  if (typeof localVal === 'string' && !localVal.trim()) return catalogVal
  if (Array.isArray(localVal) && !localVal.length) return catalogVal
  return localVal
}

/** Teaching fields from the catalog entry, overlaid with any local edits. */
function catalogFieldsFromPose(p) {
  const local = store.poseMeta(p.id)?.fields || {}
  return store.emptyFields({
    name: coalesceField(local.name, p.name || ''),
    sanskrit: coalesceField(local.sanskrit, p.sanskrit || ''),
    altNames: coalesceField(local.altNames, p.altNames || []),
    category: coalesceField(local.category, p.category || 'standing'),
    tags: coalesceField(local.tags, p.tags || []),
    discipline: coalesceField(local.discipline, p.discipline || 'yoga'),
    intensity: coalesceField(local.intensity, p.difficulty || p.intensity || 2),
    description: coalesceField(local.description, p.description || ''),
    goodFor: coalesceField(local.goodFor, p.goodFor || ''),
    muscles: coalesceField(local.muscles, p.muscles || []),
    breathCue: coalesceField(local.breathCue, p.breathCue || ''),
    transitionIn: coalesceField(local.transitionIn, p.transitionIn || ''),
    breathPattern: coalesceField(local.breathPattern, p.breathPattern || ''),
    props: coalesceField(local.props, p.props || []),
    modifications: coalesceField(local.modifications, p.modifications || []),
    deepen: coalesceField(local.deepen, p.deepen || []),
    avoidIf: coalesceField(local.avoidIf, p.avoidIf || []),
    commonMistakes: coalesceField(local.commonMistakes, p.commonMistakes || []),
    alignmentCues: coalesceField(local.alignmentCues, p.alignmentCues || []),
    defaultHoldSec: coalesceField(local.defaultHoldSec, p.defaultHoldSec || 30),
    minHoldSec: coalesceField(local.minHoldSec, p.minHoldSec),
    drishti: coalesceField(local.drishti, p.drishti || ''),
    basePoseId: coalesceField(local.basePoseId, p.basePoseId || ''),
    ...(local.chineseName ? { chineseName: local.chineseName } : {}),
  })
}

function listLine(label, items) {
  if (!Array.isArray(items) || !items.length) return ''
  return `<p><strong>${esc(label)}</strong> ${items.map(esc).join(' · ')}</p>`
}

/** Compact teaching summary in the info block (catalog + local edits). */
function teachingSummaryHtml(p) {
  const f = catalogFieldsFromPose(p)
  const bits = []
  if (f.description) bits.push(`<p class="pose-howto">${esc(f.description)}</p>`)
  if (f.goodFor) bits.push(`<p><strong>Good for</strong> ${esc(f.goodFor)}</p>`)
  if (f.muscles?.length) bits.push(`<p><strong>Muscles</strong> ${f.muscles.map(esc).join(', ')}</p>`)
  if (f.breathCue) bits.push(`<p><strong>Breath</strong> ${esc(f.breathCue)}</p>`)
  if (f.transitionIn) bits.push(`<p><strong>Transition in</strong> ${esc(f.transitionIn)}</p>`)
  bits.push(listLine('Align', f.alignmentCues))
  bits.push(listLine('Modify', f.modifications))
  bits.push(listLine('Deepen', f.deepen))
  bits.push(listLine('Careful', f.avoidIf))
  bits.push(listLine('Common mistakes', f.commonMistakes))
  bits.push(listLine('Props', f.props))
  if (f.tags?.length) bits.push(`<p class="muted">Tags: ${f.tags.map(esc).join(', ')}</p>`)
  return bits.filter(Boolean).join('')
}

async function suggestPose() {
  const id = state.selected
  const edit = store.editedPose(id)
  if (!edit?.bones || !Object.keys(edit.bones).length) {
    state.message = 'Edit the 3D body before suggesting — submissions need a 3D shape.'
    return renderInfo()
  }
  const meta = store.poseMeta(id)
  const isNew = Boolean(meta?.isNew)
  if (!isNew) {
    const delta = poseEnvelope(id, await published(id), edit)
    if (!Object.keys(delta.bones).length && !delta.root && !delta.props && !meta?.fields) {
      state.message = 'This pose matches the library, so there is nothing to suggest yet.'
      return renderInfo()
    }
  }
  if (!getUser()) {
    state.message = 'Sign in to suggest an edit (so we can credit you).'
    return renderInfo()
  }
  const fields = catalogFieldsFromPose(state.byId.get(id) || { id, name: id })
  if (!fields.name) {
    state.message = 'Fill in Edit info (at least a name) before suggesting.'
    return renderInfo()
  }
  const credit = await openSubmitCreditDialog({ creditName: meta?.creditName || creditName() })
  if (!credit) return
  store.saveMeta(id, { fields, creditName: credit.creditName, isNew })
  const env = appPoseEnvelope({
    pose: id,
    sourcePoseId: isNew ? '' : id,
    copyId: `tp-viewer-${id}`,
    creditName: credit.creditName,
    bones: edit.bones,
    root: edit.root,
    props: edit.props,
    fields,
  })
  env.authorEmail = credit.authorEmail || getUser()?.email || ''
  await sendAppPose(env, id)
}

async function sendAppPose(env, id) {
  state.message = 'Submitting to GitHub…'
  renderInfo()
  try {
    const token = await accessToken()
    const user = getUser()
    const result = await githubSubmit({
      apiBase: config.apiBase,
      accessToken: token,
      licenceAccepted: true,
      envelope: env,
      authorEmail: env.authorEmail || user?.email,
      authorName: env.creditName || user?.name,
    })
    store.markSubmitted('pose', id)
    state.message = `Submitted as GitHub issue #${result.number}. ${result.url}`
    void refreshSuggestions({ force: true })
  } catch (e) {
    state.message = e instanceof Error ? e.message : 'Submit failed'
  }
  renderInfo()
}

async function startNewPose() {
  if (!getUser()) {
    state.message = 'Sign in to create a new pose.'
    return renderInfo()
  }
  const details = await openMetaDialog({
    title: 'Create a new pose',
    fields: store.emptyFields({ name: '', description: '' }),
    creditName: creditName(),
  })
  if (!details?.fields?.name) return
  let id = slugify(details.fields.name)
  if (!id) {
    state.message = 'Give the pose an English name so we can make an id.'
    return renderInfo()
  }
  if (state.byId.has(id) || store.poseMeta(id)?.isNew) {
    let n = 2
    while (state.byId.has(`${id}-${n}`) || store.poseMeta(`${id}-${n}`)?.isNew) n += 1
    id = `${id}-${n}`
  }
  const baseId = details.fields.basePoseId && state.byId.has(details.fields.basePoseId) ? details.fields.basePoseId : state.byId.has('mountain') ? 'mountain' : state.catalog[0]?.id
  const base = baseId ? await published(baseId) : { bones: { root: [1, 0, 0, 0] }, root: { head: [0, 0, 0] } }
  store.savePose(id, {
    bones: clone(base.bones),
    root: clone(base.root || { head: [0, 0, 0] }),
    ...(Array.isArray(base.props) ? { props: clone(base.props) } : {}),
  })
  store.saveMeta(id, {
    isNew: true,
    basePoseId: baseId || '',
    creditName: details.creditName,
    fields: { ...details.fields, basePoseId: details.fields.basePoseId || baseId || '' },
  })
  registerDraftPose(id, details.fields)
  state.message = `New pose “${details.fields.name}” — edit the 3D body, then Suggest this edit.`
  await select(id)
  setEditing(true)
}

function registerDraftPose(id, fields) {
  if (state.byId.has(id)) return
  const entry = {
    id,
    name: fields.name || id,
    sanskrit: fields.sanskrit || undefined,
    altNames: fields.altNames || [],
    category: fields.category || 'standing',
    tags: fields.tags || [],
    difficulty: fields.intensity,
    drishti: fields.drishti || undefined,
    basePoseId: fields.basePoseId || undefined,
    _hay: '',
    _draft: true,
  }
  entry._hay = haystack(entry)
  state.byId.set(id, entry)
  state.catalog = [...state.catalog, entry].sort((a, b) => a.name.localeCompare(b.name))
  $('pose-options').innerHTML = state.catalog.map((p) => `<option value="${esc(p.name)} (${p.id})"></option>`).join('')
}

async function sendIssue(params, env, kind, key) {
  try {
    const how = await openIssueWithData(params, env)
    store.markSubmitted(kind, key)
    state.message =
      how === 'clipboard'
        ? 'This edit is too big to fit in a link, so its 3D data is on your clipboard. Paste it into the 3D data box on GitHub, then submit the issue. Its progress shows here once it is on GitHub.'
        : 'GitHub opened in a new tab with your 3D data filled in. Describe the change and submit the issue. Its progress shows here once it is on GitHub.'
  } catch {
    state.message = "Couldn't open GitHub with the data. Download the file and attach it to an issue instead."
  }
  renderInfo()
}

// --- Moves ----------------------------------------------------------------

function movesFor(id) {
  const keys = new Set([...Object.keys(state.moves), ...store.editedMoveKeys()])
  return [...keys].filter((k) => k.split('>').includes(id)).sort()
}

async function openMove(from, to) {
  if (from === to || !state.byId.has(from) || !state.byId.has(to)) return
  // Edit a move stored the other way round in place rather than adding a second one.
  const reverse = moveKey(to, from)
  if (!state.moves[moveKey(from, to)] && !store.editedMove(moveKey(from, to)) && (state.moves[reverse] || store.editedMove(reverse))) {
    ;[from, to] = [to, from]
  }
  stopPlaying()
  state.move = { key: moveKey(from, to), from, to }
  history.replaceState(null, '', `#${state.move.key}`)
  state.u = 0
  state.keyIndex = -1
  state.message = ''
  renderInfo()
  await refreshStage({ frame: true })
}

async function closeMove() {
  stopPlaying()
  state.move = null
  history.replaceState(null, '', `#${state.selected}`)
  state.message = ''
  renderInfo()
  await refreshStage({ frame: true })
}

function stopPlaying() {
  state.playing = null
}

function play() {
  if (!state.move) return
  if (state.u >= 1) state.u = 0
  const tr = currentMove()
  state.playing = { start: performance.now() - state.u * tr.durationSec * 1000 }
  state.keyIndex = -1
  syncTimeline()
}

function setMove(mutate) {
  const tr = clone(currentMove())
  mutate(tr)
  tr.keys.sort((x, y) => x.t - y.t)
  store.saveMove(state.move.key, tr)
}

async function scrubTo(u) {
  stopPlaying()
  state.u = u
  const keys = currentMove().keys
  state.keyIndex = keys.findIndex((k) => Math.abs(k.t - u) < 0.005)
  syncTimeline()
  await refreshStage()
}

/** Updates the timeline without rebuilding the panel (keeps focus while scrubbing). */
function syncTimeline() {
  const scrub = $('scrub')
  if (!scrub) return
  const tr = currentMove()
  scrub.value = String(Math.round(state.u * 1000))
  $('scrub-time').textContent = `${(state.u * tr.durationSec).toFixed(1)} s of ${tr.durationSec} s`
  $('play').textContent = state.playing ? 'Pause' : 'Play'
  for (const b of document.querySelectorAll('#keys button[data-key]')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.key) === state.keyIndex))
  }
  const keyTools = $('key-tools')
  if (keyTools) keyTools.hidden = state.keyIndex < 0
  const addKey = $('add-key')
  if (addKey) addKey.disabled = state.keyIndex >= 0 || state.u < 0.01 || state.u > 0.99 || tr.keys.length >= MAX_KEYS
}

async function discardMove() {
  if (!confirm('Discard your changes to this move?')) return
  store.discardMove(state.move.key)
  state.keyIndex = -1
  renderInfo()
  await refreshStage()
}

async function suggestMove() {
  const { from, to, key } = state.move
  if (!store.editedMove(key)) return
  await sendIssue({ template: 'move.yml', title: `Move: ${from} to ${to}`, from, to }, moveEnvelope(from, to, currentMove()), 'move', key)
}

// --- Search and list ------------------------------------------------------

function haystack(p) {
  return fold([p.id, p.name, p.sanskrit, ...(p.altNames || []), CATEGORY_LABELS[p.category], ...(p.tags || [])].join(' '))
}

function posesWithMoves() {
  return new Set([...Object.keys(state.moves), ...store.editedMoveKeys()].flatMap((k) => k.split('>')))
}

function posesPending() {
  const ids = pendingPoseIds(state.suggestions?.items || [])
  return new Set([...ids].filter((id) => state.byId.has(id)))
}

function inCategory(p, edited, withMoves, pending) {
  if (!state.category) return true
  if (state.category === EDITED) return edited.has(p.id)
  if (state.category === WITH_MOVES) return withMoves.has(p.id)
  if (state.category === PENDING) return pending.has(p.id)
  return p.category === state.category
}

function filtered() {
  const tokens = fold($('q').value).split(/\s+/).filter(Boolean)
  const edited = new Set(store.editedPoseIds())
  for (const k of store.editedMoveKeys()) for (const id of k.split('>')) edited.add(id)
  const withMoves = posesWithMoves()
  const pending = posesPending()
  return state.catalog.filter((p) => inCategory(p, edited, withMoves, pending) && tokens.every((t) => p._hay.includes(t)))
}

function renderList() {
  const items = filtered()
  const edited = new Set(store.editedPoseIds())
  const pending = posesPending()
  $('count').textContent = `${items.length} of ${state.catalog.length} poses`
  $('list').innerHTML = items
    .map(
      (p) =>
        `<li><button type="button" data-id="${p.id}" aria-current="${p.id === state.selected}">${esc(p.name)}${edited.has(p.id) ? ' <span class="dot" title="Edited in this browser">●</span>' : ''}${pending.has(p.id) ? ' <span class="dot pending" title="A suggestion on GitHub is pending review">○</span>' : ''}${p.sanskrit ? `<small>${esc(p.sanskrit)}</small>` : ''}</button></li>`,
    )
    .join('')
}

function renderCategories() {
  const cats = [...new Set(state.catalog.map((p) => p.category))]
  const n = store.countEdits()
  const chips = ['', ...cats].map(
    (c) => `<button type="button" data-cat="${c}" aria-pressed="${c === state.category}">${c ? CATEGORY_LABELS[c] || c : 'All'}</button>`,
  )
  const m = posesWithMoves().size
  if (m) chips.push(`<button type="button" data-cat="${WITH_MOVES}" aria-pressed="${state.category === WITH_MOVES}">With moves (${m})</button>`)
  if (n) chips.push(`<button type="button" data-cat="${EDITED}" aria-pressed="${state.category === EDITED}">My edits (${n})</button>`)
  const pend = posesPending().size
  if (pend) chips.push(`<button type="button" data-cat="${PENDING}" aria-pressed="${state.category === PENDING}">Pending suggestions (${pend})</button>`)
  $('cats').innerHTML = chips.join('')
}

// --- Pose details ---------------------------------------------------------

const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
const pill = (status) => `<span class="pill ${status}">${STATUS_LABELS[status]}</span>`
const ghLink = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`

function suggestionLine(s) {
  const who = s.creditName ? esc(s.creditName) : s.user ? `@${esc(s.user)}` : ''
  return `<li>${ghLink(s.url, `#${s.number}`)} ${pill(s.status)} <span class="muted">${who ? `by ${who}, ` : ''}${shortDate(s.createdAt)}${
    s.pr ? ` · ${ghLink(s.pr.url, `pull request #${s.pr.number}`)}` : ''
  }</span></li>`
}

/**
 * Where this browser's edit stands. `inLibrary`: the published pose or move already matches it.
 * `matches`: the GitHub suggestions for the same pose or move.
 */
function ownStatus(edit, matches, inLibrary) {
  if (inLibrary) {
    return edit.submittedAt ? `${pill('merged')} The library now includes your edit.` : 'This matches the library.'
  }
  if (!edit.submittedAt) return 'Not suggested yet.'
  const changed = edit.updatedAt > edit.submittedAt ? " You've changed it since; suggest it again to send the changes." : ''
  const own = findOwn(matches, edit.submittedAt)
  if (own) {
    const pr = own.pr ? ` (${ghLink(own.pr.url, `pull request #${own.pr.number}`)})` : ''
    const later = own.status === 'merged' && !changed ? ' Reload in a few minutes to see it in the library; a reviewer may also have adjusted it.' : ''
    return `Suggested as ${ghLink(own.url, `#${own.number}`)} ${pill(own.status)}${pr}.${later}${changed}`
  }
  const c = state.suggestions
  const check = !c
    ? ' Checking GitHub…'
    : c.error
      ? ` Couldn't check GitHub (${esc(c.error)}).`
      : " It isn't on GitHub yet. If you didn't submit the issue, suggest it again."
  return `Opened on GitHub ${shortDate(edit.submittedAt)}.${check}${changed}`
}

function suggestionsSection(p) {
  const c = state.suggestions
  const items = c ? (state.move ? forMove(c.items, state.move.from, state.move.to) : forPose(c.items, p.id)) : []
  const terms = state.move ? `"${state.move.from}" "${state.move.to}"` : `"${p.id}"`
  const all = `${REPO}/issues?${new URLSearchParams({ q: `is:issue ${terms}` })}`
  let body
  if (!c) body = '<p class="muted">Checking…</p>'
  else if (!c.checkedAt) body = `<p class="muted">GitHub check failed${c.error ? `: ${esc(c.error)}` : ''}.</p>`
  else if (!items.length) body = '<p class="muted">None yet.</p>'
  else {
    body = `<ul class="suggestions">${items.slice(0, SUGGESTIONS_SHOWN).map(suggestionLine).join('')}</ul>${
      items.length > SUGGESTIONS_SHOWN ? `<p class="muted">${ghLink(all, `All ${items.length}`)}</p>` : ''
    }`
  }
  return `
    <section class="panel">
      <div class="row">
        <h3>Suggestions</h3>
        <button type="button" id="refresh-suggestions" ${state.checking ? 'disabled' : ''}>${state.checking ? '…' : 'Refresh'}</button>
      </div>
      ${body}
    </section>`
}

function easeOptions(selected) {
  return Object.entries(EASE_LABELS)
    .map(([v, label]) => `<option value="${v}" ${v === (selected || DEFAULT_EASE) ? 'selected' : ''}>${label}</option>`)
    .join('')
}

function toolsMenuHtml() {
  const joint = editor.joint
  const side = joint?.endsWith('.L') ? 'L' : joint?.endsWith('.R') ? 'R' : undefined
  const canStraighten = !!limbFrom(joint)
  const symmetrizeLabel =
    side === 'L' ? 'Symmetrize from left' : side === 'R' ? 'Symmetrize from right' : 'Symmetrize (average)'
  return `<select id="pose-tools" aria-label="Pose tools">
      <option value="" selected disabled>Tools</option>
      <option value="reset">Reset to published</option>
      <option value="mirror">Mirror left ↔ right</option>
      <option value="straighten" ${canStraighten ? '' : 'disabled'}>${canStraighten ? 'Straighten limb' : 'Straighten limb (pick an arm/leg)'}</option>
      <option value="fixHips">Fix hips</option>
      <option value="straightenSpine">Straighten spine</option>
      <option value="levelHips">Level hips</option>
      <option value="symmetrize">${symmetrizeLabel}</option>
    </select>`
}

function propsPanelHtml() {
  const list = body?.propList || []
  let blocks = 0
  const rows = list
    .map((p, i) => {
      const name = p.type === 'block' ? `Block ${++blocks}` : PROP_LABEL[p.type] || p.type
      const active = editor.propSel === i
      const mode = active ? editor.propMode : null
      const btn = (act, label) =>
        `<button type="button" class="hdr-btn${mode === act ? ' active' : ''}" data-prop="${act}" data-i="${i}">${label}</button>`
      let extra = ''
      if (p.type === 'chair') {
        const back = (p.size || {}).back ?? 0.42
        extra = `<label class="prop-slider"><span>Seat</span><input type="range" min="0.3" max="0.7" step="0.01" value="${p.seat[2]}" data-prop-size="seat" data-i="${i}"/><output>${Math.round(p.seat[2] * 100)} cm</output></label>
          <label class="prop-slider"><span>Back</span><input type="range" min="0.2" max="0.6" step="0.01" value="${back}" data-prop-size="back" data-i="${i}"/><output>${Math.round(back * 100)} cm</output></label>`
      } else if (p.type === 'block') {
        const cur = blockStandOf(p)
        const opts = Object.entries(BLOCK_STANDS)
          .map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${v.label}</option>`)
          .join('')
        extra = `<label class="prop-stand"><span>Stand</span><select data-prop-stand="${i}">${opts}</select></label>`
      }
      return `<div class="prop-row${active && mode ? ' is-selected' : ''}">
        <div class="prop-actions"><span class="prop-name">${esc(name)}</span>${btn('move', 'Move')}${btn('turn', 'Turn')}${btn('remove', 'Remove')}</div>
        ${extra}
      </div>`
    })
    .join('')
  const has = (type) => list.some((p) => p.type === type)
  const add = (type, label) => `<button type="button" class="hdr-btn" data-prop-add="${type}">${label}</button>`
  return `<div class="props-panel" id="props-panel">
    <p class="muted props-label">Props</p>
    ${rows}
    <div class="prop-add">${has('chair') ? '' : add('chair', 'Add chair')}${add('block', 'Add block')}${has('wall') ? '' : add('wall', 'Add wall')}</div>
    <p class="muted props-hint">Click a prop or Move: drag the arrows to slide it on the floor (blocks also lift). Turn: drag the ring. Props are kept on save.</p>
  </div>`
}

function editToolsRow() {
  if (!state.editing) return ''
  return `<div class="tools-row">
    <label class="field">Joint <select id="joint"><option value="">Joint…</option>${JOINTS.map(([id, label]) => `<option value="${id}" ${editor.joint === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    ${toolsMenuHtml()}
  </div>
  <div class="tools-row hands-row" role="group" aria-label="Hand shapes">
    <label class="field">Left hand <select id="hand-L">${handShapeOptionsHtml(state.handShape.L)}</select></label>
    <label class="field">Right hand <select id="hand-R">${handShapeOptionsHtml(state.handShape.R)}</select></label>
  </div>
  ${propsPanelHtml()}`
}

/** Push undo + run a prop mutation, then save the pose (same path as a joint drag). */
async function withPropEdit(fn) {
  if (!body || !state.selected || state.move) return
  const id = state.selected
  const before = store.editedPose(id)
  const stack = undo.get(id) || []
  stack.push(editSnap(before))
  undo.set(id, stack.slice(-50))
  fn()
  const base = await published(id)
  const shape = capturePose(body, base)
  store.savePose(id, shape)
  state.message = ''
  renderInfo()
  renderList()
}

/** Edit · undo · discard (and Suggest/Clear when relevant) — first button group. */
function poseEditActions(p) {
  if (state.move) return { buttons: '', text: '' }
  const edit = store.editedPose(p.id)
  const canUndo = (undo.get(p.id) || []).length > 0
  const buttons = [
    `<button type="button" class="info-icon-btn info-icon-btn--edit" id="edit-toggle" aria-pressed="${state.editing}" title="${state.editing ? 'Done editing 3D' : 'Edit 3D'}">${ICO_PENCIL}<span>3D</span></button>`,
    `<button type="button" class="info-icon-btn info-icon-btn--edit" id="edit-details" aria-pressed="${state.detailsOpen}" title="Edit info">${ICO_PENCIL}<span>Info</span></button>`,
    `<button type="button" class="info-icon-btn" id="undo-pose" ${canUndo ? '' : 'disabled'} title="Undo last change">${ICO_UNDO}</button>`,
    `<button type="button" class="info-icon-btn" id="discard-pose" ${edit ? '' : 'disabled'} title="Discard all changes">${ICO_BIN}</button>`,
  ]
  const textBits = []
  if (edit) {
    const meta = store.poseMeta(p.id)
    const isNew = Boolean(meta?.isNew)
    const inLibrary = !isNew && poseInLibrary(p.id, edit)
    textBits.push(`<span class="badge">${isNew ? 'New' : 'Edited'} · ${new Date(edit.updatedAt).toLocaleString()}</span>`)
    textBits.push(`<span class="edit-status">${ownStatus(edit, forPose(state.suggestions?.items || [], p.id), inLibrary)}</span>`)
    if (inLibrary) {
      buttons.push(`<button type="button" class="info-icon-btn primary" id="clear-pose" title="Clear my copy">Clear</button>`)
    } else {
      const signedIn = Boolean(getUser())
      buttons.push(
        `<button type="button" class="info-icon-btn primary" id="suggest-pose" ${signedIn ? '' : 'disabled'} title="${edit.submittedAt ? 'Suggest again' : 'Suggest'}">${edit.submittedAt ? 'Suggest again' : 'Suggest'}</button>`,
      )
      if (!signedIn) textBits.push('<span class="muted suggest-need-signin">Sign in to suggest</span>')
    }
  }
  return {
    buttons: buttons.join(''),
    text: textBits.length ? `<span class="info-edit-text">${textBits.join(' ')}</span>` : '',
  }
}

function creditsSection(p) {
  const items = forPose(state.suggestions?.items || [], p.id).filter((s) => s.creditName || s.user)
  if (!items.length) return ''
  const lines = items.slice(0, 8).map((s) => {
    const who = esc(s.creditName || s.user)
    return `<li>${ghLink(s.url, `#${s.number}`)} · ${who} · <span class="pill ${s.status}">${STATUS_LABELS[s.status]}</span></li>`
  })
  return `
    <section class="panel">
      <h3>Credits</h3>
      <ul class="suggestions">${lines.join('')}</ul>
    </section>`
}

function moveSection(p) {
  if (!state.move) {
    const moves = movesFor(p.id)
    return `
      <section class="panel">
        <h3>Moves</h3>
        ${
          moves.length
            ? `<div class="chips">${moves
                .map((k) => {
                  const [a, b] = k.split('>')
                  return `<button type="button" data-move="${k}">${esc(poseName(a))} → ${esc(poseName(b))}${store.editedMove(k) ? ' <span class="dot">●</span>' : ''}</button>`
                })
                .join('')}</div>`
            : ''
        }
        <label class="field">New move to <input id="move-to" list="pose-options" placeholder="Next pose…" autocomplete="off" /></label>
      </section>`
  }
  const { from, to, key } = state.move
  const tr = currentMove()
  const edit = store.editedMove(key)
  const inLibrary = !!edit && moveInLibrary(key, edit)
  const key0 = tr.keys[state.keyIndex]
  return `
    <section class="panel move">
      <div class="row">
        <h3>${esc(poseName(from))} → ${esc(poseName(to))}</h3>
        <button type="button" id="close-move">Close</button>
      </div>
      <div class="timeline">
        <button type="button" id="play">Play</button>
        <div class="track">
          <input id="scrub" type="range" min="0" max="1000" step="1" aria-label="Time in the move" />
          <div id="keys" class="keys">${tr.keys
            .map((k, i) => `<button type="button" data-key="${i}" style="left:${k.t * 100}%" aria-label="Key at ${(k.t * tr.durationSec).toFixed(1)} s"></button>`)
            .join('')}</div>
        </div>
        <span id="scrub-time" class="muted"></span>
      </div>
      <div class="row">
        <button type="button" id="add-key">Add key</button>
        <span class="muted">${tr.keys.length}/${MAX_KEYS}</span>
      </div>
      <div id="key-tools" class="row" ${key0 ? '' : 'hidden'}>
        <label class="field">Ease <select id="key-ease">${easeOptions(key0?.ease)}</select></label>
        <button type="button" id="delete-key">Delete key</button>
      </div>
      <div class="row">
        <label class="field">Length (s) <input id="duration" type="number" min="0.2" max="30" step="0.1" value="${tr.durationSec}" /></label>
        <label class="field">End ease <select id="end-ease">${easeOptions(tr.endEase)}</select></label>
      </div>
      ${
        edit
          ? `<p class="badge">Edited</p>
            <p class="edit-status">${ownStatus(edit, forMove(state.suggestions?.items || [], from, to), inLibrary)}</p>
            <div class="actions">
              ${
                inLibrary
                  ? '<button type="button" class="primary" id="clear-move">Clear</button>'
                  : `<button type="button" class="primary" id="suggest-move">${edit.submittedAt ? 'Suggest again' : 'Suggest'}</button>`
              }
              <button type="button" id="download-move">Download</button>
              ${inLibrary ? '' : '<button type="button" id="discard-move">Discard</button>'}
            </div>`
          : ''
      }
    </section>`
}

const ICO_DL = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 1a.75.75 0 0 1 .75.75v6.69l2.22-2.22a.75.75 0 1 1 1.06 1.06l-3.5 3.5a.75.75 0 0 1-1.06 0l-3.5-3.5a.75.75 0 0 1 1.06-1.06l2.22 2.22V1.75A.75.75 0 0 1 8 1zm-5 11.25a.75.75 0 0 0 0 1.5h10a.75.75 0 0 0 0-1.5H3z"/></svg>`
const ICO_COPY = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path fill="currentColor" d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>`
const ICO_PENCIL = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`
const ICO_UNDO = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M4.28 3.22a.75.75 0 0 1 0 1.06L2.81 5.75H9a3.75 3.75 0 1 1 0 7.5H8a.75.75 0 0 1 0-1.5h1a2.25 2.25 0 1 0 0-4.5H2.81l1.47 1.47a.75.75 0 0 1-1.06 1.06l-2.75-2.75a.75.75 0 0 1 0-1.06l2.75-2.75a.75.75 0 0 1 1.06 0z"/></svg>`
const ICO_BIN = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M6.5 1.75A.75.75 0 0 1 7.25 1h1.5a.75.75 0 0 1 .75.75V3h3.5a.75.75 0 0 1 0 1.5h-.34l-.6 8.1A1.75 1.75 0 0 1 10.32 14H5.68a1.75 1.75 0 0 1-1.74-1.4l-.6-8.1H3A.75.75 0 0 1 3 3h3.5V1.75zm1.5.75v.5h-1.5v-.5h1.5zM5.1 4.5l.58 7.85a.25.25 0 0 0 .25.2h4.14a.25.25 0 0 0 .25-.2l.58-7.85H5.1z"/></svg>`

function renderInfo() {
  const p = state.byId.get(state.selected)
  if (!p) {
    $('info').innerHTML = '<p class="muted">Pick a pose to see it in 3D.</p>'
    return
  }
  const c = state.characters.find((x) => x.id === state.character) || state.characters[0]
  const bodyFile = state.bodyDetail === 'high' && c.hdFile ? c.hdFile : c.file
  const googleQ = encodeURIComponent([p.name, p.sanskrit, 'yoga pose'].filter(Boolean).join(' '))
  const localEdit = store.editedPose(p.id)
  // One Pose download: edited/draft JSON when present, else published file (no second Download).
  const poseDl =
    localEdit || p._draft
      ? `<button type="button" class="info-icon-btn" id="download-pose" title="Download pose JSON">${ICO_DL}<span>Pose</span></button>`
      : `<a class="info-icon-btn" href="poses/${p.id}.json" download title="Download pose JSON">${ICO_DL}<span>Pose</span></a>`
  const editUi = poseEditActions(p)
  const editGroup = editUi.buttons
    ? `<div class="info-btn-group info-btn-group--edit" role="group" aria-label="Edit pose">${editUi.buttons}</div>`
    : ''
  const filesGroup = `<div class="info-btn-group info-btn-group--files" role="group" aria-label="Download and share">
      ${poseDl}
      <a class="info-icon-btn" href="characters/${bodyFile}" download title="Download body GLB">${ICO_DL}<span>Body</span></a>
      <button type="button" class="info-icon-btn" id="copy" title="Copy link to this pose">${ICO_COPY}<span>Copy</span></button>
    </div>`
  $('info').innerHTML = `
    <div class="info-title">
      <h2>${esc(p.name)}</h2>
      <a class="google-pose" href="https://www.google.com/search?q=${googleQ}" target="_blank" rel="noopener">Search Google</a>
    </div>
    ${p.sanskrit ? `<p class="sanskrit">${esc(p.sanskrit)}</p>` : ''}
    <p class="muted"><code>${p.id}</code> · ${esc(CATEGORY_LABELS[p.category] || p.category)}${p.difficulty ? ` · difficulty ${p.difficulty} of 5` : ''}</p>
    <div class="info-quick">
      ${editGroup}
      ${filesGroup}
      ${editUi.text}
    </div>
    ${editToolsRow()}
    ${p.altNames?.length ? `<p class="muted">Also called ${p.altNames.map(esc).join(', ')}</p>` : ''}
    ${p.drishti ? `<p>Gaze: ${esc(p.drishti)}</p>` : ''}
    ${teachingSummaryHtml(p)}
    ${state.message ? `<p class="note" role="status">${esc(state.message)}</p>` : ''}
    ${moveSection(p)}
    ${creditsSection(p)}
    ${suggestionsSection(p)}
    <p class="muted">${p._draft ? 'Draft — not published yet.' : `<a href="${REPO}/blob/main/poses/${p.id}.json" target="_blank" rel="noopener">GitHub</a> · <a href="${REPO}/commits/main/poses/${p.id}.json" target="_blank" rel="noopener">History</a>`}</p>
  `
  syncTimeline()
}

/** Panel controls are rebuilt on every render, so they're handled here by delegation. */
function bindInfo() {
  const info = $('info')
  info.addEventListener('click', async (e) => {
    const t = e.target.closest('button')
    if (!t) return
    const id = state.selected
    if (t.id === 'edit-toggle') setEditing(!state.editing)
    else if (t.id === 'undo-pose') await undoPose()
    else if (t.id === 'discard-pose') await discardPose()
    else if (t.id === 'clear-pose') {
      store.discardPose(id)
      undo.delete(id)
      await refreshStage()
      renderInfo()
      renderList()
    }
    else if (t.id === 'suggest-pose') await suggestPose()
    else if (t.id === 'edit-details') await editDetails()
    else if (t.id === 'refresh-suggestions') await refreshSuggestions({ force: true })
    else if (t.id === 'download-pose') download(`${id}.json`, await effective(id))
    else if (t.id === 'close-move') await closeMove()
    else if (t.dataset.move) await openMove(...t.dataset.move.split('>'))
    else if (t.dataset.propAdd) await withPropEdit(() => editor.addProp(t.dataset.propAdd))
    else if (t.dataset.prop) {
      const i = Number(t.dataset.i)
      if (t.dataset.prop === 'remove') await withPropEdit(() => editor.removeProp(i))
      else {
        editor.selectProp(i, t.dataset.prop)
        renderInfo()
      }
    }
    else if (t.id === 'play') {
      if (state.playing) stopPlaying()
      else play()
      syncTimeline()
    }
    else if (t.dataset.key) await scrubTo(currentMove().keys[Number(t.dataset.key)].t)
    else if (t.id === 'add-key') {
      stopPlaying()
      await refreshStage()
      await keyCurrentShape()
    }
    else if (t.id === 'delete-key') {
      const i = state.keyIndex
      setMove((tr) => tr.keys.splice(i, 1))
      state.keyIndex = -1
      renderInfo()
      await refreshStage()
    } else if (t.id === 'discard-move') await discardMove()
    else if (t.id === 'clear-move') {
      store.discardMove(state.move.key)
      state.keyIndex = -1
      renderInfo()
      await refreshStage()
    }
    else if (t.id === 'suggest-move') await suggestMove()
    else if (t.id === 'download-move') download(`${state.move.from}--${state.move.to}.json`, { format: 'yoga-transitions/1', transitions: { [state.move.key]: currentMove() } })
    else if (t.id === 'copy') {
      await navigator.clipboard?.writeText(location.href)
      const label = t.querySelector('span')
      if (label) {
        const prev = label.textContent
        label.textContent = 'Copied'
        setTimeout(() => {
          if (label.isConnected) label.textContent = prev
        }, 1500)
      }
    }
  })
  info.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-prop-size]')
    if (!el || !body || !state.selected) return
    const id = state.selected
    const before = store.editedPose(id)
    const stack = undo.get(id) || []
    stack.push(editSnap(before))
    undo.set(id, stack.slice(-50))
  })
  info.addEventListener('input', (e) => {
    if (e.target.id === 'scrub') {
      void scrubTo(Number(e.target.value) / 1000)
      return
    }
    const el = e.target.closest('[data-prop-size]')
    if (!el || !body) return
    const i = Number(el.dataset.i)
    const v = Number(el.value)
    editor.setChairSize(i, el.dataset.propSize, v)
    el.nextElementSibling.textContent = `${Math.round(v * 100)} cm`
  })
  info.addEventListener('change', async (e) => {
    const el = e.target
    if (el.id === 'joint') {
      editor.clearPropSelection()
      editor.select(el.value || null)
      syncToolsMenu()
      renderInfo()
    } else if (el.id === 'pose-tools') {
      const tool = el.value
      el.value = ''
      if (tool) await runPoseTool(tool)
    } else if (el.id === 'hand-L' || el.id === 'hand-R') {
      await setHand(el.id === 'hand-L' ? 'L' : 'R', el.value)
    } else if (el.dataset.propStand != null) {
      await withPropEdit(() => editor.setBlockStand(Number(el.dataset.propStand), el.value, BLOCK_STANDS))
    } else if (el.dataset.propSize) {
      // Seat/back sliders: size already applied on input; persist on change.
      if (!body || !state.selected) return
      const base = await published(state.selected)
      store.savePose(state.selected, capturePose(body, base))
      renderList()
    } else if (el.id === 'move-to') {
      const m = /\(([a-z0-9-]+)\)\s*$/.exec(el.value)
      const target = m ? m[1] : state.catalog.find((p) => fold(p.name) === fold(el.value))?.id
      if (target) await openMove(state.selected, target)
    } else if (el.id === 'duration') {
      const v = Math.min(30, Math.max(0.2, Number(el.value) || NEW_MOVE.durationSec))
      setMove((tr) => (tr.durationSec = Math.round(v * 10) / 10))
      renderInfo()
    } else if (el.id === 'end-ease') {
      setMove((tr) => (tr.endEase = el.value))
      renderInfo()
      await refreshStage()
    } else if (el.id === 'key-ease') {
      const i = state.keyIndex
      setMove((tr) => {
        if (el.value === DEFAULT_EASE) delete tr.keys[i].ease
        else tr.keys[i].ease = el.value
      })
      renderInfo()
      await refreshStage()
    }
  })
}

async function select(id, { push = true } = {}) {
  if (!state.byId.has(id)) return
  if (state.move) {
    stopPlaying()
    state.move = null
  }
  state.selected = id
  state.message = ''
  state.handShape = { L: '', R: '' }
  if (push && location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`)
  document.title = `${poseName(id)} · Open Yoga Poses`
  renderList()
  renderInfo()
  const firstLoad = !loaded.has(id)
  await refreshStage({ frame: true })
  // The edit status compares with the published pose, which has only just loaded.
  if (firstLoad && store.editedPose(id) && state.selected === id && !state.move) renderInfo()
}

// --- Suggestions on GitHub ------------------------------------------------

async function refreshSuggestions({ force = false } = {}) {
  if (state.checking) return
  const before = JSON.stringify(state.suggestions)
  state.checking = true
  if (force) renderInfo()
  state.suggestions = await loadSuggestions({ force })
  state.checking = false
  // Rebuilding the panel mid-scrub would drop focus, so only redraw when something changed.
  if (force || JSON.stringify(state.suggestions) !== before) {
    renderCategories()
    renderList()
    renderInfo()
  }
}

/** Whether this browser has suggested an edit, so coming back from GitHub is worth a fresh check. */
const hasSubmitted = () =>
  store.editedPoseIds().some((id) => store.editedPose(id).submittedAt) || store.editedMoveKeys().some((k) => store.editedMove(k).submittedAt)

// --- Start ----------------------------------------------------------------

function setDetailsOpen(on) {
  state.detailsOpen = on
  const view = $('view')
  const panel = $('details-panel')
  const bar = document.querySelector('.stage-bar')
  if (!panel) return
  if (on) {
    view.hidden = true
    if (bar) bar.hidden = true
    panel.hidden = false
    renderDetailsPanel()
  } else {
    panel.hidden = true
    panel.innerHTML = ''
    view.hidden = false
    if (bar) bar.hidden = false
    resize()
  }
}

function renderDetailsPanel() {
  const panel = $('details-panel')
  const id = state.selected
  const p = state.byId.get(id)
  if (!panel || !p) return
  const meta = store.poseMeta(id)
  const seed = catalogFieldsFromPose(p)
  panel.innerHTML = `
    <form id="details-form">
      <header class="meta-head" style="border:0;padding:0 0 0.5rem">
        <h2>${meta?.isNew ? 'New pose details' : 'Pose details'}</h2>
        <button type="button" id="details-cancel" class="linkish">Back to 3D</button>
      </header>
      ${detailsFieldsHtml(seed)}
      <div class="meta-actions">
        <button type="button" id="details-cancel-2">Cancel</button>
        <button type="submit" class="primary">Save details</button>
      </div>
    </form>`
  const form = panel.querySelector('#details-form')
  const close = () => setDetailsOpen(false)
  panel.querySelector('#details-cancel')?.addEventListener('click', close)
  panel.querySelector('#details-cancel-2')?.addEventListener('click', close)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (!form.reportValidity()) return
    const fields = readDetailsForm(form, { keepChineseName: seed.chineseName })
    if (!fields.name) return
    store.saveMeta(id, { fields, creditName: meta?.creditName || creditName(), isNew: meta?.isNew })
    if (meta?.isNew || p._draft) {
      p.name = fields.name || p.name
      p.sanskrit = fields.sanskrit || undefined
      p.altNames = fields.altNames || []
      p.category = fields.category || p.category
      p.difficulty = fields.intensity
      p.drishti = fields.drishti || undefined
      p._hay = haystack(p)
      renderList()
    }
    state.message = 'Details saved in this browser.'
    setDetailsOpen(false)
    renderInfo()
  })
}

function editDetails() {
  if (state.move) {
    state.message = 'Close the move editor before editing pose details.'
    return renderInfo()
  }
  setEditing(false)
  setDetailsOpen(true)
}

async function applyShape(shape) {
  if (!body || !state.selected || state.move) return
  const id = state.selected
  const base = await published(id)
  const before = store.editedPose(id)
  const stack = undo.get(id) || []
  stack.push(editSnap(before))
  undo.set(id, stack.slice(-50))
  applyPose(body, { ...base, ...shape })
  const settled = capturePose(body, base)
  store.savePose(id, settled)
  state.message = ''
  renderInfo()
  renderList()
  await refreshStage()
}

async function runPoseTool(tool) {
  if (!body || !state.selected || !tool) return
  if (tool === 'reset') {
    const id = state.selected
    const doc = await published(id)
    return applyShape({
      bones: clone(doc.bones),
      root: clone(doc.root || { head: [0, 0, 0] }),
      ...(Array.isArray(doc.props) ? { props: clone(doc.props) } : { props: [] }),
    })
  }
  const current = capturePose(body, await published(state.selected))
  if (tool === 'mirror') return applyShape(mirrorPoseDoc({ format: 'yoga-pose/1', pose: state.selected, ...current }))
  const sk = skeletonFromBody(body)
  const joint = editor.joint
  const side = joint?.endsWith('.L') ? 'L' : joint?.endsWith('.R') ? 'R' : undefined
  const doc = {
    format: 'yoga-pose/1',
    pose: state.selected,
    bones: current.bones,
    root: current.root,
    ...(Array.isArray(current.props) ? { props: current.props } : {}),
  }
  const next =
    tool === 'straighten'
      ? straightenLimb(doc, sk, joint)
      : tool === 'fixHips'
        ? fixHips(doc, sk)
        : tool === 'straightenSpine'
          ? straightenSpine(doc, sk)
          : tool === 'levelHips'
            ? levelHips(doc, sk)
            : symmetrizePose(doc, sk, side)
  if (next) await applyShape({ bones: next.bones, root: next.root })
}

async function start() {
  const [catalog, characters, styles, moves] = await Promise.all([
    json('catalog.json'),
    json('characters/index.json'),
    json('styles/index.json'),
    json('transitions.json').catch(() => ({ transitions: {} })),
  ])
  state.catalog = catalog.sort((a, b) => a.name.localeCompare(b.name))
  for (const p of state.catalog) {
    p._hay = haystack(p)
    state.byId.set(p.id, p)
  }
  for (const id of store.newPoseIds()) {
    const meta = store.poseMeta(id)
    if (meta?.fields) registerDraftPose(id, meta.fields)
  }
  state.moves = moves.transitions || {}
  state.characters = characters
  state.styles = styles
  const prefs = loadPrefs()
  state.character = characters.some((c) => c.id === prefs.character) ? prefs.character : characters[0].id
  state.style = styles.some((s) => s.id === prefs.style) ? prefs.style : styles[0]?.id || 'classic'
  state.bodyDetail = prefs.bodyDetail === 'high' ? 'high' : 'standard'
  $('pose-options').innerHTML = state.catalog.map((p) => `<option value="${esc(p.name)} (${p.id})"></option>`).join('')

  bindAuthBar($('auth'), () => renderInfo())
  renderCategories()
  renderList()
  renderInfo()
  bindInfo()

  const searchWrap = document.querySelector('.search-wrap')
  const openSearch = () => searchWrap?.classList.add('is-open')
  const closeSearchSoon = () => setTimeout(() => searchWrap?.classList.remove('is-open'), 150)
  $('q').addEventListener('input', () => {
    renderList()
    openSearch()
  })
  $('q').addEventListener('focus', openSearch)
  $('q').addEventListener('blur', closeSearchSoon)
  $('cats').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]')
    if (!b) return
    state.category = b.dataset.cat
    renderCategories()
    renderList()
  })
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]')
    if (b) {
      select(b.dataset.id)
      searchWrap?.classList.remove('is-open')
      $('q').blur()
    }
  })
  $('settings').addEventListener('click', () => void openSettings().then(() => renderInfo()))
  $('new-pose').addEventListener('click', () => void startNewPose())
  $('reset').addEventListener('click', frameBody)
  window.addEventListener('hashchange', () => void openFromHash())
  store.onEditsChange(() => {
    renderCategories()
    if (state.category === EDITED) renderList()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshSuggestions({ force: hasSubmitted() })
  })
  void refreshSuggestions()

  const [first] = hashTarget()
  state.selected = state.byId.has(first) ? first : state.byId.has('warrior-ii') ? 'warrior-ii' : state.catalog[0].id
  await setCharacter(state.character)
  await openFromHash()
}

/** `#<pose>` or `#<from>><to>` for a move. */
function hashTarget() {
  let h = location.hash.slice(1)
  try {
    h = decodeURIComponent(h)
  } catch {}
  return h.split('>')
}

async function openFromHash() {
  const [id, to] = hashTarget()
  if (!state.byId.has(id)) return select(state.selected, { push: false })
  if (to && state.move?.from === id && state.move?.to === to) return
  await select(id, { push: false })
  if (to) await openMove(id, to)
}

start().catch((e) => status(`Couldn't start the viewer (${e.message}).`))
