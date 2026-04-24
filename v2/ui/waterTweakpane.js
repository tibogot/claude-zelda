/**
 * waterTweakpane.js — Tweakpane folder for water body mode (W).
 */

export function addWaterFolder(pane, toolState, {
  onWaterChanged,
  onSaveWater,
  onLoadWater,
  onDeleteSelected,
  onClearAll,
}) {
  const folder = pane.addFolder({ title: "Water bodies · W", expanded: true });
  folder.hidden = true;

  const w = toolState.water;

  folder.addBinding(w, "style", {
    label: "Next body style",
    options: { Ocean: "Ocean", Lake: "Lake" },
  });

  folder.addBlade({ view: "separator" });

  folder
    .addBinding(w, "deepColor", { label: "Deep color", view: "color" })
    .on("change", () => onWaterChanged?.());
  folder
    .addBinding(w, "midColor", { label: "Mid color", view: "color" })
    .on("change", () => onWaterChanged?.());
  folder
    .addBinding(w, "highlightColor", { label: "Highlight", view: "color" })
    .on("change", () => onWaterChanged?.());
  folder
    .addBinding(w, "opacity", { label: "Opacity", min: 0, max: 1, step: 0.01 })
    .on("change", () => onWaterChanged?.());
  folder
    .addBinding(w, "foamColor", { label: "Foam color", view: "color" })
    .on("change", () => onWaterChanged?.());

  folder.addBlade({ view: "separator" });

  folder.addBinding(w, "sinkOffset", {
    label: "Sink offset",
    min: -2,
    max: 2,
    step: 0.01,
  });
  folder.addBinding(w, "preset", {
    label: "Size preset",
    options: {
      Puddle: "Puddle",
      "Small lake": "Small lake",
      "Large lake": "Large lake",
      "River strip": "River strip",
    },
  });

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Save water JSON" }).on("click", () => onSaveWater?.());
  folder.addButton({ title: "Load water JSON…" }).on("click", () => onLoadWater?.());
  folder
    .addButton({ title: "Delete selected (Del)" })
    .on("click", () => onDeleteSelected?.());
  folder
    .addButton({ title: "Clear all water bodies" })
    .on("click", () => onClearAll?.());

  return folder;
}
