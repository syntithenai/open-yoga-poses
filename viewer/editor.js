/**
 * Joint editing: a dot on each editable joint and a rotate gizmo on the selected one. Turning a joint turns
 * everything below it. Prop editing (chair/block/wall) shares the same gizmo in move/turn modes.
 * `onEnd` runs when a drag finishes, so the caller can save the new shape.
 * Joint list matches the pose-review Anny editor (`ANNY_GROUPS`), minus pelvis-tilt.
 */
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import {
  bodyBackY,
  makeProp,
  pelvisLocal,
  propGroupAt,
  propHit,
  setBodyProps,
  syncPropFromGroup,
} from './props.js'

export const JOINTS = [
  ['root', 'Whole body'],
  ['spine05', 'Lumbar'],
  ['spine04', 'Mid-low back'],
  ['spine03', 'Upper back'],
  ['spine02', 'Mid-upper back'],
  ['spine01', 'Chest'],
  ['neck01', 'Neck'],
  ['neck02', 'Neck mid'],
  ['neck03', 'Neck upper'],
  ['head', 'Head'],
  ['clavicle.L', 'Left collarbone'],
  ['shoulder01.L', 'Left shoulder pad'],
  ['upperarm01.L', 'Left shoulder'],
  ['upperarm02.L', 'Left upper arm'],
  ['lowerarm01.L', 'Left elbow'],
  ['lowerarm02.L', 'Left forearm'],
  ['wrist.L', 'Left wrist'],
  ['clavicle.R', 'Right collarbone'],
  ['shoulder01.R', 'Right shoulder pad'],
  ['upperarm01.R', 'Right shoulder'],
  ['upperarm02.R', 'Right upper arm'],
  ['lowerarm01.R', 'Right elbow'],
  ['lowerarm02.R', 'Right forearm'],
  ['wrist.R', 'Right wrist'],
  ['upperleg01.L', 'Left hip'],
  ['upperleg02.L', 'Left thigh'],
  ['lowerleg01.L', 'Left knee'],
  ['lowerleg02.L', 'Left shin'],
  ['foot.L', 'Left ankle'],
  ['toes.L', 'Left toes'],
  ['upperleg01.R', 'Right hip'],
  ['upperleg02.R', 'Right thigh'],
  ['lowerleg01.R', 'Right knee'],
  ['lowerleg02.R', 'Right shin'],
  ['foot.R', 'Right ankle'],
  ['toes.R', 'Right toes'],
  ['pelvis.L', 'Left pelvis'],
  ['pelvis.R', 'Right pelvis'],
]

const TOES_RE = /^toes\.([LR])$/
const TOE_X = new THREE.Vector3(1, 0, 0)

export const jointBone = (joint) => {
  const m = TOES_RE.exec(joint || '')
  return m ? `toe3-1.${m[1]}` : joint
}

function restLocal(body, b) {
  const p = b.parent
  if (!p || !p.isBone) return body.restQ[b.name].clone()
  return body.restQ[p.name].clone().invert().multiply(body.restQ[b.name])
}

function twistOf(q, axis) {
  const d = q.x * axis.x + q.y * axis.y + q.z * axis.z
  const t = new THREE.Quaternion(axis.x * d, axis.y * d, axis.z * d, q.w)
  return t.lengthSq() < 1e-12 ? new THREE.Quaternion() : t.normalize()
}

function toeBend(body, side) {
  const b = body.bones[`toe3-1.${side}`]
  if (!b) return 0
  const t = twistOf(restLocal(body, b).invert().multiply(b.quaternion), TOE_X)
  return 2 * Math.atan2(t.x, t.w)
}

function setToeBend(body, side, ang) {
  const mid = body.bones[`toe3-1.${side}`]
  if (!mid) return
  const axis = TOE_X.clone().applyQuaternion(restLocal(body, mid))
  const g = new THREE.Quaternion().setFromAxisAngle(axis, ang)
  for (let t = 1; t <= 5; t++) {
    for (let j = 1; j <= 3; j++) {
      const b = body.bones[`toe${t}-${j}.${side}`]
      if (!b || !b.parent || !b.parent.isBone) continue
      const rest = restLocal(body, b)
      b.quaternion.copy(
        j > 1
          ? rest
          : b.parent === mid.parent
            ? g.clone().multiply(rest)
            : rest.multiply(new THREE.Quaternion().setFromAxisAngle(TOE_X, ang)),
      )
    }
  }
  body.frame?.updateMatrixWorld(true)
}

function syncToeBend(body, joint) {
  const m = TOES_RE.exec(joint || '')
  if (!m || !body) return
  setToeBend(body, m[1], toeBend(body, m[1]))
}

