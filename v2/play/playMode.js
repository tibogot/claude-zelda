import * as THREE from "three";

const CAP_R = 0.4;
const CAP_H = 1.2;
const GRAVITY = 20.0;
const JUMP_VEL = 11.0;
const MOVE_SPEED = 12;
const CAM_DIST = 6;
const CAM_SENS_X = 0.002;
const CAM_SENS_Y = 0.002;
const ISO_PITCH = 1.0;
const ISO_DIST_DEFAULT = 26;
const ISO_DIST_MIN = 10;
const ISO_DIST_MAX = 70;
const ISO_YAW_ROT_SPEED = 1.6;

export class PlayMode {
  constructor({ scene, camera, renderer, controls, getWorldHeight, worldHalf }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.getWorldHeight = getWorldHeight;
    this.worldHalf = worldHalf;

    this.active = false;
    this.camView = "follow";
    this.playerPos = new THREE.Vector3();
    this.velY = 0;
    this.inAir = false;
    this.camYaw = 0;
    this.camPitch = 0.35;
    this.isoYaw = Math.PI / 4;
    this.isoDist = ISO_DIST_DEFAULT;
    this.savedCamPos = null;
    this.savedTarget = null;
    this.keysHeld = {};
    this._lastMx = 0;
    this._lastMz = 0;

    const geo = new THREE.CapsuleGeometry(CAP_R, CAP_H, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff6633, roughness: 0.7 });
    this.capsule = new THREE.Mesh(geo, mat);
    this.capsule.castShadow = true;
    this.capsule.visible = false;
    scene.add(this.capsule);

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onIsoClick = this._onIsoClick.bind(this);
    this._onIsoWheel = this._onIsoWheel.bind(this);
    this._moveTarget = null;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.camView = "follow";
    this.velY = 0;
    this.inAir = false;
    this.isoYaw = Math.PI / 4;
    this.isoDist = ISO_DIST_DEFAULT;
    this._moveTarget = null;

    this.savedCamPos = this.camera.position.clone();
    this.savedTarget = this.controls.target.clone();
    this.playerPos.set(this.controls.target.x, 0, this.controls.target.z);
    this.playerPos.y = this.getWorldHeight(this.playerPos.x, this.playerPos.z);
    this.camYaw = 0;
    this.camPitch = 0.35;

    this.capsule.visible = true;
    this.controls.enabled = false;

    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    this.renderer.domElement.addEventListener("click", this._onIsoClick);
    this.renderer.domElement.addEventListener("wheel", this._onIsoWheel, { passive: false });

    this.renderer.domElement.style.cursor = "none";
    this.renderer.domElement.requestPointerLock();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this._moveTarget = null;
    for (const k of Object.keys(this.keysHeld)) delete this.keysHeld[k];

    this.capsule.visible = false;

    if (this.savedCamPos) this.camera.position.copy(this.savedCamPos);
    if (this.savedTarget) {
      this.controls.target.copy(this.savedTarget);
      this.camera.lookAt(this.savedTarget);
    }
    this.controls.enabled = true;

    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    this.renderer.domElement.removeEventListener("click", this._onIsoClick);
    this.renderer.domElement.removeEventListener("wheel", this._onIsoWheel);

