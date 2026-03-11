/**
 * RAPIER physics: world, ground, dynamic cubes, player controller, debug wireframes.
 * Assumes RAPIER.init() has been called by the caller.
 */
import * as THREE from "three";

const CUBE_SPAWN_HEIGHT = 3;
const CUBE_POSITIONS = [
  [80, 0, 60],
  [-100, 0, 80],
  [120, 0, -50],
  [-60, 0, -120],
  [200, 0, 40],
  [-180, 0, -80],
  [50, 0, -200],
  [-140, 0, 100],
];
const CUBE_HALF_EXTENT = 0.5;

/**
 * @param {object} RAPIER - RAPIER module
 * @param {THREE.Scene} scene
 * @param {number} TERRAIN_SIZE
 * @param {(x: number, z: number) => number} sampleHeight
 * @param {{ noDefaultGround?: boolean, noDefaultCubes?: boolean }} [options] - Optional. noDefaultGround: true for custom ground. noDefaultCubes: true to skip spawning default cubes.
 * @returns {{ physicsWorld: import("@dimforge/rapier3d").World, physicsCubes: Array<{ body: import("@dimforge/rapier3d").RigidBody, mesh: THREE.Mesh }> }}
 */
export function createPhysicsWorld(
  RAPIER,
  scene,
  TERRAIN_SIZE,
  sampleHeight,
  options = {},
) {
  const gravity = { x: 0, y: -9.81, z: 0 };
  const physicsWorld = new RAPIER.World(gravity);

  if (!options.noDefaultGround) {
    const groundHalfX = TERRAIN_SIZE * 0.5;
    const groundHalfY = 0.5;
    const groundHalfZ = TERRAIN_SIZE * 0.5;
    const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
      groundHalfX,
      groundHalfY,
      groundHalfZ,
    );
    physicsWorld.createCollider(groundColliderDesc);
  }

  const physicsCubes = [];
  if (!options.noDefaultCubes) {
    const cubePositions = CUBE_POSITIONS.map(([x, _, z]) => [
      x,
      sampleHeight(x, z) + CUBE_SPAWN_HEIGHT,
      z,
    ]);
    const cubeGeo = new THREE.BoxGeometry(
      CUBE_HALF_EXTENT * 2,
      CUBE_HALF_EXTENT * 2,
      CUBE_HALF_EXTENT * 2,
    );
    const cubeMat = new THREE.MeshStandardMaterial({
      color: 0x4488ff,
      roughness: 0.6,
      metalness: 0.1,
    });
    for (const [px, py, pz] of cubePositions) {
      const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(
        px,
        py,
        pz,
      );
      const body = physicsWorld.createRigidBody(bodyDesc);
      const colliderDesc = RAPIER.ColliderDesc.cuboid(
        CUBE_HALF_EXTENT,
        CUBE_HALF_EXTENT,
        CUBE_HALF_EXTENT,
      );
      physicsWorld.createCollider(colliderDesc, body);
      const mesh = new THREE.Mesh(cubeGeo, cubeMat.clone());
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      physicsCubes.push({ body, mesh });
    }
  }

  return { physicsWorld, physicsCubes };
}

/**
 * @param {object} RAPIER - RAPIER module
 * @param {import("@dimforge/rapier3d").World} physicsWorld
 * @param {THREE.Vector3} charPos
 * @param {object} PARAMS
 * @param {{ enableSnapToGround?: boolean, characterOffset?: number, maxSlopeClimbAngle?: number, minSlopeSlideAngle?: number }} [options] - Optional. enableSnapToGround: false for flat terrain. maxSlopeClimbAngle/minSlopeSlideAngle in radians for slope handling.
 * @returns {{ playerBody: import("@dimforge/rapier3d").RigidBody, playerCollider: import("@dimforge/rapier3d").Collider, characterController: import("@dimforge/rapier3d").CharacterController }}
 */
export function createPlayerController(
  RAPIER,
  physicsWorld,
  charPos,
  PARAMS,
  options = {},
) {
  const capR = PARAMS.capsuleRadius;
  const capHalfH = Math.max(0.1, (PARAMS.characterHeight - 2 * capR) / 2);
  const playerBodyDesc =
    RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      charPos.x,
      charPos.y,
      charPos.z,
    );
  const playerBody = physicsWorld.createRigidBody(playerBodyDesc);
  const playerCollider = physicsWorld.createCollider(
    RAPIER.ColliderDesc.capsule(capHalfH, capR),
    playerBody,
  );
  const characterOffset = options.characterOffset ?? 0.01;
  const characterController =
    physicsWorld.createCharacterController(characterOffset);
  if (options.enableSnapToGround !== false) {
    characterController.enableSnapToGround(0.5);
  }
  characterController.enableAutostep(0.35, 0.1, false);
  const maxSlopeClimb = options.maxSlopeClimbAngle ?? (45 * Math.PI) / 180;
  const minSlopeSlide = options.minSlopeSlideAngle ?? (50 * Math.PI) / 180;
  characterController.setMaxSlopeClimbAngle(maxSlopeClimb);
  characterController.setMinSlopeSlideAngle(minSlopeSlide);
  return { playerBody, playerCollider, characterController };
}

