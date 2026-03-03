/**
 * Susuki single field — one dense, fixed field of susuki grass.
 * Unlike susuki-field.js (camera-following grid everywhere), this places a single
 * dense square field at a fixed world position. Geometry LOD for perf when far.
 * Does not modify susuki-field.js.
 */
import * as THREE from "three";
import { setSeed, randRange } from "./rng.js";
import {
  createSusukiStemGeometry,
  createSusukiBandGeometry,
  createSusukiStemMaterial,
  createSusukiBandMaterial,
} from "./susuki.js";
import { buildSusukiCtx } from "./susuki-field.js";

function smoothstep(a, b, t) {
  const x = Math.max(0, Math.min(1, (b - a) !== 0 ? (t - a) / (b - a) : 0));
  return x * x * (3 - 2 * x);
}

/** Returns 0–1: simple square field with soft edges. No holes. */
function fieldMask(px, pz, centerX, centerZ, halfWidth, halfDepth, edgeSoft = 8) {
  const dx = Math.abs(px - centerX);
  const dz = Math.abs(pz - centerZ);
  const fx = 1 - smoothstep(halfWidth - edgeSoft, halfWidth, dx);
  const fz = 1 - smoothstep(halfDepth - edgeSoft, halfDepth, dz);
  return fx * fz;
}

// High LOD: dense, detailed
export const SUSUKI_SINGLE_PATCH_SIZE = 12;
export const SUSUKI_SINGLE_PATCH_SPACING = 12;
export const SUSUKI_SINGLE_PLANTS_HIGH = 24 * 24;

const STEM_SEGMENTS_HIGH = 6;
const BAND_SEGMENTS_HIGH = 8;
const STEM_SEGMENTS_LOW = 3;
const BAND_SEGMENTS_LOW = 4;
const PLANTS_LOW = 12 * 12;

const STEM_VERTS_HIGH = (STEM_SEGMENTS_HIGH + 1) * 2 * 2;
const BAND_VERTS_HIGH = (BAND_SEGMENTS_HIGH + 1) * 2 * 2;
const STEM_VERTS_LOW = (STEM_SEGMENTS_LOW + 1) * 2 * 2;
const BAND_VERTS_LOW = (BAND_SEGMENTS_LOW + 1) * 2 * 2;

/**
 * Create all geometries and materials for the single dense susuki field (high + low LOD).
 * @param {object} susukiCtx - from buildSusukiCtx()
 * @returns {object} { stemGeoHigh, bandGeoHigh, stemMatHigh, bandMatHigh, stemGeoLow, bandGeoLow, stemMatLow, bandMatLow }
 */
