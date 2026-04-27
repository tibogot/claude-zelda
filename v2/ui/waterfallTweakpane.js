export function addWaterfallFolder(pane, toolState, opts) {
  const {
    onWaterfallChanged,
    onDeleteSelectedWaterfall,
    onClearAllWaterfalls,
  } = opts;
  const p = toolState.waterfall;
  const folder = pane.addFolder({ title: "Waterfall", expanded: false });

  folder.addBinding(p, "placeTool", {
    label: "Place tool",
    options: {
      Waterfall: "waterfall",
      "Impact splash cap": "splashCap",
    },
  });
  folder.addBinding(p, "splashVisible", { label: "Show splash caps" }).on("change", onWaterfallChanged);
  folder.addButton({ title: "Delete selected [Del]" }).on("click", () => onDeleteSelectedWaterfall?.());
  folder.addButton({ title: "Clear all waterfalls" }).on("click", () => onClearAllWaterfalls?.());

  const geom = folder.addFolder({ title: "Geometry", expanded: false });
  geom.addBinding(p, "width", { min: 0.5, max: 30, step: 0.1 }).on("change", onWaterfallChanged);
  geom.addBinding(p, "totalHeight", { label: "height", min: 1, max: 80, step: 0.25 }).on("change", onWaterfallChanged);
  geom.addBinding(p, "topLength", { min: 0.2, max: 40, step: 0.1 }).on("change", onWaterfallChanged);
  geom.addBinding(p, "radius", { min: 0.1, max: 20, step: 0.05 }).on("change", onWaterfallChanged);
  geom.addBinding(p, "segments", { min: 24, max: 300, step: 4 }).on("change", onWaterfallChanged);
  geom.addBinding(p, "splashRadius", { min: 0.2, max: 20, step: 0.1 }).on("change", onWaterfallChanged);
  geom.addBinding(p, "splashCapAngle", { min: 0.08, max: 0.48, step: 0.01 }).on("change", onWaterfallChanged);
  geom.addBinding(p, "splashYOffset", { min: -5, max: 10, step: 0.05 }).on("change", onWaterfallChanged);

  const mat = folder.addFolder({ title: "Shader", expanded: false });
  mat.addBinding(p, "flowSpeed", { min: 0, max: 4, step: 0.01 }).on("change", onWaterfallChanged);
  mat.addBinding(p, "opacity", { min: 0.05, max: 1, step: 0.01 }).on("change", onWaterfallChanged);
  mat.addBinding(p, "colorA", { view: "color" }).on("change", onWaterfallChanged);
  mat.addBinding(p, "colorB", { view: "color" }).on("change", onWaterfallChanged);
  mat.addBinding(p, "colorC", { view: "color" }).on("change", onWaterfallChanged);

  const splash = folder.addFolder({ title: "Splash cap", expanded: false });
  splash.addBinding(p, "splashOpacity", { min: 0.05, max: 1, step: 0.01 }).on("change", onWaterfallChanged);
  splash.addBinding(p, "splashNoiseScale", { min: 0.2, max: 10, step: 0.05 }).on("change", onWaterfallChanged);
  splash.addBinding(p, "splashFlow", { min: 0, max: 4, step: 0.01 }).on("change", onWaterfallChanged);
  splash.addBinding(p, "splashDisp", { min: 0, max: 2, step: 0.01 }).on("change", onWaterfallChanged);
  splash.addBinding(p, "splashColorA", { view: "color" }).on("change", onWaterfallChanged);
  splash.addBinding(p, "splashColorB", { view: "color" }).on("change", onWaterfallChanged);

  return folder;
}

