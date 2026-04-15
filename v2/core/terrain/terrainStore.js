import * as THREE from "three";
import {
  chunkKey,
  chunkMinWorldX,
  chunkMinWorldZ,
  getChunkCountPerAxis,
  getChunkDataIndex,
  isValidChunkCoord,
  worldHalf,
  worldToChunkIndex,
} from "./chunkMath.js";

export class TerrainStore {
  constructor(config) {
    this.config = config;
    this.chunkDataMap = new Map();
  }

  ensureChunkData(cx, cz) {
    const key = chunkKey(cx, cz);
    const existing = this.chunkDataMap.get(key);
    if (existing) return existing;

    const res = this.config.world.dataResolution;
    const perAxis = res + 1;
    const heights = new Float32Array(perAxis * perAxis);
    const minX = chunkMinWorldX(cx, this.config);
    const minZ = chunkMinWorldZ(cz, this.config);
    const step = this.config.world.chunkSize / res;

    const flat = !!this.config.world.flatInitialTerrain;
    const flatY = this.config.world.initialHeight ?? 0;
    for (let iz = 0; iz <= res; iz++) {
      const wz = minZ + iz * step;
      for (let ix = 0; ix <= res; ix++) {
        const wx = minX + ix * step;
        heights[getChunkDataIndex(ix, iz, this.config)] = flat
          ? flatY
          : this.sampleInitialHeight(wx, wz);
      }
    }

    this.stitchNewChunkFromNeighbors(cx, cz, heights);
    this.chunkDataMap.set(key, heights);
    return heights;
  }

  getChunkHeightsByKey(key) {
    return this.chunkDataMap.get(key) ?? null;
  }

  restoreChunkHeightsFromMap(snapshotMap) {
    for (const [key, values] of snapshotMap) {
      this.chunkDataMap.set(key, new Float32Array(values));
    }
  }

  sampleInitialHeight(wx, wz) {
    const s = this.config.world.size;
    const nx = wx / s + 0.5;
    const nz = wz / s + 0.5;
    const base = fbm(nx * 2.1, nz * 2.1, 5) * 22;
    const ridge = fbmRidge(nx * 3.2 + 8.1, nz * 3.2 - 6.7, 5) * 14;
    return base + ridge - 10;
  }

