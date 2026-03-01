/**
 * Susuki field — patch-based LOD system mirroring grass.
 * Large field of susuki grass with camera-following patches, frustum culling, and LOD.
 * Exports: createSusukiFieldResources, setupSusukiPatches, buildSusukiCtx, SUSUKI_FIELD_PARAMS.
 */
import * as THREE from "three";
import { uniform } from "three/tsl";
import { setSeed, randRange } from "./rng.js";
import {
  createSusukiStemGeometry,
  createSusukiBandGeometry,
  createSusukiStemMaterial,
  createSusukiBandMaterial,
} from "./susuki.js";

// ─── Constants (sparser than grass: taller plants, fewer per patch) ───
export const SUSUKI_FIELD_PATCH_SIZE = 20;
export const SUSUKI_FIELD_PATCH_SPACING = 20;
export const SUSUKI_STEM_SEGMENTS_LOW = 3;
export const SUSUKI_STEM_SEGMENTS_HIGH = 6;
export const SUSUKI_BAND_SEGMENTS_LOW = 4;
export const SUSUKI_BAND_SEGMENTS_HIGH = 8;
export const SUSUKI_PLANTS_PER_PATCH = 12 * 12; // 144 plants per patch
export const SUSUKI_NEAR_PATCH_SIZE = 10;

export const SUSUKI_FIELD_PARAMS = {
  stemHeight: 0.7,
  stemWidth: 0.08,
  bandWidth: 0.06,
  plumeStart: 0.6,
  plumeFlex: 0.2,
  plumeSoftEdge: 0,
  windDir: 0.7,
  windWaveScale: 0.08,
  windSpeed: 1.2,
  windStr: 0.35,
  windGust: 0.25,
  windMicro: 0.15,
  stemColor: "#2d5a1f",
  plumeColor: "#ffffff",
  lodDistance: 35,
  maxDistance: 90,
  nearRingExtent: 3,
};

function hexToVec3(hex) {
  const c = new THREE.Color(hex);
  c.convertSRGBToLinear();
  return new THREE.Vector3(c.r, c.g, c.b);
}

/**
 * Build susuki material ctx from uniforms and options.
 * Pass uniforms from your app — wind (uWindDirX, uWindDirZ, etc.) is shared with grass.
 * Susuki-specific: uSusukiStemHeight, uSusukiStemWidth, uSusukiBandWidth, uSusukiPlumeStart, uSusukiStemColor, uSusukiPlumeColor.
 * @param {object} opts - { uniforms, heightTex, params }
 * @returns {object} ctx for createSusukiStemMaterial / createSusukiBandMaterial
 */
