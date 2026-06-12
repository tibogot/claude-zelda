/**
 * CoH-style static map props — roads, ruin clusters, tank traps, wire.
 * Feeds nav stamping, cover evaluation, and runtime obstacle push-out.
 */
import * as THREE from "three";

export const RTS_MAP_PROPS_DEFAULTS = {
  enabled: true,
  roads: false,
  ruins: true,
  tankTraps: true,
  wire: true,
  roadWidth: 1,
  ruinScale: 1,
};

/** Authored placements tuned for RTS_MAP_SIZE ~1440, bases at z ≈ ±528. */
export const RTS_MAP_PROP_LAYOUT = {
  roads: [
    {
      id: "main-ew",
      width: 9,
      points: [
        [-440, 18],
        [-240, 12],
        [-80, 6],
        [80, 0],
        [240, -6],
        [440, -14],
      ],
    },
    {
      id: "main-ns",
      width: 7,
      points: [
        [28, -440],
        [28, -240],
        [28, -60],
        [28, 80],
        [28, 260],
        [28, 440],
      ],
    },
    {
      id: "player-approach",
      width: 6,
      points: [
        [-72, 460],
        [-48, 340],
        [-20, 200],
        [0, 80],
      ],
    },
    {
      id: "enemy-approach",
      width: 6,
      points: [
        [64, -460],
        [36, -340],
        [12, -200],
        [0, -72],
      ],
    },
  ],
  ruinClusters: [
    {
      id: "crossroads",
      x: -88,
      z: 36,
      rot: 0.35,
      pieces: [
        { x: 0, z: 0, w: 14, d: 10, h: 4.2, coverTier: "yellow" },
        { x: 10, z: -6, w: 8, d: 7, h: 2.8, coverTier: "yellow" },
        { x: -9, z: 8, w: 6, d: 9, h: 2.2, coverTier: "green" },
        { x: 5, z: 10, w: 5, d: 5, h: 1.6, coverTier: "green" },
        { x: -12, z: -4, w: 9, d: 5, h: 3.4, coverTier: "red" },
      ],
    },
    {
      id: "west-hamlet",
      x: -268,
      z: 148,
      rot: -0.5,
      pieces: [
        { x: 0, z: 0, w: 12, d: 9, h: 3.8, coverTier: "yellow" },
        { x: 11, z: 4, w: 7, d: 6, h: 2.4, coverTier: "green" },
        { x: -8, z: -7, w: 8, d: 8, h: 2.9, coverTier: "yellow" },
        { x: 4, z: -9, w: 10, d: 4, h: 1.8, coverTier: "green" },
      ],
    },
    {
      id: "east-farm",
      x: 252,
      z: -108,
      rot: 0.9,
      pieces: [
        { x: 0, z: 0, w: 16, d: 8, h: 3.2, coverTier: "yellow" },
        { x: -10, z: 6, w: 6, d: 10, h: 2.5, coverTier: "green" },
        { x: 9, z: -5, w: 7, d: 7, h: 3.6, coverTier: "red" },
        { x: 2, z: 9, w: 5, d: 5, h: 1.5, coverTier: "green" },
      ],
    },
    {
      id: "north-ruins",
      x: -52,
      z: 272,
      rot: 0.1,
      pieces: [
        { x: 0, z: 0, w: 11, d: 11, h: 4.5, coverTier: "red" },
        { x: 8, z: -5, w: 6, d: 8, h: 2.2, coverTier: "yellow" },
        { x: -7, z: 6, w: 7, d: 5, h: 1.9, coverTier: "green" },
      ],
    },
    {
      id: "south-ruins",
      x: 108,
      z: -228,
      rot: -0.25,
      pieces: [
        { x: 0, z: 0, w: 13, d: 9, h: 3.5, coverTier: "yellow" },
        { x: -9, z: 4, w: 8, d: 6, h: 2.8, coverTier: "yellow" },
        { x: 7, z: -6, w: 5, d: 7, h: 2.0, coverTier: "green" },
      ],
    },
  ],
  tankTrapLines: [
    { x: -108, z: -168, rot: 0, count: 11, spacing: 4.2 },
    { x: 108, z: -168, rot: 0, count: 11, spacing: 4.2 },
    { x: -72, z: 156, rot: Math.PI * 0.5, count: 9, spacing: 4.0 },
    { x: 72, z: 156, rot: Math.PI * 0.5, count: 9, spacing: 4.0 },
  ],
  wireLines: [
    {
      id: "enemy-belt",
      halfWidth: 1.35,
      points: [
        [-200, -340],
        [-120, -358],
        [-40, -348],
        [40, -362],
        [120, -352],
        [200, -368],
      ],
    },
    {
      id: "mid-south",
      halfWidth: 1.2,
      points: [
        [-140, -120],
        [-60, -132],
        [20, -124],
        [100, -136],
      ],
    },
    {
      id: "player-belt",
      halfWidth: 1.35,
      points: [
        [-180, 318],
        [-100, 332],
        [-20, 324],
        [60, 338],
        [140, 328],
        [210, 342],
      ],
    },
  ],
};

