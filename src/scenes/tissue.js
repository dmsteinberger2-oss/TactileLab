import * as THREE from 'three'

// Procedural surface detail for the baked part meshes, injected into MeshPhysicalMaterial with
// onBeforeCompile. Detail is solid (3D) noise in the part's own object space, so it needs no UVs,
// has no seams and moves with the part when it lifts. Colour detail multiplies the baked vertex
// colour, so the colour picker tint still works. The painted section texture on coronal cut faces
// (the plane z = 0 in object space) is masked out and renders exactly as before.

// Per-part look. kind picks the GLSL branch; wrap is the red-tinted diffuse wrap (soft tissue only).
const KINDS = {
  capsule: { id: 1, wrap: 0.55 },   // kidney capsule: fine vessels, mottling, micro-bumps, broken wet highlights
  tumor: { id: 2, wrap: 0.45 },     // clear cell RCC: lobulated, haemorrhagic
  lobular: { id: 3, wrap: 0.5 },    // fat and adrenal
  vessel: { id: 4, wrap: 0.4 },     // smooth, wet
  inner: { id: 5, wrap: 0.5 },      // medulla, pelvis, disc: soft, faint texture
  bone: { id: 6, wrap: 0.12 },      // vertebra: porous cortical bone
  graft: { id: 7, wrap: 0.1 },      // morselised bone graft
  frontHalf: { id: 8, wrap: 0.55 }, // openable kidney's front half: capsule + front of tumour
}
const PART_KIND = {
  kidney_body: 'capsule', renal_cortex: 'capsule', resection_margin: 'capsule', anterior_half: 'frontHalf',
  tumor: 'tumor', vein_thrombus: 'tumor', ivc_thrombus: 'tumor',
  renal_sinus: 'lobular', adrenal_gland: 'lobular', aml: 'lobular', calculus: 'bone',
  ivc: 'vessel', cyst: 'vessel',
  renal_artery: 'vessel', accessory_renal_artery: 'vessel', renal_vein: 'vessel', ureter: 'vessel', thecal_sac: 'vessel', nerve_roots: 'vessel', l5_nerve_root_left: 'vessel', l4_nerve_root_left: 'vessel',
  renal_medulla: 'inner', renal_pelvis: 'inner', annulus_fibrosus: 'inner', nucleus_pulposus: 'inner', disc_herniation: 'inner',
  l4_vertebra: 'bone', l5_vertebra: 'bone', l4_posterior_arch: 'bone',
  bone_graft: 'graft',
}
const NONE = { id: 0, wrap: 0 }
export const tissueKind = (partId) => KINDS[PART_KIND[partId]] ?? NONE

