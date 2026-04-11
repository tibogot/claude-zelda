/**
 * Gemini grass — arc-bending, Voronoi clumping, crossed ribbons, SSS, dual specular.
 * Drop-in replacement for grass-painter7.js with the same editor interface pattern.
 *
 * Exports:
 *   createBladeGeometry(height, baseWidth, ySegments, taperStart)
 *   createFieldInstancedGeometry(baseBlade, patchSize, numGrass, bladeHeight, includeCross)
 *   createGrassMaterial(ctx)
 *   setupGrassPatches(scene, camera, grassGroup, geosAndMats, options)
 */
import * as THREE from "three";
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  attribute,
  varying,
  texture,
  mix,
  smoothstep,
  clamp,
  abs,
  sin,
  cos,
  fract,
  floor,
  dot,
  normalize,
  length,
  negate,
  add,
  sub,
  div,
  max,
  min,
  pow,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  cameraPosition,
  normalLocal,
  positionLocal,
  time,
  uv,
  atan,
  PI,
  mx_noise_float,
  reflect,
} from "three/tsl";
import { hash42, hash22 } from "./tsl-utils.js";

// ─── Constants ───
export const GRASS_PATCH_SIZE = 10; // default patch size (world units)

// ─── Tapered blade geometry ───
// Triangular tip cap, smooth taper from taperStart to apex.
export function createBladeGeometry(
  height,
  baseWidth,
  ySegments,
  taperStart = 0.7,
) {
  const taper = THREE.MathUtils.clamp(taperStart, 0.05, 0.999);
  const baseHalf = baseWidth * 0.5;
  const positions = [];
  const uvs = [];
  const indices = [];
  const rowVertCount = [];
  const rowBase = [];
  let v = 0;

  for (let j = 0; j <= ySegments; j++) {
    const t = j / ySegments;
    const y = t * height;
    rowBase[j] = v;

    if (j === ySegments) {
      // Apex — single vertex
      positions.push(0, y, 0);
      uvs.push(0.5, t);
      rowVertCount.push(1);
      v += 1;
    } else {
      const s = THREE.MathUtils.smoothstep(t, taper, 1);
      const w = baseHalf * (1 - s);
      positions.push(-w, y, 0, w, y, 0);
      uvs.push(0, t, 1, t);
      rowVertCount.push(2);
      v += 2;
    }
  }

  for (let j = 0; j < ySegments; j++) {
    const a0 = rowBase[j];
    const a1 = rowBase[j] + 1;
    const b0 = rowBase[j + 1];
    if (rowVertCount[j + 1] === 2) {
      const b1 = b0 + 1;
      indices.push(a0, a1, b1, a0, b1, b0);
    } else {
      indices.push(a0, a1, b0);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ─── Instanced field geometry ───
// Grid + jitter placement. `includeCross` adds a second ribbon at +90°.
export function createFieldInstancedGeometry(
  baseBlade,
  patchSize,
  numGrass,
  bladeHeight,
  includeCross = true,
) {
  const numCellsX = Math.max(1, Math.ceil(Math.sqrt(numGrass)));
  const numCellsZ = Math.max(1, Math.ceil(numGrass / numCellsX));
  const cellW = patchSize / numCellsX;
  const cellH = patchSize / numCellsZ;
  const total = includeCross ? numGrass * 2 : numGrass;
  const offsets = new Float32Array(total * 3);
  const phases = new Float32Array(total);
  const isCrossArr = new Float32Array(total);

  for (let i = 0; i < numGrass; i++) {
    const col = i % numCellsX;
    const row = Math.floor(i / numCellsX);
    const x = -patchSize * 0.5 + col * cellW + Math.random() * cellW;
    const z = -patchSize * 0.5 + row * cellH + Math.random() * cellH;
    const phase = Math.random() * Math.PI * 2;
    offsets[i * 3] = x;
    offsets[i * 3 + 1] = 0;
    offsets[i * 3 + 2] = z;
    phases[i] = phase;
    isCrossArr[i] = 0;
    if (includeCross) {
      offsets[(i + numGrass) * 3] = x;
      offsets[(i + numGrass) * 3 + 1] = 0;
      offsets[(i + numGrass) * 3 + 2] = z;
      phases[i + numGrass] = phase;
      isCrossArr[i + numGrass] = 1;
    }
  }

  const ig = new THREE.InstancedBufferGeometry();
  if (baseBlade.index) ig.index = baseBlade.index.clone();
  ig.setAttribute("position", baseBlade.attributes.position.clone());
  ig.setAttribute("uv", baseBlade.attributes.uv.clone());
  if (baseBlade.attributes.normal) {
    ig.setAttribute("normal", baseBlade.attributes.normal.clone());
  }
  ig.setAttribute("offset", new THREE.InstancedBufferAttribute(offsets, 3));
  ig.setAttribute("aPhase", new THREE.InstancedBufferAttribute(phases, 1));
  ig.setAttribute(
    "aIsCross",
    new THREE.InstancedBufferAttribute(isCrossArr, 1),
  );
  ig.instanceCount = total;

  const half = patchSize * 0.5;
  const r = Math.sqrt(half * half * 2 + bladeHeight * bladeHeight) + 2;
  ig.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, bladeHeight * 0.5, 0),
    r,
  );
  return ig;
}

// ─── TSL Material ───
// All uniforms come from the caller (editor) via `ctx`.
//
// Required ctx fields:
//   heightTex, grassDensityTex      — DataTexture objects
//   terrainRes                      — number (heightmap resolution, for texel size)
// Optional ctx fields (cliff layer — merged into single system):
//   cliffHeightTex                  — DataTexture (cliff surface Y, -9999 elsewhere)
//   cliffDensityTex                 — Texture (painted cliff grass density)
//   uTerrainSize                    — uniform(float)
//   uSunDir                         — uniform(Vector3)
//   uPlayerPos                      — uniform(Vector3)
//   uBladeHeight                    — uniform(float)
//   uGrassDensity                   — uniform(float)
//   uWindSpeed, uWindStrength       — uniform(float)
//   uMaxAngle, uNaturalLean         — uniform(float)
//   uWindDirX, uWindDirZ            — uniform(float)
//   uWindWaveScale, uWindGust       — uniform(float)
//   uBendFocus, uStiffness          — uniform(float)
//   uClumpScale, uClumpStrength     — uniform(float)
//   uCrossed                        — uniform(float) 0/1
//   uBladeCol, uTipCol              — uniform(Color)
//   uSkyBlend                       — uniform(float)
//   uCylindrical                    — uniform(float)
//   uViewThicken                    — uniform(float)
//   uAoBase, uAoPower               — uniform(float)
//   uColorVar                       — uniform(float) 0/1
//   uCvHueSpread, uCvSatSpread      — uniform(float)
//   uCvDryAmount, uCvDryCol         — uniform(Color)
//   uBssCol                         — uniform(Color)
//   uBssIntensity, uBssPower        — uniform(float)
//   uFrontScatter, uRimSSS          — uniform(float)
//   uSpecV1Enabled, uSpecV1Intensity — uniform(float)
//   uSpecV1Col                      — uniform(Color)
//   uSpecV1Dir                      — uniform(Vector3)
//   uSpecV1Power                    — uniform(float)
//   uSpecV2Enabled, uSpecV2Intensity — uniform(float)
//   uSpecV2Col                      — uniform(Color)
//   uSpecV2Dir                      — uniform(Vector3)
//   uSpecV2NoiseScale, uSpecV2NoiseStr — uniform(float)
//   uSpecV2Power, uSpecV2TipBias    — uniform(float)
//   uLodEnabled                     — uniform(float) 0/1
//   uLodMidDist, uLodFarDist        — uniform(float)
//   uLodMaxDist, uLodFadeStart      — uniform(float)
//   uLodDebug                       — uniform(float) 0/1
//   uInteractionEnabled             — uniform(float) 0/1
//   uInteractionRadius              — uniform(float)
//   uInteractionStrength            — uniform(float)
//
// 1×1 dummy textures for optional cliff layer (reused across calls)
let _dummyCliffHTex = null;
let _dummyCliffDTex = null;
function _getDummyCliffHTex() {
  if (!_dummyCliffHTex) {
    const d = new Float32Array(4);
    d[0] = d[1] = d[2] = -99999;
    d[3] = 1;
    _dummyCliffHTex = new THREE.DataTexture(
      d,
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    _dummyCliffHTex.needsUpdate = true;
  }
  return _dummyCliffHTex;
}
function _getDummyCliffDTex() {
  if (!_dummyCliffDTex) {
    const d = new Float32Array(4);
    _dummyCliffDTex = new THREE.DataTexture(
      d,
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    _dummyCliffDTex.needsUpdate = true;
  }
  return _dummyCliffDTex;
}

export function createGrassMaterial(ctx) {
  const {
    heightTex,
    grassDensityTex,
    cliffHeightTex: _cliffHTex,
    cliffDensityTex: _cliffDTex,
    terrainRes,
    uTerrainSize,
    uSunDir,
    uPlayerPos,
    uBladeHeight,
    uGrassDensity,
    uWindSpeed,
    uWindStrength,
    uMaxAngle,
    uNaturalLean,
    uWindDirX,
    uWindDirZ,
    uWindWaveScale,
    uWindGust,
    uBendFocus,
    uStiffness,
    uClumpScale,
    uClumpStrength,
    uCrossed,
    uBladeCol,
    uTipCol,
    uSkyBlend,
    uCylindrical,
    uViewThicken,
    uAoBase,
    uAoPower,
    uColorVar,
    uCvHueSpread,
    uCvSatSpread,
    uCvDryAmount,
    uCvDryCol,
    uBssCol,
    uBssIntensity,
    uBssPower,
    uFrontScatter,
    uRimSSS,
    uSpecV1Enabled,
    uSpecV1Intensity,
    uSpecV1Col,
    uSpecV1Dir,
    uSpecV1Power,
    uSpecV2Enabled,
    uSpecV2Intensity,
    uSpecV2Col,
    uSpecV2Dir,
    uSpecV2NoiseScale,
    uSpecV2NoiseStr,
    uSpecV2Power,
    uSpecV2TipBias,
    uLodEnabled,
    uLodMidDist,
    uLodFarDist,
    uLodMaxDist,
    uLodFadeStart,
    uLodDebug,
    uInteractionEnabled,
    uInteractionRadius,
    uInteractionStrength,
  } = ctx;

  const cliffHTex = _cliffHTex ?? _getDummyCliffHTex();
  const cliffDTex = _cliffDTex ?? _getDummyCliffDTex();

  // Varyings shared between vertex → fragment
  const vLodMorph = varying(float(0), "v_gm_lm");
  const vDistFade = varying(float(1), "v_gm_df");
  const vCustomNormal = varying(vec3(0, 1, 0), "v_gm_cn");
  const vClumpShade = varying(float(1), "v_gm_cs");
  const vColorTint = varying(vec3(1, 1, 1), "v_gm_ct");
  const vDryBlend = varying(float(0), "v_gm_db");
  const vRandomShade = varying(float(1), "v_gm_rs");
  const vSatHash = varying(float(0), "v_gm_sh");

  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.FrontSide,
    roughness: 0.92,
    metalness: 0,
  });
  material.envMapIntensity = 0;
  material.polygonOffset = true;
  material.polygonOffsetFactor = 1;
  material.polygonOffsetUnits = 1;

  const vUv = uv();

  // Y-axis rotation helper
  const rotY = (ang, v) => {
    const c = cos(ang),
      s = sin(ang);
    return vec3(
      v.x.mul(c).add(v.z.mul(s)),
      v.y,
      negate(v.x).mul(s).add(v.z.mul(c)),
    );
  };

  // ════════════════════════════════════════════════════════════
  // POSITION NODE — vertex shader
  // ════════════════════════════════════════════════════════════
  material.positionNode = Fn(() => {
    const off = attribute("offset", "vec3");
    const aPhase = attribute("aPhase", "float");
    const aIsCross = attribute("aIsCross", "float");
    const tBase = time.mul(uWindSpeed);
    const tBlade = tBase.add(aPhase);

    // World-space blade root
    const bladeWorld = modelWorldMatrix.mul(
      vec4(off.x, float(0), off.z, float(1)),
    ).xyz;
    const bladeXZ = vec2(bladeWorld.x, bladeWorld.z);

    // ── Heightmap sampling ──
    const terrainUV = add(div(bladeXZ, uTerrainSize), vec2(0.5));
    const terrainH = texture(heightTex, terrainUV).x;

    // ── Cliff layer sampling (optional — dummy textures produce useCliff=0) ──
    const cliffH = texture(cliffHTex, terrainUV).x;
    const cliffD = texture(cliffDTex, terrainUV).x;
    const cliffValid = smoothstep(float(-9990), float(-9000), cliffH);
    const cliffPainted = smoothstep(float(0.01), float(0.03), cliffD);
    const useCliff = cliffValid.mul(cliffPainted);

    const finalH = mix(terrainH, cliffH, useCliff);

    // ── Terrain normal via central differences ──
    const texelSize = float(1).div(float(terrainRes));
    const uvL = terrainUV.add(vec2(negate(texelSize), float(0)));
    const uvR = terrainUV.add(vec2(texelSize, float(0)));
    const uvD = terrainUV.add(vec2(float(0), negate(texelSize)));
    const uvU = terrainUV.add(vec2(float(0), texelSize));

    const hL = texture(heightTex, uvL).x;
    const hR = texture(heightTex, uvR).x;
    const hD = texture(heightTex, uvD).x;
    const hU = texture(heightTex, uvU).x;
    const worldStep = uTerrainSize.div(float(terrainRes));
    const tNorm = normalize(
      vec3(hL.sub(hR), worldStep.mul(float(2)), hD.sub(hU)),
    );

    // Cliff normal — clamp -9999 neighbors to center to avoid wild gradients at cliff edges
    const chL = texture(cliffHTex, uvL).x;
    const chR = texture(cliffHTex, uvR).x;
    const chD = texture(cliffHTex, uvD).x;
    const chU = texture(cliffHTex, uvU).x;
    const chLs = mix(cliffH, chL, smoothstep(float(-9990), float(-9000), chL));
    const chRs = mix(cliffH, chR, smoothstep(float(-9990), float(-9000), chR));
    const chDs = mix(cliffH, chD, smoothstep(float(-9990), float(-9000), chD));
    const chUs = mix(cliffH, chU, smoothstep(float(-9990), float(-9000), chU));
    const cNorm = normalize(
      vec3(chLs.sub(chRs), worldStep.mul(float(2)), chDs.sub(chUs)),
    );

    const terrainNormal = normalize(mix(tNorm, cNorm, useCliff));

    // ── LOD morph + distance fade ──
    const camXZ = vec2(cameraPosition.x, cameraPosition.z);
    const bladeCamDist = length(bladeXZ.sub(camXZ));
    const morphToMid = smoothstep(
      uLodMidDist.mul(float(0.6)),
      uLodMidDist,
      bladeCamDist,
    );
    const morphToFar = smoothstep(
      uLodFarDist.mul(float(0.8)),
      uLodFarDist,
      bladeCamDist,
    );
    const lodMorph = uLodEnabled.mul(
      mix(
        morphToMid.mul(float(0.5)),
        float(0.5).add(morphToFar.mul(float(0.5))),
        morphToFar,
      ),
    );
    vLodMorph.assign(lodMorph);
    const farMorph = smoothstep(float(0.5), float(1.0), lodMorph);

    // Distance fade — squared falloff, prevents hard cutoff at field edge
    const fadeBegin = uLodMaxDist.mul(uLodFadeStart);
    const distFadeLinear = smoothstep(uLodMaxDist, fadeBegin, bladeCamDist);
    const distFade = distFadeLinear.mul(distFadeLinear);
    vDistFade.assign(distFade);

    // ── Painted density (cliff density overrides terrain when cliff surface exists) ──
    const terrainDensity = texture(grassDensityTex, terrainUV).x;
    const paintedDensity = max(terrainDensity, cliffD.mul(useCliff));
    const hasDensity = smoothstep(float(0.0), float(0.005), paintedDensity);

    // ── Per-blade randomization (4 decorrelated outputs) ──
    const hv = hash42(bladeXZ);
    const h0 = hv.x; // yaw
    const h1 = hv.y; // shade
    const h2 = hv.z; // height scale
    const h3 = hv.w; // lean angle

    // Stochastic density culling (decorrelated hash)
    const densityHv = hash22(bladeXZ.add(vec2(853.1, 137.9)));
    const densityHash = densityHv.x;
    const densityCull = smoothstep(
      uGrassDensity.mul(paintedDensity),
      uGrassDensity.mul(paintedDensity).add(float(0.01)),
      densityHash,
    )
      .oneMinus()
      .mul(hasDensity);

    // ── Voronoi clumping ──
    const cellP = bladeXZ.div(uClumpScale);
    const cellID = cellP.floor();
    const cellFrac = fract(cellP);
    const cv = hash42(cellID);
    const cA = cv.x;
    const cB = cv.y;
    const cC = cv.z;
    const cD = cv.w;
    const clumpDist = length(vec2(cA, cB).sub(cellFrac));
    const clumpInfluence = smoothstep(float(0.75), float(0.05), clumpDist)
      .mul(uClumpStrength)
      .mul(float(1).sub(farMorph));

    const randomYaw = mix(h0.mul(PI.mul(2)), cC.mul(PI.mul(2)), clumpInfluence);
    const hScale = mix(float(0.75), float(1.5), h2);
    const clumpHeightScale = mix(float(0.6), float(1.4), cA);
    const naturalLean = mix(
      h3.mul(uNaturalLean),
      cD.mul(uNaturalLean),
      clumpInfluence,
    );
    const bladeH = uBladeHeight.mul(
      mix(hScale, clumpHeightScale, clumpInfluence),
    );

    // Cross ribbon: +90° yaw, collapsed when uCrossed=0
    const crossedYaw = randomYaw.add(aIsCross.mul(PI.mul(0.5)));
    const crossedBladeH = bladeH.mul(mix(float(1.0), uCrossed, aIsCross));
    const finalBladeH = crossedBladeH.mul(distFade).mul(densityCull);

    // Clump shade varying
    vClumpShade.assign(
      mix(float(1.0), mix(float(0.82), float(1.18), cB), clumpInfluence),
    );

    // ── Color variation hashes (vertex-side for precision) ──
    const hv2 = hash22(bladeXZ.add(vec2(537.3, 197.1)));
    const h4 = hv2.x;
    const h5 = hv2.y;
    const warmCol = vec3(0.18, 0.28, 0.02);
    const coolCol = vec3(0.02, 0.18, 0.08);
    const tintTarget = mix(warmCol, coolCol, h4);
    vColorTint.assign(mix(tintTarget, vec3(1, 1, 1), farMorph));
    const isDry = smoothstep(uCvDryAmount, float(0.0), h5);
    vDryBlend.assign(isDry.mul(float(1).sub(farMorph)));

    // Per-blade shade + sat hash — computed here (vertex) to avoid fragment precision noise
    vRandomShade.assign(mix(float(0.75), float(1.0), h1));
    vSatHash.assign(hv2.y);

    // ── Arc bending ──
    const baseStiffness = smoothstep(0.0, uStiffness, vUv.y);
    const curveWeight = vUv.y.pow(uBendFocus).mul(baseStiffness);

    // Traveling wind wave (mx_noise_float for 3D noise)
    const waveUV = vec3(
      bladeWorld.x.mul(uWindWaveScale).add(uWindDirX.mul(tBase)),
      float(0),
      bladeWorld.z.mul(uWindWaveScale).add(uWindDirZ.mul(tBase)),
    );
    const wave = mx_noise_float(waveUV);

    // Gust layer — added BEFORE room scaling so gusts never exceed maxAngle
    const gustUV = vec3(
      bladeWorld.x
        .mul(uWindWaveScale)
        .mul(float(0.25))
        .add(uWindDirX.mul(tBase).mul(float(0.3))),
      float(0),
      bladeWorld.z
        .mul(uWindWaveScale)
        .mul(float(0.25))
        .add(uWindDirZ.mul(tBase).mul(float(0.3))),
    );
    const gustRaw = mx_noise_float(gustUV);
    const gustStr = smoothstep(float(0.5), float(0.9), gustRaw).mul(uWindGust);
    const windBase = wave.add(float(0.4)).add(gustStr);
    const windMicro = mx_noise_float(tBlade.mul(float(4.0))).mul(float(0.15));
    const windMicroLod = windMicro.mul(float(1).sub(lodMorph));

    // Room = remaining angle budget after natural lean
    const room = max(float(0), uMaxAngle.sub(naturalLean));
    const windScaled = windBase
      .add(windMicroLod)
      .mul(uWindStrength)
      .mul(room.div(uMaxAngle));
    const totalForce = naturalLean.add(windScaled);
    const angle = totalForce.mul(curveWeight);

    // Arc position
    const L = vUv.y.mul(finalBladeH);
    const arcX = sin(angle).mul(L);
    const arcY = cos(angle).mul(L);

    // Cross-direction sway
    const zWaveUV = vec3(
      bladeWorld.z
        .mul(uWindWaveScale)
        .add(uWindDirZ.mul(tBase))
        .add(float(17.3)),
      float(0),
      bladeWorld.x
        .mul(uWindWaveScale)
        .sub(uWindDirX.mul(tBase))
        .add(float(31.7)),
    );
    const zRollPhase = mx_noise_float(zWaveUV).mul(float(0.4)).sub(float(0.2));
    const arcZ = sin(zRollPhase)
      .mul(L)
      .mul(curveWeight)
      .mul(0.2)
      .mul(float(1).sub(lodMorph));

    // ── Spine tangent + cylindrical normals ──
    const ty = vUv.y;
    const eps = float(0.02);
    const tp = min(ty.add(eps), float(1));
    const tm = max(ty.sub(eps), float(0));

    const bsP = smoothstep(0.0, uStiffness, tp);
    const cwP = tp.pow(uBendFocus).mul(bsP);
    const angP = totalForce.mul(cwP);
    const lenP = tp.mul(finalBladeH);
    const sP = vec3(
      sin(angP).mul(lenP),
      cos(angP).mul(lenP),
      sin(zRollPhase).mul(lenP).mul(cwP).mul(0.2),
    );

    const bsM = smoothstep(0.0, uStiffness, tm);
    const cwM = tm.pow(uBendFocus).mul(bsM);
    const angM = totalForce.mul(cwM);
    const lenM = tm.mul(finalBladeH);
    const sM = vec3(
      sin(angM).mul(lenM),
      cos(angM).mul(lenM),
      sin(zRollPhase).mul(lenM).mul(cwM).mul(0.2),
    );

    const T = normalize(sub(sP, sM));
    const gvn = normalize(vec3(float(0), negate(T.z), T.y));

    // Cylindrical normals — fan spread, killed at FAR
    const cylSpread = uCylindrical
      .mul(float(Math.PI * 0.5))
      .mul(float(1).sub(farMorph));
    const nL = normalize(rotY(cylSpread, gvn));
    const nR = normalize(rotY(negate(cylSpread), gvn));
    const fanN = normalize(mix(nL, nR, vUv.x));

    // ── View thickening ──
    const midLocal = vec3(off.x, finalBladeH.mul(float(0.5)), off.z);
    const worldMid = modelWorldMatrix.mul(vec4(midLocal, 1)).xyz;
    const toCamW = normalize(sub(cameraPosition, worldMid));
    const viewL = normalize(
      modelWorldMatrixInverse.mul(vec4(toCamW, float(0))).xyz,
    );
    const lenXZ = length(vec2(viewL.x, viewL.z));
    const faceZ = abs(dot(viewL, vec3(float(0), float(0), float(1))));
    const edgeOn = smoothstep(float(0.12), float(0.55), sub(1, faceZ)).mul(
      smoothstep(float(0.08), float(0.35), lenXZ),
    );
    const yawMax = float(0.55);
    const deltaYaw = uViewThicken
      .mul(edgeOn)
      .mul(yawMax)
      .mul(atan(viewL.x, viewL.z))
      .mul(float(1).sub(farMorph));

    // Compose position — zero out width when density is 0
    const pArc = vec3(
      arcX.add(positionLocal.x.mul(densityCull)),
      arcY,
      arcZ.add(positionLocal.z.mul(densityCull)),
    );
    const pYaw = rotY(crossedYaw, pArc);
    const nYaw = normalize(rotY(crossedYaw, fanN));
    const pOut = rotY(deltaYaw, pYaw);
    const nOut = normalize(rotY(deltaYaw, nYaw));

    // ── Player interaction ──
    const playerXZ = vec2(uPlayerPos.x, uPlayerPos.z);
    const toBlade = bladeXZ.sub(playerXZ);
    const pDist = length(toBlade);
    const distFalloff = mix(
      float(1),
      float(0),
      smoothstep(float(0.5), uInteractionRadius, pDist),
    );
    const pFall = distFalloff.mul(uInteractionEnabled);
    const pAng = negate(mix(float(0), uInteractionStrength, pFall));
    const pTo = normalize(
      vec3(playerXZ.x.sub(bladeXZ.x), float(0), playerXZ.y.sub(bladeXZ.y)).add(
        vec3(0.001, 0, 0.001),
      ),
    );
    const pAx = vec3(pTo.z, float(0), negate(pTo.x));

    // Rodrigues rotation for interaction
    const intAngle = pAng.mul(vUv.y);
    const cI = cos(intAngle),
      sI = sin(intAngle);
    const pDotAx = dot(vec3(pOut.x, pOut.y, pOut.z), pAx);
    const pCrossAx = vec3(
      pAx.y.mul(pOut.z).sub(pAx.z.mul(pOut.y)),
      pAx.z.mul(pOut.x).sub(pAx.x.mul(pOut.z)),
      pAx.x.mul(pOut.y).sub(pAx.y.mul(pOut.x)),
    );
    const pRotated = vec3(
      pOut.x
        .mul(cI)
        .add(pCrossAx.x.mul(sI))
        .add(pAx.x.mul(pDotAx).mul(float(1).sub(cI))),
      pOut.y
        .mul(cI)
        .add(pCrossAx.y.mul(sI))
        .add(pAx.y.mul(pDotAx).mul(float(1).sub(cI))),
      pOut.z
        .mul(cI)
        .add(pCrossAx.z.mul(sI))
        .add(pAx.z.mul(pDotAx).mul(float(1).sub(cI))),
    );
    // Rotate normal too
    const nDotAx = dot(nOut, pAx);
    const nCrossAx = vec3(
      pAx.y.mul(nOut.z).sub(pAx.z.mul(nOut.y)),
      pAx.z.mul(nOut.x).sub(pAx.x.mul(nOut.z)),
      pAx.x.mul(nOut.y).sub(pAx.y.mul(nOut.x)),
    );
    const nRotated = vec3(
      nOut.x
        .mul(cI)
        .add(nCrossAx.x.mul(sI))
        .add(pAx.x.mul(nDotAx).mul(float(1).sub(cI))),
      nOut.y
        .mul(cI)
        .add(nCrossAx.y.mul(sI))
        .add(pAx.y.mul(nDotAx).mul(float(1).sub(cI))),
      nOut.z
        .mul(cI)
        .add(nCrossAx.z.mul(sI))
        .add(pAx.z.mul(nDotAx).mul(float(1).sub(cI))),
    );

    // Sky blend — tilt normals toward terrain normal
    const lodSkyBlend = mix(uSkyBlend, max(uSkyBlend, float(0.7)), lodMorph);
    const nFinal = normalize(mix(nRotated, terrainNormal, lodSkyBlend));
    normalLocal.assign(nFinal);
    vCustomNormal.assign(nFinal);

    return vec3(
      pRotated.x.add(off.x),
      pRotated.y.add(finalH),
      pRotated.z.add(off.z),
    );
  })();

  // ════════════════════════════════════════════════════════════
  // COLOR NODE — fragment shader (base color)
  // ════════════════════════════════════════════════════════════
  material.colorNode = Fn(() => {
    // AO: LOD-modulated (weaker at distance)
    const aoLod = uAoBase.mul(
      mix(
        float(0.5),
        float(1.0),
        smoothstep(float(0.5), float(0.0), vLodMorph),
      ),
    );
    const ao = mix(aoLod, float(1.0), pow(vUv.y, uAoPower));
    const baseCol = mix(uBladeCol, uTipCol, vUv.y);

    // ── Color variation ──
    const hueCol = mix(baseCol, vColorTint, uCvHueSpread);
    const lum = dot(hueCol, vec3(0.299, 0.587, 0.114));
    const satFactor = float(1.0).sub(vSatHash.mul(uCvSatSpread));
    const satCol = mix(vec3(lum, lum, lum), hueCol, satFactor);
    const dryBlend = vDryBlend.mul(
      float(1.0).sub(vUv.y).mul(float(0.5)).add(float(0.5)),
    );
    const dryCol = mix(satCol, uCvDryCol, dryBlend);
    const variedCol = mix(baseCol, dryCol, uColorVar);

    // Distance fade + clump shade
    const finalCol = variedCol.mul(
      vec3(vRandomShade.mul(vClumpShade).mul(ao).mul(vDistFade)),
    );

    // LOD debug tint
    const dbHigh = vec3(0.2, 1.0, 0.2);
    const dbMid = vec3(1.0, 1.0, 0.2);
    const dbFar = vec3(0.2, 0.4, 1.0);
    const midBlend = smoothstep(float(0.2), float(0.5), vLodMorph);
    const farBlend = smoothstep(float(0.6), float(0.9), vLodMorph);
    const debugTint = mix(mix(dbHigh, dbMid, midBlend), dbFar, farBlend);
    return mix(finalCol, debugTint, uLodDebug);
  })();

  // ════════════════════════════════════════════════════════════
  // EMISSIVE NODE — SSS + dual specular
  // ════════════════════════════════════════════════════════════
  material.emissiveNode = Fn(() => {
    const N = normalize(vCustomNormal);
    const viewDir = normalize(sub(cameraPosition, positionLocal));
    const heightPct = vUv.y;

    // Thickness: base thick, tip thin
    const thickness = float(1).sub(heightPct).mul(float(0.7)).add(float(0.3));
    const transmitCol = mix(
      uBssCol,
      uBssCol.mul(vec3(1.3, 1.1, 0.7)),
      float(1).sub(thickness),
    );

    // 3-component SSS
    const backScat = max(dot(negate(uSunDir), N), float(0));
    const frontScat = max(dot(uSunDir, N), float(0));
    const rim = float(1).sub(max(dot(N, viewDir), float(0)));
    const totalSSS = clamp(
      pow(backScat, uBssPower)
        .mul(thickness)
        .add(pow(frontScat, float(1.5)).mul(thickness).mul(uFrontScatter))
        .add(pow(rim, float(3.0)).mul(thickness).mul(uRimSSS)),
      float(0),
      float(1),
    );

    const farFade = smoothstep(float(0.5), float(1.0), vLodMorph);
    const sssResult = transmitCol
      .mul(float(0.35))
      .mul(totalSSS)
      .mul(uBssIntensity)
      .mul(float(1).sub(farFade));

    // ── Specular V1: sharp directional highlights ──
    const specDistFade = smoothstep(
      float(10),
      float(2),
      length(sub(cameraPosition, positionLocal)),
    );
    const lodSpecFade = float(1).sub(
      smoothstep(float(0.2), float(0.5), vLodMorph),
    );
    const tipFade1 = smoothstep(float(0.5), float(1.0), heightPct);

    const reflV1 = reflect(uSpecV1Dir, N);
    const specDot1 = pow(max(dot(viewDir, reflV1), float(0)), uSpecV1Power);
    const spec1 = uSpecV1Col
      .mul(specDot1)
      .mul(uSpecV1Intensity)
      .mul(specDistFade)
      .mul(tipFade1)
      .mul(lodSpecFade)
      .mul(float(3.0))
      .mul(uSpecV1Enabled);

    // ── Specular V2: noisy textured highlights (3-octave Perlin) ──
    const worldPos = positionLocal;
    const noiseP1 = mx_noise_float(
      vec3(
        worldPos.x.mul(uSpecV2NoiseScale),
        worldPos.y.mul(uSpecV2NoiseScale),
        worldPos.z.mul(uSpecV2NoiseScale),
      ),
    );
    const noiseP2 = mx_noise_float(
      vec3(
        worldPos.x.mul(uSpecV2NoiseScale).add(float(17.3)),
        worldPos.y.mul(uSpecV2NoiseScale).add(float(31.7)),
        worldPos.z.mul(uSpecV2NoiseScale).add(float(47.1)),
      ),
    );
    const noiseP3 = mx_noise_float(
      vec3(
        worldPos.x.mul(uSpecV2NoiseScale).mul(float(2.7)).add(float(59.3)),
        worldPos.y.mul(uSpecV2NoiseScale).mul(float(2.7)).add(float(73.1)),
        worldPos.z.mul(uSpecV2NoiseScale).mul(float(2.7)).add(float(89.7)),
      ),
    );
    const noiseCombined = noiseP1.add(noiseP2).add(noiseP3).mul(float(0.333));
    const perturbedN = normalize(
      mix(N, vec3(noiseCombined, float(1), noiseCombined), uSpecV2NoiseStr),
    );

    const reflV2 = reflect(uSpecV2Dir, perturbedN);
    const specDot2 = pow(max(dot(viewDir, reflV2), float(0)), uSpecV2Power);
    const tipFade2 = smoothstep(
      float(1).sub(uSpecV2TipBias),
      float(1),
      heightPct,
    );
    const spec2 = uSpecV2Col
      .mul(specDot2)
      .mul(uSpecV2Intensity)
      .mul(specDistFade)
      .mul(tipFade2)
      .mul(lodSpecFade)
      .mul(uSpecV2Enabled);

    return sssResult.add(spec1).add(spec2);
  })();

  return material;
}

// ─── 3-Tier LOD Streaming ───
// Camera-relative grid, frustum culling, pooling, hysteresis.
// Returns { update(charPos) } — call every frame.
export function setupGrassPatches(
  scene,
  camera,
  grassGroup,
  geosAndMats,
  options,
) {
  // Read geos via geosAndMats so updateGeometries() can swap them live
  let geoHigh = geosAndMats.geoHigh;
  let geoMid = geosAndMats.geoMid;
  let geoFar = geosAndMats.geoFar;
  const material = geosAndMats.material;
  const {
    patchSize = 10,
    lodMidDistance = 40,
    lodFarDistance = 80,
    maxDistance = 200,
    lodHysteresis = 2,
    lodEnabled = true,
    grassReceiveShadow = true,
    grassCastShadow = false,
    patchSizeMid = patchSize,
    patchSizeFar = patchSize,
  } = options;

  const poolHigh = { meshes: [], idx: 0 };
  const poolMid = { meshes: [], idx: 0 };
  const poolFar = { meshes: [], idx: 0 };

  // Reusable objects — zero allocation per frame
  const _cellPos = new THREE.Vector3();
  const _camPosXZ = new THREE.Vector3();
  const _aabb = new THREE.Box3();
  const _aabbSize = new THREE.Vector3();
  const _frustum = new THREE.Frustum();
  const _projScreenMatrix = new THREE.Matrix4();

  function getMesh(pool, geo) {
    if (pool.idx < pool.meshes.length) return pool.meshes[pool.idx++];
    const m = new THREE.Mesh(geo, material);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    grassGroup.add(m);
    pool.meshes.push(m);
    pool.idx++;
    return m;
  }

  let lastPatchCount = 0;
  let lastHighCount = 0,
    lastMidCount = 0,
    lastFarCount = 0;

  function update(opts = {}) {
    const {
      patchSize: ps = patchSize,
      lodMidDistance: midDist = lodMidDistance,
      lodFarDistance: farDist = lodFarDistance,
      maxDistance: maxDist = maxDistance,
      lodEnabled: useLod = lodEnabled,
      grassReceiveShadow: recvShadow = grassReceiveShadow,
      grassCastShadow: castShadow = grassCastShadow,
      patchSizeMid: psMid = patchSizeMid,
      patchSizeFar: psFar = patchSizeFar,
    } = opts;

    // Hide all, reset pools
    for (const child of grassGroup.children) child.visible = false;
    poolHigh.idx = 0;
    poolMid.idx = 0;
    poolFar.idx = 0;

    // Frustum
    _projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    _camPosXZ.set(camera.position.x, 0, camera.position.z);

    let patchCount = 0;
    let highCount = 0,
      midCount = 0,
      farCount = 0;

    // ── HIGH tier grid (spacing = ps) ──
    // Track HIGH coverage so MID/FAR can skip fully-covered cells
    const highMaxEdge = useLod ? midDist + lodHysteresis : maxDist;
    {
      const snapX = Math.floor(camera.position.x / ps) * ps;
      const snapZ = Math.floor(camera.position.z / ps) * ps;
      const cells = Math.ceil(highMaxEdge / ps) + 1;
      _aabbSize.set(ps, 1000, ps);

      for (let r = -cells; r <= cells; r++) {
        for (let c = -cells; c <= cells; c++) {
          const cellX = snapX + c * ps;
          const cellZ = snapZ + r * ps;
          _cellPos.set(cellX, 0, cellZ);
          _aabb.setFromCenterAndSize(_cellPos, _aabbSize);
          const dist = _aabb.distanceToPoint(_camPosXZ);
          if (dist > highMaxEdge) continue;
          if (!_frustum.intersectsBox(_aabb)) continue;

          const mesh = getMesh(poolHigh, geoHigh);
          mesh.geometry = geoHigh;
          mesh.visible = true;
          mesh.position.set(cellX, 0, cellZ);
          mesh.scale.set(1, 1, 1);
          mesh.receiveShadow = recvShadow;
          mesh.castShadow = castShadow;
          highCount++;
          patchCount++;
        }
      }
    }

    // ── MID tier grid (spacing = psMid) ──
    // Skip cells whose farthest corner is inside HIGH zone (fully covered).
    // Cells that partially overlap HIGH are still rendered — overlap is OK,
    // blade hashing + density culling prevent visual doubling.
    const midMaxEdge = farDist + lodHysteresis;
    if (useLod) {
      const snapX = Math.floor(camera.position.x / psMid) * psMid;
      const snapZ = Math.floor(camera.position.z / psMid) * psMid;
      const cells = Math.ceil((midMaxEdge + psMid) / psMid) + 1;
      _aabbSize.set(psMid, 1000, psMid);
      const halfMid = psMid * 0.5;

      for (let r = -cells; r <= cells; r++) {
        for (let c = -cells; c <= cells; c++) {
          const cellX = snapX + c * psMid;
          const cellZ = snapZ + r * psMid;
          _cellPos.set(cellX, 0, cellZ);
          _aabb.setFromCenterAndSize(_cellPos, _aabbSize);
          const dist = _aabb.distanceToPoint(_camPosXZ);
          if (dist > midMaxEdge) continue;
          // Skip if the farthest corner of this cell is still inside HIGH zone
          const farthestCornerDist = Math.sqrt(
            Math.pow(
              Math.max(Math.abs(cellX - camera.position.x) + halfMid, 0),
              2,
            ) +
              Math.pow(
                Math.max(Math.abs(cellZ - camera.position.z) + halfMid, 0),
                2,
              ),
          );
          if (farthestCornerDist < midDist - lodHysteresis) continue;
          if (!_frustum.intersectsBox(_aabb)) continue;

          const mesh = getMesh(poolMid, geoMid);
          mesh.geometry = geoMid;
          mesh.visible = true;
          mesh.position.set(cellX, 0, cellZ);
          mesh.scale.set(1, 1, 1);
          mesh.receiveShadow = recvShadow;
          mesh.castShadow = castShadow;
          midCount++;
          patchCount++;
        }
      }
    }

    // ── FAR tier grid (spacing = psFar) ──
    if (useLod) {
      const snapX = Math.floor(camera.position.x / psFar) * psFar;
      const snapZ = Math.floor(camera.position.z / psFar) * psFar;
      const cells = Math.ceil((maxDist + psFar) / psFar) + 1;
      _aabbSize.set(psFar, 1000, psFar);
      const halfFar = psFar * 0.5;

      for (let r = -cells; r <= cells; r++) {
        for (let c = -cells; c <= cells; c++) {
          const cellX = snapX + c * psFar;
          const cellZ = snapZ + r * psFar;
          _cellPos.set(cellX, 0, cellZ);
          _aabb.setFromCenterAndSize(_cellPos, _aabbSize);
          const dist = _aabb.distanceToPoint(_camPosXZ);
          if (dist > maxDist) continue;
          // Skip if the farthest corner is still inside MID zone
          const farthestCornerDist = Math.sqrt(
            Math.pow(
              Math.max(Math.abs(cellX - camera.position.x) + halfFar, 0),
              2,
            ) +
              Math.pow(
                Math.max(Math.abs(cellZ - camera.position.z) + halfFar, 0),
                2,
              ),
          );
          if (farthestCornerDist < farDist - lodHysteresis) continue;
          if (!_frustum.intersectsBox(_aabb)) continue;

          const mesh = getMesh(poolFar, geoFar);
          mesh.geometry = geoFar;
          mesh.visible = true;
          mesh.position.set(cellX, 0, cellZ);
          mesh.scale.set(1, 1, 1);
          mesh.receiveShadow = false;
          mesh.castShadow = castShadow;
          farCount++;
          patchCount++;
        }
      }
    }

    lastPatchCount = patchCount;
    lastHighCount = highCount;
    lastMidCount = midCount;
    lastFarCount = farCount;

    return { patchCount, highCount, midCount, farCount };
  }

  // Allow updating geometries after rebuild
  function updateGeometries(newGeos) {
    if (newGeos.geoHigh) {
      geoHigh = newGeos.geoHigh;
      poolHigh.meshes.forEach((m) => {
        m.geometry = newGeos.geoHigh;
      });
      geosAndMats.geoHigh = newGeos.geoHigh;
    }
    if (newGeos.geoMid) {
      geoMid = newGeos.geoMid;
      poolMid.meshes.forEach((m) => {
        m.geometry = newGeos.geoMid;
      });
      geosAndMats.geoMid = newGeos.geoMid;
    }
    if (newGeos.geoFar) {
      geoFar = newGeos.geoFar;
      poolFar.meshes.forEach((m) => {
        m.geometry = newGeos.geoFar;
      });
      geosAndMats.geoFar = newGeos.geoFar;
    }
  }

  return { update, updateGeometries };
}
