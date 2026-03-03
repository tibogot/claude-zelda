/**
 * Player character: capsule placeholder, GLTF model, input, movement, animation.
 * createPlayer(opts) returns { characterGroup, capsule, keys, state, update(dt) }.
 * state = { camYaw, camPitch, characterVelY, moveDir } (mutable).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { resolveKinematicOverlap } from "./physics.js";
import { createFootstepAudio } from "./footsteps.js";

const CHAR_GLB = "models/AnimationLibrary_Godot_Standard-transformed.glb";
const DRACO_URL =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {THREE.WebGPURenderer} opts.renderer
 * @param {THREE.Camera} opts.camera
 * @param {object} opts.PARAMS
 * @param {THREE.Vector3} opts.charPos
 * @param {import("@dimforge/rapier3d").RigidBody} opts.playerBody
 * @param {import("@dimforge/rapier3d").Collider} opts.playerCollider
 * @param {import("@dimforge/rapier3d").CharacterController} opts.characterController
 * @param {import("@dimforge/rapier3d").World} opts.physicsWorld
 * @param {(x: number, z: number) => number} [opts.sampleHeight] - Optional. When provided, drives character Y via heightmap (terrain mode). When absent, Rapier trimesh colliders + computedGrounded() handle everything (parkour mode).
 * @param {number} [opts.capR] - Capsule radius (required when sampleHeight provided)
 * @param {number} [opts.capHalfH] - Capsule half-height (required when sampleHeight provided)
 * @param {number} opts.TERRAIN_SIZE
 * @param {object} [opts.debugOut] - Optional. When provided, written each frame with platform debug info.
 * @returns {{ characterGroup: THREE.Group, capsule: THREE.Mesh, keys: object, state: { camYaw: number, camPitch: number, characterVelY: number, isGrounded: boolean, moveDir: THREE.Vector3 }, update: (dt: number) => void }}
 */
