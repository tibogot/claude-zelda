/**
 * ocean-fft.js — Tessendorf-style FFT ocean (JONSWAP spectrum)
 *
 * Two tileable cascades (swell + ripples) simulated on CPU with 2D IFFT,
 * uploaded each frame as float displacement / gradient textures for the clipmap shader.
 * No dependency on legacy water demos in this repo.
 */

import * as THREE from "three";

const GRAVITY = 9.81;
const TWO_PI = Math.PI * 2;

export const OCEAN_FFT_DEFAULTS = {
  size: 128,
  /** Cascade 0 — large wind-driven swells (world units per tile). */
  swellTile: 512,
  /** Multiplier on frequency amplitudes (after physical scaling). */
  swellAmp: 1.15,
  /** Cascade 1 — smaller ripples. */
  rippleTile: 48,
  rippleAmp: 0.55,
  /** Horizontal pinch (Tessendorf λ). */
  choppiness: 1.28,
  /** Wind speed (m/s) driving JONSWAP on the swell cascade. */
  windSpeed: 14,
  /** Peak enhancement γ. */
  jonswapGamma: 3.3,
  /** Directional spreading power (cos²). */
  windSpreadPow: 8,
  /** Small-scale cutoff multiplier on ripple cascade. */
  rippleCutoff: 1.2,
};

// ─── Complex helpers ─────────────────────────────────────────────────────────
function cMul(ar, ai, br, bi) {
  return [ar * br - ai * bi, ar * bi + ai * br];
}
function cScale(ar, ai, s) {
  return [ar * s, ai * s];
}

// ─── In-place radix-2 1D FFT (complex) ───────────────────────────────────────
function fft1d(re, im, n, inverse) {
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * TWO_PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < len >> 1; k++) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + (len >> 1)];
        const vIm = im[i + k + (len >> 1)];
        const tRe = vRe * wRe - vIm * wIm;
        const tIm = vRe * wIm + vIm * wRe;
        re[i + k] = uRe + tRe;
        im[i + k] = uIm + tIm;
        re[i + k + (len >> 1)] = uRe - tRe;
        im[i + k + (len >> 1)] = uIm - tIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

function ifft2(re, im, n, scratchRe, scratchIm) {
  for (let row = 0; row < n; row++) {
    const off = row * n;
    for (let col = 0; col < n; col++) {
      scratchRe[col] = re[off + col];
      scratchIm[col] = im[off + col];
    }
    fft1d(scratchRe, scratchIm, n, true);
    for (let col = 0; col < n; col++) {
      re[off + col] = scratchRe[col];
      im[off + col] = scratchIm[col];
    }
  }
  for (let col = 0; col < n; col++) {
    for (let row = 0; row < n; row++) {
      scratchRe[row] = re[row * n + col];
      scratchIm[row] = im[row * n + col];
    }
    fft1d(scratchRe, scratchIm, n, true);
    for (let row = 0; row < n; row++) {
      re[row * n + col] = scratchRe[row];
      im[row * n + col] = scratchIm[row];
    }
  }
}

function gaussianPair(rng) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const r = Math.sqrt(-2 * Math.log(u));
  const t = TWO_PI * v;
  return [r * Math.cos(t), r * Math.sin(t)];
}

function kIndex(i, n) {
  return i < (n >> 1) ? i : i - n;
}

/** JONSWAP S(ω) with directional cos² spreading. Returns variance at grid cell. */
function jonswapSpectrum(kx, kz, windSpeed, windDir, gamma, spreadPow) {
  const kLen = Math.hypot(kx, kz);
  if (kLen < 1e-5) return 0;
  const omega = Math.sqrt(GRAVITY * kLen);
  const U = Math.max(windSpeed, 0.5);
  const omegaP = TWO_PI * 0.13 * GRAVITY / U;
  const alpha = 0.0081;
  const sigma = omega <= omegaP ? 0.07 : 0.09;
  const r = Math.exp(-((omega - omegaP) ** 2) / (2 * sigma * sigma * omegaP * omegaP + 1e-8));
  const S = alpha * GRAVITY * GRAVITY * omega ** -5
    * Math.exp(-1.25 * (omegaP / omega) ** 4)
    * gamma ** r;
  const theta = Math.atan2(kz, kx);
  let dTheta = theta - windDir;
  while (dTheta > Math.PI) dTheta -= TWO_PI;
  while (dTheta < -Math.PI) dTheta += TWO_PI;
  if (Math.abs(dTheta) >= Math.PI * 0.5) return 0;
  const spread = Math.max(0, Math.cos(dTheta * 0.5)) ** spreadPow;
  return (S / kLen) * spread * (2 / Math.PI);
}

