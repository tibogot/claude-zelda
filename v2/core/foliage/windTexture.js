import * as THREE from "three";

const WIND_RES = 256;

function _hash(x, y) {
  let n = x * 127.1 + y * 311.7;
  n = Math.sin(n) * 43758.5453;
  return n - Math.floor(n);
}

function _grad2(ix, iy, x, y) {
  const h = (_hash(ix, iy) * 4) | 0;
  const gx = [1, -1, 1, -1][h];
  const gy = [1, 1, -1, -1][h];
  return gx * x + gy * y;
}

function _fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function _lerp(a, b, t) {
  return a + t * (b - a);
}

function perlin2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = _fade(fx);
  const v = _fade(fy);
  return _lerp(
    _lerp(_grad2(ix, iy, fx, fy), _grad2(ix + 1, iy, fx - 1, fy), u),
    _lerp(_grad2(ix, iy + 1, fx, fy - 1), _grad2(ix + 1, iy + 1, fx - 1, fy - 1), u),
    v,
  );
}

function fbm2(x, y, octaves) {
  let s = 0, a = 0.5, f = 1, m = 0;
  for (let i = 0; i < octaves; i++) {
    s += perlin2(x * f, y * f) * a;
    m += a;
    a *= 0.5;
    f *= 2;
  }
  return m > 0 ? s / m : 0;
}

export function createWindTexture() {
  const data = new Float32Array(WIND_RES * WIND_RES * 4);

  for (let iy = 0; iy < WIND_RES; iy++) {
    for (let ix = 0; ix < WIND_RES; ix++) {
      const u = ix / WIND_RES;
      const v = iy / WIND_RES;
      const idx = (iy * WIND_RES + ix) * 4;

      // R: main wave (3 octave FBM, tileable via domain)
      data[idx] = fbm2(u * 8, v * 8, 3) * 0.5 + 0.5;
      // G: gust (lower freq, 2 octave)
      data[idx + 1] = fbm2(u * 3 + 73.1, v * 3 + 41.3, 2) * 0.5 + 0.5;
      // B: cross-direction sway
      data[idx + 2] = fbm2(u * 6 + 137.9, v * 6 + 259.1, 3) * 0.5 + 0.5;
      // A: micro variation
      data[idx + 3] = fbm2(u * 12 + 317.3, v * 12 + 197.7, 2) * 0.5 + 0.5;
    }
  }

  const tex = new THREE.DataTexture(data, WIND_RES, WIND_RES, THREE.RGBAFormat, THREE.FloatType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
