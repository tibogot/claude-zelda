import { V2_AUDIO_BUS_IDS } from "../audio/audioBuses.js";

/**
 * Mixer-style controls for V2 Howler audio (mirrors engine mixer strips).
 * @param {import("tweakpane").Pane} pane
 * @param {{ audio: { muteAll: boolean, pauseWhenHidden: boolean, buses: Record<string, { volume: number, mute: boolean }> } }} toolState
 */
export function addAudioMixerFolder(pane, toolState) {
  const a = toolState.audio;
  const folder = pane.addFolder({ title: "Audio (mixer)", expanded: false });

  folder.addBinding(a, "muteAll", { label: "mute all" });
  folder.addBinding(a, "pauseWhenHidden", { label: "pause when tab hidden" });

  const master = a.buses.master;
  folder.addBinding(master, "volume", { label: "master vol", min: 0, max: 1, step: 0.01 });
  folder.addBinding(master, "mute", { label: "master mute" });

  folder.addBlade({ view: "separator" });

  const labels = {
    sfx: "SFX",
    music: "Music",
    voice: "Voice",
    ui: "UI",
    vehicle: "Vehicle",
  };

  for (const id of V2_AUDIO_BUS_IDS) {
    if (id === "master") continue;
    const b = a.buses[id];
    if (!b) continue;
    const sub = folder.addFolder({ title: labels[id] ?? id, expanded: false });
    sub.addBinding(b, "volume", { label: "volume", min: 0, max: 1, step: 0.01 });
    sub.addBinding(b, "mute", { label: "mute" });
  }

  return folder;
}
