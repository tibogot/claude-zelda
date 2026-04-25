/**
 * SplatStore — per-chunk lazy RGBA splat textures for 4-layer paint mode.
 *
 * Memory model:
 *   - One 128×128 RGBA8 DataTexture per chunk, created on first paint only.
 *   - Splat channels R/G/B store the weights of layers 1/2/3 (0..255).
 *   - Layer 0 is the implicit base — w0 = 1 - (R + G + B), clamped/normalized in shader.
 *   - Default = all zeros → every chunk shows 100% layer 0 with no allocation cost.
 *
 * Blending model (Unreal-style "weight-blended layers"):
 *   Over-painting is allowed; the shader normalizes `(w0, w1, w2, w3)` so values
 *   always sum to 1. Users paint intuitively — "add more of this layer" — and the
 *   math stays well-defined when R+G+B > 1.
 */
import * as THREE from "three";
import {
  chunkKey,
  chunkMinWorldX,
  chunkMinWorldZ,
  getChunkCountPerAxis,
  parseChunkKey,
  worldToChunkIndex,
} from "../terrain/chunkMath.js";
import { sculptSn2 } from "../terrain/sculptNoiseFbm.js";

export class SplatStore {
  constructor(config) {
    this.config = config;
    this.resolution = config.paint.splatResolution;
    /** @type {Map<string, { data: Uint8Array, tex: THREE.DataTexture }>} */
    this.chunks = new Map();
  }

  hasChunkSplat(cx, cz) {
    return this.chunks.has(chunkKey(cx, cz));
  }

  getChunkSplatByKey(key) {
    return this.chunks.get(key) ?? null;
  }

  /** Lazy-create the splat buffer + texture for a chunk. All-zero init = 100% layer 0. */
  ensureChunkSplat(cx, cz) {
    const key = chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;

    const res = this.resolution;
    const data = new Uint8Array(res * res * 4);
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.needsUpdate = true;

    const entry = { data, tex };
    this.chunks.set(key, entry);
    return entry;
  }

  /** Returns {cx, cz} pairs for every chunk whose footprint overlaps the world AABB. */
  getChunkIndicesInBounds(minX, minZ, maxX, maxZ) {
    const { cx: cx0, cz: cz0 } = worldToChunkIndex(minX, minZ, this.config);
    const { cx: cx1, cz: cz1 } = worldToChunkIndex(maxX, maxZ, this.config);
    const max = getChunkCountPerAxis(this.config) - 1;
    const out = [];
    for (let cz = Math.max(0, cz0); cz <= Math.min(max, cz1); cz++) {
      for (let cx = Math.max(0, cx0); cx <= Math.min(max, cx1); cx++) {
        out.push({ cx, cz });
      }
    }
    return out;
  }

