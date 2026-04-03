/**
 * foliage-painter.js
 * Generic instanced foliage slot — brush-paint any GLB as instanced mesh.
 * Used by splatmap-painter10bvh+post.html for multi-type foliage mode.
 * - Chunk-based InstancedMesh: world divided into CHUNK_SIZE×CHUNK_SIZE cells,
 *   each chunk gets its own InstancedMesh with frustumCulled=true so Three.js
 *   automatically skips draw calls for chunks outside the camera frustum.
 * - Optional per-slot wind animation + player interaction via TSL positionNode.
 */

import * as THREE from "three";
import {
  Fn, float, vec3, vec4, add, mul, sub, sin, cos, max, negate,
  length, smoothstep, mix, abs, div,
  positionLocal, modelWorldMatrix, modelWorldMatrixInverse,
  instanceIndex, uniform,
} from "three/tsl";

const MAX_INSTANCES = 12000;
const CHUNK_SIZE = 64; // world-units per chunk side

/**
 * @param {THREE.Scene} scene
 * @param {(x:number,z:number)=>number} sampleHeight
 * @param {object} [windConfig] - Optional wind/interaction config:
 *   { windDir, windSpeed, windStr, interactionRange, interactionStrength, interactionHThresh }
 */
export function createFoliageSlot(scene, sampleHeight, windConfig) {
  let positions  = []; // { x, z, rot, scale }
  let meshParts  = []; // [{ geometry, material }] — shared across chunks
  let _castShadow = false;
  const dummy    = new THREE.Object3D();

  // ── Wind uniforms & positionNode (only when windConfig is provided) ────
  let _windUniforms = null;
  let _windPosNode  = null;

  if (windConfig) {
    const wDir  = (windConfig.windDir ?? 0.7) * Math.PI;
    const wSpd  = windConfig.windSpeed ?? 1.2;
    const wStr  = (windConfig.windStr ?? 0.15) * 0.25;
    const iRng  = windConfig.interactionRange    ?? 2.5;
    const iStr  = windConfig.interactionStrength  ?? 1.5;
    const iHTh  = windConfig.interactionHThresh   ?? 2.0;

    _windUniforms = {
      uTime:      uniform(0),
      uPlayerPos: uniform(new THREE.Vector3(9999, 0, 9999)),
      uWindDir:   uniform(wDir),
      uWindSpeed: uniform(wSpd),
      uWindStr:   uniform(wStr),
      uIRange:    uniform(iRng),
      uIStr:      uniform(iStr),
      uIHTh:      uniform(iHTh),
    };

    const u = _windUniforms;
    _windPosNode = Fn(() => {
      const phase = add(mul(u.uTime, u.uWindSpeed), mul(instanceIndex.toFloat(), 1.2), u.uWindDir);
      const heightPct = mul(max(float(0), positionLocal.y), max(float(0), positionLocal.y));
      const bend  = mul(sin(phase), u.uWindStr, heightPct);
      const micro = mul(sin(add(mul(phase, 2.3), instanceIndex.toFloat())), 0.06, u.uWindStr, heightPct);
      const windAmount = add(bend, micro);
      let pos = add(positionLocal, vec3(mul(cos(u.uWindDir), windAmount), float(0), mul(sin(u.uWindDir), windAmount)));

      const baseWorld = modelWorldMatrix.mul(vec4(float(0), float(0), float(0), float(1))).xyz;
      const playerXZ  = u.uPlayerPos.xz;
      const pDist     = length(sub(baseWorld.xz, playerXZ));
      const pHD       = abs(sub(baseWorld.y, u.uPlayerPos.y));
      const distFall  = mix(float(1), float(0), smoothstep(float(0.5), u.uIRange, pDist));
      const hFall     = smoothstep(u.uIHTh, float(0), pHD);
      const pFall     = mul(distFall, hFall);
      const diffXZ    = sub(vec3(baseWorld.x, float(0), baseWorld.z), vec3(playerXZ.x, float(0), playerXZ.y));
      const len       = max(length(diffXZ), 0.001);
      const pTo       = mul(diffXZ, div(float(1), len));
      const pushAmt   = mul(negate(mul(u.uIStr, pFall)), heightPct);
      const dispWorld = mul(pTo, pushAmt);
      const dispLocal = modelWorldMatrixInverse.mul(vec4(dispWorld, float(0))).xyz;
      pos = add(pos, dispLocal);

      return pos;
    })();
  }

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
      im.castShadow = _castShadow;
      im.receiveShadow = true;
      im.frustumCulled = true; // Three.js culls this chunk when outside camera frustum
      im.count = 0;
      scene.add(im);
      return im;
    });
  }

  // ── Load model parts into shared geometry/material refs ───────────────
  function setModel(gltf) {
    for (const chunk of chunks.values()) chunk.ims.forEach(im => scene.remove(im));
    chunks.clear();
    meshParts = [];

    const parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
    if (parts.length === 0) return;

    parts.forEach((part) => {
      const src = part.material;
      let mat;
      if (_windPosNode) {
        mat = new THREE.MeshStandardNodeMaterial({
          color:     src.color?.clone()  ?? new THREE.Color(0x4a6b3a),
          map:       src.map            ?? null,
          normalMap: src.normalMap       ?? null,
          roughness: src.roughness       ?? 0.9,
          metalness: src.metalness       ?? 0,
          roughnessMap: src.roughnessMap ?? null,
          metalnessMap: src.metalnessMap ?? null,
          emissive:  src.emissive?.clone() ?? new THREE.Color(0),
          emissiveMap: src.emissiveMap   ?? null,
          emissiveIntensity: src.emissiveIntensity ?? 1,
          side:      src.side           ?? THREE.FrontSide,
          depthWrite: true,
        });
        if (src.transparent || (src.alphaTest != null && src.alphaTest > 0)) {
          mat.alphaTest = 0.5;
          mat.alphaMap  = src.alphaMap ?? null;
          if (src.map && !src.alphaMap) mat.alphaTest = 0.5;
        }
        if (src.normalScale) mat.normalScale = src.normalScale.clone();
        mat.positionNode = _windPosNode;
      } else {
        mat = src;
        if (mat.transparent || mat.alphaTest > 0) {
          mat = mat.clone();
          mat.transparent = false;
          mat.alphaTest = 0.5;
          mat.depthWrite = true;
        }
      }
      const geo = part.geometry.clone();
      geo.applyMatrix4(part.matrixWorld);
      meshParts.push({ geometry: geo, material: mat });
    });

    rebuild();
  }

  // ── Rebuild chunk InstancedMeshes from positions array ────────────────
  function rebuild() {
    if (meshParts.length === 0) return;

    // Group position indices by chunk
    const chunkGroups = new Map();
    positions.forEach((pos, idx) => {
      const { cx, cz } = posToChunk(pos.x, pos.z);
      const key = chunkKey(cx, cz);
      if (!chunkGroups.has(key)) chunkGroups.set(key, []);
      chunkGroups.get(key).push(idx);
    });

    // Remove chunks that no longer have any instances
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
        if (chunk) chunk.ims.forEach(im => scene.remove(im));
        const capacity = count + 64;
        const ims = makeChunkIMs(capacity);
        chunk = { ims, capacity };
        chunks.set(key, chunk);
      }

      chunk.ims.forEach(im => { im.count = count; });
      for (let i = 0; i < count; i++) {
        const { x, z, rot, scale } = positions[posIndices[i]];
        dummy.position.set(x, sampleHeight(x, z), z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        chunk.ims.forEach(im => im.setMatrixAt(i, dummy.matrix));
      }

      chunk.ims.forEach(im => {
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      });
    }
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

      positions.push({ x, z, rot: Math.random() * Math.PI * 2, scale: scaleMin + Math.random() * (scaleMax - scaleMin) });
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

  // ── Toggle shadow casting on all chunk meshes ─────────────────────────
  function setCastShadow(val) {
    _castShadow = val;
    for (const chunk of chunks.values()) chunk.ims.forEach(im => { im.castShadow = val; });
  }

  // ── Dispose all chunk meshes from scene ───────────────────────────────
  function dispose() {
    for (const chunk of chunks.values()) chunk.ims.forEach(im => scene.remove(im));
    chunks.clear();
    meshParts = [];
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

  // ── Chunk visibility stats for debug overlay ──────────────────────────
  const _frustum = new THREE.Frustum();
  const _projScreenMatrix = new THREE.Matrix4();

  function getChunkStats(camera) {
    if (chunks.size === 0) return { visible: 0, total: 0 };
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    let visible = 0;
    for (const chunk of chunks.values()) {
      const im = chunk.ims[0];
      if (!im || im.count === 0) continue;
      if (im.boundingSphere && _frustum.intersectsSphere(im.boundingSphere)) visible++;
    }
    return { visible, total: chunks.size };
  }

  function update(elapsed, playerWorldPos) {
    if (!_windUniforms) return;
    _windUniforms.uTime.value = elapsed;
    if (playerWorldPos) _windUniforms.uPlayerPos.value.copy(playerWorldPos);
  }

  return { setModel, addInBrush, removeInBrush, syncHeights, setCastShadow, dispose, getPositions, setPositions, getCount, clear, getChunkStats, update };
}
