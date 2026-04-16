/**
 * V2 shared WebGPU terrain shading: v1 `chunkGroundTsl` + `chunkMeadowTsl` stacks.
 * No splat / cliff / image slots — meadow is blended by world up-normal (slope), like a global grass mask.
 */
import * as THREE from "three";
import { Fn, float, mix, smoothstep, uniform, normalWorld } from "three/tsl";
import { createGroundTslBundle } from "../../../chunkGroundTsl.js";
import { createMeadowTslBundle } from "../../../chunkMeadowTsl.js";

/**
 * @param {import("../../../chunkGroundTsl.js").GROUND_DEFAULT_PARAMS} groundParams
 * @param {import("../../../chunkMeadowTsl.js").MEADOW_DEFAULT_PARAMS} meadowParams
 */
export function createV2ProceduralGroundMaterial(groundParams, meadowParams) {
  const groundBundle = createGroundTslBundle(groundParams);
  const meadowBundle = createMeadowTslBundle(meadowParams);

  const uMeadowMix = uniform(0.55, "float");
  const uSlopeMin = uniform(0.45, "float");
  const uSlopeMax = uniform(0.92, "float");

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0,
  });
  mat.envMapIntensity = 0;

  mat.colorNode = Fn(() => {
    const g = groundBundle.groundProc();
    const m = meadowBundle.meadowProc();
    const ny = normalWorld.y;
    const w = smoothstep(uSlopeMin, uSlopeMax, ny).mul(uMeadowMix);
    return mix(g, m, w);
  })();

  return {
    material: mat,
    syncGround: (p) => groundBundle.syncFromParams(p),
    syncMeadow: (p) => meadowBundle.syncFromParams(p),
    uMeadowMix,
    uSlopeMin,
    uSlopeMax,
  };
}
