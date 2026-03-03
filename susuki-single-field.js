/**
 * Susuki single field — one dense, fixed field of susuki grass.
 * Unlike susuki-field.js (camera-following grid everywhere), this places a single
 * dense field at a fixed world position. Uses noise for organic, natural-looking edges.
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

// CPU noise for organic field shape (no external deps)
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x, y, octaves = 4) {
  let v = 0, amp = 1, freq = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    v += noise2(x * freq, y * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / total;
}
function smoothstep(a, b, t) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

/** Returns 0–1: blob-shaped field mask. Domain warping creates amoeba-like organic edges. */
function fieldMask(px, pz, centerX, centerZ, baseRadius, opts = {}) {
  const {
    noiseScale = 0.04,
    warpScale = 0.035,
    warpAmt = 22,
    noiseAmount = 0.55,
    edgeSoftness = 10,
  } = opts;

  // Domain warp: distort coords before sampling — creates blob-like twists, not circular
  const wx = px + fbm(px * warpScale, pz * warpScale) * warpAmt;
  const wz = pz + fbm(px * warpScale + 100, pz * warpScale + 50) * warpAmt;

  const dx = wx - centerX, dz = wz - centerZ;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const n = fbm(wx * noiseScale, wz * noiseScale);
  const radiusVariation = 1 + (n - 0.5) * 2 * noiseAmount;
  const effectiveRadius = baseRadius * radiusVariation;
  return 1 - smoothstep(effectiveRadius - edgeSoftness, effectiveRadius, dist);
}

// Dense single field: more plants per patch, smaller patch size
export const SUSUKI_SINGLE_PATCH_SIZE = 12;
export const SUSUKI_SINGLE_PATCH_SPACING = 12;
export const SUSUKI_SINGLE_PLANTS_PER_PATCH = 24 * 24; // 576 plants per patch (vs 144 in main field)
export const SUSUKI_SINGLE_STEM_SEGMENTS = 6;
export const SUSUKI_SINGLE_BAND_SEGMENTS = 8;

const STEM_VERTS = (SUSUKI_SINGLE_STEM_SEGMENTS + 1) * 2 * 2;
const BAND_VERTS = (SUSUKI_SINGLE_BAND_SEGMENTS + 1) * 2 * 2;

/**
 * Create geometries and materials for the single dense susuki field.
 * @param {object} susukiCtx - from buildSusukiCtx()
 * @returns {object} { stemGeo, bandGeo, stemMat, bandMat }
 */
export function createSusukiSingleFieldResources(susukiCtx) {
  const stemGeo = createSusukiStemGeometry(
    SUSUKI_SINGLE_STEM_SEGMENTS,
    SUSUKI_SINGLE_PLANTS_PER_PATCH,
    SUSUKI_SINGLE_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const bandGeo = createSusukiBandGeometry(
    SUSUKI_SINGLE_BAND_SEGMENTS,
    SUSUKI_SINGLE_PLANTS_PER_PATCH,
    SUSUKI_SINGLE_PATCH_SIZE,
    setSeed,
    randRange,
  );
  const stemMat = createSusukiStemMaterial(
    SUSUKI_SINGLE_STEM_SEGMENTS,
    STEM_VERTS,
    susukiCtx,
  );
  const bandMat = createSusukiBandMaterial(
    SUSUKI_SINGLE_BAND_SEGMENTS,
    BAND_VERTS,
    susukiCtx,
  );
  return { stemGeo, bandGeo, stemMat, bandMat };
}

/**
 * Setup a single fixed dense susuki field at a world position.
 * Uses noise to create organic, natural-looking edges (not a square).
 * Patches are placed only where fieldMask > threshold.
 *
 * @param {THREE.Group} susukiGroup - parent for all susuki meshes
 * @param {object} resources - from createSusukiSingleFieldResources
 * @param {object} options - { centerX, centerZ, gridSize, patchSpacing, baseRadius, noiseScale, warpScale, warpAmt, noiseAmount, threshold, maxViewDist }
 * @returns {{ update(charPos: THREE.Vector3, frustum: THREE.Frustum): { patchCount: number } }}
 */
export function setupSusukiSingleField(susukiGroup, resources, options) {
  const {
    stemGeo,
    bandGeo,
    stemMat,
    bandMat,
  } = resources;

  const centerX = options.centerX ?? 50;
  const centerZ = options.centerZ ?? 30;
  const gridSize = options.gridSize ?? 12;
  const patchSpacing = options.patchSpacing ?? SUSUKI_SINGLE_PATCH_SPACING;
  const baseRadius = options.baseRadius ?? 52;
  const threshold = options.threshold ?? 0.38;
  const maxViewDist = options.maxViewDist ?? 85;

  const maskOpts = {
    noiseScale: options.noiseScale ?? 0.04,
    warpScale: options.warpScale ?? 0.035,
    warpAmt: options.warpAmt ?? 22,
    noiseAmount: options.noiseAmount ?? 0.55,
    edgeSoftness: options.edgeSoftness ?? 10,
  };

  const stemMeshes = [];
  const bandMeshes = [];
  const aabb = new THREE.Box3();
  const aabbSize = new THREE.Vector3(patchSpacing, 1000, patchSpacing);
  const fieldCenter = new THREE.Vector3(centerX, 0, centerZ);

  const halfGrid = Math.floor(gridSize / 2);
  for (let x = -halfGrid; x <= halfGrid; x++) {
    for (let z = -halfGrid; z <= halfGrid; z++) {
      const px = centerX + x * patchSpacing;
      const pz = centerZ + z * patchSpacing;

      const mask = fieldMask(px, pz, centerX, centerZ, baseRadius, maskOpts);
      if (mask < threshold) continue;

      const stemMesh = new THREE.Mesh(stemGeo, stemMat);
      stemMesh.position.set(px, 0, pz);
      stemMesh.frustumCulled = false;
      stemMesh.castShadow = false;
      stemMesh.receiveShadow = true;
      susukiGroup.add(stemMesh);
      stemMeshes.push(stemMesh);

      const bandMesh = new THREE.Mesh(bandGeo, bandMat);
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
    const fieldInRange = distToField < maxViewDist;

    let patchCount = 0;
    for (let i = 0; i < stemMeshes.length; i++) {
      const stemMesh = stemMeshes[i];
      const bandMesh = bandMeshes[i];
      const visible = fieldInRange && (() => {
        cellPos.set(stemMesh.position.x, 0, stemMesh.position.z);
        aabb.setFromCenterAndSize(cellPos, aabbSize);
        return frustum.intersectsBox(aabb);
      })();
      stemMesh.visible = visible;
      bandMesh.visible = visible;
      if (visible) patchCount++;
    }
    return { patchCount };
  }

  return { update };
}
