import { Pane } from "tweakpane";
import { V2_CONFIG } from "../app/config.js";
import { addTerrainAppearanceFolder } from "./terrainAppearanceTweakpane.js";
import { addTextureLibraryFolder } from "./textureLibraryTweakpane.js";
import { addPaintFolder } from "./paintTweakpane.js";
import { addTreeFolder } from "./treeTweakpane.js";
import { addGrassFolder } from "./grassTweakpane.js";
import { addCliffFolder } from "./cliffTweakpane.js";
import { addPropFolder } from "./propTweakpane.js";
import { addRoadFolder } from "./roadTweakpane.js";
import { addWaterFolder } from "./waterTweakpane.js";
import { addBarrierFolder } from "./barrierTweakpane.js";

export function createTweakpaneUi({
  toolState,
  config,
  sculptSystem,
  onConfigChanged,
  perf,
  textureLibrary,
  onRebuildSkyEnv,
  onCsmEnabledChange,
  onFogChange,
  onGenerateProceduralTerrain,
  onRunGlobalErosion,
  onRampCleared,
  onTerrainSurfaceChanged,
  onTslTerrainSync,
  onAutoCliffChanged,
  onCliffSlotChanged,
  onGroundSlotChanged,
  onModeChanged,
  onPaintLayersChanged,
  onPaintFill,
  onPaintClear,
  onSaveProject,
  onLoadProject,
  onImportTreeGlb,
  onLoadTreePreset,
  onRemoveTreeSlot,
  onClearAllTrees,
  onTreeLodChanged,
  onTreeCastShadowChanged,
  onFoliageLodChanged,
  onFoliageParamChanged,
  onGrassChanged,
  onGrassRebuildGeos,
  onGrassFill,
  onGrassClear,
  onGrassSaveDensity,
  onGrassLoadDensity,
  onCliffGrassFill,
  onCliffGrassClear,
  onImportCliffGlb,
  onRemoveCliffSlot,
  onDeleteSelectedCliff,
  onClearAllCliffs,
  onRebakeBvh,
  onCliffTransformModeChanged,
  onCliffBlendChanged,
  onImportPropGlb,
  onRemovePropSlot,
  onDeleteSelectedProp,
  onClearAllProps,
  onPropTransformModeChanged,
  onRoadChanged,
  onRoadNewRoad,
  onRoadDeleteActive,
  onRoadDeleteSelected,
  onRoadSnapY,
  onRoadSelectedYChanged,
  onRoadActiveIndexChanged,
  onWaterChanged,
  onSaveWater,
  onLoadWater,
  onDeleteSelectedWater,
  onClearAllWater,
  onBarrierOverlayChanged,
  onBarrierClear,
  onBarrierFill,
}) {
  const pane = new Pane({ title: "V2 Terrain Core" });

  const globalFolder = pane.addFolder({ title: "Global" });
  globalFolder
    .addBinding(toolState, "mode", {
      label: "Mode",
      options: {
        View: "view",
        Sculpt: "sculpt",
        Paint: "paint",
        "Tree Paint": "treePaint",
        Grass: "grass",
        "Cliff Grass": "cliffGrass",
        Road: "road",
        Cliffs: "cliffs",
        Props: "props",
        Water: "water",
        Barrier: "barrier",
        Play: "play",
      },
    })
    .on("change", () => onModeChanged?.());
  globalFolder.addButton({ title: "Undo" }).on("click", () => sculptSystem.undo());
  globalFolder.addButton({ title: "Redo" }).on("click", () => sculptSystem.redo());
  globalFolder.addBlade({ view: "separator" });
  globalFolder.addButton({ title: "💾 Save project" }).on("click", () => onSaveProject?.());
  globalFolder.addButton({ title: "📂 Load project" }).on("click", () => onLoadProject?.());

  addTerrainAppearanceFolder(pane, toolState, {
    textureLibrary,
    onTerrainSurfaceChanged,
    onTslTerrainSync,
    onAutoCliffChanged,
    onCliffSlotChanged,
    onGroundSlotChanged,
  });

  if (textureLibrary) {
    addTextureLibraryFolder(pane, toolState, textureLibrary);
    addPaintFolder(pane, toolState, {
      config,
      textureLibrary,
      onPaintLayersChanged,
      onPaintFill,
      onPaintClear,
    });
  }

  addTreeFolder(pane, toolState, {
    onImportGlb: onImportTreeGlb,
    onLoadTreePreset,
    onRemoveSlot: onRemoveTreeSlot,
    onClearAllTrees,
    onTreeLodChanged,
    onFoliageLodChanged,
    onCastShadowChanged: onTreeCastShadowChanged,
    onFoliageParamChanged,
  });

  addGrassFolder(pane, toolState, {
    onGrassChanged,
    onGrassRebuildGeos,
    onGrassFill,
    onGrassClear,
    onGrassSaveDensity,
    onGrassLoadDensity,
  });

  const cliffGrassFolder = pane.addFolder({ title: "Cliff Grass", expanded: false });
  cliffGrassFolder.addButton({ title: "Fill cliff grass" }).on("click", () => onCliffGrassFill?.());
  cliffGrassFolder.addButton({ title: "Clear cliff grass" }).on("click", () => onCliffGrassClear?.());

  addRoadFolder(pane, toolState, {
    onRoadChanged,
    onRoadNewRoad,
    onRoadDeleteActive,
    onRoadDeleteSelected,
    onRoadSnapY,
    onRoadSelectedYChanged,
    onRoadActiveIndexChanged,
  });

  addCliffFolder(pane, toolState, {
    onImportCliffGlb,
    onRemoveCliffSlot,
    onDeleteSelected: onDeleteSelectedCliff,
    onClearAllCliffs,
    onRebakeBvh,
    onTransformModeChanged: onCliffTransformModeChanged,
    onCliffBlendChanged,
  });

  const propCallbacks = {
    onImportPropGlb,
    onRemovePropSlot,
    onDeleteSelectedProp,
    onClearAllProps,
    onRebakeBvh,
    onPropTransformModeChanged,
  };
  addPropFolder(pane, toolState, propCallbacks);

  const waterFolder = addWaterFolder(pane, toolState, {
    onWaterChanged,
    onSaveWater,
    onLoadWater,
    onDeleteSelected: onDeleteSelectedWater,
    onClearAll: onClearAllWater,
  });

  const barrierFolder = addBarrierFolder(pane, toolState, {
    onBarrierOverlayChanged,
    onBarrierClear,
    onBarrierFill,
  });

  /** Shared across sculpt, future paint, foliage, props — same as v1 brush UX. */
  const brushFolder = pane.addFolder({ title: "Brush" });
  brushFolder.addBinding(toolState.brush, "radius", {
    min: V2_CONFIG.sculpt.brushMin,
    max: V2_CONFIG.sculpt.brushMax,
    step: 0.5,
    label: "Radius",
  });
  brushFolder.addBinding(toolState.brush, "strength", {
    min: V2_CONFIG.sculpt.strengthMin,
    max: V2_CONFIG.sculpt.strengthMax,
    step: 0.01,
    label: "Strength",
  });
  brushFolder.addBinding(toolState.brush, "falloff", {
    min: 0.5,
    max: 4,
    step: 0.05,
    label: "Shape",
  });
  brushFolder.addBinding(toolState.brush, "previewShape", {
    label: "Preview shape",
    options: {
      Dome: "dome",
      Circle: "circle",
    },
  });

  /** Same hierarchy as `splatmap-chunks.html` → `environmentFolder` ("Lighting & atmosphere"). */
  const environmentFolder = pane.addFolder({
    title: "Lighting & atmosphere",
    expanded: false,
  });

  const sunExposureFolder = environmentFolder.addFolder({
    title: "Sun & exposure",
    expanded: false,
  });
  sunExposureFolder.addBinding(toolState.light, "sunAzimuth", {
    label: "Sun azimuth",
    min: 0,
    max: 360,
    step: 1,
  });
  sunExposureFolder.addBinding(toolState.light, "sunElevation", {
    label: "Sun elevation",
    min: -10,
    max: 90,
    step: 1,
  });
  sunExposureFolder.addBinding(toolState.light, "dirColor", {
    label: "Sun color",
    view: "color",
  });
  sunExposureFolder.addBinding(toolState.light, "dirIntensity", {
    label: "Sun intensity",
    min: 0,
    max: 5,
    step: 0.1,
  });
  sunExposureFolder.addBinding(toolState.light, "sunDistance", {
    label: "Sun distance",
    min: 200,
    max: 2000,
    step: 10,
  });
  sunExposureFolder.addBlade({ view: "separator" });
  sunExposureFolder.addBinding(toolState.light, "hemiSkyColor", {
    label: "Ambient sky",
    view: "color",
  });
  sunExposureFolder.addBinding(toolState.light, "hemiGroundColor", {
    label: "Ambient ground",
    view: "color",
  });
  sunExposureFolder.addBinding(toolState.light, "hemiIntensity", {
    label: "Ambient intensity",
    min: 0,
    max: 3,
    step: 0.1,
  });
  sunExposureFolder.addBlade({ view: "separator" });
  sunExposureFolder.addBinding(toolState.light, "envIntensity", {
    label: "Env map",
    min: 0,
    max: 2,
    step: 0.01,
  });
  sunExposureFolder.addBinding(toolState.light, "exposure", {
    label: "Exposure",
    min: 0.1,
    max: 2,
    step: 0.05,
  });
  sunExposureFolder.addBlade({ view: "separator" });

  const csmFolder = sunExposureFolder.addFolder({
    title: "Shadows (CSM)",
    expanded: false,
  });
  csmFolder
    .addBinding(toolState.csm, "enabled", { label: "CSM enabled" })
    .on("change", () => onCsmEnabledChange?.(toolState.csm.enabled));
  csmFolder.addBinding(toolState.csm, "updateEveryFrame", { label: "Update every frame" });
  csmFolder.addBinding(toolState.light, "shadowBias", {
    label: "Bias",
    min: -0.01,
    max: 0.001,
    step: 0.0001,
  });
  csmFolder.addBinding(toolState.light, "shadowNormalBias", {
    label: "Normal bias",
    min: 0,
    max: 0.2,
    step: 0.001,
  });
  csmFolder.addBinding(toolState.csm, "cascades", {
    label: "Cascades",
    min: 1,
    max: 4,
    step: 1,
  });
  csmFolder.addBinding(toolState.csm, "maxFar", {
    label: "Max far",
    min: 30,
    max: 600,
    step: 10,
  });
  csmFolder.addBinding(toolState.csm, "lightMargin", {
    label: "Light margin",
    min: 0,
    max: 400,
    step: 10,
  });
  csmFolder.addBinding(toolState.csm, "mapSize", {
    label: "Map size",
    min: 512,
    max: 4096,
    step: 512,
  });

  const lensFlareFolder = environmentFolder.addFolder({
    title: "Lens flare",
    expanded: false,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "enabled", { label: "Enabled" });
  lensFlareFolder.addBinding(toolState.lensFlare, "intensity", {
    label: "Master intensity",
    min: 0,
    max: 5,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "halationSize", {
    label: "Halation size",
    min: 0,
    max: 3,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "halationColor", {
    label: "Halation color",
    view: "color",
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "streakLength", {
    label: "Streak length",
    min: 0,
    max: 4,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "streakOpacity", {
    label: "Streak opacity",
    min: 0,
    max: 2,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "streakColor", {
    label: "Streak color",
    view: "color",
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "ghostOpacity", {
    label: "Ghost opacity",
    min: 0,
    max: 2,
    step: 0.05,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "ghostSpacing", {
    label: "Ghost spacing",
    min: 0,
    max: 2,
    step: 0.02,
  });
  lensFlareFolder.addBinding(toolState.lensFlare, "dirtOpacity", {
    label: "Lens dirt",
    min: 0,
    max: 2,
    step: 0.05,
  });

  const skyFolder = environmentFolder.addFolder({
    title: "Sky & fog",
    expanded: false,
  });
  const skyChange = () => onRebuildSkyEnv?.();
  skyFolder.addBinding(toolState.physicalSky, "meshScale", {
    label: "Dome scale",
    min: 2000,
    max: 20000,
    step: 100,
  }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "turbidity", { min: 0, max: 20, step: 0.1 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "rayleigh", { min: 0, max: 4, step: 0.05 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "mie", { min: 0, max: 0.1, step: 0.001 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "mieG", { min: 0, max: 1, step: 0.01 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "cloudCoverage", { min: 0, max: 1, step: 0.02 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "cloudDensity", { min: 0, max: 1, step: 0.02 }).on("change", skyChange);
  skyFolder.addBinding(toolState.physicalSky, "cloudElevation", { min: 0, max: 1, step: 0.02 }).on("change", skyChange);

  const fogFolder = skyFolder.addFolder({
    title: "Fog",
    expanded: false,
  });
  const hFogFolder = fogFolder.addFolder({
    title: "Height Fog",
    expanded: true,
  });
  hFogFolder
    .addBinding(toolState.fog.height, "enabled", { label: "Enabled" })
    .on("change", onFogChange);
  hFogFolder
    .addBinding(toolState.fog.height, "color", { label: "Color", view: "color" })
    .on("change", onFogChange);
  hFogFolder
    .addBinding(toolState.fog.height, "density", {
      label: "Density",
      min: 0.001,
      max: 0.3,
      step: 0.001,
    })
    .on("change", onFogChange);
  hFogFolder
    .addBinding(toolState.fog.height, "height", {
      label: "Base height",
      min: -60,
      max: 500,
      step: 1,
    })
    .on("change", onFogChange);

  const dFogFolder = fogFolder.addFolder({
    title: "Distance Fog",
    expanded: true,
  });
  dFogFolder
    .addBinding(toolState.fog.distance, "enabled", { label: "Enabled" })
    .on("change", onFogChange);
  dFogFolder
    .addBinding(toolState.fog.distance, "color", { label: "Color", view: "color" })
    .on("change", onFogChange);
  dFogFolder
    .addBinding(toolState.fog.distance, "density", {
      label: "Density",
      min: 0.0001,
      max: 0.05,
      step: 0.0001,
    })
    .on("change", onFogChange);

  const sculptFolder = pane.addFolder({ title: "Sculpt" });
  sculptFolder
    .addBinding(toolState, "sculptMode", {
      label: "Stamp",
      options: {
        "Brush (raise/lower)": "raiseLower",
        "FBM peak": "fbmPeak",
        Noise: "noise",
        Terrace: "terrace",
        "Flatten only": "flatten",
        Ramp: "ramp",
        Erosion: "erosion",
      },
    })
    .on("change", () => {
      sculptSystem.clearRampPoint();
      onRampCleared?.();
    });
  sculptFolder.addBinding(toolState, "raiseLowerStamp", {
    label: "Raise/lower stamp",
    options: {
      Smooth: "smooth",
      Plateau: "plateau",
      Crater: "crater",
    },
  });
  sculptFolder.addBinding(toolState.brush, "brushFalloff", {
    label: "Smooth falloff",
    options: {
      "Cosine (smooth)": "smooth",
      Linear: "linear",
      Sphere: "sphere",
      "Hard edge": "hard",
    },
    hint: "Only affects raise/lower 'Smooth' stamp — matches v1 brushFalloff.",
  });
  sculptFolder.addButton({ title: "Clear ramp start (R)" }).on("click", () => {
    sculptSystem.clearRampPoint();
    onRampCleared?.();
  });
  sculptFolder.addBlade({ view: "separator" });
  const enforceSculptClampGap = () => {
    const minV = config.sculpt.sculptClampMin;
    const maxV = config.sculpt.sculptClampMax;
    if (maxV < minV + 10) config.sculpt.sculptClampMax = minV + 10;
    if (minV > config.sculpt.sculptClampMax - 10) {
      config.sculpt.sculptClampMin = config.sculpt.sculptClampMax - 10;
    }
  };
  sculptFolder
    .addBinding(config.sculpt, "sculptClampMax", {
      label: "Max height (clamp)",
      min: 40,
      max: 4000,
      step: 10,
    })
    .on("change", () => {
      enforceSculptClampGap();
      pane.refresh();
      onConfigChanged?.();
    });
  sculptFolder
    .addBinding(config.sculpt, "sculptClampMin", {
      label: "Min height (floor)",
      min: -800,
      max: 3990,
      step: 5,
    })
    .on("change", () => {
      enforceSculptClampGap();
      pane.refresh();
      onConfigChanged?.();
    });
  const rampShapeFolder = sculptFolder.addFolder({
    title: "Ramp shape",
    expanded: false,
  });
  rampShapeFolder.addBinding(toolState.ramp, "crossExponent", {
    label: "Corridor edge",
    min: 0.5,
    max: 10,
    step: 0.05,
    hint: "Lower = wider flat strip; higher = steep sides (v1 = 2).",
  });
  rampShapeFolder.addBinding(toolState.ramp, "alongExponent", {
    label: "Grade curve",
    min: 0.25,
    max: 4,
    step: 0.05,
    hint: "1 = linear; >1 = flat start / steep end; <1 = steep start / flat end.",
  });
  sculptFolder.addBinding(toolState.brush, "spacingFactor", {
    min: 0.05,
    max: 1.0,
    step: 0.01,
    label: "Stroke spacing",
  });

  const terraceFolder = sculptFolder.addFolder({
    title: "Terrace stamp",
    expanded: false,
  });
  terraceFolder.addBinding(toolState.terrace, "step", {
    label: "Step height",
    min: 0.25,
    max: 30,
    step: 0.25,
    hint: "World-units between terrace plateaus (v1 PARAMS.terraceStep).",
  });
  terraceFolder.addBinding(toolState.terrace, "sharpness", {
    label: "Sharpness",
    min: 0.05,
    max: 0.95,
    step: 0.01,
    hint: "Higher = sharper step edges; lower = more ramp-like transitions.",
  });

  const noiseBrushFolder = sculptFolder.addFolder({
    title: "Noise stamp",
    expanded: false,
  });
  noiseBrushFolder.addBinding(toolState.noiseBrush, "noiseScale", {
    label: "Noise scale",
    min: 0.3,
    max: 10,
    step: 0.1,
  });
  noiseBrushFolder.addBinding(toolState.noiseBrush, "noiseOctaves", {
    label: "Noise octaves",
    min: 1,
    max: 8,
    step: 1,
  });

  const erosionBrushFolder = sculptFolder.addFolder({
    title: "Erosion brush",
    expanded: false,
  });
  erosionBrushFolder.addBinding(toolState.erosion, "erosionRate", {
    label: "Erode rate",
    min: 0.01,
    max: 1,
    step: 0.01,
  });
  erosionBrushFolder.addBinding(toolState.erosion, "depositionRate", {
    label: "Deposit rate",
    min: 0.01,
    max: 1,
    step: 0.01,
  });
  erosionBrushFolder.addBinding(toolState.erosion, "evaporation", {
    label: "Evaporation",
    min: 0,
    max: 0.1,
    step: 0.001,
  });
  erosionBrushFolder.addBinding(toolState.erosion, "inertia", {
    label: "Inertia",
    min: 0,
    max: 1,
    step: 0.01,
  });
  erosionBrushFolder.addBinding(toolState.erosion, "capacity", {
    label: "Capacity",
    min: 0.5,
    max: 20,
    step: 0.5,
  });
  erosionBrushFolder.addBinding(toolState.erosion, "radius", {
    label: "Kernel (grid)",
    min: 0.5,
    max: 12,
    step: 0.5,
  });
  erosionBrushFolder.addBlade({ view: "separator" });
  erosionBrushFolder.addBinding(toolState.erosion, "iterations", {
    label: "Global iterations",
    min: 500,
    max: 200000,
    step: 500,
    hint: "Droplet count for the whole-map erosion pass (brush ignores this).",
  });
  erosionBrushFolder
    .addButton({ title: "Run global erosion (all chunks)" })
    .on("click", () => onRunGlobalErosion?.());

  const fbmPeakFolder = sculptFolder.addFolder({
    title: "FBM peak stamp",
    expanded: false,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "freqMul", {
    label: "Detail scale",
    min: 0.25,
    max: 4,
    step: 0.05,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "octaves", {
    label: "Octaves",
    min: 1,
    max: 8,
    step: 1,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "spikePower", {
    label: "Radial falloff",
    min: 1,
    max: 5,
    step: 0.05,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "base", {
    label: "Base lift",
    min: 0,
    max: 1.2,
    step: 0.01,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "ridgeWeight", {
    label: "Ridge weight",
    min: 0,
    max: 4,
    step: 0.05,
  });
  fbmPeakFolder.addBinding(toolState.fbmPeak, "gain", {
    label: "Strength gain",
    min: 0.25,
    max: 6,
    step: 0.05,
  });

  const genFolder = sculptFolder.addFolder({
    title: "Procedural height (all chunks)",
    expanded: false,
  });
  genFolder.addBinding(toolState.gen, "mode", {
    label: "Mode",
    options: {
      "Ridge (sharp peaks)": "ridge",
      "FBM (rolling hills)": "fbm",
    },
  });
  genFolder.addBinding(toolState.gen, "scale", {
    label: "Scale",
    min: 0.5,
    max: 12,
    step: 0.1,
  });
  genFolder.addBinding(toolState.gen, "octaves", {
    label: "Octaves",
    min: 1,
    max: 8,
    step: 1,
  });
  genFolder.addBinding(toolState.gen, "height", {
    label: "Height",
    min: 10,
    max: 300,
    step: 1,
  });
  genFolder.addBinding(toolState.gen, "seed", {
    label: "Seed",
    min: 0,
    max: 999,
    step: 1,
  });
  genFolder.addBinding(toolState.gen, "domainWarp", {
    label: "Domain warp",
    min: 0,
    max: 2,
    step: 0.05,
  });
  genFolder.addBlade({ view: "separator" });
  genFolder.addBinding(toolState.gen, "dropoffShape", {
    label: "Edge shape",
    options: {
      Circle: "circle",
      "Ring (mountains at edge)": "ring",
      "Box (fills terrain)": "box",
      "Box ring (edges up)": "invertedBox",
      "Organic (noise edge)": "noise",
      "Organic ring (edges up)": "noiseRing",
    },
  });
  genFolder.addBinding(toolState.gen, "dropoff", {
    label: "Edge dropoff",
    min: 0.3,
    max: 4,
    step: 0.05,
  });
  genFolder.addBinding(toolState.gen, "offsetX", {
    label: "Offset X",
    min: -0.45,
    max: 0.45,
    step: 0.01,
  });
  genFolder.addBinding(toolState.gen, "offsetZ", {
    label: "Offset Z",
    min: -0.45,
    max: 0.45,
    step: 0.01,
  });
  genFolder.addBlade({ view: "separator" });
  genFolder.addBinding(toolState.gen, "plains", {
    label: "Plains",
    min: 0,
    max: 0.8,
    step: 0.01,
  });
  genFolder.addBinding(toolState.gen, "tiltX", {
    label: "Tilt X",
    min: -1,
    max: 1,
    step: 0.05,
  });
  genFolder.addBinding(toolState.gen, "tiltZ", {
    label: "Tilt Z",
    min: -1,
    max: 1,
    step: 0.05,
  });
  genFolder.addBinding(toolState.gen, "additive", {
    label: "Additive (layer on existing)",
  });
  genFolder
    .addButton({ title: "Generate terrain (all chunks)" })
    .on("click", () => onGenerateProceduralTerrain?.());

  const lodFolder = pane.addFolder({ title: "Terrain/LOD" });
  lodFolder
    .addBinding(config.lod, "enabled", { label: "LOD enabled" })
    .on("change", onConfigChanged);
  lodFolder
    .addBinding(config.lod, "activeRadiusInChunks", {
      label: "Active radius",
      min: 2,
      max: 20,
      step: 1,
    })
    .on("change", onConfigChanged);
  lodFolder
    .addBinding(config.lod, "hysteresis", {
      label: "Hysteresis",
      min: 0,
      max: 0.5,
      step: 0.01,
    })
    .on("change", onConfigChanged);

  const perfFolder = pane.addFolder({ title: "Perf Gate" });
  const perfView = {
    fps: "0.0",
    frameMs: "0.00",
    activeChunks: "0",
    queues: "0/0/0",
  };
  perfFolder.addBinding(perfView, "fps", { readonly: true, label: "FPS" });
  perfFolder.addBinding(perfView, "frameMs", { readonly: true, label: "Frame ms" });
  perfFolder.addBinding(perfView, "activeChunks", {
    readonly: true,
    label: "Active chunks",
  });
  perfFolder.addBinding(perfView, "queues", {
    readonly: true,
    label: "Queues C/R/U",
  });

  return {
    pane,
    propCallbacks,
    waterFolder,
    barrierFolder,
    /** Call after hotkey / wheel edits to `toolState.brush` so bindings stay in sync. */
    refreshBrush() {
      pane.refresh();
    },
    refreshPerf() {
      perfView.fps = perf.fps.toFixed(1);
      perfView.frameMs = perf.frameMs.toFixed(2);
      perfView.activeChunks = String(perf.activeChunks);
      perfView.queues = `${perf.queues.create}/${perf.queues.remesh}/${perf.queues.unload}`;
      perfFolder.refresh();
    },
    dispose() {
      pane.dispose();
    },
  };
}

