export function addRoadFolder(pane, toolState, opts) {
  const {
    onRoadChanged,
    onRoadNewRoad,
    onRoadDeleteActive,
    onRoadDeleteSelected,
    onRoadSnapY,
    onRoadSelectedYChanged,
    onRoadActiveIndexChanged,
    onRoadFlattenTerrain,
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
  folder.addButton({ title: "Flatten terrain under roads" }).on("click", () => onRoadFlattenTerrain?.());

  const matFolder = folder.addFolder({ title: "Material", expanded: false });
  matFolder.addBinding(rp, "colorTint", { label: "Color tint", view: "color" }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "colorBrightness", { label: "Brightness", min: 0.2, max: 2.0, step: 0.05 }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "lineColor", { label: "Edge color", view: "color" }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "lineWidth", { label: "Edge width", min: 0, max: 0.2, step: 0.005 }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "lineSoftness", { label: "Edge softness", min: 0, max: 0.1, step: 0.002 }).on("change", onRoadChanged);
  matFolder.addBinding(rp, "lineInset", { label: "Edge inset", min: 0, max: 0.15, step: 0.005 }).on("change", onRoadChanged);

  const edgeBlendFolder = matFolder.addFolder({ title: "Edge blend", expanded: false });
  edgeBlendFolder.addBinding(rp, "edgeBlendWidth", { label: "Blend width", min: 0, max: 0.3, step: 0.01 }).on("change", onRoadChanged);
  edgeBlendFolder.addBinding(rp, "edgeBlendNoise", { label: "Noise scale", min: 1, max: 30, step: 0.5 }).on("change", onRoadChanged);

  const centerFolder = matFolder.addFolder({ title: "Center line", expanded: false });
  centerFolder.addBinding(rp, "centerLine", { label: "Enable" }).on("change", onRoadChanged);
  centerFolder.addBinding(rp, "centerLineColor", { label: "Color", view: "color" }).on("change", onRoadChanged);
  centerFolder.addBinding(rp, "centerLineWidth", { label: "Width", min: 0.005, max: 0.1, step: 0.002 }).on("change", onRoadChanged);
  centerFolder.addBinding(rp, "centerLineSoftness", { label: "Softness", min: 0, max: 0.05, step: 0.002 }).on("change", onRoadChanged);
  centerFolder.addBinding(rp, "centerLineDashed", { label: "Dashed" }).on("change", onRoadChanged);
  centerFolder.addBinding(rp, "centerLineDashScale", { label: "Dash density", min: 0.05, max: 2, step: 0.05 }).on("change", onRoadChanged);

  const geoFolder = folder.addFolder({ title: "Geometry", expanded: false });
  geoFolder.addBinding(rp, "width", { label: "Width", min: 1, max: 50, step: 0.5 }).on("change", onRoadChanged);
  geoFolder.addBinding(rp, "segments", { label: "Segments", min: 20, max: 600, step: 10 }).on("change", onRoadChanged);
  geoFolder.addBinding(rp, "heightOffset", { label: "Height offset", min: 0, max: 2, step: 0.01 }).on("change", onRoadChanged);

  const enhFolder = folder.addFolder({ title: "Enhanced (PBR + Reflect)", expanded: false });
  enhFolder.addBinding(rp, "enhanced", { label: "Enable" }).on("change", onRoadChanged);
  enhFolder.addBinding(rp, "normalStrength", { label: "Normal strength", min: 0, max: 3, step: 0.05 }).on("change", onRoadChanged);
  enhFolder.addBinding(rp, "roughnessBase", { label: "Roughness", min: 0.05, max: 1, step: 0.01 }).on("change", onRoadChanged);
  enhFolder.addBinding(rp, "reflectStrength", { label: "Reflect strength", min: 0, max: 1, step: 0.05 }).on("change", onRoadChanged);
  enhFolder.addBinding(rp, "mixBlur", { label: "Reflect blur", min: 0, max: 0.3, step: 0.005 }).on("change", onRoadChanged);
  enhFolder.addBinding(rp, "mixStrength", { label: "Reflect mix", min: 0, max: 4, step: 0.1 }).on("change", onRoadChanged);
  enhFolder.addBinding(rp, "mixContrast", { label: "Reflect contrast", min: 0.2, max: 3, step: 0.05 }).on("change", onRoadChanged);
  enhFolder.addBinding(rp, "normalDistort", { label: "Normal distort", min: 0, max: 0.5, step: 0.01 }).on("change", onRoadChanged);
  enhFolder.addBinding(rp, "texScale", { label: "Texture scale", min: 0.5, max: 20, step: 0.5 }).on("change", onRoadChanged);
  const lodFolder = enhFolder.addFolder({ title: "LOD distances", expanded: false });
  lodFolder.addBinding(rp, "lodNear", { label: "Near (full)", min: 5, max: 100, step: 1 }).on("change", onRoadChanged);
  lodFolder.addBinding(rp, "lodMid", { label: "Mid (reduced)", min: 20, max: 200, step: 5 }).on("change", onRoadChanged);
  lodFolder.addBinding(rp, "lodFar", { label: "Far (TSL only)", min: 50, max: 500, step: 10 }).on("change", onRoadChanged);

  return folder;
}
