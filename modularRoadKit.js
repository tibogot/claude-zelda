import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Modular Road kit — parametric track pieces built by sweeping a single shared
 * cross-section profile along each piece's centerline using a parallel-transport
 * (minimal-twist) frame. The shared profile guarantees pieces mate seamlessly at
 * their sockets; the transport frame keeps the design loop/bank-ready from day one.
 *
 * Coordinate convention (piece-local): the centerline starts at the origin and
 * heads toward -Z. Up is +Y. "Right" of travel is +X (= cross(tangent, up)).
 */

const V3 = THREE.Vector3;
const _up = new V3(0, 1, 0);

/** Shared cross-section appearance — edit via UI, then call onChange to rebuild. */
export const roadParams = {
  width: 11, // outer kerb-to-kerb deck width (m)
  thickness: 0.8, // slab depth below the deck (m) — this is the "depth"
  railWidth: 0.5, // kerb width on each side (m)
  railHeight: 0.22, // kerb height above the deck (m) — low; guardrail sits on top
  segLen: 1.6, // target sweep step length along the path (m)
  onChange: null,
};

/**
 * Guardrail that sits on top of each kerb (W-beam + posts), adapted from the
 * objects-lab guardrail but driven by the piece's own transport frames so it
 * follows slopes/curves in 3D. Built as a separate metal mesh per piece.
 */
export const guardrailParams = {
  enabled: true,
  beamHeight: 0.3, // vertical height of the W-beam (m)
  beamDepth: 0.1, // lateral thickness of the beam (m)
  beamGap: 0.16, // gap from kerb top to beam bottom (m)
  crownFrac: 0.22, // depth of the central W indent (fraction of beamDepth)
  postSpacing: 4, // meters between posts
  postWidth: 0.1, // lateral width of a post (m)
  postThickness: 0.1, // along-travel thickness of a post (m)
  onChange: null,
};

/** Per-piece geometry params (global for v1; per-instance can come later). */
export const pieceParams = {
  straightLength: 22,
  curveRadius: 26,
  curveAngle: 90, // degrees of arc
  curveDir: 1, // +1 = right turn, -1 = left turn
  slopeLength: 26, // horizontal run of the slope (m)
  slopeRise: 9, // vertical rise over the run (m); negative = downhill
  // Banked curve (reuses curveRadius/curveAngle/curveDir):
  bankAngle: 22, // peak lean in degrees, eased to 0 at both ends
  // Jump / launch ramp:
  jumpLength: 18, // arc length of the ramp (m)
  jumpAngle: 28, // takeoff angle at the exit (deg)
  // Vertical loop:
  loopRadius: 9, // loop radius (m)
  loopAdvance: 7, // forward drift over the loop so the exit clears the entry (m)
  // Twist / barrel roll (straight centreline that rolls):
  twistLength: 26,
  twistTurns: 1, // full 360° rolls over the length
  onChange: null,
};

/* ----------------------------------------------------------------------- */
/* Cross-section profile                                                    */
/* ----------------------------------------------------------------------- */

/**
 * Build the closed cross-section outline in the local (x = lateral, y = vertical)
 * plane. The deck top sits at y = 0; rails rise to +railHeight; the slab extends
 * down to -thickness. Each point carries a `zone`: 0 = side/underside,
 * 1 = drivable deck, 2 = rail top.
 * @returns {{ pts: {x:number,y:number,zone:number}[], hw:number }}
 */
export function buildProfile(p = roadParams) {
  const hw = p.width / 2;
  const t = Math.max(0.05, p.thickness);
  const rw = Math.min(Math.max(0.0, p.railWidth), hw * 0.45);
  const rh = Math.max(0.0, p.railHeight);

  // Clockwise outline (x right, y up): top across, down the right face,
  // back across the underside, up the left face. Closed (last -> first).
  const pts = [
    { x: -hw, y: rh, zone: 2 }, // left rail, outer top
    { x: -hw + rw, y: rh, zone: 2 }, // left rail, inner top
    { x: -hw + rw, y: 0, zone: 1 }, // deck, left edge
    { x: hw - rw, y: 0, zone: 1 }, // deck, right edge
    { x: hw - rw, y: rh, zone: 2 }, // right rail, inner top
    { x: hw, y: rh, zone: 2 }, // right rail, outer top
    { x: hw, y: -t, zone: 0 }, // underside, right
    { x: -hw, y: -t, zone: 0 }, // underside, left
  ];
  return { pts, hw };
}

