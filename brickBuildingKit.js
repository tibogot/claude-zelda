import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * BRICK BUILDING KIT — portable procedural masonry generator.
 *
 * Extracted from brick-material-lab.html (itself the medieval-arch-showcase
 * wall+arch layout). Pure geometry generation: given a params object and a
 * material, it lays GPU-instanced bricks into a wall with an arched opening and
 * returns a single InstancedMesh (one draw call).
 *
 * The lab is the first host that verifies this kit; the same module then drops
 * into v2 as the basis of the building tool. Erosion (ruins) and the spline
 * wall-follow mode layer on top of this generator later; runtime destruction is
 * deferred to the gameplay layer.
 *
 * Knows nothing about scene/UI/gizmos — caller adds the returned mesh to the
 * scene and sets shadow flags.
 */

// ── Deterministic RNG (so a given colorSeed always lays the same bricks) ──
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Arch path math (round / pointed openings) ──
function pointedArchGeom(R, k) {
  const c = R * Math.max(0, k);
  const r = c + R;
  const apexDy = Math.sqrt(Math.max(0, R * (R + 2 * c)));
  return { c, r, apexDy };
}

function subtractIntervals(intervals, holeLo, holeHi) {
  if (holeHi <= holeLo) return intervals;
  const out = [];
  for (const [a, b] of intervals) {
    if (b <= a + 1e-6) continue;
    if (holeHi <= a || holeLo >= b) {
      out.push([a, b]);
      continue;
    }
    if (holeLo > a + 1e-4) out.push([a, Math.min(holeLo, b)]);
    if (holeHi < b - 1e-4) out.push([Math.max(holeHi, a), b]);
  }
  return out;
}

function wallOpeningHalfX(y, R_out, y0, ys, seam, archShape, pointedness) {
  if (y < y0 - 1e-6) return 0;
  if (y < ys - 1e-6) return R_out + seam;
  const dy = y - ys;
  if (archShape === "pointed") {
    const { c, r, apexDy } = pointedArchGeom(R_out, pointedness);
    if (dy > apexDy + 1e-6) return 0;
    const inner = r * r - dy * dy;
    if (inner <= 0) return 0;
    const halfW = -c + Math.sqrt(inner);
    if (halfW <= 0) return 0;
    return halfW + seam;
  }
  if (dy > R_out + 1e-6) return 0;
  const inner = R_out * R_out - dy * dy;
  if (inner <= 0) return 0;
  return Math.sqrt(inner) + seam;
}

function wallOpeningCurvature(y, R_out, y0, ys, seam, archShape, pointedness) {
  const e = 0.06;
  const a = wallOpeningHalfX(y + e, R_out, y0, ys, seam, archShape, pointedness);
  const b = wallOpeningHalfX(y - e, R_out, y0, ys, seam, archShape, pointedness);
  return Math.abs(a - b) / e;
}

// ── Per-brick variation (shader "personality" + depth recession) ──
function pickBrickShaderVar(rnd) {
  let shapeMix, warp;
  const u = rnd();
  if (u < 0.18) {
    shapeMix = 0.28 + rnd() * 0.12;
    warp = 0.45 + rnd() * 0.4;
  } else if (u < 0.4) {
    shapeMix = 0.4 + rnd() * 0.15;
    warp = 0.28 + rnd() * 0.3;
  } else {
    shapeMix = 0.55 + rnd() * 0.2;
    warp = 0.18 + rnd() * 0.22;
  }
  return { shapeMix, warp, grey: 0.28 + rnd() * 0.5, grain: rnd() };
}

function pickDepthPlacement(rnd, params) {
  const spread = THREE.MathUtils.clamp(params.depthSpread, 0, 1);
  const recessFrac = Math.max(0, params.depthRecess);
  if (spread <= 0 || recessFrac <= 0) {
    const sz = 1;
    return { sz, z: -(params.brickD * sz) * 0.5, recess: 0 };
  }
  const u = Math.pow(rnd(), 0.88);
  const sz = 1 - u * recessFrac * 0.22;
  let recess = u * recessFrac * params.brickD * spread;
  recess = Math.min(recess, Math.max(0, params.wallDepth - params.brickD * sz));
  const z = -recess - (params.brickD * sz) * 0.5;
  return { sz, z, recess };
}

