/**
 * ocean-shader.js — Minimal stylized ocean shader (TSL / WebGPU)
 *
 * Designed for large open-ocean planes on top of a terrain heightmap. Features:
 *   - Three-stop turquoise depth ramp (shore → mid → deep) from seabed sample
 *   - Dual-layer mx_noise_float gradient normals (6 samples, cheap)
 *   - Perturbed Fresnel with bounded contribution — grazing angles tint toward
 *     `deepColor` instead of the sky, so the horizon never reads grey/white
 *   - Animated coastal foam band (2-octave value noise + shoreline breathing)
 *   - Single heightmap texture fetch per fragment (reused for depth and foam)
 *   - Open-water-outside-terrain fallback: fragments beyond the heightmap read
 *     as deep, eliminating the “invalid sample horizon” problem
 *
 * Deliberately excludes (keep later as options, not baseline cost):
 *   Worley/FBM shore foam, pulse rings, shore contact α, caustic foam,
 *   planar reflections, vertex displacement, whole-lake bob.
 *
 * Usage:
 *   import { createOceanShader, OCEAN_DEFAULTS } from "./ocean-shader.js";
 *   const ocean = createOceanShader({ heightTex, terrainSize: 800 });
 *   const mesh  = new THREE.Mesh(planeGeo, ocean.material);
 *   // Each frame:
 *   ocean.update(dt, elapsedSec, [mesh]);
 *   // To push a PARAMS object:
 *   ocean.syncParams(PARAMS.ocean);
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  Fn, uniform, float, vec2, vec3, vec4,
  mix, smoothstep, sin, dot, length,
  min, max, exp, abs, pow, saturate, clamp,
  normalize, texture, positionWorld, cameraPosition, mx_noise_float,
} from "three/tsl";

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

  // Surface normals
  surfNoiseScale1:    0.06,
  surfNoiseScale2:    0.13,
  surfNoiseSpeed1:    0.22,
  surfNoiseSpeed2:   -0.16,
  procNoiseSpeed:     1.0,
  surfNormalStrength: 0.28,

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

// ─── Factory ─────────────────────────────────────────────────────────────────
/**
 * @param {object} deps
 * @param {THREE.Texture} deps.heightTex — heightmap DataTexture (R = seabed world Y)
 * @param {number}        deps.terrainSize — world size of the terrain (e.g. 800)
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

  // Normals
  u.surfNoiseScale1    = uniform(OCEAN_DEFAULTS.surfNoiseScale1);
  u.surfNoiseScale2    = uniform(OCEAN_DEFAULTS.surfNoiseScale2);
  u.surfNoiseSpeed1    = uniform(OCEAN_DEFAULTS.surfNoiseSpeed1);
  u.surfNoiseSpeed2    = uniform(OCEAN_DEFAULTS.surfNoiseSpeed2);
  u.procNoiseSpeed     = uniform(OCEAN_DEFAULTS.procNoiseSpeed);
  u.surfNormalStrength = uniform(OCEAN_DEFAULTS.surfNormalStrength);

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

    // ── Dual-layer procedural normals (6 mx_noise_float samples) ────────────
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
    const worldN = normalize(vec3(dnx.negate(), float(1), dnz.negate()));

    // ── Fresnel (bounded, grazing-tinted toward deep colour) ────────────────
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const NdotV   = max(dot(worldN, viewDir), float(0.001));
    const fresnelRaw = pow(float(1).sub(saturate(NdotV)), u.fresnelExp);
    const fresnel    = min(fresnelRaw, u.fresnelMax);
    // Near-normal view keeps highlightColor; grazing view pulls it toward deepColor.
    // This is the key anti-grey-horizon trick: even at `fresnel → max`, the tint
    // contribution is already dark, so far water stays turquoise instead of white.
    const grazing = saturate(float(1).sub(NdotV));
    const hlCol   = mix(u.highlightColor, u.deepColor, pow(grazing, float(1.2)));
    const surfaceColor = absorption.add(hlCol.mul(fresnel).mul(u.fresnelSky));

    // ── Coastal foam band (2-octave value noise, breathing shoreline) ───────
    // `breath` pushes the band in/out each cycle — waves washing up the shore.
    const breath = sin(u.time.mul(u.foamBreatheHz).mul(float(6.2831853)))
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
   * @param {number}       dt       delta seconds (unused but kept for API parity with lake-shader)
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