/* ----------------------------------------------------------------------- */
/* Parallel-transport frames                                                */
/* ----------------------------------------------------------------------- */

/**
 * Compute a minimal-twist frame at each centerline point.
 * @param {THREE.Vector3[]} points
 * @param {THREE.Vector3} [up0]
 * @returns {{pos:THREE.Vector3, tangent:THREE.Vector3, up:THREE.Vector3, right:THREE.Vector3}[]}
 */
export function computeFrames(points, up0 = _up) {
  const n = points.length;
  const tangents = [];
  for (let i = 0; i < n; i++) {
    let t;
    if (i === 0) t = points[1].clone().sub(points[0]);
    else if (i === n - 1) t = points[n - 1].clone().sub(points[n - 2]);
    else t = points[i + 1].clone().sub(points[i - 1]);
    if (t.lengthSq() < 1e-12) t.set(0, 0, -1);
    tangents.push(t.normalize());
  }

  const frames = [];
  // Seed frame: project up0 perpendicular to the first tangent.
  let right = new V3().crossVectors(tangents[0], up0);
  if (right.lengthSq() < 1e-10) right = new V3().crossVectors(tangents[0], new V3(1, 0, 0));
  right.normalize();
  let up = new V3().crossVectors(right, tangents[0]).normalize();
  frames.push({ pos: points[0].clone(), tangent: tangents[0].clone(), up, right });

  const axis = new V3();
  const q = new THREE.Quaternion();
  for (let i = 1; i < n; i++) {
    const prevT = tangents[i - 1];
    const curT = tangents[i];
    let newUp;
    axis.crossVectors(prevT, curT);
    const len = axis.length();
    if (len < 1e-7) {
      newUp = frames[i - 1].up.clone();
    } else {
      axis.divideScalar(len);
      const ang = Math.acos(THREE.MathUtils.clamp(prevT.dot(curT), -1, 1));
      q.setFromAxisAngle(axis, ang);
      newUp = frames[i - 1].up.clone().applyQuaternion(q).normalize();
    }
    const r = new V3().crossVectors(curT, newUp).normalize();
    const u = new V3().crossVectors(r, curT).normalize();
    frames.push({ pos: points[i].clone(), tangent: curT.clone(), up: u, right: r });
  }
  return frames;
}

/**
 * Roll each frame about its own tangent by `rollFn(t, pp)` radians (banking,
 * barrel rolls). Frames whose roll is 0 at both ends stay connectable level.
 */
export function applyRoll(frames, rollFn, pp) {
  const F = frames.length;
  const q = new THREE.Quaternion();
  for (let i = 0; i < F; i++) {
    const t = F > 1 ? i / (F - 1) : 0;
    const ang = rollFn(t, pp);
    if (Math.abs(ang) < 1e-9) continue;
    q.setFromAxisAngle(frames[i].tangent, ang);
    frames[i].up.applyQuaternion(q).normalize();
    frames[i].right.crossVectors(frames[i].tangent, frames[i].up).normalize();
  }
}

/* ----------------------------------------------------------------------- */
/* Sweep mesh                                                               */
/* ----------------------------------------------------------------------- */

/**
 * Sweep the shared profile along the given frames into a BufferGeometry.
 * Strips are emitted per profile-edge with un-shared vertices so each face keeps
 * crisp slab edges and a constant `aZone`. Attributes: position, normal, uv
 * (x = meters along path, y = meters across developed profile), aLateral
 * (x / halfWidth, for centre/edge lines), aZone (0 side, 1 deck, 2 rail).
 */
