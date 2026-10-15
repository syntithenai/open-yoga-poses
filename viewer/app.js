import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { applyPose, bodyBounds, loadBody } from './pose.js'

const REPO = 'https://github.com/syntithenai/open-yoga-poses'
const CATEGORY_LABELS = {
  standing: 'Standing',
  floor: 'Floor',
  'arm-balance': 'Arm balance',
  inversion: 'Inversion',
  chair: 'Chair',
  breath: 'Breath',
  transition: 'Transition',
}
const ROLE_LABELS = { stretch: 'Stretches', contract: 'Works', stabilise: 'Stabilises' }
const LEVEL_WORDS = ['', 'light', 'moderate', 'strong']
const SIDE_WORDS = { L: 'left', R: 'right', both: '' }

const $ = (id) => document.getElementById(id)
const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const muscleName = (id) => id.replace(/_/g, ' ')
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const state = { catalog: [], muscles: {}, characters: [], category: '', selected: '', character: '' }
const poseCache = new Map()

async function json(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

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
let floor = null

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

async function setCharacter(id) {
  const c = state.characters.find((x) => x.id === id) || state.characters[0]
  state.character = c.id
  status('Loading body…')
  const next = await loadBody(`characters/${c.file}`, c.palette)
  if (body) scene.remove(body.root)
  body = next
  scene.add(body.root)
  floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.MeshStandardMaterial({ color: 0xead7bd, roughness: 1 }))
  floor.receiveShadow = true
  floor.position.z = -0.001
  body.frame.add(floor)
  if (state.selected) await showPose(state.selected)
  else status('')
}

async function loadPose(id) {
  if (!poseCache.has(id)) poseCache.set(id, json(`poses/${id}.json`))
  return poseCache.get(id)
}

async function showPose(id) {
  if (!body) return
  status('Loading pose…')
  try {
    applyPose(body, await loadPose(id))
    frameBody()
    status('')
  } catch (e) {
    status(`Couldn't load this pose (${e.message}).`)
  }
}

function status(text) {
  $('status').textContent = text
  $('status').hidden = !text
}

renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
})

// --- Search and list ------------------------------------------------------

function haystack(p) {
  const ms = (state.muscles[p.id]?.muscles || []).map((m) => muscleName(m.id))
  return fold([p.id, p.name, p.sanskrit, ...(p.altNames || []), CATEGORY_LABELS[p.category], ...(p.tags || []), ...p.muscles, ...ms].join(' '))
}

function filtered() {
  const tokens = fold($('q').value).split(/\s+/).filter(Boolean)
  return state.catalog.filter(
    (p) => (!state.category || p.category === state.category) && tokens.every((t) => p._hay.includes(t)),
  )
}

function renderList() {
  const items = filtered()
  $('count').textContent = `${items.length} of ${state.catalog.length} poses`
  $('list').innerHTML = items
    .map(
      (p) =>
        `<li><button type="button" data-id="${p.id}" aria-current="${p.id === state.selected}">${esc(p.name)}${p.sanskrit ? `<small>${esc(p.sanskrit)}</small>` : ''}</button></li>`,
    )
    .join('')
}

function renderCategories() {
  const cats = [...new Set(state.catalog.map((p) => p.category))]
  $('cats').innerHTML = ['', ...cats]
    .map((c) => `<button type="button" data-cat="${c}" aria-pressed="${c === state.category}">${c ? CATEGORY_LABELS[c] || c : 'All'}</button>`)
    .join('')
}

// --- Pose details ---------------------------------------------------------

function issueUrl(p) {
  const q = new URLSearchParams({ template: 'pose-correction.yml', title: `Pose correction: ${p.id}`, pose: p.id })
  return `${REPO}/issues/new?${q}`
}

