/**
 * Shared image-texture ground material (tiled albedo + ORM/normal across the world).
 *
 * Reads one TextureLibrary slot — albedoTex + ormTex packed R=Rough, G=AO, B=NX, A=NY
 * — and tiles it by slot uvScale. Auto-cliff (Rock028 or any other slot) mixes in
 * on slopes using `createCliffShadingContext` identical to the procedural path.
 *
 * The slot's stable `albedoTex` / `ormTex` / `uUVScale` / `uNormalStr` / `uAOStr` /
 * `uRoughStr` uniforms are bound directly, so live tweakpane edits update the
 * shader without rebuilding the material.
 *
 * No splat hole-punch here — paint mode will use per-chunk splat overrides via a
 * separate material variant or per-chunk texture swap.
 */
import * as THREE from "three";
import {
  Fn,
  float,
  vec2,
  vec3,
  texture,
  positionWorld,
  mix,
  clamp,
  max,
  sqrt,
} from "three/tsl";
import { normalMap } from "three/tsl";
import { createCliffShadingContext } from "../../../chunkTerrainAutoCliff.js";

/**
 * @param {object} groundSlot — TextureLibrary slot used as the tiled ground material
 * @param {number} worldSize
 * @param {null | { heightTex, rockColorTex, rockDataTex, cliffU, worldSize, worldHalf, htexRes }} [cliffDeps]
 */
export function createV2ImageTexGroundMaterial(groundSlot, worldSize, cliffDeps = null) {
  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.88,
    metalness: 0.0,
  });
  mat.envMapIntensity = 0;

  const invWorldSize = float(1.0 / worldSize);
  const tileUV = positionWorld.xz.mul(invWorldSize).mul(groundSlot.uUVScale);

  const albedoTexNode = texture(groundSlot.albedoTex, tileUV);
  const ormTexNode = texture(groundSlot.ormTex, tileUV);

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
    const col = albedoTexNode.rgb;
    const ao = ormTexNode.g;
    const shaded = col.mul(mix(float(1), ao, groundSlot.uAOStr));
    return cliff ? cliff.augmentColor(shaded) : shaded;
  })();

  mat.roughnessNode = Fn(() => {
    const ormRough = ormTexNode.r;
    const imgRough = clamp(
      mix(float(0.88), ormRough, groundSlot.uRoughStr),
      float(0.04),
      float(1),
    );
    if (!cliff) return imgRough;
    const slope = cliff.getSlopeMask().pow(cliffDeps.cliffU.uRockBlendSharp);
    return mix(cliff.evaluateRockRoughnessRawInFn(), imgRough, slope);
  })();

  mat.normalNode = Fn(() => {
    const nmX = ormTexNode.b.mul(2.0).sub(1.0);
    const nmY = ormTexNode.a.mul(2.0).sub(1.0);
    const nmZ = sqrt(max(float(0.0), float(1.0).sub(nmX.mul(nmX)).sub(nmY.mul(nmY))));
    const imgRaw = vec3(
      nmX.mul(0.5).add(0.5),
      nmY.mul(0.5).add(0.5),
      nmZ.mul(0.5).add(0.5),
    );
    if (!cliff) return normalMap(imgRaw, vec2(groundSlot.uNormalStr, groundSlot.uNormalStr));
    const rockRaw = cliff.evaluateRockNormalRawInFn();
    const slope = cliff.getSlopeMask().pow(cliffDeps.cliffU.uRockBlendSharp);
    const combined = mix(rockRaw, imgRaw, slope);
    return normalMap(combined, vec2(groundSlot.uNormalStr, groundSlot.uNormalStr));
  })();

  return { material: mat };
}
