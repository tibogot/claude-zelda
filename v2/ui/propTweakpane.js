export function addPropFolder(pane, toolState, callbacks) {
  const folder = pane.addFolder({ title: "Props", expanded: false });

  const slotOptions = {};
  for (let i = 0; i < toolState.propSlots.length; i++) {
    slotOptions[toolState.propSlots[i].name] = i;
  }
  folder.addBinding(toolState.props, "activeSlot", {
    label: "Active [1-5]",
    options: slotOptions,
  });

  const slotsFolder = folder.addFolder({ title: "Prop Slots (GLB Import)", expanded: true });
  for (let i = 0; i < toolState.propSlots.length; i++) {
    const slotFolder = slotsFolder.addFolder({
      title: toolState.propSlots[i].name,
      expanded: i === 0,
    });
    slotFolder.addBinding(toolState.propSlots[i], "name", { label: "Name" });
    slotFolder
      .addButton({ title: "Load GLB..." })
      .on("click", () => callbacks.onImportPropGlb?.(i));
    slotFolder
      .addButton({ title: "Remove model" })
      .on("click", () => callbacks.onRemovePropSlot?.(i));
  }

  folder.addBlade({ view: "separator" });

  folder.addBinding(toolState.props, "sinkOffset", {
    label: "Sink offset",
    min: 0, max: 10, step: 0.1,
  });

  folder.addBinding(toolState.props, "transformMode", {
    label: "Gizmo [W/E/R]",
    options: {
      "Translate (W)": "translate",
      "Rotate (E)": "rotate",
      "Scale (R)": "scale",
    },
  }).on("change", () => callbacks.onPropTransformModeChanged?.());

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Rebake BVH" }).on("click", () => {
    callbacks.onRebakeBvh?.();
  });

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Delete Selected [Del]" }).on("click", () => {
    callbacks.onDeleteSelectedProp?.();
  });

  folder.addButton({ title: "Clear All Props" }).on("click", () => {
    callbacks.onClearAllProps?.();
  });

  return folder;
}
