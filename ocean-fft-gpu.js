/**
 * ocean-fft-gpu.js — GPU compute Tessendorf FFT ocean (JONSWAP + Phillips)
 *
 * Same two-cascade model as ocean-fft.js, but the per-frame IFFT runs entirely
 * on the GPU via TSL compute shaders, so the main thread is free. The spectrum
 * (h0, conj(h0(-k)), ω, k̂) and a bit-reversal table are precomputed on the CPU
 * into read-only storage buffers; only the time evolution + IFFT + assemble run
 * each frame on the GPU.
 *
 * PACKING: the three real output fields (height, x-displacement, z-displacement)
 * share one FFT structure (same k-grid → same twiddles/indices), so they're
 * processed together in a single butterfly pipeline: (h, dx) ride in one vec4
 * buffer (xy = h complex, zw = dx complex) and dz in a vec2 buffer. One IFFT2
 * pipeline therefore transforms all three fields at once — ~38 GPU dispatches
 * per frame instead of ~100 (each renderer.compute is a separate submit, so
 * dispatch count is what matters for perf).
 *
 * Algorithm: bit-reverse reorder → log2(N) radix-2 Cooley-Tukey row stages →
 * reorder → log2(N) column stages (ping-ponging two work buffer sets), then an
 * assemble pass computes gradients (finite difference) + the Jacobian whitecap
 * factor into `spatialBuf` (dx, h, dz, J) and `gradBuf` (dhdx, dhdz).
 *
 * Output is consumed by ocean-shader.js through `dispNode(uv)` / `gradNode(uv)`
 * (manual bilinear over the storage buffers, uv in [0,1], wrapping).
 *
 * NOTE: this is the *rendering* source. CPU-side queries (boat buoyancy) still
 * use ocean-fft.js — keep their spectra/params in sync for the boat to sit on
 * the visible surface.
 */

import * as THREE from "three";
import {
  Fn, uniform, float, int, uint, vec2, vec4, If,
  instancedArray, storage, instanceIndex, floor, cos, sin,
} from "three/tsl";

const GRAVITY = 9.81;
const TWO_PI = Math.PI * 2;

export const OCEAN_FFT_GPU_DEFAULTS = {
  size: 128, // must be a power of two
  swellTile: 512,
  swellAmp: 1.15,
  rippleTile: 48,
  rippleAmp: 0.55,
  choppiness: 1.28,
  windSpeed: 14,
  jonswapGamma: 3.3,
  windSpreadPow: 8,
  rippleCutoff: 1.2,
};

// ─── Spectrum math (mirror of ocean-fft.js — kept local so this module is
//     self-contained for the v2 port) ────────────────────────────────────────
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussianPair(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  const r = Math.sqrt(-2 * Math.log(u));
  const t = TWO_PI * v;
  return [r * Math.cos(t), r * Math.sin(t)];
}
function kIndex(i, n) {
  return i < (n >> 1) ? i : i - n;
}
function jonswapSpectrum(kx, kz, windSpeed, windDir, gamma, spreadPow) {
  const kLen = Math.hypot(kx, kz);
  if (kLen < 1e-5) return 0;
  const omega = Math.sqrt(GRAVITY * kLen);
  const U = Math.max(windSpeed, 0.5);
  const omegaP = (TWO_PI * 0.13 * GRAVITY) / U;
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
  return (A * Math.exp(-1 / (kLen * L) ** 2)) / kLen ** 4 * dir;
}

function bitReverseTable(n) {
  const bits = Math.log2(n) | 0;
  const rev = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  return rev;
}

// ─── TSL helpers ─────────────────────────────────────────────────────────────
const cMul = Fn(([a, b]) =>
  vec2(a.x.mul(b.x).sub(a.y.mul(b.y)), a.x.mul(b.y).add(a.y.mul(b.x))),
);
// Two complex values packed in a vec4 (xy, zw), both multiplied by one twiddle.
const cMul4 = Fn(([a, tw]) =>
  vec4(cMul(a.xy, tw), cMul(a.zw, tw)),
);

/**
 * @param {object} opts
 * @param {THREE.WebGPURenderer} opts.renderer
 */
