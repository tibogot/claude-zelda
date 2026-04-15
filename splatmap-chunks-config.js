/** Static terrain / editor dimensions (no Three.js, no PARAMS). */

export const TERRAIN_SURFACE_LABEL = {
  tile: "tile grid",
  tslGround: "painter TSL ground",
  splat: "splat paint",
  greenGround: "green seam-test",
};

export const CONFIG = {
  worldSize: 1600,
  chunkSize: 100,
  activeRadiusInChunks: 16,
  dataResolution: 64,
  maxTerrainHeight: 26,
  /** Brush ring mesh is built at this world radius; live sculpt size/strength = Tweakpane Brush sliders. */
  sculpt: {
    ringGeomBase: 26,
  },
  lodLevels: [
    { maxDistance: 200, segments: 64, label: "L0" },
    { maxDistance: 420, segments: 32, label: "L1" },
    { maxDistance: 800, segments: 16, label: "L2" },
    { maxDistance: 1400, segments: 8, label: "L3" },
    { maxDistance: Infinity, segments: 4, label: "L4" },
  ],
  splatRes: 256,
  paint: {
    radius: 22,
    strength: 0.35,
  },
  /**
   * Unity-style terrain skirts: duplicate the chunk edge ring straight down so
   * sub-pixel cracks / LOD transitions never show the sky (same idea as Unity
   * Terrain LOD skirts; Unreal landscapes rely more on shared edges + overlap).
   */
  terrainSkirtDepth: 100,
};

export const SCULPT_RING_GEOM_BASE = CONFIG.sculpt.ringGeomBase;
export const BARRIER_RES = CONFIG.splatRes;
export const HOLE_RES = BARRIER_RES;
