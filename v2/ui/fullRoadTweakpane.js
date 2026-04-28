export function addFullRoadFolder(pane, toolState, opts) {
  const {
    onFullRoadChanged,
    onFullRoadStartBranch,
    onFullRoadDeleteSelected,
    onFullRoadClearAll,
    onFullRoadSnapY,
    onFullRoadSelectedYChanged,
    onFullRoadToggleJunction,
    onFullRoadFlattenTerrain,
    onFullRoadApplyCityPreset,
  } = opts;
  const rp = toolState.fullRoad;
  const folder = pane.addFolder({ title: "Full Road", expanded: false });

  folder.addBinding(rp, "showHandles", { label: "Show handles" }).on("change", onFullRoadChanged);
  folder.addButton({ title: "Start new branch" }).on("click", () => onFullRoadStartBranch?.());
  folder.addButton({ title: "Toggle selected junction" }).on("click", () => onFullRoadToggleJunction?.());
  folder.addButton({ title: "Delete selected node" }).on("click", () => onFullRoadDeleteSelected?.());
  folder.addButton({ title: "Clear full road network" }).on("click", () => onFullRoadClearAll?.());
  folder.addBinding(rp, "selectedPointY", { label: "Node Y", min: -50, max: 200, step: 0.1 }).on("change", () => onFullRoadSelectedYChanged?.());
  folder.addButton({ title: "Snap selected Y to terrain" }).on("click", () => onFullRoadSnapY?.());
  folder.addButton({ title: "Flatten terrain under full roads" }).on("click", () => onFullRoadFlattenTerrain?.());
  folder.addButton({ title: "Apply City Road Preset" }).on("click", () => onFullRoadApplyCityPreset?.());

  const graphFolder = folder.addFolder({ title: "Graph / Junctions", expanded: true });
  graphFolder.addBinding(rp, "nodeSnapRadius", { label: "Node snap", min: 0.5, max: 20, step: 0.25 }).on("change", onFullRoadChanged);
  graphFolder.addBinding(rp, "branchSnapRadius", { label: "Branch snap", min: 0.5, max: 30, step: 0.25 }).on("change", onFullRoadChanged);
  graphFolder.addBinding(rp, "junctionRadius", { label: "Junction radius", min: 2, max: 80, step: 0.5 }).on("change", onFullRoadChanged);
  graphFolder.addBinding(rp, "junctionSegments", { label: "Junction segs", min: 12, max: 96, step: 4 }).on("change", onFullRoadChanged);

  const geoFolder = folder.addFolder({ title: "Geometry", expanded: false });
  geoFolder.addBinding(rp, "width", { label: "Width", min: 2, max: 60, step: 0.5 }).on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "segments", { label: "Edge segments", min: 8, max: 300, step: 4 }).on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "heightOffset", { label: "Height offset", min: 0, max: 2, step: 0.01 }).on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "adaptiveLift", { label: "Adaptive lift" }).on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "slopeLift", { label: "Slope lift", min: 0, max: 2, step: 0.01 }).on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "liftMax", { label: "Lift cap", min: 0, max: 2, step: 0.01 }).on("change", onFullRoadChanged);

  const matFolder = folder.addFolder({ title: "Material / Lines", expanded: false });
  matFolder.addBinding(rp, "colorTint", { label: "Color tint", view: "color" }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "colorBrightness", { label: "Brightness", min: 0.2, max: 2.0, step: 0.05 }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "lineColor", { label: "Edge color", view: "color" }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "lineWidth", { label: "Edge width", min: 0, max: 0.2, step: 0.005 }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "lineInset", { label: "Edge inset", min: 0, max: 0.15, step: 0.005 }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "centerLine", { label: "Center line" }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "centerLineDashed", { label: "Center dashed" }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "doubleCenterLine", { label: "Double center" }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "laneLines", { label: "Lane separators" }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "laneDashScale", { label: "Dash density", min: 0.005, max: 2, step: 0.005 }).on("change", onFullRoadChanged);
  matFolder.addBinding(rp, "texScale", { label: "Texture scale", min: 0.5, max: 20, step: 0.5 }).on("change", onFullRoadChanged);

  const enhFolder = folder.addFolder({ title: "Enhanced (PBR + Reflect)", expanded: false });
  enhFolder.addBinding(rp, "enhanced", { label: "Enable" }).on("change", onFullRoadChanged);
  enhFolder.addBinding(rp, "normalStrength", { label: "Normal strength", min: 0, max: 3, step: 0.05 }).on("change", onFullRoadChanged);
  enhFolder.addBinding(rp, "roughnessBase", { label: "Roughness", min: 0.05, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  enhFolder.addBinding(rp, "reflectStrength", { label: "Reflect strength", min: 0, max: 1, step: 0.05 }).on("change", onFullRoadChanged);
  enhFolder.addBinding(rp, "mixBlur", { label: "Reflect blur", min: 0, max: 0.3, step: 0.005 }).on("change", onFullRoadChanged);
  enhFolder.addBinding(rp, "mixStrength", { label: "Reflect mix", min: 0, max: 4, step: 0.1 }).on("change", onFullRoadChanged);
  enhFolder.addBinding(rp, "mixContrast", { label: "Reflect contrast", min: 0.2, max: 3, step: 0.05 }).on("change", onFullRoadChanged);
  enhFolder.addBinding(rp, "normalDistort", { label: "Normal distort", min: 0, max: 0.5, step: 0.01 }).on("change", onFullRoadChanged);

  return folder;
}
