import { V2_CONFIG } from "../config.js";
import { GROUND_DEFAULT_PARAMS } from "../../../chunkGroundTsl.js";
import { MEADOW_DEFAULT_PARAMS } from "../../../chunkMeadowTsl.js";

function deepCloneJson(x) {
  return JSON.parse(JSON.stringify(x));
}

export function createToolState() {
  return {
    mode: "sculpt",
    /** `tile` = grid material; `tsl` = shared v1 painter ground + meadow stacks (see `proceduralGroundMaterial.js`). */
    terrainSurface: "tile",
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

