/**
 * Puts a yoga-pose/1 file on a body GLB built on the MakeHuman default rig.
 *
 * Pose rotations are armature-space deltas from the rest pose, expressed in the GLB's
 * `pose_frame` (metres, Z up, body facing -Y). Bones without a rotation follow their parent.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { applyLook, lookMaterial, resolveLook } from './look.js'

/** Rest axes further apart than this (radians) are bodies too different to correct between. */
const MAX_ALIGN = 1.05

const qFrom = (a) => new THREE.Quaternion(a[1], a[2], a[3], a[0]).normalize()
const round = (v, n = 5) => Math.round(v * 10 ** n) / 10 ** n
const qTo = (q) => {
  const s = q.w < 0 ? -1 : 1
  return [round(s * q.w), round(s * q.x), round(s * q.y), round(s * q.z)]
}

/** The rest-axis correction applyPose adds for bone `n`, or null when there is none. */
function correction(body, n, axes) {
  const ax = axes && axes[n]
  if (!ax) return null
  const src = new THREE.Vector3(...ax).normalize()
  if (body.restAxis[n].angleTo(src) >= MAX_ALIGN) return null
  return new THREE.Quaternion().setFromUnitVectors(body.restAxis[n], src)
}

function framed(body, obj) {
  body.frame.updateMatrixWorld(true)
  return new THREE.Matrix4().copy(body.frame.matrixWorld).invert().multiply(obj.matrixWorld)
}

/**
 * Load a body GLB. COLOR_0 stays as wardrobe-region markers; colours and costumes are applied
 * later with `setBodyLook` (look.js shader).
 */
export async function loadBody(url) {
  const gltf = await new GLTFLoader().loadAsync(url)
  const root = gltf.scene
  const frame = root.getObjectByName('pose_frame')
  const bones = {}
  let mesh = null
  root.traverse((o) => {
    if (o.isBone) {
      // GLTFLoader strips "." from node names; pose files use MakeHuman names ("upperarm01.L").
      const assoc = gltf.parser.associations.get(o)
      if (assoc && assoc.nodes !== undefined) o.name = gltf.parser.json.nodes[assoc.nodes].name
      bones[o.name] = o
    }
    if (o.isSkinnedMesh && !mesh) mesh = o
  })
  if (!frame || !mesh || !bones.root) throw new Error('This body has no pose_frame, skinned mesh or root bone')
  const { material, uniforms } = lookMaterial()
  uniforms.uRestMatrix.value.compose(mesh.position, mesh.quaternion, mesh.scale)
  mesh.material = material
  mesh.castShadow = true
  mesh.frustumCulled = false
  root.updateMatrixWorld(true)

  const order = []
  ;(function walk(b) {
    order.push(b.name)
    for (const c of b.children) if (c.isBone) walk(c)
  })(bones.root)

  const body = { root, frame, mesh, bones, order, restQ: {}, restAxis: {}, restPos: {}, uniforms }
  for (const n of order) {
    const q = new THREE.Quaternion()
    framed(body, bones[n]).decompose(new THREE.Vector3(), q, new THREE.Vector3())
    body.restQ[n] = q
    body.restAxis[n] = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize()
    body.restPos[n] = bones[n].position.clone()
  }
  return body
}

/** Apply a costume style over a character palette (live, no reload). */
export function setBodyLook(body, style, palette) {
  if (!body?.uniforms) return
  applyLook(body.uniforms, resolveLook(style, palette))
}

/** Poses the body and stands it on the floor (z = 0 in the pose frame). */
export function applyPose(body, doc) {
  const bones = doc.bones || {}
  const axes = doc.restAxes || {}
  const delta = {}
  const posed = {}
  for (const n of body.order) {
    const b = body.bones[n]
    const parent = b.parent && b.parent.isBone ? b.parent.name : null
    let d
    if (bones[n]) {
      d = qFrom(bones[n])
      const corr = correction(body, n, axes)
      if (corr) d.multiply(corr)
    } else {
      d = parent ? delta[parent].clone() : new THREE.Quaternion()
    }
    delta[n] = d
    posed[n] = d.clone().multiply(body.restQ[n])
    const parentPosed = parent ? posed[parent] : new THREE.Quaternion()
    b.quaternion.copy(parentPosed.clone().invert().multiply(posed[n]))
    b.position.copy(body.restPos[n])
  }
  const head = doc.root && doc.root.head
  if (head) body.bones.root.position.set(...head)
  body.root.updateMatrixWorld(true)
  body.bones.root.position.z -= lowestZ(body)
  body.root.updateMatrixWorld(true)
}

/**
 * The body's current shape as pose data, the inverse of applyPose. `base` supplies the rest axes to
 * undo (so the result plays back the same on every body) and bone names to always write, so the
 * result can be compared bone by bone with `base`. Other bones are written only where they differ
 * from their parent, because a missing bone follows its parent.
 */
export function capturePose(body, base = {}, keep = Object.keys(base.bones || {})) {
  body.root.updateMatrixWorld(true)
  const always = new Set(keep)
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const delta = {}
  const bones = {}
  for (const n of body.order) {
    framed(body, body.bones[n]).decompose(pos, q, scl)
    const d = q.clone().multiply(body.restQ[n].clone().invert()).normalize()
    delta[n] = d
    const parent = body.bones[n].parent
    const inherited = parent && parent.isBone ? delta[parent.name] : null
    if (always.has(n) || !inherited || Math.abs(inherited.dot(d)) < 1 - 1e-9) {
      const corr = correction(body, n, base.restAxes)
      bones[n] = qTo(corr ? d.clone().multiply(corr.invert()) : d)
    }
  }
  const p = body.bones.root.position
  return { bones, root: { head: [round(p.x, 6), round(p.y, 6), round(p.z, 6)] } }
}

function lowestZ(body) {
  const { mesh, frame } = body
  const pos = mesh.geometry.getAttribute('position')
  const inv = new THREE.Matrix4().copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld)
  const v = new THREE.Vector3()
  mesh.skeleton.update()
  let lo = Infinity
  for (let i = 0; i < pos.count; i++) {
    mesh.getVertexPosition(i, v)
    v.applyMatrix4(inv)
    if (v.z < lo) lo = v.z
  }
  return lo
}

/** World-space bounds of the posed body. */
export function bodyBounds(body) {
  const { mesh } = body
  const pos = mesh.geometry.getAttribute('position')
  const box = new THREE.Box3()
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i += 4) {
    mesh.getVertexPosition(i, v)
    box.expandByPoint(v.applyMatrix4(mesh.matrixWorld))
  }
  return box
}
