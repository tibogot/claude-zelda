/**
 * Tweakpane folder for decal mode (D).
 */

export function addDecalFolder(pane, toolState, {
  onLoadImage,
  onOpacityChanged,
  onAlignChanged,
  onRefit,
  onDeleteSelected,
  onClearAll,
  onSaveJson,
  onLoadJson,
  onTransformModeChanged,
}) {
  const folder = pane.addFolder({ title: "Decals · D", expanded: true });
  folder.hidden = true;

  const d = toolState.decal;

  folder.addButton({ title: "Load image (brush)…" }).on("click", () => onLoadImage?.());

  folder.addBlade({ view: "separator" });

  folder
    .addBinding(d, "opacity", { label: "Opacity", min: 0, max: 1, step: 0.01 })
    .on("change", () => onOpacityChanged?.());
  folder.addBinding(d, "heightOffset", {
    label: "Height offset",
    min: -1,
    max: 2,
    step: 0.01,
  });
  folder.addBinding(d, "defaultScale", {
    label: "New decal scale",
    min: 0.25,
    max: 40,
    step: 0.25,
  });
  folder.addBinding(d, "alignToNormal", { label: "Align to surface" }).on("change", () => onAlignChanged?.());
  folder.addBinding(d, "conformSubdiv", {
    label: "Conform subdiv",
    min: 4,
    max: 64,
    step: 1,
  });

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Conform selected to terrain" }).on("click", () => onRefit?.());
  folder
    .addButton({ title: "Delete selected (Del)" })
    .on("click", () => onDeleteSelected?.());
  folder.addButton({ title: "Clear all decals" }).on("click", () => onClearAll?.());

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Save decals JSON" }).on("click", () => onSaveJson?.());
  folder.addButton({ title: "Load decals JSON…" }).on("click", () => onLoadJson?.());

  folder.addBlade({ view: "separator" });

  folder
    .addBinding(d, "transformMode", {
      label: "Gizmo",
      options: { Translate: "translate", Rotate: "rotate", Scale: "scale" },
    })
    .on("change", () => onTransformModeChanged?.());

  return folder;
}
