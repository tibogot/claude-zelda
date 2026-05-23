import { listDialogueGraphIds } from "../play/dialogue/dialogueGraphs.js";

export function addActorsFolder(pane, toolState, opts) {
  const {
    actorSystem,
    onActorsChanged,
    onDeleteSelectedActor,
    onClearAllActors,
    onClearNpcs,
    onClearEnemies,
    onSnapSelectedToTerrain,
  } = opts;
  const p = toolState.actors;
  const folder = pane.addFolder({ title: "Actors · N", expanded: false });

  folder.addBinding(p, "placeTool", {
    label: "Place",
    options: { NPC: "npc", Enemy: "enemy" },
  });

  const dlg = p.dialogue;
  const dlgFolder = folder.addFolder({ title: "Dialogue (play)", expanded: true });
  dlgFolder.addBinding(dlg, "enabled", { label: "Enabled" });
  dlgFolder.addBinding(dlg, "interactRadius", {
    label: "Interact radius",
    min: 1,
    max: 12,
    step: 0.25,
  });
  const graphIds = listDialogueGraphIds();
  const graphOptions = Object.fromEntries(graphIds.map((id) => [id, id]));
  dlgFolder.addBinding(dlg, "defaultDialogueId", {
    label: "Default graph",
    options: graphOptions,
  });

  const counts = { label: "0 NPC · 0 enemy" };
  const countsBlade = folder.addBinding(counts, "label", {
    label: "Placed",
    readonly: true,
  });

  function refreshCounts() {
    const c = actorSystem?.getCounts?.() ?? { npc: 0, enemy: 0 };
    counts.label = `${c.npc} NPC · ${c.enemy} enemy`;
    countsBlade.refresh();
  }
  refreshCounts();

  folder
    .addBinding(p, "transformMode", {
      label: "Gizmo",
      options: { Move: "translate", Rotate: "rotate", Scale: "scale" },
    })
    .on("change", () => opts.onTransformModeChanged?.());

  const capsule = folder.addFolder({ title: "Capsule (placeholder)", expanded: true });
  capsule
    .addBinding(p, "capsuleRadius", { label: "Radius", min: 0.15, max: 1.2, step: 0.02 })
    .on("change", () => {
      onActorsChanged?.();
      refreshCounts();
    });
  capsule
    .addBinding(p, "capsuleHeight", { label: "Height", min: 0.4, max: 2.5, step: 0.05 })
    .on("change", onActorsChanged);
  capsule.addBinding(p, "floorOffset", { label: "Floor offset", min: -1, max: 2, step: 0.02 }).on("change", () => {
    for (const inst of actorSystem?.instances ?? []) actorSystem.snapMeshToTerrain(inst.mesh);
  });
  capsule.addBinding(p, "npcColor", { label: "NPC color", view: "color" }).on("change", onActorsChanged);
  capsule.addBinding(p, "enemyColor", { label: "Enemy color", view: "color" }).on("change", onActorsChanged);

  const npcDefaults = folder.addFolder({ title: "NPC defaults (runtime later)", expanded: false });
  npcDefaults.addBinding(p.npcDefaults, "enabled", { label: "Enabled" });
  npcDefaults.addBinding(p.npcDefaults, "speed", { min: 0, max: 8, step: 0.1 });
  npcDefaults.addBinding(p.npcDefaults, "wanderRadius", { label: "Wander radius", min: 2, max: 80, step: 1 });
  npcDefaults.addBinding(p.npcDefaults, "directionChangeInterval", {
    label: "Dir change (s)",
    min: 0.5,
    max: 15,
    step: 0.25,
  });
  npcDefaults.addBinding(p.npcDefaults, "turnSpeed", { label: "Turn speed", min: 1, max: 12, step: 0.25 });
  npcDefaults.addBinding(p.npcDefaults, "idleWhenNearPlayer", { label: "Idle near player" });
  npcDefaults.addBinding(p.npcDefaults, "nearPlayerDistance", {
    label: "Near distance",
    min: 1,
    max: 20,
    step: 0.25,
  });

  const enemyDefaults = folder.addFolder({ title: "Enemy defaults (runtime later)", expanded: false });
  enemyDefaults.addBinding(p.enemyDefaults, "enabled", { label: "Enabled" });
  enemyDefaults.addBinding(p.enemyDefaults, "maxHp", { label: "Max HP", min: 1, max: 500, step: 1 });
  enemyDefaults.addBinding(p.enemyDefaults, "speed", { min: 0, max: 8, step: 0.1 });
  enemyDefaults.addBinding(p.enemyDefaults, "wanderRadius", { label: "Wander radius", min: 2, max: 80, step: 1 });
  enemyDefaults.addBinding(p.enemyDefaults, "directionChangeInterval", {
    label: "Dir change (s)",
    min: 0.5,
    max: 15,
    step: 0.25,
  });
  enemyDefaults.addBinding(p.enemyDefaults, "turnSpeed", { label: "Turn speed", min: 1, max: 12, step: 0.25 });

  folder.addButton({ title: "Snap selected to terrain" }).on("click", () => {
    onSnapSelectedToTerrain?.();
    refreshCounts();
  });
  folder.addButton({ title: "Delete selected [Del]" }).on("click", () => {
    onDeleteSelectedActor?.();
    refreshCounts();
  });
  folder.addButton({ title: "Clear all actors" }).on("click", () => {
    onClearAllActors?.();
    refreshCounts();
  });
  folder.addButton({ title: "Clear NPCs only" }).on("click", () => {
    onClearNpcs?.();
    refreshCounts();
  });
  folder.addButton({ title: "Clear enemies only" }).on("click", () => {
    onClearEnemies?.();
    refreshCounts();
  });

  return { folder, refreshCounts };
}
