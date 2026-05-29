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

/* ----------------------------------------------------------------------- */
/* Ramp / bank geometry (triangular prisms — not tilted boxes)             */
/* ----------------------------------------------------------------------- */

/**
 * Drive ramp: low edge at y=0, z=0 (local); rises toward -Z.
 * @param {number} w width (X)
 * @param {number} l run length (Z)
 * @param {number} angleRad pitch angle
 */
function rampGeometry(w, l, angleRad) {
  const H = l * Math.sin(angleRad);
  const hw = w / 2;
  const zN = 0; // low approach edge
  const zF = -l; // high back edge
  const Al = [-hw, 0, zN],
    Bl = [-hw, 0, zF],
    Cl = [-hw, H, zF];
  const Ar = [hw, 0, zN],
    Br = [hw, 0, zF],
    Cr = [hw, H, zF];
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  quad(Al, Ar, Cr, Cl); // sloped deck
  quad(Al, Bl, Br, Ar); // bottom
  quad(Bl, Cl, Cr, Br); // vertical back
  tri(Al, Cl, Bl); // left cap
  tri(Ar, Br, Cr); // right cap
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Banked deck: low edge at y=0, x=-w/2; rises toward +X.
 * @param {number} w width (X) — lateral span of the bank
 * @param {number} l length (Z)
 * @param {number} bankRad bank angle
 */
function bankGeometry(w, l, bankRad) {
  const H = w * Math.sin(bankRad);
  const hw = w / 2;
  const hl = l / 2;
  const xL = -hw; // low side
  const xH = hw; // high side
  const zN = -hl;
  const zF = hl;
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  // Sloped top (CCW when viewed from above-right).
  quad(
    [xL, 0, zN],
    [xL, 0, zF],
    [xH, H, zF],
    [xH, H, zN],
  );
  quad([xL, 0, zN], [xH, 0, zN], [xH, 0, zF], [xL, 0, zF]); // bottom
  quad([xH, 0, zN], [xH, H, zN], [xH, H, zF], [xH, 0, zF]); // high vertical cap
  tri([xL, 0, zN], [xL, 0, zF], [xH, H, zF]);
  tri([xL, 0, zN], [xH, H, zF], [xH, H, zN]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

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

  /** Pitched ramp wedge. (x, z) = centre of the low approach edge; drive in from +Z. */
  function addRamp({ x, z, w = 5, l = 8, angleDeg = 20, yawDeg = 0, color = 0x6a5436 }) {
    const angle = THREE.MathUtils.degToRad(angleDeg);
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const geo = rampGeometry(w, l, angle);
    const m = new THREE.Mesh(geo, _matRamp(color));
    m.rotation.order = "YXZ";
    m.rotation.y = yaw;
    // Geometry low edge sits at local z=0; place that point at world (x, 0, z).
    m.position.set(x, 0, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m); // sloped deck → wheel probes
    wallMeshes.push(m); // back face + side caps → chassis (solids BVH)
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

  /** Laterally banked wedge. Centre at (x, z); low side is -X, high side is +X. */
  function addBank({ x, z, w, l, bankDeg, color = 0x3a5060 }) {
    const bank = THREE.MathUtils.degToRad(bankDeg);
    const geo = bankGeometry(w, l, bank);
    const m = new THREE.Mesh(geo, _matRamp(color));
    m.position.set(x, 0, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    wallMeshes.push(m);
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
