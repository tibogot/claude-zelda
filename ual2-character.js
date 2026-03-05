/**
 * UAL2 Character Showcase: Simplified character loader and animator for debugging animations.
 * createUAL2Character(scene) returns { model, mixer, animations, playAnimation(index), update() }.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const CHAR_GLB = "models/UAL2_Standard-transformed.glb";
const DRACO_URL = "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";

/**
 * @param {THREE.Scene} scene
 * @returns {Promise<{ model: THREE.Group, mixer: THREE.AnimationMixer, animations: THREE.AnimationClip[], playAnimation: (index: number) => void, update: () => void }>}
 */
export async function createUAL2Character(scene) {
  console.log("Starting character loading...");
  return new Promise((resolve, reject) => {
    // Draco loader setup
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_URL);
    console.log("Draco decoder path set:", DRACO_URL);

    // GLTF loader
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    console.log("Loading model:", CHAR_GLB);

    loader.load(
      CHAR_GLB,
      (gltf) => {
        console.log("GLTF loaded successfully:", gltf);
        const model = gltf.scene;

        // Convert materials to MeshStandardMaterial (simplified for showcase)
        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            if (o.material && !o.material.isNodeMaterial) {
              const m = o.material;
              o.material = new THREE.MeshStandardMaterial({
                color: m.color?.getHex?.() ?? 0x888888,
                roughness: m.roughness ?? 0.5,
                metalness: m.metalness ?? 0,
                map: m.map || null,
              });
            }
          }
        });

        // Scale and position like in player.js (assuming character height around 2.5)
        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        const characterHeight = 2.5; // Similar to PARAMS.characterHeight
        const scale = characterHeight / (size.y || 1);
        model.scale.setScalar(scale);

        // Center the model
        box.setFromObject(model);
        const center = new THREE.Vector3();
        box.getCenter(center);
        model.position.sub(center);

        // Animation mixer
        const mixer = new THREE.AnimationMixer(model);
        const animations = gltf.animations;
        console.log("Character added to scene, animations:", animations.length);

        // Add to scene
        scene.add(model);

        // Current animation action
        let currentAction = null;

        function playAnimation(index) {
          if (index < 0 || index >= animations.length) return;

          // Stop current animation
          if (currentAction) {
            currentAction.fadeOut(0.2);
          }

          // Play new animation
          const clip = animations[index];
          const action = mixer.clipAction(clip);
          action.reset();
          action.fadeIn(0.2);
          action.play();

          currentAction = action;
        }

        function update() {
          if (mixer) {
            mixer.update(1 / 60); // Assume 60fps
          }
        }

        resolve({
          model,
          mixer,
          animations,
          playAnimation,
          update,
        });
        console.log("Character loading promise resolved");
      },
      (progress) => {
        console.log(
          "Loading progress:",
          (progress.loaded / progress.total) * 100 + "%",
        );
      },
      (error) => {
        console.error("Error loading character model:", error);
        reject(error);
      },
    );
  });
}
