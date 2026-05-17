/**
 * Play-mode collectible runtime — overlap check + pickup state.
 * Touch-to-collect across capsule / char / car / lotus / fly.
 * Stay-gone semantics during play; everything restored on stop().
 *
 * Wiring:
 *   - main.js constructs once, passes livePropManager + scene + audio + burst.
 *   - PlayMode.enter() → runtime.start()
 *   - PlayMode.exit()  → runtime.stop()
 *   - main render loop while playMode.active → runtime.update(dt, playerPos, moveMode)
 */
import * as THREE from "three";
import { COLLECTIBLE_KINDS } from "../core/props/collectibleFactory.js";

/**
 * Per-mode reach bonus added to each collectible's own pickupRadius.
 * Lets cars/planes "vacuum up" coins they fly past without making the editor radius huge.
 */
const REACH_BONUS = {
  capsule: 0.0,
  char:    0.0,
  car:     1.5,
  lotus:   1.5,
  fly:     3.0,
};

export function createCollectibleRuntime({ livePropManager, burst, playSfx }) {
  /** instIdx of collectibles consumed this play session. */
  const collectedSet = new Set();
  let active = false;
  let collectedCount = 0;
  const _v = new THREE.Vector3();

  function start() {
    active = true;
    collectedSet.clear();
    collectedCount = 0;
    livePropManager.showAll();
    burst?.reset();
  }

  function stop() {
    active = false;
    collectedSet.clear();
    collectedCount = 0;
    livePropManager.showAll();
    burst?.reset();
  }

  /**
   * @param {number} dtSec
   * @param {THREE.Vector3} playerPos — world position of the active controller
   * @param {string} moveMode — "capsule" | "char" | "car" | "lotus" | "fly"
   */
  function update(dtSec, playerPos, moveMode) {
    if (!active || !playerPos) return;
    const bonus = REACH_BONUS[moveMode] ?? 0.0;

    livePropManager.forEachByKind(
      (k) => COLLECTIBLE_KINDS.has(k),
      (entry, instIdx) => {
        if (collectedSet.has(instIdx)) return;
        const g = entry.obj.group;
        const r = (entry.obj.pickupRadius ?? 1.0) + bonus;
        const r2 = r * r;
        _v.subVectors(playerPos, g.position);
        // Squared XZ + softened Y distance — vertical tolerance is generous so flying/jumping picks up too.
        const dx = _v.x, dz = _v.z;
        const dy = Math.max(0, Math.abs(_v.y) - 2.0);
        if (dx * dx + dz * dz + dy * dy < r2) {
          collectedSet.add(instIdx);
          collectedCount++;
          // Pickup pos = roughly the visual center (origin + a bit up for the bobbing height).
          _v.copy(g.position).y += 0.8;
          burst?.burstAt(_v, entry.obj.burstColor || new THREE.Color(0xffffff));
          playSfx?.(entry.obj.kind);
          livePropManager.setEntryVisible(instIdx, false);
        }
      },
    );
  }

  function getCollectedCount() { return collectedCount; }
  function isActive() { return active; }

  return { start, stop, update, getCollectedCount, isActive };
}
