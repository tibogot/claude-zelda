import * as THREE from "three";
import { Fn } from "three/tsl";
import { createGroundTslBundle } from "../../../chunkGroundTsl.js";

/**
 * @param {import("../../../chunkGroundTsl.js").GROUND_DEFAULT_PARAMS} groundParams
 */
export function createV2ProceduralGroundMaterial(groundParams) {
  const groundBundle = createGroundTslBundle(groundParams);

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.9,
    metalness: 0,
  });
  mat.envMapIntensity = 0;

  mat.colorNode = Fn(() => {
    return groundBundle.groundProc();
  })();

  return {
    material: mat,
    syncGround: (p) => groundBundle.syncFromParams(p),
  };
}
