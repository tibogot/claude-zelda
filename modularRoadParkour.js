import * as THREE from "three";

/**
 * Obstacle parkour — recreated from models/lotus-vvv-physics.html so the same
 * car can be stress-tested on ramps, steps, kickers, bumps, a banked turn and
 * walls, alongside the modular road. Everything lives in one group placed at an
 * offset so it doesn't overlap the track.
 *
 * Returns drive surfaces (`deckMeshes` → deck BVH for wheel probes) separately
 * from `wallMeshes` (→ solids BVH for chassis collision), plus a sensible
 * `spawn` (world position + heading) to teleport the car into the arena.
 */
export function buildParkour({ offset = new THREE.Vector3(60, 0, 0) } = {}) {
  const group = new THREE.Group();
  group.name = "Parkour";
  group.position.copy(offset);
  group.visible = false;

  const deckMeshes = [];
  const wallMeshes = [];

  const _matRamp = (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  const _matWall = (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide });

  /** Pitched ramp. Low edge sits at (x, 0, z); ramp tilts up in +Z. */
  function addRamp({ x, z, w = 5, l = 8, angleDeg = 20, yawDeg = 0, color = 0x6a5436 }) {
    const angle = THREE.MathUtils.degToRad(angleDeg);
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, l), _matRamp(color));
    m.rotation.order = "YXZ";
    m.rotation.y = yaw;
    m.rotation.x = -angle;
    m.position.set(x, (Math.sin(angle) * l) / 2, z + (Math.cos(angle) * l) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    return m;
  }

  /** Axis-aligned rectangular slab sitting on the ground. */
  function addStep({ x, z, w, h, l, color = 0x5e7a48 }) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), _matRamp(color));
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    return m;
  }

  /** Vertical wall — chassis collision only. */
  function addWall({ x, z, w, h, l, color = 0x803a3a }) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), _matWall(color));
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    wallMeshes.push(m);
    return m;
  }

  /** Laterally-tilted slope (banked turn). +X side is the low edge at y=0. */
  function addBank({ x, z, w, l, bankDeg, color = 0x3a5060 }) {
    const bank = THREE.MathUtils.degToRad(bankDeg);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.4, l), _matRamp(color));
    m.rotation.z = -bank;
    m.position.set(x, (Math.sin(bank) * w) / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    return m;
  }

  // SLOPE LAB — 5 ramps at 10°/20°/30°/40°/55°, lighter→darker.
  const slopeAngles = [10, 20, 30, 40, 55];
  for (let i = 0; i < slopeAngles.length; i++) {
    const tint = 0.5 - i * 0.06;
    const color = new THREE.Color().setHSL(0.085, 0.4, tint).getHex();
    addRamp({ x: -10 + i * 5, z: 8, w: 4, l: 8, angleDeg: slopeAngles[i], color });
  }

  // STEPS / CURBS.
  addStep({ x: 0, z: -10, w: 8, h: 0.18, l: 1.2, color: 0x4a6038 });
  addStep({ x: 0, z: -13, w: 8, h: 0.35, l: 1.5, color: 0x3a5028 });

  // JUMP KICKER.
  addRamp({ x: 0, z: -20, w: 5, l: 5, angleDeg: 35, color: 0xd97a3a });

  // BUMPY STRIP — high-frequency suspension chatter.
  for (let i = 0; i < 6; i++) {
    addStep({ x: 0, z: -30 - i * 1.4, w: 6, h: 0.14, l: 0.55, color: 0x6e8050 });
  }

  // BANKED TURN.
  addBank({ x: 20, z: 0, w: 10, l: 16, bankDeg: 25, color: 0x3a5060 });

  // WALL CORRIDOR — drive between two walls, dead-end to the north.
  addWall({ x: -22, z: 0, w: 0.5, h: 2.5, l: 12, color: 0x803a3a });
  addWall({ x: -16, z: 0, w: 0.5, h: 2.5, l: 12, color: 0x803a3a });
  addWall({ x: -19, z: 6.5, w: 6.5, h: 2.5, l: 0.5, color: 0xc04444 });

  // SINGLE WALL near spawn — quick collision sanity check.
  addWall({ x: 6, z: 5, w: 0.5, h: 2, l: 4, color: 0xa05030 });

  // Spawn just south of the steps, facing the kicker (-Z).
  const spawn = {
    pos: new THREE.Vector3(offset.x, offset.y, offset.z - 4),
    yaw: Math.PI,
  };

  return { group, deckMeshes, wallMeshes, spawn };
}
