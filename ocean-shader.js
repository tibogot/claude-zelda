/**
 * ocean-shader.js — Stylized LOD ocean shader (TSL / WebGPU)
 *
 * Designed for a single map-covering ocean surface built from camera-centered
 * LOD ring tiles (geo-clipmap). One material instance is shared across every
 * ring mesh — all shading and displacement are world-space, so recentering the
 * tiles on the camera each frame is seamless.
 *
 * Features:
 *   - Three-stop turquoise depth ramp (shore → mid → deep) from seabed sample.
 *     Islands are simply terrain that rises above `waterY`.
 *   - Dual-layer mx_noise_float gradient normals (fine surface detail)
 *   - Optional Gerstner wave displacement (vertex) with an analytic per-pixel
 *     wave normal (fragment). Displacement is faded out by camera distance, so
 *     far LOD rings stay flat — no cracks across LOD boundaries.
 *   - Optional sun-glint specular highlight off the wave normal
 *   - Perturbed, bounded Fresnel — grazing angles tint toward `deepColor`
 *   - Animated coastal foam band at the shoreline
 *   - Open-water-outside-terrain fallback: fragments beyond the heightmap read
 *     as deep, eliminating the "invalid sample horizon" problem
 *
 * GEOMETRY CONTRACT: ring meshes must lie in the XZ plane (y = 0 locally) and
 * be transformed by translation only (no rotation/scale). The vertex stage adds
 * world-space displacement directly to the local position, which is only valid
 * when local XZ == world XZ up to a translation.
 *
 * Usage:
 *   import { createOceanShader, OCEAN_DEFAULTS } from "./ocean-shader.js";
 *   const ocean = createOceanShader({ heightTex, terrainSize: 1600 });
 *   const mesh  = new THREE.Mesh(ringGeoXZ, ocean.material); // share material
 *   // Each frame:
 *   ocean.uniforms.waterY.value = seaY;
 *   ocean.update(dt, elapsedSec, [mesh]);
 *   // To push a PARAMS object:
 *   ocean.syncParams(PARAMS.ocean);
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  Fn, uniform, float, vec2, vec3, vec4,
  mix, smoothstep, sin, cos, sqrt, dot, length, round,
  min, max, exp, abs, pow, saturate, clamp,
  normalize, texture, attribute, positionWorld, positionLocal, modelWorldMatrix,
  cameraPosition, mx_noise_float,
} from "three/tsl";

const TWO_PI = 6.2831853;
const GRAVITY = 9.8;
/** Number of Gerstner waves summed (unrolled). */
const N_WAVES = 6;
/** Deterministic per-wave direction offsets in [-1,1] (scaled by windSpread). */
const WAVE_DIR_OFFSET = [0.0, 0.65, -0.5, 0.28, -0.82, 0.45];

