export function addSplineFolder(pane, toolState, opts) {
  const {
    onSplineChanged,
    onSplineDeleteSelected,
    onSplineClearAll,
    onSplineSelectedYChanged,
    onSplineClosedChanged,
    onSplinePreview,
    onSplineBake,
    onSplineClearPreview,
    onSplineApplyPlateau,
  } = opts;

  const sp = toolState.spline;
  const folder = pane.addFolder({ title: "Spline", expanded: false });

  folder.addBinding(sp, "showHandles", { label: "Show handles" }).on("change", () => onSplineChanged?.());
  folder.addButton({ title: "Delete selected point" }).on("click", () => onSplineDeleteSelected?.());
  folder.addButton({ title: "Clear all points" }).on("click", () => onSplineClearAll?.());
  folder.addBinding(sp, "selectedPointY", {
    label: "Selected Y",
    min: -50,
    max: 300,
    step: 0.1,
  }).on("change", () => onSplineSelectedYChanged?.());
  folder.addBinding(sp, "closed", { label: "Close path (loop)" }).on("change", () => onSplineClosedChanged?.());
  folder.addBlade({ view: "separator" });
  folder.addBinding(sp, "plateauHeight", { label: "Plateau Y", min: -200, max: 600, step: 0.5 });
  folder.addBinding(sp, "plateauFalloff", { label: "Plateau falloff", min: 0, max: 120, step: 0.25 });
  folder.addBinding(sp, "plateauHalfWidth", { label: "Open half-width", min: 0.25, max: 180, step: 0.25 });
  folder.addButton({ title: "Apply plateau to terrain" }).on("click", () => onSplineApplyPlateau?.());
  folder.addBlade({ view: "separator" });
  folder.addBinding(sp, "objectType", {
    label: "Place object",
    options: {
      "Trees (active tree slot)": "trees",
      "Props (active prop slot)": "props",
    },
  });
  folder.addBinding(sp, "spacing", { label: "Spacing", min: 0.5, max: 40, step: 0.5 });
  folder.addBinding(sp, "scaleMin", { label: "Scale min", min: 0.05, max: 8, step: 0.05 });
  folder.addBinding(sp, "scaleMax", { label: "Scale max", min: 0.05, max: 8, step: 0.05 });
  folder.addBinding(sp, "alignToPath", { label: "Align to path" });
  folder.addButton({ title: "Preview placement" }).on("click", () => onSplinePreview?.());
  folder.addButton({ title: "Bake placement" }).on("click", () => onSplineBake?.());
  folder.addButton({ title: "Clear preview" }).on("click", () => onSplineClearPreview?.());
  folder.addBlade({ view: "separator" });
  folder.addBinding(sp, "showTrain", { label: "Show train" });
  folder.addBinding(sp, "trainSpeed", { label: "Train speed", min: 0.5, max: 60, step: 0.5 });
  folder.addBinding(sp, "trainScale", { label: "Train scale", min: 0.1, max: 10, step: 0.1 });

  return folder;
}