export function createOceanFFTGPUSimulation(opts = {}) {
  const cfg = { ...OCEAN_FFT_GPU_DEFAULTS, ...opts };
  const renderer = cfg.renderer;
  const N = cfg.size;
  const LOG2N = Math.log2(N) | 0;
  const COUNT = N * N;
  const invN2 = 1 / (N * N);

  let windSpeed = cfg.windSpeed;
  let windDirRad = (cfg.windAngleDeg ?? 38) * (Math.PI / 180);
  let gamma = cfg.jonswapGamma;
  let spreadPow = cfg.windSpreadPow;

  // Shared work buffers. (h, dx) ride together in the vec4 set; dz in the vec2
  // set. One IFFT pipeline transforms all three fields at once.
  const Ahd = instancedArray(COUNT, "vec4");
  const Bhd = instancedArray(COUNT, "vec4");
  const Az = instancedArray(COUNT, "vec2");
  const Bz = instancedArray(COUNT, "vec2");
  const revAttr = new THREE.StorageInstancedBufferAttribute(bitReverseTable(N), 1);
  const revBuf = storage(revAttr, "int", N);

  const uTime = uniform(0);
  const uStageM = uniform(2); // current butterfly block size

  const idxRC = () => {
    const i = instanceIndex;
    return { idx: i, c: i.mod(N), r: i.div(N) };
  };

  // Bit-reversal reorder along rows / columns (A → B for both buffer sets).
  const reorderRows = Fn(() => {
    const { idx, c, r } = idxRC();
    const src = r.mul(N).add(uint(revBuf.element(c)));
    Bhd.element(idx).assign(Ahd.element(src));
    Bz.element(idx).assign(Az.element(src));
  })().compute(COUNT);

  const reorderCols = Fn(() => {
    const { idx, c, r } = idxRC();
    const src = uint(revBuf.element(r)).mul(N).add(c);
    Bhd.element(idx).assign(Ahd.element(src));
    Bz.element(idx).assign(Az.element(src));
  })().compute(COUNT);

  // One radix-2 Cooley-Tukey stage. `axis` 0 = rows (along c), 1 = cols (along r).
  function makeStage(srcHd, srcZ, dstHd, dstZ, axis) {
    return Fn(() => {
      const { idx, c, r } = idxRC();
      const pos = float(axis === 0 ? c : r);
      const mf = float(uStageM);
      const half = mf.mul(0.5);
      const blockStart = floor(pos.div(mf)).mul(mf);
      const jj = pos.sub(blockStart);
      const outHd = vec4(0).toVar();
      const outZ = vec2(0).toVar();
      If(jj.lessThan(half), () => {
        const pIdx = axis === 0
          ? r.mul(N).add(uint(int(pos.add(half))))
          : uint(int(pos.add(half))).mul(N).add(c);
        const ang = float(TWO_PI).mul(jj).div(mf);
        const tw = vec2(cos(ang), sin(ang));
        outHd.assign(srcHd.element(idx).add(cMul4(tw, srcHd.element(pIdx))));
        outZ.assign(srcZ.element(idx).add(cMul(tw, srcZ.element(pIdx))));
      }).Else(() => {
        const pIdx = axis === 0
          ? r.mul(N).add(uint(int(pos.sub(half))))
          : uint(int(pos.sub(half))).mul(N).add(c);
        const j2 = jj.sub(half);
        const ang = float(TWO_PI).mul(j2).div(mf);
        const tw = vec2(cos(ang), sin(ang));
        outHd.assign(srcHd.element(pIdx).sub(cMul4(tw, srcHd.element(idx))));
        outZ.assign(srcZ.element(pIdx).sub(cMul(tw, srcZ.element(idx))));
      });
      dstHd.element(idx).assign(outHd);
      dstZ.element(idx).assign(outZ);
    })().compute(COUNT);
  }

  const rowAB = makeStage(Ahd, Az, Bhd, Bz, 0);
  const rowBA = makeStage(Bhd, Bz, Ahd, Az, 0);
  const colAB = makeStage(Ahd, Az, Bhd, Bz, 1);
  const colBA = makeStage(Bhd, Bz, Ahd, Az, 1);

  // Full 2D inverse FFT on the A buffer set; result returns to A (LOG2N odd).
  function runIFFT2() {
    renderer.compute(reorderRows); // A -> B
    let toA = true;
    for (let s = 1; s <= LOG2N; s++) {
      uStageM.value = 1 << s;
      renderer.compute(toA ? rowBA : rowAB);
      toA = !toA;
    }
    renderer.compute(reorderCols); // A -> B
    toA = true;
    for (let s = 1; s <= LOG2N; s++) {
      uStageM.value = 1 << s;
      renderer.compute(toA ? colBA : colAB);
      toA = !toA;
    }
    // result in A
  }

  // ── Per-cascade state + kernels ──────────────────────────────────────────
  function makeCascade({ tileSize, label, choppinessScale }) {
    const h0Attr = new THREE.StorageInstancedBufferAttribute(new Float32Array(COUNT * 2), 2);
    const h0mAttr = new THREE.StorageInstancedBufferAttribute(new Float32Array(COUNT * 2), 2);
    const komAttr = new THREE.StorageInstancedBufferAttribute(new Float32Array(COUNT * 4), 4); // omega, kxN, kzN, _

    const h0Buf = storage(h0Attr, "vec2", COUNT);
    const h0mBuf = storage(h0mAttr, "vec2", COUNT);
    const komBuf = storage(komAttr, "vec4", COUNT);

    const spatialBuf = instancedArray(COUNT, "vec4"); // dx, h, dz, J
    const gradBuf = instancedArray(COUNT, "vec2");     // dhdx, dhdz

    const uAmp = uniform(1);
    const uChop = uniform(cfg.choppiness * choppinessScale);

    const cascade = {
      tileSize, label,
      amp: 1,
      choppiness: cfg.choppiness * choppinessScale,
      h0Attr, h0mAttr, komAttr, uAmp, uChop,
      spatialBuf, gradBuf,
    };

    // Time-evolve the spectrum and write all three packed fields into A.
    const evalAll = Fn(() => {
      const idx = instanceIndex;
      const kom = komBuf.element(idx);
      const omega = kom.x, kxN = kom.y, kzN = kom.z;
      const ang = omega.mul(uTime);
      const cw = cos(ang), sw = sin(ang);
      const ePos = cMul(h0Buf.element(idx), vec2(cw, sw));
      const eNeg = cMul(h0mBuf.element(idx), vec2(cw, sw.negate()));
      const ht = ePos.add(eNeg);                       // complex height spectrum
      // horizontal displacement spectrum = -i·k̂·chop·ht  →  chop·k̂·(ht.y, -ht.x)
      const base = vec2(ht.y, ht.x.negate()).mul(uChop);
      Ahd.element(idx).assign(vec4(ht, base.mul(kxN))); // xy = h, zw = dx
      Az.element(idx).assign(base.mul(kzN));            // dz
    })().compute(COUNT);

    // Real parts of the IFFT (in A) → spatialBuf (dx, h, dz). w (Jacobian) is
    // written by `assemble`. Stages don't normalise, so divide by N².
    const storeAll = Fn(() => {
      const idx = instanceIndex;
      const hd = Ahd.element(idx);
      const dz = Az.element(idx).x;
      const s = float(invN2).mul(uAmp);
      spatialBuf.element(idx).assign(vec4(
        hd.z.mul(s), // dx (real of zw)
        hd.x.mul(s), // h  (real of xy)
        dz.mul(s),   // dz
        float(0),
      ));
    })().compute(COUNT);

    // Finite-difference gradients + Jacobian from spatialBuf neighbours.
    const cell = tileSize / N;
    const assemble = Fn(() => {
      const { idx, c, r } = idxRC();
      const ip = c.add(1).mod(N);
      const im = c.add(N - 1).mod(N);
      const jp = r.add(1).mod(N);
      const jm = r.add(N - 1).mod(N);
      const sR = (rr, cc) => spatialBuf.element(rr.mul(N).add(cc));
      const dhdx = sR(r, ip).y.sub(sR(r, im).y).div(2 * cell);
      const dhdz = sR(jp, c).y.sub(sR(jm, c).y).div(2 * cell);
      const dDxdx = sR(r, ip).x.sub(sR(r, im).x).div(2 * cell);
      const dDxdz = sR(jp, c).x.sub(sR(jm, c).x).div(2 * cell);
      const dDzdx = sR(r, ip).z.sub(sR(r, im).z).div(2 * cell);
      const dDzdz = sR(jp, c).z.sub(sR(jm, c).z).div(2 * cell);
      const J = float(1).add(dDxdx).mul(float(1).add(dDzdz)).sub(dDxdz.mul(dDzdx));
      spatialBuf.element(idx).w.assign(J);
      gradBuf.element(idx).assign(vec2(dhdx, dhdz));
    })().compute(COUNT);

    cascade.evalAll = evalAll;
    cascade.storeAll = storeAll;
    cascade.assemble = assemble;

    // Bilinear sample nodes (uv in [0,1], wrapping) for the surface shader.
    const sampleBuf = (buf, uvNode) => {
      const f = uvNode.mul(N);
      const i0 = floor(f);
      const fr = f.sub(i0);
      const x0 = uint(i0.x).mod(N);
      const y0 = uint(i0.y).mod(N);
      const x1 = x0.add(1).mod(N);
      const y1 = y0.add(1).mod(N);
      const v00 = buf.element(y0.mul(N).add(x0));
      const v10 = buf.element(y0.mul(N).add(x1));
      const v01 = buf.element(y1.mul(N).add(x0));
      const v11 = buf.element(y1.mul(N).add(x1));
      const a = v00.add(v10.sub(v00).mul(fr.x));
      const b = v01.add(v11.sub(v01).mul(fr.x));
      return a.add(b.sub(a).mul(fr.y));
    };
    cascade.dispNode = (uvNode) => sampleBuf(spatialBuf, uvNode);
    cascade.gradNode = (uvNode) => sampleBuf(gradBuf, uvNode);

    // CPU-side spectrum bake into the storage attributes.
    cascade.bakeSpectrum = (spectrumFn, seed) => {
      const rng = mulberry32(seed >>> 0);
      const h0 = h0Attr.array, h0m = h0mAttr.array, kom = komAttr.array;
      h0.fill(0); h0m.fill(0); kom.fill(0);
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const kx = (TWO_PI * kIndex(i, N)) / tileSize;
          const kz = (TWO_PI * kIndex(j, N)) / tileSize;
          const idx = j * N + i;
          const kLen = Math.hypot(kx, kz);
          if (kLen > 1e-6) {
            kom[idx * 4] = Math.sqrt(GRAVITY * kLen);
            kom[idx * 4 + 1] = kx / kLen;
            kom[idx * 4 + 2] = kz / kLen;
          }
          const P = spectrumFn(kx, kz);
          if (P <= 0) continue;
          const [gr, gi] = gaussianPair(rng);
          const scale = Math.sqrt(P * 0.5) * (tileSize / 8);
          h0[idx * 2] = gr * scale;
          h0[idx * 2 + 1] = gi * scale;
        }
      }
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const oi = (N - i) % N, oj = (N - j) % N;
          const idx = j * N + i, oidx = oj * N + oi;
          h0m[idx * 2] = h0[oidx * 2];
          h0m[idx * 2 + 1] = -h0[oidx * 2 + 1];
        }
      }
      h0[0] = h0[1] = 0;
      h0m[0] = h0m[1] = 0;
      h0Attr.needsUpdate = true;
      h0mAttr.needsUpdate = true;
      komAttr.needsUpdate = true;
    };

    return cascade;
  }

  const swell = makeCascade({ tileSize: cfg.swellTile, label: "swell", choppinessScale: 1 });
  const ripple = makeCascade({ tileSize: cfg.rippleTile, label: "ripple", choppinessScale: 0.85 });
  swell.amp = cfg.swellAmp; swell.uAmp.value = cfg.swellAmp;
  ripple.amp = cfg.rippleAmp; ripple.uAmp.value = cfg.rippleAmp;

  function rebuildSpectra(seed = 1337) {
    swell.bakeSpectrum(
      (kx, kz) => jonswapSpectrum(kx, kz, windSpeed, windDirRad, gamma, spreadPow),
      seed,
    );
    ripple.bakeSpectrum(
      (kx, kz) => phillipsSpectrum(kx, kz, windSpeed, windDirRad, cfg.rippleTile, cfg.rippleCutoff),
      seed + 4099,
    );
  }
  rebuildSpectra(cfg.seed ?? 1337);

  function simulateCascade(cascade, time) {
    uTime.value = time;
    renderer.compute(cascade.evalAll);
    runIFFT2();
    renderer.compute(cascade.storeAll);
    renderer.compute(cascade.assemble);
  }

  return {
    swell,
    ripple,
    cascades: [swell, ripple],
    isGPU: true,

    /** Run the FFT compute for this frame. */
    update(time) {
      simulateCascade(swell, time);
      simulateCascade(ripple, time);
    },

    syncParams(p) {
      if (!p) return;
      let rebuild = false;
      if (p.windSpeed != null) { windSpeed = p.windSpeed; rebuild = true; }
      if (p.windAngleDeg != null) { windDirRad = p.windAngleDeg * (Math.PI / 180); rebuild = true; }
      if (p.jonswapGamma != null) { gamma = p.jonswapGamma; rebuild = true; }
      if (p.windSpreadPow != null) { spreadPow = p.windSpreadPow; rebuild = true; }
      if (p.fftSwellAmp != null) { swell.amp = p.fftSwellAmp; swell.uAmp.value = p.fftSwellAmp; }
      if (p.fftRippleAmp != null) { ripple.amp = p.fftRippleAmp; ripple.uAmp.value = p.fftRippleAmp; }
      if (p.fftChoppiness != null) {
        swell.choppiness = p.fftChoppiness; swell.uChop.value = p.fftChoppiness;
        ripple.choppiness = p.fftChoppiness * 0.85; ripple.uChop.value = p.fftChoppiness * 0.85;
      }
      if (p.fftSeed != null) rebuildSpectra(p.fftSeed | 0);
      else if (rebuild) rebuildSpectra(p.seed ?? 1337);
    },

    rebuildSpectra,
    dispose() {},
  };
}
