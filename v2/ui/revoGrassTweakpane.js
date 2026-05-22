export function addRevoGrassFolder(pane, toolState, opts) {
  const { onRevoGrassChanged, onRevoGrassRebuild } = opts;
  const rp = toolState.revoGrass;
  const folder = pane.addFolder({ title: "Revo Grass (Y)", expanded: false });

  folder.addBinding(rp, "enabled", { label: "Enabled" }).on("change", () => onRevoGrassChanged?.());

  const tileFolder = folder.addFolder({ title: "Tile", expanded: true });
  tileFolder.addBinding(rp, "tileSize", { label: "Size (m)", min: 40, max: 160, step: 5 }).on("change", () => onRevoGrassRebuild?.());
  tileFolder.addBinding(rp, "bladesPerSide", { label: "Grid side", min: 64, max: 1088, step: 16 }).on("change", () => onRevoGrassRebuild?.());
  tileFolder.addBinding(rp, "segments", { label: "Segments", min: 2, max: 6, step: 1 }).on("change", () => onRevoGrassRebuild?.());

  const colorFolder = folder.addFolder({ title: "Color", expanded: false });
  colorFolder.addBinding(rp, "baseColor", { label: "Base", view: "color" }).on("change", () => onRevoGrassChanged?.());
  colorFolder.addBinding(rp, "tipColor", { label: "Tip", view: "color" }).on("change", () => onRevoGrassChanged?.());
  colorFolder.addBinding(rp, "colorMixFactor", { label: "Tip mix", min: 0, max: 1, step: 0.01 }).on("change", () => onRevoGrassChanged?.());
  colorFolder.addBinding(rp, "colorVariationStrength", { label: "Variation", min: 0, max: 3, step: 0.05 }).on("change", () => onRevoGrassChanged?.());
  colorFolder.addBinding(rp, "windColorStrength", { label: "Wind tint", min: 0, max: 1, step: 0.01 }).on("change", () => onRevoGrassChanged?.());
  colorFolder.addBinding(rp, "colorBrightness", { label: "Brightness", min: 0.5, max: 2, step: 0.05 }).on("change", () => onRevoGrassChanged?.());

  const aoFolder = folder.addFolder({ title: "AO", expanded: false });
  aoFolder.addBinding(rp, "aoScale", { label: "Scale", min: 0, max: 5, step: 0.05 }).on("change", () => onRevoGrassChanged?.());
  aoFolder.addBinding(rp, "aoRimSmoothness", { label: "Rim smooth", min: 0, max: 5, step: 0.1 }).on("change", () => onRevoGrassChanged?.());
  aoFolder.addBinding(rp, "aoRadius", { label: "Radius", min: 0, max: 100, step: 1 }).on("change", () => onRevoGrassChanged?.());

  const windFolder = folder.addFolder({ title: "Wind", expanded: false });
  windFolder.addBinding(rp, "windStrength", { label: "Strength", min: 0, max: 1.5, step: 0.01 }).on("change", () => onRevoGrassChanged?.());
  windFolder.addBinding(rp, "windSpeed", { label: "Speed", min: 0, max: 1, step: 0.01 }).on("change", () => onRevoGrassChanged?.());
  windFolder.addBinding(rp, "windIntensity", { label: "Intensity", min: 0, max: 2, step: 0.05 }).on("change", () => onRevoGrassChanged?.());
  windFolder.addBinding(rp, "uvWindScale", { label: "UV scale", min: 0, max: 10, step: 0.1 }).on("change", () => onRevoGrassChanged?.());
  windFolder.addBinding(rp, "windAngle", { label: "Direction°", min: 0, max: 360, step: 1 }).on("change", () => onRevoGrassChanged?.());
  windFolder.addBinding(rp, "baseWindShade", { label: "Wind shade", min: 0, max: 2, step: 0.05 }).on("change", () => onRevoGrassChanged?.());
  windFolder.addBinding(rp, "baseShadeHeight", { label: "Shade height", min: 0, max: 10, step: 0.1 }).on("change", () => onRevoGrassChanged?.());

  const distFolder = folder.addFolder({ title: "Distance fade", expanded: false });
  distFolder.addBinding(rp, "stochasticR0", { label: "Full density", min: 4, max: 40, step: 1 }).on("change", () => onRevoGrassChanged?.());
  distFolder.addBinding(rp, "stochasticR1", { label: "Fade end", min: 20, max: 120, step: 2 }).on("change", () => onRevoGrassChanged?.());
  distFolder.addBinding(rp, "stochasticPMin", { label: "Far keep", min: 0, max: 1, step: 0.01 }).on("change", () => onRevoGrassChanged?.());

  const shadowFolder = folder.addFolder({ title: "Shadow", expanded: false });
  shadowFolder.addBinding(rp, "bakedShadowWeight", { label: "Baked weight", min: 0, max: 1, step: 0.05 }).on("change", () => onRevoGrassChanged?.());
  shadowFolder.addBinding(rp, "playerShadowEnabled", { label: "Player shadow" }).on("change", () => onRevoGrassChanged?.());

  const cullFolder = folder.addFolder({ title: "Frustum cull", expanded: false });
  cullFolder.addBinding(rp, "frustumCullEnabled", { label: "Enabled" }).on("change", () => onRevoGrassChanged?.());
  cullFolder.addBinding(rp, "cullPadNdcX", { label: "Pad X", min: 0, max: 0.5, step: 0.005 }).on("change", () => onRevoGrassChanged?.());
  cullFolder.addBinding(rp, "cullPadNdcYNear", { label: "Pad Y near", min: 0, max: 1, step: 0.01 }).on("change", () => onRevoGrassChanged?.());
  cullFolder.addBinding(rp, "cullPadNdcYFar", { label: "Pad Y far", min: 0, max: 1, step: 0.01 }).on("change", () => onRevoGrassChanged?.());

  const exclFolder = folder.addFolder({ title: "Exclusion", expanded: false });
  exclFolder.addBinding(rp, "exclusionEnabled", { label: "Gemini density mask" }).on("change", () => onRevoGrassChanged?.());
  exclFolder.addBinding(rp, "exclusionThreshold", { label: "Threshold", min: 0, max: 1, step: 0.01 }).on("change", () => onRevoGrassChanged?.());

  return folder;
}
