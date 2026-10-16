/**
 * Keyframed moves between two poses (`transitions.json`, format `yoga-transitions/1`).
 *
 * A move runs from pose A (t = 0) to pose B (t = 1) through its keys. Each key's `ease` shapes the
 * segment that arrives at it, and `endEase` the last one. Between two points every bone rotation is
 * slerped and the rest axes and root position are blended. Same maths as the SynthYoga app.
 */

export const EASES = {
  linear: (s) => s,
  in: (s) => s * s * s,
  out: (s) => 1 - (1 - s) ** 3,
  inOut: (s) => (s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2),
}
export const EASE_LABELS = { inOut: 'Smooth', linear: 'Even', in: 'Speed up', out: 'Slow down' }
export const DEFAULT_EASE = 'inOut'
export const MAX_KEYS = 8
const IDENTITY = [1, 0, 0, 0]

function slerp(a, b, s) {
  const [aw, ax, ay, az] = a
  let [bw, bx, by, bz] = b
  let dot = aw * bw + ax * bx + ay * by + az * bz
  if (dot < 0) {
    bw = -bw
    bx = -bx
    by = -by
    bz = -bz
    dot = -dot
  }
  let ka = 1 - s
  let kb = s
  if (dot < 0.9995) {
    const th = Math.acos(Math.min(1, dot))
    const sn = Math.sin(th)
    ka = Math.sin((1 - s) * th) / sn
    kb = Math.sin(s * th) / sn
  }
  const q = [ka * aw + kb * bw, ka * ax + kb * bx, ka * ay + kb * by, ka * az + kb * bz]
  const n = Math.hypot(...q) || 1
  return q.map((v) => v / n)
}

const lerp3 = (a, b, s) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * s)

/** Blend two poses at s (0 = a, 1 = b). Bones missing on one side hold the other side's value. */
export function blendPoses(a, b, s) {
  const bones = {}
  const restAxes = {}
  const ab = a.bones || {}
  const bb = b.bones || {}
  for (const n of new Set([...Object.keys(ab), ...Object.keys(bb)])) {
    bones[n] = slerp(ab[n] || bb[n] || IDENTITY, bb[n] || ab[n] || IDENTITY, s)
  }
  const ar = a.restAxes || {}
  const br = b.restAxes || {}
  for (const n of new Set([...Object.keys(ar), ...Object.keys(br)])) {
    const v = lerp3(ar[n] || br[n], br[n] || ar[n], s)
    const len = Math.hypot(...v) || 1
    restAxes[n] = v.map((x) => x / len)
  }
  const ha = a.root?.head ?? [0, 0, 0]
  const hb = b.root?.head ?? ha
  return { bones, restAxes, root: { head: lerp3(ha, hb, s) } }
}

/** Rest axes a key at t is captured against: the end poses' axes blended at t. */
export const keyRestAxes = (a, b, t) => blendPoses(a, b, t).restAxes

function points(a, b, tr) {
  const keys = [...(tr?.keys ?? [])].sort((x, y) => x.t - y.t)
  return [
    { t: 0, pose: a },
    ...keys.map((k) => ({ t: k.t, pose: { ...k.pose, restAxes: k.pose.restAxes || keyRestAxes(a, b, k.t) }, ease: k.ease })),
    { t: 1, pose: b, ease: tr?.endEase },
  ]
}

/** The body shape u (0..1) of the way through the move from a to b. */
export function sampleTransition(a, b, tr, u) {
  const pts = points(a, b, tr)
  u = Math.min(1, Math.max(0, u))
  let i = 0
  while (i < pts.length - 2 && u > pts[i + 1].t) i++
  const p0 = pts[i]
  const p1 = pts[i + 1]
  const span = p1.t - p0.t
  const s = span > 1e-6 ? (EASES[p1.ease ?? DEFAULT_EASE] ?? EASES[DEFAULT_EASE])((u - p0.t) / span) : 1
  return blendPoses(p0.pose, p1.pose, s)
}
