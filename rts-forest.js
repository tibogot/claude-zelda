/**
 * RTS pine forest — instanced pine2_compressed.glb with 2-tier mesh LOD.
 * Culling uses horizontal distance from the camera pan target and zoom-scaled radii.
 */
import * as THREE from "three";
import { initRtsGltfLoader, loadRtsGltfScene } from "./rts-gltf-loader.js";

const INITIAL_CAPACITY = 8192;
const CULL_MARGIN = 8;
const CULL_HEIGHT = 22;
const _yAxis = new THREE.Vector3(0, 1, 0);

function makeForestRng(seed) {
  if (!seed) return () => Math.random();
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function isExcluded(x, z, circles) {
  for (const c of circles) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < c.r * c.r) return true;
  }
  return false;
}

function fixFoliageMaterial(mat) {
  if (!mat) return;
  if (mat.alphaMap || mat.map) {
    mat.transparent = false;
    mat.alphaTest = mat.alphaTest > 0 ? mat.alphaTest : 0.45;
    mat.depthWrite = true;
    mat.side = THREE.DoubleSide;
  }
  mat.fog = true;
}

function extractSubmeshes(root) {
  const submeshes = [];
  root.updateMatrixWorld(true);
  root.traverse((child) => {
    if (!child.isMesh) return;
    const geo = child.geometry.clone();
    const mat = child.material?.clone?.() ?? child.material;
    fixFoliageMaterial(mat);
    const name = (child.name + " " + (mat?.name ?? "")).toLowerCase();
    const isTrunk = /trunk|bark|stem|wood/i.test(name);
    submeshes.push({
      geometry: geo,
      material: mat,
      localMatrix: child.matrixWorld.clone(),
      isTrunk,
    });
  });
  return submeshes;
}

function resolveLodTier(dist2, lod0D2, fadeD2) {
  if (dist2 > fadeD2) return -1;
  if (dist2 > lod0D2) return 1;
  return 0;
}

export class RtsPineForest {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = "RtsPineForest";
    this.scene.add(this.group);

    this.cfg = null;
    this.enabled = true;
    this.trees = [];
    this.treeChunks = new Map();

    this.lod0 = [];
    this.lod1 = [];
    this._cap = INITIAL_CAPACITY;

