/**
 * Materials for high-detail MPFB bodies. Keeps baked face/hair maps and retints clothes /
 * skin / hair (plus procedural patterns) when the costume changes — same approach as the
 * SynthYoga app's pose3dHdLook.
 */
import * as THREE from 'three'
import { PATTERNS } from './look.js'

export const HD_SHELL_ROLES = new Set(['skin', 'top', 'bottom'])

const ROLE_REGION = { skin: 'skin', top: 'top', bottom: 'bottom', hair: 'hair' }
const SSS_TINT = new THREE.Color(1.0, 0.36, 0.22)
const WRAP_GAIN = 0.35

function setRgb(c, rgb) {
  if (!rgb) return
  c.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace)
}

const WRAP_LIGHT = /* glsl */ `
#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
#pragma unroll_loop_start
for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
  {
    vec3 L = directionalLights[ i ].direction;
    float nl = dot( geometryNormal, L );
    float wrap = max( 0.0, ( nl + 0.45 ) / 1.45 ) - max( 0.0, nl );
    reflectedLight.directDiffuse += directionalLights[ i ].color * diffuseColor.rgb * uSss * ( ${WRAP_GAIN.toFixed(2)} * wrap );
  }
}
#pragma unroll_loop_end
#endif
`

const PATTERN_GLSL = /* glsl */ `
uniform vec3 uTintColor, uTintRef, cPattern;
uniform float uTintMix, uPatternScale, uPatternGlow;
uniform int uPattern, uPatternOn;
varying vec3 vRest;

float hdHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float hdNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hdHash(i), hdHash(i + vec3(1, 0, 0)), f.x),
                 mix(hdHash(i + vec3(0, 1, 0)), hdHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hdHash(i + vec3(0, 0, 1)), hdHash(i + vec3(1, 0, 1)), f.x),
                 mix(hdHash(i + vec3(0, 1, 1)), hdHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float hdFbm(vec3 p) {
  return 0.5 * hdNoise(p) + 0.25 * hdNoise(p * 2.03) + 0.125 * hdNoise(p * 4.01);
}
float hdCell(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float d = 8.0;
  for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(hdHash(i + g), hdHash(i + g + 19.1), hdHash(i + g + 47.7));
        d = min(d, length(g + o - f));
      }
  return d;
}
vec3 hdHue(float h) {
  return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}
float hdPattern(vec3 p, inout vec3 col, out float glow) {
  float s = uPatternScale;
  glow = 0.0;
  if (uPattern == 0) return step(0.5, fract(p.y * s));
  if (uPattern == 1) {
    float d = hdCell(p * s);
    return smoothstep(0.34, 0.3, d) * smoothstep(0.12, 0.16, d);
  }
  if (uPattern == 2) {
    vec2 c = p.xy - vec2(0.0, 0.08);
    float a = atan(c.x, c.y) / 6.2831853;
    float r = length(c) * s + a * 2.0 + hdFbm(p * 12.0) * 0.8;
    col = mix(col, hdHue(fract(r * 0.33)) * 0.85 + 0.12, 0.85);
    return 0.0;
  }
  if (uPattern == 3) {
    float n = hdFbm(p * s);
    col = mix(col, cPattern, smoothstep(0.35, 0.75, n) * 0.85);
    float star = step(0.985, hdHash(floor(p * 160.0)));
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
    float v = abs(sin(p.y * s + 5.0 * hdFbm(p * 3.0)));
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

const TINT_MAP_FRAGMENT = /* glsl */ `
  float hdGlow = 0.0;
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  float hdLuma = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  float hdRef = max(dot(uTintRef, vec3(0.299, 0.587, 0.114)), 0.04);
  vec3 hdTinted = uTintColor * (hdLuma / hdRef);
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, hdTinted, uTintMix);
  if (uPatternOn == 1 && uPattern >= 0) {
    float g;
    float m = hdPattern(vRest, sampledDiffuseColor.rgb, g);
    sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, cPattern, m);
    hdGlow = g * uPatternGlow;
  }
  diffuseColor *= sampledDiffuseColor;
#else
  vec3 hdBase = diffuseColor.rgb;
  float hdLuma = dot(hdBase, vec3(0.299, 0.587, 0.114));
  float hdRef = max(dot(uTintRef, vec3(0.299, 0.587, 0.114)), 0.04);
  vec3 hdTinted = uTintColor * (hdLuma / hdRef);
  diffuseColor.rgb = mix(hdBase, hdTinted, uTintMix);
  if (uPatternOn == 1 && uPattern >= 0) {
    float g;
    float m = hdPattern(vRest, diffuseColor.rgb, g);
    diffuseColor.rgb = mix(diffuseColor.rgb, cPattern, m);
    hdGlow = g * uPatternGlow;
  }
