/**
 * FoliageLodRenderer — per-chunk instanced foliage with 3-tier LOD.
 *
 * Architecture: each chunk gets one InstancedMesh per slot per LOD tier.
 * Meshes are rebuilt only when the chunk's generation counter changes.
 * Per-frame: frustum cull chunks, pick LOD tier by distance, show/hide.
 *
 * Foliage presets are registered per slot. Each preset contains pre-sampled
 * leaf positions (from foliageSampler) and a shared TSL material.
 */
import * as THREE from "three";

const MAX_LEAVES_PER_CHUNK = 16384;

export class FoliageLodRenderer {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;

    /**
     * slotPresets[slotIdx] = {
     *   material, leafMapNode, uniforms,
     *   lods: [
     *     { localPositions, localRands, count, geometry },  // LOD0
     *     { localPositions, localRands, count, geometry },  // LOD1
     *     { localPositions, localRands, count, geometry },  // LOD2
     *   ],
     *   bounds: { yMin, yMax, canopyCenter, aoRadius }
     * } | null
     */
    this.slotPresets = [];

    /**
     * Per-chunk meshes.
     * _chunkMeshes: Map<chunkKey, {
     *   gen: number,
     *   slots: Map<slotIdx, { lod0: InstancedMesh|null, lod1: InstancedMesh|null, lod2: InstancedMesh|null }>
     * }>
     */
    this._chunkMeshes = new Map();

    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._tmpMat = new THREE.Matrix4();
    this._treeMat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);
  }

  setSlotPreset(slotIdx, preset) {
    while (this.slotPresets.length <= slotIdx) this.slotPresets.push(null);
    this._clearSlotChunkMeshes(slotIdx);
    this.slotPresets[slotIdx] = preset;
    this._invalidateAllChunks();
  }

  hasSlot(slotIdx) {
    return slotIdx < this.slotPresets.length && this.slotPresets[slotIdx] != null;
  }

  clearSlot(slotIdx) {
    this._clearSlotChunkMeshes(slotIdx);
    if (slotIdx < this.slotPresets.length) this.slotPresets[slotIdx] = null;
  }

  _invalidateAllChunks() {
    for (const [, entry] of this._chunkMeshes) {
      entry.gen = -1;
    }
  }

  _clearSlotChunkMeshes(slotIdx) {
    for (const [, entry] of this._chunkMeshes) {
      const slotEntry = entry.slots.get(slotIdx);
      if (!slotEntry) continue;
      for (const key of ["lod0", "lod1", "lod2"]) {
        if (slotEntry[key]) {
          this.scene.remove(slotEntry[key]);
          slotEntry[key].dispose();
          slotEntry[key] = null;
        }
      }
      entry.slots.delete(slotIdx);
    }
  }

  /**
   * Build foliage InstancedMeshes for one chunk + one slot + one LOD tier.
   * Each tree in the chunk gets its leaves placed at (treeWorldPos + leafLocalPos).
   */
  _buildChunkSlotLod(trees, slotIdx, lodIdx) {
    const preset = this.slotPresets[slotIdx];
    if (!preset) return null;
    const lodData = preset.lods[lodIdx];
    if (!lodData || lodData.count === 0) return null;

    const slotTrees = trees.filter(t => t.slotIdx === slotIdx);
    if (slotTrees.length === 0) return null;

    const totalLeaves = slotTrees.length * lodData.count;
    if (totalLeaves === 0) return null;
    const cappedTotal = Math.min(totalLeaves, MAX_LEAVES_PER_CHUNK);

    const geo = lodData.geometry.clone();
    const randSrc = lodData.randData;
    const randData = new Float32Array(cappedTotal * 2);

    const im = new THREE.InstancedMesh(geo, preset.material, cappedTotal);
    im.count = cappedTotal;
    im.castShadow = true;
    im.receiveShadow = false;
    im.frustumCulled = false;

    const leavesPerTree = lodData.count;
    const localMats = lodData.matrices;
    let idx = 0;

    for (const t of slotTrees) {
      if (idx >= cappedTotal) break;

      this._pos.set(t.x, t.y ?? 0, t.z);
      this._quat.setFromAxisAngle(this._yAxis, t.rotY);
      this._scl.setScalar(t.scale);
      this._treeMat.compose(this._pos, this._quat, this._scl);

      for (let li = 0; li < leavesPerTree && idx < cappedTotal; li++, idx++) {
        const off = li * 16;
        this._tmpMat.fromArray(localMats, off);
        this._tmpMat.premultiply(this._treeMat);
        im.setMatrixAt(idx, this._tmpMat);
        randData[idx * 2] = randSrc[li * 2];
        randData[idx * 2 + 1] = randSrc[li * 2 + 1];
      }
    }

    im.count = idx;
    im.instanceMatrix.needsUpdate = true;
    geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(randData.slice(0, idx * 2), 2));

    return im;
  }

  _ensureChunkMeshes(chunkKey, trees, gen) {
    let entry = this._chunkMeshes.get(chunkKey);
    if (entry && entry.gen === gen) return entry;

    if (entry) {
      for (const [, slotEntry] of entry.slots) {
        for (const k of ["lod0", "lod1", "lod2"]) {
          if (slotEntry[k]) { this.scene.remove(slotEntry[k]); slotEntry[k].dispose(); }
        }
      }
    }

    entry = { gen, slots: new Map() };

    const slotsInChunk = new Set();
    for (const t of trees) slotsInChunk.add(t.slotIdx);

    for (const si of slotsInChunk) {
      if (si >= this.slotPresets.length || !this.slotPresets[si]) continue;
      const slotEntry = { lod0: null, lod1: null, lod2: null };
      for (let li = 0; li < 3; li++) {
        const mesh = this._buildChunkSlotLod(trees, si, li);
        if (mesh) {
          mesh.visible = false;
          this.scene.add(mesh);
          slotEntry[`lod${li}`] = mesh;
        }
      }
      entry.slots.set(si, slotEntry);
    }

    this._chunkMeshes.set(chunkKey, entry);
    return entry;
  }

  update(treeStore, camera, lodCfg) {
    this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const camX = camera.position.x;
    const camZ = camera.position.z;
    const chunkSize = this.config.world.chunkSize;
    const half = this.config.world.size * 0.5;

    const lod0D = lodCfg.lod0Distance ?? 80;
    const lod1D = lodCfg.lod1Distance ?? 200;
    const fadeD = lodCfg.fadeOutDistance ?? 600;

    const activeChunks = new Set();

    for (const [key, trees] of treeStore.chunks) {
      if (trees.length === 0) continue;
      activeChunks.add(key);

      const sep = key.indexOf(",");
      const cx = +key.substring(0, sep);
      const cz = +key.substring(sep + 1);
      const minX = -half + cx * chunkSize;
      const minZ = -half + cz * chunkSize;
      this._box.min.set(minX, -100, minZ);
      this._box.max.set(minX + chunkSize, 600, minZ + chunkSize);

      if (!this._frustum.intersectsBox(this._box)) {
        const entry = this._chunkMeshes.get(key);
        if (entry) {
          for (const [, se] of entry.slots) {
            if (se.lod0) se.lod0.visible = false;
            if (se.lod1) se.lod1.visible = false;
            if (se.lod2) se.lod2.visible = false;
          }
        }
        continue;
      }

      const gen = treeStore.getGen(key);
      const entry = this._ensureChunkMeshes(key, trees, gen);

      const chunkCX = minX + chunkSize * 0.5;
      const chunkCZ = minZ + chunkSize * 0.5;
      const dx = chunkCX - camX;
      const dz = chunkCZ - camZ;
      const dist = Math.sqrt(dx * dx + dz * dz);

      for (const [, se] of entry.slots) {
        if (dist > fadeD) {
          if (se.lod0) se.lod0.visible = false;
          if (se.lod1) se.lod1.visible = false;
          if (se.lod2) se.lod2.visible = false;
        } else if (dist > lod1D) {
          if (se.lod0) se.lod0.visible = false;
          if (se.lod1) se.lod1.visible = false;
          if (se.lod2) se.lod2.visible = true;
        } else if (dist > lod0D) {
          if (se.lod0) se.lod0.visible = false;
          if (se.lod1) se.lod1.visible = true;
          if (se.lod2) se.lod2.visible = false;
        } else {
          if (se.lod0) se.lod0.visible = true;
          if (se.lod1) se.lod1.visible = false;
          if (se.lod2) se.lod2.visible = false;
        }
      }
    }

    // Prune stale chunks
    if (this._chunkMeshes.size > activeChunks.size + 16) {
      for (const [k, entry] of this._chunkMeshes) {
        if (!activeChunks.has(k)) {
          for (const [, se] of entry.slots) {
            for (const lk of ["lod0", "lod1", "lod2"]) {
              if (se[lk]) { this.scene.remove(se[lk]); se[lk].dispose(); }
            }
          }
          this._chunkMeshes.delete(k);
        }
      }
    }
  }

  updateTime(t) {
    for (const preset of this.slotPresets) {
      if (preset) preset.uniforms.time.value = t;
    }
  }

  updateSunDirection(dir) {
    for (const preset of this.slotPresets) {
      if (preset) preset.uniforms.sunDir.value.copy(dir).normalize();
    }
  }

  dispose() {
    for (const [, entry] of this._chunkMeshes) {
      for (const [, se] of entry.slots) {
        for (const lk of ["lod0", "lod1", "lod2"]) {
          if (se[lk]) { this.scene.remove(se[lk]); se[lk].dispose(); }
        }
      }
    }
    this._chunkMeshes.clear();
  }
}
