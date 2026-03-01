/**
 * Grass blade geometry and TSL material — used by index.html.
 * Exports constants, createGrassGeometry(segments, numGrass, patchSize, setSeed, randRange),
 * and createGrassMaterial(segments, verts, useNpcInteraction, densityKey, ctx).
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
  step,
  smoothstep,
  clamp,
  abs,
  sin,
  cos,
  fract,
  floor,
  mod,
  dot,
  normalize,
  length,
  negate,
  add,
  sub,
  mul,
  div,
  max,
  pow,
  modelWorldMatrix,
  cameraPosition,
  normalLocal,
} from "three/tsl";
import {
  hash42,
  hash22,
  noise12,
  remap,
  easeOut,
  easeIn,
  rotateAxis_mat,
  rotateY_mat,
} from "./tsl-utils.js";

// ─── Constants (exported for index: patch grid, LOD, etc.) ───
export const GRASS_PATCH_SIZE = 10;
export const GRASS_SEGMENTS_LOW = 1;
export const GRASS_SEGMENTS_HIGH = 6;
export const GRASS_VERTS_LOW = (GRASS_SEGMENTS_LOW + 1) * 2;
export const GRASS_VERTS_HIGH = (GRASS_SEGMENTS_HIGH + 1) * 2;
export const NEAR_PATCH_SIZE = 5;
export const GRASS_DENSITY = 40 * 40 * 3;

export function createGrassGeometry(
  segments,
  numGrass,
  patchSize,
  setSeed,
  randRange,
) {
  setSeed(0);
  const V = (segments + 1) * 2,
    T = V * 2,
    indices = [];
  for (let i = 0; i < segments; i++) {
    const v = i * 2;
    indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    const f = V + v;
    indices.push(f + 2, f + 1, f, f + 3, f + 1, f + 2);
  }
  const pos = new Float32Array(T * 3),
    nrm = new Float32Array(T * 3),
    vid = new Float32Array(T),
    off = new Float32Array(numGrass * 3);
  for (let i = 0; i < T; i++) {
    nrm[i * 3 + 1] = 1;
    vid[i] = i;
  }
  let numCellsX = Math.floor(Math.sqrt(numGrass));
  while (numGrass % numCellsX !== 0) numCellsX--;
  const numCellsZ = numGrass / numCellsX;
  const cellW = patchSize / numCellsX;
  const cellH = patchSize / numCellsZ;
  for (let i = 0; i < numGrass; i++) {
    const col = i % numCellsX;
    const row = Math.floor(i / numCellsX);
    off[i * 3] = -patchSize * 0.5 + col * cellW + randRange(0, cellW);
    off[i * 3 + 1] = -patchSize * 0.5 + row * cellH + randRange(0, cellH);
    off[i * 3 + 2] = 0;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = numGrass;
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("vertIndex", new THREE.Float32BufferAttribute(vid, 1));
  geo.setAttribute("offset", new THREE.InstancedBufferAttribute(off, 3));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0, 0),
    1 + patchSize * 2,
  );
  return geo;
}

export function createGrassMaterial(
  segments,
  verts,
  useNpcInteraction,
  densityKey,
  ctx,
) {
  const {
    heightTex,
    trailTex,
    uTerrainSize,
    uTrailCenter,
    uTrailSize,
    uTime,
    uPlayerPos,
    uNpcPos,
    uLodDist,
    uLodBlendStart,
    uMaxDist,
    uBladeDensityRegular,
    uBladeDensityNear,
    uNearFadeEnd,
    uNearFadeRange,
    uGrassWidth,
    uGrassHeight,
    uWindDirX,
    uWindDirZ,
    uWindWaveScale,
    uWindSpeed,
    uWindAxis,
    uCrossAxis,
    uWindGust,
    uWindStr,
    uWindMicro,
    uInteractionRange,
    uInteractionStrength,
    uInteractionHThresh,
    uInteractionRepel,
    uMinSkyBlend,
    uMaxSkyBlend,
    uAoIntensity,
    uSeasonalScale,
    uSeasonalStr,
    uBaseColor1,
    uBaseColor2,
    uTipColor1,
    uTipColor2,
    uGradientCurve,
    uColorVariation,
    uLushColor,
    uBleachedColor,
    uSeasonalDryColor,
    uSunDir,
    uBsColor,
    uBsPower,
    uFrontScatter,
    uRimSSS,
    uBsIntensity,
    uSpecV1Intensity,
    uSpecV1Color,
    uSpecV1Dir,
    uSpecV2Intensity,
    uSpecV2Color,
    uSpecV2Dir,
    uSpecV2NoiseScale,
    uSpecV2NoiseStr,
    uSpecV2Power,
    uSpecV2TipBias,
    PI,
  } = ctx;

  const SEGS = float(segments),
    NVERTS = float(verts);
  const uBladeDensity =
    densityKey === "near" ? uBladeDensityNear : uBladeDensityRegular;
  const vGrassColor = varying(vec3(0), "v_gc");
  const vPacked = varying(vec3(0), "v_pk");
  const vWorldPos = varying(vec3(0), "v_wp");

  const positionNode = Fn(() => {
    const offsetAttr = attribute("offset", "vec3"),
      vertIdxAttr = attribute("vertIndex", "float");
    const grassOffset = vec3(offsetAttr.x, 0, offsetAttr.y);
    const bladeWorld = modelWorldMatrix.mul(vec4(grassOffset, 1)).xyz;

    const terrainUV = add(div(bladeWorld.xz, uTerrainSize), vec2(0.5));
    const terrainH = texture(heightTex, terrainUV).r;

    // Trail disabled for debugging (repulse-only). Set to 1 so no height shrink or tint.
    const trailScale = float(1);

    const hv = hash42(bladeWorld.xz),
      hv2 = hash22(bladeWorld.xz);
    const distXZ = length(sub(cameraPosition.xz, bladeWorld.xz));
    const highLODOut = smoothstep(
      mul(uLodDist, uLodBlendStart),
      uLodDist,
      distXZ,
    );
    const lodFadeIn = smoothstep(uLodDist, uMaxDist, distXZ);
    const randomAngle = mul(hv.x, 2 * PI),
      randomShade = remap(hv.y, -1, 1, 0.75, 1);
    const randomHeight = mul(
      remap(hv.z, 0, 1, 0.75, 1.5),
      mix(1, 0, lodFadeIn),
    );
    const randomLean = remap(hv.w, 0, 1, 0.1, 0.3);

    const vertID = mod(vertIdxAttr, NVERTS);
    const zSide = negate(sub(mul(floor(div(vertIdxAttr, NVERTS)), 2), 1));
    const xSide = mod(vertID, 2);
    const heightPct = div(sub(vertID, xSide), mul(SEGS, 2));
    const totalHeight = mul(uGrassHeight, randomHeight, trailScale);
    const widthHigh = easeOut(sub(1, heightPct), 2),
      widthLow = sub(1, heightPct);
    const totalWidth = mul(
      uGrassWidth,
      mix(widthHigh, widthLow, highLODOut),
    );
    let bladeVisible;
    if (densityKey === "near") {
      const distToPlayer = length(sub(bladeWorld.xz, uPlayerPos.xz));
      const fadedDensity = mix(
        uBladeDensityNear,
        float(0),
        smoothstep(sub(uNearFadeEnd, uNearFadeRange), uNearFadeEnd, distToPlayer),
      );
      bladeVisible = step(hv.x, fadedDensity);
    } else {
      bladeVisible = step(hv.x, uBladeDensity);
    }
    const totalWidthVis = mul(totalWidth, bladeVisible);
    const totalHeightVis = mul(totalHeight, bladeVisible);
    const x = mul(sub(xSide, 0.5), totalWidthVis),
      y = mul(heightPct, totalHeightVis);

    const windDirVec = vec2(uWindDirX, uWindDirZ);
    const windScroll = mul(windDirVec, mul(uTime, uWindSpeed));
    const waveUV1 = add(mul(bladeWorld.xz, uWindWaveScale), windScroll);
    const wave1 = sub(mul(noise12(waveUV1), 2), 1);
    const crossDir = vec2(negate(uWindDirZ), uWindDirX);
    const waveUV2 = add(
      mul(bladeWorld.xz, mul(uWindWaveScale, 2.3)),
      mul(windScroll, 1.4),
      mul(crossDir, mul(uTime, 0.3)),
    );
    const wave2 = mul(sub(mul(noise12(waveUV2), 2), 1), 0.35);
    const gustUV = add(
      mul(bladeWorld.xz, mul(uWindWaveScale, 0.25)),
      mul(windScroll, 0.3),
    );
    const gustRaw = noise12(gustUV);
    const gustStr = mul(smoothstep(0.5, 0.9, gustRaw), uWindGust);
    const windLean = mul(add(wave1, wave2, gustStr), uWindStr);
    const microPhase = add(mul(hv.x, 6.28), mul(uTime, 2.5));
    const micro = mul(sin(microPhase), uWindMicro, 0.3);
    const crossSway = mul(wave2, 0.3, uWindStr, heightPct);
    const totalWindLean = mul(add(windLean, micro), heightPct);
    const windAxis = uWindAxis;
    const crossAxis = uCrossAxis;

    const bladeY = add(bladeWorld.y, terrainH);
    // Repulse center XZ from uTrailCenter (updated every frame); height from uPlayerPos.y
    const repulseCenterXZ = uTrailCenter;
    const pDist = length(sub(bladeWorld.xz, repulseCenterXZ)),
      pHD = abs(sub(bladeY, uPlayerPos.y));
    // Strong when close: 1 - smoothstep(inner, outer, pDist)
    const distFalloff = mix(
      float(1),
      float(0),
      smoothstep(float(0.5), uInteractionRange, pDist),
    );
    const heightFalloff = smoothstep(uInteractionHThresh, 0, pHD);
    const pFall = mul(distFalloff, heightFalloff);
    const pAng = mul(
      negate(mix(0, uInteractionStrength, pFall)),
      uInteractionRepel,
    );
    const pTo = normalize(
      sub(
        vec3(repulseCenterXZ.x, 0, repulseCenterXZ.y),
        vec3(bladeWorld.x, 0, bladeWorld.z),
      ),
    );
    const pAx = vec3(pTo.z, 0, negate(pTo.x));
    let totalFall, sumAxis, sumAngle;
    if (useNpcInteraction) {
      const n0D = length(sub(bladeWorld.xz, uNpcPos[0].xz)),
        n0H = abs(sub(bladeY, uNpcPos[0].y));
      const n0Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n0D)),
        smoothstep(uInteractionHThresh, 0, n0H),
      );
      const n0To = normalize(
        sub(
          vec3(uNpcPos[0].x, 0, uNpcPos[0].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n0Ax = vec3(n0To.z, 0, negate(n0To.x));
      const n1D = length(sub(bladeWorld.xz, uNpcPos[1].xz)),
        n1H = abs(sub(bladeY, uNpcPos[1].y));
      const n1Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n1D)),
        smoothstep(uInteractionHThresh, 0, n1H),
      );
      const n1To = normalize(
        sub(
          vec3(uNpcPos[1].x, 0, uNpcPos[1].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n1Ax = vec3(n1To.z, 0, negate(n1To.x));
      const n2D = length(sub(bladeWorld.xz, uNpcPos[2].xz)),
        n2H = abs(sub(bladeY, uNpcPos[2].y));
      const n2Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n2D)),
        smoothstep(uInteractionHThresh, 0, n2H),
      );
      const n2To = normalize(
        sub(
          vec3(uNpcPos[2].x, 0, uNpcPos[2].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n2Ax = vec3(n2To.z, 0, negate(n2To.x));
      const n3D = length(sub(bladeWorld.xz, uNpcPos[3].xz)),
        n3H = abs(sub(bladeY, uNpcPos[3].y));
      const n3Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n3D)),
        smoothstep(uInteractionHThresh, 0, n3H),
      );
      const n3To = normalize(
        sub(
          vec3(uNpcPos[3].x, 0, uNpcPos[3].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n3Ax = vec3(n3To.z, 0, negate(n3To.x));
      const n4D = length(sub(bladeWorld.xz, uNpcPos[4].xz)),
        n4H = abs(sub(bladeY, uNpcPos[4].y));
      const n4Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n4D)),
        smoothstep(uInteractionHThresh, 0, n4H),
      );
      const n4To = normalize(
        sub(
          vec3(uNpcPos[4].x, 0, uNpcPos[4].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n4Ax = vec3(n4To.z, 0, negate(n4To.x));
      const n5D = length(sub(bladeWorld.xz, uNpcPos[5].xz)),
        n5H = abs(sub(bladeY, uNpcPos[5].y));
      const n5Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n5D)),
        smoothstep(uInteractionHThresh, 0, n5H),
      );
      const n5To = normalize(
        sub(
          vec3(uNpcPos[5].x, 0, uNpcPos[5].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n5Ax = vec3(n5To.z, 0, negate(n5To.x));
      totalFall = add(
        pFall,
        add(
          n0Fall,
          add(n1Fall, add(n2Fall, add(n3Fall, add(n4Fall, n5Fall)))),
        ),
      );
      sumAxis = add(
        mul(pAx, pFall),
        add(
          mul(n0Ax, n0Fall),
          add(
            mul(n1Ax, n1Fall),
            add(
              mul(n2Ax, n2Fall),
              add(
                mul(n3Ax, n3Fall),
                add(mul(n4Ax, n4Fall), mul(n5Ax, n5Fall)),
              ),
            ),
          ),
        ),
      );
      sumAngle = add(
        mul(pAng, pFall),
        add(
          mul(
            mix(0, uInteractionStrength, n0Fall),
            uInteractionRepel,
            n0Fall,
          ),
          add(
            mul(
              mix(0, uInteractionStrength, n1Fall),
              uInteractionRepel,
              n1Fall,
            ),
            add(
              mul(
                mix(0, uInteractionStrength, n2Fall),
                uInteractionRepel,
                n2Fall,
              ),
              add(
                mul(
                  mix(0, uInteractionStrength, n3Fall),
                  uInteractionRepel,
                  n3Fall,
                ),
                add(
                  mul(
                    mix(0, uInteractionStrength, n4Fall),
                    uInteractionRepel,
                    n4Fall,
                  ),
                  mul(
                    mix(0, uInteractionStrength, n5Fall),
                    uInteractionRepel,
                    n5Fall,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    } else {
      totalFall = pFall;
      sumAxis = mul(pAx, pFall);
      sumAngle = mul(pAng, pFall);
    }
    const invTotal = div(1, max(totalFall, 0.001));
    const hasInteraction = smoothstep(0.001, 0.002, totalFall);
    const pAxis = normalize(mix(vec3(1, 0, 0), sumAxis, hasInteraction));
    const pAngle = mul(mul(sumAngle, invTotal), hasInteraction);

    const easedH = mix(easeIn(heightPct, 2), 1, highLODOut);
    const curveAmt = mul(negate(randomLean), easedH);
    const grassMat = rotateAxis_mat(pAxis, pAngle)
      .mul(rotateAxis_mat(windAxis, totalWindLean))
      .mul(rotateAxis_mat(crossAxis, crossSway))
      .mul(rotateY_mat(randomAngle));

    const nc1 = curveAmt;
    const _hp01 = add(heightPct, 0.01);
    const n1p = vec3(0, mul(_hp01, cos(nc1)), mul(_hp01, sin(nc1)));
    const _nc09 = mul(nc1, 0.9);
    const n2p = vec3(
      0,
      mul(mul(_hp01, 0.9), cos(_nc09)),
      mul(mul(_hp01, 0.9), sin(_nc09)),
    );
    const ncurve = normalize(sub(n1p, n2p));
    const gvn = vec3(0, negate(ncurve.z), ncurve.y);
    const gvn1 = mul(
      grassMat,
      rotateY_mat(mul(PI, 0.3, zSide)).mul(gvn),
    ).mul(zSide);
    const gvn2 = mul(
      grassMat,
      rotateY_mat(mul(PI, -0.3, zSide)).mul(gvn),
    ).mul(zSide);
    const blendedNormal = normalize(mix(gvn1, gvn2, xSide));
    const skyFade = mix(uMinSkyBlend, uMaxSkyBlend, highLODOut);
    const finalNormal = normalize(
      mix(blendedNormal, vec3(0, 1, 0), skyFade),
    );
    normalLocal.assign(finalNormal);

    const localVert = vec3(
      x,
      mul(y, cos(curveAmt)),
      mul(y, sin(curveAmt)),
    );
    const finalVert = add(grassMat.mul(localVert), grassOffset);

    const cn1 = noise12(mul(bladeWorld.xz, 0.015)),
      cn2 = noise12(mul(bladeWorld.xz, 0.04)),
      cn3 = noise12(mul(bladeWorld.xz, 0.1));
    const colorMix = mul(add(cn1, mul(cn2, 0.5), mul(cn3, 0.25)), 0.57);
    const seasonNoise = noise12(mul(bladeWorld.xz, uSeasonalScale));
    const seasonFactor = mul(
      smoothstep(0.4, 0.7, seasonNoise),
      uSeasonalStr,
    );
    const baseCol = mix(uBaseColor1, uBaseColor2, hv2.x),
      tipCol = mix(uTipColor1, uTipColor2, hv2.y);
    const hiCol = mul(
      mix(baseCol, tipCol, easeIn(heightPct, uGradientCurve)),
      randomShade,
    );
    const loCol = mul(
      mix(uBaseColor1, uTipColor1, heightPct),
      randomShade,
    );
    let grassCol = mix(hiCol, loCol, highLODOut);
    grassCol = mix(
      grassCol,
      mul(uLushColor, randomShade),
      mul(smoothstep(0.3, 0.6, colorMix), uColorVariation, 0.5),
    );
    grassCol = mix(
      grassCol,
      mul(uBleachedColor, randomShade),
      mul(smoothstep(0.7, 0.9, colorMix), uColorVariation, 0.3),
    );
    grassCol = mix(grassCol, uSeasonalDryColor, seasonFactor);
    grassCol = mix(
      grassCol,
      mul(grassCol, vec3(1.1, 1.05, 0.85)),
      mul(sub(1, trailScale), 0.4),
    );
    const aoBase = max(sub(1.0, mul(uAoIntensity, 0.65)), 0.2);
    const ao = mix(aoBase, 1.0, smoothstep(0.0, 0.5, heightPct));
    const fadeFactor = sub(1, smoothstep(0.4, 1, lodFadeIn));
    vGrassColor.assign(
      mul(grassCol, ao, mul(fadeFactor, fadeFactor), bladeVisible),
    );
    vPacked.assign(vec3(heightPct, xSide, highLODOut));

    const worldFinal = vec3(
      finalVert.x,
      add(finalVert.y, terrainH),
      finalVert.z,
    );
    vWorldPos.assign(modelWorldMatrix.mul(vec4(worldFinal, 1)).xyz);
    return worldFinal;
  })();

  const colorNode = Fn(() => {
    const heightPct = vPacked.x;
    let col = vGrassColor;
    const viewDir = normalize(sub(cameraPosition, vWorldPos));
    const n = normalLocal;
    const backScat = max(dot(negate(uSunDir), n), 0),
      frontScat = max(dot(uSunDir, n), 0);
    const rim = sub(1, max(dot(n, viewDir), 0));
    const thickness = add(mul(sub(1, heightPct), 0.7), 0.3);
    const transmitCol = mix(
      uBsColor,
      mul(uBsColor, vec3(1.3, 1.1, 0.7)),
      sub(1, thickness),
    );
    const totalSSS = clamp(
      add(
        mul(pow(backScat, uBsPower), thickness),
        mul(pow(frontScat, 1.5), thickness, uFrontScatter),
        mul(pow(pow(rim, 1.5), 2), thickness, uRimSSS),
      ),
      0,
      1,
    );
    col = add(col, mul(transmitCol, 0.35, totalSSS, uBsIntensity));

    // Specular V1: directional highlight
    const sceneDepth = length(sub(cameraPosition, vWorldPos));
    const specNormal = normalize(n);
    const specReflect = sub(
      uSpecV1Dir,
      mul(specNormal, mul(2.0, dot(uSpecV1Dir, specNormal))),
    );
    const specDot = pow(max(dot(viewDir, specReflect), 0.0), 25.6);
    const specDistFade = smoothstep(2.0, 10.0, sceneDepth);
    const specTipFade = smoothstep(0.5, 1.0, heightPct);
    const specV1 = mul(
      uSpecV1Color,
      specDot,
      uSpecV1Intensity,
      specDistFade,
      specTipFade,
      3.0,
    );
    col = add(col, specV1);

    // Specular V2: scattered glints with noise-perturbed normals
    const noiseUV = mul(vWorldPos.xz, uSpecV2NoiseScale);
    const n1v2 = sub(mul(noise12(noiseUV), 2.0), 1.0);
    const n2v2 = sub(mul(noise12(add(noiseUV, vec2(73.7, 157.3))), 2.0), 1.0);
    const n3v2 = sub(
      mul(noise12(add(mul(noiseUV, 2.7), vec2(31.1, 97.5))), 2.0),
      1.0,
    );
    const perturbedN = normalize(
      add(n, mul(vec3(n1v2, mul(n3v2, 0.3), n2v2), uSpecV2NoiseStr)),
    );
    const v2Reflect = sub(
      uSpecV2Dir,
      mul(perturbedN, mul(2.0, dot(uSpecV2Dir, perturbedN))),
    );
    const v2Spec = pow(max(dot(viewDir, v2Reflect), 0.0), uSpecV2Power);
    const v2DistFade = smoothstep(2.0, 10.0, sceneDepth);
    const v2TipFade = smoothstep(sub(1.0, uSpecV2TipBias), 1.0, heightPct);
    const specV2 = mul(
      uSpecV2Color,
      v2Spec,
      uSpecV2Intensity,
      v2DistFade,
      v2TipFade,
    );
    col = add(col, specV2);

    return col;
  })();

  const mat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0.0,
  });
  mat.positionNode = positionNode;
  mat.colorNode = colorNode;
  mat.envMapIntensity = 0;
  return mat;
}

// ─── Grass patch placement + frustum culling (returns frustum for scatter/tree culling) ───
/**
 * @param {THREE.Scene} scene
 * @param {THREE.PerspectiveCamera} camera
 * @param {THREE.Group} grassGroup
 * @param {{ geoLow: THREE.BufferGeometry, geoHigh: THREE.BufferGeometry, geoNear: THREE.BufferGeometry, matLowSimple: THREE.Material, matHighSimple: THREE.Material, matHighSimpleNear: THREE.Material }} geosAndMats
 * @param {{ PATCH_SPACING: number, GRID_SIZE: number, NEAR_PATCH_SIZE: number, GRASS_DENSITY: number, nearRingExtent: number, lodDistance: number, maxDistance: number }} options
 * @returns {{ update(charPos: THREE.Vector3, frustum: THREE.Frustum): { patchCount: number } }}
 */
