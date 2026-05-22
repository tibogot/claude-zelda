/**
 * Tweakpane folder for Billboard Grass mode (procedural painted cards).
 */
import { applyBillboardGrassPreset } from "../core/billboardGrass/billboardGrassPresets.js";

export function addBillboardGrassFolder(pane, toolState, opts) {
  const {
    onSlotStructureChanged,
    onSlotMaterialChanged,
    onMassPlaceBillboardGrass,
    onClearAllBillboardGrass,
  } = opts;

  const folder = pane.addFolder({ title: "Billboard Grass", expanded: false });
  const presetOpts = { Meadow: "meadow", "Dry field": "dry", Moss: "moss", Wheat: "wheat" };

  const slotOptions = {};
  for (let i = 0; i < toolState.billboardGrassSlots.length; i++) {
    slotOptions[toolState.billboardGrassSlots[i].name] = i;
  }
  folder.addBinding(toolState.billboardGrassPaint, "activeSlot", {
    label: "Active slot",
    options: slotOptions,
  });

  const brushFolder = folder.addFolder({ title: "Brush", expanded: true });
  brushFolder.addBinding(toolState.billboardGrassPaint, "density", {
    min: 0.1,
    max: 8,
    step: 0.1,
  });
  brushFolder.addBinding(toolState.billboardGrassPaint, "erase", { label: "Erase mode" });

  const massFolder = folder.addFolder({ title: "Mass place", expanded: false });
  massFolder.addBinding(toolState.billboardGrassPaint, "massPlaceCount", {
    label: "Count",
    min: 1,
    max: 50000,
    step: 1,
  });
  massFolder
    .addButton({ title: "Place" })
    .on("click", () => onMassPlaceBillboardGrass?.());

  const slotsFolder = folder.addFolder({ title: "Presets", expanded: true });
  const spreadOpts = { "360° radial": "full", "180° fan": "half" };
  const tiltModeOpts = { "Stable random": "stable", Symmetric: "symmetric" };
  for (let i = 0; i < toolState.billboardGrassSlots.length; i++) {
    const slot = toolState.billboardGrassSlots[i];
    const sf = slotsFolder.addFolder({ title: slot.name, expanded: i === 0 });
    sf.addBinding(slot, "enabled").on("change", () => onSlotStructureChanged?.(i));
    sf.addBinding(slot, "preset", { options: presetOpts }).on("change", () => {
      applyBillboardGrassPreset(slot);
      onSlotMaterialChanged?.(i);
    });
    const card = sf.addFolder({ title: "Card structure", expanded: false });
    card.addBinding(slot, "planeCount", { min: 1, max: 6, step: 1 }).on("change", () => onSlotStructureChanged?.(i));
    card.addBinding(slot, "planeSpread", { options: spreadOpts }).on("change", () => onSlotStructureChanged?.(i));
    card.addBinding(slot, "tiltMode", { options: tiltModeOpts }).on("change", () => onSlotStructureChanged?.(i));
    card.addBinding(slot, "tilt", { min: 0, max: 1.5, step: 0.01 }).on("change", () => onSlotStructureChanged?.(i));
    card.addBinding(slot, "structureSeed", { min: 0, max: 999999, step: 1 }).on("change", () => onSlotStructureChanged?.(i));
    card.addBinding(slot, "width", { min: 0.1, max: 10, step: 0.1 }).on("change", () => onSlotStructureChanged?.(i));
    card.addBinding(slot, "height", { min: 0.1, max: 10, step: 0.1 }).on("change", () => onSlotStructureChanged?.(i));
  }

  folder
    .addButton({ title: "Clear all billboard grass" })
    .on("click", () => onClearAllBillboardGrass?.());

  return folder;
}
