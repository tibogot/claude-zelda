/**
 * Load the exact same GLB assets Bruno Simon uses for bushes and trees (folio 2025).
 * Paths are relative to project root; folio-2025-main must be present (sibling folder or same repo).
 * Compressed GLBs use KTX2 textures, so renderer is required for KTX2Loader.detectSupport().
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";

const FOLIO_BASE = "folio-2025-main/static";

function getGLTFLoader(renderer) {
  const draco = new DRACOLoader();
  draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath("https://cdn.jsdelivr.net/npm/three@0.183.1/examples/jsm/libs/basis/");
  ktx2.detectSupport(renderer);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2);
  return loader;
}

/**
 * Load folio bushes and trees assets (same GLBs as folio 2025).
 * @param {THREE.Renderer} renderer - WebGPURenderer (needed for KTX2Loader.detectSupport)
 * @returns {Promise<{ bushesReferences: object, oakTreesVisual: object, oakTreesReferences: object }>}
 */
export async function loadFolioAssets(renderer) {
  const loader = getGLTFLoader(renderer);
  const load = (path) =>
    new Promise((resolve, reject) => {
      loader.load(path, resolve, undefined, reject);
    });

  const [bushesReferences, oakTreesVisual, oakTreesReferences] = await Promise.all([
    load(`${FOLIO_BASE}/bushes/bushesReferences-compressed.glb`),
    load(`${FOLIO_BASE}/oakTrees/oakTreesVisual-compressed.glb`),
    load(`${FOLIO_BASE}/oakTrees/oakTreesReferences-compressed.glb`),
  ]);

  return {
    bushesReferences: bushesReferences,
    oakTreesVisual: oakTreesVisual,
    oakTreesReferences: oakTreesReferences,
  };
}
