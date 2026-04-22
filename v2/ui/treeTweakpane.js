/**
 * Tree LOD panel — slot management, GLB import, brush settings, LOD distances.
 */

/**
 * @param {*} pane
 * @param {*} toolState
 * @param {object} opts
 * @param {(slotIdx: number, lod: 0|1) => void} opts.onImportGlb
 * @param {(slotIdx: number) => void} opts.onImportFoliagePreset
 * @param {(slotIdx: number) => void} opts.onRemoveSlot
 * @param {() => void} opts.onClearAllTrees
 * @param {() => void} opts.onTreeLodChanged
 * @param {() => void} opts.onCastShadowChanged
 * @param {() => void} opts.onFoliageLodChanged
 */
export function addTreeFolder(pane, toolState, opts) {
  const {
    onImportGlb,
    onImportFoliagePreset,
    onRemoveSlot,
    onClearAllTrees,
    onTreeLodChanged,
    onCastShadowChanged,
    onFoliageLodChanged,
  } = opts;

  const folder = pane.addFolder({ title: "Tree LOD", expanded: true });

  // Active slot picker
  const slotOptions = {};
  for (let i = 0; i < toolState.treeSlots.length; i++) {
    slotOptions[toolState.treeSlots[i].name] = i;
  }
  folder.addBinding(toolState.treePaint, "activeSlot", {
    label: "Active slot",
    options: slotOptions,
  });

  // Brush settings
  const brushFolder = folder.addFolder({ title: "Tree Brush", expanded: true });
  brushFolder.addBinding(toolState.treePaint, "density", {
    label: "Density",
    min: 0.05,
    max: 3,
    step: 0.05,
  });
  brushFolder.addBinding(toolState.treePaint, "minSpacing", {
    label: "Min spacing",
    min: 1,
    max: 30,
    step: 0.5,
  });
  brushFolder.addBinding(toolState.treePaint, "scaleMin", {
    label: "Scale min",
    min: 0.1,
    max: 3,
    step: 0.05,
  });
  brushFolder.addBinding(toolState.treePaint, "scaleMax", {
    label: "Scale max",
    min: 0.1,
    max: 3,
    step: 0.05,
  });
  brushFolder.addBinding(toolState.treePaint, "randomRotation", {
    label: "Random rotation",
  });

  // Slot management
  const slotsFolder = folder.addFolder({ title: "Tree Slots (GLB Import)", expanded: true });

  for (let i = 0; i < toolState.treeSlots.length; i++) {
    const slotFolder = slotsFolder.addFolder({
      title: toolState.treeSlots[i].name,
      expanded: i === 0,
    });
    slotFolder.addBinding(toolState.treeSlots[i], "name", { label: "Name" });
    slotFolder.addBinding(toolState.treeSlots[i], "enabled", { label: "Enabled" });
    slotFolder
      .addButton({ title: "📂 Import LOD0 (detail)" })
      .on("click", () => onImportGlb?.(i, 0));
    slotFolder
      .addButton({ title: "📂 Import LOD1 (simplified)" })
      .on("click", () => onImportGlb?.(i, 1));
    slotFolder
      .addButton({ title: "🌿 Import foliage preset" })
      .on("click", () => onImportFoliagePreset?.(i));
    slotFolder
      .addButton({ title: "🗑 Remove models" })
      .on("click", () => onRemoveSlot?.(i));
  }

  // LOD settings
  const lodFolder = folder.addFolder({ title: "LOD Distances", expanded: false });
  lodFolder
    .addBinding(toolState.treeLod, "lod0Distance", {
      label: "LOD0 → LOD1",
      min: 20,
      max: 500,
      step: 5,
    })
    .on("change", () => onTreeLodChanged?.());
  lodFolder
    .addBinding(toolState.treeLod, "lod1Distance", {
      label: "LOD1 → hide",
      min: 50,
      max: 1000,
      step: 10,
    })
    .on("change", () => onTreeLodChanged?.());
  lodFolder
    .addBinding(toolState.treeLod, "fadeOutDistance", {
      label: "Fade-out dist",
      min: 100,
      max: 2000,
      step: 10,
    })
    .on("change", () => onTreeLodChanged?.());
  lodFolder
    .addBinding(toolState.treeLod, "castShadow", { label: "Cast shadow" })
    .on("change", () => onCastShadowChanged?.());

  // Foliage LOD distances
  const fLodFolder = folder.addFolder({ title: "Foliage LOD Distances", expanded: false });
  fLodFolder
    .addBinding(toolState.foliageLod, "lod0Distance", {
      label: "LOD0 → LOD1",
      min: 20,
      max: 300,
      step: 5,
    })
    .on("change", () => onFoliageLodChanged?.());
  fLodFolder
    .addBinding(toolState.foliageLod, "lod1Distance", {
      label: "LOD1 → LOD2",
      min: 50,
      max: 600,
      step: 10,
    })
    .on("change", () => onFoliageLodChanged?.());
  fLodFolder
    .addBinding(toolState.foliageLod, "fadeOutDistance", {
      label: "Fade-out dist",
      min: 100,
      max: 2000,
      step: 10,
    })
    .on("change", () => onFoliageLodChanged?.());

  folder.addBlade({ view: "separator" });
  folder.addButton({ title: "🗑 Clear all trees" }).on("click", () => onClearAllTrees?.());

  return { folder };
}
