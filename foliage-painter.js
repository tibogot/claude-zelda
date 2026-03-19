/**
 * foliage-painter.js
 * Generic instanced foliage slot — brush-paint any GLB as instanced mesh.
 * Used by splatmap-painter10bvh+post.html for multi-type foliage mode.
 */

import * as THREE from "three";

const MAX_INSTANCES = 6000;

export function createFoliageSlot(scene, sampleHeight) {
  let positions = []; // { x, z, rot, scale }
  let instanceMeshes = [];
  let _castShadow = false;
  const dummy = new THREE.Object3D();

  // ── Load model parts into InstancedMeshes ─────────────────────────────
  function setModel(gltf) {
    instanceMeshes.forEach((m) => scene.remove(m));
    instanceMeshes = [];

    const parts = [];
    gltf.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
    if (parts.length === 0) return;

    parts.forEach((part) => {
      let mat = part.material;
      if (mat.transparent || mat.alphaTest > 0) {
        mat = mat.clone();
        mat.transparent = false;
        mat.alphaTest = 0.5;
        mat.depthWrite = true;
      }
      const im = new THREE.InstancedMesh(part.geometry, mat, MAX_INSTANCES);
      im.castShadow = _castShadow;
      im.receiveShadow = true;
      im.frustumCulled = false;
      im.count = 0;
      scene.add(im);
      instanceMeshes.push(im);
    });

    rebuild();
  }

  // ── Rebuild all instance matrices ─────────────────────────────────────
  function rebuild() {
    const count = positions.length;
    instanceMeshes.forEach((im) => {
      im.count = count;
      for (let i = 0; i < count; i++) {
        const { x, z, rot, scale } = positions[i];
        dummy.position.set(x, sampleHeight(x, z), z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    });
  }

  // ── Scatter instances randomly within a brush circle ──────────────────
  function addInBrush(cx, cz, radius, perStroke, minSpacing, scaleMin, scaleMax) {
    let added = 0;
    for (let attempt = 0; attempt < perStroke * 4 && added < perStroke; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;

      const minSq = minSpacing * minSpacing;
      let tooClose = false;
      for (let i = 0; i < positions.length; i++) {
        const dx = positions[i].x - x, dz = positions[i].z - z;
        if (dx * dx + dz * dz < minSq) { tooClose = true; break; }
      }
      if (tooClose) continue;

      positions.push({
        x, z,
        rot: Math.random() * Math.PI * 2,
        scale: scaleMin + Math.random() * (scaleMax - scaleMin),
      });
      added++;
      if (positions.length >= MAX_INSTANCES) break;
    }
    if (added > 0) rebuild();
    return added;
  }

  // ── Erase instances within radius ─────────────────────────────────────
  function removeInBrush(cx, cz, radius) {
    const rSq = radius * radius;
    const before = positions.length;
    positions = positions.filter(({ x, z }) => {
      const dx = x - cx, dz = z - cz;
      return dx * dx + dz * dz > rSq;
    });
    if (positions.length !== before) rebuild();
  }

  // ── Snap all instances to current terrain heights ─────────────────────
  function syncHeights() { rebuild(); }

  // ── Toggle shadow casting on all instance meshes ──────────────────────
  function setCastShadow(val) {
    _castShadow = val;
    instanceMeshes.forEach((im) => { im.castShadow = val; });
  }

  // ── Dispose all instance meshes from scene ────────────────────────────
  function dispose() {
    instanceMeshes.forEach((m) => scene.remove(m));
    instanceMeshes = [];
    positions = [];
  }

  // ── Save / Load ───────────────────────────────────────────────────────
  function getPositions() {
    return positions.map(({ x, z, rot, scale }) => ({ x, z, rot, scale }));
  }

  function setPositions(arr) {
    positions = arr.map(({ x, z, rot, scale }) => ({ x, z, rot, scale }));
    rebuild();
  }

  function getCount() { return positions.length; }

  function clear() { positions = []; rebuild(); }

  return { setModel, addInBrush, removeInBrush, syncHeights, setCastShadow, dispose, getPositions, setPositions, getCount, clear };
}
