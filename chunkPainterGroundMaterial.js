/**
 * Chunk terrain: same procedural ground stack as splatmap-painter10bvh+post.html `groundProc`
 * (gPARAMS + groundLayerMask: Perlin / FBM via tsl-noise.js), plus splat RGB blend.
 *
 * Uses MeshStandardNodeMaterial so sun + hemi actually shade the surface (Basic looked “flat”).
 * envMapIntensity = 0 avoids environment reflections exaggerating per-triangle / LOD differences
 * (the old “chunk grid” read that pushed the seam-test toward Basic).
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
  positionLocal,
  smoothstep,
  pow,
  clamp,
  sub,
  max,
  uniform,
} from "three/tsl";
import { perlinNoise2D, fbmPerlin2D } from "./tsl-noise.js";
import { createCliffShadingContext } from "./chunkTerrainAutoCliff.js";

function toLinearColor(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

/** Matches painter `groundLayerMask` for noiseType perlin + optional FBM. */
const proceduralLayerMask = Fn(
  ([p, useFbm, octaves, lacunarity, gain, maskLow, maskHigh, maskSharpness, strength]) => {
    const nSingle = perlinNoise2D(p);
    const nFbm = fbmPerlin2D(p, octaves, lacunarity, gain);
    const n = mix(nSingle, nFbm, useFbm);
    const raw = smoothstep(maskLow, maskHigh, n);
    return pow(max(raw, float(0.0001)), maskSharpness).mul(strength);
  },
);

/**
 * @param {THREE.Texture} splatTex — same per-chunk splat as createChunkSplatMaterial
 * @param {number} chunkSize
 * @param {object} [opts] — defaults match splatmap-painter10bvh+post.html gPARAMS (default preset)
 * @param {null | { heightTex, rockColorTex, rockDataTex, cliffU, worldSize, worldHalf, htexRes }} [cliffDeps] — painter-style auto cliff
 */
export function createChunkPainterGroundMaterial(splatTex, chunkSize, opts = {}, cliffDeps = null) {
  const baseColor = opts.baseColor ?? "#74CA5E";
  const brightness = opts.brightness ?? 1.3;
  const contrast = opts.contrast ?? 0.95;
  const roughness = opts.roughness ?? 0.9;
  const metalness = opts.metalness ?? 0;
  const envMapIntensity = opts.envMapIntensity ?? 0;

  const L1 = {
    enable: opts.layer1?.enable ?? true,
    color: opts.layer1?.color ?? opts.layer1Color ?? "#2a4518",
    strength: opts.layer1?.strength ?? opts.layer1Strength ?? 0.4,
    useFbm: opts.layer1?.useFbm ?? true,
    octaves: opts.layer1?.octaves ?? 3,
    lacunarity: opts.layer1?.lacunarity ?? 2.0,
    gain: opts.layer1?.gain ?? 0.5,
    scale: opts.layer1?.scale ?? opts.layer1Scale ?? 0.012,
    offsetX: opts.layer1?.offsetX ?? opts.layer1OffX ?? 0,
    offsetY: opts.layer1?.offsetY ?? opts.layer1OffZ ?? 0,
    maskLow: opts.layer1?.maskLow ?? opts.maskLow ?? 0.35,
    maskHigh: opts.layer1?.maskHigh ?? opts.maskHigh ?? 0.8,
    maskSharpness: opts.layer1?.maskSharpness ?? opts.maskSharpness ?? 1.0,
  };
  const L2 = {
    enable: opts.layer2?.enable ?? false,
    color: opts.layer2?.color ?? "#5aaa30",
    strength: opts.layer2?.strength ?? 0.4,
    useFbm: opts.layer2?.useFbm ?? true,
    octaves: opts.layer2?.octaves ?? 2.5,
    lacunarity: opts.layer2?.lacunarity ?? 2.2,
    gain: opts.layer2?.gain ?? 0.5,
    scale: opts.layer2?.scale ?? 0.04,
    offsetX: opts.layer2?.offsetX ?? 13.7,
    offsetY: opts.layer2?.offsetY ?? 31.1,
    maskLow: opts.layer2?.maskLow ?? 0.4,
    maskHigh: opts.layer2?.maskHigh ?? 0.75,
    maskSharpness: opts.layer2?.maskSharpness ?? 1.0,
  };

  splatTex.anisotropy = 8;
  splatTex.flipY = false;

  const uBase = uniform(toLinearColor(baseColor));
  const uL1c = uniform(toLinearColor(L1.color));
  const uL2c = uniform(toLinearColor(L2.color));
  const cs = float(chunkSize);

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness,
    metalness,
  });
  mat.envMapIntensity = envMapIntensity;

  const cliff =
    cliffDeps &&
    createCliffShadingContext(
      cliffDeps.heightTex,
      cliffDeps.rockColorTex,
      cliffDeps.rockDataTex,
      cliffDeps.cliffU,
      cliffDeps.worldSize,
      cliffDeps.worldHalf,
      cliffDeps.htexRes,
    );

  mat.colorNode = Fn(() => {
    const wxz = positionWorld.xz;
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

    let terrainCol = uBase;
    terrainCol = mix(terrainCol, uL1c, m1);
    terrainCol = mix(terrainCol, uL2c, m2);
    terrainCol = clamp(
      sub(terrainCol, float(0.5)).mul(float(contrast)).add(float(0.5)).mul(float(brightness)),
      float(0),
      float(1),
    );

    const splatUV = positionLocal.xz.div(cs).add(vec2(0.5, 0.5));
    const s = texture(splatTex, splatUV);
    const layR = vec3(0.34, 0.27, 0.16);
    const layG = vec3(0.36, 0.52, 0.22);
    const layB = vec3(0.46, 0.4, 0.28);
    let col = terrainCol;
    col = mix(col, layR, s.r);
    col = mix(col, layG, s.g);
    col = mix(col, layB, s.b);
    return cliff ? cliff.augmentColor(col) : col;
  })();

  if (cliff) {
    mat.normalNode = cliff.buildNormalNode();
    mat.roughnessNode = cliff.buildRoughnessNode();
  }

  return mat;
}
