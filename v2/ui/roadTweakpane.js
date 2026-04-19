export function addRoadFolder(pane, toolState, opts) {
  const {
    onRoadChanged,
    onRoadNewRoad,
    onRoadDeleteActive,
    onRoadDeleteSelected,
    onRoadSnapY,
    onRoadSelectedYChanged,
    onRoadActiveIndexChanged,
  } = opts;
  const rp = toolState.road;
  const folder = pane.addFolder({ title: "Road", expanded: true });

  folder.addBinding(rp, "showHandles", { label: "Show handles" }).on("change", onRoadChanged);
  folder.addBinding(rp, "activeRoadIndex", { label: "Active road #", min: 0, max: 63, step: 1 }).on("change", () => onRoadActiveIndexChanged?.());
  folder.addButton({ title: "New road" }).on("click", () => onRoadNewRoad?.());
  folder.addButton({ title: "Delete active road" }).on("click", () => onRoadDeleteActive?.());
  folder.addButton({ title: "Delete selected point" }).on("click", () => onRoadDeleteSelected?.());
  folder.addBinding(rp, "selectedPointY", { label: "Point Y", min: -50, max: 200, step: 0.1 }).on("change", () => onRoadSelectedYChanged?.());
  folder.addButton({ title: "Snap selected Y to terrain" }).on("click", () => onRoadSnapY?.());

  const matFolder = folder.addFolder({ title: "Material", expanded: false });
  matFolder.addBinding(rp, "asphaltDark", { label: "Dark", view: "color" }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "asphaltLight", { label: "Light", view: "color" }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "grainScale", { label: "Grain scale", min: 1, max: 40, step: 0.5 }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "grainStrength", { label: "Grain strength", min: 0, max: 1, step: 0.01 }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "lineColor", { label: "Line color", view: "color" }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "lineWidth", { label: "Line width", min: 0, max: 0.2, step: 0.005 }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "lineSoftness", { label: "Line softness", min: 0, max: 0.1, step: 0.002 }).on("change", onRoadChanged);

  const geoFolder = folder.addFolder({ title: "Geometry", expanded: false });
  geoFolder.addBinding(rp, "width", { label: "Width", min: 1, max: 30, step: 0.5 }).on("change", onRoadChanged);
  geoFolder.addBinding(rp, "segments", { label: "Segments", min: 20, max: 600, step: 10 }).on("change", onRoadChanged);
  geoFolder.addBinding(rp, "heightOffset", { label: "Height offset", min: 0, max: 2, step: 0.01 }).on("change", onRoadChanged);

  return folder;
}