#endif
`

function styleUniforms(mesh) {
  return {
    uTintColor: { value: new THREE.Color(1, 1, 1) },
    uTintRef: { value: new THREE.Color(1, 1, 1) },
    uTintMix: { value: 0 },
    cPattern: { value: new THREE.Color(1, 1, 1) },
    uPattern: { value: -1 },
    uPatternScale: { value: 1 },
    uPatternGlow: { value: 0 },
    uPatternOn: { value: 0 },
    uRestMatrix: {
      value: new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale),
    },
  }
}

function attachStyleShader(m, uniforms, { wrap = false, cacheKey }) {
  const prev = m.onBeforeCompile
  m.onBeforeCompile = (sh, renderer) => {
    prev?.(sh, renderer)
    Object.assign(sh.uniforms, uniforms)
    if (wrap) {
      sh.uniforms.uSss = { value: SSS_TINT }
      sh.fragmentShader =
        'uniform vec3 uSss;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', WRAP_LIGHT)
    }
    sh.vertexShader =
      'uniform mat4 uRestMatrix;\nvarying vec3 vRest;\n' +
      sh.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvRest = (uRestMatrix * vec4(position, 1.0)).xyz;',
      )
    sh.fragmentShader = (PATTERN_GLSL + sh.fragmentShader)
      .replace('#include <map_fragment>', TINT_MAP_FRAGMENT)
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * hdGlow;',
      )
  }
  const prevKey = m.customProgramCacheKey?.bind(m)
  m.customProgramCacheKey = () => `${cacheKey}|hd-style${prevKey ? `|${prevKey()}` : ''}`
}

function hdMaterial(role, src, mesh, uniforms) {
  if (role === 'skin') {
    const m = new THREE.MeshStandardMaterial({
      map: src.map ?? null,
      normalMap: src.normalMap ?? null,
      roughnessMap: src.roughnessMap ?? null,
      roughness: src.roughnessMap ? 1 : 0.5,
      metalness: 0,
    })
    m.normalScale.set(0.6, 0.6)
    attachStyleShader(m, uniforms, { wrap: true, cacheKey: 'hd-skin-wrap' })
    return m
  }
  if (role === 'hair' || role === 'brows') {
    const m = new THREE.MeshStandardMaterial({
      map: src.map ?? null,
      normalMap: role === 'hair' ? (src.normalMap ?? null) : null,
      roughness: role === 'hair' ? 0.7 : 0.6,
      metalness: 0,
      transparent: true,
      alphaTest: role === 'hair' ? 0.25 : 0.4,
      side: THREE.DoubleSide,
    })
    attachStyleShader(m, uniforms, { cacheKey: role === 'hair' ? 'hd-hair' : 'hd-brows' })
    return m
  }
  if (role === 'eyes') {
    return new THREE.MeshStandardMaterial({ map: src.map ?? null, roughness: 0.12, metalness: 0 })
  }
  const m = new THREE.MeshStandardMaterial({
    map: src.map ?? null,
    normalMap: src.normalMap ?? null,
    roughness: 0.88,
    metalness: 0,
  })
  attachStyleShader(m, uniforms, { cacheKey: `hd-${role}` })
  return m
}

/**
 * Swap each part onto HD materials. Returns a controller whose setStyle() applies a
 * resolveLook() result (colours + optional pattern).
 */
export function applyHdLook(parts, bakedPalette) {
  const textures = new Set()
  const materials = []
  const styled = []

  for (const { mesh, role } of parts) {
    const src = mesh.material
    for (const t of [src.map, src.normalMap, src.roughnessMap, src.metalnessMap]) if (t) textures.add(t)
    const uniforms = styleUniforms(mesh)
    const m = hdMaterial(role, src, mesh, uniforms)
    src.dispose?.()
    mesh.material = m
    materials.push(m)
    mesh.castShadow = HD_SHELL_ROLES.has(role)
    mesh.receiveShadow = false
    mesh.frustumCulled = false
    if (ROLE_REGION[role]) styled.push({ role, material: m, uniforms })
  }

  return {
    setStyle(look) {
      for (const { role, material, uniforms } of styled) {
        const region = ROLE_REGION[role]
        if (!look) {
          uniforms.uTintMix.value = 0
          uniforms.uPatternOn.value = 0
          material.roughness = role === 'skin' ? (material.roughnessMap ? 1 : 0.5) : role === 'hair' ? 0.7 : 0.88
          material.metalness = 0
          material.needsUpdate = true
          continue
        }
        const ref = bakedPalette?.[region === 'hair' ? 'hair' : region === 'skin' ? 'skin' : region === 'bottom' ? 'bottom' : 'top']
        setRgb(uniforms.uTintRef.value, ref || [200, 200, 200])
        setRgb(uniforms.uTintColor.value, look.colors[region])
        // Clothes take a strong retint; skin/hair keep more of the baked albedo.
        uniforms.uTintMix.value = region === 'top' || region === 'bottom' ? 0.92 : 0.75
        material.roughness = look.rough?.[region] ?? material.roughness
        material.metalness = look.metal?.[region] ?? 0
        const p = look.pattern
        const on = !!(p && p.regions?.includes(region))
        uniforms.uPatternOn.value = on ? 1 : 0
        if (p) {
          uniforms.uPattern.value = PATTERNS.indexOf(p.kind)
          uniforms.uPatternScale.value = p.scale ?? 1
          uniforms.uPatternGlow.value = p.glow ?? 0
          setRgb(uniforms.cPattern.value, p.color)
        } else {
          uniforms.uPattern.value = -1
        }
        material.needsUpdate = true
      }
    },
    dispose() {
      for (const m of materials) m.dispose()
      for (const t of textures) t.dispose()
    },
  }
}

/** Soften alpha-tested hair when the renderer has MSAA. */
export function hairAlphaToCoverage(parts, renderer) {
  if (!renderer?.getContext?.().getContextAttributes?.()?.antialias) return
  for (const { mesh, role } of parts) {
    const m = mesh.material
    if ((role === 'hair' || role === 'brows') && m.alphaTest > 0) {
      m.alphaToCoverage = true
      m.needsUpdate = true
    }
  }
}