  sampleChunkHeight(cx, cz, localX, localZ) {
    const res = this.config.world.dataResolution;
    const heights = this.ensureChunkData(cx, cz);
    const x = THREE.MathUtils.clamp(localX, 0, res);
    const z = THREE.MathUtils.clamp(localZ, 0, res);
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = Math.min(res, x0 + 1);
    const z1 = Math.min(res, z0 + 1);
    const tx = x - x0;
    const tz = z - z0;

    const h00 = heights[getChunkDataIndex(x0, z0, this.config)];
    const h10 = heights[getChunkDataIndex(x1, z0, this.config)];
    const h01 = heights[getChunkDataIndex(x0, z1, this.config)];
    const h11 = heights[getChunkDataIndex(x1, z1, this.config)];
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(h00, h10, tx),
      THREE.MathUtils.lerp(h01, h11, tx),
      tz,
    );
  }

  getWorldHeight(wx, wz) {
    const { cx, cz } = worldToChunkIndex(wx, wz, this.config);
    if (!isValidChunkCoord(cx, cz, this.config)) return 0;
    return this.getChunkHeightfieldHeight(wx, wz);
  }

  /**
   * Raw heightfield from chunk data only (matches `splatmap-chunks.html` getChunkHeightfieldHeight).
   * Clamped chunk indices keep boundary sampling — and FD normals — aligned with V1.
   */
  getChunkHeightfieldHeight(wx, wz) {
    const cs = this.config.world.chunkSize;
    const maxC = getChunkCountPerAxis(this.config) - 1;
    const half = worldHalf(this.config);
    let cx = Math.floor((wx + half) / cs);
    let cz = Math.floor((wz + half) / cs);
    cx = THREE.MathUtils.clamp(cx, 0, maxC);
    cz = THREE.MathUtils.clamp(cz, 0, maxC);
    const minX = chunkMinWorldX(cx, this.config);
    const minZ = chunkMinWorldZ(cz, this.config);
    const res = this.config.world.dataResolution;
    const u = ((wx - minX) / cs) * res;
    const v = ((wz - minZ) / cs) * res;
    return this.sampleChunkHeight(cx, cz, u, v);
  }

  /**
   * Iterates chunks in the brush AABB, loops local cells only inside the brush
   * circle, writes heights directly to each chunk's Float32Array, and tracks a
   * per-chunk dirty rect. Shared edge/corner verts are propagated inline to
   * neighboring chunks so seams stay consistent without post-pass stitching.
   *
   * @param {object} stroke
   * @param {Map<string, {minIx:number,maxIx:number,minIz:number,maxIz:number}>} dirtyChunks
   */
  applySculptStroke(stroke, dirtyChunks) {
    const res = this.config.world.dataResolution;
    const stride = res + 1;
    const cs = this.config.world.chunkSize;
    const step = cs / res;
    const worldHalfV = this.config.world.size * 0.5;
    const maxC = getChunkCountPerAxis(this.config) - 1;
    const cmin = this.config.sculpt.sculptClampMin;
    const cmax = this.config.sculpt.sculptClampMax;

    const minCX = Math.max(0, Math.floor((stroke.minX + worldHalfV) / cs));
    const maxCX = Math.min(maxC, Math.floor((stroke.maxX + worldHalfV) / cs));
    const minCZ = Math.max(0, Math.floor((stroke.minZ + worldHalfV) / cs));
    const maxCZ = Math.min(maxC, Math.floor((stroke.maxZ + worldHalfV) / cs));

    const r = stroke.radius;
    const r2 = r * r;
    const invR = 1 / r;
    const bcx = stroke.cx;
    const bcz = stroke.cz;

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const heights = this.ensureChunkData(cx, cz);
        const chunkMinX = chunkMinWorldX(cx, this.config);
        const chunkMinZ = chunkMinWorldZ(cz, this.config);

        // Local (ix,iz) window inside this chunk that overlaps the brush AABB.
        let lMinX = Math.floor((stroke.minX - chunkMinX) / step);
        let lMaxX = Math.ceil((stroke.maxX - chunkMinX) / step);
        let lMinZ = Math.floor((stroke.minZ - chunkMinZ) / step);
        let lMaxZ = Math.ceil((stroke.maxZ - chunkMinZ) / step);
        if (lMinX < 0) lMinX = 0;
        if (lMinZ < 0) lMinZ = 0;
        if (lMaxX > res) lMaxX = res;
        if (lMaxZ > res) lMaxZ = res;
        if (lMinX > lMaxX || lMinZ > lMaxZ) continue;

        for (let iz = lMinZ; iz <= lMaxZ; iz++) {
          const wz = chunkMinZ + iz * step;
          const dz = wz - bcz;
          const dz2 = dz * dz;
          for (let ix = lMinX; ix <= lMaxX; ix++) {
            const wx = chunkMinX + ix * step;
            const dx = wx - bcx;
            const d2 = dx * dx + dz2;
            if (d2 > r2) continue;
            const dist = Math.sqrt(d2);
            const t = 1 - dist * invR;
            if (t <= 0) continue;
            let falloff = 1;
            if (stroke.mode !== "fbmPeak") {
              falloff = Math.pow(t, stroke.falloff);
              if (falloff <= 0) continue;
            }

            // One world height sample can appear as multiple (chunk, ix, iz) cells.
            // Only the lexicographically smallest chunk among sharers may apply the
            // brush when that owner is also in this stroke's chunk window; otherwise
            // the same vertex would be displaced once per overlapping chunk.
            if (
              shouldSkipSculptBecauseOwnerInStroke(
                cx,
                cz,
                ix,
                iz,
                res,
                maxC,
                minCX,
                maxCX,
                minCZ,
                maxCZ,
              )
            ) {
              continue;
            }

            const idx = iz * stride + ix;
            const current = heights[idx];
            let next = current;
            if (stroke.mode === "raiseLower") {
              next = current + stroke.strength * stroke.sign * falloff;
            } else if (stroke.mode === "fbmPeak") {
              // splatmap-chunks.html `fbm_peak` — ridge FBM in brush space + radial spike (v2: tunable).
              const fp = stroke.fbmPeak;
              const freqMul = fp?.freqMul ?? 1;
              const oct = THREE.MathUtils.clamp(Math.round(fp?.octaves ?? 6), 1, 8);
              const spikePow = fp?.spikePower ?? 2.5;
              const base = fp?.base ?? 0.35;
              const ridgeW = fp?.ridgeWeight ?? 1.8;
              const gain = fp?.gain ?? 2.0;
              const ridgeSc = (3.5 * freqMul) / r;
              const ridge = fbmRidge(
                dx * ridgeSc + stroke.seed,
                dz * ridgeSc + stroke.seed,
                oct,
              );
              const spike = Math.pow(Math.max(0, t), spikePow);
              const shape = spike * (base + ridge * ridgeW);
              const delta = stroke.sign * Math.max(0, shape) * stroke.strength * gain;
              next = current + delta;
            } else if (stroke.mode === "flatten") {
              next = current + (stroke.flattenTargetY - current) * (falloff * stroke.strength);
            } else if (stroke.mode === "noise") {
              const n = hashNoise(wx * 0.11 + stroke.seed, wz * 0.11 - stroke.seed) * 2 - 1;
              next = current + n * stroke.strength * falloff;
            } else if (stroke.mode === "smooth") {
              const avg = this.sampleNeighborhood(wx, wz, step * 1.4);
              next = current + (avg - current) * (falloff * stroke.strength);
            }
            if (next < cmin) next = cmin;
            else if (next > cmax) next = cmax;

            heights[idx] = next;
            markRect(dirtyChunks, cx, cz, ix, iz);

            // Shared-vertex propagation: edges and corners live in multiple
            // chunks. Write the twin slots inline so seams remain bit-equal.
            const onL = ix === 0;
            const onR = ix === res;
            const onT = iz === 0;
            const onB = iz === res;
            if (onL && cx > 0) {
              const h = this.ensureChunkData(cx - 1, cz);
              h[iz * stride + res] = next;
              markRect(dirtyChunks, cx - 1, cz, res, iz);
            }
            if (onR && cx < maxC) {
              const h = this.ensureChunkData(cx + 1, cz);
              h[iz * stride + 0] = next;
              markRect(dirtyChunks, cx + 1, cz, 0, iz);
            }
            if (onT && cz > 0) {
              const h = this.ensureChunkData(cx, cz - 1);
              h[res * stride + ix] = next;
              markRect(dirtyChunks, cx, cz - 1, ix, res);
            }
            if (onB && cz < maxC) {
              const h = this.ensureChunkData(cx, cz + 1);
              h[0 * stride + ix] = next;
              markRect(dirtyChunks, cx, cz + 1, ix, 0);
            }
            if (onL && onT && cx > 0 && cz > 0) {
              const h = this.ensureChunkData(cx - 1, cz - 1);
              h[res * stride + res] = next;
              markRect(dirtyChunks, cx - 1, cz - 1, res, res);
            }
            if (onL && onB && cx > 0 && cz < maxC) {
              const h = this.ensureChunkData(cx - 1, cz + 1);
              h[0 * stride + res] = next;
              markRect(dirtyChunks, cx - 1, cz + 1, res, 0);
            }
            if (onR && onT && cx < maxC && cz > 0) {
              const h = this.ensureChunkData(cx + 1, cz - 1);
              h[res * stride + 0] = next;
              markRect(dirtyChunks, cx + 1, cz - 1, 0, res);
            }
            if (onR && onB && cx < maxC && cz < maxC) {
              const h = this.ensureChunkData(cx + 1, cz + 1);
              h[0] = next;
              markRect(dirtyChunks, cx + 1, cz + 1, 0, 0);
            }
          }
        }
      }
    }
  }

  sampleNeighborhood(wx, wz, radius) {
    const taps = [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius * 0.7, radius * 0.7],
      [-radius * 0.7, radius * 0.7],
      [radius * 0.7, -radius * 0.7],
      [-radius * 0.7, -radius * 0.7],
    ];
    let sum = 0;
    for (const [ox, oz] of taps) sum += this.getWorldHeight(wx + ox, wz + oz);
    return sum / taps.length;
  }

  syncChunkEdgesAround(keys) {
    const expanded = new Set();
    for (const key of keys) {
      expanded.add(key);
      const [cx, cz] = key.split(",").map(Number);
      expanded.add(chunkKey(cx + 1, cz));
      expanded.add(chunkKey(cx - 1, cz));
      expanded.add(chunkKey(cx, cz + 1));
      expanded.add(chunkKey(cx, cz - 1));
    }
    for (const key of expanded) {
      const [cx, cz] = key.split(",").map(Number);
      this.syncChunkEdges(cx, cz, expanded);
    }
  }

  syncChunkEdges(cx, cz, allowedSet) {
    if (!isValidChunkCoord(cx, cz, this.config)) return;
    const res = this.config.world.dataResolution;
    const key = chunkKey(cx, cz);
    const h = this.chunkDataMap.get(key);
    if (!h) return;

    const rightKey = chunkKey(cx + 1, cz);
    if (allowedSet.has(rightKey) && this.chunkDataMap.has(rightKey)) {
      const r = this.chunkDataMap.get(rightKey);
      for (let iz = 0; iz <= res; iz++) {
        r[getChunkDataIndex(0, iz, this.config)] = h[getChunkDataIndex(res, iz, this.config)];
      }
    }
    const bottomKey = chunkKey(cx, cz + 1);
    if (allowedSet.has(bottomKey) && this.chunkDataMap.has(bottomKey)) {
      const b = this.chunkDataMap.get(bottomKey);
      for (let ix = 0; ix <= res; ix++) {
        b[getChunkDataIndex(ix, 0, this.config)] = h[getChunkDataIndex(ix, res, this.config)];
      }
    }
  }

  stitchNewChunkFromNeighbors(cx, cz, heights) {
    const res = this.config.world.dataResolution;
    const left = this.chunkDataMap.get(chunkKey(cx - 1, cz));
    if (left) {
      for (let iz = 0; iz <= res; iz++) {
        heights[getChunkDataIndex(0, iz, this.config)] =
          left[getChunkDataIndex(res, iz, this.config)];
      }
    }
    const right = this.chunkDataMap.get(chunkKey(cx + 1, cz));
    if (right) {
      for (let iz = 0; iz <= res; iz++) {
        heights[getChunkDataIndex(res, iz, this.config)] =
          right[getChunkDataIndex(0, iz, this.config)];
      }
    }
    const top = this.chunkDataMap.get(chunkKey(cx, cz - 1));
    if (top) {
      for (let ix = 0; ix <= res; ix++) {
        heights[getChunkDataIndex(ix, 0, this.config)] =
          top[getChunkDataIndex(ix, res, this.config)];
      }
    }
    const bottom = this.chunkDataMap.get(chunkKey(cx, cz + 1));
    if (bottom) {
      for (let ix = 0; ix <= res; ix++) {
        heights[getChunkDataIndex(ix, res, this.config)] =
          bottom[getChunkDataIndex(ix, 0, this.config)];
      }
    }
  }

  preloadChunksInRadius(centerWorldX, centerWorldZ, radiusInChunks) {
    const { cx, cz } = worldToChunkIndex(centerWorldX, centerWorldZ, this.config);
    const max = getChunkCountPerAxis(this.config);
    for (let dz = -radiusInChunks; dz <= radiusInChunks; dz++) {
      for (let dx = -radiusInChunks; dx <= radiusInChunks; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (x < 0 || z < 0 || x >= max || z >= max) continue;
        this.ensureChunkData(x, z);
      }
    }
  }
}

