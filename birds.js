/**
 * GPU compute birds (WebGPU Boids) — autonomous flocking, no mouse input.
 * Runs entirely on the GPU via WebGPU compute shaders (Three.js TSL).
 *
 * Usage:
 *   import { createBirds } from './birds.js';
 *   const birds = createBirds({ scene, renderer });
 *   // In your animation loop:
 *   birds.update(dt);
 */

import * as THREE from "three";
import {
  uniform, vec3, max, sin, mat3, uint, negate,
  instancedArray, cameraProjectionMatrix, cameraViewMatrix, positionLocal,
  modelWorldMatrix, sqrt, float, Fn, If, cos, Loop, Continue, normalize,
  instanceIndex, length, vertexIndex,
} from "three/tsl";

// ─────────────────────────────────────────────────────────────────────────────
// Speed limit is the raw velocity cap inside the boid buffer.
// Visual speed = SPEED_LIMIT * dt * INTEGRATION_SPEED.
// At 60 fps:  4 * 0.016 * 1.5 ≈ 0.096 units/frame = ~6 units/second  ✓
// ─────────────────────────────────────────────────────────────────────────────
const SPEED_LIMIT        = 4.0;
const INTEGRATION_SPEED  = 1.5;

class BirdGeometry extends THREE.BufferGeometry {
  constructor() {
    super();
    const vertices = new THREE.BufferAttribute(new Float32Array(9 * 3), 3);
    this.setAttribute("position", vertices);

    let v = 0;
    const push = (...args) => { for (const a of args) vertices.array[v++] = a; };
    const span = 20;

    push(0, 0, -20,  0, -8, 10,   0, 0, 30);       // body
    push(0, 0, -15, -span, 0, 5,  0, 0, 15);        // left wing  (tip = vertex 4)
    push(0, 0,  15,  span, 0, 5,  0, 0, -15);       // right wing (tip = vertex 7)

    this.scale(0.2, 0.2, 0.2);
  }
}

const MAX_BIRDS = 4096;

/**
 * @param {Object}               options
 * @param {THREE.Scene}          options.scene
 * @param {THREE.WebGPURenderer} options.renderer
 * @param {number} [options.count=1024]   initial number of birds (live-tweakable via params.uBirdCount)
 * @param {number} [options.maxCount=4096] max birds (buffer size; count slider cannot exceed this)
 * @param {number} [options.bounds=400]   XZ roaming diameter — must be large enough
 *                                        that zone radius (55) ≈ 4–6× avg bird spacing
 * @param {number} [options.centerY=40]   cruising altitude
 * @param {number} [options.minY=18]      hard floor
 * @param {number} [options.maxY=75]      hard ceiling
 */