export function createEditor({ scene, camera, renderer, controls, onStart, onEnd, onSelect, onPropSelect }) {
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
  tc.addEventListener('objectChange', () => {
    if (propMode != null && propSel >= 0 && body) {
      const g = propGroupAt(body, propSel)
      const p = body.propList?.[propSel]
      if (g && p) syncPropFromGroup(p, g)
      return
    }
    if (joint) syncToeBend(body, joint)
  })

  const geo = new THREE.SphereGeometry(1, 14, 10)
  const mat = new THREE.MeshBasicMaterial({ color: 0x2f9fd8, depthTest: false, transparent: true, opacity: 0.85 })
  const selMat = new THREE.MeshBasicMaterial({ color: 0xffb020, depthTest: false, transparent: true, opacity: 0.95 })
  let handles = []
  let body = null
  let joint = null
  let propSel = -1
  let propMode = null
  let on = false

  function attach() {
    if (propMode != null && propSel >= 0 && body) {
      const g = propGroupAt(body, propSel)
      for (const h of handles) h.material = mat
      if (g) {
        tc.setSpace('local')
        tc.showE = false
        if (propMode === 'turn') {
          tc.setMode('rotate')
          tc.showX = false
          tc.showY = false
          tc.showZ = true
        } else {
          tc.setMode('translate')
          tc.showX = true
          tc.showY = true
          tc.showZ = body.propList[propSel]?.type === 'block'
        }
        tc.attach(g)
      } else tc.detach()
      return
    }
    tc.setMode('rotate')
    tc.showX = true
    tc.showY = true
    tc.showZ = true
    for (const h of handles) h.material = h.userData.joint === joint ? selMat : mat
    const bone = on && joint && body ? body.bones[jointBone(joint)] : null
    tc.setSpace(joint === 'root' ? 'world' : 'local')
    tc.showE = !!bone && joint !== 'root'
    if (bone) tc.attach(bone)
    else tc.detach()
  }

  function setBody(next) {
    for (const h of handles) h.removeFromParent()
    handles = []
    body = next
    propSel = -1
    propMode = null
    const ws = new THREE.Vector3()
    for (const [n] of JOINTS) {
      const bone = body.bones[jointBone(n)]
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
    if (!value) {
      controls.enabled = true
      propSel = -1
      propMode = null
    }
    attach()
  }

  function select(name) {
    joint = name && body?.bones[jointBone(name)] ? name : null
    if (joint) {
      propSel = -1
      propMode = null
    }
    attach()
    onSelect?.(joint)
  }

  function selectProp(index, mode) {
    if (!body || !propGroupAt(body, index)) return
    propSel = index
    propMode = mode
    joint = null
    attach()
    onSelect?.(null)
    onPropSelect?.(propSel, propMode)
  }

  function clearPropSelection() {
    if (propMode == null) return
    propSel = -1
    propMode = null
    attach()
    onPropSelect?.(null, null)
  }

  function rebuildProps() {
    const mode = propMode
    const sel = propSel
    if (mode) tc.detach()
    setBodyProps(body, body.propList)
    if (mode && propGroupAt(body, sel)) {
      propSel = sel
      propMode = mode
      attach()
    } else {
      propSel = -1
      propMode = null
    }
  }

  function addProp(type) {
    if (!body) return
    if (type === 'chair' && body.propList.some((p) => p.type === 'chair')) return
    if (type === 'wall' && body.propList.some((p) => p.type === 'wall')) return
    const at = pelvisLocal(body)
    const next = makeProp(type, at, {
      blockCount: body.propList.filter((p) => p.type === 'block').length,
      bodyBackY: type === 'wall' ? bodyBackY(body) : undefined,
    })
    body.propList = [...body.propList, next]
    propSel = body.propList.length - 1
    propMode = 'move'
    joint = null
    rebuildProps()
    onSelect?.(null)
    onPropSelect?.(propSel, propMode)
  }

  function removeProp(index) {
    if (!body || index < 0 || index >= body.propList.length) return
    body.propList = body.propList.filter((_, i) => i !== index)
    if (propSel === index) {
      propSel = -1
      propMode = null
      tc.detach()
    } else if (propSel > index) propSel -= 1
    rebuildProps()
    onPropSelect?.(propMode ? propSel : null, propMode)
  }

  function setChairSize(index, key, value) {
    const p = body?.propList[index]
    if (!p || p.type !== 'chair') return
    if (key === 'seat') p.seat[2] = value
    else p.size = { ...(p.size || { w: 0.46, d: 0.42 }), back: value }
    p.manual = true
    rebuildProps()
  }

  function setBlockStand(index, stand, stands) {
    const p = body?.propList[index]
    if (!p || p.type !== 'block' || !stands[stand]) return
    p.size = [...stands[stand].size]
    p.manual = true
    rebuildProps()
  }

  // A click (not an orbit drag) on a joint dot or prop selects it.
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
    if (hit) return select(hit.object.userData.joint)
    const i = propHit(body, ray)
    if (i >= 0) selectProp(i, i === propSel && propMode ? propMode : 'move')
  })

  return {
    setBody,
    setEnabled,
    select,
    selectProp,
    clearPropSelection,
    addProp,
    removeProp,
    setChairSize,
    setBlockStand,
    rebuildProps,
    get enabled() {
      return on
    },
    get joint() {
      return joint
    },
    get propSel() {
      return propSel
    },
    get propMode() {
      return propMode
    },
    get dragging() {
      return tc.dragging
    },
  }
}