/** Phillips spectrum for the ripple cascade (isotropic micro-waves). */
function phillipsSpectrum(kx, kz, windSpeed, windDir, L, cutoff) {
  const kLen = Math.hypot(kx, kz);
  if (kLen < 1e-5) return 0;
  const kMin = TWO_PI / L;
  if (kLen < kMin * cutoff) return 0;
  const kMax = kMin * 48;
  if (kLen > kMax) return 0;
  const kDotW = (kx * Math.cos(windDir) + kz * Math.sin(windDir)) / kLen;
  const dir = kDotW * kDotW;
  const A = 0.00008 * windSpeed * windSpeed;
  return A * Math.exp(-1 / (kLen * L) ** 2) / (kLen ** 4) * dir;
}

class FFTCascade {
  constructor({ size, tileSize, label }) {
    this.size = size;
    this.tileSize = tileSize;
    this.label = label;
    this.choppiness = OCEAN_FFT_DEFAULTS.choppiness;
    this.amp = 1;

    const n2 = size * size;
    this.h0Re = new Float32Array(n2);
    this.h0Im = new Float32Array(n2);
    this.h0mRe = new Float32Array(n2);
    this.h0mIm = new Float32Array(n2);

    this.htRe = new Float32Array(n2);
    this.htIm = new Float32Array(n2);
    this.dxRe = new Float32Array(n2);
    this.dxIm = new Float32Array(n2);
    this.dzRe = new Float32Array(n2);
    this.dzIm = new Float32Array(n2);
    this.scratchRe = new Float32Array(size);
    this.scratchIm = new Float32Array(size);

    this.spatialH = new Float32Array(n2);
    this.spatialDx = new Float32Array(n2);
    this.spatialDz = new Float32Array(n2);

    this.dispData = new Float32Array(n2 * 4);
    this.gradData = new Float32Array(n2 * 4);

    this.dispTex = new THREE.DataTexture(
      this.dispData, size, size, THREE.RGBAFormat, THREE.FloatType,
    );
    this.dispTex.wrapS = this.dispTex.wrapT = THREE.RepeatWrapping;
    this.dispTex.magFilter = THREE.LinearFilter;
    this.dispTex.minFilter = THREE.LinearFilter;
    this.dispTex.needsUpdate = true;

    this.gradTex = new THREE.DataTexture(
      this.gradData, size, size, THREE.RGBAFormat, THREE.FloatType,
    );
    this.gradTex.wrapS = this.gradTex.wrapT = THREE.RepeatWrapping;
    this.gradTex.magFilter = THREE.LinearFilter;
    this.gradTex.minFilter = THREE.LinearFilter;
    this.gradTex.needsUpdate = true;
  }

