/**
 * Enemy: same GLB as player/NPC, walks on flat floor, has health and life bar.
 * Different color (dark red), Hit_Chest/Hit_Head on damage, Death01 when dead.
 * createEnemy(opts) returns { group, capsule, pos, hp, maxHp, takeDamage, isDead, update(dt) }.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const CHAR_GLB = "models/AnimationLibrary_Godot_Standard-transformed.glb";
const DRACO_URL =
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";

// Enemy tint color (dark red/maroon) - applied to model materials
const ENEMY_COLOR = 0x8b2549;

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {THREE.WebGPURenderer} opts.renderer
 * @param {THREE.Camera} opts.camera
 * @param {object} opts.enemyParams - { enabled, speed, walkRadius, directionChangeInterval, maxHp }
 * @param {number} opts.FLOOR_Y
 * @param {number} opts.PARKOUR_SIZE
 * @param {number} opts.characterHeight
 * @param {number} [opts.capsuleRadius]
 * @param {THREE.Vector3} [opts.spawnPos] - World position to spawn at
 * @param {THREE.Vector3} [opts.playerPos] - Player position for proximity checks (idle when near)
 * @returns {{ group: THREE.Group, capsule: THREE.Mesh, pos: THREE.Vector3, hp: number, maxHp: number, takeDamage: (amount: number) => boolean, isDead: () => boolean, update: (dt: number) => void }}
 */