export function buildSusukiCtx(opts) {
  const { uniforms = {}, heightTex, params = SUSUKI_FIELD_PARAMS } = opts;
  const wd = Math.cos(params.windDir ?? 0.7);
  const wz = Math.sin(params.windDir ?? 0.7);
  return {
    heightTex,
    uTerrainSize: uniforms.uTerrainSize ?? uniform(800),
    uTime: uniforms.uTime ?? uniform(0),
    uStemHeight: uniforms.uSusukiStemHeight ?? uniform(params.stemHeight),
    uStemWidth: uniforms.uSusukiStemWidth ?? uniform(params.stemWidth),
    uBandWidth: uniforms.uSusukiBandWidth ?? uniform(params.bandWidth),
    uPlumeStart: uniforms.uSusukiPlumeStart ?? uniform(params.plumeStart),
    uSusukiPlumeFlex: uniforms.uSusukiPlumeFlex ?? uniform(params.plumeFlex ?? 0.2),
    uSusukiPlumeSoftEdge: uniforms.uSusukiPlumeSoftEdge ?? uniform(params.plumeSoftEdge ?? 0),
    uWindDirX: uniforms.uWindDirX ?? uniform(wd),
    uWindDirZ: uniforms.uWindDirZ ?? uniform(wz),
    uWindAxis:
      uniforms.uWindAxis ??
      uniform(new THREE.Vector3(Math.sin(params.windDir ?? 0.7), 0, -Math.cos(params.windDir ?? 0.7))),
    uCrossAxis:
      uniforms.uCrossAxis ??
      uniform(new THREE.Vector3(Math.cos(params.windDir ?? 0.7), 0, Math.sin(params.windDir ?? 0.7))),
    uWindWaveScale: uniforms.uWindWaveScale ?? uniform(params.windWaveScale),
    uWindSpeed: uniforms.uWindSpeed ?? uniform(params.windSpeed),
    uWindStr: uniforms.uWindStr ?? uniform(params.windStr),
    uWindGust: uniforms.uWindGust ?? uniform(params.windGust),
    uWindMicro: uniforms.uWindMicro ?? uniform(params.windMicro),
    uStemColor: uniforms.uSusukiStemColor ?? uniform(hexToVec3(params.stemColor)),
    uPlumeColor: uniforms.uSusukiPlumeColor ?? uniform(hexToVec3(params.plumeColor)),
    uSunDir: uniforms.uSunDir ?? uniform(new THREE.Vector3(0.5, 0.7, 0.5).normalize()),
    uAoIntensity: uniforms.uAoIntensity ?? uniform(1.0),
    uBsColor: uniforms.uBsColor ?? uniform(hexToVec3("#51cc66")),
    uBsPower: uniforms.uBsPower ?? uniform(2.0),
    uFrontScatter: uniforms.uFrontScatter ?? uniform(0.3),
    uRimSSS: uniforms.uRimSSS ?? uniform(0.4),
    uBsIntensity: uniforms.uBsIntensity ?? uniform(0.4),
    uSpecV1Intensity: uniforms.uSpecV1Intensity ?? uniform(1.5),
    uSpecV1Color: uniforms.uSpecV1Color ?? uniform(hexToVec3("#ffffff")),
    uSpecV1Dir:
      uniforms.uSpecV1Dir ?? uniform(new THREE.Vector3(-1, 1, 0.5).normalize()),
    uSpecV2Intensity: uniforms.uSpecV2Intensity ?? uniform(1.0),
    uSpecV2Color: uniforms.uSpecV2Color ?? uniform(hexToVec3("#ffffff")),
    uSpecV2Dir:
      uniforms.uSpecV2Dir ?? uniform(new THREE.Vector3(-1, 0.45, 1).normalize()),
    uSpecV2NoiseScale: uniforms.uSpecV2NoiseScale ?? uniform(3.0),
    uSpecV2NoiseStr: uniforms.uSpecV2NoiseStr ?? uniform(0.6),
    uSpecV2Power: uniforms.uSpecV2Power ?? uniform(12.0),
    uSpecV2TipBias: uniforms.uSpecV2TipBias ?? uniform(0.5),
    uTrailCenter: uniforms.uTrailCenter ?? uniform(new THREE.Vector2(9999, 9999)),
    uPlayerPos: uniforms.uPlayerPos ?? uniform(new THREE.Vector3(9999, 0, 9999)),
    uInteractionRange: uniforms.uInteractionRange ?? uniform(9999),
    uInteractionStrength: uniforms.uInteractionStrength ?? uniform(0),
    uInteractionHThresh: uniforms.uInteractionHThresh ?? uniform(2),
    uInteractionRepel: uniforms.uInteractionRepel ?? uniform(1),
  };
}

const STEM_VERTS_LOW = (SUSUKI_STEM_SEGMENTS_LOW + 1) * 2 * 2;
const STEM_VERTS_HIGH = (SUSUKI_STEM_SEGMENTS_HIGH + 1) * 2 * 2;
const BAND_VERTS_LOW = (SUSUKI_BAND_SEGMENTS_LOW + 1) * 2 * 2;
const BAND_VERTS_HIGH = (SUSUKI_BAND_SEGMENTS_HIGH + 1) * 2 * 2;