  /** @param {(kx:number,kz:number)=>number} spectrumFn */
  initSpectrum(spectrumFn, seed = 1) {
    const { size, tileSize } = this;
    const rng = mulberry32(seed);
    const n2 = size * size;
    this.h0Re.fill(0);
    this.h0Im.fill(0);

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const kx = (TWO_PI * kIndex(i, size)) / tileSize;
        const kz = (TWO_PI * kIndex(j, size)) / tileSize;
        const idx = j * size + i;
        const P = spectrumFn(kx, kz);
        if (P <= 0) continue;
        const [gr, gi] = gaussianPair(rng);
        // Discrete Tessendorf scaling: continuous P(k) → tile-sized spatial waves.
        const scale = Math.sqrt(P * 0.5) * (tileSize / 8);
        this.h0Re[idx] = gr * scale;
        this.h0Im[idx] = gi * scale;
      }
    }

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const oi = (size - i) % size;
        const oj = (size - j) % size;
        const idx = j * size + i;
        const oidx = oj * size + oi;
        this.h0mRe[idx] = this.h0Re[oidx];
        this.h0mIm[idx] = -this.h0Im[oidx];
      }
    }

    this.h0Re[0] = 0;
    this.h0Im[0] = 0;
    this.h0mRe[0] = 0;
    this.h0mIm[0] = 0;
  }

  simulate(time) {
    const { size, tileSize, choppiness, amp } = this;
    const n2 = size * size;
    const cell = tileSize / size;

    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const kx = (TWO_PI * kIndex(i, size)) / tileSize;
        const kz = (TWO_PI * kIndex(j, size)) / tileSize;
        const idx = j * size + i;
        const kLen = Math.hypot(kx, kz);

        if (kLen < 1e-6) {
          this.htRe[idx] = 0;
          this.htIm[idx] = 0;
          this.dxRe[idx] = 0;
          this.dxIm[idx] = 0;
          this.dzRe[idx] = 0;
          this.dzIm[idx] = 0;
          continue;
        }

        const omega = Math.sqrt(GRAVITY * kLen);
        const cosT = Math.cos(omega * time);
        const sinT = Math.sin(omega * time);
        const h0r = this.h0Re[idx];
        const h0i = this.h0Im[idx];
        const hmr = this.h0mRe[idx];
        const hmi = this.h0mIm[idx];

        const ePos = cMul(h0r, h0i, cosT, sinT);
        const eNeg = cMul(hmr, hmi, cosT, -sinT);
        const htR = ePos[0] + eNeg[0];
        const htI = ePos[1] + eNeg[1];

        this.htRe[idx] = htR;
        this.htIm[idx] = htI;

        const kxN = kx / kLen;
        const kzN = kz / kLen;
        // multiply by -i * (k/|k|) * λ: (-i)(a+bi)(kxN) = (b - ai)*kxN
        const dxR = (htI * kxN - htR * 0) * choppiness;
        const dxI = (-htR * kxN - htI * 0) * choppiness;
        const dzR = (htI * kzN) * choppiness;
        const dzI = (-htR * kzN) * choppiness;

        this.dxRe[idx] = dxR;
        this.dxIm[idx] = dxI;
        this.dzRe[idx] = dzR;
        this.dzIm[idx] = dzI;
      }
    }

    ifft2(this.htRe, this.htIm, size, this.scratchRe, this.scratchIm);
    ifft2(this.dxRe, this.dxIm, size, this.scratchRe, this.scratchIm);
    ifft2(this.dzRe, this.dzIm, size, this.scratchRe, this.scratchIm);

    for (let idx = 0; idx < n2; idx++) {
      this.spatialH[idx] = this.htRe[idx] * amp;
      this.spatialDx[idx] = this.dxRe[idx] * amp;
      this.spatialDz[idx] = this.dzRe[idx] * amp;
    }

    const wrap = (v, n) => (v + n) % n;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const idx = j * size + i;
        const ip = wrap(i + 1, size);
        const im = wrap(i - 1, size);
        const jp = wrap(j + 1, size);
        const jm = wrap(j - 1, size);

        const dhdx = (this.spatialH[j * size + ip] - this.spatialH[j * size + im]) / (2 * cell);
        const dhdz = (this.spatialH[jp * size + i] - this.spatialH[jm * size + i]) / (2 * cell);

        const dDxdx = (this.spatialDx[j * size + ip] - this.spatialDx[j * size + im]) / (2 * cell);
        const dDxdz = (this.spatialDx[jp * size + i] - this.spatialDx[jm * size + i]) / (2 * cell);
        const dDzdx = (this.spatialDz[j * size + ip] - this.spatialDz[j * size + im]) / (2 * cell);
        const dDzdz = (this.spatialDz[jp * size + i] - this.spatialDz[jm * size + i]) / (2 * cell);

        const J = (1 + dDxdx) * (1 + dDzdz) - dDxdz * dDzdx;

        const p4 = idx * 4;
        this.dispData[p4] = this.spatialDx[idx];
        this.dispData[p4 + 1] = this.spatialH[idx];
        this.dispData[p4 + 2] = this.spatialDz[idx];
        this.dispData[p4 + 3] = J;

        this.gradData[p4] = dhdx;
        this.gradData[p4 + 1] = dhdz;
        this.gradData[p4 + 2] = 0;
        this.gradData[p4 + 3] = 1;
      }
    }

    this.dispTex.needsUpdate = true;
    this.gradTex.needsUpdate = true;
  }

  dispose() {
    this.dispTex.dispose();
    this.gradTex.dispose();
  }
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function positiveFract(v) {
  return v - Math.floor(v);
}