export function createEnemy(opts) {
  const {
    scene,
    renderer,
    camera,
    enemyParams,
    FLOOR_Y,
    PARKOUR_SIZE,
    characterHeight,
    capsuleRadius = 0.35,
    spawnPos = null,
    playerPos = null,
  } = opts;

  const capR = capsuleRadius;
  const capHalfH = Math.max(0.1, (characterHeight - 2 * capR) / 2);

  const capsuleGeo = new THREE.CapsuleGeometry(0.4, 1.2, 8, 16);
  const capsuleMat = new THREE.MeshStandardNodeMaterial({
    color: ENEMY_COLOR,
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

  const maxHp = enemyParams?.maxHp ?? 100;
  let hp = maxHp;

  function takeDamage(amount) {
    if (hp <= 0) return false;
    hitCount++;
    hp = Math.max(0, hp - amount);
    updateLifeBar();
    // Debug: cycle Hit_Chest → Hit_Head → Death01 (3 hits = dead)
    if (hitCount >= 3) {
      hp = 0;
      playDeath();
    } else if (hitCount === 1) {
      playHitReaction("chest");
    } else if (hitCount === 2) {
      playHitReaction("head");
    } else if (hp <= 0) {
      playDeath();
    }
    return hp > 0;
  }

  function isDead() {
    return hp <= 0;
  }

  // ── Life bar (3D above head) ──
  const lifeBarHeight = characterHeight + 0.35;
  const barWidth = 0.8;
  const barHeight = 0.08;
  const lifeBarGroup = new THREE.Group();
  lifeBarGroup.position.set(0, lifeBarHeight, 0);

  const bgGeo = new THREE.PlaneGeometry(barWidth, barHeight);
  const bgMat = new THREE.MeshStandardNodeMaterial({
    color: 0x222222,
    roughness: 1,
    metalness: 0,
  });
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.position.z = 0.01; // slight offset so fill is in front
  lifeBarGroup.add(bgMesh);

  const fillGeo = new THREE.PlaneGeometry(barWidth - 0.04, barHeight - 0.02);
  const fillMat = new THREE.MeshStandardNodeMaterial({
    color: 0xcc3333,
    roughness: 0.8,
    metalness: 0,
  });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.position.set(-(barWidth - 0.04) / 2, 0, 0.02); // left-aligned, scale from left
  fillMesh.scale.x = 1;
  lifeBarGroup.add(fillMesh);

  group.add(lifeBarGroup);

  function updateLifeBar() {
    const t = hp / maxHp;
    fillMesh.scale.x = Math.max(0, Math.min(1, t));
    fillMesh.position.x = -((barWidth - 0.04) / 2) * (1 - t); // keep left edge fixed when scaling
  }

  let mixer = null;
  let walkAction = null;
  let idleAction = null;
  let hitChestAction = null;
  let hitHeadAction = null;
  let deathAction = null;
  let hitCount = 0;
  let baseScale = 1;
  group.userData.modelBaseY = 0;
  group.userData.initialCharHeight = characterHeight;

  const half = PARKOUR_SIZE / 2;
  const heightOffset = capHalfH + capR;
  let currentYaw = 0;
  const pos = spawnPos
    ? new THREE.Vector3(spawnPos.x, FLOOR_Y + heightOffset, spawnPos.z)
    : new THREE.Vector3(40, FLOOR_Y + heightOffset, 40);
  let dir = new THREE.Vector3(1, 0, 0);
  let dirChangeTimer = 0;
  let hitStunUntil = 0;
  let deathStarted = false;
  let deathTime = 0;
  const DEATH_FALL_DURATION = 1.5;
  let wasNearPlayer = false;

  const _toPlayer = new THREE.Vector3();

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
            const baseColor = m.color?.getHex?.() ?? 0x888888;
            // Tint toward enemy color (dark red)
            const r = ((baseColor >> 16) & 0xff) / 255;
            const g = ((baseColor >> 8) & 0xff) / 255;
            const b = (baseColor & 0xff) / 255;
            const tintR = (ENEMY_COLOR >> 16) & 0xff;
            const tintG = (ENEMY_COLOR >> 8) & 0xff;
            const tintB = ENEMY_COLOR & 0xff;
            const blend = 0.5; // 50% original, 50% tint
            const finalR = Math.floor((r * 255 * (1 - blend) + tintR * blend));
            const finalG = Math.floor((g * 255 * (1 - blend) + tintG * blend));
            const finalB = Math.floor((b * 255 * (1 - blend) + tintB * blend));
            const finalColor = (finalR << 16) | (finalG << 8) | finalB;
            o.material = new THREE.MeshStandardNodeMaterial({
              color: finalColor,
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
      group.userData.model = model;
      group.add(model);

      const rightHand = model.getObjectByName("DEF-handR") || null;
      if (rightHand) {
        const swordGroup = new THREE.Group();
        const handleGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.18, 8);
        const bladeGeo = new THREE.BoxGeometry(0.015, 0.06, 0.95);
        const handleMat = new THREE.MeshStandardNodeMaterial({
          color: 0x2a1a18,
          roughness: 0.8,
          metalness: 0.1,
        });
        const bladeMat = new THREE.MeshStandardNodeMaterial({
          color: 0x606870,
          roughness: 0.4,
          metalness: 0.7,
        });
        const handle = new THREE.Mesh(handleGeo, handleMat);
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        handle.castShadow = true;
        blade.castShadow = true;
        handle.position.set(0, 0, 0);
        blade.position.set(0, 0, 0.565);
        swordGroup.add(handle);
        swordGroup.add(blade);
        swordGroup.position.set(0.02, 0, 0.04);
        swordGroup.rotation.set(-0.1, 0, 0.15);
        rightHand.add(swordGroup);
        group.userData.sword = swordGroup;
      }

      if (gltf.animations && gltf.animations.length) {
        mixer = new THREE.AnimationMixer(model);
        const idleClip =
          gltf.animations.find((a) => a.name === "Idle_Loop") ||
          gltf.animations[0];
        const walkClip =
          gltf.animations.find((a) => a.name === "Walk_Loop") ||
          gltf.animations.find((a) => a.name === "Jog_Fwd_Loop") ||
          gltf.animations[0];
        const hitChestClip = gltf.animations.find((a) => a.name === "Hit_Chest") || null;
        const hitHeadClip = gltf.animations.find((a) => a.name === "Hit_Head") || null;
        const deathClip =
          gltf.animations.find((a) => a.name === "Death01") || null;

        idleAction = mixer.clipAction(idleClip).setLoop(2201);
        walkAction = mixer.clipAction(walkClip).setLoop(2201);
        if (hitChestClip) {
          hitChestAction = mixer.clipAction(hitChestClip).setLoop(2200);
          if (hitChestAction.clampWhenFinished !== undefined)
            hitChestAction.clampWhenFinished = true;
        }
        if (hitHeadClip) {
          hitHeadAction = mixer.clipAction(hitHeadClip).setLoop(2200);
          if (hitHeadAction.clampWhenFinished !== undefined)
            hitHeadAction.clampWhenFinished = true;
        }
        if (deathClip) {
          deathAction = mixer.clipAction(deathClip).setLoop(2200);
          if (deathAction.clampWhenFinished !== undefined)
            deathAction.clampWhenFinished = true;
        }
        walkAction.play();
      }
      renderer
        .compileAsync(scene, camera)
        .catch((e) => console.warn("Recompile after Enemy load:", e));
    },
    undefined,
    (err) => console.error("Enemy GLB load failed:", err),
  );

  function playHitReaction(which) {
    const hitAction = which === "chest" ? hitChestAction : hitHeadAction;
    if (!hitAction || deathStarted) return;
    if (walkAction?.isRunning()) {
      hitAction.enabled = true;
      hitAction.time = 0;
      hitAction.crossFadeFrom(walkAction, 0.1).play();
    } else if (idleAction?.isRunning()) {
      hitAction.enabled = true;
      hitAction.time = 0;
      hitAction.crossFadeFrom(idleAction, 0.1).play();
    } else if (hitChestAction?.isRunning?.() && hitAction !== hitChestAction) {
      hitAction.enabled = true;
      hitAction.time = 0;
      hitAction.crossFadeFrom(hitChestAction, 0.1).play();
    } else if (hitHeadAction?.isRunning?.() && hitAction !== hitHeadAction) {
      hitAction.enabled = true;
      hitAction.time = 0;
      hitAction.crossFadeFrom(hitHeadAction, 0.1).play();
    } else {
      hitAction.enabled = true;
      hitAction.time = 0;
      hitAction.play();
    }
    const clip = hitAction.getClip();
    hitStunUntil = (clip?.duration ?? 0.3) + 0.05;
  }

  function playDeath() {
    if (!deathAction || deathStarted) return;
    deathStarted = true;
    if (walkAction?.isRunning()) {
      deathAction.enabled = true;
      deathAction.time = 0;
      deathAction.crossFadeFrom(walkAction, 0.2).play();
    } else if (idleAction?.isRunning()) {
      deathAction.enabled = true;
      deathAction.time = 0;
      deathAction.crossFadeFrom(idleAction, 0.2).play();
    } else if (hitChestAction?.isRunning?.()) {
      deathAction.enabled = true;
      deathAction.time = 0;
      deathAction.crossFadeFrom(hitChestAction, 0.2).play();
    } else if (hitHeadAction?.isRunning?.()) {
      deathAction.enabled = true;
      deathAction.time = 0;
      deathAction.crossFadeFrom(hitHeadAction, 0.2).play();
    } else {
      deathAction.enabled = true;
      deathAction.time = 0;
      deathAction.play();
    }
    lifeBarGroup.visible = false;
  }

  function update(dt) {
    const params = enemyParams ?? {};
    const enabled = !!params.enabled;
    group.visible = enabled;
    capsule.visible = enabled && !group.userData.model && !deathStarted;

    if (!enabled) return;

    if (mixer) mixer.update(dt);

    hitStunUntil -= dt;

    if (hp <= 0) {
      if (!deathStarted) playDeath();
      deathTime += dt;
      const fallProgress = Math.min(1, deathTime / DEATH_FALL_DURATION);
      group.rotation.x = -fallProgress * (Math.PI / 2);
      pos.y = FLOOR_Y + heightOffset - fallProgress * (heightOffset - 0.25);
      group.position.copy(pos);
      capsule.position.copy(pos);
      return;
    }

    // Hit stun: stay in place, no movement
    if (hitStunUntil > 0) {
      pos.y = FLOOR_Y + heightOffset + (params.floorOffset ?? 0);
      group.position.copy(pos);
      capsule.position.copy(pos);
      const modelChild = group.userData.model;
      if (modelChild) {
        modelChild.scale.setScalar(baseScale * (params.scale ?? 1));
        if (group.userData.modelBaseY != null) {
          modelChild.position.y = group.userData.modelBaseY;
        }
      }
      return;
    }

    const idleWhenNear = !!params.idleWhenNearPlayer && playerPos;
    const nearDist = params.nearPlayerDistance ?? 4;
    let isNearPlayer = false;
    if (idleWhenNear) {
      _toPlayer.set(playerPos.x - pos.x, 0, playerPos.z - pos.z);
      isNearPlayer = _toPlayer.length() < nearDist;
    }

    // Blend back from hit to walk or idle (depending on proximity)
    const currentHitAction = hitChestAction?.isRunning?.() ? hitChestAction : hitHeadAction?.isRunning?.() ? hitHeadAction : null;
    if (currentHitAction) {
      const clip = currentHitAction.getClip();
      const dur = clip?.duration ?? 0.3;
      if (currentHitAction.time >= dur - 0.02) {
        currentHitAction.enabled = false;
        currentHitAction.time = 0;
        if (isNearPlayer && idleAction) {
          idleAction.enabled = true;
          idleAction.crossFadeFrom(currentHitAction, 0.25).play();
        } else if (walkAction) {
          walkAction.enabled = true;
          walkAction.time = 0.1;
          walkAction.crossFadeFrom(currentHitAction, 0.25).play();
        }
      }
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
      const speed = params.speed ?? 2;
      const walkRadius = params.walkRadius ?? 80;
      const interval = params.directionChangeInterval ?? 3;

      if (wasNearPlayer) {
        wasNearPlayer = false;
        if (walkAction) {
          walkAction.enabled = true;
          if (idleAction?.isRunning()) {
            walkAction.time = 0.1;
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
    pos.y = FLOOR_Y + heightOffset + (params.floorOffset ?? 0);

    group.position.copy(pos);
    capsule.position.copy(pos);

    const scaleMult = params.scale ?? 1;
    const modelChild = group.userData.model;
    if (modelChild) {
      modelChild.scale.setScalar(baseScale * scaleMult);
      if (group.userData.modelBaseY != null) {
        modelChild.position.y = group.userData.modelBaseY;
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
    const turnSpeed = params.turnSpeed ?? 5;
    const turnAlpha = 1 - Math.exp(-turnSpeed * dt);
    currentYaw += diff * turnAlpha;
    group.rotation.y = currentYaw;
    capsule.rotation.y = currentYaw;

    // Life bar faces camera (billboard)
    if (camera) {
      const camPos = new THREE.Vector3();
      camera.getWorldPosition(camPos);
      lifeBarGroup.lookAt(camPos);
    }
  }

  return {
    group,
    capsule,
    pos,
    hp: () => hp,
    maxHp,
    takeDamage,
    isDead,
    update,
  };
}
