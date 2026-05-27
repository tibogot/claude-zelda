import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Grid module size in world units (meters). */
export const MOD = 4;
export const THICK = 0.2;

/**
 * Live building dimensions — change via UI; call `onParamsChange` to rebuild meshes.
 * @type {{
 *   wallH: number,
 *   floorH: number,
 *   roofPitch: number,
 *   onParamsChange: (() => void) | null,
 * }}
 */
export const buildParams = {
  wallH: 4.5,
  floorH: 0.15,
  /** Roof rise / half-module-width ratio (0.35 ≈ gentle, 0.65 ≈ steep). */
  roofPitch: 0.45,
  onParamsChange: null,
};

export function wallH() {
  return buildParams.wallH;
}
export function floorH() {
  return buildParams.floorH;
}
export function doorH() {
  return Math.min(buildParams.wallH - 0.35, buildParams.wallH * 0.72);
}
export function doorW() {
  return 1.35;
}
export function winW() {
  return 1.25;
}
export function winH() {
  return Math.min(1.65, buildParams.wallH * 0.38);
}
export function winSill() {
  return buildParams.wallH * 0.28;
}
export function roofBaseY() {
  return buildParams.wallH;
}
export function roofRise() {
  return MOD * 0.5 * buildParams.roofPitch;
}

/** Which cell vertex a corner occupies (rot 0..3). */
export const CORNER_VERTEX = [
  { dx: MOD, dz: MOD, label: "NE" },
  { dx: MOD, dz: 0, label: "SE" },
  { dx: 0, dz: 0, label: "SW" },
  { dx: 0, dz: MOD, label: "NW" },
];

const _matCache = new Map();

function mat(key, color, opts = {}) {
  const k = `${key}_${color}_${opts.transparent ?? false}_${opts.opacity ?? 1}`;
  if (!_matCache.has(k)) {
    _matCache.set(
      k,
      new THREE.MeshStandardMaterial({
        color,
        roughness: opts.roughness ?? 0.85,
        metalness: opts.metalness ?? 0.05,
        transparent: opts.transparent ?? false,
        opacity: opts.opacity ?? 1,
        side: opts.side ?? THREE.FrontSide,
      }),
    );
  }
  return _matCache.get(k);
}

