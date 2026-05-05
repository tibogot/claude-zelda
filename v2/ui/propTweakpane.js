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

  const slotsFolder = folder.addFolder({ title: "Loaded Props", expanded: false });

  function rebuildSlotsFolder() {
    const children = [...slotsFolder.children];
    children.forEach((c) => c.dispose());
    toolState.propSlots.forEach((slot, i) => {
      const sf = slotsFolder.addFolder({ title: slot.name, expanded: false });
      if (!slot.builtin) {
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

  return folder;
}
