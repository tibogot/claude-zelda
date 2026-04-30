/**
 * Foliage Billboard panel — slot management, brush settings, preset controls.
 */

/**
 * @param {*} pane
 * @param {*} toolState
 * @param {object} opts
 * @param {(slotIdx: number) => void} opts.onLoadTexture
 * @param {(slotIdx: number) => void} opts.onSlotStructureChanged
 * @param {(slotIdx: number) => void} opts.onSlotMaterialChanged
 * @param {() => void} opts.onClearAllFoliage
 * @param {() => void} opts.onFoliageLodChanged
 */
export function addFoliageFolder(pane, toolState, opts) {
  const {
    onLoadTexture,
    onSlotStructureChanged,
    onSlotMaterialChanged,
    onClearAllFoliage,
    onFoliageLodChanged,
  } = opts;

  const folder = pane.addFolder({ title: "Billboard Foliage", expanded: false });

  const slotOptions = {};
  for (let i = 0; i < toolState.foliageSlots.length; i++) {
    slotOptions[toolState.foliageSlots[i].name] = i;
  }
  folder.addBinding(toolState.foliagePaint, "activeSlot", {
    label: "Active slot",
    options: slotOptions,
  });

  const brushFolder = folder.addFolder({ title: "Foliage Brush", expanded: true });
  brushFolder.addBinding(toolState.foliagePaint, "density", {
    label: "Density",
    min: 0.1,
    max: 5,
    step: 0.1,
  });
  brushFolder.addBinding(toolState.foliagePaint, "minSpacing", {
    label: "Min spacing",
    min: 0.3,
    max: 10,
    step: 0.1,
  });
  brushFolder.addBinding(toolState.foliagePaint, "scaleMin", {
    label: "Scale min",
    min: 0.1,
    max: 3,
    step: 0.05,
  });
  brushFolder.addBinding(toolState.foliagePaint, "scaleMax", {
    label: "Scale max",
    min: 0.1,
    max: 3,
    step: 0.05,
  });
  brushFolder.addBinding(toolState.foliagePaint, "randomRotation", {
    label: "Random rotation",
  });

  const slotsFolder = folder.addFolder({ title: "Foliage Slots", expanded: true });

  for (let i = 0; i < toolState.foliageSlots.length; i++) {
    const slot = toolState.foliageSlots[i];
    const slotFolder = slotsFolder.addFolder({
      title: slot.name,
      expanded: i === 0,
    });

    slotFolder.addBinding(slot, "name", { label: "Name" });
    slotFolder.addBinding(slot, "enabled", { label: "Enabled" }).on("change", () => {
      onSlotStructureChanged?.(i);
    });
    slotFolder
      .addButton({ title: "📂 Load texture" })
      .on("click", () => onLoadTexture?.(i));
    slotFolder
      .addBinding(slot, "baseScale", { label: "Base scale", min: 0.1, max: 5, step: 0.05 })
      .on("change", () => onSlotStructureChanged?.(i));

    const structFolder = slotFolder.addFolder({ title: "Card Structure", expanded: false });
    structFolder
      .addBinding(slot, "planeCount", { label: "Plane count", min: 1, max: 6, step: 1 })
      .on("change", () => onSlotStructureChanged?.(i));
    structFolder
      .addBinding(slot, "planeSpread", {
        label: "Spread",
        options: { "360° radial": "full", "180° fan": "half" },
      })
      .on("change", () => onSlotStructureChanged?.(i));
    structFolder
      .addBinding(slot, "tiltMode", {
        label: "Tilt mode",
        options: { "Stable random": "stable", Symmetric: "symmetric" },
      })
      .on("change", () => onSlotStructureChanged?.(i));
    structFolder
      .addBinding(slot, "tilt", { label: "Tilt amount", min: 0, max: 1.5, step: 0.01 })
      .on("change", () => onSlotStructureChanged?.(i));
    structFolder
      .addBinding(slot, "structureSeed", { label: "Seed", min: 0, max: 999999, step: 1 })
      .on("change", () => onSlotStructureChanged?.(i));
    structFolder
      .addBinding(slot, "width", { label: "Width", min: 0.1, max: 10, step: 0.1 })
      .on("change", () => onSlotStructureChanged?.(i));
    structFolder
      .addBinding(slot, "height", { label: "Height", min: 0.1, max: 10, step: 0.1 })
      .on("change", () => onSlotStructureChanged?.(i));

    const matFolder = slotFolder.addFolder({ title: "Material", expanded: false });
    matFolder
      .addBinding(slot, "alphaTest", { label: "Alpha test", min: 0.1, max: 0.95, step: 0.01 })
      .on("change", () => onSlotStructureChanged?.(i));
    matFolder
      .addBinding(slot, "roughness", { label: "Roughness", min: 0, max: 1, step: 0.01 })
      .on("change", () => onSlotStructureChanged?.(i));
    matFolder
      .addBinding(slot, "colorTint", { label: "Color tint" })
      .on("change", () => onSlotMaterialChanged?.(i));
    matFolder
      .addBinding(slot, "groundOcclusion", { label: "Ground AO", min: 0, max: 2, step: 0.01 })
      .on("change", () => onSlotMaterialChanged?.(i));
    matFolder
      .addBinding(slot, "normalBending", { label: "Normal bend", min: 0, max: 1, step: 0.01 })
      .on("change", () => onSlotMaterialChanged?.(i));
    matFolder
      .addBinding(slot, "sssIntensity", { label: "SSS intensity", min: 0, max: 5, step: 0.1 })
      .on("change", () => onSlotMaterialChanged?.(i));

    const windFolder = slotFolder.addFolder({ title: "Wind", expanded: false });
    windFolder
      .addBinding(slot, "swaySpeed", { label: "Speed", min: 0, max: 5, step: 0.1 })
      .on("change", () => onSlotMaterialChanged?.(i));
    windFolder
      .addBinding(slot, "swayStrength", { label: "Strength", min: 0, max: 0.5, step: 0.01 })
      .on("change", () => onSlotMaterialChanged?.(i));
  }

  const lodFolder = folder.addFolder({ title: "LOD Distances", expanded: false });
  lodFolder
    .addBinding(toolState.foliageLod, "lod0Distance", {
      label: "LOD0 dist",
      min: 20,
      max: 300,
      step: 5,
    })
    .on("change", () => onFoliageLodChanged?.());
  lodFolder
    .addBinding(toolState.foliageLod, "fadeOutDistance", {
      label: "Fade out",
      min: 50,
      max: 600,
      step: 10,
    })
    .on("change", () => onFoliageLodChanged?.());

  folder.addBlade({ view: "separator" });
  folder.addButton({ title: "🗑 Clear all foliage" }).on("click", () => {
    if (confirm("Clear ALL placed foliage?")) {
      onClearAllFoliage?.();
    }
  });

  return folder;
}
