/**
 * Tree LOD panel — slot management, GLB import, brush settings, LOD distances.
 */

/**
 * @param {*} pane
 * @param {*} toolState
 * @param {object} opts
 * @param {(slotIdx: number, lod: 0|1) => void} opts.onImportGlb
 * @param {(slotIdx: number) => void} opts.onLoadTreePreset
 * @param {(slotIdx: number) => void} opts.onRemoveSlot
 * @param {() => void} opts.onMassPlace
 * @param {() => void} opts.onClearAllTrees
 * @param {() => void} opts.onTreeLodChanged
 * @param {() => void} opts.onCastShadowChanged
 * @param {() => void} opts.onFoliageLodChanged
 * @param {(slotIdx: number) => void} opts.onFoliageParamChanged
 */
export function addTreeFolder(pane, toolState, opts) {
  const {
    onImportGlb,
    onLoadTreePreset,
    onRemoveSlot,
    onMassPlace,
    onClearAllTrees,
    onTreeLodChanged,
    onCastShadowChanged,
    onFoliageLodChanged,
    onFoliageParamChanged,
  } = opts;

  const folder = pane.addFolder({ title: "Tree LOD", expanded: false });

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
    max: 100,
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

  // Mass place
  const massFolder = folder.addFolder({ title: "Mass Place Trees", expanded: true });
  massFolder.addBinding(toolState.treePaint, "massPlaceCount", {
    label: "Number of trees",
    min: 1,
    max: 50000,
    step: 1,
  });
  massFolder.addBinding(toolState.treePaint, "massPlaceKeepExisting", {
    label: "Keep existing trees",
  });
  massFolder
    .addButton({ title: "🌳 Place" })
    .on("click", () => onMassPlace?.());

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
      .addButton({ title: "🌳 Load tree preset" })
      .on("click", () => onLoadTreePreset?.(i));
    slotFolder.addBinding(toolState.treeSlots[i], "baseScale", {
      label: "Base scale",
      min: 0.01,
      max: 5,
      step: 0.01,
    });

    const fi = toolState.treeSlots[i].foliage;
    const foliageFolder = slotFolder.addFolder({ title: "Foliage Material", expanded: false });
    const fChange = () => onFoliageParamChanged?.(i);

    const colF = foliageFolder.addFolder({ title: "Colors", expanded: false });
    colF.addBinding(fi, "bottomColor", { label: "Base color", view: "color" }).on("change", fChange);
    colF.addBinding(fi, "topColor",    { label: "Top color",  view: "color" }).on("change", fChange);
    colF.addBinding(fi, "colorVar",    { label: "Variation",  min: 0, max: 0.5, step: 0.01 }).on("change", fChange);
    colF.addBinding(fi, "alphaCutoff", { label: "Alpha cutoff", min: 0.1, max: 0.9, step: 0.01 }).on("change", fChange);

    const litF = foliageFolder.addFolder({ title: "Lighting", expanded: false });
    litF.addBinding(fi, "normalBias", { label: "Sphere normals", min: 0, max: 1, step: 0.01 }).on("change", fChange);
    litF.addBinding(fi, "leafWarp",   { label: "Leaf warp",      min: 0, max: 1, step: 0.01 }).on("change", fChange);
    litF.addBinding(fi, "aoStr",      { label: "AO strength",    min: 0, max: 1, step: 0.01 }).on("change", fChange);

    const sssF = foliageFolder.addFolder({ title: "SSS & Rim", expanded: false });
    sssF.addBinding(fi, "sssStr",   { label: "SSS strength", min: 0, max: 2, step: 0.01 }).on("change", fChange);
    sssF.addBinding(fi, "sssPow",   { label: "SSS power",    min: 0.5, max: 8, step: 0.1 }).on("change", fChange);
    sssF.addBinding(fi, "sssColor", { label: "SSS color",    view: "color" }).on("change", fChange);
    sssF.addBinding(fi, "rimStr",   { label: "Rim strength",  min: 0, max: 2, step: 0.01 }).on("change", fChange);
    sssF.addBinding(fi, "rimPow",   { label: "Rim power",     min: 0.5, max: 8, step: 0.1 }).on("change", fChange);
    sssF.addBinding(fi, "rimColor", { label: "Rim color",     view: "color" }).on("change", fChange);

    const windF = foliageFolder.addFolder({ title: "Wind", expanded: false });
    windF.addBinding(fi, "windSpeed", { label: "Speed",      min: 0, max: 5, step: 0.05 }).on("change", fChange);
    windF.addBinding(fi, "windStr",   { label: "Strength",   min: 0, max: 0.5, step: 0.005 }).on("change", fChange);
    windF.addBinding(fi, "windMicro", { label: "Micro sway", min: 0, max: 0.3, step: 0.005 }).on("change", fChange);

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