    this.stats = {
      treeCount: 0,
      visibleTrees: 0,
      drawCalls: 0,
      lod0Trees: 0,
      lod1Trees: 0,
    };

    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._worldMat = new THREE.Matrix4();
    this._finalMat = new THREE.Matrix4();
    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scl = new THREE.Vector3();
  }

  async init(cfg) {
    this.cfg = cfg;
    initRtsGltfLoader(this.renderer);
    const [lod0Scene, lod1Scene] = await Promise.all([
      loadRtsGltfScene("models/pine2_compressed.glb"),
      loadRtsGltfScene("models/pine2LOD1_compressed.glb"),
    ]);
    const lod0Defs = extractSubmeshes(lod0Scene);
    const lod1Defs = extractSubmeshes(lod1Scene);

    this._disposeMeshSlots();
    this.lod0 = this._makeSlotMeshes(lod0Defs, "lod0");
    this.lod1 = this._makeSlotMeshes(lod1Defs, "lod1");

    this._populateTrees();
    this.applyShadowFlags();
  }

  _makeSlotMeshes(defs, key) {
    return defs.map((sm) => {
      const im = new THREE.InstancedMesh(sm.geometry, sm.material, this._cap);
      im.count = 0;
      im.name = `rts-pine-${key}-${sm.isTrunk ? "trunk" : "leaf"}`;
      im.frustumCulled = false;
      this.group.add(im);
      return { ...sm, instancedMesh: im };
    });
  }

  _populateTrees() {
    const F = this.cfg.forest;
    const rng = makeForestRng(F.placementSeed ?? 0);
    const cs = F.chunkSize ?? 100;
    const half = Math.floor(F.halfExtent / F.spacing);
    this.trees = [];
    this.treeChunks.clear();

    for (let iz = -half; iz <= half; iz++) {
      for (let ix = -half; ix <= half; ix++) {
        const x = ix * F.spacing + (rng() - 0.5) * F.jitter * 2;
        const z = iz * F.spacing + (rng() - 0.5) * F.jitter * 2;
        if (isExcluded(x, z, F.excludeCircles)) continue;
        if (F.density < 1 && rng() > F.density) continue;
        const scale =
          F.scaleMin + rng() * Math.max(0.01, F.scaleMax - F.scaleMin);
        const rotY = rng() * Math.PI * 2;
        const y = F.getTreeY ? F.getTreeY(x, z) : 0;
        const tree = { x, y, z, scale, rotY };
        const cx = Math.floor(x / cs);
        const cz = Math.floor(z / cs);
        const key = `${cx},${cz}`;
        if (!this.treeChunks.has(key)) {
          this.treeChunks.set(key, { cx, cz, trees: [] });
        }
        this.treeChunks.get(key).trees.push(tree);
        this.trees.push(tree);
      }
    }

    this.stats.treeCount = this.trees.length;
  }

  rebuildForest() {
    this._populateTrees();
    this.stats.treeCount = this.trees.length;
  }

  _treeBlockRadius() {
    return this.cfg?.forest?.treeBlockRadius ?? 1.5;
  }

  _blockNav() {
    return this.enabled && this.cfg?.forest?.blockNav !== false;
  }

  /** Nav-grid circles for every placed tree. */
  getNavBlockers() {
    if (!this._blockNav()) return [];
    const r = this._treeBlockRadius();
    return this.trees.map((t) => ({ x: t.x, z: t.z, r }));
  }

  /** Trees whose trunk footprint may overlap a world query (runtime push-out). */
  getTreesNear(x, z, searchR) {
    if (!this._blockNav()) return [];
    const blockR = this._treeBlockRadius();
    const cs = this.cfg?.forest?.chunkSize ?? 100;
    const out = [];
    const minCx = Math.floor((x - searchR) / cs);
    const maxCx = Math.floor((x + searchR) / cs);
    const minCz = Math.floor((z - searchR) / cs);
    const maxCz = Math.floor((z + searchR) / cs);
    const maxD2 = (searchR + blockR) * (searchR + blockR);
    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const chunk = this.treeChunks.get(`${cx},${cz}`);
        if (!chunk) continue;
        for (const t of chunk.trees) {
          const dx = t.x - x;
          const dz = t.z - z;
          if (dx * dx + dz * dz <= maxD2) {
            out.push({ x: t.x, z: t.z, r: blockR });
          }
        }
      }
    }
    return out;
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
  }

  applyShadowFlags() {
    const recv = this.cfg?.shadow?.lod0Receive !== false;
    const cast = this.cfg?.shadow?.castFoliage !== false;
    for (const sm of this.lod0) {
      sm.instancedMesh.castShadow = cast && sm.isTrunk;
      sm.instancedMesh.receiveShadow = recv;
    }
    for (const sm of this.lod1) {
      sm.instancedMesh.castShadow = false;
      sm.instancedMesh.receiveShadow = false;
    }
  }

  syncSunDirection() {}

  updateTime() {}

  /**
   * @param {THREE.Camera} camera
   * @param {object} lodCfg
   * @param {{ targetX: number, targetZ: number, zoom: number }} rts
   */
  update(camera, lodCfg, rts = {}) {
    if (!this.enabled) return;

    const targetX = rts.targetX ?? camera.position.x;
    const targetZ = rts.targetZ ?? camera.position.z;
    const zoom = Math.max(1, rts.zoom ?? 120);
    const zf = THREE.MathUtils.clamp(zoom / 110, 0.35, 1.25);

    const lod0D = (lodCfg.lod0Distance ?? 45) * zf;
    const fadeD =
      (lodCfg.fadeOutDistance ?? lodCfg.lod1Distance ?? 220) * zf;
    const lod0D2 = lod0D * lod0D;
    const fadeD2 = fadeD * fadeD;

    for (const sm of this.lod0) sm.instancedMesh.count = 0;
    for (const sm of this.lod1) sm.instancedMesh.count = 0;

    this._projScreen.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const cs = this.cfg.forest.chunkSize ?? 100;
    let visible = 0;
    let lod0Count = 0;
    let lod1Count = 0;
    let draws = 0;

    for (const chunk of this.treeChunks.values()) {
      if (chunk.trees.length === 0) continue;
      const minX = chunk.cx * cs;
      const minZ = chunk.cz * cs;
      this._box.min.set(minX - CULL_MARGIN, -5, minZ - CULL_MARGIN);
      this._box.max.set(
        minX + cs + CULL_MARGIN,
        CULL_HEIGHT,
        minZ + cs + CULL_MARGIN,
      );
      if (!this._frustum.intersectsBox(this._box)) continue;

      for (const t of chunk.trees) {
        const dx = t.x - targetX;
        const dz = t.z - targetZ;
        const dist2 = dx * dx + dz * dz;
        const tier = resolveLodTier(dist2, lod0D2, fadeD2);
        if (tier < 0) continue;

        visible++;
        this._pos.set(t.x, t.y, t.z);
        this._quat.setFromAxisAngle(_yAxis, t.rotY);
        this._scl.setScalar(t.scale);
        this._worldMat.compose(this._pos, this._quat, this._scl);

        if (tier === 0 && lod0Count < this._cap) {
          const idx = lod0Count++;
          for (const sm of this.lod0) {
            this._finalMat.multiplyMatrices(this._worldMat, sm.localMatrix);
            sm.instancedMesh.setMatrixAt(idx, this._finalMat);
          }
        } else if (tier === 1 && lod1Count < this._cap) {
          const idx = lod1Count++;
          for (const sm of this.lod1) {
            this._finalMat.multiplyMatrices(this._worldMat, sm.localMatrix);
            sm.instancedMesh.setMatrixAt(idx, this._finalMat);
          }
        }
      }
    }

    for (const sm of this.lod0) {
      sm.instancedMesh.count = lod0Count;
      if (lod0Count > 0) sm.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (lod0Count > 0) draws++;
    for (const sm of this.lod1) {
      sm.instancedMesh.count = lod1Count;
      if (lod1Count > 0) sm.instancedMesh.instanceMatrix.needsUpdate = true;
    }
    if (lod1Count > 0) draws++;

    this.stats.visibleTrees = visible;
    this.stats.lod0Trees = lod0Count;
    this.stats.lod1Trees = lod1Count;
    this.stats.drawCalls = draws;
  }

  _disposeMeshSlots() {
    for (const arr of [this.lod0, this.lod1]) {
      for (const sm of arr) {
        this.group.remove(sm.instancedMesh);
        sm.instancedMesh.dispose();
      }
    }
    this.lod0 = [];
    this.lod1 = [];
  }

  dispose() {
    this._disposeMeshSlots();
    this.scene.remove(this.group);
    this.trees = [];
    this.treeChunks.clear();
  }
}
