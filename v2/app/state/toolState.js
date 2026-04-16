import { V2_CONFIG } from "../config.js";

export function createToolState() {
  return {
    mode: "sculpt",
    sculptMode: "raiseLower",
    /** v1 `sculptBrush` for brush tool: `smooth` | `plateau` (FBM peak / noise / ramp are separate modes). */
    raiseLowerStamp: V2_CONFIG.sculpt.defaultRaiseLowerStamp,
    brush: {
      radius: V2_CONFIG.sculpt.defaultRadius,
      strength: V2_CONFIG.sculpt.defaultStrength,
      falloff: V2_CONFIG.sculpt.defaultFalloff,
      spacingFactor: V2_CONFIG.sculpt.spacingFactor,
      previewShape: V2_CONFIG.sculpt.previewShape,
    },
    noiseBrush: {
      noiseScale: V2_CONFIG.sculpt.noiseScale,
      noiseOctaves: V2_CONFIG.sculpt.noiseOctaves,
    },
    ramp: { ...V2_CONFIG.sculpt.ramp },
    erosion: { ...V2_CONFIG.sculpt.erosion },
    fbmPeak: { ...V2_CONFIG.sculpt.fbmPeak },
    gen: { ...V2_CONFIG.sculpt.gen },
    terrain: {
      lodEnabled: true,
      activeRadiusInChunks: V2_CONFIG.lod.activeRadiusInChunks,
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

