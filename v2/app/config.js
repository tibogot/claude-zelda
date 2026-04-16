export const V2_CONFIG = {
  world: {
    size: 1600,
    chunkSize: 100,
    dataResolution: 64,
    minHeight: -60,
    maxHeight: 180,
    /** When true, new chunks are filled with `initialHeight` instead of `sampleInitialHeight` noise. */
    flatInitialTerrain: true,
    initialHeight: 0,
  },
  lod: {
    enabled: true,
    /** v1 used 0.2; 0.15 is slightly snappier but may thrash near threshold boundaries. */
    hysteresis: 0.2,
    /** v1 default: 16 (covers full 1600m world from any corner). Keeps L4 chunks streaming but they are cheap. */
    activeRadiusInChunks: 16,
    /** Thresholds match `splatmap-chunks.html` CONFIG.lodLevels: 200/420/800/1400/∞. */
    levels: [
      { maxDistance: 200, segments: 64, label: "L0" },
      { maxDistance: 420, segments: 32, label: "L1" },
      { maxDistance: 800, segments: 16, label: "L2" },
      { maxDistance: 1400, segments: 8, label: "L3" },
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
    /**
     * v1 `PARAMS.brushFalloff` enum — only affects raise/lower default "smooth" stamp.
     * "smooth" (cosine) | "linear" | "sphere" | "hard".
     */
    defaultBrushFalloff: "smooth",
    /**
     * v1 `PARAMS.sculptBrush` for raise/lower only: `smooth` uses brushFalloff enum;
     * `plateau` is the v1 mesa curve; `crater` is the v1 rim-minus-pit curve.
     */
    defaultRaiseLowerStamp: "smooth",
    /** v1 `PARAMS.terraceStep` / `PARAMS.terraceSharpness` — `terrace` sculpt mode. */
    terrace: {
      step: 4,
      sharpness: 0.6,
    },
    spacingFactor: 0.22,
    /** v1 `PARAMS.noiseScale` / `noiseOctaves` — sculpt noise brush FBM. */
    noiseScale: 2.5,
    noiseOctaves: 2,
    /** Viewport brush cursor: `"dome"` (hemisphere + edges) or `"circle"` (flat ring). */
    previewShape: "dome",
    /**
     * Two-point ramp shaping (v1 used fixed cross falloff ^2 and linear height).
     * - crossExponent: power on (1 - dist_perp/r); lower ≈ wider “flat” corridor, higher ≈ sharp sides.
     * - alongExponent: power on t along A→B for height only; >1 = gentler start / steeper finish, <1 opposite.
     */
    ramp: {
      crossExponent: 2,
      alongExponent: 1,
    },
    /** v1 `PARAMS.erosion` — hydraulic brush + future global pass (`iterations` unused by brush). */
    erosion: {
      iterations: 30000,
      erosionRate: 0.3,
      depositionRate: 0.3,
      evaporation: 0.015,
      inertia: 0.1,
      capacity: 6,
      radius: 3,
    },
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
    /** `splatmap-chunks.html` PARAMS.gen — procedural height (all chunks). */
    gen: {
      mode: "ridge",
      scale: 4.0,
      octaves: 6,
      height: 120,
      seed: 0,
      domainWarp: 0.5,
      dropoff: 1.2,
      dropoffShape: "circle",
      offsetX: 0,
      offsetZ: 0,
      plains: 0,
      additive: false,
      tiltX: 0,
      tiltZ: 0,
    },
  },
  render: {
    terrainSkirtDepth: 80,
    maxPixelRatio: 2,
    clearColor: 0xa3c7df,
  },
  /** Defaults from `splatmap-chunks.html` PARAMS.light (sun + fill + tone exposure). */
  light: {
    sunAzimuth: 135,
    sunElevation: 43,
    dirColor: "#fff5e0",
    dirIntensity: 2.2,
    hemiSkyColor: "#c8e0ff",
    hemiGroundColor: "#88aa55",
    hemiIntensity: 0.4,
    envIntensity: 0.2,
    exposure: 0.5,
    sunDistance: 600,
    shadowBias: -0.0005,
    shadowNormalBias: 0.02,
  },
  /** `splatmap-chunks.html` PARAMS.lensFlare — sun-anchored screen-space flare. */
  lensFlare: {
    enabled: true,
    intensity: 3.0,
    halationSize: 3.0,
    halationColor: "#ffdca8",
    streakLength: 0.0,
    streakOpacity: 0.7,
    streakColor: "#8cc8ff",
    ghostOpacity: 2.0,
    ghostSpacing: 1.0,
    dirtOpacity: 0.0,
  },
  /** `splatmap-chunks.html` PARAMS.sky when mode === "physical" (SkyMesh uniforms). */
  physicalSky: {
    turbidity: 2,
    rayleigh: 1.5,
    mie: 0.005,
    mieG: 0.8,
    cloudCoverage: 0.4,
    cloudDensity: 0.4,
    cloudElevation: 0.5,
    meshScale: 10000,
  },
  /** `splatmap-chunks.html` PARAMS.csm — WebGPU `CSMShadowNode` on the sun. */
  csm: {
    enabled: true,
    cascades: 2,
    maxFar: 300,
    lightMargin: 100,
    mapSize: 2048,
    updateEveryFrame: false,
  },
  /** WebGPU TSL fog — same defaults as `splatmap-chunks.html` PARAMS.fog. */
  fog: {
    height: {
      enabled: false,
      color: "#a8c4e0",
      density: 0.05,
      height: 2.0,
    },
    distance: {
      enabled: false,
      color: "#d0e4f0",
      density: 0.006,
    },
  },
};

export function getChunkCountPerAxis(config = V2_CONFIG) {
  return Math.floor(config.world.size / config.world.chunkSize);
}