/**
 * Create all geometries and materials for the susuki field.
 * @param {object} susukiCtx - from buildSusukiCtx()
 * @returns {object} { stemGeoLow, stemGeoHigh, stemGeoNear, bandGeoLow, bandGeoHigh, bandGeoNear, stemMatLow, stemMatHigh, stemMatNear, bandMatLow, bandMatHigh, bandMatNear }
 */
export function createSusukiFieldResources(susukiCtx) {
  const stemGeoLow = createSusukiStemGeometry(
    SUSUKI_STEM_SEGMENTS_LOW,
    SUSUKI_PLANTS_PER_PATCH,
    SUSUKI_FIELD_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const stemGeoHigh = createSusukiStemGeometry(
    SUSUKI_STEM_SEGMENTS_HIGH,
    SUSUKI_PLANTS_PER_PATCH,
    SUSUKI_FIELD_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const stemGeoNear = createSusukiStemGeometry(
    SUSUKI_STEM_SEGMENTS_HIGH,
    SUSUKI_PLANTS_PER_PATCH,
    SUSUKI_NEAR_PATCH_SIZE,
    setSeed,
    randRange,
  );

  const bandGeoLow = createSusukiBandGeometry(
    SUSUKI_BAND_SEGMENTS_LOW,
    SUSUKI_PLANTS_PER_PATCH,
    SUSUKI_FIELD_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const bandGeoHigh = createSusukiBandGeometry(
    SUSUKI_BAND_SEGMENTS_HIGH,
    SUSUKI_PLANTS_PER_PATCH,
    SUSUKI_FIELD_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const bandGeoNear = createSusukiBandGeometry(
    SUSUKI_BAND_SEGMENTS_HIGH,
    SUSUKI_PLANTS_PER_PATCH,
    SUSUKI_NEAR_PATCH_SIZE,
    setSeed,
    randRange,
  );

  const stemMatLow = createSusukiStemMaterial(
    SUSUKI_STEM_SEGMENTS_LOW,
    STEM_VERTS_LOW,
    susukiCtx,
  );
  const stemMatHigh = createSusukiStemMaterial(
    SUSUKI_STEM_SEGMENTS_HIGH,
    STEM_VERTS_HIGH,
    susukiCtx,
  );
  const stemMatNear = createSusukiStemMaterial(
    SUSUKI_STEM_SEGMENTS_HIGH,
    STEM_VERTS_HIGH,
    susukiCtx,
  );

  const bandMatLow = createSusukiBandMaterial(
    SUSUKI_BAND_SEGMENTS_LOW,
    BAND_VERTS_LOW,
    susukiCtx,
  );
  const bandMatHigh = createSusukiBandMaterial(
    SUSUKI_BAND_SEGMENTS_HIGH,
    BAND_VERTS_HIGH,
    susukiCtx,
  );
  const bandMatNear = createSusukiBandMaterial(
    SUSUKI_BAND_SEGMENTS_HIGH,
    BAND_VERTS_HIGH,
    susukiCtx,
  );

  return {
    stemGeoLow,
    stemGeoHigh,
    stemGeoNear,
    bandGeoLow,
    bandGeoHigh,
    bandGeoNear,
    stemMatLow,
    stemMatHigh,
    stemMatNear,
    bandMatLow,
    bandMatHigh,
    bandMatNear,
  };
}

/**
 * Setup susuki patch system — camera-following grid, frustum culling, LOD.
 * Each patch = stem mesh + band mesh. Same pattern as grass.
 *
 * @param {THREE.Scene} scene - unused, meshes go into susukiGroup
 * @param {THREE.Camera} camera - for patch placement
 * @param {THREE.Group} susukiGroup - parent for all susuki meshes
 * @param {object} geosAndMats - from createSusukiFieldResources
 * @param {object} options - PATCH_SPACING, GRID_SIZE, NEAR_PATCH_SIZE, lodDistance, maxDistance, nearRingExtent, charPos
 * @returns {{ update(charPos: THREE.Vector3, frustum: THREE.Frustum): { patchCount: number } }}
 */
export function setupSusukiPatches(
  scene,
  camera,
  susukiGroup,
  geosAndMats,
  options,
) {
  const {
    stemGeoLow,
    stemGeoHigh,
    stemGeoNear,
    bandGeoLow,
    bandGeoHigh,
    bandGeoNear,
    stemMatLow,
    stemMatHigh,
    stemMatNear,
    bandMatLow,
    bandMatHigh,
    bandMatNear,
  } = geosAndMats;

  const PATCH_SPACING = options.PATCH_SPACING ?? SUSUKI_FIELD_PATCH_SPACING;
  const GRID_SIZE = options.GRID_SIZE ?? 18;
  const NEAR_PATCH_SIZE = options.NEAR_PATCH_SIZE ?? SUSUKI_NEAR_PATCH_SIZE;

  const poolStemLow = { meshes: [], idx: 0 };
  const poolStemHigh = { meshes: [], idx: 0 };
  const poolStemNear = { meshes: [], idx: 0 };
  const poolBandLow = { meshes: [], idx: 0 };
  const poolBandHigh = { meshes: [], idx: 0 };
  const poolBandNear = { meshes: [], idx: 0 };

  function getMesh(pool, geo, mat) {
    if (pool.idx < pool.meshes.length) return pool.meshes[pool.idx++];
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    susukiGroup.add(m);
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
    const lodDistance = options.lodDistance ?? 35;
    const maxDistance = options.maxDistance ?? 90;
    const nearRingExtent = options.nearRingExtent ?? 3;
    const gridSize = options.GRID_SIZE ?? 18;

    for (let i = 0; i < susukiGroup.children.length; i++)
      susukiGroup.children[i].visible = false;
    poolStemLow.idx = 0;
    poolStemHigh.idx = 0;
    poolStemNear.idx = 0;
    poolBandLow.idx = 0;
    poolBandHigh.idx = 0;
    poolBandNear.idx = 0;

    baseCellPos
      .copy(camera.position)
      .divideScalar(PATCH_SPACING)
      .floor()
      .multiplyScalar(PATCH_SPACING);
    cameraPosXZ.set(camera.position.x, 0, camera.position.z);
    let patchCount = 0;

    for (let x = -gridSize; x < gridSize; x++) {
      for (let z = -gridSize; z < gridSize; z++) {
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
        const stemGeo = useLow ? stemGeoLow : stemGeoHigh;
        const stemMat = useLow ? stemMatLow : stemMatHigh;
        const bandGeo = useLow ? bandGeoLow : bandGeoHigh;
        const bandMat = useLow ? bandMatLow : bandMatHigh;
        const stemPool = useLow ? poolStemLow : poolStemHigh;
        const bandPool = useLow ? poolBandLow : poolBandHigh;

        const stemMesh = getMesh(stemPool, stemGeo, stemMat);
        stemMesh.material = stemMat;
        stemMesh.position.set(cellPos.x, 0, cellPos.z);
        stemMesh.visible = true;

        const bandMesh = getMesh(bandPool, bandGeo, bandMat);
        bandMesh.material = bandMat;
        bandMesh.position.set(cellPos.x, 0, cellPos.z);
        bandMesh.visible = true;

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

        const stemMesh = getMesh(poolStemNear, stemGeoNear, stemMatNear);
        stemMesh.material = stemMatNear;
        stemMesh.position.copy(cellPos);
        stemMesh.visible = true;

        const bandMesh = getMesh(poolBandNear, bandGeoNear, bandMatNear);
        bandMesh.material = bandMatNear;
        bandMesh.position.copy(cellPos);
        bandMesh.visible = true;

        patchCount++;
      }
    }

    return { patchCount };
  }

  return { update };
}
