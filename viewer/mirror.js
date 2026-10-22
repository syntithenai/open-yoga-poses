/**
 * Left/right mirroring of yoga-pose/1 data for the open viewer.
 * Pose frame is Z up facing -Y; lateral axis is X.
 */

export function mirrorBoneName(name) {
  if (name.endsWith('.L')) return `${name.slice(0, -2)}.R`
  if (name.endsWith('.R')) return `${name.slice(0, -2)}.L`
  return name
}

const mirrorQuat = (q) => [q[0], q[1], -q[2], -q[3]]
const mirrorVec = (v) => [-v[0], v[1], v[2]]

function mirrorRecord(rec, fn) {
  const out = {}
  for (const [n, v] of Object.entries(rec || {})) out[mirrorBoneName(n)] = fn(v)
  return out
}

function mirrorProp(p) {
  if (p.type === 'chair') return { ...p, seat: mirrorVec(p.seat), yaw: -p.yaw }
  return { ...p, at: mirrorVec(p.at), yaw: -p.yaw }
}

export function mirrorPoseDoc(doc) {
  const out = { ...doc, bones: mirrorRecord(doc.bones || {}, mirrorQuat) }
  if (doc.restAxes) out.restAxes = mirrorRecord(doc.restAxes, mirrorVec)
  if (doc.root) out.root = { ...doc.root, ...(doc.root.head ? { head: mirrorVec(doc.root.head) } : {}) }
  if (doc.props) out.props = doc.props.map(mirrorProp)
  return out
}