function pickPlanSy(rnd, params) {
  const v = THREE.MathUtils.clamp(params.planVariety, 0, 1);
  if (v <= 0) return 1;
  return THREE.MathUtils.lerp(1, 0.94 + rnd() * 0.06, v);
}

function setBrickVarAt(mesh, index, shapeMix, warp, grey, grain) {
  const att = mesh.geometry.getAttribute("brickVar");
  if (!att) return;
  const a = att.array;
  const o = index * 4;
  a[o] = shapeMix;
  a[o + 1] = warp;
  a[o + 2] = grey;
  a[o + 3] = grain;
}

// ── Geometry ──
export function createBrickBaseGeometry(params) {
  const rRound = Math.max(0.0001, params.brickRound);
  const segs = Math.max(1, Math.min(6, params.roundSegments | 0));
  return new RoundedBoxGeometry(
    params.brickW,
    params.brickH,
    params.brickD,
    segs,
    rRound,
  );
}

function createInstancedBrickGeometry(baseGeo, capacity) {
  const g = baseGeo.clone();
  const arr = new Float32Array(capacity * 4);
  const att = new THREE.InstancedBufferAttribute(arr, 4);
  // Instance data is uploaded once after build and never changes per-frame
  // (except during the deferred destruction feature).
  att.setUsage(THREE.StaticDrawUsage);
  g.setAttribute("brickVar", att);
  return g;
}

/**
 * Build the wall + arched opening as a single InstancedMesh.
 *
 * @param {object} params  masonry params (see brick-material-lab `params`)
 * @param {THREE.Material} material  the brick material (instanced-aware)
 * @param {{ baseGeo?: THREE.BufferGeometry }} [opts]  reuse a base brick geo
 * @returns {THREE.InstancedMesh} positioned at z = params.wallZ; caller adds to
 *          scene and sets cast/receiveShadow.
 */
