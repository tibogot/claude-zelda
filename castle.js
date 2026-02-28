/**
 * Castle overworld ↔ interior transition: door trigger, overlay, spawn positions.
 */
import * as THREE from "three";

export const CASTLE_POS_X = 80;
export const CASTLE_POS_Z = -60;
export const DOOR_TRIGGER_RADIUS = 3.0;

/**
 * @param {object} PARAMS
 * @returns {{
 *   getDoorTriggerPos: (sampleHeight: (x: number, z: number) => number) => THREE.Vector3,
 *   getOverworldSpawn: (sampleHeight: (x: number, z: number) => number) => THREE.Vector3,
 *   checkCastleDoor: (playerPos: THREE.Vector3, keys: object, castleExteriorGroup: THREE.Group | null, PARAMS: object, sampleHeight: (x: number, z: number) => number) => void
 * }}
 */
export function createCastleSystem(PARAMS) {
  const overlay = document.getElementById("transition-overlay");
  const prompt = document.getElementById("castle-prompt");

  function getDoorTriggerPos(sampleHeight) {
    return new THREE.Vector3(
      CASTLE_POS_X,
      sampleHeight(CASTLE_POS_X, CASTLE_POS_Z) + 1.5,
      CASTLE_POS_Z + 2,
    );
  }

  function getOverworldSpawn(sampleHeight) {
    return new THREE.Vector3(
      CASTLE_POS_X,
      sampleHeight(CASTLE_POS_X, CASTLE_POS_Z + 5) + 1.5,
      CASTLE_POS_Z + 5,
    );
  }

  function checkCastleDoor(playerPos, keys, castleExteriorGroup, PARAMS, sampleHeight) {
    if (!castleExteriorGroup || !PARAMS.showCastle) return;
    const doorPos = getDoorTriggerPos(sampleHeight);
    const dist = playerPos.distanceTo(doorPos);
    if (overlay && prompt) {
      if (dist < DOOR_TRIGGER_RADIUS) {
        prompt.innerHTML = `Press <span style="background: rgba(255,200,80,0.2); border: 1px solid rgba(255,200,80,0.4); border-radius: 3px; padding: 1px 6px; font-weight: bold;">E</span> to enter`;
        prompt.style.opacity = "1";
        if (keys.e) {
          keys.e = false;
          overlay.style.opacity = "1";
          setTimeout(() => {
            window.location.href = "castle-interior.html";
          }, 500);
        }
      } else {
        prompt.style.opacity = "0";
      }
    }
  }

  return {
    getDoorTriggerPos,
    getOverworldSpawn,
    checkCastleDoor,
  };
}
