/**
 * Puts a yoga-pose/1 file on a body GLB built on the MakeHuman default rig.
 *
 * Pose rotations are armature-space deltas from the rest pose, expressed in the GLB's
 * `pose_frame` (metres, Z up, body facing -Y). Bones without a rotation follow their parent.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/** Rest axes further apart than this (radians) are bodies too different to correct between. */
const MAX_ALIGN = 1.05

const qFrom = (a) => new THREE.Quaternion(a[1], a[2], a[3], a[0]).normalize()

function framed(body, obj) {
  body.frame.updateMatrixWorld(true)
  return new THREE.Matrix4().copy(body.frame.matrixWorld).invert().multiply(obj.matrixWorld)
}

/**
 * The body GLB marks wardrobe regions in COLOR_0 (r top, g bottom, b hair; alpha < 0.5 accent).
 * Bake the palette into plain vertex colours.
 */
function paint(mesh, palette) {
  const src = mesh.geometry.getAttribute('color')
  if (!src) return
  const rgb = (c) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace)
  const skin = rgb(palette.skin)
  const top = rgb(palette.top)
  const bottom = rgb(palette.bottom)
  const hair = rgb(palette.hair)
  const out = new Float32Array(src.count * 3)
  for (let i = 0; i < src.count; i++) {
    let c = skin
    if (src.getY(i) > 0.5) c = bottom
    if (src.getX(i) > 0.5) c = top
    if (src.getZ(i) > 0.5) c = hair
    if (src.itemSize === 4 && src.getW(i) < 0.5) c = top
    out[i * 3] = c.r
    out[i * 3 + 1] = c.g
    out[i * 3 + 2] = c.b
  }
  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(out, 3))
}

export async function loadBody(url, palette) {
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
  if (palette) paint(mesh, palette)
  mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 })
  mesh.castShadow = true
  mesh.frustumCulled = false
  root.updateMatrixWorld(true)

  const order = []
  ;(function walk(b) {
    order.push(b.name)
    for (const c of b.children) if (c.isBone) walk(c)
  })(bones.root)

  const body = { root, frame, mesh, bones, order, restQ: {}, restAxis: {}, restPos: {} }
  for (const n of order) {
    const q = new THREE.Quaternion()
    framed(body, bones[n]).decompose(new THREE.Vector3(), q, new THREE.Vector3())
    body.restQ[n] = q
    body.restAxis[n] = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize()
    body.restPos[n] = bones[n].position.clone()
  }
  return body
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
      const ax = axes[n]
      if (ax) {
        const src = new THREE.Vector3(...ax).normalize()
        if (body.restAxis[n].angleTo(src) < MAX_ALIGN) {
          d.multiply(new THREE.Quaternion().setFromUnitVectors(body.restAxis[n], src))
        }
      }
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
