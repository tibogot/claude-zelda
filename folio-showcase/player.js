/**
 * Folio Showcase — Player
 * Minimal terrain-following camera/player for the showcase.
 * Importable: same interface (position, update) so you can swap for your main game player later.
 *
 * @param {{ scene: THREE.Scene, camera: THREE.PerspectiveCamera, domElement: HTMLElement, getTerrainHeight: (x: number, z: number) => number, speed?: number, eyeHeight?: number }} options
 * @returns {{ position: THREE.Vector3, update: (dt: number) => void, camera: THREE.PerspectiveCamera, dispose: () => void }}
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export function createPlayer(options) {
  const {
    scene,
    camera,
    domElement,
    getTerrainHeight,
    speed = 8,
    eyeHeight = 1.7,
  } = options;

  const position = new THREE.Vector3(0, eyeHeight, 0);
  const velocity = new THREE.Vector3(0, 0, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3(1, 0, 0);
  const move = new THREE.Vector3(0, 0, 0);

  const keys = { w: false, a: false, s: false, d: false, shift: false };
  const runMult = 1.6;

  const controls = new OrbitControls(camera, domElement);
  controls.target.copy(position);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = 2;
  controls.maxDistance = 40;

  function onKeyDown(e) {
    const k = e.code?.toLowerCase();
    if (k === "keyw") keys.w = true;
    if (k === "keya") keys.a = true;
    if (k === "keys") keys.s = true;
    if (k === "keyd") keys.d = true;
    if (e.shiftKey) keys.shift = true;
  }

  function onKeyUp(e) {
    const k = e.code?.toLowerCase();
    if (k === "keyw") keys.w = false;
    if (k === "keya") keys.a = false;
    if (k === "keys") keys.s = false;
    if (k === "keyd") keys.d = false;
    if (!e.shiftKey) keys.shift = false;
  }

  domElement.addEventListener("keydown", onKeyDown);
  domElement.addEventListener("keyup", onKeyUp);
  if (domElement !== window) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
  }

  function update(dt) {
    const mult = keys.shift ? runMult : 1;
    const moveSpeed = speed * mult * dt;

    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    forward.normalize();
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();

    move.set(0, 0, 0);
    if (keys.w) move.add(forward);
    if (keys.s) move.sub(forward);
    if (keys.d) move.add(right);
    if (keys.a) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(moveSpeed);
      position.x += move.x;
      position.z += move.z;
    }

    const terrainY = getTerrainHeight(position.x, position.z);
    position.y = terrainY + eyeHeight;

    controls.target.copy(position);
  }

  function dispose() {
    controls.dispose();
    domElement.removeEventListener("keydown", onKeyDown);
    domElement.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  }

  return {
    position,
    update,
    camera,
    controls,
    dispose,
  };
}
