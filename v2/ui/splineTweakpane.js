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
    onSplineClearTunnels,
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
      "Procedural tunnel": "tunnel",
      "Guardrail (W profile)": "guardrail",
      "Guardrail From Road": "guardrailFromRoad",
    },
  });
  folder.addBinding(sp, "spacing", { label: "Spacing", min: 0.5, max: 40, step: 0.5 });
  folder.addBinding(sp, "scaleMin", { label: "Scale min", min: 0.05, max: 20, step: 0.05 });
  folder.addBinding(sp, "scaleMax", { label: "Scale max", min: 0.05, max: 20, step: 0.05 });
  folder.addBinding(sp, "alignToPath", { label: "Align to path" });
  const tunnelFolder = folder.addFolder({ title: "Tunnel", expanded: false });
  tunnelFolder.addBinding(sp, "tunnelRadius", { label: "Base radius", min: 1, max: 200, step: 0.25 });
  tunnelFolder.addBinding(sp, "tunnelRadialSegments", { label: "Radial segs", min: 6, max: 48, step: 1 });
  tunnelFolder.addBinding(sp, "tunnelPathSegments", { label: "Path segs", min: 40, max: 800, step: 10 });
  tunnelFolder.addBinding(sp, "tunnelColor", { label: "Color", view: "color" });
  tunnelFolder.addButton({ title: "Clear all tunnels" }).on("click", () => onSplineClearTunnels?.());
  const guardrailFolder = folder.addFolder({ title: "Guardrail", expanded: false });
  guardrailFolder.addBinding(sp, "guardrailHeight", { label: "Rail height", min: 0.05, max: 2.5, step: 0.01 });
  guardrailFolder.addBinding(sp, "guardrailThickness", { label: "Rail thickness", min: 0.01, max: 0.35, step: 0.005 });
  guardrailFolder.addBinding(sp, "guardrailDepth", { label: "Rail depth", min: 0.05, max: 1.4, step: 0.01 });
  guardrailFolder.addBinding(sp, "guardrailCrownDepth", { label: "W crown depth", min: 0.0, max: 0.35, step: 0.005 });
  guardrailFolder.addBinding(sp, "guardrailPathSegments", { label: "Path segs", min: 40, max: 1200, step: 10 });
  guardrailFolder.addBinding(sp, "guardrailPostSpacing", { label: "Post spacing", min: 0.5, max: 8, step: 0.05 });
  guardrailFolder.addBinding(sp, "guardrailPostWidth", { label: "Post width", min: 0.03, max: 0.4, step: 0.005 });
  guardrailFolder.addBinding(sp, "guardrailPostDepth", { label: "Post depth", min: 0.03, max: 0.4, step: 0.005 });
  guardrailFolder.addBinding(sp, "guardrailPostHeight", { label: "Post height", min: 0.2, max: 3, step: 0.01 });
  guardrailFolder.addBinding(sp, "guardrailRailYOffset", { label: "Rail Y offset", min: 0.0, max: 3, step: 0.01 });
  guardrailFolder.addBinding(sp, "guardrailPostSink", { label: "Post sink", min: 0.0, max: 0.6, step: 0.005 });
  guardrailFolder.addBinding(sp, "guardrailColor", { label: "Color", view: "color" });
  const fromRoadFolder = folder.addFolder({ title: "Guardrail From Road", expanded: false });
  fromRoadFolder.addBinding(sp, "guardrailFromRoadIndex", { label: "Road index", min: 0, max: 63, step: 1 });
  fromRoadFolder.addBinding(sp, "guardrailFromRoadSide", {
    label: "Side",
    options: {
      Left: "left",
      Right: "right",
      Both: "both",
    },
  });
  fromRoadFolder.addBinding(sp, "guardrailFromRoadEdgeOffset", { label: "Edge offset", min: -2, max: 8, step: 0.05 });
  fromRoadFolder.addBinding(sp, "guardrailFromRoadStart", { label: "Start %", min: 0, max: 1, step: 0.01 });
  fromRoadFolder.addBinding(sp, "guardrailFromRoadEnd", { label: "End %", min: 0, max: 1, step: 0.01 });
  fromRoadFolder.addBinding(sp, "guardrailFromRoadPostSpacingMul", { label: "Post spacing x", min: 1, max: 12, step: 0.25 });
  folder.addButton({ title: "Preview placement" }).on("click", () => onSplinePreview?.());
  folder.addButton({ title: "Bake placement" }).on("click", () => onSplineBake?.());
  folder.addButton({ title: "Clear preview" }).on("click", () => onSplineClearPreview?.());
  folder.addBlade({ view: "separator" });
  folder.addBinding(sp, "showTrain", { label: "Show train" });
  folder.addBinding(sp, "trainSpeed", { label: "Train speed", min: 0.5, max: 60, step: 0.5 });
  folder.addBinding(sp, "trainScale", { label: "Train scale", min: 0.1, max: 10, step: 0.1 });

  return folder;
}