function markRect(dirtyChunks, cx, cz, ix, iz) {
  const key = chunkKey(cx, cz);
  const existing = dirtyChunks.get(key);
  if (!existing) {
    dirtyChunks.set(key, { minIx: ix, maxIx: ix, minIz: iz, maxIz: iz });
    return;
  }
  if (ix < existing.minIx) existing.minIx = ix;
  if (ix > existing.maxIx) existing.maxIx = ix;
  if (iz < existing.minIz) existing.minIz = iz;
  if (iz > existing.maxIz) existing.maxIz = iz;
}

/**
 * Returns true if this (cx,cz,ix,iz) is not the canonical copy of the vertex
 * for sculpting, and the canonical chunk is part of the current stroke — so
 * this cell should not apply the brush (the owner will propagate here).
 */
function shouldSkipSculptBecauseOwnerInStroke(
  cx,
  cz,
  ix,
  iz,
  res,
  maxC,
  minCX,
  maxCX,
  minCZ,
  maxCZ,
) {
  let ownerCx = cx;
  let ownerCz = cz;
  const consider = (nx, nz) => {
    if (nx < ownerCx || (nx === ownerCx && nz < ownerCz)) {
      ownerCx = nx;
      ownerCz = nz;
    }
  };

  consider(cx, cz);
  if (ix === 0 && cx > 0) consider(cx - 1, cz);
  if (ix === res && cx < maxC) consider(cx + 1, cz);
  if (iz === 0 && cz > 0) consider(cx, cz - 1);
  if (iz === res && cz < maxC) consider(cx, cz + 1);
  if (ix === 0 && iz === 0 && cx > 0 && cz > 0) consider(cx - 1, cz - 1);
  if (ix === res && iz === 0 && cx < maxC && cz > 0) consider(cx + 1, cz - 1);
  if (ix === 0 && iz === res && cx > 0 && cz < maxC) consider(cx - 1, cz + 1);
  if (ix === res && iz === res && cx < maxC && cz < maxC) consider(cx + 1, cz + 1);

  if (ownerCx === cx && ownerCz === cz) return false;
  const ownerInStroke =
    ownerCx >= minCX &&
    ownerCx <= maxCX &&
    ownerCz >= minCZ &&
    ownerCz <= maxCZ;
  return ownerInStroke;
}

function hashNoise(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smoothNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hashNoise(ix, iy);
  const b = hashNoise(ix + 1, iy);
  const c = hashNoise(ix, iy + 1);
  const d = hashNoise(ix + 1, iy + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, ux), THREE.MathUtils.lerp(c, d, ux), uy);
}

function fbm(x, y, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += smoothNoise(x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

function fbmRidge(x, y, octaves = 5) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = smoothNoise(x * freq, y * freq);
    sum += (1 - Math.abs(n * 2 - 1)) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

