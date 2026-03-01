/**
 * Scatter: instanced objects from GLBs, configurable slots.
 * createScatter(scene, PARAMS, opts) → { scatterGroup, scatterMeshes, updateScatterPlacement, updateAllScatterLOD, reloadScatterSlot, MAX_SCATTER_PER_TYPE }.
 * PARAMS.scatterSlots: [{ key, label, url, scale, count, castShadow }, ...]
 * Use reloadScatterSlot(key, url) when user changes model (dropdown or file upload).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const MAX_SCATTER_PER_TYPE = 20000;
const SCATTER_CULL_RADIUS = 1.5;

export function createScatter(scene, PARAMS, opts) {
  const {
    sampleHeight,
    setSeed,
    seededRandom,
    TERRAIN_SIZE,
    gltfLoader,
    renderer,
    camera,
  } = opts;

  const scatterGroup = new THREE.Group();
  scene.add(scatterGroup);

  const halfTerrainScatter = TERRAIN_SIZE * 0.48;
  const scatterMeshes = {};
  const scatterInstanceData = {};
  const scatterInstanceCount = {};
  const scatterSeedOffset = {};
  const scatterLodPos = new THREE.Vector3();
  const scatterCullSphere = new THREE.Sphere();

  const slots = PARAMS.scatterSlots || [];
  slots.forEach((slot, i) => {
    scatterSeedOffset[slot.key] = 100 + i;
  });

  function getSlot(key) {
    return slots.find((s) => s.key === key);
  }

  function updateScatterPlacement(key) {
    const data = scatterInstanceData[key];
    const meshes = scatterMeshes[key];
    const slot = getSlot(key);
    if (!data || !meshes || !slot) return;
    const count = Math.min(MAX_SCATTER_PER_TYPE, Math.max(0, slot.count));
    const baseScale = Math.max(0.001, slot.scale);
    const variation = Math.max(0, Math.min(1, PARAMS.scatterScaleVariation));
    const innerR = Math.max(0, PARAMS.scatterInnerRadius);
    setSeed(scatterSeedOffset[key]);
    const mat4 = new THREE.Matrix4();
    let placed = 0;
    for (let i = 0; i < count && placed < count; i++) {
      const tx = (seededRandom() * 2 - 1) * halfTerrainScatter;
      const tz = (seededRandom() * 2 - 1) * halfTerrainScatter;
      if (Math.sqrt(tx * tx + tz * tz) < innerR) continue;
      const ty = sampleHeight(tx, tz);
      const scaleMult = 1 - variation * 0.5 + seededRandom() * variation;
      const scale = baseScale * scaleMult;
      const rotY = seededRandom() * Math.PI * 2;
      mat4
        .identity()
        .makeRotationY(rotY)
        .scale(new THREE.Vector3(scale, scale, scale))
        .setPosition(tx, ty, tz);
      data[placed].copy(mat4);
      placed++;
    }
    scatterInstanceCount[key] = placed;
    if (typeof camera !== "undefined") updateScatterLOD(key, camera, null);
  }

  function updateScatterLOD(key, cam, frustum) {
    const meshes = scatterMeshes[key];
    const data = scatterInstanceData[key];
    const total = scatterInstanceCount[key] ?? 0;
    if (!meshes || !data || total === 0) return;
    const dist = Math.max(1, PARAMS.scatterLodDistance);
    const doCull = PARAMS.scatterCulling && frustum != null;
    scatterCullSphere.radius = SCATTER_CULL_RADIUS;
    const nearList = [];
    const farList = [];
    for (let i = 0; i < total; i++) {
      scatterLodPos.setFromMatrixPosition(data[i]);
      if (doCull) {
        scatterCullSphere.center.copy(scatterLodPos);
        if (!frustum.intersectsSphere(scatterCullSphere)) continue;
      }
      if (cam.position.distanceTo(scatterLodPos) < dist)
        nearList.push(data[i]);
      else farList.push(data[i]);
    }
    const nearIm = meshes.near;
    const farIm = meshes.far;
    for (let i = 0; i < nearList.length; i++)
      nearIm.setMatrixAt(i, nearList[i]);
    nearIm.count = nearList.length;
    nearIm.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < farList.length; i++)
      farIm.setMatrixAt(i, farList[i]);
    farIm.count = farList.length;
    farIm.instanceMatrix.needsUpdate = true;
  }

  function updateAllScatterLOD(cam, frustum) {
    if (!PARAMS.showScatter) return;
    for (const slot of slots) {
      updateScatterLOD(slot.key, cam, frustum);
    }
  }

  function disposeSlot(key) {
    const meshes = scatterMeshes[key];
    if (!meshes) return;
    scatterGroup.remove(meshes.near);
    scatterGroup.remove(meshes.far);
    meshes.near.geometry?.dispose();
    meshes.far.geometry?.dispose();
    const mats = Array.isArray(meshes.near.material)
      ? meshes.near.material
      : [meshes.near.material];
    mats.forEach((m) => m?.dispose?.());
    scatterMeshes[key] = null;
    scatterInstanceData[key] = null;
    scatterInstanceCount[key] = 0;
  }

  function createScatterFromGlb(url, key) {
    if (!url || url.trim() === "") return;
    const slot = getSlot(key);
    if (!slot) return;
    const castShadow =
      slot.castShadow !== undefined ? slot.castShadow : PARAMS.scatterCastShadow;

    gltfLoader.load(
      url,
      (gltf) => {
        const root = gltf.scene;
        const meshList = [];
        root.traverse((o) => {
          if (o.isMesh && o.geometry) meshList.push(o);
        });
        if (meshList.length === 0) {
          console.warn("Scatter GLB has no meshes:", url);
          return;
        }
        const geos = [];
        const mats = [];
        for (const m of meshList) {
          const g = m.geometry.clone();
          g.applyMatrix4(m.matrixWorld);
          geos.push(g);
          const src = m.material;
          const hasAlpha =
            (src && src.alphaMap) ||
            (src && src.transparent) ||
            (src && src.alphaTest != null && src.alphaTest > 0);
          let mat;
          if (hasAlpha && src) {
            // Use original material for foliage — WebGPU auto-converts, preserves alpha
            mat = src.clone();
            const slotCfg = getSlot(key);
            mat.alphaTest = slotCfg && slotCfg.alphaTest != null ? slotCfg.alphaTest : 0.05;
            mat.opacity = slotCfg && slotCfg.opacity != null ? slotCfg.opacity : 1;
            if (mat.side == null) mat.side = THREE.DoubleSide;
          } else {
            mat = new THREE.MeshStandardNodeMaterial({
              color:
                src && src.color
                  ? src.color.getHex
                    ? src.color.getHex()
                    : src.color
                  : 0x6b5d52,
              roughness: src && src.roughness != null ? src.roughness : 0.9,
              metalness: src && src.metalness != null ? src.metalness : 0,
              map: src && src.map ? src.map : null,
              normalMap: src && src.normalMap ? src.normalMap : null,
              normalScale:
                src && src.normalScale
                  ? src.normalScale.clone()
                  : new THREE.Vector2(1, 1),
              roughnessMap: src && src.roughnessMap ? src.roughnessMap : null,
              metalnessMap: src && src.metalnessMap ? src.metalnessMap : null,
              aoMap: src && src.aoMap ? src.aoMap : null,
              aoMapIntensity:
                src && src.aoMapIntensity != null ? src.aoMapIntensity : 1,
            });
          }
          mats.push(mat);
        }
        const geo = mergeGeometries(geos, true);
        geo.computeBoundingSphere();
        const nearIm = new THREE.InstancedMesh(
          geo,
          mats.length === 1 ? mats[0] : mats,
          MAX_SCATTER_PER_TYPE,
        );
        nearIm.castShadow = castShadow;
        nearIm.receiveShadow = true;
        nearIm.frustumCulled = false;
        const farIm = new THREE.InstancedMesh(
          geo,
          mats.length === 1 ? mats[0] : mats,
          MAX_SCATTER_PER_TYPE,
        );
        farIm.castShadow = false;
        farIm.receiveShadow = false;
        farIm.frustumCulled = false;
        scatterMeshes[key] = { near: nearIm, far: farIm };
        scatterInstanceData[key] = Array.from(
          { length: MAX_SCATTER_PER_TYPE },
          () => new THREE.Matrix4(),
        );
        scatterGroup.add(nearIm);
        scatterGroup.add(farIm);
        updateScatterPlacement(key);
        if (renderer && camera)
          renderer.compileAsync(scene, camera).catch(() => {});
      },
      undefined,
      (e) => console.warn("Scatter GLB load failed", url, e),
    );
  }

  function reloadScatterSlot(key, url) {
    const slot = getSlot(key);
    if (!slot) return;
    slot.url = url;
    disposeSlot(key);
    createScatterFromGlb(url, key);
  }

  function updateScatterSlotAlpha(key) {
    const slot = getSlot(key);
    const meshes = scatterMeshes[key];
    if (!slot || !meshes) return;
    const mats = Array.isArray(meshes.near.material)
      ? meshes.near.material
      : [meshes.near.material];
    const alphaTest = slot.alphaTest != null ? slot.alphaTest : 0.05;
    const opacity = slot.opacity != null ? slot.opacity : 1;
    mats.forEach((m) => {
      if (m) {
        m.alphaTest = alphaTest;
        m.opacity = opacity;
      }
    });
  }

  // Initial load for all slots
  for (const slot of slots) {
    createScatterFromGlb(slot.url, slot.key);
  }

  return {
    scatterGroup,
    scatterMeshes,
    updateScatterPlacement,
    updateAllScatterLOD,
    reloadScatterSlot,
    updateScatterSlotAlpha,
    MAX_SCATTER_PER_TYPE,
    scatterSlots: slots,
  };
}
