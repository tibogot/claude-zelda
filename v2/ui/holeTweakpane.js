export function addHoleFolder(pane, toolState, callbacks) {
  const folder = pane.addFolder({ title: "Terrain holes", expanded: false });

  folder
    .addBinding(toolState.hole, "erase", { label: "Erase (or Shift)" });

  folder
    .addBinding(toolState.hole, "showOverlay", { label: "Show overlay" })
    .on("change", () => callbacks.onHoleOverlayChanged?.());

  folder
    .addBinding(toolState.hole, "overlayOpacity", {
      label: "Overlay opacity",
      min: 0.1,
      max: 0.8,
      step: 0.05,
    })
    .on("change", () => callbacks.onHoleOverlayChanged?.());

  folder.addBlade({ view: "separator" });

  folder
    .addButton({ title: "Clear all holes" })
    .on("click", () => callbacks.onHoleClear?.());

  return folder;
}
