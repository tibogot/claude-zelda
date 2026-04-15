import { Pane } from "tweakpane";
import { V2_CONFIG } from "../app/config.js";

export function createTweakpaneUi({
  toolState,
  config,
  sculptSystem,
  onConfigChanged,
  perf,
  onRebuildSkyEnv,
  onCsmEnabledChange,
}) {
  const pane = new Pane({ title: "V2 Terrain Core" });

  const globalFolder = pane.addFolder({ title: "Global" });
  globalFolder.addBinding(toolState, "mode", {
    label: "Mode",
    options: {
      Sculpt: "sculpt",
    },
  });
  globalFolder.addButton({ title: "Undo" }).on("click", () => sculptSystem.undo());
  globalFolder.addButton({ title: "Redo" }).on("click", () => sculptSystem.redo());

  /** Shared across sculpt, future paint, foliage, props — same as v1 brush UX. */
  const brushFolder = pane.addFolder({ title: "Brush" });
  brushFolder.addBinding(toolState.brush, "radius", {
    min: V2_CONFIG.sculpt.brushMin,
    max: V2_CONFIG.sculpt.brushMax,
    step: 0.5,
    label: "Radius",
  });
  brushFolder.addBinding(toolState.brush, "strength", {
    min: V2_CONFIG.sculpt.strengthMin,
    max: V2_CONFIG.sculpt.strengthMax,
    step: 0.01,
    label: "Strength",
  });
  brushFolder.addBinding(toolState.brush, "falloff", {
    min: 0.5,
    max: 4,
    step: 0.05,
    label: "Shape",
  });

  const lightFolder = pane.addFolder({ title: "Light (v1 defaults)", expanded: false });
  lightFolder.addBinding(toolState.light, "sunAzimuth", {
    label: "Sun azimuth°",
    min: 0,
    max: 360,
    step: 1,
  });
  lightFolder.addBinding(toolState.light, "sunElevation", {
    label: "Sun elevation°",
    min: -5,
    max: 89,
    step: 1,
  });
  lightFolder.addBinding(toolState.light, "dirColor", { label: "Sun color" });
  lightFolder.addBinding(toolState.light, "dirIntensity", {
    label: "Sun intensity",
    min: 0,
    max: 5,
    step: 0.05,
  });
  lightFolder.addBinding(toolState.light, "hemiSkyColor", { label: "Hemi sky" });
  lightFolder.addBinding(toolState.light, "hemiGroundColor", { label: "Hemi ground" });
  lightFolder.addBinding(toolState.light, "hemiIntensity", {
    label: "Hemi intensity",
    min: 0,
    max: 2,
    step: 0.02,
  });
  lightFolder.addBinding(toolState.light, "envIntensity", {
    label: "Env intensity",
    min: 0,
    max: 2,
    step: 0.02,
  });
  lightFolder.addBinding(toolState.light, "exposure", {
    label: "Tone exposure",
    min: 0.1,
    max: 2,
    step: 0.02,
  });
  lightFolder.addBinding(toolState.light, "sunDistance", {
    label: "Sun distance",
    min: 200,
    max: 2000,
    step: 10,
  });
  lightFolder.addBinding(toolState.light, "shadowBias", {
    label: "Shadow bias",
    min: -0.002,
    max: 0.002,
    step: 0.0001,
  });
  lightFolder.addBinding(toolState.light, "shadowNormalBias", {
    label: "Shadow n.bias",
    min: 0,
    max: 0.1,
    step: 0.001,
  });

  const skyFolder = pane.addFolder({ title: "Physical sky", expanded: false });
  const skyChange = () => onRebuildSkyEnv?.();
  skyFolder.addBinding(toolState.physicalSky, "meshScale", {
    label: "Dome scale",
    min: 2000,
    max: 20000,
    step: 100,
  }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "turbidity", { min: 0, max: 20, step: 0.1 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "rayleigh", { min: 0, max: 4, step: 0.05 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "mie", { min: 0, max: 0.1, step: 0.001 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "mieG", { min: 0, max: 1, step: 0.01 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "cloudCoverage", { min: 0, max: 1, step: 0.02 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "cloudDensity", { min: 0, max: 1, step: 0.02 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "cloudElevation", { min: 0, max: 1, step: 0.02 }).on("change", skyChange);

  const lensFlareFolder = pane.addFolder({ title: "Lens flare", expanded: false });
  lensFlareFolder.addBinding(toolState.lensFlare, "enabled", { label: "Enabled" });
  lensFlareFolder.addBinding(toolState.lensFlare, "intensity", {
    label: "Master intensity",
    min: 0,
    max: 5,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "halationSize", {
    label: "Halation size",
    min: 0,
    max: 3,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "halationColor", {
    label: "Halation color",
    view: "color",
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "streakLength", {
    label: "Streak length",
    min: 0,
    max: 4,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "streakOpacity", {
    label: "Streak opacity",
    min: 0,
    max: 2,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "streakColor", {
    label: "Streak color",
    view: "color",
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "ghostOpacity", {
    label: "Ghost opacity",
    min: 0,
    max: 2,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "ghostSpacing", {
    label: "Ghost spacing",
    min: 0,
    max: 2,
    step: 0.02,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "dirtOpacity", {
    label: "Lens dirt",
    min: 0,
    max: 2,
    step: 0.05,
  });

  const csmFolder = pane.addFolder({ title: "CSM shadows", expanded: false });
  csmFolder
    .addBinding(toolState.csm, "enabled", { label: "Enabled" })
    .on("change", () => onCsmEnabledChange?.(toolState.csm.enabled));
  csmFolder.addBinding(toolState.csm, "updateEveryFrame", { label: "Update every frame" });
  csmFolder.addBinding(toolState.csm, "cascades", {
    label: "Cascades",
    min: 1,
    max: 4,
    step: 1,
  });
  csmFolder.addBinding(toolState.csm, "maxFar", {
    label: "Max far",
    min: 50,
    max: 2000,
    step: 10,
  });
  csmFolder.addBinding(toolState.csm, "lightMargin", {
    label: "Light margin",
    min: 0,
    max: 400,
    step: 5,
  });
  csmFolder.addBinding(toolState.csm, "mapSize", {
    label: "Map size",
    min: 512,
    max: 4096,
    step: 256,
  });

  const sculptFolder = pane.addFolder({ title: "Sculpt" });
  sculptFolder.addBinding(toolState, "sculptMode", {
    label: "Stamp",
    options: {
      "Brush (smooth)": "raiseLower",
      "FBM peak": "fbmPeak",
      Noise: "noise",
      "Flatten only": "flatten",
    },
  });
  sculptFolder.addBinding(toolState.brush, "spacingFactor", {
    min: 0.05,
    max: 1.0,
    step: 0.01,
    label: "Stroke spacing",
  });

  const fbmPeakFolder = pane.addFolder({
    title: "FBM peak (tool)",
    expanded: false,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "freqMul", {
    label: "Detail scale",
    min: 0.25,
    max: 4,
    step: 0.05,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "octaves", {
    label: "Octaves",
    min: 1,
    max: 8,
    step: 1,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "spikePower", {
    label: "Radial falloff",
    min: 1,
    max: 5,
    step: 0.05,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "base", {
    label: "Base lift",
    min: 0,
    max: 1.2,
    step: 0.01,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "ridgeWeight", {
    label: "Ridge weight",
    min: 0,
    max: 4,
    step: 0.05,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "gain", {
    label: "Strength gain",
    min: 0.25,
    max: 6,
    step: 0.05,
  });

  const lodFolder = pane.addFolder({ title: "Terrain/LOD" });
  lodFolder
    .addBinding(config.lod, "enabled", { label: "LOD enabled" })
    .on("change", onConfigChanged);
  lodFolder
    .addBinding(config.lod, "activeRadiusInChunks", {
      label: "Active radius",
      min: 2,
      max: 20,
      step: 1,
    })
    .on("change", onConfigChanged);
  lodFolder
    .addBinding(config.lod, "hysteresis", {
      label: "Hysteresis",
      min: 0,
      max: 0.5,
      step: 0.01,
    })
    .on("change", onConfigChanged);

  const perfFolder = pane.addFolder({ title: "Perf Gate" });
  const perfView = {
    fps: "0.0",
    frameMs: "0.00",
    activeChunks: "0",
    queues: "0/0/0",
  };
  perfFolder.addBinding(perfView, "fps", { readonly: true, label: "FPS" });
  perfFolder.addBinding(perfView, "frameMs", { readonly: true, label: "Frame ms" });
  perfFolder.addBinding(perfView, "activeChunks", {
    readonly: true,
    label: "Active chunks",
  });
  perfFolder.addBinding(perfView, "queues", {
    readonly: true,
    label: "Queues C/R/U",
  });

  return {
    pane,
    /** Call after hotkey / wheel edits to `toolState.brush` so bindings stay in sync. */
    refreshBrush() {
      pane.refresh();
    },
    refreshPerf() {
      perfView.fps = perf.fps.toFixed(1);
      perfView.frameMs = perf.frameMs.toFixed(2);
      perfView.activeChunks = String(perf.activeChunks);
      perfView.queues = `${perf.queues.create}/${perf.queues.remesh}/${perf.queues.unload}`;
      pane.refresh();
    },
    dispose() {
      pane.dispose();
    },
  };
}

