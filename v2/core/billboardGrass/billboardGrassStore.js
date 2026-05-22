/**
 * BillboardGrassStore — per-chunk procedural billboard grass instances.
 * Same layout as painted foliage: { x, z, y, rotY, scale, slotIdx }.
 */
import {
  chunkKey,
  worldToChunkIndex,
  getChunkCountPerAxis,
} from "../terrain/chunkMath.js";

export class BillboardGrassStore {
  constructor(config) {
    this.config = config;
    /** @type {Map<string, Array<{x:number, z:number, y:number, rotY:number, scale:number, slotIdx:number}>>} */
    this.chunks = new Map();
    this._gen = new Map();
    this._globalGen = 0;
  }

  _bumpGen(key) {
    this._globalGen++;
    this._gen.set(key, this._globalGen);
  }

  getGen(key) {
    return this._gen.get(key) ?? 0;
  }

  add(wx, wz, y, rotY, scale, slotIdx) {
    const { cx, cz } = worldToChunkIndex(wx, wz, this.config);
    const key = chunkKey(cx, cz);
    if (!this.chunks.has(key)) this.chunks.set(key, []);
    this.chunks.get(key).push({ x: wx, z: wz, y, rotY, scale, slotIdx });
    this._bumpGen(key);
  }

  removeInRadius(wx, wz, radius, slotFilter = -1) {
    const r2 = radius * radius;
    const half = this.config.world.size * 0.5;
    const cs = this.config.world.chunkSize;
    const maxC = getChunkCountPerAxis(this.config) - 1;
    const minCX = Math.max(0, Math.floor((wx - radius + half) / cs));
    const maxCX = Math.min(maxC, Math.floor((wx + radius + half) / cs));
    const minCZ = Math.max(0, Math.floor((wz - radius + half) / cs));
    const maxCZ = Math.min(maxC, Math.floor((wz + radius + half) / cs));

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const key = chunkKey(cx, cz);
        const items = this.chunks.get(key);
        if (!items?.length) continue;
        const kept = [];
        for (const f of items) {
          const dx = f.x - wx;
          const dz = f.z - wz;
          const remove =
            dx * dx + dz * dz < r2 && (slotFilter < 0 || f.slotIdx === slotFilter);
          if (!remove) kept.push(f);
        }
        if (kept.length !== items.length) {
          if (kept.length === 0) this.chunks.delete(key);
          else this.chunks.set(key, kept);
          this._bumpGen(key);
        }
      }
    }
  }

  hasNearby(wx, wz, dist) {
    const d2 = dist * dist;
    const half = this.config.world.size * 0.5;
    const cs = this.config.world.chunkSize;
    const maxC = getChunkCountPerAxis(this.config) - 1;
    const minCX = Math.max(0, Math.floor((wx - dist + half) / cs));
    const maxCX = Math.min(maxC, Math.floor((wx + dist + half) / cs));
    const minCZ = Math.max(0, Math.floor((wz - dist + half) / cs));
    const maxCZ = Math.min(maxC, Math.floor((wz + dist + half) / cs));

    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const items = this.chunks.get(chunkKey(cx, cz));
        if (!items) continue;
        for (const f of items) {
          const dx = f.x - wx;
          const dz = f.z - wz;
          if (dx * dx + dz * dz < d2) return true;
        }
      }
    }
    return false;
  }

  getChunkKeysInRadius(wx, wz, radius) {
    const half = this.config.world.size * 0.5;
    const cs = this.config.world.chunkSize;
    const maxC = getChunkCountPerAxis(this.config) - 1;
    const minCX = Math.max(0, Math.floor((wx - radius + half) / cs));
    const maxCX = Math.min(maxC, Math.floor((wx + radius + half) / cs));
    const minCZ = Math.max(0, Math.floor((wz - radius + half) / cs));
    const maxCZ = Math.min(maxC, Math.floor((wz + radius + half) / cs));
    const keys = [];
    for (let cz = minCZ; cz <= maxCZ; cz++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        keys.push(chunkKey(cx, cz));
      }
    }
    return keys;
  }

  restoreFromSnapshot(snapshot) {
    for (const [key, items] of snapshot) {
      if (items.length === 0) this.chunks.delete(key);
      else this.chunks.set(key, items.map((f) => ({ ...f })));
      this._bumpGen(key);
    }
  }

  syncAllHeights(terrainStore) {
    for (const [key, items] of this.chunks) {
      for (const f of items) {
        f.y = terrainStore.getWorldHeight(f.x, f.z);
      }
      this._bumpGen(key);
    }
  }

  clear() {
    for (const key of this.chunks.keys()) this._bumpGen(key);
    this.chunks.clear();
  }

  toJSON() {
    const out = [];
    for (const [key, items] of this.chunks) {
      if (items.length > 0) out.push({ key, items: items.map((f) => ({ ...f })) });
    }
    return out;
  }

  fromJSON(data) {
    this.chunks.clear();
    this._gen.clear();
    this._globalGen = 0;
    if (!Array.isArray(data)) return;
    for (const { key, items } of data) {
      if (Array.isArray(items) && items.length > 0) {
        this.chunks.set(key, items.map((f) => ({ ...f })));
        this._bumpGen(key);
      }
    }
  }

  getTotalCount() {
    let n = 0;
    for (const items of this.chunks.values()) n += items.length;
    return n;
  }
}
