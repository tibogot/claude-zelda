/**
 * Scatter: instanced rocks/flowers from GLBs, near/far LOD, placement + culling.
 * createScatter(scene, PARAMS, opts) → { scatterGroup, scatterMeshes, updateScatterPlacement, updateAllScatterLOD, MAX_SCATTER_PER_TYPE, MAX_SCATTER_FLOWERS }.
 * scatterMeshes keys are filled async as GLBs load. Index calls updateAllScatterLOD(camera, frustum) each frame when showScatter.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const MAX_SCATTER_PER_TYPE = 4000;
const MAX_SCATTER_FLOWERS = 20000;
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
  const scatterMeshes = { boulder: null, gameAsset: null, flower: null };
  const scatterInstanceData = {
    boulder: null,
    gameAsset: null,
    flower: null,
  };
  const scatterInstanceCount = { boulder: 0, gameAsset: 0, flower: 0 };
  const scatterSeedOffset = { boulder: 100, gameAsset: 101, flower: 102 };
  const scatterLodPos = new THREE.Vector3();
  const scatterCullSphere = new THREE.Sphere();

  function updateScatterPlacement(key) {
    const data = scatterInstanceData[key];
    const meshes = scatterMeshes[key];
    if (!data || !meshes) return;
    const maxCount =
      key === "flower" ? MAX_SCATTER_FLOWERS : MAX_SCATTER_PER_TYPE;
    const count = Math.min(
      maxCount,
      Math.max(
        0,
        key === "boulder"
          ? PARAMS.scatterBoulderCount
          : key === "gameAsset"
            ? PARAMS.scatterGameAssetCount
            : PARAMS.scatterFlowerCount,
      ),
    );
    const baseScale =
      key === "boulder"
        ? PARAMS.scatterBoulderScale
        : key === "gameAsset"
          ? PARAMS.scatterGameAssetScale
          : PARAMS.scatterFlowerScale;
    const variation = Math.max(
      0,
      Math.min(1, PARAMS.scatterScaleVariation),
    );
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
    if (typeof camera !== "undefined")
      updateScatterLOD(key, camera, null);
  }

  function updateScatterLOD(key, cam, frustum) {
    const meshes = scatterMeshes[key];
    const data = scatterInstanceData[key];
    const total = scatterInstanceCount[key];
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
    updateScatterLOD("boulder", cam, frustum);
    updateScatterLOD("gameAsset", cam, frustum);
    updateScatterLOD("flower", cam, frustum);
  }

  function createScatterFromGlb(url, key) {
    gltfLoader.load(
      url,
      (gltf) => {
        const root = gltf.scene;
        const meshes = [];
        root.traverse((o) => {
          if (o.isMesh && o.geometry) meshes.push(o);
        });
        if (meshes.length === 0) {
          console.warn("Scatter GLB has no meshes:", url);
          return;
        }
        const geos = [];
        const mats = [];
        for (const m of meshes) {
          const g = m.geometry.clone();
          g.applyMatrix4(m.matrixWorld);
          geos.push(g);
          const src = m.material;
          const nodeMat = new THREE.MeshStandardNodeMaterial({
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
          mats.push(nodeMat);
        }
        const geo = mergeGeometries(geos, true);
        geo.computeBoundingSphere();
        const maxCount =
          key === "flower" ? MAX_SCATTER_FLOWERS : MAX_SCATTER_PER_TYPE;
        const castShadow = key !== "flower" && PARAMS.scatterCastShadow;
        const nearIm = new THREE.InstancedMesh(
          geo,
          mats.length === 1 ? mats[0] : mats,
          maxCount,
        );
        nearIm.castShadow = castShadow;
        nearIm.receiveShadow = true;
        nearIm.frustumCulled = false;
        const farIm = new THREE.InstancedMesh(
          geo,
          mats.length === 1 ? mats[0] : mats,
          maxCount,
        );
        farIm.castShadow = false;
        farIm.receiveShadow = false;
        farIm.frustumCulled = false;
        scatterMeshes[key] = { near: nearIm, far: farIm };
        scatterInstanceData[key] = Array.from(
          { length: maxCount },
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

  createScatterFromGlb("models/rock_boulder.glb", "boulder");
  createScatterFromGlb("models/rock__game_asset.glb", "gameAsset");
  createScatterFromGlb("models/low_poly_flower-transformed.glb", "flower");

  return {
    scatterGroup,
    scatterMeshes,
    updateScatterPlacement,
    updateAllScatterLOD,
    MAX_SCATTER_PER_TYPE,
    MAX_SCATTER_FLOWERS,
  };
}