export function setupGrassPatches(
  scene,
  camera,
  grassGroup,
  geosAndMats,
  options,
) {
  const {
    geoLow,
    geoHigh,
    geoNear,
    matLowSimple,
    matHighSimple,
    matHighSimpleNear,
  } = geosAndMats;
  const {
    PATCH_SPACING,
    GRID_SIZE,
    NEAR_PATCH_SIZE,
    nearRingExtent,
    lodDistance,
    maxDistance,
  } = options;

  const poolLow = { meshes: [], idx: 0 };
  const poolHigh = { meshes: [], idx: 0 };
  const poolNear = { meshes: [], idx: 0 };

  function getMesh(pool, geo, mat) {
    if (pool.idx < pool.meshes.length) return pool.meshes[pool.idx++];
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    grassGroup.add(m);
    pool.meshes.push(m);
    pool.idx++;
    return m;
  }

  const baseCellPos = new THREE.Vector3();
  const cameraPosXZ = new THREE.Vector3();
  const aabb = new THREE.Box3();
  const cellPos = new THREE.Vector3();
  const aabbSize = new THREE.Vector3(PATCH_SPACING, 1000, PATCH_SPACING);
  const nearBaseCellPos = new THREE.Vector3();
  const nearAabbSize = new THREE.Vector3(NEAR_PATCH_SIZE, 1000, NEAR_PATCH_SIZE);

  function update(charPos, frustum) {
    for (let i = 0; i < grassGroup.children.length; i++)
      grassGroup.children[i].visible = false;
    poolLow.idx = 0;
    poolHigh.idx = 0;
    poolNear.idx = 0;

    baseCellPos
      .copy(camera.position)
      .divideScalar(PATCH_SPACING)
      .floor()
      .multiplyScalar(PATCH_SPACING);
    cameraPosXZ.set(camera.position.x, 0, camera.position.z);
    let patchCount = 0;

    for (let x = -GRID_SIZE; x < GRID_SIZE; x++) {
      for (let z = -GRID_SIZE; z < GRID_SIZE; z++) {
        cellPos.set(
          baseCellPos.x + x * PATCH_SPACING,
          0,
          baseCellPos.z + z * PATCH_SPACING,
        );
        aabb.setFromCenterAndSize(cellPos, aabbSize);
        const dist = aabb.distanceToPoint(cameraPosXZ);
        if (dist > maxDistance) continue;
        if (!frustum.intersectsBox(aabb)) continue;
        const useLow = dist > lodDistance;
        const mat = useLow ? matLowSimple : matHighSimple;
        const mesh = getMesh(
          useLow ? poolLow : poolHigh,
          useLow ? geoLow : geoHigh,
          mat,
        );
        mesh.material = mat;
        mesh.position.set(cellPos.x, 0, cellPos.z);
        mesh.visible = true;
        patchCount++;
      }
    }

    const nearExtent = Math.max(1, Math.min(6, Math.round(nearRingExtent)));
    nearBaseCellPos
      .copy(charPos)
      .divideScalar(NEAR_PATCH_SIZE)
      .floor()
      .multiplyScalar(NEAR_PATCH_SIZE);
    for (let x = -nearExtent; x <= nearExtent; x++) {
      for (let z = -nearExtent; z <= nearExtent; z++) {
        cellPos.set(
          nearBaseCellPos.x + x * NEAR_PATCH_SIZE,
          0,
          nearBaseCellPos.z + z * NEAR_PATCH_SIZE,
        );
        aabb.setFromCenterAndSize(cellPos, nearAabbSize);
        if (!frustum.intersectsBox(aabb)) continue;
        const nearMesh = getMesh(poolNear, geoNear, matHighSimpleNear);
        nearMesh.material = matHighSimpleNear;
        nearMesh.position.copy(cellPos);
        nearMesh.visible = true;
        patchCount++;
      }
    }

    return { patchCount };
  }

  return { update };
}