    if (document.pointerLockElement) document.exitPointerLock();
    this.renderer.domElement.style.cursor = "";
  }

  update(dtSec) {
    if (!this.active) return;
    dtSec = Math.min(dtSec, 0.05);

    const iso = this.camView === "iso";
    const keys = this.keysHeld;

    // Movement direction
    const moveYaw = iso ? this.isoYaw : this.camYaw;
    let mx = 0, mz = 0;
    if (keys.KeyW || keys.ArrowUp)    { mx -= Math.sin(moveYaw); mz -= Math.cos(moveYaw); }
    if (keys.KeyS || keys.ArrowDown)  { mx += Math.sin(moveYaw); mz += Math.cos(moveYaw); }
    if (keys.KeyA || keys.ArrowLeft)  { mx -= Math.cos(moveYaw); mz += Math.sin(moveYaw); }
    if (keys.KeyD || keys.ArrowRight) { mx += Math.cos(moveYaw); mz -= Math.sin(moveYaw); }

    // Iso click-to-move
    if (iso && this._moveTarget) {
      if (mx !== 0 || mz !== 0) {
        this._moveTarget = null;
      } else {
        const dx = this._moveTarget.x - this.playerPos.x;
        const dz = this._moveTarget.z - this.playerPos.z;
        if (Math.hypot(dx, dz) < 0.35) {
          this._moveTarget = null;
        } else {
          mx = dx; mz = dz;
        }
      }
    }

    const mlen = Math.hypot(mx, mz);
    if (mlen > 0) {
      const stepX = (mx / mlen) * MOVE_SPEED * dtSec;
      const stepZ = (mz / mlen) * MOVE_SPEED * dtSec;
      const wh = this.worldHalf;
      this.playerPos.x = THREE.MathUtils.clamp(this.playerPos.x + stepX, -wh, wh);
      this.playerPos.z = THREE.MathUtils.clamp(this.playerPos.z + stepZ, -wh, wh);
    }

    // Ground height
    const groundY = this.getWorldHeight(this.playerPos.x, this.playerPos.z);
    const capsuleBase = CAP_R + CAP_H * 0.5;

    // Jump / gravity
    if (keys.Space && !this.inAir) {
      this.velY = JUMP_VEL;
      this.inAir = true;
    }

    if (this.inAir) {
      this.velY -= GRAVITY * dtSec;
      this.playerPos.y += this.velY * dtSec;
      if (this.playerPos.y <= groundY) {
        this.playerPos.y = groundY;
        this.velY = 0;
        this.inAir = false;
      }
    } else {
      this.playerPos.y = groundY;
      if (this.playerPos.y > groundY + 0.15) {
        this.inAir = true;
      }
    }

    // Iso yaw rotation
    if (iso) {
      if (keys.BracketLeft) this.isoYaw += ISO_YAW_ROT_SPEED * dtSec;
      if (keys.BracketRight) this.isoYaw -= ISO_YAW_ROT_SPEED * dtSec;
    }

    // Capsule visual
    const capsuleCY = this.playerPos.y + capsuleBase;
    this.capsule.position.set(this.playerPos.x, capsuleCY, this.playerPos.z);
    if (mlen > 0) {
      this._lastMx = mx / mlen;
      this._lastMz = mz / mlen;
    }
    if (this._lastMx !== 0 || this._lastMz !== 0) {
      this.capsule.rotation.y = Math.atan2(this._lastMx, this._lastMz) + Math.PI;
    }

    // Camera
    const lookAtY = this.playerPos.y + capsuleBase;
    if (iso) {
      const hDist = this.isoDist * Math.cos(ISO_PITCH);
      const vDist = this.isoDist * Math.sin(ISO_PITCH);
      this.camera.position.set(
        this.playerPos.x + Math.sin(this.isoYaw) * hDist,
        lookAtY + vDist,
        this.playerPos.z + Math.cos(this.isoYaw) * hDist,
      );
    } else {
      const hDist = CAM_DIST * Math.cos(this.camPitch);
      const vDist = CAM_DIST * Math.sin(this.camPitch);
      this.camera.position.set(
        this.playerPos.x + Math.sin(this.camYaw) * hDist,
        lookAtY + vDist,
        this.playerPos.z + Math.cos(this.camYaw) * hDist,
      );
    }
    this.camera.lookAt(this.playerPos.x, lookAtY, this.playerPos.z);
  }

  _onKeyDown(event) {
    if (!this.active) return;
    this.keysHeld[event.code] = true;

    if (!event.repeat && event.code === "KeyV") {
      event.preventDefault();
      this.camView = this.camView === "follow" ? "iso" : "follow";
      if (this.camView === "iso") {
        if (document.pointerLockElement) document.exitPointerLock();
        this.renderer.domElement.style.cursor = "";
        this.isoYaw = this.camYaw;
      } else {
        this._moveTarget = null;
        this.renderer.domElement.style.cursor = "none";
        this.renderer.domElement.requestPointerLock();
      }
    }
  }

  _onKeyUp(event) {
    if (!this.active) return;
    delete this.keysHeld[event.code];
  }

  _onMouseMove(event) {
    if (!this.active || !document.pointerLockElement) return;
    this.camYaw -= event.movementX * CAM_SENS_X;
    this.camPitch += event.movementY * CAM_SENS_Y;
    this.camPitch = Math.max(0.05, Math.min(Math.PI * 0.45, this.camPitch));
  }

  _onPointerLockChange() {
    if (!document.pointerLockElement && this.active && this.camView !== "iso") {
      this._exitCallback?.();
    }
  }

  _onIsoClick(event) {
    if (!this.active || this.camView !== "iso" || event.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.playerPos.y);
    const target = new THREE.Vector3();
    if (this._raycaster.ray.intersectPlane(groundPlane, target)) {
      this._moveTarget = target;
    }
  }

  _onIsoWheel(event) {
    if (!this.active || this.camView !== "iso") return;
    event.preventDefault();
    const dir = event.deltaY < 0 ? -1 : 1;
    this.isoDist = THREE.MathUtils.clamp(
      this.isoDist + dir * 2,
      ISO_DIST_MIN,
      ISO_DIST_MAX,
    );
  }

  set onExit(fn) { this._exitCallback = fn; }

  dispose() {
    this.exit();
    this.scene.remove(this.capsule);
    this.capsule.geometry.dispose();
    this.capsule.material.dispose();
  }
}
