/**
 * Grass Lab — hybrid system re-export.
 * The implementation moved into v2 (single source of truth) when wiring
 * began; the lab and v2 now share the exact same module.
 */
export {
  HybridGrassSystem,
  syncHybridGrassLod,
  rebuildHybridGrassGeometries,
} from "./v2/render/hybridGrass/hybridGrassSystem.js";
