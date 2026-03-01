/**
 * Tweakpane UI for Grass v8 — builds the full pane from PARAMS and ctx callbacks/refs.
 * Export: setupTweakpaneUI(pane, PARAMS, ctx) → { bNear, bLod1, bLod2 } (for refresh in animation).
 */
export function setupTweakpaneUI(pane, PARAMS, ctx) {
  const {
    setNpcVisibility,
    water,
    bakeEnvMap,
    scatterMeshes,
    updateScatterPlacement,
    respawnTrees,
    birds,
    octahedralForest,
    hexToVec3,
    rebuildOctahedralForest,
    MAX_SCATTER_PER_TYPE,
    MAX_SCATTER_FLOWERS,
    MAX_TREES,
  } = ctx;

  const fShape = pane.addFolder({
    title: "Grass Shape",
    expanded: false,
  });
  fShape.addBinding(PARAMS, "grassWidth", {
    min: 0.02,
    max: 0.3,
    step: 0.01,
  });
  fShape.addBinding(PARAMS, "grassHeight", {
    min: 0.3,
    max: 4,
    step: 0.1,
  });
  fShape.addBinding(PARAMS, "gradientCurve", {
    min: 1,
    max: 8,
    step: 0.5,
  });
  fShape.addBinding(PARAMS, "lodDistance", { min: 10, max: 60, step: 1, label: "LOD distance (high-detail radius)" });
  fShape.addBinding(PARAMS, "maxDistance", {
    min: 30,
    max: 300,
    step: 10,
    label: "max draw distance",
  });
  fShape.addBinding(PARAMS, "lodBlendStart", {
    min: 0.2,
    max: 0.7,
    step: 0.05,
    label: "LOD blend width (lower = softer transition)",
  });
  fShape.addBinding(PARAMS, "nearRingExtent", {
    min: 1,
    max: 6,
    step: 1,
    label: "dense ring size (1=3×3 … 6=13×13 patches)",
  });
  fShape.addBinding(PARAMS, "nearFadeRange", {
    min: 1,
    max: 20,
    step: 1,
    label: "near ring fade width (world units)",
  });
  fShape.addBinding(PARAMS, "grassBladesRegular", {
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "blades regular (outer LOD, 0–1)",
  });
  fShape.addBinding(PARAMS, "grassBladesNear", {
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "blades near (dense ring, 0–1)",
  });
  const fCol = pane.addFolder({ title: "Colors", expanded: false });
  fCol.addBinding(PARAMS, "baseColor1", { view: "color" });
  fCol.addBinding(PARAMS, "baseColor2", { view: "color" });
  fCol.addBinding(PARAMS, "tipColor1", { view: "color" });
  fCol.addBinding(PARAMS, "tipColor2", { view: "color" });
  fCol.addBinding(PARAMS, "colorVariation", {
    min: 0,
    max: 1,
    step: 0.05,
  });
  fCol.addBinding(PARAMS, "lushColor", { view: "color" });
  fCol.addBinding(PARAMS, "bleachedColor", { view: "color" });
  const fSeason = pane.addFolder({
    title: "Seasonal Patches",
    expanded: false,
  });
  fSeason.addBinding(PARAMS, "seasonalEnabled");
  fSeason.addBinding(PARAMS, "seasonalStrength", {
    min: 0,
    max: 1,
    step: 0.05,
  });
  fSeason.addBinding(PARAMS, "seasonalScale", {
    min: 0.005,
    max: 0.1,
    step: 0.005,
  });
  fSeason.addBinding(PARAMS, "seasonalDryColor", { view: "color" });
  const fWind = pane.addFolder({ title: "Wind", expanded: false });
  fWind.addBinding(PARAMS, "windSpeed", {
    min: 0,
    max: 4,
    step: 0.1,
    label: "speed",
  });
  fWind.addBinding(PARAMS, "windStrength", {
    min: 0,
    max: 1.5,
    step: 0.05,
    label: "strength",
  });
  fWind.addBinding(PARAMS, "windWaveScale", {
    min: 0.01,
    max: 0.3,
    step: 0.01,
    label: "waveScale",
  });
  fWind.addBinding(PARAMS, "windDir", {
    min: 0,
    max: 6.28,
    step: 0.1,
    label: "direction",
  });
  fWind.addBinding(PARAMS, "windGust", {
    min: 0,
    max: 1,
    step: 0.05,
    label: "gustStrength",
  });
  fWind.addBinding(PARAMS, "windMicroSway", {
    min: 0,
    max: 0.5,
    step: 0.05,
    label: "microSway",
  });
  const fTrail = pane.addFolder({ title: "Trail", expanded: false });
  fTrail.addBinding(PARAMS, "trailEnabled");
  fTrail.addBinding(PARAMS, "trailCrushSpeed", {
    min: 0.05,
    max: 1,
    step: 0.05,
    label: "crushSpeed",
  });
  fTrail.addBinding(PARAMS, "trailGrowRate", {
    min: 0.001,
    max: 0.05,
    step: 0.001,
    label: "growRate",
  });
  fTrail.addBinding(PARAMS, "trailRadius", {
    min: 0.2,
    max: 3,
    step: 0.1,
    label: "radius",
  });
  const fChar = pane.addFolder({ title: "Character", expanded: false });
  fChar.addBinding(PARAMS, "characterHeight", {
    min: 1,
    max: 2.5,
    step: 0.05,
    label: "height (m)",
  });
  fChar.addBinding(PARAMS, "characterOffsetY", {
    min: -0.5,
    max: 0.5,
    step: 0.01,
    label: "feet offset",
  });
  fChar.addBinding(PARAMS, "capsuleRadius", {
    min: 0.2,
    max: 0.5,
    step: 0.02,
    label: "capsule radius",
  });
  const fPlayer = pane.addFolder({
    title: "Player & Camera",
    expanded: false,
  });
  fPlayer.addBinding(PARAMS, "interactionEnabled");
  fPlayer.addBinding(PARAMS, "interactionRange", {
    min: 0.5,
    max: 10,
    step: 0.5,
  });
  fPlayer.addBinding(PARAMS, "interactionStrength", {
    min: 0,
    max: 5,
    step: 0.25,
  });
  fPlayer.addBinding(PARAMS, "playerSpeed", {
    min: 1,
    max: 25,
    step: 0.5,
  });
  fPlayer.addBinding(PARAMS, "runSpeedMultiplier", {
    min: 1,
    max: 2.5,
    step: 0.05,
    label: "run speed ×",
  });
  fPlayer.addBinding(PARAMS, "crouchSpeedMultiplier", {
    min: 0.2,
    max: 1,
    step: 0.05,
    label: "crouch speed ×",
  });
  fPlayer.addBinding(PARAMS, "rollDashDistance", {
    min: 1,
    max: 10,
    step: 0.5,
    label: "roll dash",
  });
  fPlayer.addBinding(PARAMS, "jumpSpeed", {
    min: 3,
    max: 12,
    step: 0.5,
    label: "jump",
  });
  fPlayer.addBinding(PARAMS, "gravity", { min: 5, max: 25, step: 0.5 });
  fPlayer.addBinding(PARAMS, "camDist", {
    min: 3,
    max: 25,
    step: 0.5,
    label: "camDistance",
  });
  fPlayer.addBinding(PARAMS, "camHeight", {
    min: -2,
    max: 8,
    step: 0.25,
    label: "camHeight",
  });
  fPlayer.addBinding(PARAMS, "mouseSensitivity", {
    min: 0.0005,
    max: 0.01,
    step: 0.0005,
    label: "mouse sensitivity",
  });
  fPlayer.addBinding(PARAMS, "keyTurnSpeed", {
    min: 0.5,
    max: 5,
    step: 0.1,
    label: "arrow turn speed",
  });
  fPlayer.addBinding(PARAMS, "cameraMode", {
    options: { thirdPerson: "thirdPerson", orbit: "orbit" },
  });
  const fNpc = pane.addFolder({ title: "NPCs", expanded: false });
  fNpc
    .addBinding(PARAMS, "npcEnabled", { label: "enabled" })
    .on("change", () => setNpcVisibility(PARAMS.npcEnabled));
  const fAO = pane.addFolder({
    title: "AO (Ambient Occlusion)",
    expanded: false,
  });
  fAO.addBinding(PARAMS, "aoEnabled");
  fAO.addBinding(PARAMS, "aoIntensity", {
    min: 0,
    max: 2,
    step: 0.1,
    label: "intensity",
  });
  const fSSS = pane.addFolder({
    title: "Subsurface Scatter",
    expanded: false,
  });
  fSSS.addBinding(PARAMS, "bsEnabled");
  fSSS.addBinding(PARAMS, "bsIntensity", { min: 0, max: 2, step: 0.1 });
  fSSS.addBinding(PARAMS, "bsColor", { view: "color" });
  fSSS.addBinding(PARAMS, "bsPower", { min: 0.5, max: 5, step: 0.25 });
  fSSS.addBinding(PARAMS, "frontScatter", { min: 0, max: 1, step: 0.05 });
  fSSS.addBinding(PARAMS, "rimSSS", { min: 0, max: 1, step: 0.05 });
  const fSpec1 = pane.addFolder({
    title: "Specular V1 (Directional)",
    expanded: false,
  });
  fSpec1.addBinding(PARAMS, "specV1Enabled");
  fSpec1.addBinding(PARAMS, "specV1Intensity", { min: 0, max: 5, step: 0.25 });
  fSpec1.addBinding(PARAMS, "specV1Color", { view: "color" });
  fSpec1.addBinding(PARAMS, "specV1DirX", { min: -2, max: 2, step: 0.1, label: "dirX" });
  fSpec1.addBinding(PARAMS, "specV1DirY", { min: 0.1, max: 2, step: 0.05, label: "dirY" });
  fSpec1.addBinding(PARAMS, "specV1DirZ", { min: -2, max: 2, step: 0.1, label: "dirZ" });
  const fSpec2 = pane.addFolder({
    title: "Specular V2 (Glints)",
    expanded: false,
  });
  fSpec2.addBinding(PARAMS, "specV2Enabled");
  fSpec2.addBinding(PARAMS, "specV2Intensity", { min: 0, max: 4, step: 0.25 });
  fSpec2.addBinding(PARAMS, "specV2Color", { view: "color" });
  fSpec2.addBinding(PARAMS, "specV2DirX", { min: -2, max: 2, step: 0.1, label: "dirX" });
  fSpec2.addBinding(PARAMS, "specV2DirY", { min: 0.1, max: 2, step: 0.05, label: "dirY" });
  fSpec2.addBinding(PARAMS, "specV2DirZ", { min: -2, max: 2, step: 0.1, label: "dirZ" });
  fSpec2.addBinding(PARAMS, "specV2NoiseScale", { min: 0.5, max: 10, step: 0.5, label: "noiseScale" });
  fSpec2.addBinding(PARAMS, "specV2NoiseStr", { min: 0, max: 2, step: 0.1, label: "noiseStr" });
  fSpec2.addBinding(PARAMS, "specV2Power", { min: 2, max: 40, step: 1, label: "power" });
  fSpec2.addBinding(PARAMS, "specV2TipBias", { min: 0, max: 1, step: 0.1, label: "tipBias" });
  const fFog = pane.addFolder({ title: "Fog", expanded: false });
  fFog.addBinding(PARAMS, "fogEnabled");
  fFog.addBinding(PARAMS, "fogNear", { min: 0, max: 50, step: 1 });
  fFog.addBinding(PARAMS, "fogFar", { min: 10, max: 400, step: 10 });
  fFog.addBinding(PARAMS, "fogIntensity", { min: 0, max: 1, step: 0.05 });
  fFog.addBinding(PARAMS, "fogColor", { view: "color" });
  const fGround = pane.addFolder({ title: "Ground", expanded: false });
  fGround.addBinding(PARAMS, "groundVariation");
  fGround.addBinding(PARAMS, "groundBaseColor", { view: "color", label: "ground base color" });
  fGround.addBinding(PARAMS, "groundDirtColor", { view: "color" });
  fGround.addBinding(PARAMS, "grassSlopeMin", {
    min: 0.2,
    max: 1,
    step: 0.02,
    label: "grass slope min",
  });
  fGround.addBinding(PARAMS, "grassSlopeMax", {
    min: 0.2,
    max: 1,
    step: 0.02,
    label: "grass slope max",
  });
  fGround.addBinding(PARAMS, "grassAmount", {
    min: 0,
    max: 1,
    step: 0.05,
    label: "grass amount",
  });
  fGround.addBinding(PARAMS, "texTiling", {
    min: 10,
    max: 200,
    step: 5,
    label: "tex tiling",
  });
  const fTerrain = pane.addFolder({ title: "Terrain", expanded: true });
  fTerrain.addBinding(PARAMS, "terrainHeight", {
    min: 10,
    max: 80,
    step: 2,
    label: "height scale",
  });
  fTerrain.addBinding(PARAMS, "mountainStrength", {
    min: 0,
    max: 1,
    step: 0.05,
    label: "mountains",
  });
  fTerrain.addBinding(PARAMS, "fieldFlatten", {
    min: 0,
    max: 0.8,
    step: 0.05,
    label: "field flatten",
  });
  fTerrain.addBinding(PARAMS, "lakeCenterX", {
    min: -350,
    max: 350,
    step: 10,
    label: "lake X",
  });
  fTerrain.addBinding(PARAMS, "lakeCenterZ", {
    min: -350,
    max: 350,
    step: 10,
    label: "lake Z",
  });
  fTerrain.addBinding(PARAMS, "lakeRadius", {
    min: 20,
    max: 120,
    step: 2,
    label: "lake radius",
  });
  fTerrain.addBinding(PARAMS, "lakeDepth", {
    min: 5,
    max: 35,
    step: 1,
    label: "lake depth",
  });
  fTerrain.addBinding(PARAMS, "waterLevel", {
    min: -5,
    max: 15,
    step: 0.5,
    label: "water level",
  });

  const fWater = pane.addFolder({ title: "Water", expanded: false });
  const fWaves = fWater.addFolder({ title: "Waves", expanded: true });
  fWaves
    .addBinding(PARAMS, "waterSpeed", {
      min: 0.01,
      max: 0.3,
      step: 0.01,
      label: "speed",
    })
    .on("change", () => (water.uWaterSpeed.value = PARAMS.waterSpeed));
  fWaves
    .addBinding(PARAMS, "waterNormalScale", {
      min: 0.01,
      max: 0.3,
      step: 0.01,
      label: "normal scale",
    })
    .on("change", () => (water.uWaterNormalScale.value = PARAMS.waterNormalScale));
  fWaves
    .addBinding(PARAMS, "waterUvScale", {
      min: 0.5,
      max: 10,
      step: 0.1,
      label: "UV scale",
    })
    .on("change", () => (water.uWaterUvScale.value = PARAMS.waterUvScale));

  const fHighlights = fWater.addFolder({
    title: "Highlights",
    expanded: true,
  });
  fHighlights
    .addBinding(PARAMS, "waterShininess", {
      min: 50,
      max: 2000,
      step: 10,
      label: "shininess",
    })
    .on("change", () => (water.uWaterShininess.value = PARAMS.waterShininess));
  fHighlights
    .addBinding(PARAMS, "waterHighlightsGlow", {
      min: 0.5,
      max: 10,
      step: 0.1,
      label: "glow",
    })
    .on("change", () => (water.uWaterHighlightsGlow.value = PARAMS.waterHighlightsGlow));
  fHighlights
    .addBinding(PARAMS, "waterHighlightFresnelInfluence", {
      min: 0,
      max: 1,
      step: 0.05,
      label: "fresnel influence",
    })
    .on("change", () => (water.uWaterHighlightFresnelInfluence.value = PARAMS.waterHighlightFresnelInfluence));
  fHighlights
    .addBinding(PARAMS, "waterSunColor", {
      view: "color",
      label: "sun color",
    })
    .on("change", () =>
      water.uWaterSunColor.value
        .set(PARAMS.waterSunColor)
        .convertSRGBToLinear(),
    );
  fHighlights
    .addBinding(PARAMS, "waterHighlightsSpread", {
      min: 0.1,
      max: 1,
      step: 0.05,
      label: "spread",
    })
    .on("change", () => (water.uWaterHighlightsSpread.value = PARAMS.waterHighlightsSpread));

  const fWaterColors = fWater.addFolder({
    title: "Colors",
    expanded: true,
  });
  fWaterColors
    .addBinding(PARAMS, "waterDeepColor", {
      view: "color",
      label: "deep color",
    })
    .on("change", () =>
      water.uWaterDeepColor.value
        .set(PARAMS.waterDeepColor)
        .convertSRGBToLinear(),
    );
  fWaterColors
    .addBinding(PARAMS, "waterShallowColor", {
      view: "color",
      label: "shallow color",
    })
    .on("change", () =>
      water.uWaterShallowColor.value
        .set(PARAMS.waterShallowColor)
        .convertSRGBToLinear(),
    );
  fWaterColors
    .addBinding(PARAMS, "waterFresnelScale", {
      min: 0,
      max: 2,
      step: 0.05,
      label: "fresnel scale",
    })
    .on("change", () => (water.uWaterFresnelScale.value = PARAMS.waterFresnelScale));
  fWaterColors
    .addBinding(PARAMS, "waterMinOpacity", {
      min: 0,
      max: 1,
      step: 0.05,
      label: "opacity",
    })
    .on("change", () => (water.uWaterMinOpacity.value = PARAMS.waterMinOpacity));

  const fSun = pane.addFolder({
    title: "Sun & Lighting",
    expanded: false,
  });
  fSun
    .addBinding(PARAMS, "sunDirX", { min: -2, max: 2, step: 0.1 })
    .on("change", bakeEnvMap);
  fSun
    .addBinding(PARAMS, "sunDirY", { min: 0.1, max: 2, step: 0.05 })
    .on("change", bakeEnvMap);
  fSun
    .addBinding(PARAMS, "sunDirZ", { min: -2, max: 2, step: 0.1 })
    .on("change", bakeEnvMap);
  fSun.addBinding(PARAMS, "sunIntensity", {
    min: 0.5,
    max: 5,
    step: 0.25,
  });
  fSun.addBinding(PARAMS, "sceneAmbient", {
    min: 0,
    max: 4,
    step: 0.1,
    label: "ambientLight",
  });
  fSun.addBinding(PARAMS, "exposure", { min: 0.2, max: 2, step: 0.05 });
  fSun.addBinding(PARAMS, "environmentIntensity", {
    min: 0.1,
    max: 1.5,
    step: 0.05,
    label: "env intensity",
  });
  const fPost = pane.addFolder({
    title: "Post Processing",
    expanded: false,
  });
  fPost.addBinding(PARAMS, "postProcessingEnabled", { label: "enabled" });
  const fLensflare = fPost.addFolder({
    title: "Lens flare",
    expanded: false,
  });
  fLensflare.addBinding(PARAMS, "lensflareEnabled", { label: "enabled" });
  fLensflare.addBinding(PARAMS, "lensflareBloomThreshold", {
    min: 0.3,
    max: 0.95,
    step: 0.02,
    label: "bloom threshold",
  });
  fLensflare.addBinding(PARAMS, "lensflareThreshold", {
    min: 0.2,
    max: 0.9,
    step: 0.05,
    label: "threshold",
  });
  fLensflare.addBinding(PARAMS, "lensflareGhostAttenuation", {
    min: 10,
    max: 50,
    step: 1,
    label: "ghost attenuation",
  });
  fLensflare.addBinding(PARAMS, "lensflareGhostSpacing", {
    min: 0.05,
    max: 0.5,
    step: 0.01,
    label: "ghost spacing",
  });
  const fSky = pane.addFolder({ title: "Sky", expanded: false });
  fSky
    .addBinding(PARAMS, "skyTurbidity", {
      min: 0,
      max: 20,
      step: 0.5,
      label: "turbidity",
    })
    .on("change", bakeEnvMap);
  fSky
    .addBinding(PARAMS, "skyRayleigh", {
      min: 0,
      max: 4,
      step: 0.1,
      label: "rayleigh",
    })
    .on("change", bakeEnvMap);
  fSky
    .addBinding(PARAMS, "skyMie", {
      min: 0,
      max: 0.1,
      step: 0.001,
      label: "mieCoeff",
    })
    .on("change", bakeEnvMap);
  fSky
    .addBinding(PARAMS, "skyMieG", {
      min: 0,
      max: 1,
      step: 0.05,
      label: "mieDirectional",
    })
    .on("change", bakeEnvMap);
  const fPhysics = pane.addFolder({ title: "Physics", expanded: false });
  fPhysics.addBinding(PARAMS, "rapierDebug", {
    label: "Rapier debug (colliders)",
  });
  const fScene = pane.addFolder({
    title: "Scene (FPS debug)",
    expanded: false,
  });
  fScene.addBinding(PARAMS, "showRuins", { label: "Ruins" });
  fScene.addBinding(PARAMS, "showChurch", { label: "Church" });
  fScene.addBinding(PARAMS, "showWater", { label: "Water" });
  fScene.addBinding(PARAMS, "churchX", {
    min: -200,
    max: 200,
    step: 1,
    label: "Church X",
  });
  fScene.addBinding(PARAMS, "churchZ", {
    min: -200,
    max: 200,
    step: 1,
    label: "Church Z",
  });
  fScene.addBinding(PARAMS, "churchScale", {
    min: 0.1,
    max: 10,
    step: 0.1,
    label: "Church Scale",
  });
  fScene.addBinding(PARAMS, "churchYOffset", {
    min: -10,
    max: 10,
    step: 0.1,
    label: "Church Y Offset",
  });
  fScene.addBinding(PARAMS, "showTrees", { label: "Trees" });
  fScene.addBinding(PARAMS, "showFluffyTree", { label: "Fluffy Tree" });
  fScene
    .addBinding(PARAMS, "showCastle", { label: "Castle" })
    .on("change", () => {
      if (PARAMS.showCastle && ctx.ensureCastleCreated) ctx.ensureCastleCreated();
    });

  const fScatter = pane.addFolder({
    title: "Scatter (rocks)",
    expanded: false,
  });
  fScatter.addBinding(PARAMS, "showScatter", { label: "visible" });
  fScatter
    .addBinding(PARAMS, "scatterCastShadow", { label: "cast shadow" })
    .on("change", () => {
      if (scatterMeshes.boulder) {
        scatterMeshes.boulder.near.castShadow = PARAMS.scatterCastShadow;
        scatterMeshes.boulder.near.receiveShadow = PARAMS.scatterCastShadow;
      }
      if (scatterMeshes.gameAsset) {
        scatterMeshes.gameAsset.near.castShadow = PARAMS.scatterCastShadow;
        scatterMeshes.gameAsset.near.receiveShadow = PARAMS.scatterCastShadow;
      }
    });
  fScatter
    .addBinding(PARAMS, "scatterScaleVariation", {
      min: 0,
      max: 1,
      step: 0.05,
      label: "scale variation",
    })
    .on("change", () => {
      updateScatterPlacement("boulder");
      updateScatterPlacement("gameAsset");
    });
  fScatter
    .addBinding(PARAMS, "scatterInnerRadius", {
      min: 0,
      max: 80,
      step: 1,
      label: "inner radius (no placement)",
    })
    .on("change", () => {
      updateScatterPlacement("boulder");
      updateScatterPlacement("gameAsset");
    });
  fScatter.addBinding(PARAMS, "scatterLodDistance", {
    min: 10,
    max: 150,
    step: 5,
    label: "LOD distance (shadows within)",
  });
  fScatter.addBinding(PARAMS, "scatterCulling", {
    label: "frustum culling",
  });
  const fScatterBoulder = fScatter.addFolder({
    title: "Boulder",
    expanded: false,
  });
  fScatterBoulder
    .addBinding(PARAMS, "scatterBoulderScale", {
      min: 0.002,
      max: 0.5,
      step: 0.002,
      label: "scale",
    })
    .on("change", () => updateScatterPlacement("boulder"));
  fScatterBoulder
    .addBinding(PARAMS, "scatterBoulderCount", {
      min: 0,
      max: MAX_SCATTER_PER_TYPE,
      step: 100,
      label: "count",
    })
    .on("change", () => updateScatterPlacement("boulder"));
  const fScatterGameAsset = fScatter.addFolder({
    title: "Game asset rock",
    expanded: false,
  });
  fScatterGameAsset
    .addBinding(PARAMS, "scatterGameAssetScale", {
      min: 0.02,
      max: 2,
      step: 0.01,
      label: "scale",
    })
    .on("change", () => updateScatterPlacement("gameAsset"));
  fScatterGameAsset
    .addBinding(PARAMS, "scatterGameAssetCount", {
      min: 0,
      max: MAX_SCATTER_PER_TYPE,
      step: 100,
      label: "count",
    })
    .on("change", () => updateScatterPlacement("gameAsset"));
  const fScatterFlower = fScatter.addFolder({
    title: "Flowers",
    expanded: false,
  });
  fScatterFlower
    .addBinding(PARAMS, "scatterFlowerScale", {
      min: 0.02,
      max: 1.5,
      step: 0.01,
      label: "scale",
    })
    .on("change", () => updateScatterPlacement("flower"));
  fScatterFlower
    .addBinding(PARAMS, "scatterFlowerCount", {
      min: 0,
      max: MAX_SCATTER_FLOWERS,
      step: 500,
      label: "count",
    })
    .on("change", () => updateScatterPlacement("flower"));

  const fTrees = pane.addFolder({
    title: "Trees (leaves)",
    expanded: false,
  });
  fTrees.addBinding(PARAMS, "treeCount", {
    min: 100,
    max: MAX_TREES,
    step: 100,
    label: "count",
  });
  fTrees
    .addButton({ title: "↺ respawn trees" })
    .on("click", respawnTrees);
  fTrees.addBinding(PARAMS, "treeScale", {
    min: 0.1,
    max: 50,
    step: 0.1,
    label: "scale",
  });
  fTrees.addBinding(PARAMS, "treeAlphaTest", {
    min: 0,
    max: 1,
    step: 0.02,
    label: "alpha test (lower = more leaves)",
  });
  fTrees.addBinding(PARAMS, "treeOpacity", {
    min: 0,
    max: 1,
    step: 0.05,
    label: "opacity",
  });
  fTrees.addBinding(PARAMS, "treeDepthWrite", {
    label: "depth write (on = correct occlusion)",
  });
  fTrees.addBinding(PARAMS, "treeCulling", {
    label: "frustum culling",
  });

  const fBirds = pane.addFolder({ title: "Birds", expanded: false });
  const bp = birds.params;
  fBirds
    .addBinding(PARAMS, "birdsEnabled", { label: "enabled" })
    .on("change", () => {
      birds.mesh.visible = PARAMS.birdsEnabled;
    });
  fBirds
    .addBinding(PARAMS, "birdsCount", {
      min: 64,
      max: birds.MAX_BIRDS,
      step: 64,
      label: "count",
    })
    .on("change", () => {
      const n = Math.min(PARAMS.birdsCount, birds.MAX_BIRDS);
      birds.mesh.count = n;
      bp.uBirdCount.value = n;
    });
  fBirds
    .addBinding(PARAMS, "birdsCenterY", {
      min: 10,
      max: 150,
      step: 1,
      label: "altitude center",
    })
    .on("change", () => {
      bp.uCenterY.value = PARAMS.birdsCenterY;
    });
  fBirds
    .addBinding(PARAMS, "birdsMinY", {
      min: 50,
      max: 120,
      step: 1,
      label: "min altitude",
    })
    .on("change", () => {
      bp.uMinY.value = PARAMS.birdsMinY;
    });
  fBirds
    .addBinding(PARAMS, "birdsMaxY", {
      min: 10,
      max: 200,
      step: 1,
      label: "max altitude",
    })
    .on("change", () => {
      bp.uMaxY.value = PARAMS.birdsMaxY;
    });
  fBirds
    .addBinding(PARAMS, "birdsSeparation", {
      min: 1,
      max: 60,
      step: 0.5,
      label: "separation zone",
    })
    .on("change", () => {
      bp.uSeparation.value = PARAMS.birdsSeparation;
    });
  fBirds
    .addBinding(PARAMS, "birdsAlignment", {
      min: 1,
      max: 60,
      step: 0.5,
      label: "alignment zone",
    })
    .on("change", () => {
      bp.uAlignment.value = PARAMS.birdsAlignment;
    });
  fBirds
    .addBinding(PARAMS, "birdsCohesion", {
      min: 1,
      max: 60,
      step: 0.5,
      label: "cohesion zone",
    })
    .on("change", () => {
      bp.uCohesion.value = PARAMS.birdsCohesion;
    });

  const fOctahedralForest = pane.addFolder({
    title: "Octahedral forest",
    expanded: false,
  });
  fOctahedralForest
    .addBinding(PARAMS, "octahedralForestEnabled", { label: "enabled" })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.group.visible = PARAMS.octahedralForestEnabled;
    });
  fOctahedralForest
    .addBinding(PARAMS, "octahedralForestScale", {
      min: 0.2,
      max: 2,
      step: 0.05,
      label: "scale",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.group.scale.setScalar(PARAMS.octahedralForestScale);
    });
  fOctahedralForest
    .addBinding(PARAMS, "octahedralForestAlphaClamp", {
      min: 0.01,
      max: 0.5,
      step: 0.01,
      label: "impostor alpha (LOD1/2)",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setAlphaClamp(PARAMS.octahedralForestAlphaClamp);
    });
  fOctahedralForest
    .addBinding(PARAMS, "octahedralForestLod0Alpha", {
      min: 0.01,
      max: 0.5,
      step: 0.01,
      label: "LOD0 alpha (real mesh)",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setLod0AlphaTest(PARAMS.octahedralForestLod0Alpha);
    });

  const fLod = fOctahedralForest.addFolder({
    title: "LOD Distances",
    expanded: false,
  });
  fLod
    .addBinding(PARAMS, "octahedralForestLodDist", {
      min: 10,
      max: 120,
      step: 1,
      label: "LOD0→LOD1 dist",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setLodDistance(PARAMS.octahedralForestLodDist);
    });
  fLod
    .addBinding(PARAMS, "octahedralForestLod2Dist", {
      min: 80,
      max: 400,
      step: 5,
      label: "LOD1→LOD2 dist",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setLod2Distance(PARAMS.octahedralForestLod2Dist);
    });
  fLod
    .addBinding(PARAMS, "octahedralForestFadeRange", {
      min: 1,
      max: 20,
      step: 0.5,
      label: "fade range",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setFadeRange(PARAMS.octahedralForestFadeRange);
    });

  const fForestLight = fOctahedralForest.addFolder({
    title: "Lighting",
    expanded: false,
  });
  fForestLight
    .addBinding(PARAMS, "octahedralForestSunColor", {
      view: "color",
      label: "sun color",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.updateSunColor(
          hexToVec3(PARAMS.octahedralForestSunColor),
        );
    });
  fForestLight
    .addBinding(PARAMS, "octahedralForestAmbColor", {
      view: "color",
      label: "ambient color",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.updateAmbColor(
          hexToVec3(PARAMS.octahedralForestAmbColor),
        );
    });
  fForestLight
    .addBinding(PARAMS, "octahedralForestLightScale", {
      min: 0.5,
      max: 3.0,
      step: 0.05,
      label: "light scale (brightness)",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setLightScale(PARAMS.octahedralForestLightScale);
    });

  const fForestWind = fOctahedralForest.addFolder({
    title: "Wind",
    expanded: false,
  });
  fForestWind
    .addBinding(PARAMS, "octahedralForestWindStrength", {
      min: 0,
      max: 1.5,
      step: 0.05,
      label: "strength",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setWindStrength(
          PARAMS.octahedralForestWindStrength,
        );
    });
  fForestWind
    .addBinding(PARAMS, "octahedralForestWindSpeed", {
      min: 0.1,
      max: 3.0,
      step: 0.1,
      label: "speed",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setWindSpeed(PARAMS.octahedralForestWindSpeed);
    });
  fForestWind
    .addBinding(PARAMS, "octahedralForestWindDirX", {
      min: -1,
      max: 1,
      step: 0.1,
      label: "direction X",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setWindDirection(
          PARAMS.octahedralForestWindDirX,
          PARAMS.octahedralForestWindDirZ,
        );
    });
  fForestWind
    .addBinding(PARAMS, "octahedralForestWindDirZ", {
      min: -1,
      max: 1,
      step: 0.1,
      label: "direction Z",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setWindDirection(
          PARAMS.octahedralForestWindDirX,
          PARAMS.octahedralForestWindDirZ,
        );
    });

  const fForestDebug = fOctahedralForest.addFolder({
    title: "Debug",
    expanded: false,
  });
  fForestDebug
    .addBinding(PARAMS, "octahedralForestLod0Vis", {
      label: "LOD0 (real mesh)",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setLodVisible(0, PARAMS.octahedralForestLod0Vis);
    });
  fForestDebug
    .addBinding(PARAMS, "octahedralForestLod1Vis", {
      label: "LOD1 (impostor)",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setLodVisible(1, PARAMS.octahedralForestLod1Vis);
    });
  fForestDebug
    .addBinding(PARAMS, "octahedralForestLod2Vis", {
      label: "LOD2 (mega)",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setLodVisible(2, PARAMS.octahedralForestLod2Vis);
    });
  fForestDebug
    .addBinding(PARAMS, "octahedralForestWireframe", {
      label: "wireframe (plane)",
    })
    .on("change", () => {
      if (octahedralForest)
        octahedralForest.setWireframeVisible(
          PARAMS.octahedralForestWireframe,
        );
    });
  const bNear = fForestDebug.addBinding(
    PARAMS,
    "octahedralForestNearCount",
    { readonly: true, label: "near count" },
  );
  const bLod1 = fForestDebug.addBinding(
    PARAMS,
    "octahedralForestLod1Count",
    { readonly: true, label: "LOD1 count" },
  );
  const bLod2 = fForestDebug.addBinding(
    PARAMS,
    "octahedralForestLod2Count",
    { readonly: true, label: "LOD2 count" },
  );

  const fAtlas = fOctahedralForest.addFolder({
    title: "Atlas Quality (rebuild)",
    expanded: false,
  });
  fAtlas.addBinding(PARAMS, "octahedralForestSprites", {
    label: "sprites/side",
    options: { "4 (low)": 4, "8 (medium)": 8, "16 (high)": 16 },
  });
  fAtlas.addBinding(PARAMS, "octahedralForestTexSize", {
    label: "texture size",
    options: { 1024: 1024, 2048: 2048, 4096: 4096 },
  });
  fAtlas.addBinding(PARAMS, "octahedralForestBakeSingle", {
    label: "bake single (largest mesh)",
  });
  fAtlas
    .addButton({ title: "↺ Rebuild Atlas" })
    .on("click", rebuildOctahedralForest);

  const fForestRebuild = fOctahedralForest.addFolder({
    title: "Model / Forest (rebuild)",
    expanded: false,
  });
  fForestRebuild.addBinding(PARAMS, "octahedralForestModelPath", {
    label: "model path",
  });
  fForestRebuild.addBinding(PARAMS, "octahedralForestTreeCount", {
    min: 200,
    max: 5000,
    step: 100,
    label: "tree count",
  });
  fForestRebuild.addBinding(PARAMS, "octahedralForestTreeScale", {
    min: 0.5,
    max: 5,
    step: 0.1,
    label: "tree scale",
  });
  fForestRebuild
    .addButton({ title: "↺ Rebuild Forest" })
    .on("click", rebuildOctahedralForest);

  const fShadows = pane.addFolder({ title: "Shadows", expanded: false });
  fShadows.addBinding(PARAMS, "shadowBias", {
    min: -0.01,
    max: 0.01,
    step: 0.0005,
    label: "bias",
  });
  fShadows.addBinding(PARAMS, "shadowNormalBias", {
    min: 0,
    max: 0.2,
    step: 0.01,
    label: "normal bias",
  });

  return { bNear, bLod1, bLod2 };
}
