/**
 * Paint panel — 7-layer weight-blended overlay painting UI.
 *
 * The base surface (TSL procedural or Image texture) is "layer 0" — it shows
 * wherever the splat is unpainted. Layers 1..7 = overlay channels painted on top.
 * Meadow (TSL) writes to splat1.A independently.
 *
 * `activeLayer` in state: 0 = eraser (restore base), 1..7 = paint overlay, 8 = meadow.
 */

const LAYER_LABELS = [
  "Eraser (restore base)",
  "Layer 1", "Layer 2", "Layer 3", "Layer 4",
  "Layer 5", "Layer 6", "Layer 7",
  "Meadow (TSL)",
];

const SOLO_OPTIONS = {
  Off: -1,
  "Base (layer 0)": 0,
  "Layer 1": 1, "Layer 2": 2, "Layer 3": 3, "Layer 4": 4,
  "Layer 5": 5, "Layer 6": 6, "Layer 7": 7,
};

/**
 * @param {*} pane
 * @param {*} toolState
 * @param {*} opts
 * @returns {{ refreshSlotOptions: Function }}
 */
export function addPaintFolder(pane, toolState, opts) {
  const {
    config, textureLibrary, onPaintLayersChanged, onPaintFill, onPaintClear,
    onSoloLayerChanged, onHeightBlendChanged, brushMask,
  } = opts;
  const folder = pane.addFolder({ title: "Paint", expanded: false });

  // ── Active layer ───────────────────────────────────────────────────────
  const activePicker = { activeLayer: toolState.paint.activeLayer };
  const activeLayerOptions = {};
  for (let i = 0; i < LAYER_LABELS.length; i++) activeLayerOptions[LAYER_LABELS[i]] = i;
  folder
    .addBinding(activePicker, "activeLayer", {
      label: "Active layer",
      options: activeLayerOptions,
    })
    .on("change", () => {
      toolState.paint.activeLayer = activePicker.activeLayer;
    });

  // ── Solo layer ─────────────────────────────────────────────────────────
  const soloProxy = { soloLayer: toolState.paint.soloLayer };
  folder
    .addBinding(soloProxy, "soloLayer", {
      label: "Solo layer",
      options: SOLO_OPTIONS,
    })
    .on("change", () => {
      toolState.paint.soloLayer = soloProxy.soloLayer;
      onSoloLayerChanged?.();
    });

  // ── Brush opacity ──────────────────────────────────────────────────────
  folder.addBinding(config.paint, "brushOpacity", {
    label: "Brush opacity",
    min: 0.02,
    max: 1,
    step: 0.01,
  });

  // ── Height-based blending ──────────────────────────────────────────────
  const hbFolder = folder.addFolder({ title: "Height Blend", expanded: false });
  hbFolder
    .addBinding(toolState.paint, "heightBlend", {
      label: "Strength",
      min: 0,
      max: 1,
      step: 0.01,
    })
    .on("change", () => onHeightBlendChanged?.());
  hbFolder
    .addBinding(toolState.paint, "heightContrast", {
      label: "Contrast",
      min: 0.01,
      max: 1,
      step: 0.01,
    })
    .on("change", () => onHeightBlendChanged?.());

  // ── Noise mask ─────────────────────────────────────────────────────────
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

  // ── Brush mask (PNG) ───────────────────────────────────────────────────
  if (brushMask) {
    const maskFolder = folder.addFolder({ title: "Brush Mask", expanded: false });

    const previewCanvas = document.createElement("canvas");
    previewCanvas.width = 64;
    previewCanvas.height = 64;
    previewCanvas.style.cssText =
      "display:block;width:48px;height:48px;margin:4px auto 6px;border:1px solid rgba(255,255,255,0.2);border-radius:4px;image-rendering:pixelated;";
    brushMask.renderPreview(previewCanvas);

    const maskPresetProxy = { preset: toolState.paint.maskPreset };
    maskFolder
      .addBinding(maskPresetProxy, "preset", {
        label: "Preset",
        options: {
          None: "none",
          Soft: "soft",
          Hard: "hard",
          Splatter: "splatter",
          Grunge: "grunge",
        },
      })
      .on("change", () => {
        toolState.paint.maskPreset = maskPresetProxy.preset;
        brushMask.generateBuiltin(maskPresetProxy.preset);
        brushMask.renderPreview(previewCanvas);
      });

    maskFolder
      .addButton({ title: "Load PNG mask" })
      .on("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp";
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          await brushMask.loadFromFile(file);
          maskPresetProxy.preset = "none";
          toolState.paint.maskPreset = "custom:" + brushMask.name;
          brushMask.renderPreview(previewCanvas);
        };
        input.click();
      });

    const containerEl = maskFolder.element.querySelector(".tp-fldv_c") ?? maskFolder.element;
    containerEl.appendChild(previewCanvas);

    maskFolder.addBinding(toolState.paint, "maskRotation", {
      label: "Rotation",
      min: 0,
      max: 360,
      step: 1,
    });
    maskFolder.addBinding(toolState.paint, "maskRandomRotation", {
      label: "Random rotation",
    });
    maskFolder.addBinding(toolState.paint, "maskFollowStroke", {
      label: "Follow stroke",
    });
  }

  folder.addBlade({ view: "separator" });

  // ── Layer texture pickers (7 overlay layers) ───────────────────────────
  const layersFolder = folder.addFolder({ title: "Layer Textures", expanded: true });
  const layerBindings = [];

  function buildLayerPickers() {
    for (const b of layerBindings) b.dispose();
    layerBindings.length = 0;

    const slotOptions = textureLibrary.getSlotOptionsForUi();
    const slotProxy = {};
    for (let i = 0; i < 7; i++) {
      const key = `layer${i + 1}`;
      if (!textureLibrary.getSlot(toolState.paint.layerSlotIds[i])) {
        toolState.paint.layerSlotIds[i] = textureLibrary.slots[0]?.id ?? "";
      }
      slotProxy[key] = toolState.paint.layerSlotIds[i];
      const binding = layersFolder
        .addBinding(slotProxy, key, { label: `Layer ${i + 1}`, options: slotOptions })
        .on("change", () => {
          toolState.paint.layerSlotIds[i] = slotProxy[key];
          onPaintLayersChanged?.();
        });
      layerBindings.push(binding);
    }
  }

  buildLayerPickers();

  folder.addBlade({ view: "separator" });
  folder
    .addButton({ title: "Fill world with active layer" })
    .on("click", () => onPaintFill?.());
  folder.addButton({ title: "Clear all paint" }).on("click", () => onPaintClear?.());

  return {
    refreshSlotOptions() {
      buildLayerPickers();
    },
  };
}