export function createPlayer(opts) {
  const {
    scene,
    renderer,
    camera,
    PARAMS,
    charPos,
    playerBody,
    playerCollider,
    characterController,
    physicsWorld,
    RAPIER = null,
    sampleHeight = null,
    capR = 0,
    capHalfH = 0,
    footstepSoundsPath = null,
    TERRAIN_SIZE,
    debugOut = null,
  } = opts;
  // terrain mode: Y driven by heightmap sampling; parkour mode: trimesh colliders + computedGrounded()
  const hasSampleHeight = typeof sampleHeight === "function";

  // Footstep audio — loads async in background, starts working once ready
  let footstepAudio = null;
  if (footstepSoundsPath) {
    createFootstepAudio(footstepSoundsPath).then(fa => { footstepAudio = fa; });
  }

  const capsuleGeo = new THREE.CapsuleGeometry(0.4, 1.2, 8, 16);
  const capsuleMat = new THREE.MeshStandardNodeMaterial({
    color: 0xee8833,
    roughness: 0.4,
    metalness: 0.0,
  });
  const capsule = new THREE.Mesh(capsuleGeo, capsuleMat);
  capsule.castShadow = true;
  capsule.receiveShadow = true;
  scene.add(capsule);

  const characterGroup = new THREE.Group();
  scene.add(characterGroup);
  let characterMixer = null;

  const charDraco = new DRACOLoader();
  charDraco.setDecoderPath(DRACO_URL);
  const charLoader = new GLTFLoader();
  charLoader.setDRACOLoader(charDraco);
  charLoader.load(
    CHAR_GLB,
    (gltf) => {
      const model = gltf.scene;
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material && !o.material.isNodeMaterial) {
            const m = o.material;
            o.material = new THREE.MeshStandardNodeMaterial({
              color: m.color?.getHex?.() ?? 0x888888,
              roughness: m.roughness ?? 0.5,
              metalness: m.metalness ?? 0,
              map: m.map || null,
            });
          }
        }
      });
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      const scale = PARAMS.characterHeight / (size.y || 1);
      model.scale.setScalar(scale);
      box.setFromObject(model);
      box.getCenter(center);
      model.position.sub(center);
      characterGroup.userData.modelBaseY = model.position.y;
      characterGroup.userData.initialCharHeight = PARAMS.characterHeight;
      characterGroup.add(model);

      const HAND_BONE_R = "DEF-handR";
      const HAND_BONE_L = "DEF-handL";
      characterGroup.userData.rightHandBone =
        model.getObjectByName(HAND_BONE_R) || null;
      characterGroup.userData.leftHandBone =
        model.getObjectByName(HAND_BONE_L) || null;

      // Attach a simple sword to the right hand for attack animation work
      const rightHand = characterGroup.userData.rightHandBone;
      if (rightHand) {
        const swordGroup = new THREE.Group();
        const handleGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.18, 8);
        const bladeGeo = new THREE.BoxGeometry(0.015, 0.06, 0.95);
        const handleMat = new THREE.MeshStandardNodeMaterial({
          color: 0x4a3728,
          roughness: 0.8,
          metalness: 0.1,
        });
        const bladeMat = new THREE.MeshStandardNodeMaterial({
          color: 0xc0c8d0,
          roughness: 0.3,
          metalness: 0.8,
        });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        handle.castShadow = true;
        blade.castShadow = true;
        handle.position.set(0, 0, 0);
        blade.position.set(0, 0, 0.565); // blade extends forward from grip
        swordGroup.add(handle);
        swordGroup.add(blade);
        // Adjust so grip sits in palm; tweak these for your rig
        swordGroup.position.set(0.02, 0, 0.04);
        swordGroup.rotation.set(-0.1, 0, 0.15);
        rightHand.add(swordGroup);
        characterGroup.userData.sword = swordGroup;
      }

      // Paraglider/kite for skydiving (Space during jump) — triangular canopy
      const kiteGroup = new THREE.Group();
      const kiteShape = new THREE.Shape();
      kiteShape.moveTo(0, -0.7);       // point at bottom (toward character)
      kiteShape.lineTo(-1.6, 0.6);     // top-left
      kiteShape.lineTo(1.6, 0.6);      // top-right
      kiteShape.closePath();
      const canopyGeo = new THREE.ShapeGeometry(kiteShape);
      const canopyMat = new THREE.MeshStandardNodeMaterial({
        color: 0x2563eb,
        roughness: 0.5,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      const canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.castShadow = true;
      canopy.receiveShadow = true;
      canopy.rotation.x = -0.5; // tilt wide part up to catch air
      canopy.position.set(0, 0.15, 0);
      kiteGroup.add(canopy);
      // Control bar (grip)
      const barGeo = new THREE.BoxGeometry(0.7, 0.04, 0.04);
      const barMat = new THREE.MeshStandardNodeMaterial({
        color: 0x1e293b,
        roughness: 0.7,
        metalness: 0.2,
      });
      const bar = new THREE.Mesh(barGeo, barMat);
      bar.position.set(0, -0.6, 0.35);
      bar.rotation.x = 0.25;
      kiteGroup.add(bar);
      kiteGroup.position.set(0, 1.4, -0.4); // above character, canopy spreads wide
      kiteGroup.rotation.x = 0.12;
      kiteGroup.visible = false;
      characterGroup.add(kiteGroup);
      characterGroup.userData.kite = kiteGroup;

      // Find foot bones for footstep sync (DEF-footL / DEF-footR naming)
      let _fbl = null, _fbr = null;
      model.traverse(o => {
        const n = o.name;
        if (!/foot/i.test(n)) return;
        if (n.endsWith('L') || n.endsWith('l') || n.endsWith('Left')) _fbl = o;
        else if (n.endsWith('R') || n.endsWith('r') || n.endsWith('Right')) _fbr = o;
      });
      characterGroup.userData.footBoneL = _fbl;
      characterGroup.userData.footBoneR = _fbr;
      if (_fbl) console.log('[footsteps] L bone:', _fbl.name);
      if (_fbr) console.log('[footsteps] R bone:', _fbr.name);

      try {
        if (gltf.animations && gltf.animations.length) {
          characterMixer = new THREE.AnimationMixer(model);
          const idleClip =
            gltf.animations.find((a) => a.name === "Idle_Loop") ||
            gltf.animations[0];
          const walkClip =
            gltf.animations.find((a) => a.name === "Walk_Loop") ||
            gltf.animations[0];
          const runClip =
            gltf.animations.find((a) => a.name === "Sprint_Loop") ||
            gltf.animations.find((a) => a.name === "Jog_Fwd_Loop") ||
            walkClip;
          const jumpClip =
            gltf.animations.find((a) => a.name === "Jump_Loop") ||
            gltf.animations.find((a) => a.name === "Jump_Start") ||
            idleClip;
          const attackClip =
            gltf.animations.find((a) => a.name === "Sword_Attack") ||
            gltf.animations.find((a) => a.name === "Sword_Attack_RM") ||
            null;
          const crouchClip =
            gltf.animations.find((a) => a.name === "Crouch_Idle_Loop") ||
            idleClip;
          const crouchWalkClip =
            gltf.animations.find((a) => a.name === "Crouch_Fwd_Loop") ||
            crouchClip;
          const rollClip =
            gltf.animations.find((a) => a.name === "Roll") ||
            gltf.animations.find((a) => a.name === "Roll_RM") ||
            idleClip;
          const idleAction = characterMixer
            .clipAction(idleClip)
            .setLoop(2201)
            .play();
          const walkAction = characterMixer.clipAction(walkClip).setLoop(2201);
          const runAction = characterMixer.clipAction(runClip).setLoop(2201);
          const jumpAction = characterMixer.clipAction(jumpClip).setLoop(2201);
          const attackAction = attackClip
            ? characterMixer.clipAction(attackClip).setLoop(2200)
            : null;
          const crouchAction = characterMixer
            .clipAction(crouchClip)
            .setLoop(2201);
          const crouchWalkAction = characterMixer
            .clipAction(crouchWalkClip)
            .setLoop(2201);
          const rollAction = characterMixer
            .clipAction(rollClip)
            .setLoop(2200);
          if (
            attackAction &&
            attackAction.clampWhenFinished !== undefined
          )
            attackAction.clampWhenFinished = true;
          if (
            rollAction &&
            rollAction.clampWhenFinished !== undefined
          )
            rollAction.clampWhenFinished = true;
          characterGroup.userData.idleAction = idleAction;
          characterGroup.userData.walkAction = walkAction;
          characterGroup.userData.runAction = runAction;
          characterGroup.userData.jumpAction = jumpAction;
          characterGroup.userData.crouchAction = crouchAction;
          characterGroup.userData.crouchWalkAction = crouchWalkAction;
          characterGroup.userData.rollAction = rollAction;
          characterGroup.userData.attackAction = attackAction;
          characterGroup.userData.lastMoveState = "idle";
          characterGroup.userData.isAttacking = false;
          characterGroup.userData.isRolling = false;
          if (attackAction) {
            characterMixer.addEventListener("finished", (e) => {
              if (e.action !== attackAction) return;
              const ud = characterGroup.userData;
              ud.isAttacking = false;
              const from = ud.preAttackState || "idle";
              const toIdle = () => {
                attackAction.enabled = false;
                ud.idleAction.enabled = true;
                ud.idleAction.crossFadeFrom(attackAction, 0.2).play();
              };
              const toWalk = () => {
                attackAction.enabled = false;
                ud.walkAction.enabled = true;
                ud.walkAction.crossFadeFrom(attackAction, 0.2).play();
              };
              const toRun = () => {
                attackAction.enabled = false;
                ud.runAction.enabled = true;
                ud.runAction.crossFadeFrom(attackAction, 0.2).play();
              };
              const toCrouch = () => {
                attackAction.enabled = false;
                ud.crouchAction.enabled = true;
                ud.crouchAction.crossFadeFrom(attackAction, 0.2).play();
              };
              const toCrouchWalk = () => {
                attackAction.enabled = false;
                ud.crouchWalkAction.enabled = true;
                ud.crouchWalkAction.crossFadeFrom(attackAction, 0.2).play();
              };
              if (from === "walk") toWalk();
              else if (from === "run") toRun();
              else if (from === "crouch") toCrouch();
              else if (from === "crouch_walk") toCrouchWalk();
              else toIdle();
              ud.lastMoveState = from;
            });
          }
          if (rollAction) {
            characterMixer.addEventListener("finished", (e) => {
              if (e.action !== rollAction) return;
              const ud = characterGroup.userData;
              ud.isRolling = false;
              const moving = keys.w || keys.s;
              const running = moving && keys.shift;
              const crouching = keys.ctrl;
              const targetState = crouching
                ? moving
                  ? "crouch_walk"
                  : "crouch"
                : moving
                  ? running
                    ? "run"
                    : "walk"
                  : "idle";
              const toIdle = () => {
                ud.idleAction.enabled = true;
                ud.idleAction.crossFadeFrom(rollAction, 0.2).play();
              };
              const toWalk = () => {
                ud.walkAction.enabled = true;
                ud.walkAction.crossFadeFrom(rollAction, 0.2).play();
              };
              const toRun = () => {
                ud.runAction.enabled = true;
                ud.runAction.crossFadeFrom(rollAction, 0.2).play();
              };
              const toCrouch = () => {
                ud.crouchAction.enabled = true;
                ud.crouchAction.crossFadeFrom(rollAction, 0.2).play();
              };
              const toCrouchWalk = () => {
                ud.crouchWalkAction.enabled = true;
                ud.crouchWalkAction.crossFadeFrom(rollAction, 0.2).play();
              };
              if (targetState === "walk") toWalk();
              else if (targetState === "run") toRun();
              else if (targetState === "crouch") toCrouch();
              else if (targetState === "crouch_walk") toCrouchWalk();
              else toIdle();
              ud.lastMoveState = targetState;
              setTimeout(() => {
                rollAction.enabled = false;
              }, 220);
            });
          }
        }
      } catch (e) {
        console.warn("Character animations:", e);
      }
      renderer
        .compileAsync(scene, camera)
        .catch((e) => console.warn("Recompile after character load:", e));
    },
    undefined,
    (err) => {
      console.error("Character GLB load failed:", err);
    },
  );

  const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    e: false,
    f: false,
    shift: false,
    ctrl: false,
    space: false,
    spacePrev: false,
    arrowLeft: false,
    arrowRight: false,
  };
  const state = {
    camYaw: 0,
    camPitch: 0.3,
    characterVelY: 0,
    isGrounded: false,
    isGliding: false,
    moveDir: new THREE.Vector3(),
  };
  // Grace counter: keeps isGrounded true for a few frames after contact loss.
  // Prevents 1-frame flicker on descending slopes and dipping kinematic planks.
  // Cleared immediately on intentional jump so air state engages without delay.
  let _groundGrace = 0;
  let _justJumped  = false;
  let _airFrames = 0;
  let _groundFrames = 0;

  // Capsule resize for crouch-through-tunnel (parkour mode only).
  // _normalHH_c / _crouchHH_c are the capsule half-heights.
  // _crouchShift is how far the body centre moves down/up on transition.
  const _capR_c      = PARAMS.capsuleRadius ?? 0.35;
  const _normalHH_c  = Math.max(0.1, (PARAMS.characterHeight - 2 * _capR_c) / 2);
  const _crouchHH_c  = Math.max(0.05, _normalHH_c * 0.31); // ≈50 % height
  const _crouchShift = _normalHH_c - _crouchHH_c;
  let _isCrouching   = false;
  let _crouchVisualT = 0; // 0 = standing, 1 = fully crouched (lerped for smooth model transition)
  let _platformBody = null;  // kinematic body player stood on last frame
  /** @type {{ [handle: number]: { x: number, y: number, z: number } }} */
  const _lastPlatformPos = {};  // platform handle -> last position for velocity-from-delta
  let isPointerLocked = false;

  // Foot bone Y tracking for footstep sync
  const _footPos = new THREE.Vector3();
  let _footRelYL = null, _footRelYR = null;
  let _footVelL = 0, _footVelR = 0;
  let _footCoolL = 0, _footCoolR = 0;
  let _footCoolGlobal = 0; // prevents L+R from double-firing when sprint plants are close together
  let _wasInAir = false;  // landing detection

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (keys[k] !== undefined) {
      keys[k] = true;
      e.preventDefault();
    }
    if (e.key === "Shift") keys.shift = true;
    if (e.key === "Control") keys.ctrl = true;
    if (e.key === "f" || e.key === "F") keys.f = true;
    if (e.key === " " || e.code === "Space") {
      keys.space = true;
      e.preventDefault();
    }
    if (e.key === "ArrowUp") {
      keys.w = true;
      e.preventDefault();
    }
    if (e.key === "ArrowDown") {
      keys.s = true;
      e.preventDefault();
    }
    if (e.key === "ArrowLeft") {
      keys.arrowLeft = true;
      e.preventDefault();
    }
    if (e.key === "ArrowRight") {
      keys.arrowRight = true;
      e.preventDefault();
    }
  });
  window.addEventListener("keyup", (e) => {
    const k = e.key.toLowerCase();
    if (keys[k] !== undefined) keys[k] = false;
    if (e.key === "Shift") keys.shift = false;
    if (e.key === "Control") keys.ctrl = false;
    if (e.key === "f" || e.key === "F") keys.f = false;
    if (e.key === " " || e.code === "Space") keys.space = false;
    if (e.key === "ArrowUp") keys.w = false;
    if (e.key === "ArrowDown") keys.s = false;
    if (e.key === "ArrowLeft") keys.arrowLeft = false;
    if (e.key === "ArrowRight") keys.arrowRight = false;
  });

  renderer.domElement.addEventListener("click", () => {
    if (PARAMS.cameraMode === "thirdPerson")
      renderer.domElement.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    isPointerLocked = !!document.pointerLockElement;
  });
  renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
  renderer.domElement.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return;
    const ud = characterGroup.userData;
    if (!ud.attackAction || ud.isAttacking || ud.isRolling) return;
    ud.isAttacking = true;
    ud.preAttackState = ud.lastMoveState || "idle";
    ud.attackAction.stop();
    ud.attackAction.time = 0;
    ud.attackAction.enabled = true;
    const from =
      ud.preAttackState === "run"
        ? ud.runAction
        : ud.preAttackState === "walk"
          ? ud.walkAction
          : ud.preAttackState === "jump"
            ? ud.jumpAction
            : ud.preAttackState === "crouch"
              ? ud.crouchAction
              : ud.preAttackState === "crouch_walk"
                ? ud.crouchWalkAction
                : ud.idleAction;
    ud.attackAction.crossFadeFrom(from, 0.1).play();
  });
  document.addEventListener("mousemove", (e) => {
    if (!isPointerLocked && !(e.buttons & 1)) return;
    const sens = PARAMS.mouseSensitivity;
    state.camYaw += e.movementX * sens;
    state.camPitch -= e.movementY * sens;
    state.camPitch = Math.max(
      PARAMS.camPitchMin,
      Math.min(PARAMS.camPitchMax, state.camPitch),
    );
  });

  function update(dt) {
    if (keys.arrowLeft || keys.a) state.camYaw += PARAMS.keyTurnSpeed * dt;
    if (keys.arrowRight || keys.d) state.camYaw -= PARAMS.keyTurnSpeed * dt;

    // ── CROUCH TRANSITION (parkour mode only) ──────────────────────────────
    // Shrinks / restores the capsule collider half-height each time the player
    // enters or leaves crouch.  A headroom ray-cast prevents standing up inside
    // a tunnel.  _crouchDeltaY carries the required Y shift into desiredY below.
    let _crouchDeltaY = 0;
    if (!hasSampleHeight) {
      const wantCrouch = keys.ctrl && state.isGrounded;
      if (wantCrouch && !_isCrouching) {
        playerCollider.setHalfHeight(_crouchHH_c);
        _isCrouching  = true;
        _crouchDeltaY = -_crouchShift;          // move centre down this frame
      } else if (!wantCrouch && _isCrouching) {
        // Ray upward from top of crouching capsule — check if normal height fits
        let canStand = true;
        if (RAPIER) {
          const ray = new RAPIER.Ray(
            { x: charPos.x, y: charPos.y + _crouchHH_c + _capR_c + 0.02, z: charPos.z },
            { x: 0, y: 1, z: 0 });
          const hit = physicsWorld.castRay(ray, _crouchShift + 0.05, true,
            undefined, undefined, playerCollider);
          canStand = (hit === null);
        }
        if (canStand) {
          playerCollider.setHalfHeight(_normalHH_c);
          _isCrouching  = false;
          _crouchDeltaY = _crouchShift;         // move centre up this frame
        }
      }
    }

    // Smooth visual lerp — physics snaps instantly, model eases over ~0.15 s
    _crouchVisualT += ((_isCrouching ? 1 : 0) - _crouchVisualT) * Math.min(10 * dt, 1);

    state.moveDir.set(0, 0, 0);
    let desiredDx = 0;
    let desiredDz = 0;
    const onGroundForCrouch = hasSampleHeight
      ? charPos.y <= (sampleHeight(charPos.x, charPos.z) + capHalfH + capR) + 0.6
      : state.isGrounded;
    const ud = characterGroup.userData;
    if (
      keys.f &&
      ud &&
      ud.rollAction &&
      !ud.isRolling &&
      !ud.isAttacking &&
      onGroundForCrouch
    ) {
      keys.f = false;
      ud.isRolling = true;
      ud.preRollState = ud.lastMoveState || "idle";
      ud.rollStartTime = performance.now();
      ud.rollDuration = ud.rollAction.getClip().duration || 1;
      ud.rollYaw = state.camYaw; // lock direction at roll start
      const from =
        ud.preRollState === "run"
          ? ud.runAction
          : ud.preRollState === "walk"
            ? ud.walkAction
            : ud.preRollState === "crouch"
              ? ud.crouchAction
              : ud.preRollState === "crouch_walk"
                ? ud.crouchWalkAction
                : ud.preRollState === "jump"
                  ? ud.jumpAction
                  : ud.idleAction;
      ud.rollAction.stop();
      ud.rollAction.time = 0;
      ud.rollAction.enabled = true;
      ud.rollAction.crossFadeFrom(from, 0.1).play();
    }
    if (keys.w) state.moveDir.z -= 1;
    if (keys.s) state.moveDir.z += 1;
    if (state.moveDir.length() > 0) {
      state.moveDir.normalize();
      const sinY = Math.sin(state.camYaw);
      const cosY = Math.cos(state.camYaw);
      const forwardX = sinY;
      const forwardZ = cosY;
      const rightX = cosY;
      const rightZ = -sinY;
      const mx = state.moveDir.x * rightX - state.moveDir.z * forwardX;
      const mz = state.moveDir.x * rightZ - state.moveDir.z * forwardZ;
      const speedMult =
        _isCrouching
          ? (PARAMS.crouchSpeedMultiplier ?? 0.5)
          : keys.shift
            ? PARAMS.runSpeedMultiplier
            : 1;
      desiredDx = mx * PARAMS.playerSpeed * speedMult * dt;
      desiredDz = mz * PARAMS.playerSpeed * speedMult * dt;
    }
    if (ud && ud.isRolling && ud.rollDuration > 0) {
      const elapsed = (performance.now() - ud.rollStartTime) / 1000;
      const t = Math.min(1, elapsed / ud.rollDuration);
      const ease = Math.cos(t * Math.PI * 0.5); // 1→0 smooth ease-out
      const rollSpeed = ((PARAMS.rollDashDistance ?? 8) / ud.rollDuration) * ease;
      const sinY = Math.sin(ud.rollYaw ?? state.camYaw);
      const cosY = Math.cos(ud.rollYaw ?? state.camYaw);
      desiredDx = sinY * rollSpeed * dt; // override WASD, no stacking
      desiredDz = cosY * rollSpeed * dt;
    }
    const hb = TERRAIN_SIZE * 0.48;
    const nextX = Math.max(-hb, Math.min(hb, charPos.x + desiredDx));
    const nextZ = Math.max(-hb, Math.min(hb, charPos.z + desiredDz));
    const groundY = hasSampleHeight ? sampleHeight(charPos.x, charPos.z) + capHalfH + capR : 0;
    const nextGroundY = hasSampleHeight ? sampleHeight(nextX, nextZ) + capHalfH + capR : 0;
    const onGround = hasSampleHeight ? charPos.y <= groundY + 0.6 : state.isGrounded;
    let desiredY;
    if (onGround) {
      if (keys.space && !_isCrouching) {   // no jumping while crouched
        state.characterVelY = PARAMS.jumpSpeed;
        _justJumped = true;
        desiredY = charPos.y + state.characterVelY * dt;
      } else {
        state.characterVelY = 0;
        // terrain mode: follow heightmap; parkour mode: tiny dt-scaled downward push
        // ONLY while moving so the capsule stays in contact with descending slopes.
        // Skip it when standing still to avoid floating-point drift that sinks the character.
        const isMovingH = desiredDx * desiredDx + desiredDz * desiredDz > 1e-6;
        desiredY = hasSampleHeight ? nextGroundY
                 : isMovingH       ? charPos.y - 0.5 * dt
                 :                   charPos.y;
      }
    } else {
      // Glider toggle: Space mid-air opens/closes (press again to close)
      const spaceJustPressed = keys.space && !keys.spacePrev;
      if (spaceJustPressed) state.isGliding = !state.isGliding;

      state.characterVelY -= PARAMS.gravity * dt;
      if (state.isGliding) {
        const cap = -(PARAMS.glideFallSpeed ?? 3);
        state.characterVelY = Math.max(state.characterVelY, cap);
      }
      desiredY = charPos.y + state.characterVelY * dt;
    }
    // Apply one-frame Y shift from crouch start/end (moves centre down or up)
    desiredY += _crouchDeltaY;

    // Proactively detect kinematic platform via downward ray cast BEFORE computing
    // desired movement. MUST run every frame in parkour mode — when platform descends,
    // computedGrounded() becomes false and we'd stop inheriting velocity, leaving us floating.
    if (!hasSampleHeight && RAPIER) {
      const capBottom = charPos.y - _normalHH_c - _capR_c;
      const ray = new RAPIER.Ray({ x: charPos.x, y: capBottom + 0.02, z: charPos.z }, { x: 0, y: -1, z: 0 });
      const hit = physicsWorld.castRay(ray, 0.35, true, undefined, undefined, playerCollider);
      if (hit) {
        const hitCol = physicsWorld.getCollider(hit.collider);
        const hitBody = hitCol?.parent?.();
        _platformBody = hitBody?.isKinematic?.() ? hitBody : null;
      } else {
        _platformBody = null;
      }
    }

    // Inherit velocity from the detected kinematic platform.
    // Rapier auto-computes linvel() for kinematicPositionBased bodies from their
    // setNextKinematicTranslation delta each step, so we can read it directly.
    // Skip when we've just jumped (positive velY) so we don't get pulled down mid-jump.
    let platDx = 0, platDy = 0, platDz = 0;
    if (!hasSampleHeight && _platformBody && state.characterVelY <= 0.5 && state.isGrounded) {
      const vel = _platformBody.linvel();
      platDx = vel.x * dt;
      platDy = vel.y * dt;
      platDz = vel.z * dt;
    }

    const desiredTranslation = {
      x: nextX - charPos.x + platDx,
      y: desiredY - charPos.y + platDy,
      z: nextZ - charPos.z + platDz,
    };
    // Disable autostep while airborne so jumping in front of a low obstacle doesn't
    // autostep onto it before the jump fires (looks like a double-jump snap).
    if (!hasSampleHeight) {
      if (state.characterVelY > 0) {
        characterController.disableAutostep();
      } else {
        characterController.enableAutostep(0.35, 0.1, false);
      }
    }
    characterController.computeColliderMovement(
      playerCollider,
      desiredTranslation,
    );
    // Push dynamic bodies the character walked into.
    // Kinematic bodies don't generate contact forces automatically (unlike dynamic ones),
    // so we read what the controller hit this frame and apply an impulse manually.
    // str = 3/mass → light boxes (1kg) fly, medium (15kg) slide, heavy (80kg) barely budge.
    const movLen = Math.sqrt(desiredTranslation.x ** 2 + desiredTranslation.z ** 2);
    if (movLen > 0.0001) {
      for (let i = 0; i < characterController.numComputedCollisions(); i++) {
        const col = characterController.computedCollision(i);
        const hitBody = col?.collider?.parent?.();
        if (!hitBody?.isDynamic?.()) continue;
        const str = 3 / Math.max(hitBody.mass(), 1);
        hitBody.applyImpulse({
          x: (desiredTranslation.x / movLen) * str,
          y: 0.1 * str,
          z: (desiredTranslation.z / movLen) * str,
        }, true);
      }
    }
    // Transfer player weight to dynamic bodies the character stands on (e.g. bridge planks).
    // Collision normal pointing up (ny > 0.6) means the character is resting on that surface.
    // This makes planks sag and sway even when the player is standing still.
    if (!hasSampleHeight) {
      for (let i = 0; i < characterController.numComputedCollisions(); i++) {
        const col = characterController.computedCollision(i);
        if (!col?.normal1 || col.normal1.y < 0.6) continue;
        const hitBody = col?.collider?.parent?.();
        if (!hitBody?.isDynamic?.()) continue;
        // Weight impulse: scale with plank mass so lighter planks react more
        const w = Math.min(3 / Math.max(hitBody.mass(), 0.5), 1.5);
        hitBody.applyImpulse({ x: 0, y: -PARAMS.gravity * w * dt, z: 0 }, true);
      }
    }
    // _platformBody is now set by the proactive ray cast above (before computeColliderMovement).
    if (hasSampleHeight) {
      // terrain mode: ground truth comes from heightmap
      state.isGrounded = onGround;
      if (onGround) state.isGliding = false;
      const landedGroundY = sampleHeight(charPos.x, charPos.z) + capHalfH + capR;
      if (state.characterVelY < 0 && charPos.y <= landedGroundY + 0.2) state.characterVelY = 0;
    } else {
      // parkour mode: Rapier trimesh colliders are ground truth.
      // Grace period prevents flicker on dipping planks and descending slopes.
      // Longer grace (8 frames) when on kinematic platform — computedGrounded() is unreliable when it descends.
      const rawGrounded = characterController.computedGrounded();
      const graceMax = _platformBody ? 4 : 3;
      if (_justJumped) {
        _justJumped = false;
        _groundGrace = 0;
        state.isGrounded = false;
      } else if (rawGrounded) {
        _groundGrace = graceMax;
        state.isGrounded = true;
      } else if (_groundGrace > 0) {
        _groundGrace--;
        state.isGrounded = true;
      } else {
        state.isGrounded = false;
      }
      if (state.isGrounded) {
        if (state.characterVelY < 0) state.characterVelY = 0;
        state.isGliding = false; // landing auto-closes glider
      }
    }
    const corrected = characterController.computedMovement();
    const cur = playerBody.translation();
    let nextPosY = cur.y + corrected.y;
    // When standing up, the KCC/snap-to-ground can reject upward movement, leaving
    // the expanded capsule partly in the ground. Enforce minimum rise so feet stay on surface.
    if (_crouchDeltaY > 0) {
      nextPosY = Math.max(nextPosY, cur.y + _crouchDeltaY);
    }
    const nextPos = {
      x: cur.x + corrected.x,
      y: nextPosY,
      z: cur.z + corrected.z,
    };
    playerBody.setNextKinematicTranslation(nextPos);
    physicsWorld.step();
    const playerT = playerBody.translation();
    charPos.set(playerT.x, playerT.y, playerT.z);
    // Post-step correction: push character out of kinematic platforms (elevators, sweepers)
    // that moved into us — Rapier KCC doesn't resolve kinematic-kinematic collisions.
    let onKinematicPlatform = false;
    if (!hasSampleHeight && RAPIER) {
      const result = resolveKinematicOverlap(
        RAPIER,
        physicsWorld,
        playerBody,
        playerCollider,
        charPos,
        _normalHH_c,
        _capR_c,
        _isCrouching,
        _crouchHH_c,
        dt,
        _lastPlatformPos,
      );
      onKinematicPlatform = result.isOnKinematicPlatform;
      if (debugOut) {
        debugOut._result = result;
      }
    }
    if (onKinematicPlatform) {
      state.isGrounded = true;
      _groundGrace = 2;
    } else {
      // Clear platform position cache when off platform to avoid huge delta on re-mount
      for (const k of Object.keys(_lastPlatformPos)) delete _lastPlatformPos[k];
    }
    const rawInAir = hasSampleHeight
      ? charPos.y > (sampleHeight(charPos.x, charPos.z) + capHalfH + capR) + 0.15
      : !state.isGrounded;
    if (rawInAir) {
      _airFrames++;
      _groundFrames = 0;
    } else {
      _groundFrames++;
      _airFrames = 0;
    }
    const lastWasJump = ud?.lastMoveState === "jump";
    const inAir = onKinematicPlatform
      ? false
      : rawInAir
        ? _airFrames >= 2
        : lastWasJump && _groundFrames < 8;
    if (debugOut && debugOut._result) {
      Object.assign(debugOut, {
        onKinematicPlatform,
        platformBody: !!_platformBody,
        charPosY: charPos.y.toFixed(3),
        isGrounded: state.isGrounded,
        rawInAir,
        inAir,
        moveState: inAir ? "jump" : "idle",
        snapToY: debugOut._result.snapToY?.toFixed(3) ?? "null",
        totalDy: debugOut._result.totalDy?.toFixed(3) ?? "0",
        charBottom: debugOut._result.charBottom?.toFixed(3) ?? "?",
        didCorrect: debugOut._result.didCorrect,
      });
      delete debugOut._result;
    }
    characterGroup.position.copy(charPos);
    characterGroup.rotation.y = state.camYaw;
    if (characterGroup.children.length > 0) {
      if (ud.initialCharHeight != null)
        characterGroup.scale.setScalar(
          PARAMS.characterHeight / ud.initialCharHeight,
        );
      if (ud.modelBaseY != null)
        // Offset model upward to counteract the capsule-centre drop during crouch.
        // Uses the lerped _crouchVisualT so the transition eases in/out smoothly.
        characterGroup.children[0].position.y =
          ud.modelBaseY + PARAMS.characterOffsetY + _crouchVisualT * _crouchShift;
    }
    capsule.visible = characterGroup.children.length === 0;
    if (ud?.kite) ud.kite.visible = state.isGliding;
    const moving = state.moveDir.length() > 0;
    const running = moving && keys.shift;
    const crouching = _isCrouching;
    const moveState = inAir
      ? "jump"
      : crouching
        ? moving
          ? "crouch_walk"
          : "crouch"
        : moving
          ? running
            ? "run"
            : "walk"
          : "idle";
    // Early roll exit: if player holds a direction past 75% of the animation,
    // skip waiting for 'finished' and snap to walk/run immediately.
    if (ud?.isRolling && ud.rollStartTime && ud.rollDuration > 0 && moving && !inAir) {
      const rollT = (performance.now() - ud.rollStartTime) / 1000 / ud.rollDuration;
      if (rollT >= 0.75) {
        ud.isRolling = false;
        const target =
          moveState === "run"         ? ud.runAction :
          moveState === "crouch_walk" ? ud.crouchWalkAction :
          moveState === "crouch"      ? ud.crouchAction :
                                        ud.walkAction;
        if (target && ud.rollAction) {
          target.enabled = true;
          target.crossFadeFrom(ud.rollAction, 0.15).play();
          setTimeout(() => { if (ud.rollAction) ud.rollAction.enabled = false; }, 150);
        }
        ud.lastMoveState = moveState; // prevent state machine double-transition
      }
    }
    if (
      ud &&
      ud.idleAction &&
      ud.walkAction &&
      ud.runAction &&
      ud.jumpAction &&
      ud.crouchAction &&
      ud.crouchWalkAction &&
      !ud.isAttacking &&
      !ud.isRolling
    ) {
      const skipT = 0.4;
      const last = ud.lastMoveState;
      if (moveState !== last) {
        const toWalk = () => {
          if (ud.walkAction.time < skipT) ud.walkAction.time = skipT;
          ud.walkAction.enabled = true;
          ud.walkAction.crossFadeFrom(ud.idleAction, 0.2).play();
        };
        const toRun = () => {
          if (ud.runAction.time < skipT) ud.runAction.time = skipT;
          ud.runAction.enabled = true;
          ud.runAction.crossFadeFrom(ud.idleAction, 0.2).play();
        };
        const toIdle = (from) => {
          if (ud.idleAction.time < skipT) ud.idleAction.time = skipT;
          ud.idleAction.enabled = true;
          ud.idleAction.crossFadeFrom(from, 0.2).play();
        };
        const toJump = (from) => {
          if (ud.jumpAction.time < skipT) ud.jumpAction.time = skipT;
          ud.jumpAction.enabled = true;
          ud.jumpAction.crossFadeFrom(from, 0.15).play();
        };
        const toCrouch = (from) => {
          if (ud.crouchAction.time < skipT) ud.crouchAction.time = skipT;
          ud.crouchAction.enabled = true;
          ud.crouchAction.crossFadeFrom(from, 0.2).play();
        };
        const toCrouchWalk = (from) => {
          if (ud.crouchWalkAction.time < skipT) ud.crouchWalkAction.time = skipT;
          ud.crouchWalkAction.enabled = true;
          ud.crouchWalkAction.crossFadeFrom(from, 0.2).play();
        };
        if (moveState === "jump") {
          toJump(
            last === "idle"
              ? ud.idleAction
              : last === "run"
                ? ud.runAction
                : last === "crouch"
                  ? ud.crouchAction
                  : last === "crouch_walk"
                    ? ud.crouchWalkAction
                    : ud.walkAction,
          );
        } else if (moveState === "crouch") {
          if (last === "idle") toCrouch(ud.idleAction);
          else if (last === "walk") toCrouch(ud.walkAction);
          else if (last === "run") toCrouch(ud.runAction);
          else if (last === "jump") toCrouch(ud.jumpAction);
          else if (last === "crouch_walk") {
            if (ud.crouchAction.time < skipT) ud.crouchAction.time = skipT;
            ud.crouchAction.enabled = true;
            ud.crouchAction.crossFadeFrom(ud.crouchWalkAction, 0.2).play();
          }
        } else if (moveState === "crouch_walk") {
          if (last === "idle") toCrouchWalk(ud.idleAction);
          else if (last === "walk") toCrouchWalk(ud.walkAction);
          else if (last === "run") toCrouchWalk(ud.runAction);
          else if (last === "jump") toCrouchWalk(ud.jumpAction);
          else if (last === "crouch") {
            if (ud.crouchWalkAction.time < skipT) ud.crouchWalkAction.time = skipT;
            ud.crouchWalkAction.enabled = true;
            ud.crouchWalkAction.crossFadeFrom(ud.crouchAction, 0.2).play();
          }
        } else if (moveState === "walk") {
          if (last === "idle") toWalk();
          else if (last === "crouch") {
            if (ud.walkAction.time < skipT) ud.walkAction.time = skipT;
            ud.walkAction.enabled = true;
            ud.walkAction.crossFadeFrom(ud.crouchAction, 0.2).play();
          } else if (last === "crouch_walk") {
            if (ud.walkAction.time < skipT) ud.walkAction.time = skipT;
            ud.walkAction.enabled = true;
            ud.walkAction.crossFadeFrom(ud.crouchWalkAction, 0.2).play();
          } else if (last === "run") {
            if (ud.walkAction.time < skipT) ud.walkAction.time = skipT;
            ud.walkAction.enabled = true;
            ud.walkAction.crossFadeFrom(ud.runAction, 0.2).play();
          } else if (last === "jump") {
            if (ud.walkAction.time < skipT) ud.walkAction.time = skipT;
            ud.walkAction.enabled = true;
            ud.walkAction.crossFadeFrom(ud.jumpAction, 0.2).play();
          }
        } else if (moveState === "run") {
          if (last === "idle") toRun();
          else if (last === "crouch") {
            if (ud.runAction.time < skipT) ud.runAction.time = skipT;
            ud.runAction.enabled = true;
            ud.runAction.crossFadeFrom(ud.crouchAction, 0.2).play();
          } else if (last === "crouch_walk") {
            if (ud.runAction.time < skipT) ud.runAction.time = skipT;
            ud.runAction.enabled = true;
            ud.runAction.crossFadeFrom(ud.crouchWalkAction, 0.2).play();
          } else if (last === "walk") {
            if (ud.runAction.time < skipT) ud.runAction.time = skipT;
            ud.runAction.enabled = true;
            ud.runAction.crossFadeFrom(ud.walkAction, 0.2).play();
          } else if (last === "jump") {
            if (ud.runAction.time < skipT) ud.runAction.time = skipT;
            ud.runAction.enabled = true;
            ud.runAction.crossFadeFrom(ud.jumpAction, 0.2).play();
          }
        } else {
          toIdle(
            last === "jump"
              ? ud.jumpAction
              : last === "run"
                ? ud.runAction
                : last === "crouch"
                  ? ud.crouchAction
                  : last === "crouch_walk"
                    ? ud.crouchWalkAction
                    : ud.walkAction,
          );
        }
        ud.lastMoveState = moveState;
      }
    }
    if (characterMixer) characterMixer.update(dt);

    keys.spacePrev = keys.space;

    // ── FOOTSTEP SYNC ─────────────────────────────────────────────────────
    // Track each foot bone's Y relative to character centre.
    // When velocity crosses from negative → zero/positive the foot just planted.
    if (footstepAudio && !inAir && moving) {
      const fud = characterGroup.userData;
      _footCoolL = Math.max(0, _footCoolL - dt);
      _footCoolR = Math.max(0, _footCoolR - dt);
      _footCoolGlobal = Math.max(0, _footCoolGlobal - dt);
      const stepVol = _isCrouching ? 0.22 : 0.38;
      const perFootCool = running ? 0.22 : 0.18;

      if (fud.footBoneL) {
        fud.footBoneL.getWorldPosition(_footPos);
        const relY = _footPos.y - charPos.y;
        if (_footRelYL !== null) {
          const vel = relY - _footRelYL;
          if (_footCoolL <= 0 && _footCoolGlobal <= 0 && _footVelL < -0.001 && vel >= -0.001) {
            footstepAudio.play(running, stepVol);
            _footCoolL = perFootCool;
            _footCoolGlobal = 0.1;
          }
          _footVelL = vel;
        }
        _footRelYL = relY;
      }

      if (fud.footBoneR) {
        fud.footBoneR.getWorldPosition(_footPos);
        const relY = _footPos.y - charPos.y;
        if (_footRelYR !== null) {
          const vel = relY - _footRelYR;
          if (_footCoolR <= 0 && _footCoolGlobal <= 0 && _footVelR < -0.001 && vel >= -0.001) {
            footstepAudio.play(running, stepVol);
            _footCoolR = perFootCool;
            _footCoolGlobal = 0.1;
          }
          _footVelR = vel;
        }
        _footRelYR = relY;
      }
    } else {
      // Reset on stop/air so no false trigger when movement resumes
      _footRelYL = null;
      _footRelYR = null;
    }

    // Landing sound — fires once on the frame inAir flips false
    if (_wasInAir && !inAir && footstepAudio) {
      footstepAudio.playLanding();
    }
    _wasInAir = inAir;
    if (
      ud &&
      ud.isAttacking &&
      ud.attackAction &&
      ud.idleAction &&
      ud.walkAction &&
      ud.runAction
    ) {
      const clip = ud.attackAction.getClip();
      const dur = clip && clip.duration != null ? clip.duration : 1;
      if (ud.attackAction.time >= dur - 0.02) {
        ud.isAttacking = false;
        const from = ud.preAttackState || "idle";
        ud.attackAction.enabled = false;
        ud.attackAction.time = 0;
        if (from === "walk") {
          ud.walkAction.enabled = true;
          ud.walkAction.crossFadeFrom(ud.attackAction, 0.15).play();
        } else if (from === "run") {
          ud.runAction.enabled = true;
          ud.runAction.crossFadeFrom(ud.attackAction, 0.15).play();
        } else if (from === "crouch") {
          ud.crouchAction.enabled = true;
          ud.crouchAction.crossFadeFrom(ud.attackAction, 0.15).play();
        } else if (from === "crouch_walk") {
          ud.crouchWalkAction.enabled = true;
          ud.crouchWalkAction.crossFadeFrom(ud.attackAction, 0.15).play();
        } else {
          ud.idleAction.enabled = true;
          ud.idleAction.crossFadeFrom(ud.attackAction, 0.15).play();
        }
        ud.lastMoveState = from;
      }
    }
  }

  return {
    characterGroup,
    capsule,
    keys,
    state,
    update,
  };
}
