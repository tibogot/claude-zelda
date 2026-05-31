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
  width: 16, // outer kerb-to-kerb deck width (m)
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
  /** Kerbs + W-beam guardrails on new pieces when true; flat deck when false. */
  enabled: true,
  beamHeight: 0.8, // vertical height of the W-beam (m)
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
  // Drivable vertical loop (teardrop + lateral offset so the up/down lanes don't
  // self-intersect). Half = one side ground→top; place two (mirror 2nd) for 360°.
  loopRadius: 18, // ring radius at the base (m)
  loopTighten: 0.34, // teardrop: how much the radius shrinks toward the top (0..0.7)
  loopOffset: 9, // lateral drift entry→top (m) so a mirrored pair clears itself
  loopAdvance: 28, // legacy full-loop param (older tracks)
  // Spiral ring / corkscrew (flat run + climbing wrapped arc):
  loopSpiralRadius: 12, // corkscrew radius (m)
  loopSpiralTurns: 1, // full revolutions around the travel axis
  loopSpiralPitch: 40, // forward advance per revolution (m)
  // Game line pieces (start / checkpoint / finish):
  gameLineLength: 16,
  // Twist / barrel roll (straight centreline that rolls):
  twistLength: 26,
  twistTurns: 1, // full 360° rolls over the length
  // Spiral / helix (constant-radius turn that also climbs):
  spiralRadius: 18,
  spiralAngle: 180, // degrees of arc (allow multi-turn for a true helix)
  spiralRise: 10, // total height gained over the arc (m)
  // Gap spacer (invisible air gap that drifts forward & drops):
  gapLength: 22, // forward run across the gap (m)
  gapDrop: 6, // height lost across the gap (m)
  // Landing ramp (enters pitched down, eases to level):
  landLength: 16,
  landAngle: 30, // entry down-pitch (deg)
  // Tunnel shell:
  tunnelHeight: 7, // interior clearance from deck to crown (m)
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
 * @param {object} p road cross-section params
 * @param {boolean} [withKerbs=true] false = flat deck only (no raised kerbs)
 * @returns {{ pts: {x:number,y:number,zone:number}[], hw:number }}
 */
