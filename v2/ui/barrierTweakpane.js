export function addBarrierFolder(pane, toolState, callbacks) {
  const folder = pane.addFolder({ title: "Barrier", expanded: false });

  folder
    .addBinding(toolState.barrier, "erase", { label: "Erase (or Shift)" });

  folder
    .addBinding(toolState.barrier, "showOverlay", { label: "Show overlay" })
    .on("change", () => callbacks.onBarrierOverlayChanged?.());

  folder
    .addBinding(toolState.barrier, "overlayOpacity", {
      label: "Overlay opacity",
      min: 0.1,
      max: 0.8,
      step: 0.05,
    })
    .on("change", () => callbacks.onBarrierOverlayChanged?.());

  folder.addBlade({ view: "separator" });

  folder
    .addButton({ title: "Clear all barriers" })
    .on("click", () => callbacks.onBarrierClear?.());

  folder
    .addButton({ title: "Fill entire world" })
    .on("click", () => callbacks.onBarrierFill?.());

  return folder;
}