function renderInfo() {
  const p = state.catalog.find((x) => x.id === state.selected)
  if (!p) {
    $('info').innerHTML = '<p class="muted">Pick a pose to see it in 3D.</p>'
    return
  }
  const entry = state.muscles[p.id]
  const byRole = {}
  for (const m of entry?.muscles || []) (byRole[m.role] ||= []).push(m)
  const muscleLists = Object.entries(ROLE_LABELS)
    .filter(([role]) => byRole[role])
    .map(([role, label]) => {
      const items = byRole[role]
        .sort((a, b) => b.level - a.level)
        .map((m) => `<li>${esc(muscleName(m.id))}${SIDE_WORDS[m.side] ? `, ${SIDE_WORDS[m.side]}` : ''} <span class="muted">(${LEVEL_WORDS[m.level] || m.level})</span></li>`)
        .join('')
      return `<h3>${label}</h3><ul>${items}</ul>`
    })
    .join('')
  const c = state.characters.find((x) => x.id === state.character) || state.characters[0]
  $('info').innerHTML = `
    <h2>${esc(p.name)}</h2>
    ${p.sanskrit ? `<p class="sanskrit">${esc(p.sanskrit)}</p>` : ''}
    <p class="muted"><code>${p.id}</code> · ${esc(CATEGORY_LABELS[p.category] || p.category)}${p.difficulty ? ` · difficulty ${p.difficulty} of 5` : ''}</p>
    ${p.altNames?.length ? `<p class="muted">Also called ${p.altNames.map(esc).join(', ')}</p>` : ''}
    ${p.drishti ? `<p>Gaze: ${esc(p.drishti)}</p>` : ''}
    <div class="actions">
      <a class="primary" href="${issueUrl(p)}" target="_blank" rel="noopener">Suggest a fix</a>
      <a href="poses/${p.id}.json" download>Download pose</a>
      <a href="characters/${c.file}" download>Download body</a>
      <button type="button" id="copy">Copy link</button>
    </div>
    ${muscleLists || '<p class="muted">No muscle data yet.</p>'}
    ${entry && !entry.reviewed ? `<p class="note">These muscles were drafted automatically and haven't been checked by a person yet. If you know this pose, <a href="${REPO}/blob/main/CONTRIBUTING.md">help review them</a>.</p>` : ''}
    <p class="muted"><a href="${REPO}/blob/main/poses/${p.id}.json">Pose file on GitHub</a> · <a href="${REPO}/commits/main/poses/${p.id}.json">History and contributors</a></p>
  `
  $('copy').onclick = async () => {
    await navigator.clipboard?.writeText(location.href)
    $('copy').textContent = 'Link copied'
  }
}

async function select(id, { push = true } = {}) {
  if (!state.catalog.some((p) => p.id === id)) return
  state.selected = id
  if (push && location.hash.slice(1) !== id) history.replaceState(null, '', `#${id}`)
  const p = state.catalog.find((x) => x.id === id)
  document.title = `${p.name} · Open Yoga Poses`
  renderList()
  renderInfo()
  await showPose(id)
}

// --- Start ----------------------------------------------------------------

async function start() {
  const [catalog, muscles, characters] = await Promise.all([json('catalog.json'), json('muscles.json'), json('characters/index.json')])
  state.muscles = muscles.poses || {}
  state.catalog = catalog.sort((a, b) => a.name.localeCompare(b.name))
  for (const p of state.catalog) p._hay = haystack(p)
  state.characters = characters
  $('character').innerHTML = characters.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join('')

  renderCategories()
  renderList()
  renderInfo()

  $('q').addEventListener('input', renderList)
  $('cats').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cat]')
    if (!b) return
    state.category = b.dataset.cat
    renderCategories()
    renderList()
  })
  $('list').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-id]')
    if (b) select(b.dataset.id)
  })
  $('character').addEventListener('change', async (e) => {
    await setCharacter(e.target.value)
    renderInfo()
  })
  $('reset').addEventListener('click', frameBody)
  window.addEventListener('hashchange', () => select(location.hash.slice(1), { push: false }))

  const first = location.hash.slice(1)
  state.selected = state.catalog.some((p) => p.id === first) ? first : state.catalog.some((p) => p.id === 'warrior-ii') ? 'warrior-ii' : state.catalog[0].id
  await setCharacter(characters[0].id)
  await select(state.selected, { push: false })
}

start().catch((e) => status(`Couldn't start the viewer (${e.message}).`))
