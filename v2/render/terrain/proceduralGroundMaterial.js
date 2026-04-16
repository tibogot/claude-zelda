import * as THREE from "three";
import { Fn } from "three/tsl";
import { createGroundTslBundle } from "../../../chunkGroundTsl.js";
import { createCliffShadingContext } from "../../../chunkTerrainAutoCliff.js";

/**
 * @param {import("../../../chunkGroundTsl.js").GROUND_DEFAULT_PARAMS} groundParams
 * @param {null | { heightTex, rockColorTex, rockDataTex, cliffU, worldSize, worldHalf, htexRes }} [cliffDeps]
 */
export function createV2ProceduralGroundMaterial(groundParams, cliffDeps = null) {
  const groundBundle = createGroundTslBundle(groundParams);

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

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0,
  });
  mat.envMapIntensity = 0;

  mat.colorNode = Fn(() => {
    const g = groundBundle.groundProc();
    return cliff ? cliff.augmentColor(g) : g;
  })();

  if (cliff) {
    mat.normalNode = cliff.buildNormalNode();
    mat.roughnessNode = cliff.buildRoughnessNode();
  }

  return {
    material: mat,
    syncGround: (p) => groundBundle.syncFromParams(p),
  };
}