// ─── Defaults ────────────────────────────────────────────────────────────────
export const OCEAN_DEFAULTS = {
  // Depth ramp colours (three-stop: shore → mid → deep)
  /** Very shallow tint — where water just covers the seabed. */
  shoreColor:        "#8fe5d8",
  /** Mid turquoise — the main colour most pixels read. */
  midColor:          "#2ca8a8",
  /** Deep open-ocean colour — dark teal. */
  deepColor:         "#0b3a4a",
  /** Grazing-angle highlight (tinted toward deep near the horizon). */
  highlightColor:    "#a0e6e0",

  /** exp(-depth * depthAbsorb) drives the ramp. Lower = slower fade to deep. */
  depthAbsorb:        0.14,
  /** Ramp knee in [0..1]: below this is shore→mid blend. */
  depthRampShoreMid:  0.32,
  /** Ramp knee in [0..1]: above this is mid→deep blend. Must be > shoreMid. */
  depthRampMidDeep:   0.68,
  /** Depth used for fragments outside the heightmap bounds. Prevents grey horizon. */
  openOceanDepth:     60.0,

  // Surface normals (fine noise detail)
  surfNoiseScale1:    0.06,
  surfNoiseScale2:    0.13,
  surfNoiseSpeed1:    0.22,
  surfNoiseSpeed2:   -0.16,
  procNoiseSpeed:     1.0,
  surfNormalStrength: 0.28,

  // ── Gerstner waves (vertex displacement + analytic normal) ──────────────────
  waveEnabled:        true,
  /** Base amplitude (world units) of the largest wave. */
  waveAmp:            0.55,
  /** Base wavelength (world units) of the largest wave. */
  waveLength:         42.0,
  /** Choppiness 0..1 — horizontal pinch at wave crests. */
  waveSteep:          0.62,
  /** Multiplier on the dispersion-derived wave speed. */
  waveSpeed:          0.85,
  /** Dominant wind direction (degrees). */
  windAngleDeg:       38.0,
  /** Directional spread of the wave bank around the wind (degrees). */
  windSpreadDeg:      42.0,
  /** Amplitude falloff per successive (shorter) wave. */
  waveAmpFalloff:     0.82,
  /** Wavelength falloff per successive wave. */
  waveLenFalloff:     0.74,
  /** How strongly the Gerstner slope tilts the shading normal. */
  waveNormalStrength: 0.9,
  /** Camera distance where wave displacement begins fading out. */
  dispFadeStart:      90.0,
  /** Camera distance where wave displacement reaches zero (rings beyond stay flat). */
  dispFadeEnd:        260.0,

  // ── Sun glint (specular off the wave normal) ────────────────────────────────
  glintColor:         "#fff2d8",
  glintIntensity:     0.55,
  glintPower:         180.0,

  // Fresnel (bounded — no sky bleed)
  fresnelExp:         4.2,
  /** Highlight contribution. Keep modest (< 0.5) to avoid pale horizons. */
  fresnelSky:         0.35,
  /** Hard cap on the Fresnel weight before it's used as a colour mix. */
  fresnelMax:         0.72,

  // Alpha
  opacity:            1.0,

  // Coastal foam
  foamEnabled:        true,
  foamColor:          "#f0fbfa",
  /** World-space half-width of the foam band around the shoreline. */
  foamBandWidth:      2.6,
  foamIntensity:      1.25,
  /** >1 = thinner, crunchier band; <1 = softer. */
  foamSharpness:      1.35,
  /** 0 = solid band, 1 = fully noise-modulated. */
  foamNoiseAmt:       0.78,
  /** Primary noise scale in world-unit^-1 (chunky waves). */
  foamNoiseScale:     0.22,
  foamNoiseSpeed:     0.18,
  /** Fine detail noise. */
  foamFineScale:      0.9,
  foamFineAmt:        0.34,
  foamFineSpeed:      0.32,
  foamContrast:       1.2,
  /** Mask cutoff (pixels below this fade out). */
  foamCutoff:         0.42,
  foamTransitionWidth:0.14,
  /** Breathing amplitude — pulses the shoreline in/out in world units. */
  foamBreatheAmp:     0.55,
  foamBreatheHz:      0.35,
};

const DEG2RAD = Math.PI / 180;

// ─── Factory ─────────────────────────────────────────────────────────────────
/**
 * @param {object} deps
 * @param {THREE.Texture} deps.heightTex — heightmap DataTexture (R = seabed world Y)
 * @param {number}        deps.terrainSize — world size of the terrain (e.g. 1600)
 * @returns {{ material, uniforms, syncParams, update }}
 */
