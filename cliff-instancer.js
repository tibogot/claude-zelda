/**
 * cliff-instancer.js — Instanced cliff/rock placement system.
 * One draw call per submesh per loaded GLB, regardless of instance count.
 *
 * Correctly handles multi-mesh GLBs: each submesh keeps its local offset
 * matrix (relative to the GLB root), and instance matrices are composed as
 *   finalMatrix = instanceTransform * submeshLocalMatrix
 * This matches exactly what Place mode does when it adds gltf.scene to the scene.
 *
 * Selection raycasting uses an invisible BoxGeometry hitbox (sized to the GLB
 * bounding box) so any click anywhere on the object registers — not just
 * precise triangle hits on the real geometry.
 */

import * as THREE from "three";

const DEG = Math.PI / 180;
const _tmp = new THREE.Matrix4();
const _hitboxMat = new THREE.MeshBasicMaterial({ visible: false });

export function createCliffInstancer(scene, options = {}) {
  const MAX = options.maxInstances ?? 500;

  /**
   * types[i] = {
   *   name: string,
   *   entries: [{ im: InstancedMesh, localMatrix: Matrix4 }],
   *   instances: [{ px,py,pz, rx,ry,rz, sx,sy,sz }],
   *   hitboxIM: InstancedMesh,       // invisible box for easy raycasting
   *   boxCenterMatrix: Matrix4,      // translation by bounding box center offset
   * }
   */
  const types = [];
  let activeTypeIdx = 0;
  let selectedTypeIdx = -1;
  let selectedInstIdx = -1;

  const dummy = new THREE.Object3D();

  // Proxy Object3D that TransformControls can attach to for the selected instance.
  // Must be in the scene graph for TransformControls to work.
  const proxyObj = new THREE.Object3D();
  scene.add(proxyObj);

  function computeInstanceMatrix(inst) {
    dummy.position.set(inst.px, inst.py, inst.pz);
    dummy.rotation.order = "XYZ";
    dummy.rotation.set(inst.rx * DEG, inst.ry * DEG, inst.rz * DEG);
    dummy.scale.set(inst.sx, inst.sy, inst.sz);
    dummy.updateMatrix();
    return dummy.matrix;
  }

  function setAllMatrices(type, instIdx) {
    const inst = type.instances[instIdx];
    const M = computeInstanceMatrix(inst);
    for (const { im, localMatrix } of type.entries) {
      _tmp.multiplyMatrices(M, localMatrix);
      im.setMatrixAt(instIdx, _tmp);
      im.instanceMatrix.needsUpdate = true;
    }
    if (type.hitboxIM) {
      _tmp.multiplyMatrices(M, type.boxCenterMatrix);
      type.hitboxIM.setMatrixAt(instIdx, _tmp);
      type.hitboxIM.instanceMatrix.needsUpdate = true;
      type.hitboxIM.boundingSphere = null;
      type.hitboxIM.boundingBox = null;
    }
  }

  function rebuildAll(type) {
    const n = type.instances.length;
    for (const { im, localMatrix } of type.entries) {
      im.count = n;
      for (let i = 0; i < n; i++) {
        const M = computeInstanceMatrix(type.instances[i]);
        _tmp.multiplyMatrices(M, localMatrix);
        im.setMatrixAt(i, _tmp);
      }
      im.instanceMatrix.needsUpdate = true;
    }
    if (type.hitboxIM) {
      type.hitboxIM.count = n;
      for (let i = 0; i < n; i++) {
        const M = computeInstanceMatrix(type.instances[i]);
        _tmp.multiplyMatrices(M, type.boxCenterMatrix);
        type.hitboxIM.setMatrixAt(i, _tmp);
      }
      type.hitboxIM.instanceMatrix.needsUpdate = true;
      type.hitboxIM.boundingSphere = null;
      type.hitboxIM.boundingBox = null;
    }
  }

  // ── Selection marker: yellow dot above selected instance ──
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffdd00, depthTest: false })
  );
  marker.visible = false;
  marker.renderOrder = 999;
  scene.add(marker);

  function moveMarker(inst) {
    if (!inst) { marker.visible = false; return; }
    marker.position.set(inst.px, inst.py + 3.5, inst.pz);
    marker.visible = true;
  }

  return {

    // ── Register a loaded GLB as a cliff type ──
    loadGLB(gltfData, name) {
      const entries = [];

      // Compute matrixWorld for the gltf scene graph (it has no parent)
      gltfData.scene.updateMatrixWorld(true);

      // Root inverse — children's matrixWorld relative to gltf.scene root
      const rootInv = new THREE.Matrix4()
        .copy(gltfData.scene.matrixWorld)
        .invert();

      // Merged bounding box in GLB root space (for hitbox sizing)
      const mergedBox = new THREE.Box3();

      gltfData.scene.traverse((child) => {
        if (!child.isMesh) return;

        // Local matrix of this submesh relative to GLB root
        const localMatrix = new THREE.Matrix4().multiplyMatrices(
          rootInv,
          child.matrixWorld
        );

        // Expand bounding box in root space
        const geo = child.geometry;
        if (!geo.boundingBox) geo.computeBoundingBox();
        const localBox = geo.boundingBox.clone().applyMatrix4(localMatrix);
        mergedBox.union(localBox);

        const mat = child.material; // keep original material incl. textures

        const im = new THREE.InstancedMesh(child.geometry, mat, MAX);
        im.count = 0;
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false;
        scene.add(im);
        entries.push({ im, localMatrix });
      });

      if (entries.length === 0) {
        console.warn("cliff-instancer: no meshes in GLB", name);
        return -1;
      }

      // Build invisible hitbox InstancedMesh for easy selection raycasting
      const boxSize = new THREE.Vector3();
      const boxCenter = new THREE.Vector3();
      mergedBox.getSize(boxSize);
      mergedBox.getCenter(boxCenter);

      const hitboxGeo = new THREE.BoxGeometry(boxSize.x, boxSize.y, boxSize.z);
      const hitboxIM = new THREE.InstancedMesh(hitboxGeo, _hitboxMat, MAX);
      hitboxIM.count = 0;
      hitboxIM.frustumCulled = false;
      scene.add(hitboxIM);

      // Translation matrix for the box center offset (applied per instance)
      const boxCenterMatrix = new THREE.Matrix4().makeTranslation(
        boxCenter.x, boxCenter.y, boxCenter.z
      );

      const type = { name, entries, instances: [], hitboxIM, boxCenterMatrix };
      types.push(type);
      activeTypeIdx = types.length - 1;
      return activeTypeIdx;
    },

    setActiveType(idx) {
      if (idx >= 0 && idx < types.length) activeTypeIdx = idx;
    },

    getActiveTypeIdx() { return activeTypeIdx; },

    // ── Place a new instance of the active type at world position ──
    placeAt(px, py, pz) {
      if (types.length === 0) return false;
      const type = types[activeTypeIdx];
      if (type.instances.length >= MAX) return false;

      const inst = {
        px, py, pz,
        rx: 0, ry: Math.round(Math.random() * 360), rz: 0,
        sx: 1, sy: 1, sz: 1,
      };
      const idx = type.instances.length;
      type.instances.push(inst);

      const M = computeInstanceMatrix(inst);
      for (const { im, localMatrix } of type.entries) {
        im.count = type.instances.length;
        _tmp.multiplyMatrices(M, localMatrix);
        im.setMatrixAt(idx, _tmp);
        im.instanceMatrix.needsUpdate = true;
      }
      if (type.hitboxIM) {
        type.hitboxIM.count = type.instances.length;
        _tmp.multiplyMatrices(M, type.boxCenterMatrix);
        type.hitboxIM.setMatrixAt(idx, _tmp);
        type.hitboxIM.instanceMatrix.needsUpdate = true;
        type.hitboxIM.boundingSphere = null;
        type.hitboxIM.boundingBox = null;
      }
      return true;
    },

    // ── Raycast all types using invisible hitboxes — returns closest hit ──
    raycastInstances(raycaster) {
      let best = null;
      let bestDist = Infinity;
      for (let ti = 0; ti < types.length; ti++) {
        const { hitboxIM } = types[ti];
        if (!hitboxIM || hitboxIM.count === 0) continue;
        const hits = raycaster.intersectObject(hitboxIM, false);
        if (hits.length > 0 && hits[0].distance < bestDist) {
          bestDist = hits[0].distance;
          best = { typeIdx: ti, instIdx: hits[0].instanceId };
        }
      }
      return best;
    },

    selectInstance(typeIdx, instIdx) {
      selectedTypeIdx = typeIdx;
      selectedInstIdx = instIdx;
      const inst = types[typeIdx]?.instances[instIdx] ?? null;
      moveMarker(inst);
      if (inst) {
        proxyObj.position.set(inst.px, inst.py, inst.pz);
        proxyObj.rotation.set(inst.rx * DEG, inst.ry * DEG, inst.rz * DEG);
        proxyObj.scale.set(inst.sx, inst.sy, inst.sz);
        proxyObj.updateMatrix();
      }
    },

    // Read back from proxyObj into the selected instance (called on TC change event)
    syncFromProxy() {
      if (selectedTypeIdx < 0 || selectedInstIdx < 0) return;
      const type = types[selectedTypeIdx];
      if (!type) return;
      const inst = type.instances[selectedInstIdx];
      if (!inst) return;
      inst.px = proxyObj.position.x;
      inst.py = proxyObj.position.y;
      inst.pz = proxyObj.position.z;
      inst.rx = proxyObj.rotation.x / DEG;
      inst.ry = proxyObj.rotation.y / DEG;
      inst.rz = proxyObj.rotation.z / DEG;
      inst.sx = proxyObj.scale.x;
      inst.sy = proxyObj.scale.y;
      inst.sz = proxyObj.scale.z;
      setAllMatrices(type, selectedInstIdx);
      moveMarker(inst);
    },

    get proxyObject() { return proxyObj; },

    clearSelection() {
      selectedTypeIdx = -1;
      selectedInstIdx = -1;
      marker.visible = false;
    },

    getSelected() {
      if (selectedTypeIdx < 0 || selectedInstIdx < 0) return null;
      const inst = types[selectedTypeIdx]?.instances[selectedInstIdx];
      if (!inst) return null;
      return { ...inst, typeIdx: selectedTypeIdx, instIdx: selectedInstIdx };
    },

    hasSelection() {
      return selectedTypeIdx >= 0 && selectedInstIdx >= 0;
    },

    updateSelected(patch) {
      if (selectedTypeIdx < 0 || selectedInstIdx < 0) return;
      const type = types[selectedTypeIdx];
      if (!type) return;
      const inst = type.instances[selectedInstIdx];
      if (!inst) return;
      Object.assign(inst, patch);
      setAllMatrices(type, selectedInstIdx);
      moveMarker(inst);
    },

    // ── Delete selected — swap last into deleted slot for O(1) removal ──
    deleteSelected() {
      if (selectedTypeIdx < 0 || selectedInstIdx < 0) return;
      const type = types[selectedTypeIdx];
      if (!type) return;
      const last = type.instances.length - 1;
      if (selectedInstIdx !== last) {
        type.instances[selectedInstIdx] = type.instances[last];
      }
      type.instances.pop();
      rebuildAll(type);
      selectedTypeIdx = -1;
      selectedInstIdx = -1;
      marker.visible = false;
    },

    // ── Override material on all InstancedMeshes of all types ──
    setMaterial(mat) {
      for (const type of types) {
        for (const entry of type.entries) {
          entry.im.material = mat;
        }
      }
    },

    getTypes() {
      return types.map((t, i) => ({
        name: t.name,
        count: t.instances.length,
        idx: i,
      }));
    },

    getTotalCount() {
      return types.reduce((s, t) => s + t.instances.length, 0);
    },

    // Iterate every (geometry, worldMatrix) pair for every instance of every type.
    // Used by bakeBVH to expand instanced cliffs into the merged BVH geometry.
    forEachMeshInstance(cb) {
      const mat = new THREE.Matrix4();
      for (const type of types) {
        for (let i = 0; i < type.instances.length; i++) {
          const M = computeInstanceMatrix(type.instances[i]);
          for (const { im, localMatrix } of type.entries) {
            mat.multiplyMatrices(M, localMatrix);
            cb(im.geometry, mat);
          }
        }
      }
    },

    exportData() {
      return types.map((t) => ({
        name: t.name,
        instances: t.instances.map((i) => ({ ...i })),
      }));
    },

    importData(data) {
      for (const saved of data) {
        const ti = types.findIndex((t) => t.name === saved.name);
        if (ti < 0) continue;
        types[ti].instances = saved.instances.map((i) => ({ ...i }));
        rebuildAll(types[ti]);
      }
    },

    dispose() {
      for (const type of types) {
        for (const { im } of type.entries) scene.remove(im);
        if (type.hitboxIM) scene.remove(type.hitboxIM);
      }
      types.length = 0;
      scene.remove(marker);
      scene.remove(proxyObj);
    },
  };
}