/**
 * @param {object} RAPIER - RAPIER module
 * @param {THREE.Scene} scene
 * @param {import("@dimforge/rapier3d").World} physicsWorld
 * @returns {{ physicsDebugGroup: THREE.Group, buildRapierDebugMeshes: () => void }}
 */
export function createPhysicsDebug(RAPIER, scene, physicsWorld) {
  const physicsDebugGroup = new THREE.Group();
  scene.add(physicsDebugGroup);
  const rapierDebugMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    wireframe: true,
    depthTest: true,
  });
  function buildRapierDebugMeshes() {
    physicsDebugGroup.clear();
    try {
      physicsWorld.forEachCollider((collider) => {
        const body = collider.parent ? collider.parent() : null;
        const pos = body ? body.translation() : collider.translation();
        const rot = body ? body.rotation() : { x: 0, y: 0, z: 0, w: 1 };
        const shape = collider.shape;
        if (!shape) return;
        let geo = null;
        const st = RAPIER.ShapeType;
        if (shape.type === st.Cuboid && shape.halfExtents) {
          const h = shape.halfExtents;
          geo = new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2);
        } else if (shape.type === st.Ball && shape.radius != null) {
          geo = new THREE.SphereGeometry(shape.radius, 8, 6);
        } else if (shape.type === st.Capsule && shape.halfHeight != null) {
          const halfH = shape.halfHeight;
          const r = shape.radius;
          geo = new THREE.CapsuleGeometry(r, halfH * 2, 4, 8);
        } else if (shape.type === st.Cylinder && shape.halfHeight != null) {
          const halfH = shape.halfHeight;
          const r = shape.radius;
          geo = new THREE.CylinderGeometry(r, r, halfH * 2, 8);
        } else if (
          shape.type === st.TriMesh &&
          shape.vertices &&
          shape.indices
        ) {
          const v = shape.vertices;
          const i = shape.indices;
          const posArr = [];
          const idxArr = [];
          for (let k = 0; k < v.length; k += 3)
            posArr.push(v[k], v[k + 1], v[k + 2]);
          for (let k = 0; k < i.length; k++) idxArr.push(i[k]);
          const bg = new THREE.BufferGeometry();
          bg.setAttribute(
            "position",
            new THREE.Float32BufferAttribute(posArr, 3),
          );
          bg.setIndex(idxArr);
          geo = bg;
        }
        if (geo) {
          const wire = new THREE.LineSegments(
            new THREE.WireframeGeometry(geo),
            rapierDebugMat,
          );
          wire.position.set(pos.x, pos.y, pos.z);
          wire.quaternion.set(rot.x, rot.y, rot.z, rot.w);
          physicsDebugGroup.add(wire);
        }
      });
    } catch (e) {
      console.warn("Rapier debug render:", e);
    }
  }
  return { physicsDebugGroup, buildRapierDebugMeshes };
}

/**
 * Post-step correction: resolve character overlapping kinematic platforms.
 * Rapier's KCC doesn't resolve kinematic-kinematic collisions, so when a platform
 * moves into the character (elevator rising, sweeper sliding), we must push out.
 * Uses forEachCollider to iterate kinematic bodies and explicit AABB overlap checks.
 *
 * @param {object} RAPIER - RAPIER module
 * @param {import("@dimforge/rapier3d").World} physicsWorld
 * @param {import("@dimforge/rapier3d").RigidBody} playerBody
 * @param {import("@dimforge/rapier3d").Collider} playerCollider
 * @param {{ x: number, y: number, z: number }} charPos - mutable, will be updated
 * @param {number} capHalfH - capsule half-height
 * @param {number} capR - capsule radius
 * @param {boolean} isCrouching - use crouch dimensions if true
 * @param {number} crouchHalfH - crouch capsule half-height
 * @param {number} [dt] - timestep for platform velocity inheritance (horizontal movement)
 * @param {{ [handle: number]: { x: number, y: number, z: number } }} [lastPlatformPos] - mutable map of platform handle -> last position; used to compute velocity from position delta when linvel() is unreliable after step
 * @returns {{ didCorrect: boolean, isOnKinematicPlatform: boolean }}
 */