export function generateBrickWall(params, material, opts = {}) {
  const baseGeo = opts.baseGeo || createBrickBaseGeometry(params);

  const R_in = Math.max(0.08, params.doorInnerHalfW);
  const R_out = R_in + Math.max(0.05, params.masonryShell);
  const doorSill = params.sillY;
  const ys = params.sillY + Math.max(0.05, params.legHeight); // springline
  const seam = params.wallSeamInset;
  const mortar = params.wallMortar;
  const nomH = params.brickH;
  const nomW = params.brickW;
  const rowH = nomH + mortar;
  const wallLo = -params.wallWidth * 0.5;
  const wallHi = params.wallWidth * 0.5;
  const wallBase = params.wallAnchorY;
  const baseY = wallBase + mortar * 0.5 + nomH * 0.5;
  const topY = wallBase + Math.max(nomH * 2, params.wallHeight);
  const ny = Math.min(220, Math.max(3, Math.ceil((topY - baseY) / rowH)));

  const wallMesh = new THREE.InstancedMesh(
    createInstancedBrickGeometry(baseGeo, params.maxWallBricks),
    material,
    params.maxWallBricks,
  );
  wallMesh.position.set(0, 0, params.wallZ);

  const tmpO = new THREE.Object3D();
  const rnd = mulberry32((params.colorSeed ^ 91379) | 0);
  let k = 0;
  const gx = params.archAlong; // gate (opening) center X

  const placeWallBrick = (cx, cy, sx, crownSy) => {
    if (k >= params.maxWallBricks) return false;
    const shader = pickBrickShaderVar(rnd);
    const depth = pickDepthPlacement(rnd, params);
    const sy = pickPlanSy(rnd, params) * crownSy;
    const sz = depth.sz * (0.92 + rnd() * 0.06);
    tmpO.position.set(cx, cy, depth.z);
    tmpO.rotation.set(0, 0, 0);
    tmpO.scale.set(sx, sy, sz);
    tmpO.updateMatrix();
    wallMesh.setMatrixAt(k, tmpO.matrix);
    setBrickVarAt(wallMesh, k, shader.shapeMix, shader.warp, shader.grey, shader.grain);
    k++;
    return true;
  };

  outer: for (let iy = 0; iy < ny; iy++) {
    const yMid = baseY + iy * rowH;
    if (yMid > topY - nomH * 0.2) break;

    const openH = wallOpeningHalfX(
      yMid, R_out, doorSill, ys, seam, params.archShape, params.archPointedness,
    );
    let intervals = [[wallLo, wallHi]];
    if (openH > 1e-5) {
      intervals = subtractIntervals(intervals, gx - openH, gx + openH);
    }

    const curv = wallOpeningCurvature(
      yMid, R_out, doorSill, ys, seam, params.archShape, params.archPointedness,
    );
    const curveT = THREE.MathUtils.smoothstep(0.06, 1.15, curv);
    const nomWCurve =
      nomW *
      THREE.MathUtils.lerp(
        1,
        THREE.MathUtils.clamp(params.wallMinBrickScale, 0.16, 0.95),
        Math.pow(curveT, 1.08),
      );

    const haunch =
      yMid >= ys - mortar * 1.5 && yMid <= ys + R_out * 1.05
        ? THREE.MathUtils.smoothstep(ys - 0.12, ys + R_out * 0.82, yMid)
        : 0;
    const crownSy =
      1 -
      (1 - THREE.MathUtils.clamp(params.wallCrownSquash, 0.42, 1)) *
        Math.pow(haunch, 1.28);

    for (const [segLo, segHi] of intervals) {
      const span = segHi - segLo;
      if (span < nomW * params.wallMinBrickScale * 0.45) continue;

      const minW = nomW * params.wallMinBrickScale;
      const jMin = 0.0035;
      const jMax = Math.min(mortar, Math.max(jMin, span * 0.014 + jMin * 0.6));
      const j = THREE.MathUtils.clamp(mortar, jMin, jMax);
      const hj = j * 0.5;
      let innerLo = segLo + hj;
      let innerHi = segHi - hj;
      if (iy % 2 === 1) {
        const shift = Math.min(
          (nomWCurve + j) * 0.48,
          Math.max(0, innerHi - innerLo - minW * 1.2) * 0.35,
        );
        const eps = Math.max(1e-3, nomW * 0.025);
        const rightOfOpening = openH > 1e-5 && segLo >= gx + openH - eps;
        const leftOfOpening = openH > 1e-5 && segHi <= gx - openH + eps;
        if (rightOfOpening) innerHi -= shift;
        else if (leftOfOpening) innerLo += shift;
        else innerLo += shift;
      }

      const innerLen = innerHi - innerLo;
      if (innerLen < minW * 0.72) continue;

      let nBricks = Math.max(1, Math.round(innerLen / (nomWCurve + j)));
      let wEq = (innerLen - (nBricks - 1) * j) / nBricks;
      for (let it = 0; it < 96; it++) {
        wEq = (innerLen - (nBricks - 1) * j) / nBricks;
        if (wEq < minW * 0.998) {
          if (nBricks <= 1) break;
          nBricks--;
        } else if (wEq > nomWCurve * 1.075 && nBricks < 1600) {
          nBricks++;
        } else break;
      }
      wEq = (innerLen - (nBricks - 1) * j) / nBricks;
      if (wEq < minW * 0.88) continue;

      for (let bi = 0; bi < nBricks; bi++) {
        if (k >= params.maxWallBricks) break outer;
        const cx = innerLo + wEq * 0.5 + bi * (wEq + j);
        if (cx > innerHi - wEq * 0.5 + 1e-4) break;

        let tuckY = 0;
        if (openH > 1e-4 && curveT > 0.04) {
          const gap = Math.max(0, Math.abs(cx - gx) - openH);
          const band = params.brickW * 3.8;
          if (gap < band) {
            const t = THREE.MathUtils.smoothstep(1, 0, gap / band);
            tuckY = -nomH * 0.12 * Math.pow(t, 1.2) * Math.pow(curveT, 0.55);
          }
        }

        const sx = wEq / nomW;
        if (!placeWallBrick(cx, yMid + tuckY, sx, crownSy)) break outer;
      }
    }
  }

  wallMesh.count = k;
  wallMesh.instanceMatrix.needsUpdate = true;
  const wbv = wallMesh.geometry.getAttribute("brickVar");
  if (wbv) wbv.needsUpdate = true;
  return wallMesh;
}
