/**
 * Flat-ground capsule walker + third-person follow camera for pine-forest-bench.
 */
import * as THREE from "three";

const CAPSULE_R = 0.35;
const CAPSULE_H = 1.0;
const EYE_OFFSET = CAPSULE_R + CAPSULE_H * 0.45;

export class PineForestWalker {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {THREE.PerspectiveCamera} opts.camera
   * @param {HTMLElement} opts.domElement
   * @param {(x: number, z: number) => number} [opts.getGroundY]
   */
  constructor({ scene, camera, domElement, getGroundY }) {
    this.camera = camera;
    this.domElement = domElement;
    this.getGroundY = getGroundY ?? (() => 0);
    this.mode = "orbit";

    this.moveSpeed = 12;
    this.sprintMul = 2;
    this.camFollowDist = 6;
    this.camFollowHeight = 2.2;
    this.camFollowSmooth = 10;
    this.capsuleVisible = true;
    this.mouseSensitivity = 0.0022;

    this.playerPos = new THREE.Vector3(0, 0, 8);
    this.playerYaw = 0;
    this.followPitch = 0.28;
    this._followCamPos = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
    this._keys = Object.create(null);
    this._mouseDX = 0;
    this._mouseDY = 0;

    const geo = new THREE.CapsuleGeometry(CAPSULE_R, CAPSULE_H, 6, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: "#4488cc",
      roughness: 0.45,
      metalness: 0.05,
    });
    this.capsule = new THREE.Mesh(geo, mat);
    this.capsule.castShadow = true;
    this.capsule.receiveShadow = false;
    this.capsule.visible = false;
    scene.add(this.capsule);

    this._onKeyDown = (e) => {
      if (e.target.closest("#inspector")) return;
      this._keys[e.code] = true;
    };
    this._onKeyUp = (e) => {
      this._keys[e.code] = false;
    };
    this._onBlur = () => {
      for (const k of Object.keys(this._keys)) this._keys[k] = false;
    };
    this._onClick = () => {
      if (this.mode !== "walk" || document.pointerLockElement) return;
      domElement.requestPointerLock?.();
    };
    this._onMouseMove = (e) => {
      if (document.pointerLockElement !== domElement || this.mode !== "walk") return;
      this._mouseDX += e.movementX;
      this._mouseDY += e.movementY;
    };
    this._onPointerLockChange = () => {
      if (!document.pointerLockElement) {
        this._mouseDX = 0;
        this._mouseDY = 0;
      }
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
    window.addEventListener("blur", this._onBlur);
    domElement.addEventListener("click", this._onClick);
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("blur", this._onBlur);
    this.domElement.removeEventListener("click", this._onClick);
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    this.capsule.removeFromParent();
    this.capsule.geometry.dispose();
    this.capsule.material.dispose();
  }

  /**
   * @param {"orbit"|"walk"} mode
   * @param {import("three/addons/controls/OrbitControls.js").OrbitControls} [orbitControls]
   */
  setMode(mode, orbitControls) {
    this.mode = mode;
    if (mode === "walk") {
      if (orbitControls) orbitControls.enabled = false;
      this.capsule.visible = this.capsuleVisible;
      this._followCamPos.copy(this.camera.position);
      const groundY = this.getGroundY(this.playerPos.x, this.playerPos.z);
      this._syncCapsule(groundY);
    } else {
      if (orbitControls) orbitControls.enabled = true;
      this.capsule.visible = false;
      if (document.pointerLockElement === this.domElement) {
        document.exitPointerLock?.();
      }
    }
  }

  /** Seed XZ from orbit target when switching into walk mode. */
  seedFromOrbitTarget(x, z, yaw) {
    this.playerPos.set(x, 0, z);
    if (yaw != null) this.playerYaw = yaw;
  }

  _syncCapsule(groundY) {
    const y = groundY + CAPSULE_R + CAPSULE_H * 0.5;
    this.capsule.position.set(this.playerPos.x, y, this.playerPos.z);
    this.capsule.rotation.y = this.playerYaw;
  }

  update(dt) {
    if (this.mode !== "walk" || dt <= 0) return;

    const sens = this.mouseSensitivity;
    this.playerYaw -= this._mouseDX * sens;
    this.followPitch = THREE.MathUtils.clamp(
      this.followPitch + this._mouseDY * sens,
      -0.15,
      1.05,
    );
    this._mouseDX = 0;
    this._mouseDY = 0;

    let moveX = 0;
    let moveZ = 0;
    const k = this._keys;
    if (k.KeyW || k.ArrowUp) moveZ -= 1;
    if (k.KeyS || k.ArrowDown) moveZ += 1;
    if (k.KeyA || k.ArrowLeft) moveX -= 1;
    if (k.KeyD || k.ArrowRight) moveX += 1;

    if (moveX !== 0 || moveZ !== 0) {
      const len = Math.hypot(moveX, moveZ);
      moveX /= len;
      moveZ /= len;
      const sprint = k.ShiftLeft || k.ShiftRight ? this.sprintMul : 1;
      const speed = this.moveSpeed * sprint * dt;
      const sinY = Math.sin(this.playerYaw);
      const cosY = Math.cos(this.playerYaw);
      this.playerPos.x += (moveX * cosY + moveZ * sinY) * speed;
      this.playerPos.z += (-moveX * sinY + moveZ * cosY) * speed;
    }

    const groundY = this.getGroundY(this.playerPos.x, this.playerPos.z);
    this._syncCapsule(groundY);

    const dist = this.camFollowDist;
    const cosP = Math.cos(this.followPitch);
    const sinP = Math.sin(this.followPitch);
    const targetX = this.playerPos.x + Math.sin(this.playerYaw) * dist * cosP;
    const targetZ = this.playerPos.z + Math.cos(this.playerYaw) * dist * cosP;
    const targetY = groundY + this.camFollowHeight + sinP * dist;

    const t = 1 - Math.exp(-this.camFollowSmooth * dt);
    this._followCamPos.x += (targetX - this._followCamPos.x) * t;
    this._followCamPos.y += (targetY - this._followCamPos.y) * t;
    this._followCamPos.z += (targetZ - this._followCamPos.z) * t;

    this.camera.position.copy(this._followCamPos);
    this._lookTarget.set(
      this.playerPos.x,
      groundY + EYE_OFFSET,
      this.playerPos.z,
    );
    this.camera.lookAt(this._lookTarget);
  }
}
