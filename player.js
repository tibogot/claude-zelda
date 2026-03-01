/**
 * Player character: capsule placeholder, GLTF model, input, movement, animation.
 * createPlayer(opts) returns { characterGroup, capsule, keys, state, update(dt) }.
 * state = { camYaw, camPitch, characterVelY, moveDir } (mutable).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

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
 * @param {(x: number, z: number) => number} opts.sampleHeight
 * @param {number} opts.capR
 * @param {number} opts.capHalfH
 * @param {number} opts.TERRAIN_SIZE
 * @returns {{ characterGroup: THREE.Group, capsule: THREE.Mesh, keys: object, state: { camYaw: number, camPitch: number, characterVelY: number, moveDir: THREE.Vector3 }, update: (dt: number) => void }}
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
    sampleHeight,
    capR,
    capHalfH,
    TERRAIN_SIZE,
  } = opts;

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
              const moving = keys.w || keys.s || keys.a || keys.d;
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
    arrowLeft: false,
    arrowRight: false,
  };
  const state = {
    camYaw: 0,
    camPitch: 0.3,
    characterVelY: 0,
    moveDir: new THREE.Vector3(),
  };
  let isPointerLocked = false;

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
    if (keys.arrowLeft) state.camYaw += PARAMS.keyTurnSpeed * dt;
    if (keys.arrowRight) state.camYaw -= PARAMS.keyTurnSpeed * dt;
    state.moveDir.set(0, 0, 0);
    let desiredDx = 0;
    let desiredDz = 0;
    const groundYForCrouch =
      sampleHeight(charPos.x, charPos.z) + capHalfH + capR;
    const onGroundForCrouch = charPos.y <= groundYForCrouch + 0.6;
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
    if (keys.a) state.moveDir.x -= 1;
    if (keys.d) state.moveDir.x += 1;
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
        keys.ctrl && onGroundForCrouch
          ? (PARAMS.crouchSpeedMultiplier ?? 0.5)
          : keys.shift
            ? PARAMS.runSpeedMultiplier
            : 1;
      desiredDx = mx * PARAMS.playerSpeed * speedMult * dt;
      desiredDz = mz * PARAMS.playerSpeed * speedMult * dt;
    }
    if (ud && ud.isRolling && ud.rollDuration > 0) {
      const rollSpeed = (PARAMS.rollDashDistance ?? 8) / ud.rollDuration;
      const sinY = Math.sin(state.camYaw);
      const cosY = Math.cos(state.camYaw);
      desiredDx += sinY * rollSpeed * dt;
      desiredDz += cosY * rollSpeed * dt;
    }
    const hb = TERRAIN_SIZE * 0.48;
    const nextX = Math.max(-hb, Math.min(hb, charPos.x + desiredDx));
    const nextZ = Math.max(-hb, Math.min(hb, charPos.z + desiredDz));
    const groundY =
      sampleHeight(charPos.x, charPos.z) + capHalfH + capR;
    const nextGroundY = sampleHeight(nextX, nextZ) + capHalfH + capR;
    const onGround = charPos.y <= groundY + 0.6;
    let desiredY;
    if (onGround) {
      if (keys.space) {
        state.characterVelY = PARAMS.jumpSpeed;
        desiredY = charPos.y + state.characterVelY * dt;
      } else {
        state.characterVelY = 0;
        desiredY = nextGroundY;
      }
    } else {
      state.characterVelY -= PARAMS.gravity * dt;
      desiredY = charPos.y + state.characterVelY * dt;
    }
    const desiredTranslation = {
      x: nextX - charPos.x,
      y: desiredY - charPos.y,
      z: nextZ - charPos.z,
    };
    characterController.computeColliderMovement(
      playerCollider,
      desiredTranslation,
    );
    const corrected = characterController.computedMovement();
    const cur = playerBody.translation();
    const nextPos = {
      x: cur.x + corrected.x,
      y: cur.y + corrected.y,
      z: cur.z + corrected.z,
    };
    playerBody.setNextKinematicTranslation(nextPos);
    physicsWorld.step();
    const playerT = playerBody.translation();
    charPos.set(playerT.x, playerT.y, playerT.z);
    const landedGroundY =
      sampleHeight(charPos.x, charPos.z) + capHalfH + capR;
    if (state.characterVelY < 0 && charPos.y <= landedGroundY + 0.2)
      state.characterVelY = 0;
    const inAir = charPos.y > landedGroundY + 0.15;
    characterGroup.position.copy(charPos);
    characterGroup.rotation.y = state.camYaw;
    if (characterGroup.children.length > 0) {
      const ud = characterGroup.userData;
      if (ud.initialCharHeight != null)
        characterGroup.scale.setScalar(
          PARAMS.characterHeight / ud.initialCharHeight,
        );
      if (ud.modelBaseY != null)
        characterGroup.children[0].position.y =
          ud.modelBaseY + PARAMS.characterOffsetY;
    }
    capsule.visible = characterGroup.children.length === 0;
    const moving = state.moveDir.length() > 0;
    const running = moving && keys.shift;
    const crouching = keys.ctrl && !inAir;
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
