export function addGrassFolder(pane, toolState, opts) {
  const { onGrassChanged, onGrassRebuildGeos, onGrassFill, onGrassClear, onGrassSaveDensity, onGrassLoadDensity } = opts;
  const gp = toolState.grass;
  const folder = pane.addFolder({ title: "Grass", expanded: false });

  folder.addBinding(gp, "enabled", { label: "Enabled" }).on("change", onGrassChanged);
  folder.addButton({ title: "Fill all grass" }).on("click", () => onGrassFill?.());
  folder.addButton({ title: "Clear grass" }).on("click", () => onGrassClear?.());
  folder.addButton({ title: "Save density map" }).on("click", () => onGrassSaveDensity?.());
  folder.addButton({ title: "Load density map" }).on("click", () => onGrassLoadDensity?.());

  const slopeFolder = folder.addFolder({ title: "Slope rejection", expanded: false });
  slopeFolder.addBinding(gp, "slopeEnabled", { label: "Enabled" }).on("change", onGrassChanged);
  slopeFolder.addBinding(gp, "slopeMin", { label: "Fade end (steep)", min: 0.0, max: 1.0, step: 0.01 }).on("change", onGrassChanged);
  slopeFolder.addBinding(gp, "slopeMax", { label: "Fade start (gentle)", min: 0.0, max: 1.0, step: 0.01 }).on("change", onGrassChanged);

  const bladeFolder = folder.addFolder({ title: "Blade", expanded: false });
  bladeFolder.addBinding(gp, "bladeHeight", { label: "Height", min: 0.3, max: 5, step: 0.05 }).on("change", () => { onGrassChanged?.(); onGrassRebuildGeos?.(); });
  bladeFolder.addBinding(gp, "bladeWidth", { label: "Width", min: 0.02, max: 0.5, step: 0.01 }).on("change", onGrassRebuildGeos);
  bladeFolder.addBinding(gp, "tipTaperStart", { label: "Taper start", min: 0.2, max: 0.98, step: 0.01 }).on("change", onGrassRebuildGeos);
  bladeFolder.addBinding(gp, "bladeYSegments", { label: "Segments", min: 2, max: 16, step: 1 }).on("change", onGrassRebuildGeos);
  bladeFolder.addBinding(gp, "bladeColor", { label: "Base color", view: "color" }).on("change", onGrassChanged);
  bladeFolder.addBinding(gp, "tipColor", { label: "Tip color", view: "color" }).on("change", onGrassChanged);

  const windFolder = folder.addFolder({ title: "Wind", expanded: false });
  windFolder.addBinding(gp, "windSpeed", { label: "Speed", min: 0.05, max: 2 }).on("change", onGrassChanged);
  windFolder.addBinding(gp, "windStrength", { label: "Strength", min: 0, max: 3 }).on("change", onGrassChanged);
  windFolder.addBinding(gp, "maxAngle", { label: "Max bend", min: 0.5, max: 2.5 }).on("change", onGrassChanged);
  windFolder.addBinding(gp, "naturalLean", { label: "Natural lean", min: 0, max: 1.5 }).on("change", onGrassChanged);
  windFolder.addBinding(gp, "windAngle", { label: "Direction (\u00b0)", min: 0, max: 360, step: 1 }).on("change", onGrassChanged);
  windFolder.addBinding(gp, "windWaveScale", { label: "Wave scale", min: 0.01, max: 0.5 }).on("change", onGrassChanged);
  windFolder.addBinding(gp, "windGust", { label: "Gust", min: 0, max: 1, step: 0.05 }).on("change", onGrassChanged);
  windFolder.addBinding(gp, "bendFocus", { label: "Bend focus", min: 0.5, max: 5 }).on("change", onGrassChanged);
  windFolder.addBinding(gp, "stiffness", { label: "Root stiffness", min: 0, max: 0.8 }).on("change", onGrassChanged);

  const fieldFolder = folder.addFolder({ title: "Field", expanded: false });
  fieldFolder.addBinding(gp, "grassDensity", { label: "Density", min: 0.05, max: 1, step: 0.05 }).on("change", onGrassChanged);
  fieldFolder.addBinding(gp, "grassCount", { label: "Blades/patch", min: 32, max: 4000, step: 32 }).on("change", onGrassRebuildGeos);
  fieldFolder.addBinding(gp, "fieldSize", { label: "Patch size", min: 4, max: 30, step: 0.5 }).on("change", onGrassRebuildGeos);
  fieldFolder.addBinding(gp, "clumpScale", { label: "Clump size", min: 1, max: 20 }).on("change", onGrassChanged);
  fieldFolder.addBinding(gp, "clumpStrength", { label: "Clump strength", min: 0, max: 1 }).on("change", onGrassChanged);
  fieldFolder.addBinding(gp, "crossed", { label: "Crossed ribbons" }).on("change", onGrassRebuildGeos);
  fieldFolder.addBinding(gp, "interactionRadius", { label: "Interact radius", min: 0.5, max: 5, step: 0.1 }).on("change", onGrassChanged);
  fieldFolder.addBinding(gp, "interactionStrength", { label: "Interact strength", min: 0.1, max: 2, step: 0.05 }).on("change", onGrassChanged);

  const colorFolder = folder.addFolder({ title: "Color variation", expanded: false });
  colorFolder.addBinding(gp, "colorVariation", { label: "Enable" }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "cvHueSpread", { label: "Hue spread", min: 0, max: 0.3 }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "cvSatSpread", { label: "Sat spread", min: 0, max: 1 }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "cvDryAmount", { label: "Dry amount", min: 0, max: 0.5 }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "cvDryColor", { label: "Dry color", view: "color" }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "aoBase", { label: "AO base", min: 0, max: 1 }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "aoPower", { label: "AO curve", min: 0.5, max: 6 }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "skyBlend", { label: "Sky normal blend", min: 0, max: 1 }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "cylindrical", { label: "Cylindrical normals", min: 0, max: 1 }).on("change", onGrassChanged);
  colorFolder.addBinding(gp, "viewThicken", { label: "View thicken", min: 0, max: 1 }).on("change", onGrassChanged);

  const tintFolder = folder.addFolder({ title: "Terrain color tint", expanded: false });
  tintFolder.addBinding(gp, "terrainTintEnabled", { label: "Enable" }).on("change", onGrassChanged);
  tintFolder.addBinding(gp, "terrainTintStrength", { label: "Blend amount", min: 0, max: 1, step: 0.02 }).on("change", onGrassChanged);
  tintFolder.addBinding(gp, "terrainTintRootBias", { label: "Root bias (1 = base only)", min: 0, max: 1, step: 0.02 }).on("change", onGrassChanged);
  tintFolder.addBinding(gp, "terrainTintAutoSource", { label: "Auto: imgTex \u2192 image, else TSL base" }).on("change", onGrassChanged);
  tintFolder.addBinding(gp, "terrainTintManualMode", { label: "Manual (if auto off)", options: { Off: 0, "TSL ground": 1, "Image albedo": 2 } }).on("change", onGrassChanged);

  const sssFolder = folder.addFolder({ title: "SSS", expanded: false });
  sssFolder.addBinding(gp, "bssIntensity", { label: "Intensity", min: 0, max: 3 }).on("change", onGrassChanged);
  sssFolder.addBinding(gp, "bssPower", { label: "Back sharpness", min: 0.5, max: 8 }).on("change", onGrassChanged);
  sssFolder.addBinding(gp, "frontScatter", { label: "Front scatter", min: 0, max: 1, step: 0.05 }).on("change", onGrassChanged);
  sssFolder.addBinding(gp, "rimSSS", { label: "Rim glow", min: 0, max: 1, step: 0.05 }).on("change", onGrassChanged);
  sssFolder.addBinding(gp, "bssColor", { label: "Glow color", view: "color" }).on("change", onGrassChanged);

  const spec1Folder = folder.addFolder({ title: "Specular V1", expanded: false });
  spec1Folder.addBinding(gp, "specV1Enabled", { label: "Enabled" }).on("change", onGrassChanged);
  spec1Folder.addBinding(gp, "specV1Intensity", { label: "Intensity", min: 0, max: 5, step: 0.1 }).on("change", onGrassChanged);
  spec1Folder.addBinding(gp, "specV1Color", { label: "Color", view: "color" }).on("change", onGrassChanged);
  spec1Folder.addBinding(gp, "specV1Power", { label: "Power", min: 1, max: 100, step: 0.5 }).on("change", onGrassChanged);
  spec1Folder.addBinding(gp, "specV1DirX", { label: "Dir X", min: -1, max: 1, step: 0.05 }).on("change", onGrassChanged);
  spec1Folder.addBinding(gp, "specV1DirY", { label: "Dir Y", min: -1, max: 1, step: 0.05 }).on("change", onGrassChanged);
  spec1Folder.addBinding(gp, "specV1DirZ", { label: "Dir Z", min: -1, max: 1, step: 0.05 }).on("change", onGrassChanged);

  const spec2Folder = folder.addFolder({ title: "Specular V2", expanded: false });
  spec2Folder.addBinding(gp, "specV2Enabled", { label: "Enabled" }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2Intensity", { label: "Intensity", min: 0, max: 5, step: 0.1 }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2Color", { label: "Color", view: "color" }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2Power", { label: "Power", min: 1, max: 100, step: 0.5 }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2NoiseScale", { label: "Noise scale", min: 0.5, max: 10, step: 0.1 }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2NoiseStr", { label: "Noise str", min: 0, max: 1, step: 0.05 }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2TipBias", { label: "Tip bias", min: 0, max: 1, step: 0.05 }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2DirX", { label: "Dir X", min: -1, max: 1, step: 0.05 }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2DirY", { label: "Dir Y", min: -1, max: 1, step: 0.05 }).on("change", onGrassChanged);
  spec2Folder.addBinding(gp, "specV2DirZ", { label: "Dir Z", min: -1, max: 1, step: 0.05 }).on("change", onGrassChanged);

  const lodFolder = folder.addFolder({ title: "LOD", expanded: false });
  lodFolder.addBinding(gp, "lodEnabled", { label: "Enable LOD" }).on("change", onGrassChanged);
  lodFolder.addBinding(gp, "lodMidDistance", { label: "HIGH\u2192MID dist", min: 10, max: 120 }).on("change", onGrassChanged);
  lodFolder.addBinding(gp, "lodFarDistance", { label: "MID\u2192FAR dist", min: 20, max: 200 }).on("change", onGrassChanged);
  lodFolder.addBinding(gp, "lodMaxDistance", { label: "FAR max (inner ring end)", min: 30, max: 500 }).on("change", onGrassChanged);
  lodFolder.addBinding(gp, "lodMegaMaxDistance", { label: "MEGA max (outer)", min: 50, max: 800, step: 5 }).on("change", onGrassChanged);
  lodFolder.addBinding(gp, "lodFadeStart", { label: "Fade start", min: 0.1, max: 1, step: 0.05 }).on("change", onGrassChanged);
  lodFolder.addBinding(gp, "lodDebug", { label: "Debug colors" }).on("change", onGrassChanged);
  lodFolder.addBinding(gp, "receiveShadow", { label: "Receive shadow" }).on("change", onGrassChanged);

  const lodMidFolder = lodFolder.addFolder({ title: "MID tier", expanded: false });
  lodMidFolder.addBinding(gp, "lodMidPatchSize", { label: "Patch size", min: 10, max: 40, step: 1 }).on("change", onGrassRebuildGeos);
  lodMidFolder.addBinding(gp, "lodMidSegments", { label: "Segments", min: 2, max: 8, step: 1 }).on("change", onGrassRebuildGeos);
  lodMidFolder.addBinding(gp, "lodMidGrassCount", { label: "Blades/patch", min: 32, max: 4000, step: 32 }).on("change", onGrassRebuildGeos);

  const lodFarFolder = lodFolder.addFolder({ title: "FAR tier", expanded: false });
  lodFarFolder.addBinding(gp, "lodFarPatchSize", { label: "Patch size", min: 10, max: 60, step: 1 }).on("change", onGrassRebuildGeos);
  lodFarFolder.addBinding(gp, "lodFarSegments", { label: "Segments", min: 1, max: 4, step: 1 }).on("change", onGrassRebuildGeos);
  lodFarFolder.addBinding(gp, "lodFarGrassCount", { label: "Blades/patch", min: 16, max: 2000, step: 16 }).on("change", onGrassRebuildGeos);

  const lodMegaFolder = lodFolder.addFolder({ title: "MEGA tier", expanded: false });
  lodMegaFolder.addBinding(gp, "lodMegaPatchSize", { label: "Patch size", min: 24, max: 120, step: 1 }).on("change", onGrassRebuildGeos);
  lodMegaFolder.addBinding(gp, "lodMegaSegments", { label: "Segments", min: 1, max: 4, step: 1 }).on("change", onGrassRebuildGeos);
  lodMegaFolder.addBinding(gp, "lodMegaGrassCount", { label: "Blades/patch", min: 16, max: 2000, step: 16 }).on("change", onGrassRebuildGeos);

  lodFolder.addButton({ title: "Rebuild LOD geometries" }).on("click", () => onGrassRebuildGeos?.());
}
