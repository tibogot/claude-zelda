/**
 * BillboardGrassRenderer — stream visible terrain chunks (few draws), mesh pools.
 * Patch index in the store is for paint/spacing only — not per-frame grid iteration.
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

/** Closest XZ distance from a point to an axis-aligned square chunk. */
function distXZToChunk(camX, camZ, minX, minZ, chunkSize) {
  const maxX = minX + chunkSize;
  const maxZ = minZ + chunkSize;
  const nx = THREE.MathUtils.clamp(camX, minX, maxX);
  const nz = THREE.MathUtils.clamp(camZ, minZ, maxZ);
  return Math.hypot(camX - nx, camZ - nz);
}

/** @returns {'lod0'|'lod1'|'lod2'|null} */
function pickLodTier(dist, lodCfg, hysteresis = 2) {
  const lod0D = lodCfg.lod0Distance ?? 50;
  const lod1D = lodCfg.lod1Distance ?? 120;
  const fadeD = lodCfg.fadeOutDistance ?? 280;
  const h = hysteresis;
  if (dist > fadeD + h) return null;
  if (dist > lod1D + h) return "lod2";
  if (dist > lod0D + h) return "lod1";
  return "lod0";
}

export class BillboardGrassRenderer {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    this.group = new THREE.Group();
    this.group.name = "BillboardGrass";
    scene.add(this.group);

