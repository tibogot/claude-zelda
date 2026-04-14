/**
 * Chunk terrain: same procedural ground stack as splatmap-painter10bvh+post.html `groundProc`
 * (gPARAMS + groundLayerMask: Perlin / FBM via tsl-noise.js), plus splat RGB blend.
 *
 * Uses MeshStandardNodeMaterial so sun + hemi actually shade the surface (Basic looked "flat").
 * envMapIntensity = 0 avoids environment reflections exaggerating per-triangle / LOD differences
 * (the old "chunk grid" read that pushed the seam-test toward Basic).
 *
 * SHARED MATERIAL: one material instance is compiled once and reused for every chunk.
 * Per-chunk textures (splat, imgWeight, meadow) are swapped via onBeforeRender
 * by updating TextureNode.value — same shader, different texture bindings.
 */
import * as THREE from "three";
import {
  Fn,
  float,
  vec2,
  vec3,
  mix,
  texture,
  positionLocal,
  positionWorld,
  clamp,
  max,
  sqrt,
  uniform,
  step,
} from "three/tsl";
import { normalMap } from "three/tsl";
import { createCliffShadingContext } from "./chunkTerrainAutoCliff.js";
import {
  applyImageSlotAlbedoAndAO,
  applyImageSlotRoughness,
  createImageSlotNormalNode,
  evaluateImageSlotNormalRaw,
} from "./chunkTerrainImageSlotsTsl.js";

/** 1×1 black RGBA placeholder so TextureNodes have a valid initial binding. */
function makePlaceholderTex() {
  const d = new Uint8Array([0, 0, 0, 255]);
  const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Creates ONE shared TSL ground material. Per-chunk textures (splat, imgWeight, meadow)
 * are bound via returned TextureNode references — swap `.value` in onBeforeRender.
 *
 * @param {number} chunkSize
 * @param {object} [opts]
 * @param {null | { heightTex, rockColorTex, rockDataTex, cliffU, worldSize, worldHalf, htexRes }} [cliffDeps]
 * @param {object[] | null} [imageSlots] — from createChunkImageSlotSystem().slots
 * @param {null | { meadowProc: object }} [meadowBundle] — from createMeadowTslBundle()
 * @param {null | { groundProc: Function }} [groundBundle] — from createGroundTslBundle(); when present, replaces baked base+layer1+layer2 with live uniforms
 * @returns {{ material, splatTexNode, imgWeightTexNode, meadowTexNode }}
 */
export function createChunkPainterGroundMaterial(
  chunkSize,
  opts = {},
  cliffDeps = null,
  imageSlots = null,
  meadowBundle = null,
  groundBundle = null,
) {
  const roughness = opts.roughness ?? 0.9;
  const metalness = opts.metalness ?? 0;
  const envMapIntensity = opts.envMapIntensity ?? 0;

  const cs = float(chunkSize);

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness,
    metalness,
  });
  mat.envMapIntensity = envMapIntensity;

  const worldSizeF = float(
    opts.worldSize ?? (cliffDeps ? cliffDeps.worldSize : 1600),
  );

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

  // ── Shared texture nodes: one per varying-per-chunk texture ──
  // All chunks share the same compiled shader; onBeforeRender swaps .value.
  const splatUV = positionLocal.xz.div(cs).add(vec2(0.5, 0.5));
  const splatTexNode = texture(makePlaceholderTex(), splatUV);
  const imgWeightTexNode = imageSlots
    ? texture(makePlaceholderTex(), splatUV)
    : null;
  const meadowTexNode = meadowBundle
    ? texture(makePlaceholderTex(), splatUV)
    : null;

  mat.colorNode = Fn(() => {
    let terrainCol = groundBundle.groundProc();

    // Splat blend — uses shared splatTexNode
    const s = splatTexNode;
    const layR = vec3(0.34, 0.27, 0.16);
    const layG = vec3(0.36, 0.52, 0.22);
    const layB = vec3(0.46, 0.4, 0.28);
    let col = terrainCol;
    col = mix(col, layR, s.r);
    col = mix(col, layG, s.g);
    col = mix(col, layB, s.b);

    if (meadowBundle && meadowTexNode) {
      const mW = meadowTexNode.r;
      col = mix(col, meadowBundle.meadowProc(), mW);
    }
    if (imgWeightTexNode && imageSlots) {
      col = applyImageSlotAlbedoAndAO(
        col,
        cs,
        worldSizeF,
        null,
        imageSlots,
        imgWeightTexNode,
      );
    }
    return cliff ? cliff.augmentColor(col) : col;
  })();

  if (cliff) {
    if (imgWeightTexNode && imageSlots) {
      // Blend cliff normals with image slot normals where image paint is present
      mat.normalNode = Fn(() => {
        const cliffRawNm = cliff.evaluateNormalInFn();
        const { raw: imgRawNm, weight: imgW } = evaluateImageSlotNormalRaw(
          worldSizeF,
          imageSlots,
          imgWeightTexNode,
        );
        const combined = mix(cliffRawNm, imgRawNm, imgW);
        return normalMap(combined, vec2(0.25, 0.25));
      })();
      mat.roughnessNode = Fn(() =>
        applyImageSlotRoughness(
          cliff.evaluateRoughnessInFn(),
          cs,
          worldSizeF,
          null,
          imageSlots,
          imgWeightTexNode,
        ),
      )();
    } else {
      mat.normalNode = cliff.buildNormalNode();
      mat.roughnessNode = cliff.buildRoughnessNode();
    }
  } else if (imgWeightTexNode && imageSlots) {
    mat.roughnessNode = Fn(() =>
      applyImageSlotRoughness(
        float(roughness),
        cs,
        worldSizeF,
        null,
        imageSlots,
        imgWeightTexNode,
      ),
    )();
    mat.normalNode = createImageSlotNormalNode(
      cs,
      worldSizeF,
      null,
      imageSlots,
      imgWeightTexNode,
    );
  }

  mat.opacityNode = Fn(() => {
    return float(1.0).sub(step(float(0.25), splatTexNode.a));
  })();
  mat.alphaTest = 0.5;
  mat.transparent = false;

  return { material: mat, splatTexNode, imgWeightTexNode, meadowTexNode };
}

