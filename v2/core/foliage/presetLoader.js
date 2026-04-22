/**
 * Loads a tree preset JSON (exported from tree-unreal-showcase.html),
 * samples foliage clusters, creates TSL material, and returns a slot preset
 * ready for FoliageLodRenderer.setSlotPreset().
 */
import * as THREE from "three";
import { createFoliageMaterial, setFoliageTexture, applyPresetMaterial, updateFoliageBounds } from "../../render/foliage/foliageMaterial.js";
import { sampleAllClusters, computeFoliageBounds, buildFoliageLod } from "./foliageSampler.js";

export async function loadFoliagePreset(presetJson) {
  const foliageMat = createFoliageMaterial(presetJson.material);
  applyPresetMaterial(foliageMat, presetJson);

  if (presetJson.leafTexture) {
    const tex = await new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(presetJson.leafTexture, resolve, undefined, reject);
    });
    setFoliageTexture(foliageMat, tex);
  }

  const clusters = presetJson.clusters || [];
  const { allPos, allRands } = sampleAllClusters(clusters);

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

  const lods = [];
  for (let tier = 0; tier < 3; tier++) {
    const lodData = buildFoliageLod(allPos, allRands, tier);
    lods.push(lodData);
  }

  return {
    material: foliageMat.material,
    leafMapNode: foliageMat.leafMapNode,
    uniforms: foliageMat.uniforms,
    lods,
    bounds,
  };
}

export function loadFoliagePresetFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const json = JSON.parse(ev.target.result);
        const preset = await loadFoliagePreset(json);
        resolve({ preset, json });
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsText(file);
  });
}