const NOISE = /* glsl */`
varying vec3 vTlPos;
uniform float tlCut;
uniform float tlHover;
float tlHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
vec3 tlHash3(vec3 p) { return vec3(tlHash(p), tlHash(p + 31.7), tlHash(p + 67.3)); }
float tlNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(tlHash(i), tlHash(i + vec3(1, 0, 0)), f.x), mix(tlHash(i + vec3(0, 1, 0)), tlHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(tlHash(i + vec3(0, 0, 1)), tlHash(i + vec3(1, 0, 1)), f.x), mix(tlHash(i + vec3(0, 1, 1)), tlHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
#ifdef TL_LITE
float tlFbm(vec3 p) { return (0.5 * tlNoise(p) + 0.25 * tlNoise(p * 2.03 + vec3(1.7, 9.2, 3.1))) / 0.75; }
#else
float tlFbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * tlNoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s / 0.9375; }
#endif
// Cellular noise: x = distance to nearest feature point, y = to second nearest.
#ifdef TL_LITE
// Phones: soft value-noise bumps stand in for the 27-cell search.
vec2 tlCell(vec3 p) { float n = tlNoise(p * 1.3); return vec2(n * 0.75, n * 0.75 + 0.3); }
#else
vec2 tlCell(vec3 p) {
  vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int z = -1; z <= 1; z++) for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec3 g = vec3(float(x), float(y), float(z)); vec3 r = g + tlHash3(i + g) * 0.85 - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(vec2(d1, d2));
}
#endif
// Kidney capsule: mottling, fine vessels, micro-bumps, broken wet highlights.
void tlCapsule(vec3 tlP, inout vec3 tlCol, inout float tlH, inout float tlRough, inout float tlCoat) {
  float mott = tlFbm(tlP * 0.9);
  // Capsular vessels: thin ridges of a domain-warped noise field, faint purple-red, barely raised.
  vec3 wp = tlP * 0.9 + 1.4 * vec3(tlFbm(tlP * 0.5 + 3.1), tlFbm(tlP * 0.5 + 7.7), tlFbm(tlP * 0.5 + 1.3));
  float ves = pow(1.0 - abs(tlFbm(wp) * 2.0 - 1.0), 18.0);
  float ves2 = pow(1.0 - abs(tlFbm(wp * 2.1 + 5.0) * 2.0 - 1.0), 26.0) * 0.55;
  float v = max(ves, ves2) * smoothstep(0.25, 0.6, tlNoise(tlP * 0.6 + 9.0) + 0.2);
  tlCol = mix(vec3(0.94, 0.95, 0.97), vec3(1.07, 1.03, 1.03), smoothstep(0.3, 0.75, mott));
  tlCol *= mix(vec3(1.0), vec3(0.72, 0.52, 0.66), v * 0.5);
  tlH = tlNoise(tlP * 6.0) * 0.004 + v * 0.004 + mott * 0.025;
  // Broken wet highlights: glossy patches separated by duller, drier film.
  float wet = smoothstep(0.38, 0.66, tlFbm(tlP * 1.4 + 11.0));
  tlRough = mix(0.58, 0.34, wet);
  tlCoat = mix(0.25, 1.0, wet);
}
// Clear cell RCC surface.
void tlTumour(vec3 tlP, inout vec3 tlCol, inout float tlH, inout float tlRough, inout float tlCoat) {
  // Lobulated mass: large soft domes from warped cellular noise, haemorrhagic and pale patches.
  vec3 tp = tlP * 0.95 + 0.6 * vec3(tlNoise(tlP * 0.8), tlNoise(tlP * 0.8 + 4.0), tlNoise(tlP * 0.8 + 8.0));
  vec2 c = tlCell(tp);
  float hem = smoothstep(0.55, 0.75, tlFbm(tlP * 0.8 + 4.0));
  float hem2 = smoothstep(0.62, 0.82, tlFbm(tlP * 2.0 + 9.0));
  float pale = smoothstep(0.55, 0.78, tlFbm(tlP * 1.1 + 21.0));
  tlCol = mix(vec3(0.97), vec3(1.07, 1.05, 0.9), pale * 0.7);
  tlCol = mix(tlCol, vec3(0.66, 0.3, 0.2), hem * 0.7);
  tlCol = mix(tlCol, vec3(0.55, 0.25, 0.2), hem2 * 0.45);
  tlCol *= mix(0.9, 1.0, smoothstep(0.0, 0.25, c.y - c.x));   // shallow clefts between lobules
  tlH = -c.x * c.x * 0.07 + tlFbm(tlP * 3.0) * 0.012;
  tlRough = mix(0.5, 0.33, hem);
  tlCoat = mix(0.35, 1.0, hem);
}
vec3 tlPerturb(vec3 surfPos, vec3 n, float h, float faceDir) {
  vec2 dh = vec2(dFdx(h), dFdy(h));
  vec3 sx = dFdx(surfPos), sy = dFdy(surfPos);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * faceDir;
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  return normalize(abs(det) * n - grad);
}
`

