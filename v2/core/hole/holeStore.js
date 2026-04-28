import * as THREE from "three";
import {
  chunkKey,
  chunkMinWorldX,
  chunkMinWorldZ,
  getChunkCountPerAxis,
  parseChunkKey,
  worldToChunkIndex,
} from "../terrain/chunkMath.js";

export class HoleStore {
  constructor(config) {
    this.config = config;
    this.resolution = config.paint.splatResolution;
    /** @type {Map<string, { data: Uint8Array, tex: THREE.DataTexture }>} */
    this.chunks = new Map();
  }

  getChunkByKey(key) {
    return this.chunks.get(key) ?? null;
  }

  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;

    const res = this.resolution;
    const data = new Uint8Array(res * res * 4);
    const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;

    const entry = { data, tex };
    this.chunks.set(key, entry);
    return entry;
  }

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

  applyHoleStroke(stroke) {
    const res = this.resolution;
    const cs = this.config.world.chunkSize;
    const pxSize = cs / res;
    const r = stroke.radius;
    const invR = 1 / r;
    const touched = new Set();
    const erase = stroke.erase;

    const chunks = this.getChunkIndicesInBounds(
      stroke.cx - r, stroke.cz - r,
      stroke.cx + r, stroke.cz + r,
    );

    for (const { cx, cz } of chunks) {
      const entry = this.ensureChunk(cx, cz);
      const minWX = chunkMinWorldX(cx, this.config);
      const minWZ = chunkMinWorldZ(cz, this.config);

      const pxMinX = Math.max(0, Math.floor((stroke.cx - r - minWX) / pxSize));
      const pxMaxX = Math.min(res - 1, Math.ceil((stroke.cx + r - minWX) / pxSize));
      const pxMinZ = Math.max(0, Math.floor((stroke.cz - r - minWZ) / pxSize));
      const pxMaxZ = Math.min(res - 1, Math.ceil((stroke.cz + r - minWZ) / pxSize));

      let anyTouched = false;
      const data = entry.data;

      for (let pz = pxMinZ; pz <= pxMaxZ; pz++) {
        const wz = minWZ + (pz + 0.5) * pxSize;
        const dz = wz - stroke.cz;
        for (let px = pxMinX; px <= pxMaxX; px++) {
          const wx = minWX + (px + 0.5) * pxSize;
          const dx = wx - stroke.cx;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d > r) continue;
          const t = 1 - d * invR;
          const falloff = Math.pow(t, stroke.falloff);
          const delta = falloff * stroke.strength * 255;
          const idx = (pz * res + px) * 4;

          let v = data[idx];
          v = erase ? Math.max(0, v - delta) : Math.min(255, v + delta);
          data[idx] = v;
          data[idx + 3] = v;
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

  restoreFromSnapshot(snapshotMap) {
    for (const [key, data] of snapshotMap) {
      let entry = this.chunks.get(key);
      if (!entry) {
        const { cx, cz } = parseChunkKey(key);
        entry = this.ensureChunk(cx, cz);
      }
      entry.data.set(data);
      entry.tex.needsUpdate = true;
    }
  }

  clearAll() {
    for (const entry of this.chunks.values()) {
      entry.data.fill(0);
      entry.tex.needsUpdate = true;
    }
  }

  exportData() {
    const out = [];
    for (const [key, entry] of this.chunks) {
      const hasData = entry.data.some((v, i) => i % 4 === 0 && v > 0);
      if (!hasData) continue;
      let bin = "";
      for (let i = 0; i < entry.data.length; i++) bin += String.fromCharCode(entry.data[i]);
      out.push({ key, data: btoa(bin) });
    }
    return out.length > 0 ? out : null;
  }

  importData(chunks) {
    if (!chunks) return;
    for (const { key, data: b64 } of chunks) {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const { cx, cz } = parseChunkKey(key);
      const entry = this.ensureChunk(cx, cz);
      entry.data.set(u8.subarray(0, entry.data.length));
      entry.tex.needsUpdate = true;
    }
  }

  dispose() {
    for (const entry of this.chunks.values()) entry.tex.dispose();
    this.chunks.clear();
  }
}