function box(w, h, d, material) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function mergeMeshes(parts) {
  const geos = [];
  for (const p of parts) {
    p.updateMatrix();
    geos.push(p.geometry.clone().applyMatrix4(p.matrix));
  }
  const merged = mergeGeometries(geos, false);
  for (const p of parts) p.geometry.dispose();
  const mesh = new THREE.Mesh(merged, parts[0].material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** @typedef {"floor"|"structure"|"cap"} ModuleCategory */

/**
 * @typedef {object} ModuleDef
 * @property {string} id
 * @property {string} label
 * @property {string} hint
 * @property {ModuleCategory} category
 * @property {string} swatch
 * @property {() => THREE.Object3D} build
 */

/** @type {ModuleDef[]} */
export const MODULE_CATALOG = [
  {
    id: "floor",
    label: "Floor",
    hint: "4×4 slab",
    category: "floor",
    swatch: "#b8a88a",
    build: buildFloor,
  },
  {
    id: "wall",
    label: "Wall",
    hint: "Solid 4m",
    category: "structure",
    swatch: "#9a9590",
    build: buildWallPlain,
  },
  {
    id: "door",
    label: "Door",
    hint: "Walk-through",
    category: "structure",
    swatch: "#7a6a55",
    build: buildWallDoor,
  },
  {
    id: "window",
    label: "Window",
    hint: "Opening + glass",
    category: "structure",
    swatch: "#6a8aaa",
    build: buildWallWindow,
  },
  {
    id: "corner",
    label: "Corner",
    hint: "Vertex snap",
    category: "structure",
    swatch: "#8a8580",
    build: buildCorner,
  },
  {
    id: "roof_flat",
    label: "Flat roof",
    hint: "4×4 cap",
    category: "cap",
    swatch: "#6a5048",
    build: buildRoofFlat,
  },
  {
    id: "roof_gable",
    label: "Gable roof",
    hint: "Peaked cap",
    category: "cap",
    swatch: "#7a4038",
    build: buildRoofGable,
  },
  {
    id: "roof_tile",
    label: "Tile roof",
    hint: "Pantile waves",
    category: "cap",
    swatch: "#c06030",
    build: buildRoofTile,
  },
];

/** @type {Map<string, ModuleDef>} */
export const MODULE_BY_ID = new Map(MODULE_CATALOG.map((m) => [m.id, m]));

function buildFloor() {
  const g = new THREE.Group();
  g.name = "mod_floor";
  const fh = floorH();
  g.add(box(MOD, fh, MOD, mat("floor", 0xb8a88a)));
  g.children[0].position.y = fh * 0.5;
  return g;
}

function buildWallPlain() {
  const g = new THREE.Group();
  g.name = "mod_wall";
  const h = wallH();
  const wall = box(MOD, h, THICK, mat("wall", 0x9a9590));
  wall.position.y = h * 0.5;
  g.add(wall);
  return g;
}

function buildWallDoor() {
  const g = new THREE.Group();
  g.name = "mod_door";
  const h = wallH();
  const dH = doorH();
  const dW = doorW();
  const wallMat = mat("wall", 0x9a9590);
  const frameMat = mat("frame", 0x5c4033);
  const sideW = (MOD - dW) * 0.5;

  const left = box(sideW, h, THICK, wallMat);
  left.position.set(-(dW + sideW) * 0.5, h * 0.5, 0);
  const right = box(sideW, h, THICK, wallMat);
  right.position.set((dW + sideW) * 0.5, h * 0.5, 0);
  const lintel = box(dW, h - dH, THICK, wallMat);
  lintel.position.set(0, dH + (h - dH) * 0.5, 0);

  const frameL = box(0.08, dH, THICK + 0.04, frameMat);
  frameL.position.set(-dW * 0.5, dH * 0.5, 0);
  const frameR = box(0.08, dH, THICK + 0.04, frameMat);
  frameR.position.set(dW * 0.5, dH * 0.5, 0);
  const frameT = box(dW + 0.16, 0.08, THICK + 0.04, frameMat);
  frameT.position.set(0, dH, 0);

  g.add(mergeMeshes([left, right, lintel, frameL, frameR, frameT]));
  return g;
}

function buildWallWindow() {
  const g = new THREE.Group();
  g.name = "mod_window";
  const h = wallH();
  const wW = winW();
  const wH = winH();
  const sill = winSill();
  const wallMat = mat("wall", 0x9a9590);
  const frameMat = mat("frame", 0x5c4033);
  const glassMat = mat("glass", 0x88aacc, {
    transparent: true,
    opacity: 0.45,
    roughness: 0.1,
    metalness: 0.1,
  });
  const sideW = (MOD - wW) * 0.5;

  const left = box(sideW, h, THICK, wallMat);
  left.position.set(-(wW + sideW) * 0.5, h * 0.5, 0);
  const right = box(sideW, h, THICK, wallMat);
  right.position.set((wW + sideW) * 0.5, h * 0.5, 0);
  const below = box(wW, sill, THICK, wallMat);
  below.position.set(0, sill * 0.5, 0);
  const above = box(wW, h - sill - wH, THICK, wallMat);
  above.position.set(0, sill + wH + (h - sill - wH) * 0.5, 0);

  const glass = box(wW - 0.16, wH - 0.16, 0.04, glassMat);
  glass.position.set(0, sill + wH * 0.5, 0);

  const frameL = box(0.08, wH, THICK + 0.04, frameMat);
  frameL.position.set(-wW * 0.5, sill + wH * 0.5, 0);
  const frameR = box(0.08, wH, THICK + 0.04, frameMat);
  frameR.position.set(wW * 0.5, sill + wH * 0.5, 0);
  const frameT = box(wW, 0.08, THICK + 0.04, frameMat);
  frameT.position.set(0, sill + wH, 0);
  const frameB = box(wW, 0.08, THICK + 0.04, frameMat);
  frameB.position.set(0, sill, 0);

  g.add(mergeMeshes([left, right, below, above, frameL, frameR, frameT, frameB]));
  g.add(glass);
  return g;
}

/** L-corner: vertex at origin, arms extend −X and −Z (exterior) before Y rotation. */
function buildCorner() {
  const g = new THREE.Group();
  g.name = "mod_corner";
  const h = wallH();
  const wallMat = mat("wall", 0x8a8580);
  const armX = box(MOD, h, THICK, wallMat);
  armX.position.set(-MOD * 0.5, h * 0.5, -THICK * 0.5);
  const armZ = box(THICK, h, MOD, wallMat);
  armZ.position.set(-THICK * 0.5, h * 0.5, -MOD * 0.5);
  g.add(mergeMeshes([armX, armZ]));
  return g;
}

function buildRoofFlat() {
  const g = new THREE.Group();
  g.name = "mod_roof_flat";
  const base = roofBaseY();
  const roof = box(MOD, THICK, MOD, mat("roof", 0x6a5048));
  roof.position.y = base + THICK * 0.5;
  g.add(roof);
  return g;
}

/** Gable roof — ridge runs along Z; rotate 90° for E/W ridge. */
function buildRoofGable() {
  const g = new THREE.Group();
  g.name = "mod_roof_gable";
  const base = roofBaseY();
  const rise = roofRise();
  const roofMat = mat("roof", 0x7a4038);
  const halfW = MOD * 0.5;
  const slopeLen = Math.hypot(halfW, rise);

  const panelGeo = new THREE.BoxGeometry(slopeLen, THICK, MOD);
  const left = new THREE.Mesh(panelGeo, roofMat);
  left.castShadow = true;
  left.receiveShadow = true;
  left.position.set(-halfW * 0.5, base + rise * 0.5, 0);
  left.rotation.z = Math.atan2(rise, halfW);

  const right = new THREE.Mesh(panelGeo.clone(), roofMat);
  right.castShadow = true;
  right.receiveShadow = true;
  right.position.set(halfW * 0.5, base + rise * 0.5, 0);
  right.rotation.z = -Math.atan2(rise, halfW);

  g.add(left, right);
  return g;
}

/** Pantile roof — open half-cylinder barrels across X, courses step in Z. */
function buildRoofTile() {
  const g = new THREE.Group();
  g.name = "mod_roof_tile";
  const base = roofBaseY();

  const tileMat = mat("terracotta", 0xe06830, { roughness: 0.9 });

  const waveCount = 8;
  const radius = MOD / (2 * waveCount);
  const tileDepth = 0.5;
  const courseStepZ = tileDepth * 0.62;
  const courseCount = Math.ceil(MOD / courseStepZ);
  const courseLiftY = 0.018;

  /** Open half-cylinder shell (no end caps → less z-fighting between courses). */
  function halfPipeGeometry(r, depth) {
    const geo = new THREE.CylinderGeometry(r, r, depth, 28, 1, true, 0, Math.PI);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, r, 0);
    return geo;
  }

  const tileGeo = halfPipeGeometry(radius, tileDepth);
  const parts = [];
  const startX = -MOD * 0.5 + radius;

  for (let iz = 0; iz < courseCount; iz++) {
    for (let ix = 0; ix < waveCount; ix++) {
      const tile = new THREE.Mesh(tileGeo, tileMat);
      tile.position.set(
        startX + ix * radius * 2,
        base + iz * courseLiftY,
        -MOD * 0.5 + tileDepth * 0.5 + iz * courseStepZ,
      );
      parts.push(tile);
    }
  }

  if (parts.length) g.add(mergeMeshes(parts));
  tileGeo.dispose();

  return g;
}

/**
 * Instantiate a catalog module (cloned group).
 * @param {string} moduleId
 * @returns {THREE.Group}
 */
export function createModuleInstance(moduleId) {
  const def = MODULE_BY_ID.get(moduleId);
  if (!def) throw new Error(`Unknown module: ${moduleId}`);
  const root = def.build();
  root.userData.moduleId = moduleId;
  root.userData.category = def.category;
  return root;
}

/**
 * World position for a grid cell center.
 * @param {number} gx
 * @param {number} gz
 */
export function cellToWorld(gx, gz, target = new THREE.Vector3()) {
  return target.set(gx * MOD + MOD * 0.5, 0, gz * MOD + MOD * 0.5);
}

/**
 * Snap world XZ to grid cell indices.
 * @param {number} x
 * @param {number} z
 * @returns {{ gx: number, gz: number }}
 */
export function worldToCell(x, z) {
  return {
    gx: Math.floor(x / MOD),
    gz: Math.floor(z / MOD),
  };
}

/**
 * Storage key — structure pieces include rotation (edge or corner vertex).
 */
export function cellKey(gx, gz, category, rot = 0, _moduleId = "") {
  if (category === "structure") {
    const r = ((rot % 4) + 4) % 4;
    return `${gx},${gz},${category},${r}`;
  }
  return `${gx},${gz},${category}`;
}

/**
 * World transform for a module — floors/roofs at cell center, walls on edges, corners on vertices.
 */
export function getModuleTransform(moduleId, gx, gz, rot) {
  const def = MODULE_BY_ID.get(moduleId);
  const r = ((rot % 4) + 4) % 4;
  let rotationY = r * Math.PI * 0.5;
  const pos = cellToWorld(gx, gz);

  if (!def) return { position: pos, rotationY };

  if (moduleId === "corner") {
    const v = CORNER_VERTEX[r];
    pos.set(gx * MOD + v.dx, 0, gz * MOD + v.dz);
    // Base mesh arms −X/−Z; rotate so they point away from building interior.
    rotationY = ((2 - r + 4) % 4) * Math.PI * 0.5;
    return { position: pos, rotationY };
  }

  if (def.category === "structure") {
    const cx = gx * MOD + MOD * 0.5;
    const cz = gz * MOD + MOD * 0.5;
    if (r === 0) pos.set(cx, 0, (gz + 1) * MOD - THICK * 0.5);
    else if (r === 1) pos.set((gx + 1) * MOD - THICK * 0.5, 0, cz);
    else if (r === 2) pos.set(cx, 0, gz * MOD + THICK * 0.5);
    else pos.set(gx * MOD + THICK * 0.5, 0, cz);
  }

  return { position: pos, rotationY };
}

/** Wall/door/window — snaps to cell edge band. */
export function isEdgeModule(moduleId) {
  const def = MODULE_BY_ID.get(moduleId);
  return def?.category === "structure" && moduleId !== "corner";
}

export function isCornerModule(moduleId) {
  return moduleId === "corner";
}

/** Small starter hut layout for demo. */
export const DEMO_HUT = [
  { id: "floor", gx: 0, gz: 0, rot: 0 },
  { id: "floor", gx: 1, gz: 0, rot: 0 },
  { id: "floor", gx: 0, gz: 1, rot: 0 },
  { id: "floor", gx: 1, gz: 1, rot: 0 },
  { id: "wall", gx: 0, gz: -1, rot: 0 },
  { id: "door", gx: 1, gz: -1, rot: 0 },
  { id: "window", gx: 0, gz: 2, rot: 2 },
  { id: "window", gx: 1, gz: 2, rot: 2 },
  { id: "wall", gx: -1, gz: 0, rot: 1 },
  { id: "wall", gx: -1, gz: 1, rot: 1 },
  { id: "wall", gx: 2, gz: 0, rot: 3 },
  { id: "wall", gx: 2, gz: 1, rot: 3 },
  /* corners snap to grid vertices (use R to pick SW/SE/NE/NW of cell) */
  { id: "corner", gx: 0, gz: 0, rot: 2 },
  { id: "corner", gx: 2, gz: 0, rot: 2 },
  { id: "corner", gx: -1, gz: 2, rot: 1 },
  { id: "corner", gx: 2, gz: 2, rot: 2 },
  { id: "roof_tile", gx: 0, gz: 0, rot: 0 },
  { id: "roof_tile", gx: 1, gz: 0, rot: 0 },
  { id: "roof_tile", gx: 0, gz: 1, rot: 0 },
  { id: "roof_tile", gx: 1, gz: 1, rot: 0 },
];

export function setBuildParams(partial) {
  Object.assign(buildParams, partial);
  buildParams.onParamsChange?.();
}
