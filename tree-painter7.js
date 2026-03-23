/**
 * tree-painter7.js
 * Instanced tree placement system for splatmap-painter7stylized.html
 * - Paint mode: scatter trees randomly within brush radius
 * - Erase mode: remove trees within brush radius
 * - Y is always locked to sampleHeight(x, z)
 * - Chunk-based InstancedMesh: world divided into CHUNK_SIZE×CHUNK_SIZE cells,
 *   each chunk gets its own InstancedMesh with frustumCulled=true so Three.js
 *   automatically skips draw calls for chunks outside the camera frustum.
 */

import * as THREE from "three";

const MAX_TREES = 8000;
const CHUNK_SIZE = 64; // world-units per chunk side

export function createTreeSystem(scene, sampleHeight) {
  let positions = []; // { x, z, rot, scale }
  let meshParts  = []; // [{ geometry, material }] — shared across chunks
  const dummy    = new THREE.Object3D();

  // chunks: Map<"cx,cz", { ims: InstancedMesh[], capacity: number }>
  const chunks = new Map();

  // ── helpers ───────────────────────────────────────────────────────────
  function chunkKey(cx, cz) { return `${cx},${cz}`; }
  function posToChunk(x, z) {
    return { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) };
  }

  function makeChunkIMs(capacity) {
    return meshParts.map(({ geometry, material }) => {
      const im = new THREE.InstancedMesh(geometry, material, capacity);
      im.castShadow = true;
      im.receiveShadow = true;
      im.frustumCulled = true; // Three.js culls this chunk when outside camera frustum
      im.count = 0;
      scene.add(im);
      return im;
    });
  }

  // ── Load model parts into shared geometry/material refs ───────────────
  function setModel(gltf) {
    // Remove all existing chunk meshes
    for (const chunk of chunks.values()) chunk.ims.forEach(im => scene.remove(im));
    chunks.clear();
    meshParts = [];

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
      meshParts.push({ geometry: part.geometry, material: mat });
    });

    rebuild();
  }

  // ── Rebuild chunk InstancedMeshes from positions array ────────────────
  function rebuild() {
    if (meshParts.length === 0) return;

    // Group position indices by chunk
    const chunkGroups = new Map(); // key -> number[]
    positions.forEach((pos, idx) => {
      const { cx, cz } = posToChunk(pos.x, pos.z);
      const key = chunkKey(cx, cz);
      if (!chunkGroups.has(key)) chunkGroups.set(key, []);
      chunkGroups.get(key).push(idx);
    });

    // Remove chunks that no longer have any trees
    for (const key of [...chunks.keys()]) {
      if (!chunkGroups.has(key)) {
        chunks.get(key).ims.forEach(im => scene.remove(im));
        chunks.delete(key);
      }
    }

    // Update or create each occupied chunk
    for (const [key, posIndices] of chunkGroups) {
      const count = posIndices.length;
      let chunk = chunks.get(key);

      if (!chunk || count > chunk.capacity) {
        // Create (or recreate with larger capacity)
        if (chunk) chunk.ims.forEach(im => scene.remove(im));
        const capacity = count + 64;
        const ims = makeChunkIMs(capacity);
        chunk = { ims, capacity };
        chunks.set(key, chunk);
      }

      // Write matrices
      chunk.ims.forEach(im => { im.count = count; });
      for (let i = 0; i < count; i++) {
        const { x, z, rot, scale } = positions[posIndices[i]];
        dummy.position.set(x, sampleHeight(x, z), z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        chunk.ims.forEach(im => im.setMatrixAt(i, dummy.matrix));
      }

      // Finalize — computeBoundingSphere gives a tight sphere per chunk so
      // Three.js frustum-culling works correctly at chunk granularity
      chunk.ims.forEach(im => {
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      });
    }
  }

  // ── Add trees randomly within a brush circle ───────────────────────────
  function addInBrush(cx, cz, radius, treesPerStroke, minSpacing, scaleMin, scaleMax) {
    let added = 0;
    for (let attempt = 0; attempt < treesPerStroke * 4 && added < treesPerStroke; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;

      let tooClose = false;
      const minSq = minSpacing * minSpacing;
      for (let i = 0; i < positions.length; i++) {
        const dx = positions[i].x - x;
        const dz = positions[i].z - z;
        if (dx * dx + dz * dz < minSq) { tooClose = true; break; }
      }
      if (tooClose) continue;

      positions.push({ x, z, rot: Math.random() * Math.PI * 2, scale: scaleMin + Math.random() * (scaleMax - scaleMin) });
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
  function syncHeights() { rebuild(); }

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
