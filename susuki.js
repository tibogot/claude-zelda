/**
 * Susuki grass (pampas grass) — stem + 8 white plume bands per trunk.
 * Ghost of Tsushima–style. Stem = narrow ribbon; plume = 8 long bands with visible gaps.
 * Exports: createSusukiStemGeometry, createSusukiBandGeometry, createSusukiStemMaterial, createSusukiBandMaterial.
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
  sin,
  cos,
  fract,
  floor,
  mod,
  dot,
  length,
  negate,
  normalize,
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
  easeIn,
  rotateAxis_mat,
  rotateY_mat,
} from "./tsl-utils.js";

const PI = Math.PI;

export const SUSUKI_PATCH_SIZE = 20;
export const SUSUKI_STEM_SEGMENTS = 6;
export const SUSUKI_BAND_SEGMENTS = 8;
export const SUSUKI_BANDS_PER_PLANT = 8;
export const SUSUKI_COUNT = 800;

function makeRibbonGeometry(segments) {
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
    vid = new Float32Array(T);
  for (let i = 0; i < T; i++) {
    nrm[i * 3 + 1] = 1;
    vid[i] = i;
  }
  return { indices, pos, nrm, vid, V, T };
}

export function createSusukiStemGeometry(
  segments,
  numPlants,
  patchSize,
  setSeed,
  randRange,
) {
  setSeed(42);
  const { indices, pos, nrm, vid, T } = makeRibbonGeometry(segments);
  const off = new Float32Array(numPlants * 3);
  let numCellsX = Math.floor(Math.sqrt(numPlants));
  while (numPlants % numCellsX !== 0) numCellsX--;
  const numCellsZ = numPlants / numCellsX;
  const cellW = patchSize / numCellsX;
  const cellH = patchSize / numCellsZ;
  for (let i = 0; i < numPlants; i++) {
    const col = i % numCellsX;
    const row = Math.floor(i / numCellsX);
    off[i * 3] = -patchSize * 0.5 + col * cellW + randRange(0, cellW);
    off[i * 3 + 1] = -patchSize * 0.5 + row * cellH + randRange(0, cellH);
    off[i * 3 + 2] = 0;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = numPlants;
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

export function createSusukiBandGeometry(
  segments,
  numPlants,
  patchSize,
  setSeed,
  randRange,
) {
  setSeed(42);
  const plantPositions = [];
  let numCellsX = Math.floor(Math.sqrt(numPlants));
  while (numPlants % numCellsX !== 0) numCellsX--;
  const numCellsZ = numPlants / numCellsX;
  const cellW = patchSize / numCellsX;
  const cellH = patchSize / numCellsZ;
  for (let i = 0; i < numPlants; i++) {
    const col = i % numCellsX;
    const row = Math.floor(i / numCellsX);
    plantPositions.push(
      -patchSize * 0.5 + col * cellW + randRange(0, cellW),
      -patchSize * 0.5 + row * cellH + randRange(0, cellH),
    );
  }

  const numBands = numPlants * SUSUKI_BANDS_PER_PLANT;
  const { indices, pos, nrm, vid, T } = makeRibbonGeometry(segments);
  const off = new Float32Array(numBands * 3);
  const bandIndexAttr = new Float32Array(numBands);
  for (let i = 0; i < numBands; i++) {
    const plantIdx = Math.floor(i / SUSUKI_BANDS_PER_PLANT);
    const bandIdx = i % SUSUKI_BANDS_PER_PLANT;
    off[i * 3] = plantPositions[plantIdx * 2];
    off[i * 3 + 1] = plantPositions[plantIdx * 2 + 1];
    off[i * 3 + 2] = 0;
    bandIndexAttr[i] = bandIdx;
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = numBands;
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("vertIndex", new THREE.Float32BufferAttribute(vid, 1));
  geo.setAttribute("offset", new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute(
    "bandIndex",
    new THREE.InstancedBufferAttribute(bandIndexAttr, 1),
  );
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0, 0),
    1 + patchSize * 2,
  );
  return geo;
}

function getTerrainSampling(ctx) {
  const heightTex =
    ctx.heightTex ??
    (() => {
      const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
      t.needsUpdate = true;
      return t;
    })();
  const uTerrainSize = ctx.uTerrainSize ?? float(1e6);
  return { heightTex, uTerrainSize };
}

export function createSusukiStemMaterial(segments, verts, ctx) {
  const { heightTex, uTerrainSize } = getTerrainSampling(ctx);
  const {
    uTime,
    uStemHeight,
    uStemWidth,
    uPlumeStart,
    uWindDirX,
    uWindDirZ,
    uWindAxis,
    uCrossAxis,
    uWindWaveScale,
    uWindSpeed,
    uWindStr,
    uWindGust,
    uWindMicro,
    uStemColor,
    uSunDir,
    uAoIntensity,
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
  } = ctx;

  const SEGS = float(segments),
    NVERTS = float(verts);
  const vColor = varying(vec3(0), "v_col");
  const vPacked = varying(vec3(0), "v_pk");
  const vWorldPos = varying(vec3(0), "v_wp");

  const positionNode = Fn(() => {
    const offsetAttr = attribute("offset", "vec3"),
      vertIdxAttr = attribute("vertIndex", "float");
    const plantOffset = vec3(offsetAttr.x, 0, offsetAttr.y);
    const bladeWorld = modelWorldMatrix.mul(vec4(plantOffset, 1)).xyz;

    const terrainUV = add(div(bladeWorld.xz, uTerrainSize), vec2(0.5));
    const terrainH = texture(heightTex, terrainUV).r;

    const hv = hash42(bladeWorld.xz),
      hv2 = hash22(bladeWorld.xz);
    const randomAngle = mul(hv.x, 2 * PI);
    const randomHeight = remap(hv.z, 0, 1, 0.85, 1.15);
    const randomLean = remap(hv.w, 0, 1, 0.05, 0.15);

    const vertID = mod(vertIdxAttr, NVERTS);
    const zSide = negate(sub(mul(floor(div(vertIdxAttr, NVERTS)), 2), 1));
    const xSide = mod(vertID, 2);
    const heightPct = div(sub(vertID, xSide), mul(SEGS, 2));

    const totalHeight = mul(uStemHeight, randomHeight, uPlumeStart);

    const totalWidth = uStemWidth;
    const x = mul(sub(xSide, 0.5), totalWidth);
    const y = mul(heightPct, totalHeight);

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

    const easedH = easeIn(heightPct, 2);
    const curveAmt = mul(negate(randomLean), easedH);
    const grassMat = rotateAxis_mat(uWindAxis, totalWindLean)
      .mul(rotateAxis_mat(uCrossAxis, crossSway))
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
    normalLocal.assign(blendedNormal);

    const localVert = vec3(
      x,
      mul(y, cos(curveAmt)),
      mul(y, sin(curveAmt)),
    );
    const finalVert = add(grassMat.mul(localVert), plantOffset);

    const randomShade = remap(hv2.x, 0, 1, 0.9, 1.05);
    const plantCol = mul(uStemColor, randomShade);
    const aoBase = max(sub(1.0, mul(uAoIntensity, 0.65)), 0.2);
    const ao = mix(aoBase, 1.0, smoothstep(0.0, 0.4, heightPct));
    vColor.assign(mul(plantCol, ao));
    vPacked.assign(vec3(heightPct, xSide, 1));

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
    let col = vColor;
    const viewDir = normalize(sub(cameraPosition, vWorldPos));
    const n = normalLocal;
    const backScat = max(dot(negate(uSunDir), n), 0);
    const frontScat = max(dot(uSunDir, n), 0);
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
    const specNormal = normalize(n);
    const specReflect = sub(
      uSpecV1Dir,
      mul(specNormal, mul(2.0, dot(uSpecV1Dir, specNormal))),
    );
    const specDot = pow(max(dot(viewDir, specReflect), 0.0), 25.6);
    const sceneDepth = length(sub(cameraPosition, vWorldPos));
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
    const rimFresnel = mul(pow(rim, 2), 0.1);
    col = add(col, vec3(rimFresnel, rimFresnel, rimFresnel));
    return col;
  })();

  const mat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    roughness: 0.9,
    metalness: 0,
  });
  mat.positionNode = positionNode;
  mat.colorNode = colorNode;
  mat.envMapIntensity = 0;
  return mat;
}

export function createSusukiBandMaterial(segments, verts, ctx) {
  const { heightTex, uTerrainSize } = getTerrainSampling(ctx);
  const {
    uTime,
    uStemHeight,
    uPlumeStart,
    uSusukiPlumeFlex = float(0.2),
    uBandWidth,
    uWindDirX,
    uWindDirZ,
    uWindAxis,
    uCrossAxis,
    uWindWaveScale,
    uWindSpeed,
    uWindStr,
    uWindGust,
    uWindMicro,
    uPlumeColor,
    uSunDir,
    uAoIntensity,
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
  } = ctx;

  const SEGS = float(segments),
    NVERTS = float(verts);
  const BANDS = float(SUSUKI_BANDS_PER_PLANT);
  const vColor = varying(vec3(0), "v_col");
  const vPacked = varying(vec3(0), "v_pk");
  const vWorldPos = varying(vec3(0), "v_wp");

  const positionNode = Fn(() => {
    const offsetAttr = attribute("offset", "vec3"),
      bandIndexAttr = attribute("bandIndex", "float"),
      vertIdxAttr = attribute("vertIndex", "float");
    const plantOffset = vec3(offsetAttr.x, 0, offsetAttr.y);
    const bladeWorld = modelWorldMatrix.mul(vec4(plantOffset, 1)).xyz;

    const terrainUV = add(div(bladeWorld.xz, uTerrainSize), vec2(0.5));
    const terrainH = texture(heightTex, terrainUV).r;

    const hv = hash42(bladeWorld.xz),
      hv2 = hash22(bladeWorld.xz);
    const randomAngle = mul(hv.x, 2 * PI);
    const randomHeight = remap(hv.z, 0, 1, 0.85, 1.15);
    const stemRandomLean = remap(hv.w, 0, 1, 0.05, 0.15);
    const bandRandomLean = remap(hv.w, 0, 1, 0.02, 0.08);

    const bandAngle = mul(div(bandIndexAttr, BANDS), 2 * PI);
    const stemTotalHeight = mul(uStemHeight, randomHeight, uPlumeStart);
    const bandLength = mul(
      uStemHeight,
      randomHeight,
      sub(1, uPlumeStart),
    );

    const vertID = mod(vertIdxAttr, NVERTS);
    const zSide = negate(sub(mul(floor(div(vertIdxAttr, NVERTS)), 2), 1));
    const xSide = mod(vertID, 2);
    const heightPct = div(sub(vertID, xSide), mul(SEGS, 2));

    const totalWidth = uBandWidth;
    const x = mul(sub(xSide, 0.5), totalWidth);
    const y = mul(heightPct, bandLength);

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

    // Stem tip position with wind — must match stem's deformed tip exactly
    const stemTipWindLean = add(windLean, micro);
    const stemTipCrossSway = mul(wave2, 0.3, uWindStr, float(1));
    const stemGrassMat = rotateAxis_mat(uWindAxis, stemTipWindLean)
      .mul(rotateAxis_mat(uCrossAxis, stemTipCrossSway))
      .mul(rotateY_mat(randomAngle));
    const stemCurveAmt = mul(negate(stemRandomLean), float(1));
    const stemTipLocal = vec3(
      float(0),
      mul(stemTotalHeight, cos(stemCurveAmt)),
      mul(stemTotalHeight, sin(stemCurveAmt)),
    );
    const stemTipWorld = add(
      plantOffset,
      stemGrassMat.mul(stemTipLocal),
    );
    const totalWindLean = mul(add(windLean, micro), heightPct);
    const effectiveWind = mul(totalWindLean, add(1, uSusukiPlumeFlex));

    const easedH = easeIn(heightPct, 2);
    const curveAmt = mul(negate(bandRandomLean), easedH);
    const bandMat = rotateAxis_mat(uWindAxis, effectiveWind)
      .mul(rotateAxis_mat(uCrossAxis, crossSway))
      .mul(rotateY_mat(add(randomAngle, bandAngle)));

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
      bandMat,
      rotateY_mat(mul(PI, 0.3, zSide)).mul(gvn),
    ).mul(zSide);
    const gvn2 = mul(
      bandMat,
      rotateY_mat(mul(PI, -0.3, zSide)).mul(gvn),
    ).mul(zSide);
    const blendedNormal = normalize(mix(gvn1, gvn2, xSide));
    normalLocal.assign(blendedNormal);

    const localVert = vec3(
      x,
      mul(y, cos(curveAmt)),
      mul(y, sin(curveAmt)),
    );
    const bandLocal = bandMat.mul(localVert);
    const finalVert = add(bandLocal, stemTipWorld);

    const randomShade = remap(hv2.x, 0, 1, 0.95, 1.05);
    const plantCol = mul(uPlumeColor, randomShade);
    const aoBase = max(sub(1.0, mul(uAoIntensity, 0.65)), 0.2);
    const ao = mix(aoBase, 1.0, smoothstep(0.0, 0.3, heightPct));
    vColor.assign(mul(plantCol, ao));
    vPacked.assign(vec3(heightPct, xSide, 1));

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
    let col = vColor;
    const viewDir = normalize(sub(cameraPosition, vWorldPos));
    const n = normalLocal;
    const backScat = max(dot(negate(uSunDir), n), 0);
    const frontScat = max(dot(uSunDir, n), 0);
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
    const specNormal = normalize(n);
    const specReflect = sub(
      uSpecV1Dir,
      mul(specNormal, mul(2.0, dot(uSpecV1Dir, specNormal))),
    );
    const specDot = pow(max(dot(viewDir, specReflect), 0.0), 25.6);
    const sceneDepth = length(sub(cameraPosition, vWorldPos));
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
    const rimFresnel = mul(pow(rim, 2), 0.25);
    col = add(col, vec3(rimFresnel, rimFresnel, rimFresnel));
    return col;
  })();

  const mat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0,
  });
  mat.positionNode = positionNode;
  mat.colorNode = colorNode;
  mat.envMapIntensity = 0;
  return mat;
}