/**
 * Bilinear sample of a tileable cascade field (matches shader `fract(xz / tileSize)`).
 * @param {Float32Array} field
 * @param {number} size
 * @param {number} tileSize
 * @param {number} worldX
 * @param {number} worldZ
 */
function sampleCascadeField(field, size, tileSize, worldX, worldZ) {
  const fu = positiveFract(worldX / tileSize);
  const fv = positiveFract(worldZ / tileSize);
  const fx = fu * size;
  const fy = fv * size;
  const i0 = Math.floor(fx) % size;
  const j0 = Math.floor(fy) % size;
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);
  const i1 = (i0 + 1) % size;
  const j1 = (j0 + 1) % size;
  const v00 = field[j0 * size + i0];
  const v10 = field[j0 * size + i1];
  const v01 = field[j1 * size + i0];
  const v11 = field[j1 * size + i1];
  const a = v00 + tx * (v10 - v00);
  const b = v01 + tx * (v11 - v01);
  return a + ty * (b - a);
}

function sampleCascadeGradComponent(gradData, size, tileSize, worldX, worldZ, comp) {
  const fu = positiveFract(worldX / tileSize);
  const fv = positiveFract(worldZ / tileSize);
  const fx = fu * size;
  const fy = fv * size;
  const i0 = Math.floor(fx) % size;
  const j0 = Math.floor(fy) % size;
  const tx = fx - Math.floor(fx);
  const ty = fy - Math.floor(fy);
  const i1 = (i0 + 1) % size;
  const j1 = (j0 + 1) % size;
  const at = (i, j) => gradData[(j * size + i) * 4 + comp];
  const v00 = at(i0, j0), v10 = at(i1, j0), v01 = at(i0, j1), v11 = at(i1, j1);
  const a = v00 + tx * (v10 - v00);
  const b = v01 + tx * (v11 - v01);
  return a + ty * (b - a);
}

/**
 * Raw FFT cascade sample at world XZ (dx, height, dz, dhdx, dhdz).
 * @param {FFTCascade} cascade
 */
export function sampleCascadeAt(cascade, worldX, worldZ) {
  const { size, tileSize, spatialH, spatialDx, spatialDz, gradData } = cascade;
  return {
    dx: sampleCascadeField(spatialDx, size, tileSize, worldX, worldZ),
    h: sampleCascadeField(spatialH, size, tileSize, worldX, worldZ),
    dz: sampleCascadeField(spatialDz, size, tileSize, worldX, worldZ),
    dhdx: sampleCascadeGradComponent(gradData, size, tileSize, worldX, worldZ, 0),
    dhdz: sampleCascadeGradComponent(gradData, size, tileSize, worldX, worldZ, 1),
  };
}

/**
 * Combined swell + ripple surface point and normal (CPU mirror of ocean-shader fftDispAt).
 * @param {ReturnType<createOceanFFTSimulation>} fftSim
 * @param {number} worldX
 * @param {number} worldZ
 * @param {object} [opts]
 * @param {number} [opts.seaY=0]
 * @param {boolean} [opts.fftEnabled=true]
 * @param {number} [opts.swellAmp]
 * @param {number} [opts.rippleAmp]
 * @param {number} [opts.normalStrength=1.05]
 * @param {number} [opts.shoreMask=1] 0=dry flat sea, 1=full waves
 * @param {number} [opts.shoreVertKeep=0.35]
 */
