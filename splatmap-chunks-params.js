import { OCEAN_DEFAULTS } from "./ocean-shader.js";
import { MEADOW_DEFAULT_PARAMS } from "./chunkMeadowTsl.js";
import { GROUND_DEFAULT_PARAMS } from "./chunkGroundTsl.js";

/** Tweakpane + lighting — sky defaults to Physical (SkyMesh + PMREM); HDR available in UI. */
export const PARAMS = {
  mode: "view",
  /** When false, every loaded chunk uses L0 (max segments) so you can tell LOD vs pure chunk seams. */
  terrainLodEnabled: true,
  /** When false, load all chunks in the world (ignore camera radius) and turn off mesh frustum cull for placement / overview. */
  terrainChunkCulling: true,
  /** tile | tslGround (painter-style proc. ground + splat) | splat | greenGround | imgTex */
  terrainSurface: "tile",
  /** Index of image slot used for imgTex surface (0=Rock, 1=Grass, 2=Ground). */
  imgTexSlotIndex: 1,
  /** Paint [P]: meadow density (TSL) | splat RGB | image slots. U cycles targets. */
  paintLayerTarget: "meadow",
  /** Organic brush mask: 0 = solid radial disk, 1 = fully carved by fbm noise. */
  paintNoiseAmount: 0,
  /** Spatial frequency of the mask noise in world units — larger = chunkier splats. */
  paintNoiseScale: 0.08,
  /** fbm octaves for the mask noise. */
  paintNoiseOctaves: 3,
  /** Painter-style meadow proc (chunkMeadowTsl.js) — synced to shared TSL uniforms. */
  meadow: (() => {
    const m = JSON.parse(JSON.stringify(MEADOW_DEFAULT_PARAMS));
    return m;
  })(),
  /** Painter-style TSL ground proc (chunkGroundTsl.js) — base color + 2 noise layers, live uniforms. */
  ground: (() => JSON.parse(JSON.stringify(GROUND_DEFAULT_PARAMS)))(),
  /** Painter-style cliff_rocks_07 + heightTex slope mask on splat + TSL ground surfaces. */
  autoCliffEnabled: true,
  autoCliff: {
    slopeStart: 0.05,
    slopeEnd: 0.7,
    rockScale: 0.05,
    rockBrightness: 0.85,
    rockContrast: 1.1,
    rockTint: "#ffffff",
    rockNormalStr: 1.0,
    rockBlendSharp: 1.0,
    rockRoughMul: 1.0,
    triplanarSharp: 4.0,
  },
  brushSize: 20,
  brushStrength: 60,
  /**
   * Hard clamp on sculpted heightfield (world Y). Old fixed max 180 made peaks plateau —
   * raise max for tall mountains; lower max (~100–200) for intentional mesa / table-top.
   */
  sculptClampMin: -200,
  sculptClampMax: 2000,
  /** brush: LMB raise · Shift+LMB lower · Ctrl+LMB smooth · Alt flatten (like painter) · ramp: two LMB · R clears ramp A */
  sculptTool: "brush",
  /** Raise/lower only — same shapes as splatmap-painter Brush → Sculpt shape */
  sculptBrush: "smooth",
  /** Noise brush (sculpt tool = noise) — splatmap-painter sculptAt */
  noiseScale: 2.5,
  noiseOctaves: 2,
  terraceStep: 8,
  terraceSharpness: 0.7,
  paintBrush: "smooth",
  brushFalloff: "smooth",
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
  },
  /** Sun-anchored lens flare (no post-processing). Decoupled from sky. */
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
  /** Blood FX: deer hit burst + ground pool + red flash. */
  bloodFX: {
    enabled: true,
    burstCount: 10,
    bloodColor: "#8b0000",
    bloodColor2: "#cc1100",
    burstSpeed: 3.5,
    burstSpread: 2.0,
    gravity: 6.0,
    spriteSize: 0.12,
    lifetime: 0.6,
    poolColor: "#550000",
    poolSize: 3.0,
    poolLifetime: 8.0,
    poolPersist: true,
    poolAnimDuration: 2.25,
    poolFlipbookByFps: false,
    poolMinWorldScale: 0.08,
    poolYOffset: 0.03,
    flashDuration: 0.12,
    flashColor: "#ff2200",
    poolAtlasBasePath: "./textures/BloodPool/",
    poolColorAtlasFile: "ContactSheet.png",
    poolAlphaAtlasFile: "ContactSheet-001.png",
    poolAtlasCols: 14,
    poolAtlasRows: 14,
    poolAnimFps: 14,
    poolAlphaCutoff: 0.02,
    poolInvertAlphaMask: true,
    poolFlipRowUV: false,
    poolAtlasLinear: false,
  },
  /** Plane forward gun (E to fire in fly mode). */
  planeGun: {
    enabled: true,
    fireRate: 12,
    bulletSpeed: 240,
    bulletMaxDist: 600,
    bulletSize: 0.7,
    tracerColor: "#fff0a0",
    damage: 1,
  },
  /** Sky boost rings (Play fly) — one auto-placed gate; slab+hole boost test. */
  flightRings: {
    enabled: false,
    /** Ring center height above terrain at its (x,z). */
    ringSkyAGL: 125,
    /** Half-thickness (m) along fly-through axis — generous so fast passes register. */
    boostHoleSlabHalf: 22,
    /** Hole radius ≈ ringRadius × this (inside opening, not rim). */
    boostHoleRadiusMul: 0.9,
    spawnAhead: 115,
    spawnHeightOffset: 22,
    ringRadius: 42,
    boostDuration: 1.35,
    boostMaxAdd: 78,
    boostImpulse: 34,
    /** One-shot × current speed + impulse on every ring hit. */
    boostSurgeMult: 1.26,
    color: "#66f0ff",
  },
  csm: {
    enabled: true,
    cascades: 2,
    maxFar: 300,
    lightMargin: 100,
    mapSize: 2048,
    updateEveryFrame: false,
  },
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  sky: {
    mode: "physical",
    turbidity: 2,
    rayleigh: 1.5,
    mie: 0.005,
    mieG: 0.8,
    cloudCoverage: 0.4,
    cloudDensity: 0.4,
    cloudElevation: 0.5,
    billboardClouds: {
      enabled: false,
      cloudCount: 60,
      segmentsPerCloud: 6,
      spread: 1400,
      altitude: 260,
      altitudeJitter: 80,
      scaleMin: 40,
      scaleMax: 110,
      verticalSquash: 0.55,
      clusterRadius: 140,
      windSpeed: 2.5,
      windAngle: 45,
      drift: 1.2,
      fadeNear: 200,
      fadeFar: 1600,
      opacity: 1.0,
      colorLit: "#ffffff",
      colorShadow: "#8ea8c8",
      shadowStrength: 0.55,
      sunsetTint: "#ffd6a8",
      sunsetStrength: 0.6,
    },
  },
  /** WebGPU TSL fog — same as splatmap-painter10bvh+post.html */
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
  /** Hydraulic erosion — same fields as splatmap-painter10bvh+post.html */
  erosion: {
    iterations: 30000,
    erosionRate: 0.3,
    depositionRate: 0.3,
    evaporation: 0.015,
    inertia: 0.1,
    capacity: 6,
    radius: 3,
  },
  /** Spline path [ K ] — splatmap-painter10bvh+post.html */
  spline: {
    objectType: "trees",
    spacing: 4,
    scaleMin: 1.0,
    scaleMax: 1.0,
    alignToPath: true,
    selectedPointY: 0,
    closed: false,
    showTrain: false,
    trainSpeed: 8,
    trainScale: 1,
    /** Terrain plateau (apply current Catmull–Rom path to heightfield). */
    plateauHeight: 24,
    plateauFalloff: 4,
    /** Half-width of flat top along an open path (m); ignored when path is closed. */
    plateauHalfWidth: 10,
  },
  /** Path paint [ L ] — splatmap-painter10bvh+post.html (splat blue + optional flatten) */
  path: {
    flattenStrength: 0.5,
  },
  /** Decal [ D ] — splatmap-painter10bvh+post.html */
  decal: {
    opacity: 1.0,
    heightOffset: 0.05,
  },
  /** River path [ V ] — splatmap-painter10bvh+post.html */
  river: {
    width: 8,
    segments: 200,
    flowSpeed: 0.15,
    deepColor: "#1a4a6a",
    shallowColor: "#5dbfaa",
    highlightColor: "#c8ecff",
    foamColor: "#ffffff",
    foamWidth: 0.18,
    opacity: 0.88,
    heightOffset: 0.18,
    selectedPointY: 0,
    shaderStyle: "Basic",
  },
  /** Road path [ U ] — ribbon on terrain, TSL asphalt + edge lines */
  road: {
    width: 5,
    segments: 200,
    heightOffset: 0.08,
    selectedPointY: 0,
    /** Spheres + centre polyline; road mesh stays visible when false. */
    showHandles: true,
    /** Which road spline is being edited (handles + new points). */
    activeRoadIndex: 0,
    asphaltDark: "#252528",
    asphaltLight: "#4a4a52",
    grainScale: 14,
    grainStrength: 0.38,
    lineColor: "#f2f2f2",
    lineWidth: 0.07,
    lineSoftness: 0.035,
  },
  water: {
    scale: 0.3,
    cellSpeed: 0.45,
    noiseScale: 1.52,
    noiseTimeScale: 0.6,
    distort: 0.35,
    flowZ: 0.08,
    edgeThreshold: 0.067,
    shoreColor: "#b8ecfa",
    midColor: "#7ed4f8",
    deepColor: "#3a6a8c",
    highlightColor: "#e8f8ff",
    depthRampShoreMid: 0.36,
    depthRampMidDeep: 0.72,
    opacity: 0.78,
    foamColor: "#e8f4ff",
    lineWidth: 0.5,
    glowWidth: 2.0,
    waterlineIntensity: 2.5,
    rippleStrength: 5.5,
    rippleWidth: 0.12,
    sinkOffset: -0.05,
    preset: "Small lake",
    style: "Ocean",
    stylized: false,
    reflections: false,
    reflectionScale: 0.35,
    reflectionStrength: 0.35,
  },
  ocean: {
    // Toggle between new stylized ocean shader and flat-blue fallback
    stylized: true,
    oceanY: -7.0,
    // Legacy fields — kept only so the old dead-code init path
    // (reflector setup, old uniform initializers) doesn't read undefined.
    // Not exposed in Tweakpane.
    reflectionScale: 0.35,
    reflectionStrength: 0.35,
    reflections: false,
    scale: 0.3,
    cellSpeed: 0.45,
    noiseScale: 1.52,
    noiseTimeScale: 0.6,
    distort: 0.35,
    flowZ: 0.08,
    edgeThreshold: 0.067,
    lineWidth: 0.5,
    glowWidth: 2.0,
    waterlineIntensity: 0,
    rippleStrength: 0,
    rippleWidth: 0.12,
    // All remaining fields mirror OCEAN_DEFAULTS keys — see ocean-shader.js
    shoreColor: OCEAN_DEFAULTS.shoreColor,
    midColor: OCEAN_DEFAULTS.midColor,
    deepColor: OCEAN_DEFAULTS.deepColor,
    highlightColor: OCEAN_DEFAULTS.highlightColor,
    depthAbsorb: OCEAN_DEFAULTS.depthAbsorb,
    depthRampShoreMid: OCEAN_DEFAULTS.depthRampShoreMid,
    depthRampMidDeep: OCEAN_DEFAULTS.depthRampMidDeep,
    openOceanDepth: OCEAN_DEFAULTS.openOceanDepth,
    surfNoiseScale1: OCEAN_DEFAULTS.surfNoiseScale1,
    surfNoiseScale2: OCEAN_DEFAULTS.surfNoiseScale2,
    surfNoiseSpeed1: OCEAN_DEFAULTS.surfNoiseSpeed1,
    surfNoiseSpeed2: OCEAN_DEFAULTS.surfNoiseSpeed2,
    procNoiseSpeed: OCEAN_DEFAULTS.procNoiseSpeed,
    surfNormalStrength: OCEAN_DEFAULTS.surfNormalStrength,
    fresnelExp: OCEAN_DEFAULTS.fresnelExp,
    fresnelSky: OCEAN_DEFAULTS.fresnelSky,
    fresnelMax: OCEAN_DEFAULTS.fresnelMax,
    opacity: OCEAN_DEFAULTS.opacity,
    foamEnabled: OCEAN_DEFAULTS.foamEnabled,
    foamColor: OCEAN_DEFAULTS.foamColor,
    foamBandWidth: OCEAN_DEFAULTS.foamBandWidth,
    foamIntensity: OCEAN_DEFAULTS.foamIntensity,
    foamSharpness: OCEAN_DEFAULTS.foamSharpness,
    foamNoiseAmt: OCEAN_DEFAULTS.foamNoiseAmt,
    foamNoiseScale: OCEAN_DEFAULTS.foamNoiseScale,
    foamNoiseSpeed: OCEAN_DEFAULTS.foamNoiseSpeed,
    foamFineScale: OCEAN_DEFAULTS.foamFineScale,
    foamFineAmt: OCEAN_DEFAULTS.foamFineAmt,
    foamFineSpeed: OCEAN_DEFAULTS.foamFineSpeed,
    foamContrast: OCEAN_DEFAULTS.foamContrast,
    foamCutoff: OCEAN_DEFAULTS.foamCutoff,
    foamTransitionWidth: OCEAN_DEFAULTS.foamTransitionWidth,
    foamBreatheAmp: OCEAN_DEFAULTS.foamBreatheAmp,
    foamBreatheHz: OCEAN_DEFAULTS.foamBreatheHz,
  },
  /** Props mode [ I ] — splatmap-painter */
  propSinkOffset: 0,
  activePropName: "None",
  /** Place mode [ O ] — hand-placed cliff meshes (splatmap-painter) */
  cliffModel: 0,
  sinkOffset: 2,
  /**
   * Optional `models/tank_compressed.glb` demo. When disabled: not parented to the scene and
   * `updateDemoTank` returns immediately (no height samples, no matrix work). GLB loads only
   * the first time you enable it.
   * Grounding matches play-mode capsule: same `getWorldHeight(x,z)` each frame, hull upright (yaw only).
   */
  demoTank: {
    enabled: false,
    /** Max drive speed (m/s), same order as play capsule `playParams.speed`. */
    speed: 9,
    /** How quickly velocity catches up to desired direction × speed. */
    accel: 16,
    /** Max yaw rate (rad/s) toward travel direction — avoids twitchy turns. */
    yawSmooth: 4.5,
    scaleMul: 3,
    /** Same idea as capsule foot height — extra world Y after bottom alignment. */
    yOffset: 0.02,
    /** In Play [F] mode, drive toward the player capsule (otherwise random roam). */
    followPlayerInPlay: true,
    roamRetargetMin: 18,
    roamRetargetMax: 40,
  },
};
