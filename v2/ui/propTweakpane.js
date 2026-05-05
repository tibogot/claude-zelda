export function addPropFolder(pane, toolState, callbacks) {
  const folder = pane.addFolder({ title: "Props", expanded: false });

  folder.addBinding(toolState.props, "placementMode", {
    label: "Mode",
    options: { "Place (click)": "place", "Paint (brush)": "paint" },
  });

  function rebuildSlotDropdown() {
    if (activeBinding) activeBinding.dispose();
    const options = {};
    toolState.propSlots.forEach((s, i) => { options[s.name] = i; });
    if (Object.keys(options).length === 0) options["(none)"] = -1;
    activeBinding = folder.addBinding(toolState.props, "activeSlot", {
      label: "Active type",
      options,
      index: 1,
    });
  }
  let activeBinding = null;
  rebuildSlotDropdown();

  folder.addButton({ title: "Import GLB..." }).on("click", () => callbacks.onImportPropGlb?.());

  const primFolder = folder.addFolder({ title: "Add Primitive", expanded: false });
  for (const shape of ["Cube", "Sphere", "Cylinder", "Plane", "Cone", "Torus"]) {
    primFolder.addButton({ title: shape }).on("click", () => callbacks.onAddPrimitive?.(shape));
  }

  const liveFolder = folder.addFolder({ title: "Add Live Prop", expanded: false });
  liveFolder.addButton({ title: "Flag" }).on("click", () => callbacks.onAddLiveProp?.("Flag"));

  const slotsFolder = folder.addFolder({ title: "Loaded Props", expanded: false });

  function rebuildSlotsFolder() {
    const children = [...slotsFolder.children];
    children.forEach((c) => c.dispose());
    toolState.propSlots.forEach((slot, i) => {
      const sf = slotsFolder.addFolder({ title: slot.name, expanded: false });
      if (!slot.builtin && !slot.live) {
        sf.addButton({ title: "Import LOD1 (medium)" }).on("click", () => {
          callbacks.onImportPropLod?.(i, 1);
        });
        sf.addButton({ title: "Import LOD2 (low)" }).on("click", () => {
          callbacks.onImportPropLod?.(i, 2);
        });
      }
      sf.addButton({ title: "Remove" }).on("click", () => {
        callbacks.onRemovePropSlot?.(i);
        rebuildSlotsFolder();
        rebuildSlotDropdown();
      });
    });
  }
  rebuildSlotsFolder();
  callbacks._rebuildPropUi = () => { rebuildSlotsFolder(); rebuildSlotDropdown(); };

  folder.addBlade({ view: "separator" });

  folder.addBinding(toolState.props, "sinkOffset", {
    label: "Sink offset",
    min: 0, max: 10, step: 0.1,
  });

  folder.addBinding(toolState.props, "transformMode", {
    label: "Gizmo [W/E/R]",
    options: {
      "Translate (W)": "translate",
      "Rotate (E)": "rotate",
      "Scale (R)": "scale",
    },
  }).on("change", () => callbacks.onPropTransformModeChanged?.());

  folder.addBlade({ view: "separator" });

  // --- Live prop params (shown when a live prop is selected) ---
  let liveParamsFolder = null;
  let _liveParamsProxy = {};

  function showLiveParams(inst, propStore, livePropManager) {
    hideLiveParams();
    if (!inst?.liveParams) return;

    const type = propStore.types[inst.typeIdx];
    if (!type?.live) return;

    _liveParamsProxy = { ...inst.liveParams };
    liveParamsFolder = folder.addFolder({ title: `${type.name} Params`, expanded: true });

    if ("flagColor" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "flagColor", { label: "Color" })
        .on("change", () => _syncLiveParam(inst, "flagColor", livePropManager));
    }
    if ("textureUrl" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "textureUrl", { label: "Texture URL" })
        .on("change", () => _syncLiveParam(inst, "textureUrl", livePropManager));
    }
    if ("clothWidth" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "clothWidth", { label: "Cloth width", min: 0.5, max: 6, step: 0.1 })
        .on("change", () => _syncLiveParam(inst, "clothWidth", livePropManager));
    }
    if ("clothHeight" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "clothHeight", { label: "Cloth height", min: 0.3, max: 8, step: 0.1 })
        .on("change", () => _syncLiveParam(inst, "clothHeight", livePropManager));
    }
    if ("poleHeight" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "poleHeight", { label: "Pole height", min: 1, max: 12, step: 0.5 })
        .on("change", () => _syncLiveParam(inst, "poleHeight", livePropManager));
    }
    if ("windIntensity" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "windIntensity", { label: "Wind intensity", min: 0, max: 800, step: 10 })
        .on("change", () => _syncLiveParam(inst, "windIntensity", livePropManager));
    }
    if ("windSpeed" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "windSpeed", { label: "Wind speed", min: 100, max: 3000, step: 50 })
        .on("change", () => _syncLiveParam(inst, "windSpeed", livePropManager));
    }
    if ("windDirection" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "windDirection", { label: "Wind direction", min: 0, max: 360, step: 1 })
        .on("change", () => _syncLiveParam(inst, "windDirection", livePropManager));
    }
    if ("showPole" in _liveParamsProxy) {
      liveParamsFolder.addBinding(_liveParamsProxy, "showPole", { label: "Show pole" })
        .on("change", () => _syncLiveParam(inst, "showPole", livePropManager));
    }
  }

  function _syncLiveParam(inst, key, livePropManager) {
    inst.liveParams[key] = _liveParamsProxy[key];
    const instIdx = propStoreRef?.instances.indexOf(inst) ?? -1;

    if (key === "clothWidth" || key === "clothHeight" || key === "poleHeight" || key === "poleRadius" || key === "xSegs" || key === "ySegs") {
      propStoreRef?._bump();
    } else {
      const entry = livePropManager?.getLiveEntry(instIdx);
      if (entry?.obj.setParam) {
        entry.obj.setParam(key, _liveParamsProxy[key]);
      }
      livePropManager?.updateParamSnap(instIdx);
    }
  }

  function hideLiveParams() {
    if (liveParamsFolder) {
      liveParamsFolder.dispose();
      liveParamsFolder = null;
    }
  }

  let propStoreRef = null;

  // --- Paint Settings ---

  const paintFolder = folder.addFolder({ title: "Paint Settings", expanded: true });
  paintFolder.addBinding(toolState.props, "density", {
    label: "Density", min: 0.05, max: 5, step: 0.05,
  });
  paintFolder.addBinding(toolState.props, "minSpacing", {
    label: "Min spacing", min: 0.5, max: 20, step: 0.5,
  });
  paintFolder.addBinding(toolState.props, "scaleMin", {
    label: "Scale min", min: 0.1, max: 5, step: 0.05,
  });
  paintFolder.addBinding(toolState.props, "scaleMax", {
    label: "Scale max", min: 0.1, max: 5, step: 0.05,
  });
  paintFolder.addBinding(toolState.props, "randomRotation", {
    label: "Random rotation",
  });

  folder.addBlade({ view: "separator" });

  const lodFolder = folder.addFolder({ title: "LOD Distances", expanded: false });
  lodFolder.addBinding(toolState.propLod, "lod0Distance", {
    label: "LOD0 → LOD1",
    min: 10, max: 300, step: 5,
  }).on("change", () => callbacks.onPropLodChanged?.());
  lodFolder.addBinding(toolState.propLod, "lod1Distance", {
    label: "LOD1 → LOD2",
    min: 20, max: 600, step: 10,
  }).on("change", () => callbacks.onPropLodChanged?.());
  lodFolder.addBinding(toolState.propLod, "fadeOutDistance", {
    label: "Fade-out dist",
    min: 50, max: 1500, step: 10,
  }).on("change", () => callbacks.onPropLodChanged?.());
  lodFolder.addBinding(toolState.propLod, "castShadow", {
    label: "Cast shadow",
  }).on("change", () => callbacks.onPropCastShadowChanged?.());

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Rebake BVH" }).on("click", () => {
    callbacks.onRebakeBvh?.();
  });

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Delete Selected [Del]" }).on("click", () => {
    callbacks.onDeleteSelectedProp?.();
  });

  folder.addButton({ title: "Clear All Props" }).on("click", () => {
    callbacks.onClearAllProps?.();
  });

  folder.showLiveParams = showLiveParams;
  folder.hideLiveParams = hideLiveParams;
  folder.setPropStoreRef = (ps) => { propStoreRef = ps; };

  return folder;
}