export function createOceanShader({ heightTex, terrainSize }) {
  const u = {};

  // Time + water Y (driven from host)
  u.time   = uniform(0);
  u.waterY = uniform(0);

  // Colours
  u.shoreColor     = uniform(new THREE.Color(OCEAN_DEFAULTS.shoreColor));
  u.midColor       = uniform(new THREE.Color(OCEAN_DEFAULTS.midColor));
  u.deepColor      = uniform(new THREE.Color(OCEAN_DEFAULTS.deepColor));
  u.highlightColor = uniform(new THREE.Color(OCEAN_DEFAULTS.highlightColor));

  // Depth ramp
  u.depthAbsorb       = uniform(OCEAN_DEFAULTS.depthAbsorb);
  u.depthRampShoreMid = uniform(OCEAN_DEFAULTS.depthRampShoreMid);
  u.depthRampMidDeep  = uniform(OCEAN_DEFAULTS.depthRampMidDeep);
  u.openOceanDepth    = uniform(OCEAN_DEFAULTS.openOceanDepth);

  // Normals (noise)
  u.surfNoiseScale1    = uniform(OCEAN_DEFAULTS.surfNoiseScale1);
  u.surfNoiseScale2    = uniform(OCEAN_DEFAULTS.surfNoiseScale2);
  u.surfNoiseSpeed1    = uniform(OCEAN_DEFAULTS.surfNoiseSpeed1);
  u.surfNoiseSpeed2    = uniform(OCEAN_DEFAULTS.surfNoiseSpeed2);
  u.procNoiseSpeed     = uniform(OCEAN_DEFAULTS.procNoiseSpeed);
  u.surfNormalStrength = uniform(OCEAN_DEFAULTS.surfNormalStrength);

  // Gerstner waves
  u.waveEnabled        = uniform(OCEAN_DEFAULTS.waveEnabled ? 1 : 0);
  u.waveAmp            = uniform(OCEAN_DEFAULTS.waveAmp);
  u.waveLength         = uniform(OCEAN_DEFAULTS.waveLength);
  u.waveSteep          = uniform(OCEAN_DEFAULTS.waveSteep);
  u.waveSpeed          = uniform(OCEAN_DEFAULTS.waveSpeed);
  u.windAngle          = uniform(OCEAN_DEFAULTS.windAngleDeg * DEG2RAD);
  u.windSpread         = uniform(OCEAN_DEFAULTS.windSpreadDeg * DEG2RAD);
  u.waveAmpFalloff     = uniform(OCEAN_DEFAULTS.waveAmpFalloff);
  u.waveLenFalloff     = uniform(OCEAN_DEFAULTS.waveLenFalloff);
  u.waveNormalStrength = uniform(OCEAN_DEFAULTS.waveNormalStrength);
  u.dispFadeStart      = uniform(OCEAN_DEFAULTS.dispFadeStart);
  u.dispFadeEnd        = uniform(OCEAN_DEFAULTS.dispFadeEnd);

  // Sun glint
  u.sunDir         = uniform(new THREE.Vector3(0.4, 0.55, 0.3).normalize());
  u.glintColor     = uniform(new THREE.Color(OCEAN_DEFAULTS.glintColor));
  u.glintIntensity = uniform(OCEAN_DEFAULTS.glintIntensity);
  u.glintPower     = uniform(OCEAN_DEFAULTS.glintPower);

  // Fresnel
  u.fresnelExp = uniform(OCEAN_DEFAULTS.fresnelExp);
  u.fresnelSky = uniform(OCEAN_DEFAULTS.fresnelSky);
  u.fresnelMax = uniform(OCEAN_DEFAULTS.fresnelMax);

  // Alpha
  u.opacity = uniform(OCEAN_DEFAULTS.opacity);

  // Coastal foam
  u.foamEnabled        = uniform(OCEAN_DEFAULTS.foamEnabled ? 1 : 0);
  u.foamColor          = uniform(new THREE.Color(OCEAN_DEFAULTS.foamColor));
  u.foamBandWidth      = uniform(OCEAN_DEFAULTS.foamBandWidth);
  u.foamIntensity      = uniform(OCEAN_DEFAULTS.foamIntensity);
  u.foamSharpness      = uniform(OCEAN_DEFAULTS.foamSharpness);
  u.foamNoiseAmt       = uniform(OCEAN_DEFAULTS.foamNoiseAmt);
  u.foamNoiseScale     = uniform(OCEAN_DEFAULTS.foamNoiseScale);
  u.foamNoiseSpeed     = uniform(OCEAN_DEFAULTS.foamNoiseSpeed);
  u.foamFineScale      = uniform(OCEAN_DEFAULTS.foamFineScale);
  u.foamFineAmt        = uniform(OCEAN_DEFAULTS.foamFineAmt);
  u.foamFineSpeed      = uniform(OCEAN_DEFAULTS.foamFineSpeed);
  u.foamContrast       = uniform(OCEAN_DEFAULTS.foamContrast);
  u.foamCutoff         = uniform(OCEAN_DEFAULTS.foamCutoff);
  u.foamTransitionWidth= uniform(OCEAN_DEFAULTS.foamTransitionWidth);
  u.foamBreatheAmp     = uniform(OCEAN_DEFAULTS.foamBreatheAmp);
  u.foamBreatheHz      = uniform(OCEAN_DEFAULTS.foamBreatheHz);

  const uTerrainSize = uniform(terrainSize);

  // ── Gerstner helpers ─────────────────────────────────────────────────────
  // Per-wave parameters derived from the base uniforms (i is a JS int → the
  // direction offset and falloff exponent are compile-time constants).
  function waveParams(i, xz) {
    const Ai = u.waveAmp.mul(pow(u.waveAmpFalloff, float(i)));
    const Li = u.waveLength.mul(pow(u.waveLenFalloff, float(i)));
    const ki = float(TWO_PI).div(max(Li, float(0.001)));
    const angle = u.windAngle.add(u.windSpread.mul(float(WAVE_DIR_OFFSET[i])));
    const Di = vec2(cos(angle), sin(angle));
    const omega = sqrt(float(GRAVITY).mul(ki)).mul(u.waveSpeed);
    const phase = ki.mul(dot(Di, xz)).sub(omega.mul(u.time));
    const Qi = clamp(
      u.waveSteep.div(ki.mul(Ai).mul(float(N_WAVES)).add(float(1e-4))),
      float(0), float(1),
    );
    return { Ai, ki, Di, phase, Qi };
  }

  /** World-space Gerstner displacement (vec3), faded by ampScale. */
  function gerstnerDisp(xz, ampScale) {
    const dx = float(0).toVar();
    const dy = float(0).toVar();
    const dz = float(0).toVar();
    for (let i = 0; i < N_WAVES; i++) {
      const { Ai, Di, phase, Qi } = waveParams(i, xz);
      const cosP = cos(phase);
      const sinP = sin(phase);
      const qa = Qi.mul(Ai);
      dx.addAssign(qa.mul(Di.x).mul(cosP));
      dz.addAssign(qa.mul(Di.y).mul(cosP));
      dy.addAssign(Ai.mul(sinP));
    }
    return vec3(dx, dy, dz).mul(ampScale);
  }

  /** Gerstner slope contribution to the shading normal (vec2 = X/Z tilt). */
  function gerstnerSlope(xz, ampScale) {
    const sx = float(0).toVar();
    const sz = float(0).toVar();
    for (let i = 0; i < N_WAVES; i++) {
      const { Ai, ki, Di, phase } = waveParams(i, xz);
      const wa = ki.mul(Ai);
      const cosP = cos(phase);
      sx.addAssign(Di.x.mul(wa).mul(cosP));
      sz.addAssign(Di.y.mul(wa).mul(cosP));
    }
    const k = ampScale.mul(u.waveNormalStrength);
    return vec2(sx.negate().mul(k), sz.negate().mul(k));
  }

  /** Distance-based displacement fade for a given world XZ. */
  function ampScaleAt(xz) {
    const dist = length(xz.sub(cameraPosition.xz));
    return saturate(
      float(1).sub(smoothstep(u.dispFadeStart, u.dispFadeEnd, dist)),
    ).mul(u.waveEnabled);
  }

  // ── Vertex stage: CDLOD morph + Gerstner displacement ────────────────────
  // Ring meshes carry per-vertex `aCell` (this LOD's cell size) and `aOuterHalf`
  // (this LOD's half-extent). In the outer band of each ring the vertex is
  // morphed onto the next-coarser grid (cell × 2) so the shared edge with the
  // coarser ring matches exactly — this is what kills the LOD seams once waves
  // displace the surface. The mesh transform is translation-only, so local XZ
  // equals world XZ up to the group offset and morphing in local space is valid.
  const oceanPosition = Fn(() => {
    const localXZ = positionLocal.xz;
    const cell = attribute("aCell", "float");
    const outerHalf = max(attribute("aOuterHalf", "float"), float(1e-3));
    // Square (Chebyshev) radius — the ring boundary is a square at outerHalf.
    const cheb = max(abs(localXZ.x), abs(localXZ.y));
    const morphK = saturate(cheb.div(outerHalf).sub(0.75).div(0.25));
    const grid = cell.mul(2);
    const snapXZ = round(localXZ.div(grid)).mul(grid);
    const morphedXZ = mix(localXZ, snapXZ, morphK);

    const worldBase = modelWorldMatrix.mul(vec4(positionLocal, float(1))).xz;
    const worldXZ = worldBase.add(morphedXZ.sub(localXZ));
    const disp = gerstnerDisp(worldXZ, ampScaleAt(worldXZ));
    return vec3(morphedXZ.x, float(0), morphedXZ.y).add(disp);
  });

  // ── Fragment shader ────────────────────────────────────────────────────────
  const oceanFrag = Fn(() => {
    const wXZ = positionWorld.xz;

    // Single heightmap sample — reused for depth ramp and foam band.
    // Fragments outside the heightmap UV are forced to "deep" to kill horizon artefacts.
    const hUV = vec2(
      wXZ.x.div(uTerrainSize).add(0.5),
      wXZ.y.div(uTerrainSize).add(0.5),
    );
    const insideX = float(1).sub(
      smoothstep(float(0.95), float(1.0), abs(hUV.x.sub(0.5)).mul(2)),
    );
    const insideZ = float(1).sub(
      smoothstep(float(0.95), float(1.0), abs(hUV.y.sub(0.5)).mul(2)),
    );
    const inside = insideX.mul(insideZ);
    const uvClamped = vec2(
      clamp(hUV.x, float(0.001), float(0.999)),
      clamp(hUV.y, float(0.001), float(0.999)),
    );
    const terrainY = texture(heightTex, uvClamped).r;
    const dShoreRaw = u.waterY.sub(terrainY);            // signed, used for foam band
    const dShore    = mix(u.openOceanDepth, dShoreRaw, inside);
    const depth     = max(dShore, float(0));

    // ── Three-stop depth ramp (shore → mid → deep) ──────────────────────────
    const tDepth = float(1)
      .sub(exp(depth.mul(u.depthAbsorb).negate()))
      .saturate();
    const kneeLo = min(u.depthRampShoreMid, u.depthRampMidDeep);
    const kneeHi = max(u.depthRampShoreMid, u.depthRampMidDeep);
    const wShoreMid = smoothstep(float(0), max(kneeLo, float(0.02)), tDepth);
    const wMidDeep  = smoothstep(min(kneeHi, float(0.98)), float(1), tDepth);
    const cShoreMid = mix(u.shoreColor, u.midColor, wShoreMid);
    const absorption = mix(cShoreMid, u.deepColor, wMidDeep).saturate();

    // ── Dual-layer procedural noise normal (fine detail) ────────────────────
    const nSpd = max(u.procNoiseSpeed, float(0.001));
    const scroll1 = vec2(
      u.time.mul(u.surfNoiseSpeed1.mul(nSpd)),
      u.time.mul(u.surfNoiseSpeed1.mul(0.71).mul(nSpd)),
    );
    const scroll2 = vec2(
      u.time.mul(u.surfNoiseSpeed2.mul(nSpd)),
      u.time.mul(u.surfNoiseSpeed2.mul(-0.63).mul(nSpd)),
    );
    const uvN1 = wXZ.mul(u.surfNoiseScale1).add(scroll1);
    const uvN2 = wXZ.mul(u.surfNoiseScale2).add(scroll2);
    const eps  = float(0.065);
    const s10  = mx_noise_float(uvN1);
    const s1x  = mx_noise_float(uvN1.add(vec2(eps, 0)));
    const s1z  = mx_noise_float(uvN1.add(vec2(0, eps)));
    const s20  = mx_noise_float(uvN2);
    const s2x  = mx_noise_float(uvN2.add(vec2(eps.mul(1.15), 0)));
    const s2z  = mx_noise_float(uvN2.add(vec2(0, eps.mul(1.15))));
    const dnx  = s1x.sub(s10).add(s2x.sub(s20).mul(0.62)).mul(u.surfNormalStrength);
    const dnz  = s1z.sub(s10).add(s2z.sub(s20).mul(0.62)).mul(u.surfNormalStrength);

    // ── Gerstner wave slope (matches the vertex displacement field) ─────────
    const ampScaleF = ampScaleAt(wXZ);
    const gSlope = gerstnerSlope(wXZ, ampScaleF);
    const worldN = normalize(vec3(
      dnx.negate().add(gSlope.x),
      float(1),
      dnz.negate().add(gSlope.y),
    ));

    // ── Fresnel (bounded, grazing-tinted toward deep colour) ────────────────
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const NdotV   = max(dot(worldN, viewDir), float(0.001));
    const fresnelRaw = pow(float(1).sub(saturate(NdotV)), u.fresnelExp);
    const fresnel    = min(fresnelRaw, u.fresnelMax);
    // Near-normal view keeps highlightColor; grazing view pulls it toward deepColor.
    const grazing = saturate(float(1).sub(NdotV));
    const hlCol   = mix(u.highlightColor, u.deepColor, pow(grazing, float(1.2)));
    const lit     = absorption.add(hlCol.mul(fresnel).mul(u.fresnelSky));

    // ── Sun glint (Blinn specular off the wave normal) ──────────────────────
    const halfV = normalize(viewDir.add(u.sunDir));
    const spec  = pow(max(dot(worldN, halfV), float(0)), u.glintPower)
      .mul(u.glintIntensity);
    const surfaceColor = lit.add(u.glintColor.mul(spec));

    // ── Coastal foam band (2-octave value noise, breathing shoreline) ───────
    const breath = sin(u.time.mul(u.foamBreatheHz).mul(float(TWO_PI)))
      .mul(u.foamBreatheAmp);
    const dShoreBand = dShoreRaw.add(breath);
    const absD       = abs(dShoreBand);
    const bandBase   = float(1).sub(smoothstep(float(0), u.foamBandWidth, absD));
    const bandShaped = pow(max(bandBase, float(0.0001)), u.foamSharpness);

    const scrollF = vec2(
      u.time.mul(u.foamNoiseSpeed),
      u.time.mul(u.foamNoiseSpeed.mul(0.73)),
    );
    const uvMainF = wXZ.mul(u.foamNoiseScale).add(scrollF);
    const uvFineF = wXZ.mul(u.foamFineScale).add(
      vec2(u.time.mul(u.foamFineSpeed), u.time.mul(u.foamFineSpeed.mul(0.61))),
    );
    const n0 = mx_noise_float(uvMainF).mul(0.5).add(0.5);
    const n1 = mx_noise_float(uvFineF).mul(0.5).add(0.5);
    const nMix     = saturate(n0.add(n1.sub(0.5).mul(u.foamFineAmt)));
    const nShaped  = pow(max(nMix, float(0.0001)), u.foamContrast);
    const noiseBlend = mix(float(1), nShaped, u.foamNoiseAmt);
    const unified  = saturate(bandShaped.mul(noiseBlend));

    const tw = max(u.foamTransitionWidth, float(0.02));
    const lo = max(u.foamCutoff.sub(tw), float(0));
    const hi = min(u.foamCutoff.add(tw), float(1));
    const foamMask = saturate(smoothstep(lo, hi, unified).mul(u.foamIntensity))
      .mul(u.foamEnabled)
      .mul(inside); // no foam outside terrain bounds — open ocean has no shore

    // ── Composite ───────────────────────────────────────────────────────────
    const finalColor = mix(surfaceColor, u.foamColor, foamMask).saturate();
    return vec4(finalColor, u.opacity);
  });

  // ── Build material ─────────────────────────────────────────────────────────
  const fragOut = oceanFrag();
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite:  false,
    side:        THREE.DoubleSide,
    colorNode:   fragOut.rgb,
    opacityNode: fragOut.a,
    positionNode: oceanPosition(),
  });

  // ── syncParams: accept a PARAMS-like object and push into uniforms ─────────
  function syncParams(p) {
    if (!p) return;
    const c = (hex, target) => target.set(hex);

    if (p.shoreColor     != null) c(p.shoreColor,     u.shoreColor.value);
    if (p.midColor       != null) c(p.midColor,       u.midColor.value);
    if (p.deepColor      != null) c(p.deepColor,      u.deepColor.value);
    if (p.highlightColor != null) c(p.highlightColor, u.highlightColor.value);

    if (p.depthAbsorb        != null) u.depthAbsorb.value        = p.depthAbsorb;
    if (p.depthRampShoreMid  != null) u.depthRampShoreMid.value  = p.depthRampShoreMid;
    if (p.depthRampMidDeep   != null) u.depthRampMidDeep.value   = p.depthRampMidDeep;
    if (p.openOceanDepth     != null) u.openOceanDepth.value     = p.openOceanDepth;

    if (p.surfNoiseScale1    != null) u.surfNoiseScale1.value    = p.surfNoiseScale1;
    if (p.surfNoiseScale2    != null) u.surfNoiseScale2.value    = p.surfNoiseScale2;
    if (p.surfNoiseSpeed1    != null) u.surfNoiseSpeed1.value    = p.surfNoiseSpeed1;
    if (p.surfNoiseSpeed2    != null) u.surfNoiseSpeed2.value    = p.surfNoiseSpeed2;
    if (p.procNoiseSpeed     != null) u.procNoiseSpeed.value     = p.procNoiseSpeed;
    if (p.surfNormalStrength != null) u.surfNormalStrength.value = p.surfNormalStrength;

    if (p.waveEnabled        != null) u.waveEnabled.value        = p.waveEnabled ? 1 : 0;
    if (p.waveAmp            != null) u.waveAmp.value            = p.waveAmp;
    if (p.waveLength         != null) u.waveLength.value         = p.waveLength;
    if (p.waveSteep          != null) u.waveSteep.value          = p.waveSteep;
    if (p.waveSpeed          != null) u.waveSpeed.value          = p.waveSpeed;
    if (p.windAngleDeg       != null) u.windAngle.value          = p.windAngleDeg * DEG2RAD;
    if (p.windSpreadDeg      != null) u.windSpread.value         = p.windSpreadDeg * DEG2RAD;
    if (p.waveAmpFalloff     != null) u.waveAmpFalloff.value     = p.waveAmpFalloff;
    if (p.waveLenFalloff     != null) u.waveLenFalloff.value     = p.waveLenFalloff;
    if (p.waveNormalStrength != null) u.waveNormalStrength.value = p.waveNormalStrength;
    if (p.dispFadeStart      != null) u.dispFadeStart.value      = p.dispFadeStart;
    if (p.dispFadeEnd        != null) u.dispFadeEnd.value        = p.dispFadeEnd;

    if (p.glintColor     != null) c(p.glintColor, u.glintColor.value);
    if (p.glintIntensity != null) u.glintIntensity.value = p.glintIntensity;
    if (p.glintPower     != null) u.glintPower.value     = p.glintPower;
    if (p.sunDir         != null) u.sunDir.value.copy(p.sunDir).normalize();

    if (p.fresnelExp != null) u.fresnelExp.value = p.fresnelExp;
    if (p.fresnelSky != null) u.fresnelSky.value = p.fresnelSky;
    if (p.fresnelMax != null) u.fresnelMax.value = p.fresnelMax;

    if (p.opacity != null) u.opacity.value = p.opacity;

    if (p.foamEnabled         != null) u.foamEnabled.value         = p.foamEnabled ? 1 : 0;
    if (p.foamColor           != null) c(p.foamColor, u.foamColor.value);
    if (p.foamBandWidth       != null) u.foamBandWidth.value       = p.foamBandWidth;
    if (p.foamIntensity       != null) u.foamIntensity.value       = p.foamIntensity;
    if (p.foamSharpness       != null) u.foamSharpness.value       = p.foamSharpness;
    if (p.foamNoiseAmt        != null) u.foamNoiseAmt.value        = p.foamNoiseAmt;
    if (p.foamNoiseScale      != null) u.foamNoiseScale.value      = p.foamNoiseScale;
    if (p.foamNoiseSpeed      != null) u.foamNoiseSpeed.value      = p.foamNoiseSpeed;
    if (p.foamFineScale       != null) u.foamFineScale.value       = p.foamFineScale;
    if (p.foamFineAmt         != null) u.foamFineAmt.value         = p.foamFineAmt;
    if (p.foamFineSpeed       != null) u.foamFineSpeed.value       = p.foamFineSpeed;
    if (p.foamContrast        != null) u.foamContrast.value        = p.foamContrast;
    if (p.foamCutoff          != null) u.foamCutoff.value          = p.foamCutoff;
    if (p.foamTransitionWidth != null) u.foamTransitionWidth.value = p.foamTransitionWidth;
    if (p.foamBreatheAmp      != null) u.foamBreatheAmp.value      = p.foamBreatheAmp;
    if (p.foamBreatheHz       != null) u.foamBreatheHz.value       = p.foamBreatheHz;
  }

  /**
   * Call each frame.
   * @param {number}       dt       delta seconds (unused but kept for API parity)
   * @param {number}       elapsed  total elapsed seconds
   * @param {THREE.Mesh[]} meshes   ocean mesh(es) — waterY is read from meshes[0].position.y
   */
  function update(dt, elapsed, meshes) {
    u.time.value = elapsed;
    if (meshes && meshes.length > 0) {
      u.waterY.value = meshes[0].position.y;
    }
  }

  return { material, uniforms: u, syncParams, update };
}
