/**
 * Procedural chairs, blocks and walls from yoga-pose/1 `props`.
 * Kept in step with scripts/yoga_book_props3d.js and packages/pose3d/src/pose3dProps.ts.
 */
import * as THREE from 'three'

const WOOD = 0x9a6b43
const CORK = 0xc9a56e
const WALL = 0xd9d6cf

export const BLOCK_STANDS = {
  low: { label: 'Flat', size: [0.23, 0.15, 0.075] },
  mid: { label: 'On side', size: [0.23, 0.075, 0.15] },
  tall: { label: 'On end', size: [0.15, 0.075, 0.23] },
}
export const WALL_SIZE = { w: 2.4, h: 2.4, t: 0.1 }
export const DEFAULT_CHAIR_SIZE = { w: 0.46, d: 0.42, back: 0.42 }
export const PROP_LABEL = { chair: 'Chair', block: 'Block', wall: 'Wall' }

const r4 = (v) => Math.round(v * 1e4) / 1e4

function buildChair(p, material) {
  const { w, d, back } = p.size || DEFAULT_CHAIR_SIZE
  const [x, y, z] = p.seat
  const mat = material || new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.6 })
  const g = new THREE.Group()
  g.name = 'prop:chair'
  const box = (sx, sy, sz, cx, cy, cz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
    m.position.set(cx, cy, cz)
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
  }
  const t = 0.04
  const leg = 0.035
  const rail = Math.min(0.18, back * 0.45)
  box(w, d, t, 0, 0, z - t / 2)
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) box(leg, leg, z - t, sx * (w / 2 - leg / 2), sy * (d / 2 - leg / 2), (z - t) / 2)
    box(leg, leg, back, sx * (w / 2 - leg / 2), d / 2 - leg / 2, z + back / 2)
  }
  box(w, 0.025, rail, 0, d / 2 - leg / 2, z + back - rail / 2)
  g.rotation.z = p.yaw
  g.position.set(x, y, 0)
  return g
}

function buildBlock(p, material) {
  const [sx, sy, sz] = p.size || BLOCK_STANDS.low.size
  const mat = material || new THREE.MeshStandardMaterial({ color: CORK, roughness: 0.85 })
  const g = new THREE.Group()
  g.name = 'prop:block'
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat)
  m.position.set(0, 0, sz / 2)
  m.castShadow = true
  m.receiveShadow = true
  g.add(m)
  g.rotation.z = p.yaw || 0
  g.position.set(p.at[0], p.at[1], p.at[2])
  return g
}

function buildWall(p, material) {
  const { w, h, t } = { ...WALL_SIZE, ...(p.size || {}) }
  const mat = material || new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.95 })
  const g = new THREE.Group()
  g.name = 'prop:wall'
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, t, h), mat)
  m.position.set(0, t / 2, h / 2)
  m.receiveShadow = true
  g.add(m)
  g.rotation.z = p.yaw || 0
  g.position.set(p.at[0], p.at[1], 0)
  return g
}

const BUILDERS = { chair: buildChair, block: buildBlock, wall: buildWall }

export function cloneProps(props) {
  return props?.length ? JSON.parse(JSON.stringify(props)) : []
}

/** Replace the props hung under body.frame. */
export function setBodyProps(body, list) {
  if (body.propGroup) {
    body.propGroup.traverse((o) => o.isMesh && o.geometry.dispose())
    body.propGroup.removeFromParent()
    body.propGroup = null
  }
  body.propList = cloneProps(list)
  const g = new THREE.Group()
  g.name = 'props'
  body.propList.forEach((p, i) => {
    const build = BUILDERS[p.type]
    if (!build) return
    const m = build(p)
    m.userData.propIndex = i
    g.add(m)
  })
  body.frame.add(g)
  body.propGroup = g
  return g
}

export function propGroupAt(body, i) {
  return body?.propGroup?.children.find((g) => g.userData.propIndex === i) || null
}

export function propHit(body, ray) {
  if (!body?.propGroup) return -1
  const hit = ray.intersectObject(body.propGroup, true)[0]
  let o = hit && hit.object
  while (o && o.userData.propIndex === undefined) o = o.parent
  return o ? o.userData.propIndex : -1
}

export function blockStandOf(p) {
  const key = (v) => (v || []).map((x) => Math.round(x * 1000)).join()
  const want = key(p.size)
  return Object.keys(BLOCK_STANDS).find((k) => key(BLOCK_STANDS[k].size) === want) || 'low'
}

export function syncPropFromGroup(p, g) {
  if (g.position.z < 0) g.position.z = 0
  if (p.type === 'chair') {
    p.seat[0] = r4(g.position.x)
    p.seat[1] = r4(g.position.y)
  } else {
    p.at = [r4(g.position.x), r4(g.position.y), p.type === 'block' ? r4(g.position.z) : 0]
  }
  p.yaw = r4(g.rotation.z)
  p.manual = true
}

export function makeProp(type, at, { blockCount = 0, bodyBackY } = {}) {
  if (type === 'chair') {
    return {
      type: 'chair',
      seat: [r4(at.x), r4(at.y), 0.46],
      yaw: 0,
      size: { ...DEFAULT_CHAIR_SIZE },
      manual: true,
    }
  }
  if (type === 'block') {
    const dx = Math.ceil(blockCount / 2) * 0.3 * (blockCount % 2 ? -1 : 1)
    return {
      type: 'block',
      at: [r4(at.x + dx), r4(at.y - 0.3), 0],
      yaw: 0,
      size: [...BLOCK_STANDS.low.size],
      manual: true,
    }
  }
  const back = bodyBackY ?? at.y + 0.35
  return {
    type: 'wall',
    at: [r4(at.x), r4(back + 0.01), 0],
    yaw: 0,
    size: { ...WALL_SIZE },
    manual: true,
  }
}

/** Furthest +Y of floor meshes in the pose frame. */
export function bodyBackY(body) {
  body.root.updateMatrixWorld(true)
  const inv = new THREE.Matrix4()
  const v = new THREE.Vector3()
  let back = -Infinity
  const meshes = body.floorParts?.length ? body.floorParts : [body.mesh]
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position')
    if (!pos) continue
    inv.copy(body.frame.matrixWorld).invert().multiply(mesh.matrixWorld)
    mesh.skeleton?.update()
    for (let i = 0; i < pos.count; i += 8) {
      mesh.getVertexPosition(i, v)
      v.applyMatrix4(inv)
      if (v.y > back) back = v.y
    }
  }
  return Number.isFinite(back) ? back : 0.35
}

export function pelvisLocal(body) {
  body.root.updateMatrixWorld(true)
  const bone = body.bones['pelvis.L'] || body.bones.root
  const world = bone.getWorldPosition(new THREE.Vector3())
  return body.frame.worldToLocal(world)
}