export function buildSweepGeometry(frames, profileData = buildProfile()) {
  const { pts: profile, hw } = profileData;
  const M = profile.length;
  const F = frames.length;

  // Cumulative distance along the path (for uv.x).
  const along = new Float32Array(F);
  for (let i = 1; i < F; i++) {
    along[i] = along[i - 1] + frames[i].pos.distanceTo(frames[i - 1].pos);
  }

  // Cumulative developed distance across the closed profile (for uv.y).
  const dev = new Float32Array(M + 1);
  for (let k = 0; k < M; k++) {
    const a = profile[k];
    const b = profile[(k + 1) % M];
    dev[k + 1] = dev[k] + Math.hypot(b.x - a.x, b.y - a.y);
  }

  const positions = [];
  const uvs = [];
  const lateral = [];
  const zone = [];
  const indices = [];

  const pa = new V3();
  const pb = new V3();
  let vbase = 0;

  for (let k = 0; k < M; k++) {
    const a = profile[k];
    const b = profile[(k + 1) % M];
    const edgeZone = a.zone === 1 && b.zone === 1 ? 1 : a.zone === 2 && b.zone === 2 ? 2 : 0;
    const devA = dev[k];
    const devB = dev[k + 1];

    for (let i = 0; i < F; i++) {
      const fr = frames[i];
      pa.copy(fr.pos).addScaledVector(fr.right, a.x).addScaledVector(fr.up, a.y);
      pb.copy(fr.pos).addScaledVector(fr.right, b.x).addScaledVector(fr.up, b.y);
      positions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
      uvs.push(along[i], devA, along[i], devB);
      lateral.push(a.x / hw, b.x / hw);
      zone.push(edgeZone, edgeZone);
    }

    for (let i = 0; i < F - 1; i++) {
      const r0 = vbase + i * 2; // pa_i
      const i0 = r0;
      const i1 = r0 + 1; // pb_i
      const i2 = r0 + 2; // pa_{i+1}
      const i3 = r0 + 3; // pb_{i+1}
      indices.push(i0, i1, i3, i0, i3, i2);
    }
    vbase += F * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute("aLateral", new THREE.Float32BufferAttribute(lateral, 1));
  geo.setAttribute("aZone", new THREE.Float32BufferAttribute(zone, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/* ----------------------------------------------------------------------- */
/* Guardrail (W-beam + posts) along the kerb tops                           */
/* ----------------------------------------------------------------------- */

/** W-beam cross-section in (vertical y, lateral z) meters, about the beam centre. */
function wBeamProfile(h, d, crownFrac) {
  return [
    { y: -0.5 * h, z: 0.5 * d },
    { y: -0.16 * h, z: 0.32 * d },
    { y: 0.0, z: -crownFrac * d },
    { y: 0.16 * h, z: 0.32 * d },
    { y: 0.5 * h, z: 0.5 * d },
  ];
}

/** Sweep a small (y,z) profile along the frames, offset to one kerb edge. */
function sweepBeamGeometry(frames, edgeX, centerV, prof) {
  const F = frames.length;
  const R = prof.length;
  const along = new Float32Array(F);
  for (let i = 1; i < F; i++) along[i] = along[i - 1] + frames[i].pos.distanceTo(frames[i - 1].pos);

  const positions = [];
  const uvs = [];
  const indices = [];
  const p = new V3();
  for (let i = 0; i < F; i++) {
    const fr = frames[i];
    for (let j = 0; j < R; j++) {
      const pr = prof[j];
      p.copy(fr.pos)
        .addScaledVector(fr.right, edgeX + pr.z)
        .addScaledVector(fr.up, centerV + pr.y);
      positions.push(p.x, p.y, p.z);
      uvs.push(along[i], j / (R - 1));
    }
  }
  for (let i = 0; i < F - 1; i++) {
    const r0 = i * R;
    const r1 = (i + 1) * R;
    for (let j = 0; j < R - 1; j++) {
      indices.push(r0 + j, r1 + j, r0 + j + 1, r0 + j + 1, r1 + j, r1 + j + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const _m = new THREE.Matrix4();
const _pos = new V3();

/** Posts connecting kerb top to the beam, spaced along the path on one side. */
function buildPostGeometries(frames, edgeX, kerbTop, centerV, gp, out) {
  const F = frames.length;
  let total = 0;
  for (let i = 1; i < F; i++) total += frames[i].pos.distanceTo(frames[i - 1].pos);
  const n = Math.max(2, Math.floor(total / Math.max(0.5, gp.postSpacing)) + 1);
  const postH = Math.max(0.05, centerV - kerbTop + gp.beamHeight * 0.4);
  const postCenterV = kerbTop + postH * 0.5;
  for (let k = 0; k < n; k++) {
    const idx = Math.round((k / (n - 1)) * (F - 1));
    const fr = frames[idx];
    const box = new THREE.BoxGeometry(gp.postWidth, postH, gp.postThickness);
    _pos.copy(fr.pos).addScaledVector(fr.right, edgeX).addScaledVector(fr.up, postCenterV);
    _m.makeBasis(fr.right, fr.up, fr.tangent).setPosition(_pos);
    box.applyMatrix4(_m);
    out.push(box);
  }
}

/**
 * Build the guardrail (both kerbs) for a piece in local space, or null when
 * disabled. Returns a single merged geometry (beams + posts).
 */
export function buildGuardrailGeometry(frames, profileData = buildProfile(), gp = guardrailParams, rp = roadParams) {
  if (!gp.enabled || gp.beamHeight <= 0) return null;
  const hw = profileData.hw;
  const rw = Math.min(Math.max(0, rp.railWidth), hw * 0.45);
  const kerbTop = rp.railHeight;
  const centerV = kerbTop + gp.beamGap + gp.beamHeight * 0.5;
  const edgeX = hw - rw * 0.5; // centre of each kerb
  const prof = wBeamProfile(gp.beamHeight, gp.beamDepth, gp.crownFrac);

  const geos = [];
  for (const side of [-1, 1]) {
    geos.push(sweepBeamGeometry(frames, side * edgeX, centerV, prof));
    buildPostGeometries(frames, side * edgeX, kerbTop, centerV, gp, geos);
  }
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  if (merged) merged.computeBoundingSphere();
  return merged;
}

/* ----------------------------------------------------------------------- */
/* Piece centerlines                                                        */
/* ----------------------------------------------------------------------- */

function rotateY(v, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return new V3(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
}

function straightPoints(pp) {
  const L = Math.max(1, pp.straightLength);
  const n = Math.max(2, Math.ceil(L / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(new V3(0, 0, -L * (i / n)));
  return pts;
}

function curvePoints(pp) {
  const R = Math.max(2, pp.curveRadius);
  const A = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pp.curveAngle, 1, 180));
  const dir = pp.curveDir >= 0 ? 1 : -1;
  const arc = R * A;
  const n = Math.max(2, Math.ceil(arc / roadParams.segLen));
  const center = new V3(dir * R, 0, 0);
  const radius0 = new V3(-dir * R, 0, 0); // origin - center
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const phi = A * (i / n);
    pts.push(center.clone().add(rotateY(radius0, -dir * phi)));
  }
  return pts;
}

function slopePoints(pp) {
  const L = Math.max(2, pp.slopeLength);
  const H = pp.slopeRise;
  const n = Math.max(2, Math.ceil(L / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const tt = i / n;
    const sm = tt * tt * (3 - 2 * tt); // smoothstep — horizontal tangents at both ends
    pts.push(new V3(0, H * sm, -L * tt));
  }
  return pts;
}

/** Lean eased to 0 at both ends so the banked curve still connects level. */
function bankRoll(t, pp) {
  const dir = pp.curveDir >= 0 ? 1 : -1;
  const a = THREE.MathUtils.degToRad(pp.bankAngle);
  return dir * a * Math.sin(Math.PI * t);
}

/** Launch ramp: pitches up from horizontal to jumpAngle at the exit. */
function jumpPoints(pp) {
  const L = Math.max(2, pp.jumpLength);
  const ang = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pp.jumpAngle, 0, 80));
  const n = Math.max(2, Math.ceil(L / roadParams.segLen));
  const ds = L / n;
  const cur = new V3(0, 0, 0);
  const pts = [cur.clone()];
  for (let i = 1; i <= n; i++) {
    const ph = ang * (i / n) * (i / n); // ease-in: horizontal at start
    cur.y += Math.sin(ph) * ds;
    cur.z += -Math.cos(ph) * ds;
    pts.push(cur.clone());
  }
  return pts;
}

/** Vertical loop in the Y/Z plane, drifting forward so the exit clears entry. */
function loopPoints(pp) {
  const R = Math.max(3, pp.loopRadius);
  const adv = Math.max(0, pp.loopAdvance);
  const n = Math.max(24, Math.ceil((2 * Math.PI * R) / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const phi = 2 * Math.PI * f;
    pts.push(new V3(0, R - R * Math.cos(phi), -R * Math.sin(phi) - adv * f));
  }
  return pts;
}

function twistPoints(pp) {
  const L = Math.max(2, pp.twistLength);
  const n = Math.max(12, Math.ceil(L / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(new V3(0, 0, -L * (i / n)));
  return pts;
}

/** Full 360° rolls over the length; ends back at level (multiple of 2π). */
function twistRoll(t, pp) {
  return 2 * Math.PI * Math.max(1, Math.round(pp.twistTurns)) * t;
}

/** @type {{id:string,label:string,hint:string,swatch:string,key:string,points:(pp:any)=>THREE.Vector3[]}[]} */
export const PIECE_CATALOG = [
  {
    id: "straight",
    label: "Straight",
    hint: "Flat run",
    swatch: "#4a9eff",
    key: "1",
    points: straightPoints,
  },
  {
    id: "curve",
    label: "Curve",
    hint: "Flat arc (R flips L/R)",
    swatch: "#5cb85c",
    key: "2",
    points: curvePoints,
  },
  {
    id: "slope",
    label: "Slope / Ramp",
    hint: "Climb or descend",
    swatch: "#e8912d",
    key: "3",
    points: slopePoints,
  },
  {
    id: "banked",
    label: "Banked curve",
    hint: "Arc with lean (R flips)",
    swatch: "#9b59b6",
    key: "4",
    points: curvePoints,
    roll: bankRoll,
  },
  {
    id: "jump",
    label: "Jump ramp",
    hint: "Angled takeoff",
    swatch: "#e74c3c",
    key: "5",
    points: jumpPoints,
  },
  {
    id: "loop",
    label: "Loop",
    hint: "Vertical 360°",
    swatch: "#f1c40f",
    key: "6",
    points: loopPoints,
  },
  {
    id: "twist",
    label: "Twist / roll",
    hint: "Barrel roll",
    swatch: "#1abc9c",
    key: "7",
    points: twistPoints,
    roll: twistRoll,
  },
];

export const PIECE_BY_ID = new Map(PIECE_CATALOG.map((p) => [p.id, p]));

/* ----------------------------------------------------------------------- */
/* Sockets + placement math                                                 */
/* ----------------------------------------------------------------------- */

/**
 * Connector basis for a socket: -Z axis = travel direction, +Y ~ up. Used for
 * both ends with the same convention so continuity is `W * entry = exit`.
 */
export function socketMatrix(pos, travelDir, up, target = new THREE.Matrix4()) {
  const z = travelDir.clone().multiplyScalar(-1).normalize();
  let x = new V3().crossVectors(up, z);
  if (x.lengthSq() < 1e-10) x = new V3().crossVectors(new V3(0, 1, 0), z);
  x.normalize();
  const y = new V3().crossVectors(z, x).normalize();
  target.makeBasis(x, y, z).setPosition(pos);
  return target;
}

/** The open connector for an empty track: origin, heading -Z, up +Y. */
export function initialConnector() {
  return socketMatrix(new V3(0, 0, 0), new V3(0, 0, -1), new V3(0, 1, 0));
}

/**
 * Build everything needed to place a piece: its local geometry plus the world
 * matrix that snaps its entry connector onto `currentConnector`, and the new
 * open connector left at its exit.
 * @param {string} pieceId
 * @param {THREE.Matrix4} currentConnector
 * @param {object} [pp] piece params snapshot
 * @param {object} [rp] road params snapshot
 */
export function buildPiece(pieceId, currentConnector, pp = pieceParams, rp = roadParams, gp = guardrailParams) {
  const def = PIECE_BY_ID.get(pieceId);
  if (!def) throw new Error(`Unknown road piece: ${pieceId}`);

  const points = def.points(pp);
  const frames = computeFrames(points, _up);
  if (def.roll) applyRoll(frames, def.roll, pp);
  const profileData = buildProfile(rp);
  const geometry = buildSweepGeometry(frames, profileData);
  const railGeometry = buildGuardrailGeometry(frames, profileData, gp, rp);

  const f0 = frames[0];
  const fN = frames[frames.length - 1];
  // entry travel dir points INTO the piece (= tangent at start).
  const entryLocal = socketMatrix(f0.pos, f0.tangent, f0.up);
  // exit travel dir points OUT of the piece (= tangent at end).
  const exitLocal = socketMatrix(fN.pos, fN.tangent, fN.up);

  const world = currentConnector.clone().multiply(entryLocal.clone().invert());
  const connectorOut = world.clone().multiply(exitLocal);

  return { def, geometry, railGeometry, world, connectorOut };
}