export function sampleOceanSurface(fftSim, worldX, worldZ, opts = {}) {
  const seaY = opts.seaY ?? 0;
  const enabled = opts.fftEnabled !== false;
  if (!enabled || !fftSim) {
    return {
      x: worldX, y: seaY, z: worldZ,
      nx: 0, ny: 1, nz: 0,
      dx: 0, h: 0, dz: 0,
    };
  }

  const swellAmp = opts.swellAmp ?? fftSim.swell.amp;
  const rippleAmp = opts.rippleAmp ?? fftSim.ripple.amp;
  const normalStrength = opts.normalStrength ?? 1.05;
  const shoreMask = opts.shoreMask ?? 1;
  const shoreVertKeep = opts.shoreVertKeep ?? 0.35;

  const s = sampleCascadeAt(fftSim.swell, worldX, worldZ);
  const r = sampleCascadeAt(fftSim.ripple, worldX, worldZ);

  let dx = s.dx * swellAmp + r.dx * rippleAmp;
  let h = s.h * swellAmp + r.h * rippleAmp;
  let dz = s.dz * swellAmp + r.dz * rippleAmp;
  let dhdx = (s.dhdx * swellAmp + r.dhdx * rippleAmp) * normalStrength;
  let dhdz = (s.dhdz * swellAmp + r.dhdz * rippleAmp) * normalStrength;

  if (shoreMask <= 0) {
    dx = 0; h = 0; dz = 0; dhdx = 0; dhdz = 0;
  } else if (shoreMask < 1) {
    const xzMask = shoreMask * shoreMask;
    const yMask = shoreVertKeep + (1 - shoreVertKeep) * shoreMask;
    dx *= xzMask;
    dz *= xzMask;
    h *= yMask;
    dhdx *= shoreMask;
    dhdz *= shoreMask;
  }

  const nx = -dhdx;
  const nz = -dhdz;
  const len = Math.hypot(nx, nz, 1) || 1;
  return {
    x: worldX + dx,
    y: seaY + h,
    z: worldZ + dz,
    nx: nx / len,
    ny: 1 / len,
    nz: nz / len,
    dx, h, dz,
  };
}

/**
 * @param {object} [opts]
 * @returns {{ cascades, update, syncParams, rebuildSpectra, dispose }}
 */
export function createOceanFFTSimulation(opts = {}) {
  const cfg = { ...OCEAN_FFT_DEFAULTS, ...opts };
  const size = cfg.size;

  let windSpeed = cfg.windSpeed;
  let windDirRad = (cfg.windAngleDeg ?? 38) * (Math.PI / 180);
  let gamma = cfg.jonswapGamma;
  let spreadPow = cfg.windSpreadPow;

  const swell = new FFTCascade({ size, tileSize: cfg.swellTile, label: "swell" });
  const ripple = new FFTCascade({ size, tileSize: cfg.rippleTile, label: "ripple" });
  swell.amp = cfg.swellAmp;
  ripple.amp = cfg.rippleAmp;
  swell.choppiness = cfg.choppiness;
  ripple.choppiness = cfg.choppiness * 0.85;

  function rebuildSpectra(seed = 1337) {
    swell.initSpectrum(
      (kx, kz) => jonswapSpectrum(kx, kz, windSpeed, windDirRad, gamma, spreadPow),
      seed,
    );
    ripple.initSpectrum(
      (kx, kz) => phillipsSpectrum(kx, kz, windSpeed, windDirRad, cfg.rippleTile, cfg.rippleCutoff),
      seed + 4099,
    );
  }

  rebuildSpectra(cfg.seed ?? 1337);

  return {
    cascades: [swell, ripple],
    swell,
    ripple,

    update(time) {
      swell.simulate(time);
      ripple.simulate(time);
    },

    syncParams(p) {
      if (!p) return;
      let rebuild = false;
      if (p.windSpeed != null) { windSpeed = p.windSpeed; rebuild = true; }
      if (p.windAngleDeg != null) { windDirRad = p.windAngleDeg * (Math.PI / 180); rebuild = true; }
      if (p.jonswapGamma != null) { gamma = p.jonswapGamma; rebuild = true; }
      if (p.windSpreadPow != null) { spreadPow = p.windSpreadPow; rebuild = true; }
      if (p.fftSwellAmp != null) swell.amp = p.fftSwellAmp;
      if (p.fftRippleAmp != null) ripple.amp = p.fftRippleAmp;
      if (p.fftChoppiness != null) {
        swell.choppiness = p.fftChoppiness;
        ripple.choppiness = p.fftChoppiness * 0.85;
      }
      if (p.fftSeed != null) rebuildSpectra(p.fftSeed | 0);
      else if (rebuild) rebuildSpectra(p.seed ?? 1337);
    },

    rebuildSpectra,

    /** @type {typeof sampleOceanSurface} */
    sampleSurface(worldX, worldZ, opts) {
      return sampleOceanSurface(this, worldX, worldZ, opts);
    },

    dispose() {
      swell.dispose();
      ripple.dispose();
    },
  };
}
