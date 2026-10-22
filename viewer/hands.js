/**
 * Hand-shape presets (same as the pose-review editor and the SynthYoga app).
 * Bakes into finger/metacarpal bone quaternions — no handShape field on disk.
 */
import * as THREE from 'three'

const fingers = (f, z) =>
  Object.fromEntries(
    [2, 3, 4, 5].flatMap((k, i) => {
      const fl = Array.isArray(f[0]) ? f[i] : f
      return [
        [`finger${k}-1`, [fl[0], z[i]]],
        [`finger${k}-2`, [fl[1], 0]],
        [`finger${k}-3`, [fl[2], 0]],
      ]
    }),
  )
const thumb = (t1, t2 = [0, 0], t3 = [0, 0]) => ({ 'finger1-1': t1, 'finger1-2': t2, 'finger1-3': t3 })

export const HAND_SHAPES = {
  neutral: {
    label: 'Neutral',
    bones: {
      ...fingers(
        [
          [8, 12, 8],
          [12, 16, 8],
          [16, 20, 8],
          [20, 22, 8],
        ],
        [-3, 0, 3, 6],
      ),
      ...thumb([25, -5]),
    },
  },
  spread: { label: 'Spread', bones: { ...fingers([-5, 0, 0], [12, 3, -8, -16]), ...thumb([-25, 10]) } },
  flat: {
    label: 'Flat',
    thumbInPalm: true,
    bones: { ...fingers([-5, 0, 0], [-5, 0, 5, 9]), ...thumb([20, 5]) },
  },
  fist: {
    label: 'Fist',
    bones: { ...fingers([80, 95, 55], [-4, 0, 4, 8]), ...thumb([30, -35], [30, 0], [40, 0]) },
  },
  hook: {
    label: 'Hook',
    bones: { ...fingers([5, 70, 35], [-6, 0, 6, 12]), ...thumb([40, -15], [10, 0], [10, 0]) },
  },
  ok: {
    label: 'OK',
    bones: {
      ...fingers(
        [
          [32.6, 45.6, 36.7],
          [0, 5, 0],
          [0, 5, 0],
          [0, 5, 0],
        ],
        [0, 4, -8, -16],
      ),
      ...thumb([12.2, -8.4], [19, 0], [20.7, 0]),
    },
  },
}

const isHandBone = (n, side) => n.endsWith(`.${side}`) && /^(finger|metacarpal)/.test(n)

export function captureHandLocal(body, side) {
  const out = {}
  for (const n of body.order) {
    if (!isHandBone(n, side)) continue
    const b = body.bones[n]
    if (b) out[n] = b.quaternion.clone()
  }
  return out
}

export function captureBothHandsLocal(body) {
  return { ...captureHandLocal(body, 'L'), ...captureHandLocal(body, 'R') }
}

function layThumbInPalm(body, side) {
  const B = (n) => body.bones[`${n}.${side}`]
  const pos = (b) => b.getWorldPosition(new THREE.Vector3())
  const k2 = B('finger2-1')
  const k3 = B('finger3-1')
  const k5 = B('finger5-1')
  const t3 = B('finger3-3')
  if (!k2 || !k3 || !k5 || !t3) return
  const base = pos(k3)
  const nrm = pos(k5).sub(pos(k2)).cross(pos(t3).sub(base)).normalize()
  for (const j of [1, 2, 3]) {
    const b = B(`finger1-${j}`)
    const next = B(`finger1-${j + 1}`)
    if (!b || !b.parent) break
    const head = pos(b)
    const dir = next
      ? pos(next).sub(head)
      : new THREE.Vector3(0, 1, 0).applyQuaternion(b.getWorldQuaternion(new THREE.Quaternion()))
    const len = dir.length()
    const inPlane = dir.clone().addScaledVector(nrm, -nrm.dot(dir))
    if (len < 1e-9 || inPlane.lengthSq() < 1e-12) continue
    const off = next ? THREE.MathUtils.clamp(-nrm.dot(head.clone().sub(base)), -0.7 * len, 0.7 * len) : 0
    const target = inPlane.setLength(Math.sqrt(len * len - off * off)).addScaledVector(nrm, off)
    const swing = new THREE.Quaternion().setFromUnitVectors(dir.divideScalar(len), target.normalize())
    const pq = b.parent.getWorldQuaternion(new THREE.Quaternion())
    b.quaternion.premultiply(pq.clone().invert().multiply(swing).multiply(pq))
    body.frame.updateMatrixWorld(true)
  }
}

/** Empty key restores `fitted` local quats (“as fitted”). */
export function applyHandShape(body, side, key, fitted) {
  const shape = key ? HAND_SHAPES[key] : null
  if (key && !shape) return
  const deg = THREE.MathUtils.degToRad
  const sg = side === 'L' ? 1 : -1
  for (const n of body.order) {
    if (!isHandBone(n, side)) continue
    const b = body.bones[n]
    const p = b?.parent?.isBone ? b.parent.name : null
    if (!b || !p) continue
    if (!shape) {
      const q = fitted?.[n]
      if (q) b.quaternion.copy(q)
      continue
    }
    const [flex, spread] = shape.bones[n.slice(0, -2)] || [0, 0]
    const v = new THREE.Vector3(deg(flex), 0, deg(sg * spread))
    const ang = v.length()
    const local = ang > 1e-9 ? new THREE.Quaternion().setFromAxisAngle(v.divideScalar(ang), ang) : new THREE.Quaternion()
    b.quaternion.copy(body.restQ[p].clone().invert().multiply(body.restQ[n]).multiply(local))
  }
  body.frame.updateMatrixWorld(true)
  if (shape?.thumbInPalm) layThumbInPalm(body, side)
}

export function handShapeOptionsHtml(selected) {
  const opts = [{ key: '', label: 'As fitted' }, ...Object.entries(HAND_SHAPES).map(([key, v]) => ({ key, label: v.label }))]
  return opts
    .map((o) => `<option value="${o.key}"${o.key === selected ? ' selected' : ''}>${o.label}</option>`)
    .join('')
}
