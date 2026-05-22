/**
 * BillboardRenderer — per-chunk instanced billboard foliage (cross/Y cards).
 *
 * Each terrain chunk gets its own InstancedMesh per active slot (shared geometry +
 * material per slot). Matrices upload only when FoliageStore bumps chunk generation.
 */
import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
import { parseChunkKey, chunkMinWorldX, chunkMinWorldZ } from "../../core/terrain/chunkMath.js";
import {
  Fn,
  uv,
  vec3,
  vec4,
  sin,
  uniform,
  texture,
  positionLocal,
  color,
  normalWorld,
  normalize,
  dot,
  cameraPosition,
  positionWorld,
  max,
} from "three/tsl";

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

export class BillboardRenderer {
  constructor(scene, config) {
    this.scene = scene;
    this.config = config;
    /**
     * Shared assets per paint slot (geometry + material reused by chunk meshes).
     * slotRender[slotIdx] = { geometry, material, uniforms, textureObj } | null
     */
    this.slotRender = [];

    /**
     * chunkMeshes: Map<chunkKey, { gen, slots: Map<slotIdx, InstancedMesh> }>
     */
    this._chunkMeshes = new Map();

    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._worldMat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
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

  _createMaterial(slot) {
    const u = {
      time: uniform(0),
      swaySpeed: uniform(slot.swaySpeed ?? 1.2),
      swayStrength: uniform(slot.swayStrength ?? 0.12),
      sssIntensity: uniform(slot.sssIntensity ?? 1.5),
      groundOcclusion: uniform(slot.groundOcclusion ?? 0.7),
      normalBending: uniform(slot.normalBending ?? 0.6),
      colorTint: uniform(color(slot.colorTint ?? "#ffffff")),
      sunDir: uniform(this._sunDir.clone()),
      height: uniform(slot.height ?? 2.0),
    };

    const material = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide,
      alphaTest: slot.alphaTest ?? 0.5,
      transparent: false,
      roughness: slot.roughness ?? 0.85,
      metalness: 0,
    });

    material.normalNode = Fn(() => {
      const viewDir = normalize(cameraPosition.sub(positionWorld));
      const upBias = vec3(0, 0.85, 0);
      const viewBias = vec3(viewDir.x.mul(0.3), 0, viewDir.z.mul(0.3));
      return normalize(upBias.add(viewBias));
    })();

    const defaultColor = vec4(0.28, 0.62, 0.22, 1.0);

    material.colorNode = Fn(() => {
      const tex = slot._textureNode ? slot._textureNode : defaultColor;
      const ao = uv().y.smoothstep(0.0, u.groundOcclusion).add(0.15);
      const lightDir = normalize(u.sunDir);
      const viewDir = normalize(cameraPosition.sub(positionWorld));
      const backlit = max(0.0, dot(viewDir, lightDir.negate()));
      const backlitBoost = backlit.pow(1.5).mul(0.3).add(1.0);
      return vec4(tex.rgb.mul(u.colorTint).mul(ao).mul(backlitBoost), tex.a);
    })();

    material.emissiveNode = Fn(() => {
      const tex = slot._textureNode ? slot._textureNode : defaultColor;
      const lightDir = normalize(u.sunDir);
      const viewDir = normalize(cameraPosition.sub(positionWorld));
      const translucency = max(0.0, dot(viewDir, lightDir.negate()));
      const translucentGlow = translucency.pow(1.2);
      const heightFade = uv().y.smoothstep(0.05, 0.6);
      const sssGlow = tex.rgb.mul(translucentGlow).mul(u.sssIntensity).mul(heightFade);
      return sssGlow;
    })();

    material.positionNode = Fn(() => {
      const wind = sin(u.time.mul(u.swaySpeed))
        .mul(u.swayStrength)
        .mul(uv().y.pow(1.5));
      return vec3(
        positionLocal.x.add(wind),
        positionLocal.y,
        positionLocal.z.add(wind),
      );
    })();

