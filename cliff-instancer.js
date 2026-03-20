/**
 * cliff-instancer.js — Instanced cliff/rock placement system.
 * One draw call per submesh per loaded GLB, regardless of instance count.
 *
 * Correctly handles multi-mesh GLBs: each submesh keeps its local offset
 * matrix (relative to the GLB root), and instance matrices are composed as
 *   finalMatrix = instanceTransform * submeshLocalMatrix
 * This matches exactly what Place mode does when it adds gltf.scene to the scene.
 */

import * as THREE from "three";

const DEG = Math.PI / 180;
const _tmp = new THREE.Matrix4();

export function createCliffInstancer(scene, options = {}) {
  const MAX = options.maxInstances ?? 500;

  /**
   * types[i] = {
   *   name: string,
   *   entries: [{ im: InstancedMesh, localMatrix: Matrix4 }],
   *   instances: [{ px,py,pz, rx,ry,rz, sx,sy,sz }]
   * }
   */
  const types = [];
  let activeTypeIdx = 0;
  let selectedTypeIdx = -1;
  let selectedInstIdx = -1;

  const dummy = new THREE.Object3D();

  // Proxy Object3D that TransformControls can attach to for the selected instance.
  // Position/rotation/scale always reflect the selected instance in world space.
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

      gltfData.scene.traverse((child) => {
        if (!child.isMesh) return;

        // Local matrix of this submesh relative to GLB root (preserves all
        // parent-chain offsets, rotations, scales from the GLB hierarchy).
        const localMatrix = new THREE.Matrix4().multiplyMatrices(
          rootInv,
          child.matrixWorld
        );

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

      const type = { name, entries, instances: [] };
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
      return true;
    },

    // ── Raycast all types, return closest hit ──
    raycastInstances(raycaster) {
      let best = null;
      let bestDist = Infinity;
      for (let ti = 0; ti < types.length; ti++) {
        for (const { im } of types[ti].entries) {
          if (im.count === 0) continue;
          const hits = raycaster.intersectObject(im, false);
          if (hits.length > 0 && hits[0].distance < bestDist) {
            bestDist = hits[0].distance;
            best = { typeIdx: ti, instIdx: hits[0].instanceId };
          }
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
        for (const { im } of type.entries) {
          scene.remove(im);
        }
      }
      types.length = 0;
      scene.remove(marker);
    },
  };
}
