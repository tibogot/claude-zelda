/**
 * tree-painter7.js
 * Instanced tree placement system for splatmap-painter7stylized.html
 * - Paint mode: scatter trees randomly within brush radius
 * - Erase mode: remove trees within brush radius
 * - Y is always locked to sampleHeight(x, z)
 */

import * as THREE from "three";

const MAX_TREES = 8000;

export function createTreeSystem(scene, sampleHeight) {
  let positions = []; // { x, z, rot, scale }
  let instanceMeshes = []; // one InstancedMesh per GLB mesh part
  const dummy = new THREE.Object3D();

  // ── Load model parts into InstancedMeshes ──────────────────────────────
  function setModel(gltf) {
    // Remove old meshes
    instanceMeshes.forEach((m) => scene.remove(m));
    instanceMeshes = [];

    // Collect all meshes from GLB
    const parts = [];
    gltf.scene.traverse((o) => {
      if (o.isMesh) parts.push(o);
    });

    if (parts.length === 0) return;

    // One InstancedMesh per part
    parts.forEach((part) => {
      // Foliage uses alpha-blend by default, which causes two problems:
      // 1. Water bleeds through leaves (no depth write)
      // 2. Trees behind other trees lose foliage (broken instanced sorting)
      // Fix: convert to alpha-test — pixels are opaque or discarded, no sorting needed.
      let mat = part.material;
      if (mat.transparent || mat.alphaTest > 0) {
        mat = mat.clone();
        mat.transparent = false;
        mat.alphaTest = 0.5;
        mat.depthWrite = true;
      }
      const im = new THREE.InstancedMesh(
        part.geometry,
        mat,
        MAX_TREES,
      );
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = false; // bounding sphere covers only one tree, not all instances
      im.count = 0;
      scene.add(im);
      instanceMeshes.push(im);
    });

    rebuild();
  }

  // ── Rebuild all instance matrices from positions array ─────────────────
  function rebuild() {
    const count = positions.length;
    instanceMeshes.forEach((im) => {
      im.count = count;
      for (let i = 0; i < count; i++) {
        const { x, z, rot, scale } = positions[i];
        const y = sampleHeight(x, z);
        dummy.position.set(x, y, z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
      }
      im.instanceMatrix.needsUpdate = true;
    });
  }

  // ── Add trees randomly within a brush circle ───────────────────────────
  // treesPerStroke: how many attempts per call
  // minSpacing: minimum world-space distance between any two trees
  function addInBrush(cx, cz, radius, treesPerStroke, minSpacing, scaleMin, scaleMax) {
    let added = 0;
    for (let attempt = 0; attempt < treesPerStroke * 4 && added < treesPerStroke; attempt++) {
      // Random point inside circle
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius; // sqrt for uniform distribution
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;

      // Check minimum spacing against all existing trees
      let tooClose = false;
      const minSq = minSpacing * minSpacing;
      for (let i = 0; i < positions.length; i++) {
        const dx = positions[i].x - x;
        const dz = positions[i].z - z;
        if (dx * dx + dz * dz < minSq) { tooClose = true; break; }
      }
      if (tooClose) continue;

      positions.push({
        x, z,
        rot: Math.random() * Math.PI * 2,
        scale: scaleMin + Math.random() * (scaleMax - scaleMin),
      });
      added++;

      if (positions.length >= MAX_TREES) break;
    }
    if (added > 0) rebuild();
    return added;
  }

  // ── Remove all trees within radius ────────────────────────────────────
  function removeInBrush(cx, cz, radius) {
    const rSq = radius * radius;
    const before = positions.length;
    positions = positions.filter(({ x, z }) => {
      const dx = x - cx, dz = z - cz;
      return dx * dx + dz * dz > rSq;
    });
    if (positions.length !== before) rebuild();
  }

  // ── Sync Y positions when terrain is sculpted ─────────────────────────
  function syncHeights() {
    rebuild(); // just re-reads sampleHeight for all positions
  }

  // ── Save / Load ───────────────────────────────────────────────────────
  function getPositions() {
    return positions.map(({ x, z, rot, scale }) => ({ x, z, rot, scale }));
  }

  function setPositions(arr) {
    positions = arr.map(({ x, z, rot, scale }) => ({ x, z, rot, scale }));
    rebuild();
  }

  function clear() {
    positions = [];
    rebuild();
  }

  return { setModel, addInBrush, removeInBrush, syncHeights, getPositions, setPositions, clear };
}
