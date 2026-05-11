import { ROAD_PROFILES } from "../core/road/roadNetworkLabGeometry.js";

/** Road Accessories + Road Decals — shared by Full Road and Smart Road tweakpanes. */
function addRoadAccessoriesAndDecalsFolders(folder, rp, {
  onAccessoryTypeChanged,
  onAccessoryParamsChanged,
  onAccessoryClearAll,
  onDecalModeToggle,
  onDecalTransformModeChanged,
  onDecalDeleteSelected,
  onDecalTypeChanged,
  onDecalParamsChanged,
  onDecalClearAll,
}) {
  const accFolder = folder.addFolder({ title: "Road Accessories", expanded: false });
  accFolder.addBinding(rp, "accessoryType", {
    label: "Type",
    options: { Guardrail: "guardrail", Kerb: "kerb", Barrier: "barrier", Fence: "fence", Tunnel: "tunnel" },
  }).on("change", () => onAccessoryTypeChanged?.());

  const paintFolder = accFolder.addFolder({ title: "Click-drag paint on road", expanded: false });
  paintFolder.addBinding(rp, "guardrailMode", { label: "Guardrail (Shift+drag still works)" }).on("change", () => onAccessoryParamsChanged?.());
  paintFolder.addBinding(rp, "kerbMode", { label: "Kerb (Shift+drag still works)" }).on("change", () => onAccessoryParamsChanged?.());
  paintFolder.addBinding(rp, "barrierMode", { label: "Barrier (Shift+drag still works)" }).on("change", () => onAccessoryParamsChanged?.());
  paintFolder.addBinding(rp, "fenceMode", { label: "Fence (Shift+drag still works)" }).on("change", () => onAccessoryParamsChanged?.());

  const grFolder = accFolder.addFolder({ title: "Guardrail Settings", expanded: false });
  grFolder.addBinding(rp, "guardrailSide", { label: "Side", options: { Left: "left", Right: "right", Auto: "auto" } }).on("change", () => onAccessoryParamsChanged?.());
  grFolder.addBinding(rp, "guardrailEdgeOffset", { label: "Edge offset", min: 0, max: 3, step: 0.05 }).on("change", () => onAccessoryParamsChanged?.());
  grFolder.addBinding(rp, "guardrailHeight", { label: "Height", min: 0.1, max: 2, step: 0.05 }).on("change", () => onAccessoryParamsChanged?.());
  grFolder.addBinding(rp, "guardrailDepth", { label: "Depth", min: 0.05, max: 1, step: 0.02 }).on("change", () => onAccessoryParamsChanged?.());
  grFolder.addBinding(rp, "guardrailRailYOffset", { label: "Rail Y offset", min: 0, max: 2, step: 0.05 }).on("change", () => onAccessoryParamsChanged?.());
  grFolder.addBinding(rp, "guardrailPostSpacing", { label: "Post spacing", min: 0.5, max: 8, step: 0.25 }).on("change", () => onAccessoryParamsChanged?.());
  grFolder.addBinding(rp, "guardrailColor", { label: "Color", view: "color" }).on("change", () => onAccessoryParamsChanged?.());

  const kerbFolder = accFolder.addFolder({ title: "Kerb Settings", expanded: false });
  kerbFolder.addBinding(rp, "kerbSide", { label: "Side", options: { Left: "left", Right: "right", Auto: "auto" } }).on("change", () => onAccessoryParamsChanged?.());
  kerbFolder.addBinding(rp, "kerbEdgeOffset", { label: "Edge offset", min: -1, max: 2, step: 0.05 }).on("change", () => onAccessoryParamsChanged?.());
  kerbFolder.addBinding(rp, "kerbWidth", { label: "Width", min: 0.2, max: 2, step: 0.05 }).on("change", () => onAccessoryParamsChanged?.());
  kerbFolder.addBinding(rp, "kerbHeight", { label: "Height", min: 0.02, max: 0.5, step: 0.01 }).on("change", () => onAccessoryParamsChanged?.());
  kerbFolder.addBinding(rp, "kerbLipHeight", { label: "Lip height", min: 0, max: 0.2, step: 0.005 }).on("change", () => onAccessoryParamsChanged?.());
  kerbFolder.addBinding(rp, "kerbStripeLength", { label: "Stripe length", min: 0.2, max: 3, step: 0.1 }).on("change", () => onAccessoryParamsChanged?.());
  kerbFolder.addBinding(rp, "kerbColorA", { label: "Color A", view: "color" }).on("change", () => onAccessoryParamsChanged?.());
  kerbFolder.addBinding(rp, "kerbColorB", { label: "Color B", view: "color" }).on("change", () => onAccessoryParamsChanged?.());

  const barrierFolder = accFolder.addFolder({ title: "Barrier Settings", expanded: false });
  barrierFolder.addBinding(rp, "barrierSide", { label: "Side", options: { Left: "left", Right: "right", Auto: "auto" } }).on("change", () => onAccessoryParamsChanged?.());
  barrierFolder.addBinding(rp, "barrierEdgeOffset", { label: "Edge offset", min: 0, max: 4, step: 0.1 }).on("change", () => onAccessoryParamsChanged?.());
  barrierFolder.addBinding(rp, "barrierHeight", { label: "Height", min: 0.3, max: 1.5, step: 0.05 }).on("change", () => onAccessoryParamsChanged?.());
  barrierFolder.addBinding(rp, "barrierTopWidth", { label: "Top width", min: 0.05, max: 0.5, step: 0.02 }).on("change", () => onAccessoryParamsChanged?.());
  barrierFolder.addBinding(rp, "barrierBottomWidth", { label: "Bottom width", min: 0.2, max: 1, step: 0.02 }).on("change", () => onAccessoryParamsChanged?.());
  barrierFolder.addBinding(rp, "barrierColor", { label: "Color", view: "color" }).on("change", () => onAccessoryParamsChanged?.());

  const fenceFolder = accFolder.addFolder({ title: "Fence Settings", expanded: false });
  fenceFolder.addBinding(rp, "fenceSide", { label: "Side", options: { Left: "left", Right: "right", Auto: "auto" } }).on("change", () => onAccessoryParamsChanged?.());
  fenceFolder.addBinding(rp, "fenceEdgeOffset", { label: "Edge offset", min: 0, max: 5, step: 0.1 }).on("change", () => onAccessoryParamsChanged?.());
  fenceFolder.addBinding(rp, "fenceHeight", { label: "Height", min: 0.5, max: 3, step: 0.1 }).on("change", () => onAccessoryParamsChanged?.());
  fenceFolder.addBinding(rp, "fencePostSpacing", { label: "Post spacing", min: 1, max: 6, step: 0.25 }).on("change", () => onAccessoryParamsChanged?.());
  fenceFolder.addBinding(rp, "fenceRailCount", { label: "Rail count", min: 1, max: 6, step: 1 }).on("change", () => onAccessoryParamsChanged?.());
  fenceFolder.addBinding(rp, "fenceColor", { label: "Color", view: "color" }).on("change", () => onAccessoryParamsChanged?.());

  const tunnelFolder = accFolder.addFolder({ title: "Tunnel Settings", expanded: false });
  tunnelFolder.addBinding(rp, "tunnelMode", { label: "Paint mode (Shift+drag still works)" }).on("change", () => onAccessoryParamsChanged?.());
  tunnelFolder.addBinding(rp, "tunnelRadius", { label: "Radius", min: 1, max: 20, step: 0.25 }).on("change", () => onAccessoryParamsChanged?.());
  tunnelFolder.addBinding(rp, "tunnelYOffset", { label: "Y offset", min: -5, max: 10, step: 0.1 }).on("change", () => onAccessoryParamsChanged?.());
  tunnelFolder.addBinding(rp, "tunnelRadialSegments", { label: "Radial segs", min: 6, max: 48, step: 1 }).on("change", () => onAccessoryParamsChanged?.());
  tunnelFolder.addBinding(rp, "tunnelPathSegments", { label: "Path segs", min: 32, max: 400, step: 4 }).on("change", () => onAccessoryParamsChanged?.());
  tunnelFolder.addBinding(rp, "tunnelColor", { label: "Color", view: "color" }).on("change", () => onAccessoryParamsChanged?.());

  accFolder.addButton({ title: "Clear all accessories" }).on("click", () => onAccessoryClearAll?.());

  const decalFolder = folder.addFolder({ title: "Road Decals", expanded: false });
  decalFolder.addBinding(rp, "decalMode", { label: "Decal mode" }).on("change", () => onDecalModeToggle?.());
  decalFolder.addBinding(rp, "decalTransformMode", {
    label: "Gizmo mode",
    options: { Translate: "translate", Rotate: "rotate" },
  }).on("change", () => onDecalTransformModeChanged?.());
  decalFolder.addButton({ title: "Delete selected decal" }).on("click", () => onDecalDeleteSelected?.());
  decalFolder.addBinding(rp, "decalType", {
    label: "Type",
    options: {
      "Zebra Crossing": "zebraCrossing",
      "Ladder Crossing": "ladderCrossing",
      "Stop Line": "stopLine",
      "Arrow ↑": "arrowStraight",
      "Arrow ←": "arrowLeft",
      "Arrow →": "arrowRight",
      "Arrow ↑←": "arrowStraightLeft",
      "Arrow ↑→": "arrowStraightRight",
      "Give Way △": "giveWay",
      "Speed Circle ○": "speedCircle",
      "Parking Lines": "parkingLines",
    },
  }).on("change", () => onDecalTypeChanged?.());
  decalFolder.addBinding(rp, "decalWidth", { label: "Width", min: 1, max: 20, step: 0.5 }).on("change", () => onDecalParamsChanged?.());
  decalFolder.addBinding(rp, "decalLength", { label: "Length", min: 1, max: 20, step: 0.5 }).on("change", () => onDecalParamsChanged?.());
  decalFolder.addBinding(rp, "decalColor", { label: "Color", view: "color" }).on("change", () => onDecalParamsChanged?.());
  decalFolder.addBinding(rp, "decalStripeCount", { label: "Stripe count", min: 2, max: 20, step: 1 }).on("change", () => onDecalParamsChanged?.());
  decalFolder.addBinding(rp, "decalSnapToRoad", { label: "Snap rotation" }).on("change", () => onDecalParamsChanged?.());
  decalFolder.addBinding(rp, "decalRotation", { label: "Manual rotation", min: 0, max: 360, step: 5 }).on("change", () => onDecalParamsChanged?.());
  decalFolder.addButton({ title: "Clear all decals" }).on("click", () => onDecalClearAll?.());
}

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
    onSmartRoadEdgeStylePatch,
    onSmartRoadEdgeStyleClear,
    onAccessoryTypeChanged,
    onAccessoryParamsChanged,
    onAccessoryClearAll,
    onDecalModeToggle,
    onDecalTypeChanged,
    onDecalParamsChanged,
    onDecalClearAll,
    onDecalTransformModeChanged,
    onDecalDeleteSelected,
    stateKey = "fullRoad",
    title = "Full Road",
  } = opts;
  const rp = toolState[stateKey] ?? toolState.fullRoad;
  const isSmartRoad = stateKey === "smartRoad";
  const folder = pane.addFolder({ title, expanded: isSmartRoad });

  folder.addBinding(rp, "showHandles", { label: "Show handles" }).on("change", onFullRoadChanged);
  folder.addButton({ title: "Start new branch" }).on("click", () => onFullRoadStartBranch?.());
  folder.addButton({ title: "Toggle selected junction" }).on("click", () => onFullRoadToggleJunction?.());
  folder.addButton({ title: "Delete selected node" }).on("click", () => onFullRoadDeleteSelected?.());
  folder
    .addButton({
      title: isSmartRoad ? "Clear Smart Road network" : "Clear full road network",
    })
    .on("click", () => onFullRoadClearAll?.());
  folder.addBinding(rp, "selectedPointY", { label: "Node Y", min: -50, max: 200, step: 0.1 }).on("change", () => onFullRoadSelectedYChanged?.());
  folder.addButton({ title: "Snap selected Y to terrain" }).on("click", () => onFullRoadSnapY?.());
  folder
    .addButton({
      title: isSmartRoad ? "Flatten terrain under Smart roads" : "Flatten terrain under full roads",
    })
    .on("click", () => onFullRoadFlattenTerrain?.());
  if (!isSmartRoad) {
    folder.addButton({ title: "Apply City Road Preset" }).on("click", () => onFullRoadApplyCityPreset?.());
  }

  const graphFolder = folder.addFolder({ title: "Graph / Junctions", expanded: true });
  graphFolder.addBinding(rp, "nodeSnapRadius", { label: "Node snap", min: 0.5, max: 20, step: 0.25 }).on("change", onFullRoadChanged);
  graphFolder.addBinding(rp, "branchSnapRadius", { label: "Branch snap", min: 0.5, max: 30, step: 0.25 }).on("change", onFullRoadChanged);
  graphFolder.addBinding(rp, "junctionRadius", { label: "Junction radius", min: 2, max: 80, step: 0.5 }).on("change", onFullRoadChanged);
  graphFolder.addBinding(rp, "junctionSegments", { label: "Junction segs", min: 12, max: 96, step: 4 }).on("change", onFullRoadChanged);

  if (isSmartRoad) {
    graphFolder.addBinding(rp, "lanesPerDir", { label: "Lanes / dir", min: 1, max: 3, step: 1 }).on("change", onFullRoadChanged);
    graphFolder
      .addBinding(rp, "twoRoadNodes", {
        label: "2-way nodes",
        options: { "Smooth bend": "smooth", Junction: "junction" },
      })
      .on("change", onFullRoadChanged);
    graphFolder
      .addBinding(rp, "endCapStyle", {
        label: "Road ends",
        options: { Flat: "flat", Round: "round" },
      })
      .on("change", onFullRoadChanged);
  }

  const geoFolder = folder.addFolder({ title: "Geometry", expanded: false });
  geoFolder.addBinding(rp, "width", { label: "Width", min: 2, max: 60, step: 0.5 }).on("change", onFullRoadChanged);
  if (isSmartRoad) {
    const profileOpts = {};
    for (const [key, prof] of Object.entries(ROAD_PROFILES)) profileOpts[prof.label] = key;
    geoFolder
      .addBinding(rp, "profilePreset", { label: "Profile", options: profileOpts })
      .on("change", onFullRoadChanged);
    geoFolder
      .addBinding(rp, "profileScale", { label: "Profile scale", min: 0, max: 5, step: 0.1 })
      .on("change", onFullRoadChanged);
  }
  geoFolder
    .addBinding(rp, "segments", {
      label: isSmartRoad ? "Curve segments" : "Edge segments",
      min: 8,
      max: 300,
      step: 4,
    })
    .on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "heightOffset", { label: "Height offset", min: 0, max: 2, step: 0.01 }).on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "adaptiveLift", { label: "Adaptive lift" }).on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "slopeLift", { label: "Slope lift", min: 0, max: 2, step: 0.01 }).on("change", onFullRoadChanged);
  geoFolder.addBinding(rp, "liftMax", { label: "Lift cap", min: 0, max: 2, step: 0.01 }).on("change", onFullRoadChanged);

  if (isSmartRoad) {
    const mk = folder.addFolder({ title: "Center & lane markings", expanded: false });
    mk.addBinding(rp, "lineColor", { label: "Edge & lane color", view: "color" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "lineWidth", { label: "Edge width", min: 0, max: 0.2, step: 0.005 }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "lineInset", { label: "Edge inset", min: 0, max: 0.15, step: 0.005 }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLine", { label: "Center line" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLineColor", { label: "Center color", view: "color" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLineWidth", { label: "Center width", min: 0.002, max: 0.08, step: 0.001 }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLineDashed", { label: "Center dashed" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLineDashScale", { label: "Center dash density", min: 0.005, max: 2, step: 0.005 }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "doubleCenterLine", { label: "Double center" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLineGap", { label: "Center gap", min: 0.004, max: 0.06, step: 0.001 }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLeftEnabled", { label: "Center left on" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLeftColor", { label: "Center left color", view: "color" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerLeftDashed", { label: "Center left dashed" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerRightEnabled", { label: "Center right on" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerRightColor", { label: "Center right color", view: "color" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "centerRightDashed", { label: "Center right dashed" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "laneLines", { label: "Lane separators" }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "laneLineWidth", { label: "Lane width", min: 0.002, max: 0.06, step: 0.001 }).on("change", onFullRoadChanged);
    mk.addBinding(rp, "laneDashScale", { label: "Lane dash density", min: 0.005, max: 2, step: 0.005 }).on("change", onFullRoadChanged);

    const segMk = folder.addFolder({ title: "Selected straight edge (Alt+click)", expanded: false });
    segMk.addButton({ title: "Solid center (override)" }).on("click", () =>
      onSmartRoadEdgeStylePatch?.({ centerLine: true, centerLineDashed: false }),
    );
    segMk.addButton({ title: "Dashed center (override)" }).on("click", () =>
      onSmartRoadEdgeStylePatch?.({ centerLine: true, centerLineDashed: true }),
    );
    segMk.addButton({ title: "Inherit center line & dash" }).on("click", () =>
      onSmartRoadEdgeStylePatch?.({ centerLine: null, centerLineDashed: null }),
    );
    segMk.addButton({ title: "Double yellow on segment" }).on("click", () =>
      onSmartRoadEdgeStylePatch?.({ doubleCenterLine: true, centerLine: true }),
    );
    segMk
      .addButton({ title: "Inherit double-center layout" })
      .on("click", () =>
        onSmartRoadEdgeStylePatch?.({
          doubleCenterLine: null,
          centerLineGap: null,
          centerLineWidth: null,
          centerLeftEnabled: null,
          centerRightEnabled: null,
          centerLeftDashed: null,
          centerRightDashed: null,
        }),
      );
    segMk.addButton({ title: "Hide lane lines on segment" }).on("click", () => onSmartRoadEdgeStylePatch?.({ laneLines: false }));
    segMk.addButton({ title: "Show lane lines on segment" }).on("click", () => onSmartRoadEdgeStylePatch?.({ laneLines: true }));
    segMk.addButton({ title: "Inherit lane lines" }).on("click", () => onSmartRoadEdgeStylePatch?.({ laneLines: null }));
    segMk.addButton({ title: "Clear all overrides on selected edge" }).on("click", () => onSmartRoadEdgeStyleClear?.());

    const matSurf = folder.addFolder({ title: "Material / surface color", expanded: false });
    matSurf.addBinding(rp, "colorTint", { label: "Tint", view: "color" }).on("change", onFullRoadChanged);
    matSurf
      .addBinding(rp, "colorBrightness", { label: "Brightness", min: 0.2, max: 2.0, step: 0.05 })
      .on("change", onFullRoadChanged);
    matSurf.addBinding(rp, "asphaltDark", { label: "Procedural dark", view: "color" }).on("change", onFullRoadChanged);
    matSurf.addBinding(rp, "asphaltLight", { label: "Procedural light", view: "color" }).on("change", onFullRoadChanged);
    matSurf.addBinding(rp, "grainScale", { label: "Grain scale", min: 2, max: 40, step: 0.5 }).on("change", onFullRoadChanged);
    matSurf.addBinding(rp, "grainStrength", { label: "Grain strength", min: 0, max: 1, step: 0.02 }).on("change", onFullRoadChanged);

    const pbrMaps = folder.addFolder({ title: "PBR maps (textures)", expanded: false });
    pbrMaps
      .addBinding(rp, "usePbrTextures", { label: "Enable diffuse / ARM / normal" })
      .on("change", onFullRoadChanged);
    pbrMaps.addBinding(rp, "texScale", { label: "Texture scale", min: 0.5, max: 20, step: 0.5 }).on("change", onFullRoadChanged);
    pbrMaps.addBinding(rp, "normalStrength", { label: "Normal strength", min: 0, max: 3, step: 0.05 }).on("change", onFullRoadChanged);
    pbrMaps.addBinding(rp, "roughnessBase", { label: "Roughness mult", min: 0.05, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    pbrMaps.addBinding(rp, "normalDistort", { label: "Normal UV distort", min: 0, max: 0.5, step: 0.01 }).on("change", onFullRoadChanged);
    const pbrLod = pbrMaps.addFolder({ title: "Detail vs camera distance", expanded: false });
    pbrLod.addBinding(rp, "lodNear", { label: "LOD near (m)", min: 5, max: 120, step: 1 }).on("change", onFullRoadChanged);
    pbrLod.addBinding(rp, "lodMid", { label: "LOD mid (m)", min: 20, max: 250, step: 1 }).on("change", onFullRoadChanged);
    pbrLod.addBinding(rp, "lodFar", { label: "LOD far (m)", min: 50, max: 600, step: 5 }).on("change", onFullRoadChanged);

    const agingFolder = folder.addFolder({ title: "Road aging (dirt / wear)", expanded: false });
    agingFolder.addBinding(rp, "dirtAmount", { label: "Dirt amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "dirtScale", { label: "Dirt scale", min: 0.5, max: 20, step: 0.1 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "dirtContrast", { label: "Dirt contrast", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "dirtTint", { label: "Dirt tint", view: "color" }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "edgeDirtBoost", { label: "Edge boost", min: 0, max: 2, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "wearAmount", { label: "Wear amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "wearScale", { label: "Wear scale", min: 0.5, max: 30, step: 0.1 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "wearContrast", { label: "Wear contrast", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "wearDarken", { label: "Wear darken", min: 0, max: 0.8, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "scratchAmount", { label: "Scratch amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "scratchScale", { label: "Scratch scale", min: 2, max: 80, step: 0.5 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "scratchThinness", { label: "Scratch thinness", min: 0.1, max: 0.98, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "lineScratchAmount", { label: "Line scratch amt", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "lineScratchScale", { label: "Line scratch scale", min: 1, max: 20, step: 0.5 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "lineScratchStretch", { label: "Line scratch stretch", min: 1, max: 20, step: 0.5 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "lineScratchThreshold", { label: "Line scratch thresh", min: 0.05, max: 0.8, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "lineScratchSoftness", { label: "Line scratch soft", min: 0.02, max: 0.5, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "lineScratchWarp", { label: "Line scratch warp", min: 0, max: 2, step: 0.05 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "lineScratchDetail", { label: "Line scratch detail", min: 0, max: 1, step: 0.05 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "lineScratchEdge", { label: "Line scratch edge", min: 0, max: 1, step: 0.05 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "roughnessDirtBoost", { label: "Dirt roughness+", min: 0, max: 0.5, step: 0.01 }).on("change", onFullRoadChanged);
    agingFolder.addBinding(rp, "roughnessWearReduce", { label: "Wear roughness−", min: 0, max: 0.4, step: 0.01 }).on("change", onFullRoadChanged);

    const wetFolder = folder.addFolder({ title: "Wet road / puddles", expanded: false });
    wetFolder.addBinding(rp, "wetAmount", { label: "Wet amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    wetFolder.addBinding(rp, "wetCoverage", { label: "Wet coverage", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    wetFolder.addBinding(rp, "puddleAmount", { label: "Puddle amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    wetFolder.addBinding(rp, "puddleScale", { label: "Puddle scale", min: 0.4, max: 12, step: 0.1 }).on("change", onFullRoadChanged);
    wetFolder.addBinding(rp, "puddleContrast", { label: "Puddle contrast", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
    wetFolder.addBinding(rp, "puddleEdgeBoost", { label: "Edge puddles", min: 0, max: 1.5, step: 0.01 }).on("change", onFullRoadChanged);
    wetFolder.addBinding(rp, "wetDarkening", { label: "Wet darkening", min: 0, max: 0.6, step: 0.01 }).on("change", onFullRoadChanged);
    wetFolder.addBinding(rp, "wetRoughnessMin", { label: "Min roughness", min: 0.02, max: 0.5, step: 0.01 }).on("change", onFullRoadChanged);
    wetFolder.addBinding(rp, "puddleTint", { label: "Puddle tint", view: "color" }).on("change", onFullRoadChanged);

    addRoadAccessoriesAndDecalsFolders(folder, rp, {
      onAccessoryTypeChanged,
      onAccessoryParamsChanged,
      onAccessoryClearAll,
      onDecalModeToggle,
      onDecalTransformModeChanged,
      onDecalDeleteSelected,
      onDecalTypeChanged,
      onDecalParamsChanged,
      onDecalClearAll,
    });
    return folder;
  }

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

  const agingFolder = folder.addFolder({ title: "Road Aging (Dirt/Wear)", expanded: false });
  agingFolder.addBinding(rp, "dirtAmount", { label: "Dirt amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "dirtScale", { label: "Dirt scale", min: 0.5, max: 20, step: 0.1 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "dirtContrast", { label: "Dirt contrast", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "dirtTint", { label: "Dirt tint", view: "color" }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "edgeDirtBoost", { label: "Edge boost", min: 0, max: 2, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "wearAmount", { label: "Wear amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "wearScale", { label: "Wear scale", min: 0.5, max: 30, step: 0.1 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "wearContrast", { label: "Wear contrast", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "wearDarken", { label: "Wear darken", min: 0, max: 0.8, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "scratchAmount", { label: "Scratch amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "scratchScale", { label: "Scratch scale", min: 2, max: 80, step: 0.5 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "scratchThinness", { label: "Scratch thinness", min: 0.1, max: 0.98, step: 0.01 }).on("change", onFullRoadChanged);
  // Line paint scratches (directional wear on painted lines)
  agingFolder.addBinding(rp, "lineScratchAmount", { label: "Line scratch amt", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "lineScratchScale", { label: "Line scratch scale", min: 1, max: 20, step: 0.5 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "lineScratchStretch", { label: "Line scratch stretch", min: 1, max: 20, step: 0.5 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "lineScratchThreshold", { label: "Line scratch thresh", min: 0.05, max: 0.8, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "lineScratchSoftness", { label: "Line scratch soft", min: 0.02, max: 0.5, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "lineScratchWarp", { label: "Line scratch warp", min: 0, max: 2, step: 0.05 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "lineScratchDetail", { label: "Line scratch detail", min: 0, max: 1, step: 0.05 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "lineScratchEdge", { label: "Line scratch edge", min: 0, max: 1, step: 0.05 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "roughnessDirtBoost", { label: "Dirt roughness+", min: 0, max: 0.5, step: 0.01 }).on("change", onFullRoadChanged);
  agingFolder.addBinding(rp, "roughnessWearReduce", { label: "Wear roughness-", min: 0, max: 0.4, step: 0.01 }).on("change", onFullRoadChanged);

  const wetFolder = folder.addFolder({ title: "Wet Road / Puddles", expanded: false });
  wetFolder.addBinding(rp, "wetAmount", { label: "Wet amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "wetCoverage", { label: "Wet coverage", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "puddleAmount", { label: "Puddle amount", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "puddleScale", { label: "Puddle scale", min: 0.4, max: 12, step: 0.1 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "puddleContrast", { label: "Puddle contrast", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "puddleEdgeBoost", { label: "Edge puddles", min: 0, max: 1.5, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "wetDarkening", { label: "Wet darkening", min: 0, max: 0.6, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "wetRoughnessMin", { label: "Min roughness", min: 0.02, max: 0.5, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "puddleReflectStrength", { label: "Puddle reflect", min: 0, max: 1.5, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "puddleSkySuppress", { label: "Sky suppress", min: 0, max: 1, step: 0.01 }).on("change", onFullRoadChanged);
  wetFolder.addBinding(rp, "puddleTint", { label: "Puddle tint", view: "color" }).on("change", onFullRoadChanged);

  addRoadAccessoriesAndDecalsFolders(folder, rp, {
    onAccessoryTypeChanged,
    onAccessoryParamsChanged,
    onAccessoryClearAll,
    onDecalModeToggle,
    onDecalTransformModeChanged,
    onDecalDeleteSelected,
    onDecalTypeChanged,
    onDecalParamsChanged,
    onDecalClearAll,
  });

  return folder;
}
