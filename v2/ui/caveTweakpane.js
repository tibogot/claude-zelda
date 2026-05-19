export function addCaveFolder(pane, toolState, callbacks) {
  const folder = pane.addFolder({ title: "Caves (box room)", expanded: false });

  folder.addBlade({
    view: "text",
    parse: (v) => v,
    value: "Click on terrain in Cave mode to place. Size below.",
    label: "",
    disabled: true,
  });

  folder.addBinding(toolState.cave, "width", {
    label: "Width (X)",
    min: 4, max: 60, step: 0.5,
  });
  folder.addBinding(toolState.cave, "depth", {
    label: "Depth (Z)",
    min: 4, max: 60, step: 0.5,
  });
  folder.addBinding(toolState.cave, "height", {
    label: "Height (Y)",
    min: 2, max: 30, step: 0.5,
  });
  folder.addBinding(toolState.cave, "opening", {
    label: "Ceiling opening",
    min: 1, max: 30, step: 0.5,
  });
  folder.addBinding(toolState.cave, "ceilingOffset", {
    label: "Ceiling drop",
    min: 0, max: 4, step: 0.1,
  });

  folder.addBlade({ view: "separator" });

  const countBlade = folder.addBlade({
    view: "text",
    parse: (v) => v,
    value: "0",
    label: "Placed",
    disabled: true,
  });

  folder
    .addButton({ title: "Undo last placement" })
    .on("click", () => callbacks.onCaveUndo?.());
  folder
    .addButton({ title: "Redo" })
    .on("click", () => callbacks.onCaveRedo?.());
  folder
    .addButton({ title: "Clear all caves" })
    .on("click", () => callbacks.onCaveClear?.());

  return {
    folder,
    refreshCount(n) {
      countBlade.value = String(n);
    },
  };
}
