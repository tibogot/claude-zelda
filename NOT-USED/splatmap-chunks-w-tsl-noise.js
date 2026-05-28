/**
 * Shared 2D Voronoi + light FBM nodes (TSL) used by river, ocean/water bodies, and road grain.
 */
import {
  Fn,
  float,
  vec2,
  fract,
  floor,
  sin,
  mix,
  dot,
  max,
  min,
  abs,
  length,
} from "three/tsl";

export const _wNHash = Fn(([p]) => {
  const pp = fract(p.mul(vec2(127.1, 311.7)));
  const d = dot(pp, pp.add(45.32));
  return fract(pp.x.add(d).mul(pp.y.add(d)));
});
export const _wVNoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const uu = f.mul(f).mul(float(3).sub(f.mul(2)));
  return mix(
    mix(_wNHash(i), _wNHash(i.add(vec2(1, 0))), uu.x),
    mix(_wNHash(i.add(vec2(0, 1))), _wNHash(i.add(vec2(1, 1))), uu.x),
    uu.y,
  );
});
export const _wFbm2 = Fn(([p]) => {
  const v = _wVNoise(p).mul(0.5).toVar();
  v.addAssign(_wVNoise(p.mul(2)).mul(0.25));
  return v;
});

export const _wHash22 = Fn(([p]) => {
  const px = dot(p, vec2(127.1, 311.7));
  const py = dot(p, vec2(269.5, 183.3));
  return fract(sin(vec2(px, py)).mul(43758.5453));
});
export const _wSmin = Fn(([a, b, k]) => {
  const h = max(k.sub(abs(a.sub(b))), float(0)).div(k);
  return min(a, b).sub(h.mul(h).mul(h).mul(k).div(6));
});
export const _wCellPt = Fn(([seed, t, spd]) =>
  float(0.5).add(
    float(0.5).mul(sin(t.mul(spd).add(float(6.2831).mul(seed)))),
  ),
);
export const _wVoroF1 = Fn(([p, t, spd]) => {
  const ip = floor(p);
  const fp = fract(p);
  const md = float(10).toVar();
  for (const [nx, ny] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    const n = vec2(float(nx), float(ny));
    const rnd = _wHash22(ip.add(n));
    const pt = vec2(_wCellPt(rnd.x, t, spd), _wCellPt(rnd.y, t, spd));
    md.assign(min(md, length(n.add(pt).sub(fp))));
  }
  return md;
});
export const _wVoroSmooth = Fn(([p, t, spd, sm]) => {
  const ip = floor(p);
  const fp = fract(p);
  const res = float(10).toVar();
  for (const [nx, ny] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    const n = vec2(float(nx), float(ny));
    const rnd = _wHash22(ip.add(n));
    const pt = vec2(_wCellPt(rnd.x, t, spd), _wCellPt(rnd.y, t, spd));
    const d = length(n.add(pt).sub(fp));
    res.assign(_wSmin(res, d, sm));
  }
  return res;
});