/**
 * Hook mesh.onBeforeRender to swap per-chunk textures on the shared material.
 * Call once per mesh after creation. The mesh must have userData._tslSplat, _tslImg, _tslMeadow.
 *
 * @param {THREE.Mesh} mesh
 * @param {{ splatTexNode, imgWeightTexNode, meadowTexNode }} sharedNodes
 */
export function setupTslGroundMeshSwap(mesh, sharedNodes) {
  const prev = mesh.onBeforeRender;
  mesh.onBeforeRender = () => {
    if (prev) prev();
    const ud = mesh.userData;
    if (ud._tslSplat) sharedNodes.splatTexNode.value = ud._tslSplat;
    if (ud._tslImg && sharedNodes.imgWeightTexNode)
      sharedNodes.imgWeightTexNode.value = ud._tslImg;
    if (ud._tslMeadow && sharedNodes.meadowTexNode)
      sharedNodes.meadowTexNode.value = ud._tslMeadow;
  };
}

/**
 * Shared material that tiles one image slot texture (albedo + ORM) across the whole terrain.
 * Swap which slot is shown by updating albedoTexNode.value / ormTexNode.value + syncing uniforms.
 * Per-chunk splat texture swapped via onBeforeRender for hole punching.
 *
 * @param {number} chunkSize
 * @param {number} worldSize
 * @returns {{ material, splatTexNode, albedoTexNode, ormTexNode, uUVScale, uNormalStr, uAOStr, uRoughStr }}
 */
export function createSharedImgTexMaterial(
  chunkSize,
  worldSize,
  cliffDeps = null,
) {
  const cs = float(chunkSize);
  const ws = float(1.0).div(float(worldSize));
  const uUVScale = uniform(3.0);
  const uNormalStr = uniform(1.0);
  const uAOStr = uniform(1.0);
  const uRoughStr = uniform(1.0);

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness: 0.88,
    metalness: 0.02,
  });
  mat.envMapIntensity = 0;

  // Shared texture nodes — swappable per slot + per chunk
  const splatUV = positionLocal.xz.div(cs).add(vec2(0.5, 0.5));
  const splatTexNode = texture(makePlaceholderTex(), splatUV);

  const tileUV = positionWorld.xz.mul(ws).mul(uUVScale);
  const albedoTexNode = texture(makePlaceholderTex(), tileUV);
  const ormTexNode = texture(makePlaceholderTex(), tileUV);

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

  // Color: albedo × AO (strength-controlled), with cliff rock replacement on slopes.
  mat.colorNode = Fn(() => {
    const col = albedoTexNode.rgb;
    const ao = ormTexNode.r;
    const shaded = col.mul(mix(float(1), ao, uAOStr));
    return cliff ? cliff.augmentColor(shaded) : shaded;
  })();

  // Roughness: blend from base toward ORM green channel by roughStr, with cliff override on slopes.
  mat.roughnessNode = Fn(() => {
    const ormRough = ormTexNode.g;
    const imgRough = clamp(
      mix(float(0.88), ormRough, uRoughStr),
      float(0.04),
      float(1),
    );
    if (!cliff) return imgRough;
    const slope = cliff.getSlopeMask().pow(cliffDeps.cliffU.uRockBlendSharp);
    return mix(cliff.evaluateRockRoughnessRawInFn(), imgRough, slope);
  })();

  // Normal from ORM blue+alpha channels — with cliff normal mixed in on slopes.
  mat.normalNode = Fn(() => {
    const nmX = ormTexNode.b.mul(2.0).sub(1.0);
    const nmY = ormTexNode.a.mul(2.0).sub(1.0);
    const nmZ = sqrt(
      max(float(0.0), float(1.0).sub(nmX.mul(nmX)).sub(nmY.mul(nmY))),
    );
    const imgRaw = vec3(
      nmX.mul(0.5).add(0.5),
      nmY.mul(0.5).add(0.5),
      nmZ.mul(0.5).add(0.5),
    );
    if (!cliff) return normalMap(imgRaw, vec2(uNormalStr, uNormalStr));
    const rockRaw = cliff.evaluateRockNormalRawInFn();
    const slope = cliff.getSlopeMask().pow(cliffDeps.cliffU.uRockBlendSharp);
    const combined = mix(rockRaw, imgRaw, slope);
    return normalMap(combined, vec2(uNormalStr, uNormalStr));
  })();

  // Hole punch from splat alpha
  mat.opacityNode = Fn(() => {
    return float(1.0).sub(step(float(0.25), splatTexNode.a));
  })();
  mat.alphaTest = 0.5;
  mat.transparent = false;

  return {
    material: mat,
    splatTexNode,
    albedoTexNode,
    ormTexNode,
    uUVScale,
    uNormalStr,
    uAOStr,
    uRoughStr,
  };
}

/**
 * Hook mesh.onBeforeRender to swap per-chunk splat texture on the shared imgTex material.
 */
export function setupImgTexMeshSwap(mesh, sharedImgTex) {
  const prev = mesh.onBeforeRender;
  mesh.onBeforeRender = () => {
    if (prev) prev();
    const ud = mesh.userData;
    if (ud._tslSplat) sharedImgTex.splatTexNode.value = ud._tslSplat;
  };
}
