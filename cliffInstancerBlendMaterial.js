/**
 * Cliff instancer blend material — same idea as splatmap-painter10bvh+post.html cliffBlendMat:
 * procedural ground (painter default gPARAMS / chunkPainterGround stack) on flat tops,
 * Rock028 triplanar on steep faces, slope noise, optional cliff paint layer (R = strength).
 */
import * as THREE from "three";
import {
  Fn,
  float,
  vec2,
  vec3,
  mix,
  texture,
  positionWorld,
  normalWorld,
  smoothstep,
  pow,
  clamp,
  sub,
  max,
  uniform,
  mx_noise_float,
} from "three/tsl";
import { normalMap } from "three/tsl";
import { perlinNoise2D, fbmPerlin2D } from "./tsl-noise.js";

const proceduralLayerMask = Fn(
  ([p, useFbm, octaves, lacunarity, gain, maskLow, maskHigh, maskSharpness, strength]) => {
    const nSingle = perlinNoise2D(p);
    const nFbm = fbmPerlin2D(p, octaves, lacunarity, gain);
    const n = mix(nSingle, nFbm, useFbm);
    const raw = smoothstep(maskLow, maskHigh, n);
    return pow(max(raw, float(0.0001)), maskSharpness).mul(strength);
  },
);

function toLinearColor(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

const G1 = {
  enable: true,
  useFbm: true,
  octaves: 3,
  lacunarity: 2.0,
  gain: 0.5,
  scale: 0.012,
  offsetX: 0,
  offsetY: 0,
  maskLow: 0.35,
  maskHigh: 0.8,
  maskSharpness: 1.0,
  strength: 0.4,
  color: "#2a4518",
};
const G2 = {
  enable: false,
  useFbm: true,
  octaves: 2.5,
  lacunarity: 2.2,
  gain: 0.5,
  scale: 0.04,
  offsetX: 13.7,
  offsetY: 31.1,
  maskLow: 0.4,
  maskHigh: 0.75,
  maskSharpness: 1.0,
  strength: 0.4,
  color: "#5aaa30",
};

/**
 * @param {number} worldSize
 * @param {number} worldHalf
 * @param {THREE.Texture} rockColorTex
 * @param {THREE.Texture} rockDataTex
 * @param {ReturnType<import("./chunkTerrainAutoCliff.js").createAutoCliffUniforms>} cliffU
 * @param {THREE.Texture} cliffPaintTex
 */
export function createCliffInstancerBlendMaterial(
  worldSize,
  worldHalf,
  rockColorTex,
  rockDataTex,
  cliffU,
  cliffPaintTex,
) {
  const baseColor = "#74CA5E";
  const brightness = 1.3;
  const contrast = 0.95;
  const L1 = G1;
  const L2 = G2;

  const uBase = uniform(toLinearColor(baseColor));
  const uL1c = uniform(toLinearColor(L1.color));
  const uL2c = uniform(toLinearColor(L2.color));
  const uBrightness = uniform(brightness);
  const uContrast = uniform(contrast);

  const cbPARAMS = {
    slopelow: 0.5,
    slopeHigh: 0.85,
    noiseScale: 0.06,
    noiseStr: 0.15,
    groundScale: 1.0,
    rockScaleMul: 1.0,
  };
  const uCBSlopeLow = uniform(cbPARAMS.slopelow);
  const uCBSlopeHigh = uniform(cbPARAMS.slopeHigh);
  const uCBNoiseScale = uniform(cbPARAMS.noiseScale);
  const uCBNoiseStr = uniform(cbPARAMS.noiseStr);
  const uCBGroundScale = uniform(cbPARAMS.groundScale);
  const uCBRockScaleMul = uniform(cbPARAMS.rockScaleMul);

  const uWs = float(worldSize);
  const uWh = float(worldHalf);

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.88,
    metalness: 0,
  });

  // Opaque solid draw + double-sided faces — matches how cliff GLBs are authored (mixed winding,
  // overhangs). Without this, WebGPU often culls back faces so you “see through” at grazing angles.
  mat.side = THREE.DoubleSide;
  mat.transparent = false;
  mat.depthWrite = true;
  mat.depthTest = true;
  mat.opacity = 1;
  mat.blending = THREE.NormalBlending;
  mat.premultipliedAlpha = false;
  // Same idea as chunkPainterGroundMaterial — env reflections read as broken transparency on steep TBN.
  mat.envMapIntensity = 0;

  const getCBPaintUV = () => positionWorld.xz.add(vec2(uWh, uWh)).div(vec2(uWs, uWs));

  mat.colorNode = Fn(() => {
    const wxz = positionWorld.xz.mul(uCBGroundScale);
    const p1 = vec2(
      wxz.x.mul(float(L1.scale)).add(float(L1.offsetX)),
      wxz.y.mul(float(L1.scale)).add(float(L1.offsetY)),
    );
    const m1 = proceduralLayerMask(
      p1,
      float(L1.useFbm ? 1 : 0),
      float(L1.octaves),
      float(L1.lacunarity),
      float(L1.gain),
      float(L1.maskLow),
      float(L1.maskHigh),
      float(L1.maskSharpness),
      float(L1.strength * (L1.enable ? 1 : 0)),
    );
    const p2 = vec2(
      wxz.x.mul(float(L2.scale)).add(float(L2.offsetX)),
      wxz.y.mul(float(L2.scale)).add(float(L2.offsetY)),
    );
    const m2 = proceduralLayerMask(
      p2,
      float(L2.useFbm ? 1 : 0),
      float(L2.octaves),
      float(L2.lacunarity),
      float(L2.gain),
      float(L2.maskLow),
      float(L2.maskHigh),
      float(L2.maskSharpness),
      float(L2.strength * (L2.enable ? 1 : 0)),
    );
    let ground = uBase;
    ground = mix(ground, uL1c, m1);
    ground = mix(ground, uL2c, m2);
    ground = clamp(
      sub(ground, float(0.5)).mul(uContrast).add(float(0.5)).mul(uBrightness),
      float(0),
      float(1),
    );

    const cbRockScale = cliffU.uRockScale.mul(uCBRockScaleMul);
    const rockUV_XZ = positionWorld.xz.mul(cbRockScale);
    const rockUV_XY = positionWorld.xy.mul(cbRockScale);
    const rockUV_ZY = positionWorld.zy.mul(cbRockScale);
    const triWRaw = normalWorld.abs().pow(cliffU.uTriplanarSharp);
    const triW = triWRaw.div(triWRaw.x.add(triWRaw.y).add(triWRaw.z));
    const rawRock = texture(rockColorTex, rockUV_XZ).rgb.mul(triW.y)
      .add(texture(rockColorTex, rockUV_XY).rgb.mul(triW.z))
      .add(texture(rockColorTex, rockUV_ZY).rgb.mul(triW.x));
    const cRock = clamp(rawRock.sub(float(0.5)).mul(cliffU.uRockContrast).add(float(0.5)), 0.0, 1.0);
    const rock = cRock.mul(cliffU.uRockBrightness).mul(cliffU.uRockTint);

    const noiseOffset = mx_noise_float(positionWorld.xz.mul(uCBNoiseScale)).mul(uCBNoiseStr);
    const slopeVal = normalWorld.y.add(noiseOffset);
    const blend = smoothstep(uCBSlopeLow, uCBSlopeHigh, slopeVal);

    let col = mix(rock, ground, blend);

    const cpaint = texture(cliffPaintTex, getCBPaintUV());
    const paintCol = ground;
    col = mix(col, paintCol, cpaint.r);

    return col;
  })();

  mat.normalNode = (() => {
    const cbRockScaleN = cliffU.uRockScale.mul(uCBRockScaleMul);
    const _nuvXZ = positionWorld.xz.mul(cbRockScaleN);
    const _nuvXY = positionWorld.xy.mul(cbRockScaleN);
    const _nuvZY = positionWorld.zy.mul(cbRockScaleN);
    const _ntWRaw = normalWorld.abs().pow(cliffU.uTriplanarSharp);
    const _ntW = _ntWRaw.div(_ntWRaw.x.add(_ntWRaw.y).add(_ntWRaw.z));
    const rNrmBA_XZ = texture(rockDataTex, _nuvXZ).ba;
    const rNrmBA_XY = texture(rockDataTex, _nuvXY).ba;
    const rNrmBA_ZY = texture(rockDataTex, _nuvZY).ba;
    const rNrmBA = rNrmBA_XZ.mul(_ntW.y).add(rNrmBA_XY.mul(_ntW.z)).add(rNrmBA_ZY.mul(_ntW.x));
    const rNrmVec = vec3(rNrmBA.x, rNrmBA.y, float(1.0));
    const noiseOffset2 = mx_noise_float(positionWorld.xz.mul(uCBNoiseScale)).mul(uCBNoiseStr);
    const blend2 = smoothstep(uCBSlopeLow, uCBSlopeHigh, normalWorld.y.add(noiseOffset2));
    const flatNm = vec3(0.5, 0.5, 1.0);
    return normalMap(mix(rNrmVec, flatNm, blend2));
  })();

  mat.roughnessNode = Fn(() => {
    const cbRockScaleR = cliffU.uRockScale.mul(uCBRockScaleMul);
    const noiseOffset3 = mx_noise_float(positionWorld.xz.mul(uCBNoiseScale)).mul(uCBNoiseStr);
    const blend3 = smoothstep(uCBSlopeLow, uCBSlopeHigh, normalWorld.y.add(noiseOffset3));
    const rockRough = texture(rockDataTex, positionWorld.xz.mul(cbRockScaleR)).r;
    return mix(rockRough, float(0.9), blend3);
  })();

  return {
    material: mat,
    cbPARAMS,
    uCBSlopeLow,
    uCBSlopeHigh,
    uCBNoiseScale,
    uCBNoiseStr,
    uCBGroundScale,
    uCBRockScaleMul,
  };
}
