/**
 * Deer AI: 5 deer that follow terrain and alternate between Idle, Eating, Walk, Gallop.
 * createDeer(opts) → { deerGroup, update(dt) }
 *
 * Usage:
 *   import { createDeer } from './deer.js';
 *   const { deerGroup, update: updateDeer } = createDeer({ scene, sampleHeight, TERRAIN_SIZE, gltfLoader });
 *   // In animation loop: updateDeer(dt);
 */

import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

const DEER_GLTF = "models/Deer.gltf";
const DEER_COUNT = 5;
const HALF_BOUNDS = 0.48; // fraction of TERRAIN_SIZE for roaming
const WALK_SPEED = 1.8;
const GALLOP_SPEED = 5.5;
const DEER_SCALE = 0.6;
const DEER_GROUND_OFFSET = 0.15; // offset above terrain (hooves)

// Animation names from Deer.gltf
const ANIM_IDLE = "Idle";
const ANIM_EATING = "Eating";
const ANIM_WALK = "Walk";
const ANIM_GALLOP = "Gallop";

const STATES = { IDLE: "idle", EATING: "eating", WALK: "walk", GALLOP: "gallop" };

/**
 * @param {Object} opts
 * @param {THREE.Scene} opts.scene
 * @param {(x: number, z: number) => number} opts.sampleHeight
 * @param {number} opts.TERRAIN_SIZE
 * @param {THREE.GLTFLoader} opts.gltfLoader
 * @param {Object} [opts.PARAMS] optional params (e.g. deerEnabled)
 */
export function createDeer({ scene, sampleHeight, TERRAIN_SIZE, gltfLoader, PARAMS = {} }) {
  const deerGroup = new THREE.Group();
  scene.add(deerGroup);

  const hb = TERRAIN_SIZE * HALF_BOUNDS;
  const deerInstances = [];
  const deerState = [];

  // Predefined spawn positions (spread across terrain, avoid center/character spawn)
  const SPAWN_OFFSETS = [
    { x: 80, z: 60 },
    { x: -100, z: 40 },
    { x: 50, z: -90 },
    { x: -70, z: -50 },
    { x: 120, z: -30 },
  ];

  function getSpawnForDeer(i) {
    const o = SPAWN_OFFSETS[i % SPAWN_OFFSETS.length];
    return { x: o.x, z: o.z };
  }

  function pickNextState(currentState) {
    const r = Math.random();
    switch (currentState) {
      case STATES.IDLE:
        if (r < 0.3) return STATES.EATING;
        if (r < 0.8) return STATES.WALK;
        return STATES.IDLE;
      case STATES.EATING:
        if (r < 0.6) return STATES.IDLE;
        if (r < 0.9) return STATES.WALK;
        return STATES.EATING;
      case STATES.WALK:
        if (r < 0.35) return STATES.IDLE;
        if (r < 0.55) return STATES.GALLOP;
        return STATES.WALK;
      case STATES.GALLOP:
        if (r < 0.5) return STATES.WALK;
        if (r < 0.7) return STATES.IDLE;
        return STATES.GALLOP;
      default:
        return STATES.WALK;
    }
  }

  function getStateDuration(state) {
    switch (state) {
      case STATES.IDLE:
        return 2 + Math.random() * 4;
      case STATES.EATING:
        return 3 + Math.random() * 4;
      case STATES.WALK:
        return 4 + Math.random() * 6;
      case STATES.GALLOP:
        return 2 + Math.random() * 3;
      default:
        return 3;
    }
  }

  gltfLoader.load(
    DEER_GLTF,
    (gltf) => {
      const sourceModel = gltf.scene;
      const clips = gltf.animations || [];

      const idleClip = clips.find((a) => a.name === ANIM_IDLE);
      const eatingClip = clips.find((a) => a.name === ANIM_EATING);
      const walkClip = clips.find((a) => a.name === ANIM_WALK);
      const gallopClip = clips.find((a) => a.name === ANIM_GALLOP);

      const clipMap = {
        [STATES.IDLE]: idleClip || clips[0],
        [STATES.EATING]: eatingClip || idleClip || clips[0],
        [STATES.WALK]: walkClip || idleClip || clips[0],
        [STATES.GALLOP]: gallopClip || walkClip || clips[0],
      };

      for (let i = 0; i < DEER_COUNT; i++) {
        const clone = SkeletonUtils.clone(sourceModel);
        clone.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material && !o.material.isNodeMaterial) {
              const m = o.material;
              o.material = new THREE.MeshStandardNodeMaterial({
                color: m.color?.getHex?.() ?? 0x8b7355,
                roughness: m.roughness ?? 0.7,
                metalness: m.metalness ?? 0,
                map: m.map || null,
              });
            }
          }
        });

        clone.scale.setScalar(DEER_SCALE);
        deerGroup.add(clone);

        const mixer = new THREE.AnimationMixer(clone);
        const actions = {};
        for (const [state, clip] of Object.entries(clipMap)) {
          if (clip) {
            actions[state] = mixer.clipAction(clip).setLoop(2201);
          }
        }

        const spawn = getSpawnForDeer(i);
        const y = sampleHeight(spawn.x, spawn.z) + DEER_GROUND_OFFSET;
        clone.position.set(spawn.x, y, spawn.z);
        const angle = Math.random() * Math.PI * 2;
        clone.rotation.y = angle;

        // Start some deer in Walk so movement is visible immediately
        const initialState =
          i % 2 === 0 ? STATES.IDLE : STATES.WALK;
        const stateData = {
          state: initialState,
          dirX: Math.cos(angle),
          dirZ: Math.sin(angle),
          timer: getStateDuration(initialState),
          duration: getStateDuration(initialState),
        };

        if (actions[stateData.state]) {
          actions[stateData.state].play();
        }

        deerInstances.push({
          group: clone,
          mixer,
          actions,
          stateData,
        });
        deerState.push(stateData);
      }
    },
    undefined,
    (err) => console.error("Deer load error:", err)
  );

  function update(dt) {
    if (PARAMS.deerEnabled === false) return;
    for (let i = 0; i < deerInstances.length; i++) {
      const { group, mixer, actions, stateData } = deerInstances[i];
      mixer.update(dt);

      stateData.timer -= dt;
      if (stateData.timer <= 0) {
        const nextState = pickNextState(stateData.state);
        const prevState = stateData.state;
        stateData.state = nextState;
        stateData.duration = getStateDuration(nextState);
        stateData.timer = stateData.duration;

        if (prevState !== nextState) {
          if (actions[prevState]) actions[prevState].fadeOut(0.25);
          if (actions[nextState]) actions[nextState].reset().fadeIn(0.25).play();
        }

        if (nextState === STATES.WALK || nextState === STATES.GALLOP) {
          const angle = Math.random() * Math.PI * 2;
          stateData.dirX = Math.cos(angle);
          stateData.dirZ = Math.sin(angle);
        }
      }

      const speed =
        stateData.state === STATES.GALLOP ? GALLOP_SPEED : stateData.state === STATES.WALK ? WALK_SPEED : 0;

      if (speed > 0) {
        group.position.x += stateData.dirX * speed * dt;
        group.position.z += stateData.dirZ * speed * dt;
        group.position.x = Math.max(-hb, Math.min(hb, group.position.x));
        group.position.z = Math.max(-hb, Math.min(hb, group.position.z));
        group.rotation.y = Math.atan2(stateData.dirX, stateData.dirZ);
      }

      group.position.y = sampleHeight(group.position.x, group.position.z) + DEER_GROUND_OFFSET;
    }
  }

  return {
    deerGroup,
    update,
  };
}