export function buildProfile(p = roadParams, withKerbs = true) {
  const hw = p.width / 2;
  const t = Math.max(0.05, p.thickness);

  if (!withKerbs) {
    const pts = [
      { x: -hw, y: 0, zone: 1 },
      { x: hw, y: 0, zone: 1 },
      { x: hw, y: -t, zone: 0 },
      { x: -hw, y: -t, zone: 0 },
    ];
    return { pts, hw };
  }

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
/* Tunnel shell (open arch swept along the frames)                          */
/* ----------------------------------------------------------------------- */

/**
 * Tunnel shell — vertical side walls plus a semicircular crown, swept along the
 * piece frames and left open underneath so the deck stays drivable. Built as a
 * single surface (rendered double-sided) and baked into the SOLIDS BVH, so the
 * chassis is blocked by the walls/roof while the wheels still probe the deck.
 */
export function buildTunnelGeometry(frames, profileData = buildProfile(), pp = pieceParams) {
  const hw = profileData.hw;
  const xo = hw + 0.4; // walls sit just outside the deck edge
  const apex = Math.max(xo + 1.2, pp.tunnelHeight); // crown clearance above the deck
  const springY = Math.max(0.6, apex - xo); // wall height where the arch springs
  const arcSteps = 16;

  // Cross-section from left base, up the wall, over the arch, down the right wall.
  const prof = [
    { x: -xo, y: 0 },
    { x: -xo, y: springY },
  ];
  for (let k = 1; k <= arcSteps; k++) {
    const a = Math.PI * (1 - k / arcSteps); // PI (left springline) → 0 (right springline)
    prof.push({ x: Math.cos(a) * xo, y: springY + Math.sin(a) * xo });
  }
  prof.push({ x: xo, y: 0 });

  const F = frames.length;
  const P = prof.length;
  const along = new Float32Array(F);
  for (let i = 1; i < F; i++) along[i] = along[i - 1] + frames[i].pos.distanceTo(frames[i - 1].pos);

  const positions = [];
  const uvs = [];
  const indices = [];
  const p = new V3();
  for (let i = 0; i < F; i++) {
    const fr = frames[i];
    for (let j = 0; j < P; j++) {
      const pr = prof[j];
      p.copy(fr.pos).addScaledVector(fr.right, pr.x).addScaledVector(fr.up, pr.y);
      positions.push(p.x, p.y, p.z);
      uvs.push(along[i] * 0.12, j / (P - 1));
    }
  }
  for (let i = 0; i < F - 1; i++) {
    const r0 = i * P;
    const r1 = (i + 1) * P;
    for (let j = 0; j < P - 1; j++) {
      indices.push(r0 + j, r1 + j, r0 + j + 1, r0 + j + 1, r1 + j, r1 + j + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
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

/**
 * Constant lean across the whole piece. Holding the bank (rather than easing to
 * 0 at the ends) means consecutive banked curves keep a single continuous lean
 * with no flatten/crease at the seam. Use the Bank-in / Bank-out transitions to
 * ramp to and from a flat (level) piece.
 */
function bankRoll(t, pp) {
  const dir = pp.curveDir >= 0 ? 1 : -1;
  return dir * THREE.MathUtils.degToRad(pp.bankAngle);
}

/** Straight that ramps the lean 0 → bankAngle (flat → banked entry). */
function bankInRoll(t, pp) {
  const dir = pp.curveDir >= 0 ? 1 : -1;
  const a = THREE.MathUtils.degToRad(pp.bankAngle);
  return dir * a * (t * t * (3 - 2 * t));
}

/** Straight that ramps the lean bankAngle → 0 (banked → flat exit). */
function bankOutRoll(t, pp) {
  const dir = pp.curveDir >= 0 ? 1 : -1;
  const a = THREE.MathUtils.degToRad(pp.bankAngle);
  return dir * a * (1 - t * t * (3 - 2 * t));
}

/** Chicane: turn `curveAngle` one way then back the other, ending parallel. */
function sCurvePoints(pp) {
  const R = Math.max(2, pp.curveRadius);
  const A = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pp.curveAngle, 1, 120));
  const dir = pp.curveDir >= 0 ? 1 : -1;
  const half = Math.max(2, Math.ceil((R * A) / roadParams.segLen));
  const ds = (R * A) / half;
  const dth = A / half;
  const pts = [new V3(0, 0, 0)];
  const pos = new V3(0, 0, 0);
  let yaw = 0;
  const run = (sign) => {
    for (let i = 0; i < half; i++) {
      yaw += sign * dir * dth;
      pos.x += -Math.sin(yaw) * ds;
      pos.z += -Math.cos(yaw) * ds;
      pts.push(pos.clone());
    }
  };
  run(+1); // turn out by A
  run(-1); // turn back by A → heading returns to -Z, laterally offset
  return pts;
}

/** Smooth crest/dip: rises to slopeRise at the middle, flat (level) at both ends. */
function crestPoints(pp) {
  const L = Math.max(2, pp.slopeLength);
  const H = pp.slopeRise;
  const n = Math.max(4, Math.ceil(L / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const tt = i / n;
    const s = Math.sin(Math.PI * tt);
    pts.push(new V3(0, H * s * s, -L * tt)); // sin² → horizontal tangents at ends
  }
  return pts;
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

/**
 * One side of a *drivable* vertical loop: ground → over the top, built by
 * integrating a pitch angle from horizontal (0) to inverted (π). Two fixes over
 * a plain semicircle: (1) the radius tightens toward the top (`loopTighten`) so
 * the silhouette is a teardrop/clothoid, not a perfect ring; (2) the path drifts
 * laterally (`loopOffset`) so when you place this piece then its mirror (R /
 * curveDir flip), the climbing and descending lanes sit side-by-side instead of
 * colliding — a loop a car can actually drive. curveDir picks the lateral side.
 */
function loopHalfPoints(pp) {
  const R = Math.max(6, pp.loopRadius);
  const dir = pp.curveDir >= 0 ? 1 : -1;
  // Sideways gap each half adds (≈ one road width by default). curveDir flips the
  // drift side so a mirrored pair offsets laterally → the two feet of the loop sit
  // side-by-side with a gap, instead of one-behind-the-other. This is what makes
  // it a real drivable looping.
  const gap = pp.loopOffset ?? roadParams.width;
  const steps = Math.max(48, Math.ceil((Math.PI * R) / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    const theta = Math.PI * u; // 0 → π : floor → up → over to the inverted top
    // Tall vertical ramp in the travel plane (Y up, Z forward): a true semicircle,
    // entry on the floor (y=0) and exit inverted at the top (y=2R, z back to 0).
    const y = R * (1 - Math.cos(theta));
    const z = -R * Math.sin(theta);
    const x = dir * gap * u; // lateral drift → the sideways loop gap
    pts.push(new V3(x, y, z));
  }
  return pts;
}

/**
 * Full drivable LOOPING in one piece. A complete 360° vertical circle (Y/Z plane)
 * that also drifts sideways (X) as it goes around, so the entry foot and exit foot
 * both sit FLAT on the floor (y=0) but separated by `loopOffset` along the red (X)
 * axis — they don't meet. This lateral gap is what makes it a real looping.
 */
function loopPoints(pp) {
  const R = Math.max(6, pp.loopRadius);
  const dir = pp.curveDir >= 0 ? 1 : -1;
  const gap = pp.loopOffset ?? roadParams.width; // lateral entry→exit gap (m)
  const flat = Math.max(0, pp.loopFlat ?? R * 0.6); // flat lead-in / lead-out (m)
  const segN = Math.max(2, Math.ceil(flat / roadParams.segLen));
  const ringN = Math.max(96, Math.ceil((2 * Math.PI * R) / roadParams.segLen));
  const pts = [];
  // 1) Flat lead-in along -Z on the entry lane (x = -gap/2), so the loop reads as
  //    a piece sitting ON the road, not a floating ring.
  for (let i = 0; i < segN; i++) {
    pts.push(new V3(-gap / 2, 0, -flat * (i / segN)));
  }
  // 2) The vertical ring: a round circle in Y/Z (kept perfectly circular) that
  //    drifts sideways from the entry lane (-gap/2) to the exit lane (+gap/2), so
  //    the two feet are split along the red (X) axis but both sit flat on the floor.
  for (let i = 0; i <= ringN; i++) {
    const u = i / ringN;
    const theta = 2 * Math.PI * u; // bottom → up → over → back to bottom
    const y = R * (1 - Math.cos(theta));
    const z = -flat - dir * R * Math.sin(theta);
    // Lateral offset uses a CUBIC in u (not linear): the spread is concentrated at
    // the two feet while the body of the ring stays near x=0 — so it reads as a
    // round VERTICAL ring with its feet splayed apart, not a tilted coil/spring.
    const s = 2 * u - 1; // -1 (entry foot) → 0 (top) → +1 (exit foot)
    const x = (gap / 2) * s * s * s;
    pts.push(new V3(x, y, z));
  }
  // 3) Flat lead-out continuing along -Z on the exit lane (x = +gap/2).
  for (let i = 1; i <= segN; i++) {
    pts.push(new V3(gap / 2, 0, -flat - flat * (i / segN)));
  }
  return pts;
}

/**
 * Corkscrew spiral — a true helix wound around the travel (-Z) axis. The road
 * circles in the X/Y plane (radius R) while advancing forward, so the car drives
 * *through* the spiral like a barrel/corkscrew. `loopSpiralTurns` sets how many
 * full revolutions; `loopSpiralPitch` is forward advance per revolution; curveDir
 * picks the winding direction. Starts and ends tangent to -Z so it chains cleanly.
 */
function loopSpiralPoints(pp) {
  const R = Math.max(4, pp.loopSpiralRadius ?? pp.loopRadius ?? 12);
  const dir = pp.curveDir >= 0 ? 1 : -1;
  const turns = Math.max(0.25, pp.loopSpiralTurns ?? 1);
  const pitch = Math.max(R * 1.2, pp.loopSpiralPitch ?? R * 3); // forward run per turn
  const totalAngle = 2 * Math.PI * turns;
  const totalFwd = pitch * turns;
  const n = Math.max(48, Math.ceil((R * totalAngle) / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const theta = totalAngle * u;
    // Circle around the -Z axis: x sideways, y up, both starting at 0 so the
    // entry sits on the deck and the path leaves/returns tangent to -Z.
    const x = dir * R * Math.sin(theta);
    const y = R * (1 - Math.cos(theta));
    const z = -totalFwd * u;
    pts.push(new V3(x, y, z));
  }
  return pts;
}

function gameLinePoints(pp) {
  const L = Math.max(4, pp.gameLineLength ?? 16);
  const n = Math.max(2, Math.ceil(L / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(new V3(0, 0, -L * (i / n)));
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

/**
 * Spiral / helix: a constant-radius turn that also climbs at a steady rate, so
 * consecutive spirals stack into a continuous helix (great for gaining the
 * height a loop or big jump needs). Direction follows curveDir.
 */
function spiralPoints(pp) {
  const R = Math.max(3, pp.spiralRadius);
  const A = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pp.spiralAngle, 5, 1080));
  const dir = pp.curveDir >= 0 ? 1 : -1;
  const rise = pp.spiralRise;
  const n = Math.max(6, Math.ceil((R * A) / roadParams.segLen));
  const center = new V3(dir * R, 0, 0);
  const radius0 = new V3(-dir * R, 0, 0); // origin - center
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const tt = i / n;
    const pt = center.clone().add(rotateY(radius0, -dir * A * tt));
    pt.y = rise * tt; // rotateY preserves y, so set the climb after
    pts.push(pt);
  }
  return pts;
}

/**
 * Gap spacer: an *invisible* centreline that drifts forward and drops on a
 * parabola (level at entry). It builds no road — it only advances the open
 * connector across empty space and downward, so a landing ramp can be snapped
 * roughly where a jumped car comes back down.
 */
function gapPoints(pp) {
  const L = Math.max(4, pp.gapLength);
  const drop = pp.gapDrop;
  const n = Math.max(4, Math.ceil(L / roadParams.segLen));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const tt = i / n;
    pts.push(new V3(0, -drop * tt * tt, -L * tt));
  }
  return pts;
}

/** Landing ramp: enters pitched down at landAngle and eases to level at the exit. */
function landingPoints(pp) {
  const L = Math.max(2, pp.landLength);
  const ang = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pp.landAngle, 0, 80));
  const n = Math.max(2, Math.ceil(L / roadParams.segLen));
  const ds = L / n;
  const cur = new V3(0, 0, 0);
  const pts = [cur.clone()];
  for (let i = 1; i <= n; i++) {
    const u = 1 - i / n; // 1 at entry → 0 at exit
    const ph = -ang * u * u; // pitched down at entry, level at exit
    cur.y += Math.sin(ph) * ds;
    cur.z += -Math.cos(ph) * ds;
    pts.push(cur.clone());
  }
  return pts;
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
    hint: "Constant lean — chain freely",
    swatch: "#9b59b6",
    key: "4",
    points: curvePoints,
    roll: bankRoll,
  },
  {
    id: "banktilt",
    label: "Banked straight",
    hint: "Constant lean (straight) — chain freely",
    swatch: "#8e6fc0",
    points: straightPoints,
    roll: bankRoll,
  },
  {
    id: "bankin",
    label: "Bank in",
    hint: "Flat → banked (straight)",
    swatch: "#7d5fb0",
    key: "8",
    points: straightPoints,
    roll: bankInRoll,
  },
  {
    id: "bankout",
    label: "Bank out",
    hint: "Banked → flat (straight)",
    swatch: "#6b4fa0",
    key: "9",
    points: straightPoints,
    roll: bankOutRoll,
  },
  {
    id: "scurve",
    label: "S-curve",
    hint: "Chicane (R flips lead)",
    swatch: "#16a085",
    key: "0",
    points: sCurvePoints,
  },
  {
    id: "crest",
    label: "Crest / dip",
    hint: "Hill (slope rise = height)",
    swatch: "#d35400",
    key: "c",
    points: crestPoints,
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
    id: "start",
    label: "Start",
    hint: "Start line + arch",
    swatch: "#2ecc71",
    key: "s",
    points: gameLinePoints,
    game: "start",
  },
  {
    id: "checkpoint",
    label: "Checkpoint",
    hint: "Arch + direction arrows",
    swatch: "#3498db",
    key: "p",
    points: gameLinePoints,
    game: "checkpoint",
  },
  {
    id: "finish",
    label: "Finish",
    hint: "Checkered line + arch (both ends)",
    swatch: "#e74c3c",
    key: "f",
    points: gameLinePoints,
    game: "finish",
  },
  {
    id: "loop",
    label: "Loop (full)",
    hint: "Full 360° vertical ring",
    swatch: "#f1c40f",
    key: "",
    points: loopPoints,
  },
  {
    id: "loop_half",
    label: "Loop half",
    hint: "180° ring arc — place two (mirror 2nd) for a Sonic loop",
    swatch: "#f1c40f",
    key: "6",
    points: loopHalfPoints,
  },
  {
    id: "loop_spiral",
    label: "Loop spiral",
    hint: "Flat run + corkscrew ring arc",
    swatch: "#e67e22",
    key: "",
    points: loopSpiralPoints,
  },
  {
    id: "twist",
    label: "Twist / roll",
    hint: "Barrel roll",
    swatch: "#1abc9c",
    key: "",
    points: twistPoints,
    roll: twistRoll,
  },
  {
    id: "tunnel",
    label: "Tunnel",
    hint: "Enclosed straight (arch)",
    swatch: "#7f8c8d",
    key: "t",
    points: straightPoints,
    shell: true,
  },
  {
    id: "spiral",
    label: "Spiral / helix",
    hint: "Climbing turn — stack to gain height",
    swatch: "#2980b9",
    key: "h",
    points: spiralPoints,
  },
  {
    id: "gap",
    label: "Gap spacer",
    hint: "Invisible air gap (drops) — land beyond",
    swatch: "#34495e",
    key: "g",
    points: gapPoints,
    noMesh: true,
  },
  {
    id: "landing",
    label: "Landing ramp",
    hint: "Down-pitch easing to flat",
    swatch: "#c0392b",
    key: "l",
    points: landingPoints,
  },
];

export const PIECE_BY_ID = new Map(PIECE_CATALOG.map((p) => [p.id, p]));

/* ----------------------------------------------------------------------- */
/* Game-piece decor (checkered lines, arches, arrows)                       */
/* ----------------------------------------------------------------------- */

const _DECO_BLACK = new THREE.Color(0x111111);
const _DECO_WHITE = new THREE.Color(0xf4f4f4);
const _DECO_GREY = new THREE.Color(0xd8d8d8);
const _DECO_YELLOW = new THREE.Color(0xffcc00);

function _deckPt(fr, rx, rz, lift = 0.04) {
  return fr.pos
    .clone()
    .addScaledVector(fr.right, rx)
    .addScaledVector(fr.tangent, rz)
    .addScaledVector(fr.up, lift);
}

function _geoPart() {
  return { positions: [], normals: [], colors: [], indices: [] };
}

function _pushTri(part, a, b, c, n, ca, cb, cc) {
  const base = part.positions.length / 3;
  for (const [p, col] of [
    [a, ca],
    [b, cb],
    [c, cc],
  ]) {
    part.positions.push(p.x, p.y, p.z);
    part.normals.push(n.x, n.y, n.z);
    part.colors.push(col.r, col.g, col.b);
  }
  part.indices.push(base, base + 1, base + 2);
}

function _pushQuad(part, a, b, c, d, n, ca, cb, cc, cd) {
  const base = part.positions.length / 3;
  for (const [p, col] of [
    [a, ca],
    [b, cb],
    [c, cc],
    [d, cd],
  ]) {
    part.positions.push(p.x, p.y, p.z);
    part.normals.push(n.x, n.y, n.z);
    part.colors.push(col.r, col.g, col.b);
  }
  part.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function _partToGeo(part) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(part.positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(part.normals, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(part.colors, 3));
  g.setIndex(part.indices);
  return g;
}

function _checkerPart(fr, hw, depth, cols, rows) {
  const part = _geoPart();
  const n = fr.up.clone().normalize();
  const cellW = (hw * 2) / cols;
  const cellD = depth / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const c = (row + col) % 2 === 0 ? _DECO_BLACK : _DECO_WHITE;
      const x0 = -hw + col * cellW;
      const x1 = x0 + cellW;
      const z0 = -row * cellD;
      const z1 = z0 - cellD;
      _pushQuad(
        part,
        _deckPt(fr, x0, z0),
        _deckPt(fr, x1, z0),
        _deckPt(fr, x1, z1),
        _deckPt(fr, x0, z1),
        n,
        c,
        c,
        c,
        c,
      );
    }
  }
  return part;
}

function _archPart(fr, hw, height) {
  const part = _geoPart();
  const up = fr.up.clone().normalize();
  const right = fr.right.clone().normalize();
  const tan = fr.tangent.clone().normalize();
  const origin = fr.pos.clone();
  const postH = height * 0.82;
  const beamR = 0.18;
  const segs = 14;

  const postW = 0.22;
  for (const side of [-1, 1]) {
    const cx = right.clone().multiplyScalar(side * hw);
    const bl = origin.clone().add(cx).addScaledVector(tan, -postW * 0.5);
    const br = origin.clone().add(cx).addScaledVector(tan, postW * 0.5);
    const tl = bl.clone().addScaledVector(up, postH);
    const tr = br.clone().addScaledVector(up, postH);
    _pushQuad(part, bl, br, tr, tl, right.clone().multiplyScalar(side), _DECO_WHITE, _DECO_WHITE, _DECO_WHITE, _DECO_WHITE);
  }

  for (let i = 0; i < segs; i++) {
    const t0 = (Math.PI * i) / segs;
    const t1 = (Math.PI * (i + 1)) / segs;
    const c0 = Math.cos(t0);
    const s0 = Math.sin(t0);
    const c1 = Math.cos(t1);
    const s1 = Math.sin(t1);
    const p0 = origin.clone().addScaledVector(right, -hw * c0).addScaledVector(up, postH + height * 0.18 * s0);
    const p1 = origin.clone().addScaledVector(right, -hw * c1).addScaledVector(up, postH + height * 0.18 * s1);
    const p2 = p1.clone().addScaledVector(up, beamR);
    const p3 = p0.clone().addScaledVector(up, beamR);
    const mid = p0.clone().add(p1).multiplyScalar(0.5).sub(origin).normalize();
    _pushQuad(part, p0, p1, p2, p3, mid, _DECO_GREY, _DECO_GREY, _DECO_GREY, _DECO_GREY);
  }
  return part;
}

function _chevronPart(fr, hw, length, width) {
  const part = _geoPart();
  const n = fr.up.clone().normalize();
  const tip = _deckPt(fr, 0, -length);
  const l = _deckPt(fr, -width, 0);
  const r = _deckPt(fr, width, 0);
  _pushTri(part, tip, l, r, n, _DECO_YELLOW, _DECO_YELLOW, _DECO_YELLOW);
  return part;
}

function _bannerPart(fr, hw, height, textColor) {
  const part = _geoPart();
  const up = fr.up.clone().normalize();
  const right = fr.right.clone().normalize();
  const tan = fr.tangent.clone().normalize();
  const origin = fr.pos.clone();
  const y0 = height * 0.55;
  const y1 = height * 0.78;
  const bl = origin.clone().addScaledVector(right, -hw * 0.55).addScaledVector(up, y0).addScaledVector(tan, 0.35);
  const br = origin.clone().addScaledVector(right, hw * 0.55).addScaledVector(up, y0).addScaledVector(tan, 0.35);
  const tl = origin.clone().addScaledVector(right, -hw * 0.55).addScaledVector(up, y1).addScaledVector(tan, 0.35);
  const tr = origin.clone().addScaledVector(right, hw * 0.55).addScaledVector(up, y1).addScaledVector(tan, 0.35);
  _pushQuad(part, bl, br, tr, tl, tan.clone().negate(), textColor, textColor, textColor, textColor);
  return part;
}

/** Visual-only geometry for start / checkpoint / finish pieces. */
export function buildGameDecorGeometry(frames, profileData, gameType) {
  const hw = profileData.hw;
  const parts = [];
  const f0 = frames[0];
  const fN = frames[frames.length - 1];

  if (gameType === "start") {
    parts.push(_checkerPart(f0, hw, 3.2, 8, 2));
    parts.push(_archPart(f0, hw, 6.5));
    parts.push(_bannerPart(f0, hw, 6.5, _DECO_WHITE));
  } else if (gameType === "finish") {
    parts.push(_checkerPart(f0, hw, 3.2, 8, 2));
    parts.push(_archPart(f0, hw, 6.5));
    parts.push(_checkerPart(fN, hw, 3.2, 8, 2));
    parts.push(_archPart(fN, hw, 6.5));
    parts.push(_bannerPart(fN, hw, 6.5, _DECO_BLACK));
  } else if (gameType === "checkpoint") {
    const mid = frames[Math.floor(frames.length / 2)];
    parts.push(_archPart(mid, hw, 6));
    parts.push(_bannerPart(mid, hw, 6, _DECO_YELLOW));
    const step = Math.max(2, Math.floor(frames.length / 5));
    for (let i = step; i < frames.length - step * 0.5; i += step) {
      parts.push(_chevronPart(frames[i], hw * 0.55, 2.8, hw * 0.42));
    }
  }

  if (!parts.length) return null;
  const geos = parts.map(_partToGeo);
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}

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
 * @param {object} [gp] guardrail params snapshot
 * @param {boolean} [edges] kerbs + guardrails; defaults to gp.enabled
 */
export function buildPiece(pieceId, currentConnector, pp = pieceParams, rp = roadParams, gp = guardrailParams, edges = gp.enabled) {
  const def = PIECE_BY_ID.get(pieceId);
  if (!def) throw new Error(`Unknown road piece: ${pieceId}`);

  const points = def.points(pp);
  const frames = computeFrames(points, _up);
  if (def.roll) applyRoll(frames, def.roll, pp);
  const profileData = buildProfile(rp, edges);
  const geometry = buildSweepGeometry(frames, profileData);
  const railGeometry = edges && !def.noMesh ? buildGuardrailGeometry(frames, profileData, gp, rp) : null;
  const shellGeometry = def.shell ? buildTunnelGeometry(frames, profileData, pp) : null;
  const decorGeometry = def.game ? buildGameDecorGeometry(frames, profileData, def.game) : null;

  const f0 = frames[0];
  const fN = frames[frames.length - 1];
  // entry travel dir points INTO the piece (= tangent at start).
  const entryLocal = socketMatrix(f0.pos, f0.tangent, f0.up);
  // exit travel dir points OUT of the piece (= tangent at end).
  const exitLocal = socketMatrix(fN.pos, fN.tangent, fN.up);

  const world = currentConnector.clone().multiply(entryLocal.clone().invert());
  const connectorOut = world.clone().multiply(exitLocal);

  return { def, geometry, railGeometry, shellGeometry, decorGeometry, world, connectorOut };
}
