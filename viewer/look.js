/**
 * Body material for the open viewer: wardrobe colours from the GLB's COLOR_0 fields, plus a
 * costume style's procedural pattern and per-region roughness / metalness. Same look model as
 * the SynthYoga app (packages/pose3d/src/pose3dLook.ts), kept as plain JS for the template.
 */
import * as THREE from 'three'

export const REGIONS = ['skin', 'top', 'bottom', 'hair', 'accent']
export const PATTERNS = ['stripes', 'spots', 'tie-dye', 'galaxy', 'panels', 'marble', 'zigzag']
const DEFAULT_ROUGH = 0.75
const REGION_UNIFORM = { skin: 'cSkin', top: 'cTop', bottom: 'cBottom', hair: 'cHair', accent: 'cAccent' }

function setRgb(c, rgb) {
  c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace)
}

/** Resolve a style against a character palette into draw colours / materials. */
export function resolveLook(style, palette) {
  const id = style?.id || 'classic'
  const skin = palette || { skin: [220, 180, 150], hair: [60, 40, 30], top: [32, 46, 82], bottom: [58, 59, 66] }
  const top = (id === 'classic' && skin.top) || style.top
  const bottom = (id === 'classic' && skin.bottom) || style.bottom
  const skinRgb = style.skin || skin.skin
  const hair = style.hair === 'skin' ? skinRgb : style.hair || skin.hair
  const rough = {}
  const metal = {}
  for (const r of REGIONS) {
    rough[r] = style.rough?.[r] ?? (style.hair === 'skin' && r === 'hair' ? (style.rough?.skin ?? DEFAULT_ROUGH) : DEFAULT_ROUGH)
    metal[r] = style.metal?.[r] ?? (style.hair === 'skin' && r === 'hair' ? (style.metal?.skin ?? 0) : 0)
  }
  return {
    colors: { skin: skinRgb, top, bottom, hair, accent: style.accent || top },
    pattern: style.pattern || null,
    rough,
    metal,
  }
}

const GLSL_HEAD = /* glsl */ `
uniform vec3 cSkin, cTop, cBottom, cHair, cAccent, cPattern;
uniform int uPattern, uPatternMask;
uniform float uPatternScale, uPatternGlow;
uniform float uRough[5], uMetal[5];
varying vec3 vRest;

float lkHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float lkNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lkHash(i), lkHash(i + vec3(1, 0, 0)), f.x),
                 mix(lkHash(i + vec3(0, 1, 0)), lkHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(lkHash(i + vec3(0, 0, 1)), lkHash(i + vec3(1, 0, 1)), f.x),
                 mix(lkHash(i + vec3(0, 1, 1)), lkHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float lkFbm(vec3 p) {
  return 0.5 * lkNoise(p) + 0.25 * lkNoise(p * 2.03) + 0.125 * lkNoise(p * 4.01);
}
float lkCell(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 8.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(lkHash(i + g), lkHash(i + g + 19.1), lkHash(i + g + 47.7));
        d = min(d, length(g + o - f));
      }
  return d;
}
vec3 lkHue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
float lkPattern(vec3 p, inout vec3 col, out float glow) {
  float s = uPatternScale;
  glow = 0.0;
  if (uPattern == 0) return step(0.5, fract(p.y * s));
  if (uPattern == 1) {
    float d = lkCell(p * s);
    return smoothstep(0.34, 0.3, d) * smoothstep(0.12, 0.16, d);
  }
  if (uPattern == 2) {
    vec2 c = p.xy - vec2(0.0, 0.08);
    float a = atan(c.x, c.y) / 6.2831853;
    float r = length(c) * s + a * 2.0 + lkFbm(p * 12.0) * 0.8;
    col = mix(col, lkHue(fract(r * 0.33)) * 0.85 + 0.12, 0.85);
    return 0.0;
  }
  if (uPattern == 3) {
    float n = lkFbm(p * s);
    col = mix(col, cPattern, smoothstep(0.35, 0.75, n) * 0.85);
    float star = step(0.985, lkHash(floor(p * 160.0)));
    glow = star;
    col = mix(col, vec3(1.0), star);
    return 0.0;
  }
  if (uPattern == 4) {
    vec3 g = abs(fract(p * s) - 0.5);
    float edge = max(max(g.x, g.y), g.z);
    float m = smoothstep(0.455, 0.47, edge);
    glow = m;
    return m;
  }
  if (uPattern == 5) {
    float v = abs(sin(p.y * s + 5.0 * lkFbm(p * 3.0)));
    return smoothstep(0.12, 0.02, v) * 0.8;
  }
  if (uPattern == 6) {
    float u = atan(p.x, p.z) * 0.15;
    float z = fract(p.y * s + abs(fract(u * s) - 0.5));
    return step(z, 0.3);
  }
  return 0.0;
}
`

const GLSL_COLOR = /* glsl */ `
#ifdef USE_COLOR_ALPHA
  vec4 lkF = vColor;
#else
  vec4 lkF = vec4(vColor, 1.0);
#endif
  int region = 0;
  vec3 col = cSkin;
  if (lkF.g > 0.5) { col = cBottom; region = 2; }
  if (lkF.r > 0.5) { col = cTop; region = 1; }
  if (lkF.b > 0.5) { col = cHair; region = 3; }
  if (lkF.a < 0.5) { col = cAccent; region = 4; }
  float lkGlow = 0.0;
  if (uPattern >= 0 && ((uPatternMask >> region) & 1) == 1) {
    float g;
    float m = lkPattern(vRest, col, g);
    col = mix(col, cPattern, m);
    lkGlow = g * uPatternGlow;
  }
  diffuseColor.rgb = col;
`

export function lookMaterial() {
  const uniforms = {
    cSkin: { value: new THREE.Color() },
    cTop: { value: new THREE.Color() },
    cBottom: { value: new THREE.Color() },
    cHair: { value: new THREE.Color() },
    cAccent: { value: new THREE.Color() },
    cPattern: { value: new THREE.Color() },
    uPattern: { value: -1 },
    uPatternScale: { value: 1 },
    uPatternMask: { value: 0 },
    uPatternGlow: { value: 0 },
    uRough: { value: [0.75, 0.75, 0.75, 0.75, 0.75] },
    uMetal: { value: [0, 0, 0, 0, 0] },
    uRestMatrix: { value: new THREE.Matrix4() },
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 })
  material.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms)
    sh.vertexShader =
      'uniform mat4 uRestMatrix;\nvarying vec3 vRest;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRest = (uRestMatrix * vec4(position, 1.0)).xyz;',
      )
    sh.fragmentShader = (GLSL_HEAD + sh.fragmentShader)
      .replace('#include <color_fragment>', GLSL_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = uRough[region];')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uMetal[region];')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += col * lkGlow;')
  }
  return { material, uniforms }
}

export function applyLook(uniforms, look) {
  for (const r of REGIONS) setRgb(uniforms[REGION_UNIFORM[r]].value, look.colors[r])
  REGIONS.forEach((r, i) => {
    uniforms.uRough.value[i] = look.rough[r]
    uniforms.uMetal.value[i] = look.metal[r]
  })
  const p = look.pattern
  uniforms.uPattern.value = p ? PATTERNS.indexOf(p.kind) : -1
  if (p) {
    setRgb(uniforms.cPattern.value, p.color)
    uniforms.uPatternScale.value = p.scale
    uniforms.uPatternMask.value = p.regions.reduce((m, r) => m | (1 << REGIONS.indexOf(r)), 0)
    uniforms.uPatternGlow.value = p.glow ?? 0
  }
}
