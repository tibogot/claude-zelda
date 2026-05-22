/**
 * BillboardRenderer — instanced rendering for billboard foliage (cross/Y cards).
 *
 * Each slot has its own InstancedMesh with merged plane geometry.
 * Uses TSL for wind animation, SSS, and ground occlusion.
 */
import * as THREE from "three";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";
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
  normalLocal,
  normalWorld,
  normalize,
  dot,
  cameraPosition,
  positionWorld,
  max,
  mix,
  abs,
} from "three/tsl";

const MAX_INSTANCES = 8192;

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
     * slotRender[slotIdx] = {
     *   geometry, material, instancedMesh, uniforms, textureObj
     * } | null
     */
    this.slotRender = [];

    this._cache = new Map();
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._worldMat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);

    this._time = 0;
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
      const foliageNormal = normalize(upBias.add(viewBias));
      return foliageNormal;
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

  rebuildSlot(slotIdx, slot) {
    const prevTex = this.slotRender[slotIdx]?.textureObj ?? null;
    this._disposeSlot(slotIdx);

    if (!slot || !slot.enabled) return;

    const geometry = this._buildGeometry(slot);
    const slotForMat =
      prevTex != null
        ? { ...slot, _textureNode: texture(prevTex, uv()) }
        : slot;
    const { material, uniforms } = this._createMaterial(slotForMat);

    const im = new THREE.InstancedMesh(geometry, material, MAX_INSTANCES);
    im.count = 0;
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    this.scene.add(im);

    while (this.slotRender.length <= slotIdx) this.slotRender.push(null);
    this.slotRender[slotIdx] = {
      geometry,
      material,
      instancedMesh: im,
      uniforms,
      textureObj: prevTex,
    };
  }

  setSlotTexture(slotIdx, tex, slotConfig = null) {
    const sr = this.slotRender[slotIdx];
    if (!sr) return;
    sr.textureObj = tex;
    const slot = { ...(slotConfig || {}), _textureNode: tex ? texture(tex, uv()) : null };
    const { material, uniforms } = this._createMaterial(slot);
    sr.instancedMesh.material.dispose();
    sr.instancedMesh.material = material;
    sr.uniforms = uniforms;
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
    const sr = this.slotRender[slotIdx];
    if (!sr) return;
    sr.instancedMesh.geometry.dispose();
    sr.instancedMesh.material.dispose();
    this.scene.remove(sr.instancedMesh);
    this.slotRender[slotIdx] = null;
  }

  _rebuildChunkCache(key, items, gen) {
    const n = items.length;
    let entry = this._cache.get(key);
    if (!entry || entry.mats.length < n * 16) {
      entry = {
        gen,
        count: n,
        slots: new Uint8Array(Math.max(n, 64)),
        mats: new Float32Array(Math.max(n, 64) * 16),
        xs: new Float32Array(Math.max(n, 64)),
        ys: new Float32Array(Math.max(n, 64)),
        zs: new Float32Array(Math.max(n, 64)),
      };
      this._cache.set(key, entry);
    }
    entry.gen = gen;
    entry.count = n;

    const me = this._worldMat.elements;
    for (let i = 0; i < n; i++) {
      const f = items[i];
      entry.slots[i] = f.slotIdx;
      entry.xs[i] = f.x;
      entry.ys[i] = f.y ?? 0;
      entry.zs[i] = f.z;

      this._pos.set(f.x, f.y ?? 0, f.z);
      this._quat.setFromAxisAngle(this._yAxis, f.rotY);
      this._scl.setScalar(f.scale);
      this._worldMat.compose(this._pos, this._quat, this._scl);

      const off = i * 16;
      for (let j = 0; j < 16; j++) entry.mats[off + j] = me[j];
    }
  }

  /** @param {{ fadeOutDistance?: number }} lodCfg — billboard cull distance (no LOD tiers). */
  update(foliageStore, camera, lodCfg) {
    for (const sr of this.slotRender) {
      if (sr?.instancedMesh) sr.instancedMesh.count = 0;
    }

    this._projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    const fadeD2 = (lodCfg.fadeOutDistance ?? 200) * (lodCfg.fadeOutDistance ?? 200);
    const chunkSize = this.config.world.chunkSize;
    const half = this.config.world.size * 0.5;

    const counts = [];
    for (let i = 0; i < this.slotRender.length; i++) counts.push(0);

    for (const [key, items] of foliageStore.chunks) {
      if (items.length === 0) continue;

      const gen = foliageStore.getGen(key);
      let entry = this._cache.get(key);
      if (!entry || entry.gen !== gen) {
        this._rebuildChunkCache(key, items, gen);
        entry = this._cache.get(key);
      }

      const parts = key.split(",");
      const cx = parseInt(parts[0]);
      const cz = parseInt(parts[1]);
      const chunkCenterX = (cx + 0.5) * chunkSize - half;
      const chunkCenterZ = (cz + 0.5) * chunkSize - half;

      const dcx = chunkCenterX - camX;
      const dcz = chunkCenterZ - camZ;
      const chunkDist2 = dcx * dcx + dcz * dcz;
      if (chunkDist2 > fadeD2 * 1.5) continue;

      for (let i = 0; i < entry.count; i++) {
        const slotIdx = entry.slots[i];
        const sr = this.slotRender[slotIdx];
        if (!sr) continue;

        const dx = entry.xs[i] - camX;
        const dy = entry.ys[i] - camY;
        const dz = entry.zs[i] - camZ;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > fadeD2) continue;

        const c = counts[slotIdx];
        if (c >= MAX_INSTANCES) continue;

        const off = i * 16;
        this._worldMat.fromArray(entry.mats, off);
        sr.instancedMesh.setMatrixAt(c, this._worldMat);
        counts[slotIdx] = c + 1;
      }
    }

    for (let i = 0; i < this.slotRender.length; i++) {
      const sr = this.slotRender[i];
      if (!sr) continue;
      sr.instancedMesh.count = counts[i];
      if (counts[i] > 0) {
        sr.instancedMesh.instanceMatrix.needsUpdate = true;
      }
    }
  }

  updateTime(t) {
    this._time = t;
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
    for (let i = 0; i < this.slotRender.length; i++) {
      this._disposeSlot(i);
    }
    this._cache.clear();
  }
}
