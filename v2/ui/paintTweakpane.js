/**
 * Paint panel — 3-layer weight-blended overlay painting UI (v1 parity).
 *
 * The base surface (TSL procedural or Image texture) is "layer 0" — it shows
 * wherever the splat is unpainted. Layers 1/2/3 = R/G/B channels painted on top.
 *
 * `activeLayer` in state: 0 = eraser (restore base), 1/2/3 = paint R/G/B overlay.
 */

const LAYER_LABELS = ["Eraser (restore base)", "Layer 1 (R)", "Layer 2 (G)", "Layer 3 (B)", "Meadow (TSL)"];

/**
 * @param {*} pane
 * @param {*} toolState
 * @param {*} opts - { config, textureLibrary, onPaintLayersChanged, onPaintFill, onPaintClear }
 */
export function addPaintFolder(pane, toolState, opts) {
  const { config, textureLibrary, onPaintLayersChanged, onPaintFill, onPaintClear } = opts;
  const folder = pane.addFolder({ title: "Paint", expanded: true });

  const activePicker = { activeLayer: toolState.paint.activeLayer };
  const activeLayerOptions = {};
  for (let i = 0; i < 5; i++) activeLayerOptions[LAYER_LABELS[i]] = i;
  folder
    .addBinding(activePicker, "activeLayer", {
      label: "Active layer",
      options: activeLayerOptions,
    })
    .on("change", () => {
      toolState.paint.activeLayer = activePicker.activeLayer;
    });

  folder.addBinding(config.paint, "brushOpacity", {
    label: "Brush opacity",
    min: 0.02,
    max: 1,
    step: 0.01,
  });

  const noiseFolder = folder.addFolder({ title: "Noise Mask", expanded: false });
  noiseFolder.addBinding(toolState.paint, "noiseMask", {
    label: "Amount",
    min: 0,
    max: 1,
    step: 0.02,
  });
  noiseFolder.addBinding(toolState.paint, "noiseScale", {
    label: "Scale",
    min: 0.5,
    max: 20,
    step: 0.25,
  });
  noiseFolder.addBinding(toolState.paint, "noiseOctaves", {
    label: "Detail",
    min: 1,
    max: 6,
    step: 1,
  });
  noiseFolder.addBinding(toolState.paint, "noiseEdgeOnly", {
    label: "Edge only",
  });

  folder.addBlade({ view: "separator" });

  const slotOptions = textureLibrary.getSlotOptionsForUi();
  const slotProxy = {
    layer1: toolState.paint.layerSlotIds[0],
    layer2: toolState.paint.layerSlotIds[1],
    layer3: toolState.paint.layerSlotIds[2],
  };
  for (let i = 0; i < 3; i++) {
    const key = `layer${i + 1}`;
    folder
      .addBinding(slotProxy, key, { label: `Layer ${i + 1} texture`, options: slotOptions })
      .on("change", () => {
        toolState.paint.layerSlotIds[i] = slotProxy[key];
        onPaintLayersChanged?.();
      });
  }

  folder.addBlade({ view: "separator" });
  folder
    .addButton({ title: "Fill world with active layer" })
    .on("click", () => onPaintFill?.());
  folder.addButton({ title: "Clear all paint" }).on("click", () => onPaintClear?.());
}
