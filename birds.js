/**
 * GPU compute birds (WebGPU Boids) — matches Three.js compute birds example.
 * Flocking + optional mouse disturbance. Runs on GPU via WebGPU compute (Three.js TSL).
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
  instanceIndex, length, vertexIndex, dot, select, clamp,
} from "three/tsl";

// ─────────────────────────────────────────────────────────────────────────────
// Slower flight but full 3D flocking for spiral/swooping shapes.
// SPEED_LIMIT=5, INTEGRATION_SPEED=4 → ~20 units/sec at 60fps.
// ─────────────────────────────────────────────────────────────────────────────
const SPEED_LIMIT        = 5.0;
const INTEGRATION_SPEED  = 4.0;

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
 * @param {number} [options.minY=8]       soft floor (wider = more vertical swooping)
 * @param {number} [options.maxY=100]     soft ceiling
 * @param {THREE.Camera} [options.camera] when provided, mouse disturbs birds (like original example)
 */
export function createBirds({
  scene,
  renderer,
  camera   = null,  // optional: enable mouse disturbance
  count    = 1024,
  maxCount = MAX_BIRDS,
  bounds   = 400,   // larger space → boid zones proportional → proper flocking groups
  centerY  = 120,
  minY     = 80,
  maxY     = 180,
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
    positionArray[i * 3 + 1] = active ? centerY + (Math.random() - 0.5) * 60 : 0;
    positionArray[i * 3 + 2] = active ? (Math.random() * 2 - 1) * BOUNDS_HALF : 0;

    velocityArray[i * 3 + 0] = active ? (Math.random() - 0.5) * 4 : 0;
    velocityArray[i * 3 + 1] = active ? (Math.random() - 0.5) * 4 : 0;
    velocityArray[i * 3 + 2] = active ? (Math.random() - 0.5) * 4 : 0;

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
  const uSeparation = uniform(10.0).setName("separation");
  const uAlignment  = uniform(22.0).setName("alignment");
  const uCohesion   = uniform(30.0).setName("cohesion");
  // Height uniforms — exposed so external code (e.g. Tweakpane) can adjust live
  const uCenterY    = uniform(centerY).setName("centerY");
  const uMinY       = uniform(minY).setName("minY");
  const uMaxY       = uniform(maxY).setName("maxY");
  const uBirdCount  = uniform(initialCount).setName("birdCount");
  const uRayOrigin  = uniform(new THREE.Vector3()).setName("rayOrigin");
  const uRayDirection = uniform(new THREE.Vector3()).setName("rayDirection");

  // ── Bird mesh ─────────────────────────────────────────────────────────────
  const birdGeometry = new BirdGeometry();
  const birdMaterial = new THREE.NodeMaterial();
  birdMaterial.side = THREE.DoubleSide;
  birdMaterial.colorNode = vec3(0.12, 0.10, 0.08); // dark silhouette against sky

  const birdVertexTSL = Fn(() => {
    const position = positionLocal.toVar();
    const phase    = phaseStorage.element(instanceIndex).toVar();
    const rawVel   = velocityStorage.element(instanceIndex);
    const velLen  = length(rawVel);
    const vel     = select(velLen.lessThan(float(0.001)), vec3(0, 0, 1), normalize(rawVel)).toVar();

    // Flap wingtips (vertex indices 4 and 7)
    If(vertexIndex.equal(4).or(vertexIndex.equal(7)), () => {
      position.y = sin(phase).mul(5.0);
    });

    const worldVert = modelWorldMatrix.mul(position);

    // Orient bird along velocity direction (safe when flying straight up/down: xz=0)
    vel.z.mulAssign(-1.0);
    const xz    = length(vel.xz);
    const eps   = float(0.001);
    const safeXz = select(xz.lessThan(eps), float(1.0), xz);
    const x     = sqrt(vel.y.mul(vel.y).oneMinus());
    const cosry = vel.x.div(safeXz).toVar();
    const sinry = vel.z.div(safeXz).toVar();
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
  birdMesh.scale.setScalar(0.28); // larger silhouette for visibility
  birdMesh.matrixAutoUpdate = false;
  birdMesh.frustumCulled    = false;
  birdMesh.updateMatrix();

  // Pointer + raycaster for mouse disturbance (optional, like original Three.js example)
  let pointer = new THREE.Vector2(0, 10); // y=10 = off-screen so no disturbance by default
  const raycaster = new THREE.Raycaster();
  if (camera && renderer.domElement) {
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.addEventListener("pointermove", (e) => {
      if (e.isPrimary === false) return;
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = 1 - (e.clientY / window.innerHeight) * 2;
    });
  }

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
    const dirToCenterLen = length(dirToCenter);
    If(dirToCenterLen.greaterThan(float(0.001)), () => {
      velocity.subAssign(normalize(dirToCenter).mul(uDeltaTime).mul(5.0));
    });

    // Soft Y bounds — gentle nudge so birds can swoop before turning back (stronger near floor)
    If(position.y.lessThan(uMinY), () => {
      velocity.y.addAssign(uDeltaTime.mul(12.0));
    });
    If(position.y.greaterThan(uMaxY), () => {
      velocity.y.subAssign(uDeltaTime.mul(12.0));
    });

    // Mouse/pointer disturbance — birds flee when cursor is near (only when camera provided)
    const directionToRay = uRayOrigin.sub(position).toConst();
    const projectionLength = dot(directionToRay, uRayDirection).toConst();
    const closestPoint = uRayOrigin.sub(uRayDirection.mul(projectionLength)).toConst();
    const directionToClosestPoint = closestPoint.sub(position).toConst();
    const distanceToClosestPoint = length(directionToClosestPoint).toConst();
    const distanceToClosestPointSq = distanceToClosestPoint.mul(distanceToClosestPoint).toConst();
    const rayRadius = float(150.0).toConst();
    const rayRadiusSq = rayRadius.mul(rayRadius).toConst();
    If(distanceToClosestPointSq.lessThan(rayRadiusSq).and(distanceToClosestPointSq.greaterThan(float(0.01))), () => {
      const velocityAdjust = distanceToClosestPointSq.div(rayRadiusSq).sub(1.0).mul(uDeltaTime).mul(80.0);
      velocity.addAssign(normalize(directionToClosestPoint).mul(velocityAdjust));
      limit.addAssign(3.0);
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
        // Alignment — fly the same direction (boosted for visible flocking at slower speed)
        const neighborVel = velocityStorage.element(i);
        const neighborVelLen = length(neighborVel);
        If(neighborVelLen.greaterThan(float(0.001)), () => {
          const threshDelta = alignmentThresh.sub(separationThresh);
          const adjustedPercent = percent.sub(separationThresh).div(threshDelta);
          const cosRangeAdjust = float(0.5).sub(cos(adjustedPercent.mul(PI_2)).mul(0.5)).add(0.5);
          const velocityAdjust = cosRangeAdjust.mul(uDeltaTime).mul(5.0);
          velocity.addAssign(normalize(neighborVel).mul(velocityAdjust));
        });

      }).Else(() => {
        // Cohesion — move closer (strong for tight flock shapes)
        const threshDelta = alignmentThresh.oneMinus();
        const adjustedPercent = threshDelta.equal(0.0).select(1.0, percent.sub(alignmentThresh).div(threshDelta));
        const cosRange = cos(adjustedPercent.mul(PI_2));
        const adj1 = cosRange.mul(-0.5);
        const adj2 = adj1.add(0.5);
        const adj3 = float(0.5).sub(adj2);
        const velocityAdjust = adj3.mul(uDeltaTime).mul(7.0);
        velocity.addAssign(normalize(dir).mul(velocityAdjust));
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
    const pos = positionStorage.element(instanceIndex).toVar();
    pos.addAssign(velocityStorage.element(instanceIndex).mul(uDeltaTime).mul(INTEGRATION_SPEED));
    pos.y.assign(clamp(pos.y, uMinY, uMaxY));
    positionStorage.element(instanceIndex).assign(pos);

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
    update(dt, cam = null) {
      uDeltaTime.value = Math.min(dt, 0.05);
      const c = cam ?? camera;
      if (c) {
        raycaster.setFromCamera(pointer, c);
        uRayOrigin.value.copy(raycaster.ray.origin);
        uRayDirection.value.copy(raycaster.ray.direction);
        pointer.y = 10; // move pointer away so birds only react when mouse moves
      } else {
        // No camera: ray far from flock so no birds are ever disturbed
        uRayOrigin.value.set(1e6, 1e6, 1e6);
        uRayDirection.value.set(1, 0, 0);
      }
      renderer.compute(computeVelocity);
      renderer.compute(computePosition);
    },
    mesh: birdMesh,
    /** Live-tweakable uniforms — write .value to update without recreating birds */
    params: { uSeparation, uAlignment, uCohesion, uCenterY, uMinY, uMaxY, uBirdCount },
    MAX_BIRDS: BIRDS,
  };
}
