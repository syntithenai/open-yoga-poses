/**
 * Joint editing: a dot on each main joint and a rotate gizmo on the selected one. Turning a joint turns
 * everything below it. `onEnd` runs when a drag finishes, so the caller can save the new shape.
 */
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'

export const JOINTS = [
  ['root', 'Whole body'],
  ['spine01', 'Lower back'],
  ['spine03', 'Upper back'],
  ['neck01', 'Neck'],
  ['head', 'Head'],
  ['clavicle.L', 'Left shoulder blade'],
  ['upperarm01.L', 'Left shoulder'],
  ['lowerarm01.L', 'Left elbow'],
  ['wrist.L', 'Left wrist'],
  ['clavicle.R', 'Right shoulder blade'],
  ['upperarm01.R', 'Right shoulder'],
  ['lowerarm01.R', 'Right elbow'],
  ['wrist.R', 'Right wrist'],
  ['upperleg01.L', 'Left hip'],
  ['lowerleg01.L', 'Left knee'],
  ['foot.L', 'Left ankle'],
  ['upperleg01.R', 'Right hip'],
  ['lowerleg01.R', 'Right knee'],
  ['foot.R', 'Right ankle'],
]

export function createEditor({ scene, camera, renderer, controls, onStart, onEnd, onSelect }) {
  const tc = new TransformControls(camera, renderer.domElement)
  tc.setMode('rotate')
  tc.setSize(0.75)
  // The free trackball at the gizmo's centre tumbles about every axis at once and hides the joint dot.
  tc.showXYZE = false
  tc.enabled = false
  const helper = tc.getHelper()
  helper.traverse((o) => {
    o.renderOrder = 30
  })
  scene.add(helper)
  tc.addEventListener('dragging-changed', (e) => {
    controls.enabled = !e.value
    if (e.value) onStart?.()
    else onEnd?.()
  })

  const geo = new THREE.SphereGeometry(1, 14, 10)
  const mat = new THREE.MeshBasicMaterial({ color: 0x2f9fd8, depthTest: false, transparent: true, opacity: 0.85 })
  const selMat = new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false, transparent: true, opacity: 0.95 })
  let handles = []
  let body = null
  let joint = null
  let on = false

  function attach() {
    for (const h of handles) h.material = h.userData.joint === joint ? selMat : mat
    const bone = on && joint && body ? body.bones[joint] : null
    tc.setSpace(joint === 'root' ? 'world' : 'local')
    if (bone) tc.attach(bone)
    else tc.detach()
  }

  function setBody(next) {
    for (const h of handles) h.removeFromParent()
    handles = []
    body = next
    const ws = new THREE.Vector3()
    for (const [n] of JOINTS) {
      const bone = body.bones[n]
      if (!bone) continue
      const h = new THREE.Mesh(geo, mat)
      h.userData.joint = n
      h.renderOrder = 20
      bone.add(h)
      bone.getWorldScale(ws)
      h.scale.setScalar((n === 'root' ? 0.03 : 0.02) / Math.max(1e-6, ws.x))
      h.visible = on
      handles.push(h)
    }
    attach()
  }

  function setEnabled(value) {
    on = value
    tc.enabled = value
    for (const h of handles) h.visible = value
    if (!value) controls.enabled = true
    attach()
  }

  function select(name) {
    joint = name && body?.bones[name] ? name : null
    attach()
    onSelect?.(joint)
  }

  // A click (not an orbit drag) on a joint dot selects it.
  let down = null
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY }
  })
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!on || !down || tc.dragging) return
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
    down = null
    if (moved > 5) return
    const r = renderer.domElement.getBoundingClientRect()
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, camera)
    body.root.updateMatrixWorld(true)
    const hit = ray.intersectObjects(handles, false)[0]
    if (hit) select(hit.object.userData.joint)
  })

  return {
    setBody,
    setEnabled,
    select,
    get enabled() {
      return on
    },
    get joint() {
      return joint
    },
    get dragging() {
      return tc.dragging
    },
  }
}
