export function addCliffFolder(pane, toolState, callbacks) {
  const folder = pane.addFolder({ title: "Cliffs", expanded: false });

  const slotOptions = {};
  for (let i = 0; i < toolState.cliffSlots.length; i++) {
    slotOptions[toolState.cliffSlots[i].name] = i;
  }
  folder.addBinding(toolState.cliffs, "activeSlot", {
    label: "Active [1-5]",
    options: slotOptions,
  });

  const slotsFolder = folder.addFolder({ title: "Cliff Slots (GLB Import)", expanded: true });
  for (let i = 0; i < toolState.cliffSlots.length; i++) {
    const slotFolder = slotsFolder.addFolder({
      title: toolState.cliffSlots[i].name,
      expanded: i === 0,
    });
    slotFolder.addBinding(toolState.cliffSlots[i], "name", { label: "Name" });
    slotFolder
      .addButton({ title: "Load GLB..." })
      .on("click", () => callbacks.onImportCliffGlb?.(i));
    slotFolder
      .addButton({ title: "Remove model" })
      .on("click", () => callbacks.onRemoveCliffSlot?.(i));
  }

  folder.addBlade({ view: "separator" });

  folder.addBinding(toolState.cliffs, "sinkOffset", {
    label: "Sink offset",
    min: 0, max: 10, step: 0.1,
  });

  folder.addBinding(toolState.cliffs, "transformMode", {
    label: "Gizmo [W/E/R]",
    options: {
      "Translate (W)": "translate",
      "Rotate (E)": "rotate",
      "Scale (R)": "scale",
    },
  }).on("change", () => callbacks.onTransformModeChanged?.());

  folder.addBlade({ view: "separator" });

  const blendFolder = folder.addFolder({ title: "Blend Material", expanded: false });
  const blendChange = () => callbacks.onCliffBlendChanged?.();

  blendFolder.addBinding(toolState.cliffs, "blendRockScale", {
    label: "Rock UV Scale", min: 0.001, max: 0.1, step: 0.001,
  }).on("change", blendChange);
  blendFolder.addBinding(toolState.cliffs, "blendRockBrightness", {
    label: "Rock Brightness", min: 0.1, max: 5, step: 0.05,
  }).on("change", blendChange);
  blendFolder.addBinding(toolState.cliffs, "blendRockContrast", {
    label: "Rock Contrast", min: 0.1, max: 3, step: 0.05,
  }).on("change", blendChange);
  blendFolder.addBinding(toolState.cliffs, "blendTriplanarSharp", {
    label: "Triplanar Sharp", min: 1, max: 16, step: 0.5,
  }).on("change", blendChange);
  blendFolder.addBinding(toolState.cliffs, "blendSlopeLow", {
    label: "Slope Low", min: 0, max: 1, step: 0.01,
  }).on("change", blendChange);
  blendFolder.addBinding(toolState.cliffs, "blendSlopeHigh", {
    label: "Slope High", min: 0, max: 1, step: 0.01,
  }).on("change", blendChange);
  blendFolder.addBinding(toolState.cliffs, "blendNoiseScale", {
    label: "Slope Noise Scale", min: 0.001, max: 0.5, step: 0.001,
  }).on("change", blendChange);
  blendFolder.addBinding(toolState.cliffs, "blendNoiseStr", {
    label: "Slope Noise Str", min: 0, max: 1, step: 0.01,
  }).on("change", blendChange);
  blendFolder.addBinding(toolState.cliffs, "blendGroundScale", {
    label: "Ground UV Scale", min: 0.1, max: 5, step: 0.1,
  }).on("change", blendChange);

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Rebake BVH" }).on("click", () => {
    callbacks.onRebakeBvh?.();
  });

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Delete Selected [Del]" }).on("click", () => {
    callbacks.onDeleteSelected?.();
  });

  folder.addButton({ title: "Clear All Cliffs" }).on("click", () => {
    callbacks.onClearAllCliffs?.();
  });

  return folder;
}
