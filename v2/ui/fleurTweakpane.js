import { FLEUR_PRESETS } from "../../fleur-painter.js";

export function addFleurFolder(pane, toolState, callbacks) {
  const fp = toolState.fleur;
  const folder = pane.addFolder({ title: "Flowers · M", expanded: true });
  folder.hidden = true;

  folder
    .addBinding(fp, "erase", { label: "Erase (or Shift)" });

  folder
    .addBinding(fp, "activeSlot", {
      label: "Paint color",
      options: { "Color A": 0, "Color B": 1 },
    });

  let stemFolder = null;
  let hoverFolder = null;

  folder
    .addBinding(fp, "subMode", {
      label: "Placement",
      options: { "Ground bloom": "ground", Stemmed: "stem" },
    })
    .on("change", () => {
      if (stemFolder) stemFolder.hidden = fp.subMode !== "stem";
      if (hoverFolder) hoverFolder.hidden = fp.subMode === "stem";
      folder.refresh();
      callbacks.onFleurChanged?.();
    });

  folder.addBinding(fp, "bloomShape", {
    label: "Bloom shape",
    options: { "A (mask 1)": 0, "B (mask 2)": 1, "C (mask 3)": 2 },
  });

  stemFolder = folder.addFolder({ title: "Stem colors", expanded: true });
  stemFolder.hidden = fp.subMode !== "stem";
  stemFolder
    .addBinding(fp, "stemBase", { label: "Stem base", view: "color" })
    .on("change", () => callbacks.onFleurStemChanged?.());
  stemFolder
    .addBinding(fp, "stemTop", { label: "Stem top", view: "color" })
    .on("change", () => callbacks.onFleurStemChanged?.());
  stemFolder
    .addBinding(fp, "stemStaticCurve", {
      label: "Stem lean (static)",
      min: 0, max: 0.25, step: 0.005,
    })
    .on("change", () => callbacks.onFleurStemCurveChanged?.());

  hoverFolder = folder.addFolder({ title: "Hover (ground bloom)", expanded: false });
  hoverFolder.hidden = fp.subMode === "stem";
  hoverFolder.addBinding(fp, "hoverBase", { label: "Base Y", min: 0, max: 2, step: 0.01 });
  hoverFolder.addBinding(fp, "hoverVariance", { label: "Variance", min: 0, max: 1, step: 0.01 });

  const brushFolder = folder.addFolder({ title: "Brush", expanded: false });
  brushFolder.addBinding(fp, "perStroke", { label: "Per stroke", min: 1, max: 100, step: 1 });
  brushFolder.addBinding(fp, "minSpacing", { label: "Min spacing", min: 0.1, max: 4, step: 0.05 });
  brushFolder.addBinding(fp, "scaleMin", { label: "Scale min", min: 0.05, max: 3, step: 0.01 });
  brushFolder.addBinding(fp, "scaleMax", { label: "Scale max", min: 0.05, max: 3, step: 0.01 });

  function applyPreset(slot, key) {
    const p = FLEUR_PRESETS[key];
    if (!p) return;
    const c = slot === "A" ? fp.colorA : fp.colorB;
    c.inner = p.inner;
    c.outer = p.outer;
    c.glow = p.glow;
    callbacks.onFleurColorChanged?.(slot);
    folder.refresh();
  }

  const colorAFolder = folder.addFolder({ title: "Color A", expanded: true });
  colorAFolder
    .addBinding(fp.colorA, "preset", {
      label: "Preset",
      options: { Main: "main", Sakura: "sakura", "Zelda Blue": "zeldaBlue", Sunflower: "sunflower" },
    })
    .on("change", (e) => applyPreset("A", e.value));
  colorAFolder
    .addBinding(fp.colorA, "inner", { label: "Center color" })
    .on("change", () => callbacks.onFleurColorChanged?.("A"));
  colorAFolder
    .addBinding(fp.colorA, "outer", { label: "Edge color" })
    .on("change", () => callbacks.onFleurColorChanged?.("A"));
  colorAFolder
    .addBinding(fp.colorA, "glow", { label: "Center glow", min: 0, max: 1, step: 0.01 })
    .on("change", () => callbacks.onFleurColorChanged?.("A"));

  const colorBFolder = folder.addFolder({ title: "Color B", expanded: true });
  colorBFolder
    .addBinding(fp.colorB, "preset", {
      label: "Preset",
      options: { Main: "main", Sakura: "sakura", "Zelda Blue": "zeldaBlue", Sunflower: "sunflower" },
    })
    .on("change", (e) => applyPreset("B", e.value));
  colorBFolder
    .addBinding(fp.colorB, "inner", { label: "Center color" })
    .on("change", () => callbacks.onFleurColorChanged?.("B"));
  colorBFolder
    .addBinding(fp.colorB, "outer", { label: "Edge color" })
    .on("change", () => callbacks.onFleurColorChanged?.("B"));
  colorBFolder
    .addBinding(fp.colorB, "glow", { label: "Center glow", min: 0, max: 1, step: 0.01 })
    .on("change", () => callbacks.onFleurColorChanged?.("B"));

  const interactFolder = folder.addFolder({ title: "Interaction & Wind", expanded: false });
  interactFolder
    .addBinding(fp, "interactRadius", { label: "Interact radius", min: 0, max: 5, step: 0.1 })
    .on("change", () => callbacks.onFleurInteractionChanged?.());
  interactFolder
    .addBinding(fp, "interactStrength", { label: "Interact strength", min: 0, max: 2, step: 0.01 })
    .on("change", () => callbacks.onFleurInteractionChanged?.());
  interactFolder
    .addBinding(fp, "interactGain", { label: "Repulse gain", min: 0, max: 3, step: 0.01 })
    .on("change", () => callbacks.onFleurInteractionChanged?.());
  interactFolder
    .addBinding(fp, "windAmp", { label: "Wind amp", min: 0, max: 0.2, step: 0.001 })
    .on("change", () => callbacks.onFleurInteractionChanged?.());
  interactFolder
    .addBinding(fp, "windSpeed", { label: "Wind speed", min: 0, max: 5, step: 0.01 })
    .on("change", () => callbacks.onFleurInteractionChanged?.());

  folder.addButton({ title: "Clear all flowers" }).on("click", () => callbacks.onFleurClear?.());

  return folder;
}
