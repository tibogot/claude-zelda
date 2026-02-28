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
 * @returns {{ physicsWorld: import("@dimforge/rapier3d").World, physicsCubes: Array<{ body: import("@dimforge/rapier3d").RigidBody, mesh: THREE.Mesh }> }}
 */
export function createPhysicsWorld(RAPIER, scene, TERRAIN_SIZE, sampleHeight) {
  const gravity = { x: 0, y: -9.81, z: 0 };
  const physicsWorld = new RAPIER.World(gravity);

  const groundHalfX = TERRAIN_SIZE * 0.5;
  const groundHalfY = 0.5;
  const groundHalfZ = TERRAIN_SIZE * 0.5;
  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
    groundHalfX,
    groundHalfY,
    groundHalfZ,
  );
  physicsWorld.createCollider(groundColliderDesc);

  const physicsCubes = [];
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
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(px, py, pz);
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

  return { physicsWorld, physicsCubes };
}

/**
 * @param {object} RAPIER - RAPIER module
 * @param {import("@dimforge/rapier3d").World} physicsWorld
 * @param {THREE.Vector3} charPos
 * @param {object} PARAMS
 * @returns {{ playerBody: import("@dimforge/rapier3d").RigidBody, playerCollider: import("@dimforge/rapier3d").Collider, characterController: import("@dimforge/rapier3d").CharacterController }}
 */
export function createPlayerController(RAPIER, physicsWorld, charPos, PARAMS) {
  const capR = PARAMS.capsuleRadius;
  const capHalfH = Math.max(
    0.1,
    (PARAMS.characterHeight - 2 * capR) / 2,
  );
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
  const characterController = physicsWorld.createCharacterController(0.01);
  characterController.enableSnapToGround(0.5);
  characterController.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
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
        } else if (
          shape.type === st.Capsule &&
          shape.halfHeight != null
        ) {
          const halfH = shape.halfHeight;
          const r = shape.radius;
          geo = new THREE.CapsuleGeometry(r, halfH * 2, 4, 8);
        } else if (
          shape.type === st.Cylinder &&
          shape.halfHeight != null
        ) {
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