  /**
   * Paint brush stamp with optional noise mask.
   * @param {object} stroke
   * @param {number} stroke.cx - brush center world X
   * @param {number} stroke.cz - brush center world Z
   * @param {number} stroke.radius - brush radius (world meters)
   * @param {number} stroke.strength - 0..1 per-pixel max delta
   * @param {number} stroke.falloff - power applied to `(1 - dist/radius)`
   * @param {number} stroke.activeLayer - 0 = base (eraser), 1..3 = R/G/B channel
   * @param {number} [stroke.noiseMask=0] - 0 = clean circle, 1 = fully noise-masked edge
   * @param {number} [stroke.noiseScale=3] - world-space noise frequency
   * @param {number} [stroke.noiseOctaves=3] - FBM octaves for mask
   * @param {boolean} [stroke.noiseEdgeOnly=false] - noise only breaks the edge, not the interior
   * @param {Float32Array} [stroke.maskData=null] - grayscale brush mask (0-1), square
   * @param {number} [stroke.maskSize=0] - mask width/height
   * @param {number} [stroke.maskRotation=0] - mask rotation in radians
   * @returns {Set<string>} chunk keys touched by this stamp
   */
  applySplatStroke(stroke) {
    const res = this.resolution;
    const cs = this.config.world.chunkSize;
    const pxSize = cs / res;
    const r = stroke.radius;
    const invR = 1 / r;
    const touched = new Set();

    const noiseMask = stroke.noiseMask ?? 0;
    const noiseScale = stroke.noiseScale ?? 3;
    const noiseOctaves = Math.round(stroke.noiseOctaves ?? 3);
    const noiseEdgeOnly = stroke.noiseEdgeOnly ?? false;

    const maskData = stroke.maskData ?? null;
    const maskSize = stroke.maskSize ?? 0;
    const maskRot = stroke.maskRotation ?? 0;
    const maskCos = maskData ? Math.cos(maskRot) : 1;
    const maskSin = maskData ? Math.sin(maskRot) : 0;
    const invDiameter = 1 / (2 * r);

    const chunks = this.getChunkIndicesInBounds(
      stroke.cx - r,
      stroke.cz - r,
      stroke.cx + r,
      stroke.cz + r,
    );

    for (const { cx, cz } of chunks) {
      const entry = this.ensureChunkSplat(cx, cz);
      const minWX = chunkMinWorldX(cx, this.config);
      const minWZ = chunkMinWorldZ(cz, this.config);

      const pxMinX = Math.max(0, Math.floor((stroke.cx - r - minWX) / pxSize));
      const pxMaxX = Math.min(res - 1, Math.ceil((stroke.cx + r - minWX) / pxSize));
      const pxMinZ = Math.max(0, Math.floor((stroke.cz - r - minWZ) / pxSize));
      const pxMaxZ = Math.min(res - 1, Math.ceil((stroke.cz + r - minWZ) / pxSize));

      let anyTouched = false;
      const data = entry.data;
      const activeLayer = stroke.activeLayer;
      const isEraser = activeLayer === 0;
      const targetChan = activeLayer - 1;

      for (let pz = pxMinZ; pz <= pxMaxZ; pz++) {
        const wz = minWZ + (pz + 0.5) * pxSize;
        const dz = wz - stroke.cz;
        for (let px = pxMinX; px <= pxMaxX; px++) {
          const wx = minWX + (px + 0.5) * pxSize;
          const dx = wx - stroke.cx;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (!maskData && d > r) continue;
          const t = Math.max(0, 1 - d * invR);

          let falloff;
          if (maskData) {
            const rx = dx * maskCos - dz * maskSin;
            const rz = dx * maskSin + dz * maskCos;
            const mu = rx * invDiameter + 0.5;
            const mv = rz * invDiameter + 0.5;
            if (mu < 0 || mu > 1 || mv < 0 || mv > 1) continue;
            const maskVal = _sampleMask(maskData, maskSize, mu, mv);
            if (maskVal <= 0.001) continue;
            falloff = maskVal;
          } else {
            falloff = Math.pow(t, stroke.falloff);
          }

          if (noiseMask > 0) {
            let n = _fbmNoise(wx * noiseScale, wz * noiseScale, noiseOctaves);
            if (noiseEdgeOnly) {
              const edgeFactor = 1 - t;
              n = 1 - edgeFactor * (1 - n) * noiseMask;
            } else {
              n = n * noiseMask + (1 - noiseMask);
            }
            falloff *= Math.max(0, n);
          }

          const w = falloff * stroke.strength;
          if (w <= 0) continue;
          const delta = w * 255;
          const idx = (pz * res + px) * 4;
          if (isEraser) {
            data[idx] = Math.max(0, data[idx] - delta);
            data[idx + 1] = Math.max(0, data[idx + 1] - delta);
            data[idx + 2] = Math.max(0, data[idx + 2] - delta);
            data[idx + 3] = Math.max(0, data[idx + 3] - delta);
          } else {
            data[idx + targetChan] = Math.min(255, data[idx + targetChan] + delta);
          }
          anyTouched = true;
        }
      }

      if (anyTouched) {
        entry.tex.needsUpdate = true;
        touched.add(chunkKey(cx, cz));
      }
    }
    return touched;
  }

  /** Take a defensive copy of splat data for an iterable of chunk keys (undo snapshot). */
  snapshotChunks(keys) {
    const snap = new Map();
    for (const key of keys) {
      const entry = this.chunks.get(key);
      if (entry) snap.set(key, new Uint8Array(entry.data));
    }
    return snap;
  }

  /** Restore data from an undo snapshot. Creates entries for any keys not yet allocated. */
  restoreFromSnapshot(snapshotMap) {
    for (const [key, data] of snapshotMap) {
      let entry = this.chunks.get(key);
      if (!entry) {
        const { cx, cz } = parseChunkKey(key);
        entry = this.ensureChunkSplat(cx, cz);
      }
      entry.data.set(data);
      entry.tex.needsUpdate = true;
    }
  }

  /** Clear every allocated chunk back to 100% layer 0. */
  clearAll() {
    for (const entry of this.chunks.values()) {
      entry.data.fill(0);
      entry.tex.needsUpdate = true;
    }
  }

  /**
   * Fill every allocated chunk with a single layer (255 in that channel, 0 elsewhere).
   * Eraser layer (0) is equivalent to `clearAll()`.
   */
  fillAllWithLayer(activeLayer) {
    const targetChan = activeLayer - 1;
    for (const entry of this.chunks.values()) {
      const d = entry.data;
      if (activeLayer === 0) {
        d.fill(0);
      } else {
        for (let i = 0; i < d.length; i += 4) {
          d[i] = targetChan === 0 ? 255 : 0;
          d[i + 1] = targetChan === 1 ? 255 : 0;
          d[i + 2] = targetChan === 2 ? 255 : 0;
          d[i + 3] = targetChan === 3 ? 255 : 0;
        }
      }
      entry.tex.needsUpdate = true;
    }
  }

  dispose() {
    for (const entry of this.chunks.values()) entry.tex.dispose();
    this.chunks.clear();
  }
}

function _sampleMask(data, size, u, v) {
  const fx = u * (size - 1);
  const fy = v * (size - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, size - 1);
  const y1 = Math.min(y0 + 1, size - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  return (
    data[y0 * size + x0] * (1 - tx) * (1 - ty) +
    data[y0 * size + x1] * tx * (1 - ty) +
    data[y1 * size + x0] * (1 - tx) * ty +
    data[y1 * size + x1] * tx * ty
  );
}

function _fbmNoise(x, y, octaves) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let m = 0;
  for (let i = 0; i < octaves; i++) {
    s += sculptSn2(x * f, y * f) * a;
    m += a;
    a *= 0.5;
    f *= 2;
  }
  return m > 0 ? s / m : 0;
}
