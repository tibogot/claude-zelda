import {
  GROUND_PRESETS,
  applyGroundPresetToParams,
} from "../../chunkGroundTsl.js";
import {
  MEADOW_PRESETS,
  applyMeadowPresetToParams,
} from "../../chunkMeadowTsl.js";

const NOISE_OPTIONS = {
  Value: "value",
  Perlin: "perlin",
  Simplex: "simplex",
  Voronoi: "voronoi",
  White: "white",
};

function presetLabelOptions(presets) {
  const o = {};
  for (const k of Object.keys(presets)) {
    const label =
      k === "default"
        ? "Default"
        : k
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (c) => c.toUpperCase())
            .trim();
    o[label] = k;
  }
  return o;
}

function addNoiseLayerFolder(parent, layer, label, onSync) {
  const f = parent.addFolder({ title: label, expanded: false });
  f.addBinding(layer, "enable", { label: "Enable" }).on("change", onSync);
  f.addBinding(layer, "noiseType", { label: "Noise type", options: NOISE_OPTIONS }).on("change", onSync);
  f.addBinding(layer, "useFbm", { label: "Use FBM" }).on("change", onSync);
  f.addBinding(layer, "color", { label: "Tint", view: "color" }).on("change", onSync);
  f.addBinding(layer, "strength", { label: "Strength", min: 0, max: 1.2, step: 0.01 }).on("change", onSync);
  f.addBinding(layer, "scale", { label: "Scale", min: 0.001, max: 0.2, step: 0.0005 }).on("change", onSync);
  f.addBinding(layer, "octaves", { label: "Octaves", min: 1, max: 8, step: 0.5 }).on("change", onSync);
  f.addBinding(layer, "lacunarity", { label: "Lacunarity", min: 1.5, max: 4, step: 0.05 }).on("change", onSync);
  f.addBinding(layer, "gain", { label: "Gain", min: 0.2, max: 1, step: 0.02 }).on("change", onSync);
  f.addBinding(layer, "offsetX", { label: "Offset X", min: -200, max: 200, step: 0.5 }).on("change", onSync);
  f.addBinding(layer, "offsetY", { label: "Offset Y", min: -200, max: 200, step: 0.5 }).on("change", onSync);
  f.addBinding(layer, "invert", { label: "Invert mask" }).on("change", onSync);
  f.addBinding(layer, "maskLow", { label: "Mask low", min: 0, max: 1, step: 0.01 }).on("change", onSync);
  f.addBinding(layer, "maskHigh", { label: "Mask high", min: 0, max: 1, step: 0.01 }).on("change", onSync);
  f.addBinding(layer, "maskSharpness", { label: "Mask sharpness", min: 0.2, max: 3, step: 0.05 }).on(
    "change",
    onSync,
  );
  f.addBinding(layer, "voronoiJitter", { label: "Voronoi jitter", min: 0.2, max: 1, step: 0.02 }).on(
    "change",
    onSync,
  );
}

export function addTerrainAppearanceFolder(pane, toolState, { onTerrainSurfaceChanged, onTslTerrainSync }) {
  const sync = () => onTslTerrainSync?.();

  const terrainFolder = pane.addFolder({ title: "Terrain appearance", expanded: true });
  terrainFolder
    .addBinding(toolState, "terrainSurface", {
      label: "Surface shading",
      options: {
        "Tile grid (debug)": "tile",
        "Procedural TSL (v1)": "tsl",
      },
    })
    .on("change", () => {
      onTerrainSurfaceChanged?.();
    });

  const tslBlend = terrainFolder.addFolder({ title: "TSL — slope meadow blend", expanded: false });
  tslBlend
    .addBinding(toolState.tslGroundUi, "meadowMix", {
      label: "Meadow mix max",
      min: 0,
      max: 1,
      step: 0.02,
    })
    .on("change", sync);
  tslBlend
    .addBinding(toolState.tslGroundUi, "meadowSlopeMin", {
      label: "Slope blend min (Ny)",
      min: 0,
      max: 1,
      step: 0.01,
    })
    .on("change", sync);
  tslBlend
    .addBinding(toolState.tslGroundUi, "meadowSlopeMax", {
      label: "Slope blend max (Ny)",
      min: 0,
      max: 1,
      step: 0.01,
    })
    .on("change", sync);

  const groundHdr = terrainFolder.addFolder({ title: "Ground TSL (v1 stack)", expanded: false });
  groundHdr
    .addBinding(toolState.tslGroundUi, "groundPresetKey", {
      label: "Preset",
      options: presetLabelOptions(GROUND_PRESETS),
    })
    .on("change", () => {
      applyGroundPresetToParams(toolState.tslGroundUi.groundPresetKey, toolState.groundTsl);
      sync();
      pane.refresh();
    });
  groundHdr.addBinding(toolState.groundTsl, "brightness", { min: 0.3, max: 2.5, step: 0.02 }).on("change", sync);
  groundHdr.addBinding(toolState.groundTsl, "contrast", { min: 0.5, max: 1.5, step: 0.01 }).on("change", sync);
  groundHdr
    .addBinding(toolState.groundTsl, "baseColor", { label: "Base color", view: "color" })
    .on("change", sync);
  addNoiseLayerFolder(groundHdr, toolState.groundTsl.layer1, "Layer 1", sync);
  addNoiseLayerFolder(groundHdr, toolState.groundTsl.layer2, "Layer 2", sync);

  const meadowHdr = terrainFolder.addFolder({ title: "Meadow TSL (v1 stack)", expanded: false });
  meadowHdr
    .addBinding(toolState.tslGroundUi, "meadowPresetKey", {
      label: "Preset",
      options: presetLabelOptions(MEADOW_PRESETS),
    })
    .on("change", () => {
      applyMeadowPresetToParams(toolState.tslGroundUi.meadowPresetKey, toolState.meadowTsl);
      sync();
      pane.refresh();
    });
  meadowHdr.addBinding(toolState.meadowTsl, "brightness", { min: 0.3, max: 2.5, step: 0.02 }).on("change", sync);
  meadowHdr.addBinding(toolState.meadowTsl, "contrast", { min: 0.5, max: 1.5, step: 0.01 }).on("change", sync);
  meadowHdr
    .addBinding(toolState.meadowTsl, "baseColor", { label: "Base color", view: "color" })
    .on("change", sync);
  addNoiseLayerFolder(meadowHdr, toolState.meadowTsl.layer1, "Layer 1", sync);
  addNoiseLayerFolder(meadowHdr, toolState.meadowTsl.layer2, "Layer 2", sync);
}
