import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

export const RTS_TANK_DEFAULTS = {
  modelPath: "models/tankquaternius1_compressed.glb",
  /** World units long (matches RTS unit footprint; GLB is authored small). */
  targetLength: 5.5,
  maxInstances: 512,
  /** Y rotation so model front aligns with game +Z heading. */
  facingYaw: Math.PI,
};

const _v = new THREE.Vector3();
const _worldM = new THREE.Matrix4();
const _rootInv = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _hideScale = new THREE.Vector3(0, 0, 0);
const _color = new THREE.Color();
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();

function setupDracoLoader(loader) {
  const draco = new DRACOLoader();
  draco.setDecoderPath(
    "https://cdn.jsdelivr.net/npm/three@0.183.1/examples/jsm/libs/draco/",
  );
  loader.setDRACOLoader(draco);
  return draco;
}

/** Bake skinned vertices to mesh-local space using Three.js bone transform. */
function bakeSkinnedGeometry(mesh) {
  mesh.skeleton.update();
  mesh.updateMatrixWorld(true);
  const geometry = mesh.geometry.clone();
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    _v.fromBufferAttribute(position, i);
    mesh.applyBoneTransform(i, _v);
    position.setXYZ(i, _v.x, _v.y, _v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function geometryForMesh(mesh) {
  return mesh.isSkinnedMesh ? bakeSkinnedGeometry(mesh) : mesh.geometry.clone();
}

function cloneMaterial(mat) {
  if (Array.isArray(mat)) return mat.map((m) => m.clone());
  return mat.clone();
}

function tintMaterial(mat, hex) {
  const mats = Array.isArray(mat) ? mat : [mat];
  for (const m of mats) {
    if (m.color) m.color.set(hex);
    m.vertexColors = false;
  }
}

function poseScene(root) {
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.pose();
  });
  root.updateMatrixWorld(true);
}

/**
 * Extract mesh parts in tank-root-local space and measure bounds.
 * @returns {{ parts: Array<{geometry: BufferGeometry, material: Material}>, box: Box3 }}
 */
function extractTankParts(root) {
  root.updateMatrixWorld(true);
  _rootInv.copy(root.matrixWorld).invert();
  const parts = [];
  _box.makeEmpty();

  root.traverse((child) => {
    if (!child.isMesh) return;

    const geo = geometryForMesh(child);
    geo.applyMatrix4(child.matrixWorld).applyMatrix4(_rootInv);
    geo.computeBoundingBox();
    if (geo.boundingBox) _box.union(geo.boundingBox);
    parts.push({ geometry: geo, material: cloneMaterial(child.material) });
  });

  return { parts, box: _box.clone() };
}

function normalizePartGeometries(parts, box, targetLength, facingYaw) {
  if (box.isEmpty()) return;
  box.getSize(_size);
  box.getCenter(_center);
  const maxXZ = Math.max(_size.x, _size.z, 0.001);
  const s = targetLength / maxXZ;
  const rot = facingYaw ? new THREE.Matrix4().makeRotationY(facingYaw) : null;

  for (const part of parts) {
    const geo = part.geometry;
    geo.translate(-_center.x, -box.min.y, -_center.z);
    geo.scale(s, s, s);
    if (rot) geo.applyMatrix4(rot);
    geo.computeBoundingBox();
  }
}

/**
 * GPU-instanced Quaternius tank GLB for RTS units.
 * One InstancedMesh per GLB submesh; invisible hitbox for picking.
 */
