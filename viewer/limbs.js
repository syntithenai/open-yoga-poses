/** Limb chains from the shoulder / hip outwards. */
const LIMBS = [
  ['upperarm01', 'upperarm02', 'lowerarm01', 'lowerarm02', 'wrist'],
  ['upperleg01', 'upperleg02', 'lowerleg01', 'lowerleg02', 'foot'],
]

/** The selected joint and the rest of its limb outwards, or null when it isn't on an arm or leg. */
export function limbFrom(joint) {
  if (!joint) return null
  const side = joint.slice(-2)
  if (side !== '.L' && side !== '.R') return null
  const base = joint.slice(0, -2)
  const chain = LIMBS.find((c) => c.includes(base))
  return chain ? chain.slice(chain.indexOf(base)).map((b) => b + side) : null
}