export function resolveKinematicOverlap(
  RAPIER,
  physicsWorld,
  playerBody,
  playerCollider,
  charPos,
  capHalfH,
  capR,
  isCrouching = false,
  crouchHalfH = 0,
  dt = 1 / 60,
  lastPlatformPos = null,
) {
  const halfH = isCrouching ? crouchHalfH : capHalfH;
  const charBottom = charPos.y - halfH - capR;
  const charRadius = 0.05;
  let totalDx = 0,
    totalDy = 0,
    totalDz = 0;
  let maxPushUp = 0;
  let isOnKinematicPlatform = false;
  let snapToY = null;
  /** @type {import("@dimforge/rapier3d").RigidBody | null} */
  let platformBody = null;

  physicsWorld.forEachCollider((collider) => {
    const body = collider.parent ? collider.parent() : null;
    if (!body?.isKinematic?.()) return;
    if (body === playerBody) return;

    const pos = body.translation();
    const shape = collider.shape;
    if (!shape) return;

    const st = RAPIER.ShapeType;
    let hx = 0,
      hy = 0,
      hz = 0;

    if (shape.type === st.Cuboid && shape.halfExtents) {
      hx = shape.halfExtents.x;
      hy = shape.halfExtents.y;
      hz = shape.halfExtents.z;
    } else if (shape.type === st.Ball && shape.radius != null) {
      hx = hy = hz = shape.radius;
    } else if (shape.type === st.Cylinder && shape.halfHeight != null) {
      const r = shape.radius ?? 0.5;
      hx = hz = r;
      hy = shape.halfHeight;
    } else if (shape.type === st.Capsule && shape.halfHeight != null) {
      const r = shape.radius ?? 0.5;
      hx = hz = r;
      hy = shape.halfHeight + r;
    } else {
      return;
    }

    const platMinX = pos.x - hx - charRadius;
    const platMaxX = pos.x + hx + charRadius;
    const platMinZ = pos.z - hz - charRadius;
    const platMaxZ = pos.z + hz + charRadius;
    const platTop = pos.y + hy;

    const inXZ =
      charPos.x >= platMinX &&
      charPos.x <= platMaxX &&
      charPos.z >= platMinZ &&
      charPos.z <= platMaxZ;
    if (!inXZ) return;

    // Only treat platform as a floor if its top is at or below the character centre.
    // A block at head/shoulder height is a ceiling or obstacle, not a floor to snap to.
    const isFloor = platTop <= charPos.y + 0.1;
    if (!isFloor) return;

    const overlapping = charBottom < platTop + 0.02;
    const floatingAbove =
      charBottom > platTop + 0.02 && charBottom <= platTop + 0.05;
    if (overlapping) {
      const overlap = platTop - charBottom + 0.02;
      if (overlap > 0.03 && overlap > maxPushUp) {
        maxPushUp = overlap;
      }
    }
    if (overlapping || floatingAbove) {
      if (charBottom >= platTop - 1.2 && charBottom <= platTop + 0.05) {
        isOnKinematicPlatform = true;
        platformBody = body;
        const targetY = platTop + halfH + capR + 0.02;
        if (snapToY === null || targetY > snapToY) snapToY = targetY;
      }
    }
  });

  // Inherit horizontal velocity from platform — KCC often rejects kinematic-platform
  // movement, so we apply it directly here to ensure the character rides the platform.
  // Use position delta when available (linvel() can be zero after physicsWorld.step()).
  if (isOnKinematicPlatform && platformBody && dt > 0) {
    const pos = platformBody.translation();
    const handle = platformBody.handle;
    let dx = 0,
      dz = 0;
    if (lastPlatformPos && handle in lastPlatformPos) {
      const last = lastPlatformPos[handle];
      dx = pos.x - last.x;
      dz = pos.z - last.z;
    } else {
      const vel = platformBody.linvel();
      dx = vel.x * dt;
      dz = vel.z * dt;
    }
    if (lastPlatformPos)
      lastPlatformPos[handle] = { x: pos.x, y: pos.y, z: pos.z };
    totalDx += dx;
    totalDz += dz;
  }

  if (maxPushUp > 0) {
    totalDy = maxPushUp;
  } else if (snapToY !== null) {
    const snapDy = snapToY - charPos.y;
    if (Math.abs(snapDy) > 0.001) {
      const maxPerFrame = 0.05;
      totalDy = Math.sign(snapDy) * Math.min(Math.abs(snapDy), maxPerFrame);
    }
  }

  if (totalDx !== 0 || totalDy !== 0 || totalDz !== 0) {
    charPos.x += totalDx;
    charPos.y += totalDy;
    charPos.z += totalDz;
    const t = playerBody.translation();
    playerBody.setNextKinematicTranslation({
      x: t.x + totalDx,
      y: t.y + totalDy,
      z: t.z + totalDz,
    });
    playerBody.setTranslation(
      { x: t.x + totalDx, y: t.y + totalDy, z: t.z + totalDz },
      true,
    );
  }
  return {
    didCorrect: totalDx !== 0 || totalDy !== 0 || totalDz !== 0,
    isOnKinematicPlatform,
    snapToY,
    totalDy,
    charBottom,
  };
}