    return { material, uniforms: u };
  }

  _removeChunkMesh(im) {
    if (!im) return;
    this.scene.remove(im);
    im.geometry = null;
    im.material = null;
  }

  _disposeChunkEntry(key) {
    const entry = this._chunkMeshes.get(key);
    if (!entry) return;
    for (const im of entry.slots.values()) {
      this._removeChunkMesh(im);
    }
    this._chunkMeshes.delete(key);
  }

  _disposeChunkMeshesForSlot(slotIdx) {
    for (const [, entry] of this._chunkMeshes) {
      const im = entry.slots.get(slotIdx);
      if (im) {
        this._removeChunkMesh(im);
        entry.slots.delete(slotIdx);
      }
    }
  }

  _invalidateAllChunks() {
    for (const [, entry] of this._chunkMeshes) {
      entry.gen = -1;
    }
  }

  rebuildSlot(slotIdx, slot) {
    const prevTex = this.slotRender[slotIdx]?.textureObj ?? null;
    this._disposeChunkMeshesForSlot(slotIdx);

    const prev = this.slotRender[slotIdx];
    if (prev) {
      prev.geometry.dispose();
      prev.material.dispose();
    }
    while (this.slotRender.length <= slotIdx) this.slotRender.push(null);
    this.slotRender[slotIdx] = null;

    if (!slot || !slot.enabled) {
      this._invalidateAllChunks();
      return;
    }

    const geometry = this._buildGeometry(slot);
    const slotForMat =
      prevTex != null ? { ...slot, _textureNode: texture(prevTex, uv()) } : slot;
    const { material, uniforms } = this._createMaterial(slotForMat);

    this.slotRender[slotIdx] = {
      geometry,
      material,
      uniforms,
      textureObj: prevTex,
    };
    this._invalidateAllChunks();
  }

  setSlotTexture(slotIdx, tex, slotConfig = null) {
    const sr = this.slotRender[slotIdx];
    if (!sr) return;
    sr.textureObj = tex;
    const slot = { ...(slotConfig || {}), _textureNode: tex ? texture(tex, uv()) : null };
    const { material, uniforms } = this._createMaterial(slot);
    sr.material.dispose();
    sr.material = material;
    sr.uniforms = uniforms;
    for (const [, entry] of this._chunkMeshes) {
      const im = entry.slots.get(slotIdx);
      if (im) im.material = material;
    }
  }

  updateSlotUniforms(slotIdx, slot) {
    const sr = this.slotRender[slotIdx];
    if (!sr || !sr.uniforms) return;
    const u = sr.uniforms;
    if (slot.swaySpeed !== undefined) u.swaySpeed.value = slot.swaySpeed;
    if (slot.swayStrength !== undefined) u.swayStrength.value = slot.swayStrength;
    if (slot.sssIntensity !== undefined) u.sssIntensity.value = slot.sssIntensity;
    if (slot.groundOcclusion !== undefined) u.groundOcclusion.value = slot.groundOcclusion;
    if (slot.normalBending !== undefined) u.normalBending.value = slot.normalBending;
    if (slot.colorTint !== undefined) u.colorTint.value.set(slot.colorTint);
  }

  _disposeSlot(slotIdx) {
    this._disposeChunkMeshesForSlot(slotIdx);
    const sr = this.slotRender[slotIdx];
    if (!sr) return;
    sr.geometry.dispose();
    sr.material.dispose();
    this.slotRender[slotIdx] = null;
  }

  /**
   * Rebuild all InstancedMeshes for one chunk (grouped by slotIdx).
   * @param {string} key
   * @param {Array} items
   * @param {object[]} foliageSlots
   */
  _rebuildChunkMeshes(key, items, foliageSlots) {
    let entry = this._chunkMeshes.get(key);
    if (entry) {
      for (const im of entry.slots.values()) {
        this._removeChunkMesh(im);
      }
      entry.slots.clear();
    } else {
      entry = { gen: -1, slots: new Map() };
      this._chunkMeshes.set(key, entry);
    }

    const bySlot = new Map();
    for (const f of items) {
      const si = f.slotIdx;
      if (!bySlot.has(si)) bySlot.set(si, []);
      bySlot.get(si).push(f);
    }

    for (const [slotIdx, list] of bySlot) {
      const sr = this.slotRender[slotIdx];
      const slotCfg = foliageSlots[slotIdx];
      if (!sr || !slotCfg?.enabled) continue;

      const n = list.length;
      const im = new THREE.InstancedMesh(sr.geometry, sr.material, n);
      im.count = n;
      im.castShadow = false;
      im.receiveShadow = true;
      im.frustumCulled = true;

      for (let i = 0; i < n; i++) {
        const f = list[i];
        this._pos.set(f.x, f.y ?? 0, f.z);
        this._quat.setFromAxisAngle(this._yAxis, f.rotY);
        this._scl.setScalar(f.scale);
        this._worldMat.compose(this._pos, this._quat, this._scl);
        im.setMatrixAt(i, this._worldMat);
      }
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();

      this.scene.add(im);
      entry.slots.set(slotIdx, im);
    }
  }

  /**
   * @param {import("../../core/foliage/foliageStore.js").FoliageStore} foliageStore
   * @param {THREE.Camera} camera
   * @param {{ fadeOutDistance?: number }} lodCfg
   * @param {object[]} foliageSlots
   */
  update(foliageStore, camera, lodCfg, foliageSlots) {
    this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const fadeD = lodCfg.fadeOutDistance ?? 200;
    const chunkFarD2 = fadeD * fadeD * 2.25;
    const chunkSize = this.config.world.chunkSize;

    const camX = camera.position.x;
    const camZ = camera.position.z;
    const activeKeys = new Set();

    for (const [key, items] of foliageStore.chunks) {
      if (!items || items.length === 0) continue;
      activeKeys.add(key);

      const { cx, cz } = parseChunkKey(key);
      const minX = chunkMinWorldX(cx, this.config);
      const minZ = chunkMinWorldZ(cz, this.config);
      const chunkCX = minX + chunkSize * 0.5;
      const chunkCZ = minZ + chunkSize * 0.5;

      const dcx = chunkCX - camX;
      const dcz = chunkCZ - camZ;
      const chunkDist2 = dcx * dcx + dcz * dcz;

      const gen = foliageStore.getGen(key);
      let entry = this._chunkMeshes.get(key);
      if (!entry || entry.gen !== gen) {
        this._rebuildChunkMeshes(key, items, foliageSlots);
        entry = this._chunkMeshes.get(key);
        if (entry) entry.gen = gen;
      }

      if (!entry) continue;

      const inRange = chunkDist2 <= chunkFarD2;
      this._box.min.set(minX, -100, minZ);
      this._box.max.set(minX + chunkSize, 600, minZ + chunkSize);
      const inFrustum = this._frustum.intersectsBox(this._box);
      const show = inRange && inFrustum;

      for (const im of entry.slots.values()) {
        im.visible = show;
      }
    }

    if (this._chunkMeshes.size > activeKeys.size + 16) {
      for (const key of [...this._chunkMeshes.keys()]) {
        if (!activeKeys.has(key)) {
          this._disposeChunkEntry(key);
        }
      }
    }
  }

  updateTime(t) {
    for (const sr of this.slotRender) {
      if (sr?.uniforms?.time) sr.uniforms.time.value = t;
    }
  }

  updateSunDirection(dir) {
    this._sunDir.copy(dir);
    for (const sr of this.slotRender) {
      if (sr?.uniforms?.sunDir) {
        sr.uniforms.sunDir.value.copy(dir);
      }
    }
  }

  dispose() {
    for (const key of [...this._chunkMeshes.keys()]) {
      this._disposeChunkEntry(key);
    }
    for (let i = 0; i < this.slotRender.length; i++) {
      this._disposeSlot(i);
    }
  }
}
