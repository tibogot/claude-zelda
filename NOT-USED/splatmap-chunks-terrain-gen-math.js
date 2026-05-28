import { CONFIG } from "./splatmap-chunks-config.js";

function _genH2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function _genSn2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return (
    _genH2(ix, iy) * (1 - u) * (1 - v) +
    _genH2(ix + 1, iy) * u * (1 - v) +
    _genH2(ix, iy + 1) * (1 - u) * v +
    _genH2(ix + 1, iy + 1) * u * v
  );
}

function _genFbm(x, y, oct = 5) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let m = 0;
  for (let i = 0; i < oct; i++) {
    s += _genSn2(x * f, y * f) * a;
    m += a;
    a *= 0.5;
    f *= 2;
  }
  return s / m;
}

function _genFbmRidge(x, y, oct = 6) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let m = 0;
  for (let i = 0; i < oct; i++) {
    const n = _genSn2(x * f, y * f);
    s += (1.0 - Math.abs(n * 2.0 - 1.0)) * a;
    m += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / m;
}

/** CPU height (world XZ) from PARAMS.gen-style object `g`. */
export function terrainGenHeightAtWorld(wx, wz, g) {
  const nx = wx / CONFIG.worldSize + 0.5;
  const nz = wz / CONFIG.worldSize + 0.5;
  const sc = g.scale;
  const oct = Math.round(g.octaves);
  const H = g.height;
  const seed = g.seed * 100;
  const warp = g.domainWarp;
  const drop = g.dropoff;
  const cx0 = 0.5 + g.offsetX;
  const cz0 = 0.5 + g.offsetZ;

  const wxp =
    warp > 0
      ? _genFbm(nx * sc * 3 + seed + 31.7, nz * sc * 3 + seed + 17.3, 4) *
        warp *
        0.08
      : 0;
  const wzp =
    warp > 0
      ? _genFbm(nx * sc * 3 + seed + 55.1, nz * sc * 3 + seed + 89.2, 4) *
        warp *
        0.08
      : 0;

  const sx = nx * sc + seed + wxp;
  const sz = nz * sc + seed + wzp;

  const raw =
    g.mode === "ridge" ? _genFbmRidge(sx, sz, oct) : _genFbm(sx, sz, oct);

  const dx = (nx - cx0) * 2;
  const dz = (nz - cz0) * 2;
  let r;
  if (g.dropoffShape === "box") {
    r = Math.max(Math.abs(dx), Math.abs(dz));
  } else if (g.dropoffShape === "noise") {
    const nr =
      _genFbm(nx * 3.1 + seed + 7.3, nz * 3.1 + seed + 12.1, 3) * 0.45;
    r = Math.sqrt(dx * dx + dz * dz) - nr;
  } else {
    r = Math.sqrt(dx * dx + dz * dz);
  }
  const falloff = Math.max(0, 1 - Math.pow(Math.max(0, r), drop));

  const tilt = g.tiltX * (nx - 0.5) * 2 + g.tiltZ * (nz - 0.5) * 2;

  let h = (raw + tilt * 0.5) * H * falloff;

  if (g.plains > 0) {
    const thresh = g.plains * H * 0.6;
    h = h < thresh ? 0 : h - thresh;
  }

  return Math.max(0, h);
}
