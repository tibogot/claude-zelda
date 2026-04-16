/**
 * Texture Library pane — Unity/Unreal-style catalog UI.
 *
 * Browse slots, swap maps per slot via file upload, tune per-slot UV tiling
 * and strength multipliers. The slot bindings are live: the material samples
 * the slot's stable albedo/orm textures + uniforms directly, so edits
 * propagate without material rebuild. Map swaps invalidate the live surface
 * material from main.js (cliff-slope path reads from the same slot too).
 */

/**
 * @param {*} pane
 * @param {*} toolState
 * @param {ReturnType<typeof import("../core/textures/textureLibrary.js").createTextureLibrary>} textureLibrary
 */
export function addTextureLibraryFolder(pane, toolState, textureLibrary) {
  const folder = pane.addFolder({ title: "Texture library", expanded: false });

  const slotPicker = { activeSlotId: textureLibrary.slots[0]?.id ?? "" };
  folder
    .addBinding(slotPicker, "activeSlotId", {
      label: "Active slot",
      options: textureLibrary.getSlotOptionsForUi(),
    })
    .on("change", () => rebuildSlotEditor());

  const slotEditor = folder.addFolder({ title: "Slot properties", expanded: true });

  function rebuildSlotEditor() {
    for (const child of [...slotEditor.children]) child.dispose();
    const slot = textureLibrary.getSlot(slotPicker.activeSlotId);
    if (!slot) return;

    slotEditor
      .addBinding(slot, "uvScale", { label: "UV tile", min: 0.25, max: 80, step: 0.25 })
      .on("change", () => textureLibrary.setSlotUvScale(slot.id, slot.uvScale));
    slotEditor
      .addBinding(slot, "normalStrength", { label: "Normal str", min: 0, max: 3, step: 0.02 })
      .on("change", () => textureLibrary.setSlotStrength(slot.id, "normal", slot.normalStrength));
    slotEditor
      .addBinding(slot, "aoStrength", { label: "AO str", min: 0, max: 2, step: 0.02 })
      .on("change", () => textureLibrary.setSlotStrength(slot.id, "ao", slot.aoStrength));
    slotEditor
      .addBinding(slot, "roughStrength", { label: "Rough str", min: 0, max: 2, step: 0.02 })
      .on("change", () => textureLibrary.setSlotStrength(slot.id, "rough", slot.roughStrength));

    const uploads = slotEditor.addFolder({ title: "Replace maps (upload)", expanded: true });
    for (const kind of ["albedo", "normal", "ao", "rough"]) {
      uploads.addButton({ title: `Upload ${kind}…`, label: kind }).on("click", () => {
        openFileDialog((file) => {
          textureLibrary
            .replaceMapFromFile(slot.id, kind, file)
            .catch((err) => console.warn(`Upload failed for ${slot.id}/${kind}`, err));
        });
      });
    }
  }

  rebuildSlotEditor();
}

/** One-shot hidden `<input type="file">` — resolves on selection. */
function openFileDialog(onPicked) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) onPicked(file);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}