    this.slotRender = [];
    this._windTex = createWindTexture();
    this._sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();

    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._worldMat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);

    this._chunkKeysBuf = [];
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

  _makeSlotPools() {
    const pools = {};
    for (const k of LOD_KEYS) pools[k] = { meshes: [], idx: 0 };
    return pools;
  }

  _trimPool(pool, maxKeep) {
    while (pool.meshes.length > maxKeep) {
      const m = pool.meshes.pop();
      this.group.remove(m);
      m.dispose();
    }
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
  }

  _getPooledMesh(pool, geometry, material, instanceCount) {
    const need = Math.max(instanceCount, 1);
    while (pool.idx < pool.meshes.length) {
      const m = pool.meshes[pool.idx++];
      if (m.instanceMatrix.count >= need) {
        m.geometry = geometry;
        m.material = material;
        m.visible = true;
        return m;
      }
    }
    const cap = Math.max(need, 64);
    const im = new THREE.InstancedMesh(geometry, material, cap);
    im.castShadow = false;
    im.receiveShadow = false;
    im.frustumCulled = false;
    this.group.add(im);
    pool.meshes.push(im);
    pool.idx++;
    this._trimPool(pool, 192);
    return im;
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
    return {
      material: full.material,
      materialLod: lod.material,
      uniforms: full.uniforms,
      uniformsLod: lod.uniforms,
    };
  }

  rebuildSlot(slotIdx, slot) {
    const prevTex = this.slotRender[slotIdx]?.textureObj ?? null;
    const prev = this.slotRender[slotIdx];
    if (prev) {
      this._disposeLodGeometries(prev.geometries);
      prev.material.dispose();
      prev.materialLod.dispose();
      for (const k of LOD_KEYS) {
        for (const m of prev._pools[k].meshes) {
          this.group.remove(m);
          m.dispose();
        }
      }
    }
    while (this.slotRender.length <= slotIdx) this.slotRender.push(null);
    this.slotRender[slotIdx] = null;

    if (!slot?.enabled) return;

    const geometries = this._buildLodGeometries(slot);
    const mats = this._createSlotMaterials(slot, prevTex);

    this.slotRender[slotIdx] = {
      geometries,
      material: mats.material,
      materialLod: mats.materialLod,
      uniforms: mats.uniforms,
      uniformsLod: mats.uniformsLod,
      textureObj: prevTex,
      _pools: this._makeSlotPools(),
    };
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
    const mats = this._createSlotMaterials(slotConfig || {}, tex);
    sr.material.dispose();
    sr.materialLod.dispose();
    sr.material = mats.material;
    sr.materialLod = mats.materialLod;
    sr.uniforms = mats.uniforms;
    sr.uniformsLod = mats.uniformsLod;
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

  _groupBySlot(items) {
    const bySlot = new Map();
    for (const f of items) {
      const si = f.slotIdx;
      if (!bySlot.has(si)) bySlot.set(si, []);
      bySlot.get(si).push(f);
    }
    return bySlot;
  }

  _effectiveFadeDistance(lodCfg, camY, perfOpts) {
    const fadeD = lodCfg.fadeOutDistance ?? 280;
    const aerial = lodCfg.aerialFadeStrength ?? 1;
    const boost = perfOpts?.aerialStrict ? 1.35 : 1;
    const alt = Math.max(0, camY - 25);
    const scaled = fadeD / (1 + alt * 0.012 * aerial * boost);
    return Math.max(scaled, fadeD * 0.45);
  }

  /**
   * @param {import("../../core/billboardGrass/billboardGrassStore.js").BillboardGrassStore} grassStore
   * @param {{ aerialStrict?: boolean }} [perfOpts]
   */
  update(grassStore, camera, lodCfg, grassSlots, perfOpts = {}) {
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const camY = camera.position.y;
    const chunkSize = this.config.world.chunkSize;

    const fadeD = this._effectiveFadeDistance(lodCfg, camY, perfOpts);
    const fadeMul = fadeD / (lodCfg.fadeOutDistance ?? 280);
    const scaledLod = {
      lod0Distance: (lodCfg.lod0Distance ?? 50) * fadeMul,
      lod1Distance: (lodCfg.lod1Distance ?? 120) * fadeMul,
      fadeOutDistance: fadeD,
    };
    const hysteresis = lodCfg.lodHysteresis ?? 2;
    const searchRadius = fadeD + chunkSize * Math.SQRT2;

    for (const sr of this.slotRender) {
      if (!sr?._pools) continue;
      for (const k of LOD_KEYS) sr._pools[k].idx = 0;
    }
    for (const child of this.group.children) child.visible = false;

    this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const keys = grassStore.getChunkKeysInRadius(camX, camZ, searchRadius);

    for (let ki = 0; ki < keys.length; ki++) {
      const key = keys[ki];
      const items = grassStore.chunks.get(key);
      if (!items?.length) continue;

      const { cx, cz } = parseChunkKey(key);
      const minX = chunkMinWorldX(cx, this.config);
      const minZ = chunkMinWorldZ(cz, this.config);
      const chunkDist = distXZToChunk(camX, camZ, minX, minZ, chunkSize);
      if (chunkDist > fadeD) continue;

      this._box.min.set(minX, -60, minZ);
      this._box.max.set(minX + chunkSize, 180, minZ + chunkSize);
      if (!this._frustum.intersectsBox(this._box)) continue;

      const lodKey = pickLodTier(chunkDist, scaledLod, hysteresis);
      if (!lodKey) continue;

      const bySlot = this._groupBySlot(items);
      for (const [slotIdx, list] of bySlot) {
        const sr = this.slotRender[slotIdx];
        const slotCfg = grassSlots[slotIdx];
        if (!sr || !slotCfg?.enabled || !list.length) continue;

        const geom = sr.geometries[lodKey];
        const mat = this._materialForLod(sr, lodKey);
        const im = this._getPooledMesh(sr._pools[lodKey], geom, mat, list.length);
        this._uploadInstances(im, list);
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
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      child.dispose?.();
    }
    for (let i = 0; i < this.slotRender.length; i++) {
      const sr = this.slotRender[i];
      if (sr) {
        this._disposeLodGeometries(sr.geometries);
        sr.material.dispose();
        sr.materialLod.dispose();
      }
    }
    this.scene.remove(this.group);
    this._windTex?.dispose();
  }
}
