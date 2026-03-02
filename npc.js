/**
 * NPC: same GLB as player, walks on flat floor. Parkour-only.
 * Mirrors player pattern: capsule placeholder until model loads, compileAsync for WebGPU.
 * createNpc(opts) returns { group, capsule, update(dt) }.
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
 * @param {object} opts.parkourParams - Must have opts.parkourParams.npc { enabled, speed, walkRadius, directionChangeInterval }
 * @param {number} opts.FLOOR_Y
 * @param {number} opts.PARKOUR_SIZE
 * @param {number} opts.characterHeight
 * @param {number} [opts.capsuleRadius]
 * @param {{ pos: THREE.Vector3, yaw: number }} [opts.spawnInFrontOf] - Spawn in front of this position/facing
 * @param {number} [opts.spawnDistance] - Distance in front when using spawnInFrontOf
 * @param {THREE.Vector3} [opts.playerPos] - Player position for proximity checks (idle when near)
 * @returns {{ group: THREE.Group, capsule: THREE.Mesh, update: (dt: number) => void }}
 */
export function createNpc(opts) {
  const {
    scene,
    renderer,
    camera,
    parkourParams,
    FLOOR_Y,
    PARKOUR_SIZE,
    characterHeight,
    capsuleRadius = 0.35,
    spawnInFrontOf = null,
    spawnDistance = 4,
    playerPos = null,
  } = opts;

  const capR = capsuleRadius;
  const capHalfH = Math.max(0.1, (characterHeight - 2 * capR) / 2);

  const capsuleGeo = new THREE.CapsuleGeometry(0.4, 1.2, 8, 16);
  const capsuleMat = new THREE.MeshStandardNodeMaterial({
    color: 0x33aa88,
    roughness: 0.4,
    metalness: 0.0,
  });
  const capsule = new THREE.Mesh(capsuleGeo, capsuleMat);
  capsule.castShadow = true;
  capsule.receiveShadow = true;
  scene.add(capsule);
  capsule.visible = false;

  const group = new THREE.Group();
  scene.add(group);
  group.visible = false;

  let mixer = null;
  let walkAction = null;
  let idleAction = null;
  let baseScale = 1;
  group.userData.modelBaseY = 0;
  group.userData.initialCharHeight = characterHeight;

  const half = PARKOUR_SIZE / 2;
  const heightOffset = capHalfH + capR;
  let currentYaw = 0;
  let pos;
  if (spawnInFrontOf) {
    const fwdX = Math.sin(spawnInFrontOf.yaw);
    const fwdZ = -Math.cos(spawnInFrontOf.yaw);
    pos = new THREE.Vector3(
      spawnInFrontOf.pos.x + fwdX * spawnDistance,
      FLOOR_Y + heightOffset,
      spawnInFrontOf.pos.z + fwdZ * spawnDistance,
    );
  } else {
    pos = new THREE.Vector3(30, FLOOR_Y + heightOffset, 30);
  }
  if (spawnInFrontOf) {
    currentYaw = spawnInFrontOf.yaw;
  }
  let dir = new THREE.Vector3(1, 0, 0);
  let dirChangeTimer = 0;
  let wasNearPlayer = false;

  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_URL);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load(
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
      baseScale = characterHeight / (size.y || 1);
      model.scale.setScalar(baseScale);
      box.setFromObject(model);
      box.getCenter(center);
      model.position.sub(center);
      group.userData.modelBaseY = model.position.y;
      group.add(model);

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        const idleClip =
          gltf.animations.find((a) => a.name === "Idle_Loop") ||
          gltf.animations[0];
        const walkClip =
          gltf.animations.find((a) => a.name === "Walk_Loop") ||
          gltf.animations.find((a) => a.name === "Jog_Fwd_Loop") ||
          gltf.animations[0];
        idleAction = mixer.clipAction(idleClip).setLoop(2201);
        walkAction = mixer.clipAction(walkClip).setLoop(2201);
        walkAction.play();
      }
      renderer
        .compileAsync(scene, camera)
        .catch((e) => console.warn("Recompile after NPC load:", e));
    },
    undefined,
    (err) => console.error("NPC GLB load failed:", err),
  );

  const _toPlayer = new THREE.Vector3();

  function update(dt) {
    const npc = parkourParams.npc;
    const enabled = !!npc.enabled;
    group.visible = enabled;
    capsule.visible = enabled && group.children.length === 0;

    if (!enabled) return;

    if (mixer) mixer.update(dt);

    const idleWhenNear = !!npc.idleWhenNearPlayer && playerPos;
    const nearDist = npc.nearPlayerDistance ?? 4;
    let isNearPlayer = false;
    if (idleWhenNear) {
      _toPlayer.set(playerPos.x - pos.x, 0, playerPos.z - pos.z);
      isNearPlayer = _toPlayer.length() < nearDist;
    }

    if (isNearPlayer) {
      if (!wasNearPlayer) {
        wasNearPlayer = true;
        if (walkAction?.isRunning()) {
          if (idleAction) {
            idleAction.enabled = true;
            idleAction.crossFadeFrom(walkAction, 0.35).play();
          }
        } else {
          idleAction?.play();
        }
      }
    } else {
      const speed = npc.speed ?? 2;
      const walkRadius = npc.walkRadius ?? 100;
      const interval = npc.directionChangeInterval ?? 3;

      if (wasNearPlayer) {
        wasNearPlayer = false;
        if (walkAction) {
          walkAction.enabled = true;
          if (idleAction?.isRunning()) {
            if (walkAction.time < 0.1) walkAction.time = 0.1;
            walkAction.crossFadeFrom(idleAction, 0.35).play();
          } else {
            walkAction.play();
          }
        }
      }

      dirChangeTimer -= dt;
      if (dirChangeTimer <= 0) {
        dirChangeTimer = interval;
        const angle = Math.random() * Math.PI * 2;
        dir.set(Math.cos(angle), 0, Math.sin(angle));
      }

      pos.x += dir.x * speed * dt;
      pos.z += dir.z * speed * dt;

      const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      if (dist > walkRadius) {
        dir.set(-pos.x, 0, -pos.z).normalize();
        pos.x = (pos.x / dist) * walkRadius;
        pos.z = (pos.z / dist) * walkRadius;
      }

      pos.x = Math.max(-half, Math.min(half, pos.x));
      pos.z = Math.max(-half, Math.min(half, pos.z));
    }

    const floorOff = npc.floorOffset ?? 0;
    pos.y = FLOOR_Y + heightOffset + floorOff;

    group.position.copy(pos);
    capsule.position.copy(pos);

    const scaleMult = npc.scale ?? 1;
    if (group.children.length > 0) {
      group.children[0].scale.setScalar(baseScale * scaleMult);
      if (group.userData.modelBaseY != null) {
        group.children[0].position.y = group.userData.modelBaseY;
      }
    }

    let targetYaw;
    if (isNearPlayer && playerPos) {
      _toPlayer.set(playerPos.x - pos.x, 0, playerPos.z - pos.z);
      if (_toPlayer.lengthSq() > 0.0001) {
        targetYaw = Math.atan2(_toPlayer.x, _toPlayer.z);
      } else {
        targetYaw = currentYaw;
      }
    } else {
      targetYaw = Math.atan2(dir.x, dir.z);
    }
    let diff = targetYaw - currentYaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const turnSpeed = npc.turnSpeed ?? 5;
    const turnAlpha = 1 - Math.exp(-turnSpeed * dt);
    currentYaw += diff * turnAlpha;
    group.rotation.y = currentYaw;
    capsule.rotation.y = currentYaw;
  }

  return { group, capsule, update };
}