// Computes, per fragment: tlCol (multiplier on the baked colour), tlH (height for bump),
// tlRough (roughness override, <0 = keep), tlCoat (clearcoat multiplier).
const DETAIL = /* glsl */`
  vec3 tlP = vTlPos;
  // Coronal cut faces (object-space plane z = 0) carry the painted section texture: no detail there.
  float tlMask = 1.0 - tlCut * (1.0 - smoothstep(0.015, 0.05, abs(tlP.z)));
  vec3 tlCol = vec3(1.0); float tlH = 0.0; float tlRough = -1.0; float tlCoat = 1.0;
  {
#if TL_KIND == 1
  tlCapsule(tlP, tlCol, tlH, tlRough, tlCoat);
#elif TL_KIND == 2
  tlTumour(tlP, tlCol, tlH, tlRough, tlCoat);
#elif TL_KIND == 8
  // Front half of the openable kidney: one mesh holding capsule and the front of the tumour,
  // told apart by their baked vertex colour (tumour and adrenal are yellow, kidney is red).
  tlCapsule(tlP, tlCol, tlH, tlRough, tlCoat);
  #ifdef USE_COLOR
    float tlYellow = smoothstep(0.58, 0.66, vColor.g / max(vColor.r, 1e-3));
    if (tlYellow > 0.0) {
      vec3 c2 = vec3(1.0); float h2 = 0.0, r2 = -1.0, k2 = 1.0;
      tlTumour(tlP, c2, h2, r2, k2);
      tlCol = mix(tlCol, c2, tlYellow); tlH = mix(tlH, h2, tlYellow); tlRough = mix(tlRough, r2, tlYellow); tlCoat = mix(tlCoat, k2, tlYellow);
    }
  #endif
#elif TL_KIND == 3
  vec2 c = tlCell(tlP * 3.2);
  tlCol = vec3(mix(0.92, 1.06, tlNoise(tlP * 3.2))) * mix(0.84, 1.0, smoothstep(0.0, 0.14, c.y - c.x));
  tlH = -c.x * c.x * 0.03 + tlNoise(tlP * 16.0) * 0.004;
  tlRough = 0.5; tlCoat = 0.55;
#elif TL_KIND == 4
  float s = tlFbm(tlP * vec3(0.8, 2.4, 0.8));
  tlCol = vec3(mix(0.94, 1.05, s));
  tlH = s * 0.006;
  tlRough = 0.22; tlCoat = 1.0;
#elif TL_KIND == 5
  float s = tlFbm(tlP * 2.0);
  tlCol = vec3(mix(0.93, 1.05, s));
  tlH = tlNoise(tlP * 10.0) * 0.006 + s * 0.01;
  tlRough = 0.45; tlCoat = 0.7;
#elif TL_KIND == 6
  vec2 c = tlCell(tlP * 6.0);
  // Pores vary in size and cluster, so the surface reads as porous rather than evenly dotted.
  float pore = (1.0 - smoothstep(0.04, 0.12 + 0.18 * tlNoise(tlP * 1.7), c.x)) * smoothstep(0.25, 0.65, tlNoise(tlP * 2.3 + 5.0));
  float stain = tlFbm(tlP * 0.8 + 2.0);
  tlCol = mix(vec3(1.0), vec3(0.93, 0.88, 0.8), smoothstep(0.4, 0.75, stain)) * mix(1.0, 0.72, pore * 0.8);
  tlH = -pore * 0.02 + tlFbm(tlP * 2.5) * 0.03 + tlNoise(tlP * 14.0) * 0.004;
  tlRough = 0.72; tlCoat = 0.0;
#elif TL_KIND == 7
  vec2 c = tlCell(tlP * 4.5);
  float pore = 1.0 - smoothstep(0.05, 0.3, c.x);
  tlCol = vec3(mix(0.88, 1.06, tlHash(floor(tlP * 4.5)))) * mix(1.0, 0.75, pore) * mix(0.8, 1.0, smoothstep(0.0, 0.12, c.y - c.x));
  tlH = -c.x * c.x * 0.04 - pore * 0.015;
  tlRough = 0.75; tlCoat = 0.0;
#endif
  }
  tlCol = mix(vec3(1.0), tlCol, tlMask); tlH *= tlMask;
`

function patch(shader, kind, mat, lite) {
  shader.uniforms.tlCut = mat.userData.tlUniforms.tlCut
  shader.uniforms.tlHover = mat.userData.tlUniforms.tlHover
  shader.uniforms.tlWrap = { value: kind.wrap }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vTlPos;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTlPos = position;')
  const lightsChunk = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    'reflectedLight.directDiffuse += irradiance * diffuseBRDF * ( 1.0 - F );',
    // Wrap lighting: light bleeds past the terminator, more in red than in green/blue, as in
    // subsurface-scattering tissue. The wrapped term replaces the plain N.L diffuse term only.
    `{ vec3 tlW = tlWrap * vec3(1.0, 0.42, 0.32);
       vec3 tlNL = saturate((dot(geometryNormal, directLight.direction) + tlW) / (1.0 + tlW));
       reflectedLight.directDiffuse += tlNL * directLight.color * diffuseBRDF * ( 1.0 - F ); }`)
  shader.fragmentShader = `#define TL_KIND ${kind.id}\n${lite ? '#define TL_LITE\n' : ''}uniform float tlWrap;\n` + shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + NOISE)
    .replace('#include <lights_physical_pars_fragment>', lightsChunk)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + DETAIL + '\n  diffuseColor.rgb *= tlCol;')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (tlRough >= 0.0) roughnessFactor = mix(roughnessFactor, tlRough, tlMask);')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  normal = tlPerturb(-vViewPosition, normal, tlH, faceDirection);')
    .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
  #ifdef USE_CLEARCOAT
    material.clearcoat *= mix(1.0, tlCoat, tlMask);
  #endif`)
    // Hover: a soft fresnel rim plus a slight lift in brightness.
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  { float rim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 2.5);
    totalEmissiveRadiance += tlHover * (vec3(0.55, 0.85, 0.82) * rim * 0.55 + diffuseColor.rgb * 0.08); }`)
}

// Props to spread on <meshPhysicalMaterial> for a part. Uniform objects are shared with the
// compiled program, so changing .value (hover, cut mask) needs no recompile.
// lite: cheaper noise for phones and low-power devices.
export function makeTissueHooks(partId, uniforms, lite = false) {
  const kind = tissueKind(partId)
  return {
    onBeforeCompile(shader) { patch(shader, kind, this, lite) },
    customProgramCacheKey: () => `tl-${kind.id}${lite ? '-lite' : ''}`,
    userData: { tlUniforms: uniforms },
  }
}
