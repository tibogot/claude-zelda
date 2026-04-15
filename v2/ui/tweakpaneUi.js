import { Pane } from "tweakpane";
import { V2_CONFIG } from "../app/config.js";

export function createTweakpaneUi({
  toolState,
  config,
  sculptSystem,
  onConfigChanged,
  perf,
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

