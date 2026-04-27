export function addRiverFolder(pane, toolState, opts) {
  const {
    onRiverChanged,
    onRiverNewRiver,
    onRiverDeleteActive,
    onRiverDeleteSelected,
    onRiverSelectedYChanged,
    onRiverActiveIndexChanged,
  } = opts;
  const rp = toolState.river;
  const folder = pane.addFolder({ title: "River", expanded: false });

  folder.addBinding(rp, "showHandles", { label: "Show handles" }).on("change", onRiverChanged);
  folder.addBinding(rp, "closed", { label: "Close path (loop)" }).on("change", onRiverChanged);
  folder.addBinding(rp, "activeRiverIndex", { label: "Active river #", min: 0, max: 63, step: 1 }).on("change", () => onRiverActiveIndexChanged?.());
  folder.addButton({ title: "New river" }).on("click", () => onRiverNewRiver?.());
  folder.addButton({ title: "Delete active river" }).on("click", () => onRiverDeleteActive?.());
  folder.addButton({ title: "Delete selected point" }).on("click", () => onRiverDeleteSelected?.());
  folder.addBinding(rp, "selectedPointY", { label: "Point Y", min: -50, max: 200, step: 0.1 }).on("change", () => onRiverSelectedYChanged?.());

  const geo = folder.addFolder({ title: "Geometry", expanded: false });
  geo.addBinding(rp, "width", { label: "Width", min: 1, max: 80, step: 0.5 }).on("change", onRiverChanged);
  geo.addBinding(rp, "segments", { label: "Segments", min: 20, max: 900, step: 10 }).on("change", onRiverChanged);
  geo.addBinding(rp, "heightOffset", { label: "Height offset", min: 0, max: 3, step: 0.01 }).on("change", onRiverChanged);

  const mat = folder.addFolder({ title: "Material", expanded: false });
  mat.addBinding(rp, "shaderStyle", {
    label: "Shader style",
    options: {
      Basic: "Basic",
      "Stylized v1": "Stylized",
    },
  }).on("change", onRiverChanged);
  mat.addBinding(rp, "shallowColor", { label: "Shallow", view: "color" }).on("change", onRiverChanged);
  mat.addBinding(rp, "deepColor", { label: "Deep", view: "color" }).on("change", onRiverChanged);
  mat.addBinding(rp, "highlightColor", { label: "Highlight", view: "color" }).on("change", onRiverChanged);
  mat.addBinding(rp, "foamColor", { label: "Foam", view: "color" }).on("change", onRiverChanged);
  mat.addBinding(rp, "foamWidth", { label: "Foam width", min: 0.01, max: 0.6, step: 0.01 }).on("change", onRiverChanged);
  mat.addBinding(rp, "opacity", { label: "Opacity", min: 0.05, max: 1, step: 0.01 }).on("change", onRiverChanged);
  mat.addBinding(rp, "flowSpeed", { label: "Flow speed", min: 0, max: 5, step: 0.01 }).on("change", onRiverChanged);

  return folder;
}

