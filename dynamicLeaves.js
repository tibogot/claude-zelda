/**
 * DynamicLeaves — vanilla Three.js r183 WebGPU port of the R3F DynamicLeaves component.
 *
 * Usage:
 *   import { createDynamicLeaves } from './dynamicLeaves.js';
 *   const leaves = createDynamicLeaves({ scene, camera, getGroundHeight });
 *   // In your animation loop:
 *   leaves.update(delta, elapsedTime);
 *   // To remove:
 *   leaves.dispose();
 */

import * as THREE from "three";

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Camera} opts.camera
 * @param {number} [opts.count=1000]
 * @param {number} [opts.areaSize=20]
 * @param {THREE.Vector3} [opts.characterPosition]   — live reference, update externally each frame
 * @param {THREE.Vector3} [opts.characterVelocity]   — live reference, update externally each frame
 * @param {(x:number,z:number)=>number} [opts.getGroundHeight]
 * @param {number} [opts.characterInteractionRange=8]
 * @param {number} [opts.characterPushStrength=0.8]
 * @param {number} [opts.characterSwirlStrength=0.5]
 */
export function createDynamicLeaves({
  scene,
  camera,
  count = 1000,
  areaSize = 20,
  characterPosition = new THREE.Vector3(),
  characterVelocity = new THREE.Vector3(),
  getGroundHeight = null,
  characterInteractionRange = 8,
  characterPushStrength = 0.8,
  characterSwirlStrength = 0.5,
} = {}) {

  // ── Geometry ──────────────────────────────────────────────────────────────
  const geometry = new THREE.PlaneGeometry(0.3, 0.3, 1, 1);
  geometry.rotateX(-Math.PI * 0.5);

  const scaleArray = new Float32Array(count);
  const rotationArray = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    scaleArray[i] = Math.random() * 0.5 + 0.5;
    rotationArray[i] = Math.random() * Math.PI * 2;
  }
  geometry.setAttribute("aScale",    new THREE.InstancedBufferAttribute(scaleArray, 1));
  geometry.setAttribute("aRotation", new THREE.InstancedBufferAttribute(rotationArray, 1));

  // ── Colors ────────────────────────────────────────────────────────────────
  const leafColors = [
    "#c4c557", "#ff782b", "#8B4513", "#A0522D", "#D2691E",
    "#CD853F", "#228B22", "#006400", "#32CD32", "#9ACD32",
    "#B22222", "#DC143C", "#8B0000", "#2F4F4F", "#556B2F",
    "#6B8E23", "#DAA520", "#B8860B",
  ].map(hex => new THREE.Color(hex));

  const colorArray = new Float32Array(count * 3);
  const _c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const ca = leafColors[Math.floor(Math.random() * leafColors.length)];
    const cb = leafColors[Math.floor(Math.random() * leafColors.length)];
    _c.copy(ca).lerp(cb, Math.random());
    _c.r = Math.max(0, Math.min(1, _c.r + (Math.random() - 0.5) * 0.15));
    _c.g = Math.max(0, Math.min(1, _c.g + (Math.random() - 0.5) * 0.15));
    _c.b = Math.max(0, Math.min(1, _c.b + (Math.random() - 0.5) * 0.15));
    _c.toArray(colorArray, i * 3);
  }
  geometry.setAttribute("color", new THREE.InstancedBufferAttribute(colorArray, 3));

  // ── Material ──────────────────────────────────────────────────────────────
  const material = new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: true,
  });

  // ── Mesh ──────────────────────────────────────────────────────────────────
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // ── Physics data ──────────────────────────────────────────────────────────
  // Flat typed-array storage: pos[i*3], vel[i*3], rot[i*3], angVel[i*3]
  const pos    = new Float32Array(count * 3);
  const vel    = new Float32Array(count * 3);
  const rot    = new Float32Array(count * 3);
  const angVel = new Float32Array(count * 3);
  const groundOffset = new Float32Array(count);
  const isResting    = new Uint8Array(count);
  const restTimer    = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const x = (Math.random() - 0.5) * areaSize;
    const z = (Math.random() - 0.5) * areaSize;
    const gy = getGroundHeight ? getGroundHeight(x, z) : 0;

    pos[i*3]   = x;
    pos[i*3+1] = gy + Math.random() * 3 + 0.5;
    pos[i*3+2] = z;

    vel[i*3]   = (Math.random() - 0.5) * 0.1;
    vel[i*3+1] = -Math.random() * 0.2;
    vel[i*3+2] = (Math.random() - 0.5) * 0.1;

    rot[i*3]   = Math.random() * Math.PI * 2;
    rot[i*3+1] = Math.random() * Math.PI * 2;
    rot[i*3+2] = Math.random() * Math.PI * 2;

    angVel[i*3]   = (Math.random() - 0.5) * 2;
    angVel[i*3+1] = (Math.random() - 0.5) * 2;
    angVel[i*3+2] = (Math.random() - 0.5) * 2;

    groundOffset[i] = Math.random() * 0.015;
  }

  // ── Live-tweakable params ─────────────────────────────────────────────────
  const params = {
    characterInteractionRange,
    characterPushStrength,
    characterSwirlStrength,
  };

  // ── Reusable helpers ──────────────────────────────────────────────────────
  const dummy = new THREE.Object3D();
  const aScaleAttr = geometry.getAttribute("aScale");

  // ── Update loop ───────────────────────────────────────────────────────────
  /**
   * Call once per frame inside your render loop.
   * @param {number} delta        seconds since last frame
   * @param {number} elapsedTime  total elapsed seconds
   */
  function update(delta, elapsedTime) {
    const safeDelta = Math.min(delta, 0.1);
    const time = elapsedTime;

    const charX = characterPosition.x;
    const charZ = characterPosition.z;
    const charVelX = characterVelocity.x;
    const charVelZ = characterVelocity.z;
    const charSpeed = Math.sqrt(charVelX * charVelX + charVelZ * charVelZ);
    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    const areaSizeSq4 = areaSize * areaSize * 4;
    const iRange  = params.characterInteractionRange;
    const iStrPush  = params.characterPushStrength;
    const iStrSwirl = params.characterSwirlStrength;

    for (let i = 0; i < count; i++) {
      const pi = i * 3;

      const px = pos[pi],  py = pos[pi+1], pz = pos[pi+2];
      const dx = px - charX;
      const dz = pz - charZ;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Wake resting leaves when character approaches
      if (isResting[i] && dist < iRange) {
        isResting[i] = 0;
        restTimer[i] = 0;
      }

      // Skip physics for resting leaves (update matrix sparsely)
      if (isResting[i]) {
        if (i % 10 === Math.floor(time * 60) % 10) {
          dummy.position.set(px, py, pz);
          dummy.rotation.set(rot[pi], rot[pi+1], rot[pi+2]);
          dummy.scale.setScalar(aScaleAttr.getX(i));
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
        }
        continue;
      }

      // Character interaction
      const influence = Math.max(0, 1 - dist / iRange);
      if (influence > 0.05) {
        const invDist = 1 / (dist + 0.1);
        vel[pi]   += dx * invDist * influence * 50.0 * safeDelta;
        vel[pi+2] += dz * invDist * influence * 50.0 * safeDelta;
        vel[pi+1] += influence * 25.0 * safeDelta;

        if (charSpeed > 0.1) {
          const velFactor = influence * iStrPush * 15.0 * safeDelta;
          vel[pi]   += charVelX * velFactor;
          vel[pi+2] += charVelZ * velFactor;

          const swirl = influence * charSpeed * iStrSwirl * 10.0 * safeDelta;
          vel[pi]   += -charVelZ * swirl;
          vel[pi+2] +=  charVelX * swirl;
        }

        if (dist < 3) {
          vel[pi+1] += influence * 20.0 * safeDelta;
          const expAngle = Math.random() * Math.PI * 2;
          const expForce = influence * 30.0 * safeDelta;
          vel[pi]   += Math.cos(expAngle) * expForce;
          vel[pi+2] += Math.sin(expAngle) * expForce;
          angVel[pi]   += (Math.random() - 0.5) * 20 * influence;
          angVel[pi+1] += (Math.random() - 0.5) * 20 * influence;
          angVel[pi+2] += (Math.random() - 0.5) * 20 * influence;
        }
      }

      // Wind
      vel[pi]   += Math.sin(px * 0.1 + time * 2)   * 0.1 * safeDelta;
      vel[pi+2] += Math.cos(pz * 0.1 + time * 1.5) * 0.1 * safeDelta;

      // Gravity
      vel[pi+1] -= 9.81 * safeDelta;

      // Ground check
      const gy = getGroundHeight ? getGroundHeight(px, pz) : 0;
      const go = groundOffset[i];
      const onGround = pos[pi+1] <= gy + 0.05 + go;

      if (onGround) {
        pos[pi+1] = gy + 0.01 + go;

        if (vel[pi+1] < 0) vel[pi+1] = Math.abs(vel[pi+1]) * 0.15; // bounce

        vel[pi]   *= 0.7;
        vel[pi+2] *= 0.7;
        vel[pi+1] *= 0.85;

        // Flatten on ground immediately
        rot[pi]       = 0;
        rot[pi+2]     = 0;
        angVel[pi]    = 0;
        angVel[pi+2]  = 0;

        const speedSq = vel[pi] * vel[pi] + vel[pi+2] * vel[pi+2];
        if (speedSq < 0.0001 && influence < 0.1) {
          restTimer[i] += safeDelta;
          if (restTimer[i] > 0.5) {
            isResting[i] = 1;
            vel[pi] = 0; vel[pi+1] = 0; vel[pi+2] = 0;
            angVel[pi] = 0; angVel[pi+1] = 0; angVel[pi+2] = 0;
          }
        } else {
          restTimer[i] = 0;
        }
      } else {
        // Air damping
        vel[pi]   *= 0.98; vel[pi+1] *= 0.98; vel[pi+2] *= 0.98;
        angVel[pi] *= 0.95; angVel[pi+1] *= 0.95; angVel[pi+2] *= 0.95;

        // Tumble from lateral velocity
        angVel[pi]   += vel[pi]   * 0.5;
        angVel[pi+2] += vel[pi+2] * 0.5;

        // Flutter
        angVel[pi]   += Math.sin(time * 3   + i) * 2 * safeDelta;
        angVel[pi+2] += Math.cos(time * 2.5 + i) * 2 * safeDelta;

        rot[pi]   += angVel[pi]   * safeDelta;
        rot[pi+1] += angVel[pi+1] * safeDelta;
        rot[pi+2] += angVel[pi+2] * safeDelta;
      }

      // Integrate position
      pos[pi]   += vel[pi]   * safeDelta;
      pos[pi+1] += vel[pi+1] * safeDelta;
      pos[pi+2] += vel[pi+2] * safeDelta;

      // Respawn if too far from camera
      const cdSq = (pos[pi] - camX) ** 2 + (pos[pi+2] - camZ) ** 2;
      if (cdSq > areaSizeSq4) {
        const angle  = Math.random() * Math.PI * 2;
        const radius = areaSize * 0.8;
        pos[pi]   = camX + Math.cos(angle) * radius;
        pos[pi+1] = camY + Math.random() * 5 + 1;
        pos[pi+2] = camZ + Math.sin(angle) * radius;
        vel[pi]   = (Math.random() - 0.5) * 0.1;
        vel[pi+1] = -Math.random() * 0.2;
        vel[pi+2] = (Math.random() - 0.5) * 0.1;
        isResting[i] = 0;
        restTimer[i] = 0;
      }

      // Update instance matrix
      dummy.position.set(pos[pi], pos[pi+1], pos[pi+2]);
      dummy.rotation.set(rot[pi], rot[pi+1], rot[pi+2]);
      dummy.scale.setScalar(aScaleAttr.getX(i));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }

  function dispose() {
    scene.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  return { mesh, params, update, dispose };
}
