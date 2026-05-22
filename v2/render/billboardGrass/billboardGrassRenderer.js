/**
 * BillboardGrassRenderer — instanced procedural billboard ground cover (separate from foliage paint).
 *
 * Perf: one InstancedMesh per chunk×slot (active LOD only), aerial distance scale, throttled LOD passes.
 */
import * as THREE from "three";
import { texture, uv } from "three/tsl";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { parseChunkKey, chunkMinWorldX, chunkMinWorldZ } from "../../core/terrain/chunkMath.js";
import { createWindTexture } from "../../core/foliage/windTexture.js";
import { detectAlphaChannel } from "../foliage/foliageMaterial.js";
import {
  createBillboardGrassMaterial,
  applyBillboardGrassUniforms,
} from "./billboardGrassMaterial.js";

const LOD_KEYS = ["lod0", "lod1", "lod2"];

function stableHash01(i, seed) {
  const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453123;
  return x - Math.floor(x);
}

function planeYawRadians(i, count, spread) {
  if (count <= 0) return 0;
  if (spread === "half") return (i / count) * Math.PI;
  return (i / count) * Math.PI * 2;
}

function planeTiltRadians(i, count, tilt, tiltMode, seed) {
  if (tiltMode === "symmetric") {
    if (count <= 1) return 0;
    const u = i / (count - 1);
    return (u - 0.5) * 2 * tilt;
  }
  return (stableHash01(i, seed) - 0.5) * 2 * tilt;
}

function planeCountForLodTier(fullCount, tier) {
  const n = Math.max(1, Math.floor(fullCount));
  if (tier === 0) return n;
  if (tier === 1) return n >= 3 ? 2 : n;
  return 1;
}

/** @returns {'lod0'|'lod1'|'lod2'|null} */
function pickLodTier(dist, lodCfg, showChunk) {
  const lod0D = lodCfg.lod0Distance ?? 60;
  const lod1D = lodCfg.lod1Distance ?? 150;
  const fadeD = lodCfg.fadeOutDistance ?? 400;
  if (!showChunk || dist > fadeD) return null;
  if (dist > lod1D) return "lod2";
  if (dist > lod0D) return "lod1";
  return "lod0";
}

