/**
 * Loads a tree preset JSON (exported from tree-unreal-showcase.html),
 * samples foliage clusters, creates TSL material, loads trunk GLB,
 * and returns everything needed for a single slot.
 */
import * as THREE from "three";
import { createFoliageMaterial, setFoliageTexture, applyPresetMaterial, updateFoliageBounds } from "../../render/foliage/foliageMaterial.js";
import { sampleAllClusters, computeFoliageBounds, buildAllFoliageLods } from "./foliageSampler.js";
import { loadTreeGlbFromUrl } from "./glbLoader.js";

const TRUNK_SEARCH_PATHS = [
  "../models/trunks/",
  "models/trunks/",
];

export async function loadFoliagePreset(presetJson) {
  const foliageMat = createFoliageMaterial(presetJson.material);
  applyPresetMaterial(foliageMat, presetJson);

  if (presetJson.leafTexture) {
    const texPath = presetJson.leafTexture;
    const candidates = [`../${texPath}`, texPath];
    let tex = null;
    for (const path of candidates) {
      try {
        tex = await new Promise((resolve, reject) => {
          new THREE.TextureLoader().load(path, resolve, undefined, () =>
            reject(new Error(`Texture not found: ${path}`))
          );
        });
        break;
      } catch (_) { /* try next */ }
    }
    if (tex) {
      setFoliageTexture(foliageMat, tex);
    } else {
      console.warn(`[Foliage] Could not load leaf texture "${texPath}" — foliage will render without texture`);
    }
  }

  const clusters = presetJson.clusters || [];
  const tScale = presetJson.trunkScale ?? 1;
  const { allPos, allRands } = sampleAllClusters(clusters, tScale);

  if (allPos.length === 0) {
    return {
      material: foliageMat.material,
      leafMapNode: foliageMat.leafMapNode,
      uniforms: foliageMat.uniforms,
      lods: [null, null, null],
      bounds: null,
    };
  }

  const bounds = computeFoliageBounds(allPos);
  updateFoliageBounds(foliageMat, bounds.yMin, bounds.yMax, bounds.canopyCenter, bounds.aoRadius);

  const lods = buildAllFoliageLods(allPos, allRands);

  return {
    material: foliageMat.material,
    leafMapNode: foliageMat.leafMapNode,
    uniforms: foliageMat.uniforms,
    lods,
    bounds,
  };
}

async function loadTrunkGlb(filename) {
  if (!filename) return null;
  for (const base of TRUNK_SEARCH_PATHS) {
    try {
      const result = await loadTreeGlbFromUrl(base + filename);
      return result.submeshes;
    } catch (_) { /* try next */ }
  }
  console.warn(`[Preset] Could not find trunk GLB "${filename}" in search paths`);
  return null;
}

/**
 * Full one-click preset load: parses JSON, loads trunk GLB + leaf texture,
 * samples foliage clusters. Returns { foliagePreset, trunkSubmeshes, trunkLod1Submeshes, json }.
 */
export function loadFullPresetFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target.result);

        const [foliagePreset, trunkSubmeshes, trunkLod1Submeshes] = await Promise.all([
          loadFoliagePreset(json),
          loadTrunkGlb(json.trunkFile),
          json.trunkLod1File ? loadTrunkGlb(json.trunkLod1File) : Promise.resolve(null),
        ]);

        resolve({ foliagePreset, trunkSubmeshes, trunkLod1Submeshes, json });
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