export class RtsTankInstancer {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.opts = { ...RTS_TANK_DEFAULTS, ...options };
    this.maxInstances = this.opts.maxInstances;
    this.ready = false;
    this.parts = [];
    this.hitbox = null;
    this.hitboxSize = new THREE.Vector3(2.8, 1.8, 5.5);
    this.slots = new Array(this.maxInstances).fill(null);
    this.free = [];
    this.group = new THREE.Group();
    this.group.name = "RtsTankInstances";
    this.previewRoot = null;
    scene.add(this.group);
    for (let i = 0; i < this.maxInstances; i++) this.free.push(i);
  }

  async init() {
    if (this.ready) return this;
    const loader = new GLTFLoader();
    const draco = setupDracoLoader(loader);
    const gltf = await new Promise((resolve, reject) => {
      loader.load(this.opts.modelPath, resolve, undefined, reject);
    });
    draco.dispose();

    const raw = gltf.scene;
    poseScene(raw);

    const root = new THREE.Group();
    root.name = "RtsTankRoot";
    root.add(raw);

    let { parts, box } = extractTankParts(root);
    if (!parts.length) {
      throw new Error("[rts] tank GLB produced no mesh parts");
    }

    normalizePartGeometries(parts, box, this.opts.targetLength, this.opts.facingYaw);

    _box.makeEmpty();
    for (const part of parts) {
      if (part.geometry.boundingBox) _box.union(part.geometry.boundingBox);
    }
    _box.getSize(this.hitboxSize);
    this.hitboxSize.y = Math.max(this.hitboxSize.y, 1.4);

    for (const entry of parts) {
      const mat = entry.material;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        m.color.set(0xffffff);
      }
      const im = new THREE.InstancedMesh(
        entry.geometry,
        Array.isArray(mat) ? mat[0] : mat,
        this.maxInstances,
      );
      im.count = 0;
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(this.maxInstances * 3),
        3,
      );
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
      this.parts.push({ im });
    }

    const hitGeo = new THREE.BoxGeometry(
      this.hitboxSize.x * 0.95,
      this.hitboxSize.y * 0.9,
      this.hitboxSize.z * 0.95,
    );
    hitGeo.translate(0, this.hitboxSize.y * 0.45, 0);
    this.hitbox = new THREE.InstancedMesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ visible: false }),
      this.maxInstances,
    );
    this.hitbox.frustumCulled = false;
    this.hitbox.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.hitbox.userData.tankInstancerHitbox = true;
    this.group.add(this.hitbox);

    // Live skinned preview (thumbnails) — same pose, scale, facing as instances.
    this.previewRoot = new THREE.Group();
    const previewScene = gltf.scene.clone(true);
    poseScene(previewScene);
    this.previewRoot.add(previewScene);
    let previewExtract = extractTankParts(this.previewRoot);
    normalizePartGeometries(
      previewExtract.parts,
      previewExtract.box,
      this.opts.targetLength,
      this.opts.facingYaw,
    );
    this.previewRoot.clear();
    for (const part of previewExtract.parts) {
      const mat = part.material;
      const mesh = new THREE.Mesh(part.geometry, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.previewRoot.add(mesh);
    }

    this.ready = true;
    return this;
  }

  getUnitAt(slot) {
    return slot == null ? null : this.slots[slot];
  }

  getPickTargets() {
    return this.ready ? [this.hitbox] : [];
  }

  allocate(unit) {
    if (!this.ready || !this.free.length) return null;
    const slot = this.free.pop();
    this.slots[slot] = unit;
    for (const { im } of this.parts) {
      im.count = Math.max(im.count, slot + 1);
    }
    this.hitbox.count = Math.max(this.hitbox.count, slot + 1);
    this.syncUnit(unit);
    return slot;
  }

  freeSlot(slot) {
    if (slot == null) return;
    this.setSlotHidden(slot);
    this.slots[slot] = null;
    this.free.push(slot);
  }

  reset() {
    for (let i = 0; i < this.maxInstances; i++) {
      this.setSlotHidden(i);
      this.slots[i] = null;
    }
    this.free.length = 0;
    for (let i = 0; i < this.maxInstances; i++) this.free.push(i);
    for (const { im } of this.parts) im.count = 0;
    if (this.hitbox) this.hitbox.count = 0;
  }

  setUnitVisible(unit, visible) {
    if (unit?.tankSlot == null) return;
    if (visible) this.syncUnit(unit);
    else this.setSlotHidden(unit.tankSlot);
  }

  setSlotHidden(slot) {
    if (!this.ready || slot == null) return;
    _worldM.compose(_pos.set(0, 0, 0), _quat.identity(), _hideScale);
    for (const { im } of this.parts) {
      im.setMatrixAt(slot, _worldM);
      im.instanceMatrix.needsUpdate = true;
    }
    this.hitbox.setMatrixAt(slot, _worldM);
    this.hitbox.instanceMatrix.needsUpdate = true;
  }

  syncUnit(unit) {
    if (!this.ready || unit?.tankSlot == null || unit.dead) return;
    if (!unit.group.visible) {
      this.setSlotHidden(unit.tankSlot);
      return;
    }
    unit.group.updateMatrixWorld(true);
    _worldM.copy(unit.group.matrixWorld);
    for (const { im } of this.parts) {
      im.setMatrixAt(unit.tankSlot, _worldM);
      im.instanceMatrix.needsUpdate = true;
    }
    this.hitbox.setMatrixAt(unit.tankSlot, _worldM);
    this.hitbox.instanceMatrix.needsUpdate = true;
    this.setSlotColor(unit.tankSlot, unit.faction);
  }

  setSlotColor(slot, faction) {
    const hex =
      this.opts.palette?.[faction]?.hull ??
      (faction === "player" ? 0x4568a8 : 0xa03830);
    _color.setHex(hex);
    for (const { im } of this.parts) {
      im.setColorAt(slot, _color);
      im.instanceColor.needsUpdate = true;
    }
  }

  syncAll(units) {
    if (!this.ready) return;
    for (const u of units) {
      if (u.dead || u.type !== "tank" || u.tankSlot == null) continue;
      this.syncUnit(u);
    }
  }

  buildPreviewMesh(faction) {
    if (!this.previewRoot) return null;
    const g = this.previewRoot.clone(true);
    const hex =
      this.opts.palette?.[faction]?.hull ??
      (faction === "player" ? 0x4568a8 : 0xa03830);
    g.traverse((o) => {
      if (o.isMesh) tintMaterial(o.material, hex);
    });
    return g;
  }

  dispose() {
    this.reset();
    for (const { im } of this.parts) {
      this.group.remove(im);
      im.geometry.dispose();
      const m = im.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m.dispose();
      im.dispose();
    }
    this.parts.length = 0;
    if (this.hitbox) {
      this.group.remove(this.hitbox);
      this.hitbox.geometry.dispose();
      this.hitbox.material.dispose();
      this.hitbox.dispose();
      this.hitbox = null;
    }
    this.scene.remove(this.group);
    this.previewRoot = null;
    this.ready = false;
  }
}
