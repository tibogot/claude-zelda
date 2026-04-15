export const V2_CONFIG = {
  world: {
    size: 1600,
    chunkSize: 100,
    dataResolution: 64,
    minHeight: -60,
    maxHeight: 180,
  },
  lod: {
    enabled: true,
    hysteresis: 0.15,
    activeRadiusInChunks: 9,
    levels: [
      { maxDistance: 180, segments: 64, label: "L0" },
      { maxDistance: 360, segments: 32, label: "L1" },
      { maxDistance: 720, segments: 16, label: "L2" },
      { maxDistance: 1200, segments: 8, label: "L3" },
      { maxDistance: Infinity, segments: 4, label: "L4" },
    ],
  },
  budgets: {
    createPerFrame: 2,
    remeshPerFrame: 3,
    /** Incremental sculpt remeshes — far cheaper than full rebuilds, larger cap. */
    sculptRemeshPerFrame: 24,
    unloadPerFrame: 8,
    cheapSegmentThreshold: 8,
    cheapCreateBonusPerFrame: 24,
  },
  sculpt: {
    brushMin: 2,
    brushMax: 120,
    strengthMin: 0.02,
    strengthMax: 2.5,
    defaultRadius: 28,
    defaultStrength: 0.55,
    defaultFalloff: 1.8,
    spacingFactor: 0.22,
    /** Same idea as `splatmap-chunks.html` PARAMS.sculptClamp* — not the initial noise range. */
    sculptClampMin: -200,
    sculptClampMax: 2000,
    /**
     * FBM peak stamp — v1 `fbm_peak` used fixed literals; v2 exposes them (defaults match v1).
     */
    fbmPeak: {
      /** Multiplies built-in frequency `3.5 / radius` (higher = finer detail in the stamp). */
      freqMul: 1,
      octaves: 6,
      spikePower: 2.5,
      base: 0.35,
      ridgeWeight: 1.8,
      gain: 2.0,
    },
  },
  render: {
    terrainSkirtDepth: 80,
    maxPixelRatio: 2,
    clearColor: 0xa3c7df,
  },
};

export function getChunkCountPerAxis(config = V2_CONFIG) {
  return Math.floor(config.world.size / config.world.chunkSize);
}