export function createSusukiSingleFieldResources(susukiCtx) {
  const stemGeoHigh = createSusukiStemGeometry(
    STEM_SEGMENTS_HIGH,
    SUSUKI_SINGLE_PLANTS_HIGH,
    SUSUKI_SINGLE_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const bandGeoHigh = createSusukiBandGeometry(
    BAND_SEGMENTS_HIGH,
    SUSUKI_SINGLE_PLANTS_HIGH,
    SUSUKI_SINGLE_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const stemMatHigh = createSusukiStemMaterial(
    STEM_SEGMENTS_HIGH,
    STEM_VERTS_HIGH,
    susukiCtx,
  );
  const bandMatHigh = createSusukiBandMaterial(
    BAND_SEGMENTS_HIGH,
    BAND_VERTS_HIGH,
    susukiCtx,
  );

  const stemGeoLow = createSusukiStemGeometry(
    STEM_SEGMENTS_LOW,
    PLANTS_LOW,
    SUSUKI_SINGLE_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const bandGeoLow = createSusukiBandGeometry(
    BAND_SEGMENTS_LOW,
    PLANTS_LOW,
    SUSUKI_SINGLE_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const stemMatLow = createSusukiStemMaterial(
    STEM_SEGMENTS_LOW,
    STEM_VERTS_LOW,
    susukiCtx,
  );
  const bandMatLow = createSusukiBandMaterial(
    BAND_SEGMENTS_LOW,
    BAND_VERTS_LOW,
    susukiCtx,
  );

  return {
    stemGeoHigh,
    bandGeoHigh,
    stemMatHigh,
    bandMatHigh,
    stemGeoLow,
    bandGeoLow,
    stemMatLow,
    bandMatLow,
  };
}

/**
 * Setup a single fixed dense square susuki field at a world position.
 * Geometry LOD: swaps to low-poly when far — no holes, full coverage.
 *
 * @param {THREE.Group} susukiGroup - parent for all susuki meshes
 * @param {object} resources - from createSusukiSingleFieldResources
 * @param {object} options - { centerX, centerZ, halfWidth, halfDepth, patchSpacing, threshold, lodDist }
 * @returns {{ update(charPos: THREE.Vector3, frustum: THREE.Frustum): { patchCount: number } }}
 */
export function setupSusukiSingleField(susukiGroup, resources, options) {
  const {
    stemGeoHigh,
    bandGeoHigh,
    stemMatHigh,
    bandMatHigh,
    stemGeoLow,
    bandGeoLow,
    stemMatLow,
    bandMatLow,
  } = resources;

  const centerX = options.centerX ?? 50;
  const centerZ = options.centerZ ?? 30;
  const halfWidth = options.halfWidth ?? 60;
  const halfDepth = options.halfDepth ?? 60;
  const patchSpacing = options.patchSpacing ?? SUSUKI_SINGLE_PATCH_SPACING;
  const threshold = options.threshold ?? 0.2;
  const lodDist = options.lodDist ?? 55;
  const lodHysteresis = options.lodHysteresis ?? 6;
  let currentLodHigh = true;

  const stemMeshes = [];
  const bandMeshes = [];
  const aabb = new THREE.Box3();
  const aabbSize = new THREE.Vector3(patchSpacing, 1000, patchSpacing);
  const fieldCenter = new THREE.Vector3(centerX, 0, centerZ);

  const minX = centerX - halfWidth;
  const maxX = centerX + halfWidth;
  const minZ = centerZ - halfDepth;
  const maxZ = centerZ + halfDepth;

  for (let px = Math.floor(minX / patchSpacing) * patchSpacing; px <= maxX; px += patchSpacing) {
    for (let pz = Math.floor(minZ / patchSpacing) * patchSpacing; pz <= maxZ; pz += patchSpacing) {
      const mask = fieldMask(px, pz, centerX, centerZ, halfWidth, halfDepth);
      if (mask < threshold) continue;

      const stemMesh = new THREE.Mesh(stemGeoHigh, stemMatHigh);
      stemMesh.position.set(px, 0, pz);
      stemMesh.frustumCulled = false;
      stemMesh.castShadow = false;
      stemMesh.receiveShadow = true;
      susukiGroup.add(stemMesh);
      stemMeshes.push(stemMesh);

      const bandMesh = new THREE.Mesh(bandGeoHigh, bandMatHigh);
      bandMesh.position.set(px, 0, pz);
      bandMesh.frustumCulled = false;
      bandMesh.castShadow = false;
      bandMesh.receiveShadow = true;
      susukiGroup.add(bandMesh);
      bandMeshes.push(bandMesh);
    }
  }

  const cellPos = new THREE.Vector3();
  const camPosXZ = new THREE.Vector3();

  function update(charPos, frustum) {
    camPosXZ.set(charPos.x, 0, charPos.z);
    const distToField = camPosXZ.distanceTo(fieldCenter);
    if (distToField > lodDist + lodHysteresis * 0.5) currentLodHigh = false;
    else if (distToField < lodDist - lodHysteresis * 0.5) currentLodHigh = true;
    const useLowLod = !currentLodHigh;

    const stemGeo = useLowLod ? stemGeoLow : stemGeoHigh;
    const bandGeo = useLowLod ? bandGeoLow : bandGeoHigh;
    const stemMat = useLowLod ? stemMatLow : stemMatHigh;
    const bandMat = useLowLod ? bandMatLow : bandMatHigh;

    let patchCount = 0;
    for (let i = 0; i < stemMeshes.length; i++) {
      const stemMesh = stemMeshes[i];
      const bandMesh = bandMeshes[i];
      cellPos.set(stemMesh.position.x, 0, stemMesh.position.z);
      aabb.setFromCenterAndSize(cellPos, aabbSize);
      const inFrustum = frustum.intersectsBox(aabb);

      stemMesh.geometry = stemGeo;
      stemMesh.material = stemMat;
      bandMesh.geometry = bandGeo;
      bandMesh.material = bandMat;
      stemMesh.visible = inFrustum;
      bandMesh.visible = inFrustum;
      if (inFrustum) patchCount++;
    }
    return { patchCount };
  }

  return { update };
}
