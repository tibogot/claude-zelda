export function addCliffFolder(pane, toolState, callbacks) {
  const folder = pane.addFolder({ title: "Cliffs", expanded: false });

  folder.addButton({ title: "Load Cliff GLB..." }).on("click", () => {
    callbacks.onImportCliffGlb?.();
  });

  folder.addBinding(toolState.cliffs, "sinkOffset", {
    label: "Sink offset",
    min: 0, max: 10, step: 0.1,
  });

  folder.addBinding(toolState.cliffs, "transformMode", {
    label: "Gizmo",
    options: {
      Translate: "translate",
      Rotate: "rotate",
      Scale: "scale",
    },
  }).on("change", () => callbacks.onTransformModeChanged?.());

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