function yawPoint(x, z, rot) {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return { x: x * c - z * s, z: x * s + z * c };
}

function coverRadius(w, d) {
  return Math.max(w, d) * 0.42 + 1.2;
}

function addHedgehog(group, x, z, rotY, mats, getHeight) {
  const g = new THREE.Group();
  const len = 2.1;
  const thick = 0.22;
  for (let i = 0; i < 3; i++) {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(thick, thick, len),
      mats.trap,
    );
    beam.rotation.y = rotY + (i * Math.PI) / 3;
    beam.position.y = len * 0.28;
    beam.castShadow = true;
    g.add(beam);
  }
  const y = getHeight(x, z);
  g.position.set(x, y, z);
  g.rotation.y = rotY * 0.37;
  group.add(g);
  return { x, z, r: 1.85, coverTier: "green" };
}

const ROAD_LIFT = 0.14;
const ROAD_STEP = 2;
const ROAD_PROBE = 2.8;

/** Max height in a small neighborhood + slope-aware lift so the deck clears the mesh. */
function sampleRoadSurfaceY(getHeight, x, z, lift = ROAD_LIFT) {
  let h = getHeight(x, z);
  const p = ROAD_PROBE;
  const offsets = [
    [p, 0],
    [-p, 0],
    [0, p],
    [0, -p],
    [p * 0.72, p * 0.72],
    [-p * 0.72, p * 0.72],
    [p * 0.72, -p * 0.72],
    [-p * 0.72, -p * 0.72],
    [p * 0.38, 0],
    [-p * 0.38, 0],
    [0, p * 0.38],
    [0, -p * 0.38],
  ];
  for (const [ox, oz] of offsets) {
    h = Math.max(h, getHeight(x + ox, z + oz));
  }
  const hPx = getHeight(x + 1.4, z) - getHeight(x - 1.4, z);
  const hPz = getHeight(x, z + 1.4) - getHeight(x, z - 1.4);
  const slope = Math.hypot(hPx, hPz) * 0.5;
  return h + lift + Math.min(slope * 0.4, 0.3);
}

/** Ribbon deck — uniform height per cross-section (matches flattened corridor). */
function buildRoadRibbon(group, pts, halfW, mat, getHeight, lift = ROAD_LIFT) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;

    const steps = Math.max(2, Math.ceil(len / ROAD_STEP));
    const perpX = -dz / len;
    const perpZ = dx / len;

    const positions = [];
    const uvs = [];
    const indices = [];

    const stations = [];
    const pushStation = (t) => {
      const cx = x0 + dx * t;
      const cz = z0 + dz * t;
      const y = sampleRoadSurfaceY(getHeight, cx, cz, lift);
      stations.push({
        lx: cx + perpX * halfW,
        lz: cz + perpZ * halfW,
        rx: cx - perpX * halfW,
        rz: cz - perpZ * halfW,
        y,
        t,
      });
    };

    for (let s = 0; s <= steps; s++) pushStation(s / steps);
    for (let s = 0; s < steps; s++) pushStation((s + 0.5) / steps);
    stations.sort((a, b) => a.t - b.t);

    for (let s = 0; s < stations.length; s++) {
      const st = stations[s];
      positions.push(st.lx, st.y, st.lz, st.rx, st.y, st.rz);
      uvs.push(st.t, 0, st.t, 1);

      if (s < stations.length - 1) {
        const a = s * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, c, b, b, c, d);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;
    group.add(mesh);
  }
}

