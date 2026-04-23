import { V2_CONFIG } from "../config.js";
import { GROUND_DEFAULT_PARAMS } from "../../../chunkGroundTsl.js";
import { MEADOW_DEFAULT_PARAMS } from "../../../chunkMeadowTsl.js";

function deepCloneJson(x) {
  return JSON.parse(JSON.stringify(x));
}

export function createToolState() {
  return {
    /** `view` (orbit only) | `sculpt` | `paint` | `treePaint`. Defaults to `view` — matches v1. */
    mode: "view",
    /** `tile` = grid material; `tsl` = procedural TSL; `image` = tiled image-slot material. */
    terrainSurface: "tile",
    /** Texture-library slot ids picked by the surface modes that use slots. */
    textureSlots: {
      cliffSlotId: "cliff_rock",
      groundSlotId: "grass_005",
    },
    /**
     * Paint mode — 4 layers (layer 0 is base, layers 1..3 are R/G/B splat channels).
     * `activeLayer` selects what the brush paints (0 = eraser → pulls toward base).
     */
    paint: {
      activeLayer: V2_CONFIG.paint.defaultActiveLayer,
      layerSlotIds: ["ground_037", "cobblestone", "cliff_rock"],
      noiseMask: 0,
      noiseScale: 3.0,
      noiseOctaves: 3,
      noiseEdgeOnly: false,
    },
    groundTsl: deepCloneJson(GROUND_DEFAULT_PARAMS),
    meadowTsl: deepCloneJson(MEADOW_DEFAULT_PARAMS),
    tslGroundUi: {
      groundPresetKey: "default",
      meadowPresetKey: "default",
      meadowMix: 0.55,
      meadowSlopeMin: 0.45,
      meadowSlopeMax: 0.92,
    },
    sculptMode: "raiseLower",
    /**
     * v1 `sculptBrush` for raise/lower: `smooth` (uses brushFalloff enum) | `plateau` (mesa) | `crater` (rim-pit).
     * FBM peak / noise / terrace / ramp / erosion are separate modes via `sculptMode`.
     */
    raiseLowerStamp: V2_CONFIG.sculpt.defaultRaiseLowerStamp,
    brush: {
      radius: V2_CONFIG.sculpt.defaultRadius,
      strength: V2_CONFIG.sculpt.defaultStrength,
      falloff: V2_CONFIG.sculpt.defaultFalloff,
      /** Only affects raise/lower `smooth` stamp — v1 `PARAMS.brushFalloff`. */
      brushFalloff: V2_CONFIG.sculpt.defaultBrushFalloff,
      spacingFactor: V2_CONFIG.sculpt.spacingFactor,
      previewShape: V2_CONFIG.sculpt.previewShape,
    },
    noiseBrush: {
      noiseScale: V2_CONFIG.sculpt.noiseScale,
      noiseOctaves: V2_CONFIG.sculpt.noiseOctaves,
    },
    terrace: { ...V2_CONFIG.sculpt.terrace },
    ramp: { ...V2_CONFIG.sculpt.ramp },
    erosion: { ...V2_CONFIG.sculpt.erosion },
    fbmPeak: { ...V2_CONFIG.sculpt.fbmPeak },
    gen: { ...V2_CONFIG.sculpt.gen },
    terrain: {
      lodEnabled: true,
      activeRadiusInChunks: V2_CONFIG.lod.activeRadiusInChunks,
    },
    autoCliffEnabled: true,
    autoCliff: {
      slopeStart: 0.6,
      slopeEnd: 0.7,
      rockScale: 0.01,
      rockBrightness: 2.0,
      rockContrast: 1.1,
      rockTint: "#ffffff",
      rockNormalStr: 1.0,
      rockBlendSharp: 1.0,
      rockRoughMul: 1.5,
      triplanarSharp: 4.0,
    },
    light: { ...V2_CONFIG.light },
    physicalSky: { ...V2_CONFIG.physicalSky },
    lensFlare: { ...V2_CONFIG.lensFlare },
    csm: { ...V2_CONFIG.csm },
    fog: {
      height: { ...V2_CONFIG.fog.height },
      distance: { ...V2_CONFIG.fog.distance },
    },
    treePaint: {
      activeSlot: 0,
      density: 0.5,
      minSpacing: 4,
      scaleMin: 0.8,
      scaleMax: 1.2,
      randomRotation: true,
    },
    treeLod: {
      lod0Distance: 120,
      lod1Distance: 300,
      fadeOutDistance: 600,
      castShadow: true,
    },
    foliageLod: {
      lod0Distance: 80,
      lod1Distance: 200,
      fadeOutDistance: 600,
    },
    treeSlots: [
      { name: "Slot 1", enabled: true, presetFile: null, baseScale: 1.0 },
      { name: "Slot 2", enabled: true, presetFile: null, baseScale: 1.0 },
      { name: "Slot 3", enabled: true, presetFile: null, baseScale: 1.0 },
      { name: "Slot 4", enabled: true, presetFile: null, baseScale: 1.0 },
    ],
    cliffs: {
      activeSlot: 0,
      sinkOffset: 2,
      transformMode: "translate",
      blendSlopeLow: 0.5,
      blendSlopeHigh: 0.85,
      blendNoiseScale: 0.06,
      blendNoiseStr: 0.15,
      blendGroundScale: 1.0,
      blendRockScale: 0.01,
      blendRockBrightness: 2.0,
      blendRockContrast: 1.1,
      blendTriplanarSharp: 4.0,
    },
    cliffSlots: [
      { name: "Cliff 1", loaded: false },
      { name: "Cliff 2", loaded: false },
      { name: "Cliff 3", loaded: false },
      { name: "Cliff 4", loaded: false },
      { name: "Cliff 5", loaded: false },
    ],
    props: {
      activeSlot: 0,
      sinkOffset: 0,
      transformMode: "translate",
      placementMode: "place",
      density: 0.5,
      minSpacing: 3,
      scaleMin: 0.8,
      scaleMax: 1.2,
      randomRotation: true,
    },
    propSlots: [],
    road: {
      width: 5,
      segments: 200,
      heightOffset: 0.08,
      selectedPointY: 0,
      showHandles: true,
      activeRoadIndex: 0,
      asphaltDark: "#252528",
      asphaltLight: "#4a4a52",
      grainScale: 14,
      grainStrength: 0.38,
      lineColor: "#f2f2f2",
      lineWidth: 0.07,
      lineSoftness: 0.035,
      enhanced: false,
      normalStrength: 1.0,
      roughnessBase: 0.55,
      reflectStrength: 0.6,
      mixBlur: 0.08,
      mixStrength: 1.5,
      mixContrast: 1.0,
      normalDistort: 0.12,
      lodNear: 30,
      lodMid: 80,
      lodFar: 200,
      texScale: 4.0,
    },
    grass: {
      enabled: false,
      bladeHeight: 1.0,
      bladeWidth: 0.15,
      tipTaperStart: 0.5,
      bladeYSegments: 7,
      grassCount: 1516,
      fieldSize: 10,
      grassDensity: 1.0,
      windSpeed: 0.2,
      windStrength: 1.4,
      maxAngle: 1.4,
      naturalLean: 0.9,
      windAngle: 0,
      windWaveScale: 0.12,
      windGust: 0.3,
      bendFocus: 0.5,
      stiffness: 0.0,
      clumpScale: 1.5,
      clumpStrength: 0.7,
      crossed: true,
      bladeColor: "#0e300e",
      tipColor: "#004d05",
      skyBlend: 0.8,
      cylindrical: 0.3,
      viewThicken: 0.45,
      aoBase: 0.25,
      aoPower: 2.0,
      colorVariation: false,
      cvHueSpread: 0.08,
      cvSatSpread: 0.3,
      cvDryAmount: 0.15,
      cvDryColor: "#8a7a3a",
      bssIntensity: 1.2,
      bssPower: 2.0,
      bssColor: "#2d7a2d",
      frontScatter: 0.3,
      rimSSS: 0.25,
      specV1Enabled: false,
      specV1Intensity: 1.5,
      specV1Color: "#ffffff",
      specV1DirX: -1.0,
      specV1DirY: 1.0,
      specV1DirZ: 0.5,
      specV1Power: 25.6,
      specV2Enabled: false,
      specV2Intensity: 1.0,
      specV2Color: "#ffffff",
      specV2DirX: -1.0,
      specV2DirY: 0.45,
      specV2DirZ: 1.0,
      specV2NoiseScale: 3.0,
      specV2NoiseStr: 0.6,
      specV2Power: 12.0,
      specV2TipBias: 0.5,
      lodEnabled: true,
      lodMidDistance: 40,
      lodFarDistance: 80,
      lodMaxDistance: 200,
      lodFadeStart: 0.75,
      lodMidPatchSize: 18,
      lodMidSegments: 3,
      lodMidGrassCount: 1500,
      lodFarPatchSize: 28,
      lodFarSegments: 1,
      lodFarGrassCount: 1300,
      lodMegaMaxDistance: 400,
      lodMegaPatchSize: 60,
      lodMegaSegments: 1,
      lodMegaGrassCount: 400,
      lodDebug: false,
      interactionRadius: 1.5,
      interactionStrength: 0.7,
      receiveShadow: true,
      terrainTintEnabled: false,
      terrainTintStrength: 0.5,
      terrainTintAutoSource: true,
      terrainTintManualMode: 1,
      terrainTintRootBias: 0.35,
    },
  };
}

export function createPerfState() {
  return {
    fps: 0,
    frameMs: 0,
    lastFrameStamp: performance.now(),
    frameAccumMs: 0,
    frameCount: 0,
    activeChunks: 0,
    stream: {
      created: 0,
      remeshed: 0,
      unloaded: 0,
    },
    queues: {
      create: 0,
      remesh: 0,
      unload: 0,
    },
    trisApprox: 0,
  };
}

export function tickPerf(perf, nowMs, frameMs) {
  perf.frameMs = frameMs;
  perf.frameAccumMs += frameMs;
  perf.frameCount++;
  const elapsed = nowMs - perf.lastFrameStamp;
  if (elapsed >= 500) {
    perf.fps = (perf.frameCount * 1000) / elapsed;
    perf.frameCount = 0;
    perf.frameAccumMs = 0;
    perf.lastFrameStamp = nowMs;
  }
}