export class BillboardGrassRenderer {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.slotRender = [];
    this._chunkMeshes = new Map();
    this._windTex = createWindTexture();
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._worldMat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
    this._lastCamX = NaN;
    this._lastCamZ = NaN;
    this._lodTick = 0;
  }

  _buildGeometry(slot) {
    const geometries = [];
    const n = Math.max(1, Math.floor(slot.planeCount));
    for (let i = 0; i < n; i++) {
      const p = new THREE.PlaneGeometry(slot.width, slot.height);
      p.translate(0, slot.height / 2, 0);
      p.rotateY(planeYawRadians(i, n, slot.planeSpread));
      p.rotateX(planeTiltRadians(i, n, slot.tilt, slot.tiltMode, slot.structureSeed));
      geometries.push(p);
    }
    const merged = BufferGeometryUtils.mergeGeometries(geometries, false);
    for (const g of geometries) g.dispose();
    return merged;
  }

  _buildLodGeometries(slot) {
    const full = Math.max(1, Math.floor(slot.planeCount));
    return {
      lod0: this._buildGeometry({ ...slot, planeCount: planeCountForLodTier(full, 0) }),
      lod1: this._buildGeometry({ ...slot, planeCount: planeCountForLodTier(full, 1) }),
      lod2: this._buildGeometry({ ...slot, planeCount: planeCountForLodTier(full, 2) }),
    };
  }

  _disposeLodGeometries(geometries) {
    if (!geometries) return;
    for (const k of LOD_KEYS) geometries[k]?.dispose();
  }

  _removeSlotMesh(sm) {
    if (!sm?.mesh) return;
    this.scene.remove(sm.mesh);
    sm.mesh.geometry = null;
    sm.mesh.material = null;
    sm.mesh = null;
    sm.activeLod = null;
  }

  _disposeSlotMeshes(slotMeshes) {
    if (!slotMeshes) return;
    this._removeSlotMesh(slotMeshes);
  }

  _disposeChunkEntry(key) {
    const entry = this._chunkMeshes.get(key);
    if (!entry) return;
    for (const sm of entry.slots.values()) this._disposeSlotMeshes(sm);
    this._chunkMeshes.delete(key);
  }

  _disposeChunkMeshesForSlot(slotIdx) {
    for (const [, entry] of this._chunkMeshes) {
      const sm = entry.slots.get(slotIdx);
      if (sm) {
        this._disposeSlotMeshes(sm);
        entry.slots.delete(slotIdx);
      }
    }
  }

  _invalidateAllChunks() {
    for (const [, entry] of this._chunkMeshes) entry.gen = -1;
  }

  _uploadInstances(im, list) {
    const n = list.length;
    for (let i = 0; i < n; i++) {
      const f = list[i];
      this._pos.set(f.x, f.y ?? 0, f.z);
      this._quat.setFromAxisAngle(this._yAxis, f.rotY);
      this._scl.setScalar(f.scale);
      this._worldMat.compose(this._pos, this._quat, this._scl);
      im.setMatrixAt(i, this._worldMat);
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = true;
  }

  _materialForLod(sr, lodKey) {
    return lodKey === "lod0" ? sr.material : sr.materialLod;
  }

  _applyMaskChannel(uniforms, tex) {
    if (!uniforms?.maskInAlpha || !tex?.image) return;
    uniforms.maskInAlpha.value = detectAlphaChannel(tex.image) ? 1.0 : 0.0;
  }

  _createSlotMaterials(slot, prevTex) {
    const slotForMat =
      prevTex != null ? { ...slot, _maskNode: texture(prevTex, uv()) } : slot;
    const full = createBillboardGrassMaterial(slotForMat, this._windTex, this._sunDir);
    const lod = createBillboardGrassMaterial(slotForMat, this._windTex, this._sunDir, {
      simplified: true,
    });
    this._applyMaskChannel(full.uniforms, prevTex);
    this._applyMaskChannel(lod.uniforms, prevTex);
    return { material: full.material, materialLod: lod.material, uniforms: full.uniforms, uniformsLod: lod.uniforms };
  }

  rebuildSlot(slotIdx, slot) {
    const prevTex = this.slotRender[slotIdx]?.textureObj ?? null;
    this._disposeChunkMeshesForSlot(slotIdx);
    const prev = this.slotRender[slotIdx];
    if (prev) {
      this._disposeLodGeometries(prev.geometries);
      prev.material.dispose();
      prev.materialLod.dispose();
    }
    while (this.slotRender.length <= slotIdx) this.slotRender.push(null);
    this.slotRender[slotIdx] = null;

    if (!slot?.enabled) {
      this._invalidateAllChunks();
      return;
    }

    const geometries = this._buildLodGeometries(slot);
    const mats = this._createSlotMaterials(slot, prevTex);

    this.slotRender[slotIdx] = {
      geometries,
      material: mats.material,
      materialLod: mats.materialLod,
      uniforms: mats.uniforms,
      uniformsLod: mats.uniformsLod,
      textureObj: prevTex,
    };
    this._invalidateAllChunks();
  }

  setSlotTexture(slotIdx, tex, slotConfig = null) {
    const sr = this.slotRender[slotIdx];
    if (!sr) return;
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
    }
    sr.textureObj = tex;
    const slot = slotConfig || {};
    const mats = this._createSlotMaterials(slot, tex);
    sr.material.dispose();
    sr.materialLod.dispose();
    sr.material = mats.material;
    sr.materialLod = mats.materialLod;
    sr.uniforms = mats.uniforms;
    sr.uniformsLod = mats.uniformsLod;

    for (const [, entry] of this._chunkMeshes) {
      const sm = entry.slots.get(slotIdx);
      if (!sm?.mesh || !sm.activeLod) continue;
      sm.mesh.material = this._materialForLod(sr, sm.activeLod);
    }
  }

  updateSlotUniforms(slotIdx, slot) {
    const sr = this.slotRender[slotIdx];
    if (!sr?.uniforms) return;
    applyBillboardGrassUniforms(sr.uniforms, slot);
    applyBillboardGrassUniforms(sr.uniformsLod, slot);
    if (slot.alphaTest != null) {
      sr.material.alphaTest = slot.alphaTest;
      sr.materialLod.alphaTest = slot.alphaTest;
    }
    if (slot.roughness != null) {
      sr.material.roughness = slot.roughness;
      sr.materialLod.roughness = slot.roughness;
    }
    if (sr.textureObj) {
      this._applyMaskChannel(sr.uniforms, sr.textureObj);
      this._applyMaskChannel(sr.uniformsLod, sr.textureObj);
    }
  }

  _groupItemsBySlot(items) {
    const bySlot = new Map();
    for (const f of items) {
      const si = f.slotIdx;
      if (!bySlot.has(si)) bySlot.set(si, []);
      bySlot.get(si).push(f);
    }
    return bySlot;
  }

  _ensureSlotMesh(entry, slotIdx, list, lodKey, sr) {
    let sm = entry.slots.get(slotIdx);
    if (!sm) {
      sm = { activeLod: null, mesh: null };
      entry.slots.set(slotIdx, sm);
    }
    if (sm.activeLod === lodKey && sm.mesh) return;

    this._removeSlotMesh(sm);
    const geom = sr.geometries[lodKey];
    const mat = this._materialForLod(sr, lodKey);
    const im = new THREE.InstancedMesh(geom, mat, list.length);
    im.castShadow = false;
    im.receiveShadow = false;
    this._uploadInstances(im, list);
    this.scene.add(im);
    sm.mesh = im;
    sm.activeLod = lodKey;
  }

  _rebuildChunkEntry(key, items, grassSlots) {
    const entry = { gen: -1, slots: new Map() };
    this._chunkMeshes.set(key, entry);
    const bySlot = this._groupItemsBySlot(items);

    for (const [slotIdx, list] of bySlot) {
      const sr = this.slotRender[slotIdx];
      const slotCfg = grassSlots[slotIdx];
      if (!sr || !slotCfg?.enabled) continue;
      entry.slots.set(slotIdx, { activeLod: null, mesh: null, items: list });
    }
  }

  _effectiveFadeDistance(lodCfg, camY, perfOpts) {
    const fadeD = lodCfg.fadeOutDistance ?? 400;
    const aerial = lodCfg.aerialFadeStrength ?? 1;
    const boost = perfOpts?.aerialStrict ? 1.35 : 1;
    const alt = Math.max(0, camY - 25);
    return fadeD / (1 + alt * 0.012 * aerial * boost);
  }

  _scaleLodDistances(lodCfg, fadeMul) {
    return {
      lod0Distance: (lodCfg.lod0Distance ?? 60) * fadeMul,
      lod1Distance: (lodCfg.lod1Distance ?? 150) * fadeMul,
      fadeOutDistance: (lodCfg.fadeOutDistance ?? 400) * fadeMul,
    };
  }

  /**
   * @param {import("../../core/billboardGrass/billboardGrassStore.js").BillboardGrassStore} grassStore
   * @param {{ aerialStrict?: boolean }} [perfOpts]
   */
  update(grassStore, camera, lodCfg, grassSlots, perfOpts = {}) {
    const chunkSize = this.config.world.chunkSize;
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const camY = camera.position.y;

    const fadeD = this._effectiveFadeDistance(lodCfg, camY, perfOpts);
    const fadeSq = fadeD * fadeD;
    const fadeMul = fadeD / (lodCfg.fadeOutDistance ?? 400);
    const scaledLod = this._scaleLodDistances(lodCfg, fadeMul);

    const camMoved =
      (camX - this._lastCamX) ** 2 + (camZ - this._lastCamZ) ** 2 > 16 ||
      Number.isNaN(this._lastCamX);
    this._lodTick++;
    const runLodPass = camMoved || (this._lodTick & 3) === 0;

    if (runLodPass) {
      this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._projScreen);
      this._lastCamX = camX;
      this._lastCamZ = camZ;
    }

    const activeKeys = new Set();

    for (const [key, items] of grassStore.chunks) {
      if (!items?.length) continue;
      activeKeys.add(key);

      const { cx, cz } = parseChunkKey(key);
      const minX = chunkMinWorldX(cx, this.config);
      const minZ = chunkMinWorldZ(cz, this.config);
      const chunkCX = minX + chunkSize * 0.5;
      const chunkCZ = minZ + chunkSize * 0.5;
      const dcx = chunkCX - camX;
      const dcz = chunkCZ - camZ;
      const chunkDistSq = dcx * dcx + dcz * dcz;

      if (chunkDistSq > fadeSq) {
        const entry = this._chunkMeshes.get(key);
        if (entry) {
          for (const sm of entry.slots.values()) this._removeSlotMesh(sm);
        }
        continue;
      }

      const chunkDist = Math.sqrt(chunkDistSq);
      const gen = grassStore.getGen(key);
      let entry = this._chunkMeshes.get(key);
      if (!entry || entry.gen !== gen) {
        if (entry) {
          for (const sm of entry.slots.values()) this._disposeSlotMeshes(sm);
        }
        this._rebuildChunkEntry(key, items, grassSlots);
        entry = this._chunkMeshes.get(key);
        if (entry) entry.gen = gen;
      }
      if (!entry) continue;

      if (!runLodPass) continue;

      this._box.min.set(minX, -5, minZ);
      this._box.max.set(minX + chunkSize, 12, minZ + chunkSize);
      const showChunk = this._frustum.intersectsBox(this._box);
      const lodKey = pickLodTier(chunkDist, scaledLod, showChunk);

      for (const [slotIdx, sm] of entry.slots) {
        const list = sm.items ?? items.filter((f) => f.slotIdx === slotIdx);
        const sr = this.slotRender[slotIdx];
        const slotCfg = grassSlots[slotIdx];
        if (!sr || !slotCfg?.enabled || !list.length) {
          this._removeSlotMesh(sm);
          continue;
        }
        if (!lodKey) {
          this._removeSlotMesh(sm);
          continue;
        }
        this._ensureSlotMesh(entry, slotIdx, list, lodKey, sr);
      }
    }

    if (this._chunkMeshes.size > activeKeys.size + 16) {
      for (const key of [...this._chunkMeshes.keys()]) {
        if (!activeKeys.has(key)) this._disposeChunkEntry(key);
      }
    }
  }

  updateTime(t) {
    for (const sr of this.slotRender) {
      if (!sr) continue;
      if (sr.uniforms?.time) sr.uniforms.time.value = t;
      if (sr.uniformsLod?.time) sr.uniformsLod.time.value = t;
    }
  }

  updateSunDirection(dir) {
    this._sunDir.copy(dir);
    for (const sr of this.slotRender) {
      if (!sr) continue;
      if (sr.uniforms?.sunDir) sr.uniforms.sunDir.value.copy(dir);
      if (sr.uniformsLod?.sunDir) sr.uniformsLod.sunDir.value.copy(dir);
    }
  }

  dispose() {
    for (const key of [...this._chunkMeshes.keys()]) this._disposeChunkEntry(key);
    for (let i = 0; i < this.slotRender.length; i++) {
      const sr = this.slotRender[i];
      if (sr) {
        this._disposeLodGeometries(sr.geometries);
        sr.material.dispose();
        sr.materialLod.dispose();
      }
    }
    this._windTex?.dispose();
  }
}