function buildRoadStrip(group, road, mats, getHeight, widthMul) {
  const width = road.width * widthMul;
  const halfW = width * 0.5;
  buildRoadRibbon(group, road.points, halfW, mats.road, getHeight);

  const edgeW = 0.42;
  const outer = halfW + edgeW * 0.5;
  for (const side of [-1, 1]) {
    const offsetPts = [];
    const pts = road.points;
    for (let p = 0; p < pts.length; p++) {
      let dirX = 0;
      let dirZ = 1;
      if (p < pts.length - 1) {
        const dx = pts[p + 1][0] - pts[p][0];
        const dz = pts[p + 1][1] - pts[p][1];
        const l = Math.hypot(dx, dz) || 1;
        dirX = dx / l;
        dirZ = dz / l;
      } else if (p > 0) {
        const dx = pts[p][0] - pts[p - 1][0];
        const dz = pts[p][1] - pts[p - 1][1];
        const l = Math.hypot(dx, dz) || 1;
        dirX = dx / l;
        dirZ = dz / l;
      }
      const perpX = -dirZ * side;
      const perpZ = dirX * side;
      offsetPts.push([
        pts[p][0] + perpX * outer,
        pts[p][1] + perpZ * outer,
      ]);
    }
    buildRoadRibbon(
      group,
      offsetPts,
      edgeW * 0.5,
      mats.roadEdge,
      getHeight,
      ROAD_LIFT - 0.02,
    );
  }
}

function buildRuinPiece(group, cluster, piece, mats, getHeight, scale) {
  const local = yawPoint(piece.x * scale, piece.z * scale, cluster.rot);
  const x = cluster.x + local.x;
  const z = cluster.z + local.z;
  const w = piece.w * scale;
  const d = piece.d * scale;
  const h = piece.h * scale;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    piece.coverTier === "red" ? mats.rubbleHeavy : mats.rubble,
  );
  const y = getHeight(x, z);
  mesh.position.set(x, y + h * 0.5 - 0.15, z);
  mesh.rotation.y = cluster.rot + (piece.x + piece.z) * 0.07;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const r = coverRadius(w, d);
  return {
    x,
    z,
    r,
    coverTier: piece.coverTier ?? "yellow",
    navR: Math.max(w, d) * 0.38 + 0.8,
  };
}

function buildWireLine(group, line, mats, getHeight, out) {
  const pts = line.points;
  const hw = line.halfWidth ?? 1.2;
  for (let i = 0; i < pts.length; i++) {
    const [x, z] = pts[i];
    const y = getHeight(x, z);
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 1.35, 6),
      mats.wirePost,
    );
    post.position.set(x, y + 0.62, z);
    post.castShadow = true;
    group.add(post);
    out.navCircles.push({ x, z, r: hw + 0.35 });
    out.pushCircles.push({ x, z, r: hw + 0.5 });
    out.coverPieces.push({
      x,
      z,
      r: hw + 1.8,
      coverTier: "green",
    });
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    const midX = (x0 + x1) * 0.5;
    const midZ = (z0 + z1) * 0.5;
    const y = (getHeight(x0, z0) + getHeight(x1, z1)) * 0.5;
    const strand = new THREE.Mesh(
      new THREE.BoxGeometry(len, 0.08, 0.06),
      mats.wire,
    );
    strand.position.set(midX, y + 0.72, midZ);
    strand.rotation.y = Math.atan2(dx, dz);
    group.add(strand);
    out.navSegments.push({ x0, z0, x1, z1, halfWidth: hw });
  }
}

/**
 * @param {THREE.Scene} scene
 * @param {object} opts
 * @param {(x:number,z:number)=>number} opts.getHeight
 * @param {object} [opts.config]
 * @param {object} [opts.layout]
 */
