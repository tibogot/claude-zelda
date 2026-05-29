import * as THREE from "three";
import { RoadBvh } from "./modularRoadBvh.js";

/**
 * Obstacle parkour — large static ramps/steps/banks/curved ramps plus moving solids
 * shove the car (spinning bars, sliding gates). Static decks go to the deck
 * BVH; static + dynamic obstacle meshes go to the solids BVH (dynamic rebaked
 * each frame while driving).
 */

/* ----------------------------------------------------------------------- */
/* Geometry helpers                                                         */
/* ----------------------------------------------------------------------- */

/** Drive ramp: low edge at y=0, z=0 (local); rises toward -Z. */
function rampGeometry(w, l, angleRad) {
  const H = l * Math.sin(angleRad);
  const hw = w / 2;
  const zN = 0;
  const zF = -l;
  const Al = [-hw, 0, zN],
    Bl = [-hw, 0, zF],
    Cl = [-hw, H, zF];
  const Ar = [hw, 0, zN],
    Br = [hw, 0, zF],
    Cr = [hw, H, zF];
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  quad(Al, Ar, Cr, Cl);
  quad(Al, Bl, Br, Ar);
  quad(Bl, Cl, Cr, Br);
  tri(Al, Cl, Bl);
  tri(Ar, Br, Cr);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Banked deck: low edge at y=0, x=-w/2; rises toward +X. */
function bankGeometry(w, l, bankRad) {
  const H = w * Math.sin(bankRad);
  const hw = w / 2;
  const hl = l / 2;
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  quad([-hw, 0, -hl], [-hw, 0, hl], [hw, H, hl], [hw, H, -hl]);
  quad([-hw, 0, -hl], [hw, 0, -hl], [hw, 0, hl], [-hw, 0, hl]);
  quad([hw, 0, -hl], [hw, H, -hl], [hw, H, hl], [hw, 0, hl]);
  tri([-hw, 0, -hl], [-hw, 0, hl], [hw, H, hl]);
  tri([-hw, 0, -hl], [hw, H, hl], [hw, H, -hl]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Curved drive ramp: starts at local (0,0,0) heading −Z, turns by `angleDeg`
 * (curveDir ±1), rises to `rise` with smoothstep. Low edge at y = 0.
 */
function curveRampGeometry(w, radius, angleDeg, rise, curveDir = 1, segments = 32) {
  const R = Math.max(4, radius);
  const A = THREE.MathUtils.degToRad(Math.min(120, Math.max(15, angleDeg)));
  const dir = curveDir >= 0 ? 1 : -1;
  const hw = w / 2;
  const n = Math.max(8, segments);
  const center = new THREE.Vector3(dir * R, 0, 0);
  const radius0 = new THREE.Vector3(-dir * R, 0, 0);

  const centerline = [];
  const rights = [];
  const _off = new THREE.Vector3();
  const _tan = new THREE.Vector3();
  const _up = new THREE.Vector3(0, 1, 0);
  const _right = new THREE.Vector3();

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const phi = A * t;
    const sm = t * t * (3 - 2 * t);
    _off.copy(radius0).applyAxisAngle(_up, -dir * phi);
    centerline.push(new THREE.Vector3(center.x + _off.x, rise * sm, center.z + _off.z));
  }

  for (let i = 0; i <= n; i++) {
    const prev = centerline[Math.max(0, i - 1)];
    const next = centerline[Math.min(n, i + 1)];
    _tan.subVectors(next, prev);
    if (_tan.lengthSq() < 1e-10) _right.set(dir, 0, 0);
    else {
      _tan.normalize();
      _right.crossVectors(_up, _tan);
      if (_right.lengthSq() < 1e-10) _right.set(1, 0, 0);
      else _right.normalize();
    }
    rights.push(_right.clone());
  }

  const pos = [];
  const quad = (a, b, c, d) => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    pos.push(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };
  const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);

  const L = (i, side) => {
    const p = centerline[i];
    const r = rights[i];
    return new THREE.Vector3(p.x + r.x * hw * side, p.y, p.z + r.z * hw * side);
  };
  const ground = (v) => new THREE.Vector3(v.x, 0, v.z);

  for (let i = 0; i < n; i++) {
    quad(L(i, -1), L(i, 1), L(i + 1, 1), L(i + 1, -1));
  }
  for (let i = 0; i < n; i++) {
    const lt0 = L(i, -1);
    const lt1 = L(i + 1, -1);
    quad(lt0, lt1, ground(lt1), ground(lt0));
    const rt0 = L(i, 1);
    const rt1 = L(i + 1, 1);
    quad(rt0, ground(rt0), ground(rt1), rt1);
  }
  tri(L(0, -1), L(0, 1), ground(L(0, 1)));
  tri(L(0, -1), ground(L(0, 1)), ground(L(0, -1)));
  tri(L(n, -1), ground(L(n, -1)), ground(L(n, 1)));
  tri(L(n, -1), ground(L(n, 1)), L(n, 1));

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Solid extruded kicker: flat entry z=0, profile supplied by heightAt(t) where t∈[0,1]. */
function solidKickerExtrusion(w, length, rise, segments, heightAt) {
  const hw = w / 2;
  const n = Math.max(8, segments);
  const L = Math.max(4, length);
  const H = Math.max(0.5, rise);
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);

  const topL = [];
  const topR = [];
  const botL = [];
  const botR = [];

  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const z = -L * t;
    const y = heightAt(t, H);
    topL.push([-hw, y, z]);
    topR.push([hw, y, z]);
    botL.push([-hw, 0, z]);
    botR.push([hw, 0, z]);
  }

  for (let i = 0; i < n; i++) quad(topL[i], topR[i], topR[i + 1], topL[i + 1]);
  for (let i = 0; i < n; i++) quad(botL[i], botL[i + 1], botR[i + 1], botR[i]);
  for (let i = 0; i < n; i++) quad(botL[i], topL[i], topL[i + 1], botL[i + 1]);
  for (let i = 0; i < n; i++) quad(botR[i], botR[i + 1], topR[i + 1], topR[i]);
  quad(botL[n], topL[n], topR[n], botR[n]);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Convex kicker — surface bulges above the straight chord (y = rise×sin(t×π/2)).
 */
export function kickerRampGeometry(w, length, rise, segments = 32) {
  return solidKickerExtrusion(w, length, rise, segments, (t, H) => H * Math.sin((Math.PI / 2) * t));
}

/**
 * Concave jump ramp — scooped transition below the chord (y = rise×(1−cos(t×π/2))).
 * Flat entry, steep lip; typical stunt jump profile.
 */
export function jumpRampGeometry(w, length, rise, segments = 32) {
  return solidKickerExtrusion(w, length, rise, segments, (t, H) => H * (1 - Math.cos((Math.PI / 2) * t)));
}

/* ----------------------------------------------------------------------- */
/* Dynamic movers — rebaked each frame, push the chassis via surface velocity */
/* ----------------------------------------------------------------------- */

const _pivotW = new THREE.Vector3();
const _r = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class ParkourMover {
  /**
   * @param {object} o
   * @param {THREE.Mesh} o.mesh collision + visual mesh
   * @param {"spin-y"|"slide-z"|"slide-y"|"pendulum-x"} o.mode
   * @param {number} o.speed rad/s or phase speed
   * @param {THREE.Object3D} [o.pivot] required for spin-y / pendulum-x
   * @param {number} [o.amplitude] slide distance (m) or swing angle (rad)
   * @param {THREE.Vector3} [o.origin] rest position for slide modes
   * @param {boolean} [o.isDeck] when true, mesh is rebaked into the wheel deck BVH each frame
   * @param {number} [o.phase0] initial motion phase (e.g. −π/2 starts elevator at bottom)
   */
  constructor({
    mesh,
    mode,
    speed,
    pivot = null,
    amplitude = 8,
    origin = null,
    isDeck = false,
    phase0 = 0,
  }) {
    this.mesh = mesh;
    this.pivot = pivot;
    this.mode = mode;
    this.speed = speed;
    this.amplitude = amplitude;
    this.origin = origin ? origin.clone() : mesh.position.clone();
    this.isDeck = isDeck;
    this.phase = phase0;
    this.bvh = new RoadBvh();
    this.label = mesh.name || mode;

    this._linVel = new THREE.Vector3();
    this._angVelW = new THREE.Vector3();
  }

  update(dt) {
    this.phase += this.speed * dt;
    if (this.mode === "spin-y" && this.pivot) {
      this.pivot.rotation.x = 0;
      this.pivot.rotation.y = this.phase;
      this._angVelW.set(0, this.speed, 0).applyQuaternion(this.pivot.getWorldQuaternion(_q));
      this._linVel.set(0, 0, 0);
    } else if (this.mode === "slide-z") {
      const offset = this.amplitude * Math.sin(this.phase);
      this.mesh.position.set(this.origin.x, this.origin.y, this.origin.z + offset);
      this._linVel.set(0, 0, this.amplitude * this.speed * Math.cos(this.phase));
      this._angVelW.set(0, 0, 0);
    } else if (this.mode === "slide-y") {
      const y = this.origin.y + this.amplitude * Math.sin(this.phase);
      this.mesh.position.set(this.origin.x, y, this.origin.z);
      this._linVel.set(0, this.amplitude * this.speed * Math.cos(this.phase), 0);
      this._angVelW.set(0, 0, 0);
    } else if (this.mode === "pendulum-x" && this.pivot) {
      const angle = this.amplitude * Math.sin(this.phase);
      this.pivot.rotation.x = angle;
      const angSpeed = this.amplitude * this.speed * Math.cos(this.phase);
      this._angVelW.set(angSpeed, 0, 0).applyQuaternion(this.pivot.getWorldQuaternion(_q));
      this._linVel.set(0, 0, 0);
    }
    this.mesh.updateMatrixWorld(true);
    if (!this.isDeck) this.bvh.bakeFromMeshes([this.mesh]);
  }

  /** Surface velocity at a world-space contact point (for chassis coupling). */
  velocityAt(worldPoint, out) {
    if ((this.mode === "spin-y" || this.mode === "pendulum-x") && this.pivot) {
      this.pivot.getWorldPosition(_pivotW);
      _r.subVectors(worldPoint, _pivotW);
      return out.crossVectors(this._angVelW, _r);
    }
    return out.copy(this._linVel);
  }
}

/* ----------------------------------------------------------------------- */
/* Parkour build                                                            */
/* ----------------------------------------------------------------------- */

export function buildParkour({ offset = new THREE.Vector3(100, 0, 0) } = {}) {
  const group = new THREE.Group();
  group.name = "Parkour";
  group.position.copy(offset);

  const deckMeshes = [];
  const wallMeshes = [];
  const movers = [];

  const _matRamp = (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.85, side: THREE.DoubleSide });
  const _matWall = (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.7, side: THREE.DoubleSide });
  const _matMover = (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.35, side: THREE.DoubleSide });

  function addRamp({ x, z, w = 14, l = 22, angleDeg = 25, yawDeg = 0, color = 0x6a5436 }) {
    const angle = THREE.MathUtils.degToRad(angleDeg);
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const m = new THREE.Mesh(rampGeometry(w, l, angle), _matRamp(color));
    m.rotation.order = "YXZ";
    m.rotation.y = yaw;
    m.position.set(x, 0, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    wallMeshes.push(m);
    return m;
  }

  function addCurveRamp({
    x,
    z,
    w = 12,
    radius = 16,
    angleDeg = 75,
    rise = 5,
    curveDir = 1,
    yawDeg = 0,
    segments = 32,
    color = 0x7a6248,
  }) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const m = new THREE.Mesh(
      curveRampGeometry(w, radius, angleDeg, rise, curveDir, segments),
      _matRamp(color),
    );
    m.rotation.order = "YXZ";
    m.rotation.y = yaw;
    m.position.set(x, 0, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    wallMeshes.push(m);
    return m;
  }

  function addKickerRamp({
    x,
    z,
    w = 14,
    length = 22,
    rise = 8,
    yawDeg = 0,
    segments = 36,
    color = 0x9a7848,
  }) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const m = new THREE.Mesh(kickerRampGeometry(w, length, rise, segments), _matRamp(color));
    m.rotation.order = "YXZ";
    m.rotation.y = yaw;
    m.position.set(x, 0, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    wallMeshes.push(m);
    return m;
  }

  function addJumpRamp({
    x,
    z,
    w = 14,
    length = 22,
    rise = 8,
    yawDeg = 0,
    segments = 36,
    color = 0x886838,
  }) {
    const yaw = THREE.MathUtils.degToRad(yawDeg);
    const m = new THREE.Mesh(jumpRampGeometry(w, length, rise, segments), _matRamp(color));
    m.rotation.order = "YXZ";
    m.rotation.y = yaw;
    m.position.set(x, 0, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    wallMeshes.push(m);
    return m;
  }

  function addStep({ x, z, w, h, l, color = 0x5e7a48 }) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), _matRamp(color));
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    wallMeshes.push(m);
    return m;
  }

  function addWall({ x, z, w, h, l, color = 0x803a3a }) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, l), _matWall(color));
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    wallMeshes.push(m);
    return m;
  }

  function addBank({ x, z, w, l, bankDeg, color = 0x3a5060 }) {
    const bank = THREE.MathUtils.degToRad(bankDeg);
    const m = new THREE.Mesh(bankGeometry(w, l, bank), _matRamp(color));
    m.position.set(x, 0, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    deckMeshes.push(m);
    wallMeshes.push(m);
    return m;
  }

  function addMover(cfg) {
    const mover = new ParkourMover(cfg);
    movers.push(mover);
    return mover;
  }

  // Layout: spawn at z=+62, drive toward −Z. Lanes — centre x≈0, left wing x≈−36,
  // right wing x≈+36, dynamic x≈+58, elevator x≈+72. Generous gaps between zones.

  // ── SLOPE LAB (z ≈ 48, ramps end ≈ z 24) ──
  const slopeAngles = [15, 25, 35, 45, 55];
  for (let i = 0; i < slopeAngles.length; i++) {
    const tint = 0.52 - i * 0.055;
    const color = new THREE.Color().setHSL(0.085, 0.42, tint).getHex();
    addRamp({ x: -42 + i * 21, z: 48, w: 12, l: 22, angleDeg: slopeAngles[i], color });
  }

  // ── CURVED RAMPS — left wing (arc climb + turn) ──
  addCurveRamp({
    x: -58,
    z: 34,
    w: 10,
    radius: 12,
    angleDeg: 72,
    rise: 4.5,
    curveDir: 1,
    segments: 28,
    color: 0x8a7050,
  });
  addCurveRamp({
    x: -58,
    z: -10,
    w: 16,
    radius: 26,
    angleDeg: 92,
    rise: 9,
    curveDir: 1,
    segments: 40,
    color: 0x6a5840,
  });

  // ── KICKERS — convex bulge vs concave jump (centre-right) ──
  addKickerRamp({
    x: 28,
    z: 42,
    w: 12,
    length: 20,
    rise: 7,
    segments: 36,
    color: 0xb88850,
  });
  addJumpRamp({
    x: 12,
    z: 42,
    w: 14,
    length: 22,
    rise: 8,
    segments: 36,
    color: 0x886838,
  });

  // ── MEGA KICKER + LANDING (centre lane, clear of slope ends) ──
  addRamp({ x: 0, z: 14, w: 16, l: 14, angleDeg: 38, color: 0xd97a3a });
  addStep({ x: 0, z: -4, w: 18, h: 1.2, l: 14, color: 0x8a6840 });

  // ── GAP JUMP — left wing only ──
  addStep({ x: -36, z: 4, w: 14, h: 1.5, l: 12, color: 0x6a8090 });
  addStep({ x: -36, z: -22, w: 14, h: 1.5, l: 14, color: 0x5a7080 });

  // ── STEP PYRAMID — right wing ──
  addStep({ x: 36, z: 22, w: 16, h: 0.9, l: 10, color: 0x4a6038 });
  addStep({ x: 36, z: 10, w: 16, h: 1.8, l: 10, color: 0x3a5028 });
  addStep({ x: 36, z: -2, w: 16, h: 2.8, l: 10, color: 0x2a4020 });

  // ── WHOOPS — right wing, below pyramid ──
  for (let i = 0; i < 10; i++) {
    addStep({ x: 36, z: -16 - i * 2.6, w: 14, h: 0.38, l: 1.1, color: 0x6e8050 });
  }

  // ── BANKED TURN (centre, well past whoops) ──
  addBank({ x: 0, z: -52, w: 20, l: 28, bankDeg: 32, color: 0x3a5060 });

  // ── HALF-PIPE — far left, offset from bank ──
  addRamp({ x: -52, z: -54, w: 10, l: 18, angleDeg: 52, yawDeg: 90, color: 0x5a4868 });
  addWall({ x: -60, z: -54, w: 0.8, h: 6, l: 20, color: 0x704868 });

  // ── PENDULUM — centre lane, between bank and wall alley ──
  const pendPivot = new THREE.Object3D();
  pendPivot.position.set(0, 15, -66);
  group.add(pendPivot);
  const pendArm = new THREE.Mesh(new THREE.BoxGeometry(0.6, 10, 0.6), _matMover(0x555555));
  pendArm.position.set(0, -5, 0);
  pendPivot.add(pendArm);
  const pendBob = new THREE.Mesh(new THREE.SphereGeometry(2.8, 20, 16), _matMover(0xb04040));
  pendBob.name = "Pendulum";
  pendBob.position.set(0, -10.5, 0);
  pendPivot.add(pendBob);
  addMover({
    mesh: pendBob,
    pivot: pendPivot,
    mode: "pendulum-x",
    speed: 0.75,
    amplitude: 0.72,
  });

  // ── WALL ALLEY — end of centre run ──
  addWall({ x: -12, z: -82, w: 0.8, h: 4, l: 22, color: 0x803a3a });
  addWall({ x: 12, z: -82, w: 0.8, h: 4, l: 22, color: 0x803a3a });
  addWall({ x: 0, z: -94, w: 25, h: 4, l: 0.8, color: 0xc04444 });

  // ── DYNAMIC ZONE (x ≈ +58, spaced along Z) ──
  const hammerPivot = new THREE.Object3D();
  hammerPivot.position.set(58, 5.5, 38);
  group.add(hammerPivot);
  const hammerBar = new THREE.Mesh(new THREE.BoxGeometry(24, 1.6, 1.6), _matMover(0xe8c040));
  hammerBar.name = "SpinHammer";
  hammerPivot.add(hammerBar);
  addMover({ mesh: hammerBar, pivot: hammerPivot, mode: "spin-y", speed: 0.85 });

  const pushGate = new THREE.Mesh(new THREE.BoxGeometry(8, 5, 3.5), _matMover(0x5080c0));
  pushGate.name = "PushGate";
  pushGate.position.set(58, 2.5, 52);
  group.add(pushGate);
  addMover({
    mesh: pushGate,
    mode: "slide-z",
    speed: 0.45,
    amplitude: 8,
    origin: pushGate.position.clone(),
  });

  const bar2Pivot = new THREE.Object3D();
  bar2Pivot.position.set(58, 2.2, 12);
  group.add(bar2Pivot);
  const hammerBar2 = new THREE.Mesh(new THREE.BoxGeometry(20, 1.4, 1.4), _matMover(0xc07030));
  hammerBar2.name = "SpinBarLow";
  bar2Pivot.add(hammerBar2);
  addMover({ mesh: hammerBar2, pivot: bar2Pivot, mode: "spin-y", speed: -1.1 });

  const pend2Pivot = new THREE.Object3D();
  pend2Pivot.position.set(58, 12, -8);
  group.add(pend2Pivot);
  const pend2Bob = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), _matMover(0xd06050));
  pend2Bob.name = "PendulumSmall";
  pend2Bob.position.set(0, -7, 0);
  pend2Pivot.add(pend2Bob);
  addMover({
    mesh: pend2Bob,
    pivot: pend2Pivot,
    mode: "pendulum-x",
    speed: 1.05,
    amplitude: 0.95,
  });

  const colPivot = new THREE.Object3D();
  colPivot.position.set(58, 3.5, -38);
  group.add(colPivot);
  const column = new THREE.Mesh(new THREE.BoxGeometry(3.5, 7, 3.5), _matMover(0x909090));
  column.name = "SpinColumn";
  colPivot.add(column);
  addMover({ mesh: column, pivot: colPivot, mode: "spin-y", speed: 0.55 });

  // ── ELEVATOR — far right wing (x ≈ +72) ──
  // Approach + bridge decks at y=1 m (top). Platform travel tuned so deck top
  // also hits 1.0 m at the bottom of the stroke (centre y = 0.55, h = 0.9).
  const elevDeckTop = 1.0;
  const elevHalf = 0.45;
  const elevLowCenter = elevDeckTop - elevHalf;
  const elevTravel = 5.0;
  const elevOriginY = elevLowCenter + elevTravel;

  addStep({ x: 72, z: 32, w: 12, h: elevDeckTop, l: 12, color: 0x607080 });
  addStep({ x: 72, z: 22, w: 12, h: elevDeckTop, l: 10, color: 0x687888 });
  addStep({ x: 72, z: 14, w: 12, h: elevDeckTop, l: 8, color: 0x687888 });
  addWall({ x: 68.2, z: 10, w: 0.7, h: 16, l: 16, color: 0x506070 });
  addWall({ x: 75.8, z: 10, w: 0.7, h: 16, l: 16, color: 0x506070 });
  addStep({ x: 72, z: -6, w: 11, h: 10, l: 10, color: 0x5a7080 });

  const elevPlatform = new THREE.Mesh(new THREE.BoxGeometry(10, 0.9, 12), _matRamp(0x8098a8));
  elevPlatform.name = "Elevator";
  const elevLeft = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 12), _matMover(0x607888));
  elevLeft.position.set(-5.25, 1.1, 0);
  const elevRight = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.2, 12), _matMover(0x607888));
  elevRight.position.set(5.25, 1.1, 0);
  elevPlatform.add(elevLeft, elevRight);
  group.add(elevPlatform);
  addMover({
    mesh: elevPlatform,
    mode: "slide-y",
    speed: 0.32,
    amplitude: elevTravel,
    origin: new THREE.Vector3(72, elevOriginY, 10),
    isDeck: true,
    phase0: -Math.PI / 2,
  });

  const deckMovers = movers.filter((m) => m.isDeck);

  const spawn = {
    pos: new THREE.Vector3(offset.x, offset.y, offset.z + 62),
    yaw: Math.PI,
  };

  function update(dt) {
    for (const m of movers) m.update(dt);
  }

  return { group, deckMeshes, wallMeshes, movers, deckMovers, spawn, update };
}
