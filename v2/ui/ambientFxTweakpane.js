export function addAmbientFxFolder(pane, toolState, callbacks) {
  const afx = toolState.ambientFx;
  const folder = pane.addFolder({ title: "Ambient FX · X", expanded: true });
  folder.hidden = true;

  folder.addBinding(afx, "erase", { label: "Erase (or Shift)" });

  folder.addBinding(afx, "effectType", {
    label: "Effect",
    options: { Butterflies: "butterflies" },
  });

  folder.addBlade({ view: "separator" });

  folder.addBinding(afx, "emitterRadius", {
    label: "Emitter radius", min: 3, max: 40, step: 1,
  });

  folder.addBinding(afx, "density", {
    label: "Density", min: 1, max: 10, step: 0.5,
  });

  folder.addBlade({ view: "separator" });

  const bfFolder = folder.addFolder({ title: "Butterfly params", expanded: false });

  bfFolder
    .addBinding(afx, "flapSpeed", { label: "Flap Speed", min: 2, max: 20, step: 0.5 })
    .on("change", () => callbacks.onFlapChanged?.());

  bfFolder
    .addBinding(afx, "flapAngle", { label: "Flap Angle", min: 0.1, max: 1.5, step: 0.05 })
    .on("change", () => callbacks.onFlapChanged?.());

  bfFolder
    .addBinding(afx, "glideRatio", { label: "Glide Ratio", min: 0, max: 0.8, step: 0.05 })
    .on("change", () => callbacks.onFlapChanged?.());

  folder.addBlade({ view: "separator" });

  folder.addBinding(afx, "showRings", { label: "Show rings" })
    .on("change", () => callbacks.onRingsChanged?.());

  folder.addButton({ title: "Clear all ambient FX" }).on("click", () => callbacks.onClear?.());

  return folder;
}