export function createRtsMapProps(scene, opts = {}) {
  const getHeight = opts.getHeight ?? (() => 0);
  const config = { ...RTS_MAP_PROPS_DEFAULTS, ...opts.config };
  const layout = opts.layout ?? RTS_MAP_PROP_LAYOUT;

  const group = new THREE.Group();
  group.name = "RtsMapProps";
  scene.add(group);

  const roadMatOpts = {
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  };
  const mats = {
    road: new THREE.MeshStandardMaterial({
      color: 0x5a5248,
      roughness: 0.92,
      metalness: 0.02,
      ...roadMatOpts,
    }),
    roadEdge: new THREE.MeshStandardMaterial({
      color: 0x4a4438,
      roughness: 0.95,
      metalness: 0,
      ...roadMatOpts,
    }),
    rubble: new THREE.MeshStandardMaterial({
      color: 0x6a6258,
      roughness: 0.94,
      metalness: 0.03,
    }),
    rubbleHeavy: new THREE.MeshStandardMaterial({
      color: 0x524a42,
      roughness: 0.96,
      metalness: 0.04,
    }),
    trap: new THREE.MeshStandardMaterial({
      color: 0x4a4a52,
      roughness: 0.72,
      metalness: 0.35,
    }),
    wire: new THREE.MeshStandardMaterial({
      color: 0x6a6a62,
      roughness: 0.8,
      metalness: 0.25,
    }),
    wirePost: new THREE.MeshStandardMaterial({
      color: 0x3e3e38,
      roughness: 0.85,
      metalness: 0.2,
    }),
  };

  const state = {
    navCircles: [],
    navSegments: [],
    coverPieces: [],
    pushCircles: [],
  };

  function clearGroup() {
    while (group.children.length) {
      const ch = group.children[0];
      group.remove(ch);
      ch.traverse?.((o) => {
        if (o.geometry && o.geometry !== ch.geometry) o.geometry.dispose?.();
      });
    }
    state.navCircles.length = 0;
    state.navSegments.length = 0;
    state.coverPieces.length = 0;
    state.pushCircles.length = 0;
  }

  function build() {
    clearGroup();
    if (!config.enabled) {
      group.visible = false;
      return;
    }
    group.visible = true;
    const rs = config.ruinScale ?? 1;
    const rw = config.roadWidth ?? 1;

    if (config.roads) {
      for (const road of layout.roads) {
        buildRoadStrip(group, road, mats, getHeight, rw);
      }
    }

    if (config.ruins) {
      for (const cluster of layout.ruinClusters) {
        for (const piece of cluster.pieces) {
          const fp = buildRuinPiece(group, cluster, piece, mats, getHeight, rs);
          state.navCircles.push({ x: fp.x, z: fp.z, r: fp.navR });
          state.pushCircles.push({ x: fp.x, z: fp.z, r: fp.navR });
          state.coverPieces.push({
            x: fp.x,
            z: fp.z,
            r: fp.r,
            coverTier: fp.coverTier,
          });
        }
      }
    }

    if (config.tankTraps) {
      for (const line of layout.tankTrapLines) {
        const c = Math.cos(line.rot ?? 0);
        const s = Math.sin(line.rot ?? 0);
        for (let i = 0; i < line.count; i++) {
          const ox = (i - (line.count - 1) * 0.5) * line.spacing;
          const x = line.x + ox * c;
          const z = line.z + ox * s;
          const fp = addHedgehog(
            group,
            x,
            z,
            line.rot ?? 0,
            mats,
            getHeight,
          );
          state.navCircles.push(fp);
          state.pushCircles.push({ x: fp.x, z: fp.z, r: fp.r });
          state.coverPieces.push(fp);
        }
      }
    }

    if (config.wire) {
      for (const wire of layout.wireLines) {
        buildWireLine(group, wire, mats, getHeight, state);
      }
    }
  }

  build();

  return {
    group,
    config,
    layout,
    mats,
    get navCircles() {
      return state.navCircles;
    },
    get navSegments() {
      return state.navSegments;
    },
    get coverPieces() {
      return state.coverPieces;
    },
    get pushCircles() {
      return state.pushCircles;
    },
    rebuild(nextConfig) {
      Object.assign(config, nextConfig);
      build();
    },
    dispose() {
      clearGroup();
      scene.remove(group);
      for (const m of Object.values(mats)) m.dispose?.();
    },
  };
}

/** Stamp a nav segment as a chain of blocked circles (wire, walls). */
export function stampNavSegment(grid, cols, rows, minX, minZ, cellSize, x0, z0, x1, z1, halfWidth) {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const steps = Math.max(2, Math.ceil(len / (cellSize * 0.45)));
  const rr = halfWidth;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    const minC = Math.max(0, Math.floor((x - rr - minX) / cellSize));
    const maxC = Math.min(cols - 1, Math.ceil((x + rr - minX) / cellSize));
    const minR = Math.max(0, Math.floor((z - rr - minZ) / cellSize));
    const maxR = Math.min(rows - 1, Math.ceil((z + rr - minZ) / cellSize));
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const wx = minX + (c + 0.5) * cellSize;
        const wz = minZ + (r + 0.5) * cellSize;
        const dx = wx - x;
        const dz = wz - z;
        if (dx * dx + dz * dz < rr * rr) {
          grid[r * cols + c] = 1;
        }
      }
    }
  }
}