export function createBirds({
  scene,
  renderer,
  count    = 1024,
  maxCount = MAX_BIRDS,
  bounds   = 400,   // larger space → boid zones proportional → proper flocking groups
  centerY  = 40,
  minY     = 18,
  maxY     = 75,
} = {}) {

  const BIRDS        = Math.min(maxCount, MAX_BIRDS);
  const initialCount = Math.min(count, BIRDS);
  const BOUNDS_HALF = bounds / 2;

  // ── Initial CPU-side data ─────────────────────────────────────────────────
  const positionArray = new Float32Array(BIRDS * 3);
  const velocityArray = new Float32Array(BIRDS * 3);
  const phaseArray    = new Float32Array(BIRDS);

  for (let i = 0; i < BIRDS; i++) {
    const active = i < initialCount;
    positionArray[i * 3 + 0] = active ? (Math.random() * 2 - 1) * BOUNDS_HALF : 0;
    positionArray[i * 3 + 1] = active ? centerY + (Math.random() - 0.5) * 30 : 0;
    positionArray[i * 3 + 2] = active ? (Math.random() * 2 - 1) * BOUNDS_HALF : 0;

    velocityArray[i * 3 + 0] = active ? (Math.random() - 0.5) * 2 : 0;
    velocityArray[i * 3 + 1] = active ? (Math.random() - 0.5) * 2 : 0;
    velocityArray[i * 3 + 2] = active ? (Math.random() - 0.5) * 2 : 0;

    phaseArray[i] = Math.random() * Math.PI * 2;
  }

  // ── GPU storage buffers ───────────────────────────────────────────────────
  const positionStorage = instancedArray(positionArray, "vec3").setName("birdPos");
  const velocityStorage = instancedArray(velocityArray, "vec3").setName("birdVel");
  const phaseStorage    = instancedArray(phaseArray,    "float").setName("birdPhase");

  positionStorage.setPBO(true);
  velocityStorage.setPBO(true);
  phaseStorage.setPBO(true);

  // ── Per-frame uniforms ────────────────────────────────────────────────────
  const uDeltaTime  = uniform(0.0).setName("deltaTime");
  // Zone radii match the original example — they work correctly when
  // bounds ≥ 400 (zone 55 ≈ 4× average bird spacing at that density)
  const uSeparation = uniform(15.0).setName("separation");
  const uAlignment  = uniform(20.0).setName("alignment");
  const uCohesion   = uniform(20.0).setName("cohesion");
  // Height uniforms — exposed so external code (e.g. Tweakpane) can adjust live
  const uCenterY    = uniform(centerY).setName("centerY");
  const uMinY       = uniform(minY).setName("minY");
  const uMaxY       = uniform(maxY).setName("maxY");
  const uBirdCount  = uniform(initialCount).setName("birdCount");

  // ── Bird mesh ─────────────────────────────────────────────────────────────
  const birdGeometry = new BirdGeometry();
  const birdMaterial = new THREE.NodeMaterial();
  birdMaterial.side = THREE.DoubleSide;
  birdMaterial.colorNode = vec3(0.12, 0.10, 0.08); // dark silhouette against sky

  const birdVertexTSL = Fn(() => {
    const position = positionLocal.toVar();
    const phase    = phaseStorage.element(instanceIndex).toVar();
    const vel      = normalize(velocityStorage.element(instanceIndex)).toVar();

    // Flap wingtips (vertex indices 4 and 7)
    If(vertexIndex.equal(4).or(vertexIndex.equal(7)), () => {
      position.y = sin(phase).mul(5.0);
    });

    const worldVert = modelWorldMatrix.mul(position);

    // Orient bird along velocity direction
    vel.z.mulAssign(-1.0);
    const xz    = length(vel.xz);
    const x     = sqrt(vel.y.mul(vel.y).oneMinus());
    const cosry = vel.x.div(xz).toVar();
    const sinry = vel.z.div(xz).toVar();
    const cosrz = x.div(float(1.0));
    const sinrz = vel.y.div(float(1.0)).toVar();

    const maty = mat3(
      cosry,         0, negate(sinry),
      0,             1, 0,
      sinry,         0, cosry,
    );
    const matz = mat3(
      cosrz,          sinrz, 0,
      negate(sinrz),  cosrz, 0,
      0,              0,     1,
    );

    const finalVert = maty.mul(matz).mul(worldVert);
    finalVert.addAssign(positionStorage.element(instanceIndex));
    return cameraProjectionMatrix.mul(cameraViewMatrix).mul(finalVert);
  });

  birdMaterial.vertexNode = birdVertexTSL();

  const birdMesh = new THREE.InstancedMesh(birdGeometry, birdMaterial, BIRDS);
  birdMesh.count = initialCount;
  birdMesh.rotation.y       = Math.PI / 2;
  birdMesh.scale.setScalar(0.12); // ≈ 1 unit wingspan — visible at game distances
  birdMesh.matrixAutoUpdate = false;
  birdMesh.frustumCulled    = false;
  birdMesh.updateMatrix();

  // Strength multipliers so alignment/cohesion produce visible flocking (not too weak)
  const ALIGNMENT_STRENGTH = 8.0;
  const COHESION_STRENGTH  = 8.0;

  // ── Compute: velocity ─────────────────────────────────────────────────────
  const computeVelocity = Fn(() => {
    If(instanceIndex.lessThan(uBirdCount), () => {
    const PI   = float(Math.PI);
    const PI_2 = PI.mul(2.0);
    const limit = float(SPEED_LIMIT).toVar("limit");

    const zoneRadius       = uSeparation.add(uAlignment).add(uCohesion).toConst();
    const separationThresh = uSeparation.div(zoneRadius).toConst();
    const alignmentThresh  = uSeparation.add(uAlignment).div(zoneRadius).toConst();
    const zoneRadiusSq     = zoneRadius.mul(zoneRadius).toConst();

    const birdIndex = instanceIndex.toConst("birdIndex");
    const position  = positionStorage.element(birdIndex).toVar();
    const velocity  = velocityStorage.element(birdIndex).toVar();

    // Attract toward cruising-altitude centre (keeps flock coherent and in-bounds)
    const dirToCenter = position.sub(vec3(0, uCenterY, 0)).toVar();
    dirToCenter.y.mulAssign(2.5);
    velocity.subAssign(normalize(dirToCenter).mul(uDeltaTime).mul(5.0));

    // Hard Y floor / ceiling
    If(position.y.lessThan(uMinY), () => {
      velocity.y.addAssign(uDeltaTime.mul(20.0));
    });
    If(position.y.greaterThan(uMaxY), () => {
      velocity.y.subAssign(uDeltaTime.mul(20.0));
    });

    // O(n²) boid neighbour loop — only consider active birds
    Loop({ start: uint(0), end: uint(BIRDS), type: "uint", condition: "<" }, ({ i }) => {
      If(i.equal(birdIndex), () => { Continue(); });
      If(i.greaterThanEqual(uBirdCount), () => { Continue(); });

      const birdPos = positionStorage.element(i);
      const dir     = birdPos.sub(position);
      const dist    = length(dir);

      If(dist.lessThan(0.0001), () => { Continue(); });

      const distSq  = dist.mul(dist);
      If(distSq.greaterThan(zoneRadiusSq), () => { Continue(); });

      const percent = distSq.div(zoneRadiusSq);

      If(percent.lessThan(separationThresh), () => {
        // Separation — steer away from close neighbors
        const adj = separationThresh.div(percent).sub(1.0).mul(uDeltaTime);
        velocity.subAssign(normalize(dir).mul(adj));

      }).ElseIf(percent.lessThan(alignmentThresh), () => {
        // Alignment — match neighbor velocity (stronger so flock direction emerges)
        const threshDelta = alignmentThresh.sub(separationThresh);
        const pct         = percent.sub(separationThresh).div(threshDelta);
        const adj         = float(0.5).sub(cos(pct.mul(PI_2)).mul(0.5)).add(0.5).mul(uDeltaTime).mul(ALIGNMENT_STRENGTH);
        velocity.addAssign(normalize(velocityStorage.element(i)).mul(adj));

      }).Else(() => {
        // Cohesion — steer toward neighbors (stronger so flock stays together)
        const threshDelta = alignmentThresh.oneMinus();
        const pct         = threshDelta.equal(0.0).select(1.0, percent.sub(alignmentThresh).div(threshDelta));
        const c           = cos(pct.mul(PI_2));
        const adj         = float(0.5).sub(c.mul(-0.5).add(0.5)).mul(uDeltaTime).mul(COHESION_STRENGTH);
        velocity.addAssign(normalize(dir).mul(adj));
      });
    });

    If(length(velocity).greaterThan(limit), () => {
      velocity.assign(normalize(velocity).mul(limit));
    });

    velocityStorage.element(birdIndex).assign(velocity);
    });

  })().compute(BIRDS).setName("BirdsVelocity");

  // ── Compute: integrate position + wing-flap phase ────────────────────────
  const computePosition = Fn(() => {
    If(instanceIndex.lessThan(uBirdCount), () => {
    positionStorage.element(instanceIndex).addAssign(
      velocityStorage.element(instanceIndex).mul(uDeltaTime).mul(INTEGRATION_SPEED)
    );

    const vel      = velocityStorage.element(instanceIndex);
    const phase    = phaseStorage.element(instanceIndex);
    const newPhase = phase
      .add(uDeltaTime)
      .add(length(vel.xz).mul(uDeltaTime).mul(3.0))
      .add(max(vel.y, 0.0).mul(uDeltaTime).mul(6.0));

    phaseStorage.element(instanceIndex).assign(newPhase.mod(62.83));
    });

  })().compute(BIRDS).setName("BirdsPosition");

  scene.add(birdMesh);

  return {
    update(dt) {
      uDeltaTime.value = Math.min(dt, 0.05);
      renderer.compute(computeVelocity);
      renderer.compute(computePosition);
    },
    mesh: birdMesh,
    /** Live-tweakable uniforms — write .value to update without recreating birds */
    params: { uSeparation, uAlignment, uCohesion, uCenterY, uMinY, uMaxY, uBirdCount },
    MAX_BIRDS: BIRDS,
  };
}
