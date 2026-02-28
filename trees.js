/**
 * Trees: instanced pine from GLB, CPU frustum culling, respawn.
 * createTrees(scene, PARAMS, opts) → Promise<{ treesGroup, treeInstancedMeshes, state, respawnTrees, MAX_TREES, updateTreesCulling }>.
 * state = { treeCountActual }. index uses state.treeCountActual and treeInstancedMeshes[0].count for stats.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export function createTrees(scene, PARAMS, opts) {
  const {
    sampleHeight,
    setSeed,
    seededRandom,
    TERRAIN_SIZE,
    renderer,
    camera,
  } = opts;

  const treesGroup = new THREE.Group();
  scene.add(treesGroup);

  const treeInstancedMeshes = [];
  let treeInstanceMatrices = null;
  let treeCompactMatrices = null;
  let treeCullRadius = 4;
  const state = { treeCountActual: 0 };
  const treeLeafMaterials = [];
  const treeFrustumSphere = new THREE.Sphere();
  const treePosition = new THREE.Vector3();
  const treeMatrix = new THREE.Matrix4();

  const MAX_TREES = Math.min(
    16000,
    Math.max(1000, PARAMS.treeCount || 10000),
  );

  const halfTerrain = TERRAIN_SIZE * 0.48;

  function placeTrees(trunkMesh, leafMesh) {
    treeInstanceMatrices = new Float32Array(MAX_TREES * 16);
    treeCompactMatrices = new Float32Array(MAX_TREES * 16);
    setSeed(42);
    let placed = 0;
    for (
      let attempts = 0;
      placed < MAX_TREES && attempts < MAX_TREES * 4;
      attempts++
    ) {
      const tx = (seededRandom() * 2 - 1) * halfTerrain;
      const tz = (seededRandom() * 2 - 1) * halfTerrain;
      if (Math.sqrt(tx * tx + tz * tz) < 20) continue;
      const ty = sampleHeight(tx, tz);
      const scale = (0.85 + seededRandom() * 0.3) * PARAMS.treeScale;
      const rotY = seededRandom() * Math.PI * 2;
      treeMatrix
        .identity()
        .makeRotationY(rotY)
        .scale(new THREE.Vector3(scale, scale, scale))
        .setPosition(tx, ty, tz);
      treeMatrix.toArray(treeInstanceMatrices, placed * 16);
      if (trunkMesh) trunkMesh.setMatrixAt(placed, treeMatrix);
      if (leafMesh) leafMesh.setMatrixAt(placed, treeMatrix);
      placed++;
    }
    state.treeCountActual = placed;
    for (const im of [trunkMesh, leafMesh]) {
      if (!im) continue;
      im.count = state.treeCountActual;
      im.instanceMatrix.needsUpdate = true;
      treesGroup.add(im);
      treeInstancedMeshes.push(im);
    }
  }

  function respawnTrees() {
    if (!treeInstanceMatrices || treeInstancedMeshes.length === 0) return;
    const newCount = Math.min(
      Math.max(100, PARAMS.treeCount | 0),
      MAX_TREES,
    );
    setSeed(42);
    let placed = 0;
    for (
      let attempts = 0;
      placed < newCount && attempts < newCount * 4;
      attempts++
    ) {
      const tx = (seededRandom() * 2 - 1) * halfTerrain;
      const tz = (seededRandom() * 2 - 1) * halfTerrain;
      if (Math.sqrt(tx * tx + tz * tz) < 20) continue;
      const ty = sampleHeight(tx, tz);
      const scale = (0.85 + seededRandom() * 0.3) * PARAMS.treeScale;
      const rotY = seededRandom() * Math.PI * 2;
      treeMatrix
        .identity()
        .makeRotationY(rotY)
        .scale(new THREE.Vector3(scale, scale, scale))
        .setPosition(tx, ty, tz);
      treeMatrix.toArray(treeInstanceMatrices, placed * 16);
      for (const im of treeInstancedMeshes) im.setMatrixAt(placed, treeMatrix);
      placed++;
    }
    state.treeCountActual = placed;
    treeCompactMatrices.set(
      treeInstanceMatrices.subarray(0, state.treeCountActual * 16),
    );
    for (const im of treeInstancedMeshes) {
      im.count = state.treeCountActual;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  function updateTreesCulling(charPos, frustum) {
    if (
      !PARAMS.showTrees ||
      treeInstancedMeshes.length === 0 ||
      treeInstanceMatrices == null
    )
      return;
    let visibleCount = 0;
    if (PARAMS.treeCulling) {
      const shadowDist2 = 80 * 80;
      for (let i = 0; i < state.treeCountActual; i++) {
        const o = i * 16;
        treePosition.set(
          treeInstanceMatrices[o + 12],
          treeInstanceMatrices[o + 13],
          treeInstanceMatrices[o + 14],
        );
        const dx = treePosition.x - charPos.x;
        const dz = treePosition.z - charPos.z;
        const inShadowRange = dx * dx + dz * dz < shadowDist2;
        treeFrustumSphere.center.copy(treePosition);
        treeFrustumSphere.radius = treeCullRadius;
        if (
          inShadowRange ||
          frustum.intersectsSphere(treeFrustumSphere)
        ) {
          for (let j = 0; j < 16; j++)
            treeCompactMatrices[visibleCount * 16 + j] =
              treeInstanceMatrices[o + j];
          visibleCount++;
        }
      }
    } else {
      treeCompactMatrices.set(
        treeInstanceMatrices.subarray(0, state.treeCountActual * 16),
      );
      visibleCount = state.treeCountActual;
    }
    for (const im of treeInstancedMeshes) {
      im.instanceMatrix.array.set(
        treeCompactMatrices.subarray(0, visibleCount * 16),
      );
      im.count = visibleCount;
      im.instanceMatrix.needsUpdate = true;
    }
  }

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
  );
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  return new Promise((resolve, reject) => {
    gltfLoader.load(
      "models/pine-transformed.glb",
      (gltf) => {
        const root = gltf.scene;
        const leafGeos = [],
          leafMats = [];
        const trunkGeos = [],
          trunkMats = [];

        root.traverse((o) => {
          if (!o.isMesh || !o.geometry) return;
          const g = o.geometry.clone();
          g.applyMatrix4(o.matrixWorld);
          const m = o.material;
          let nodeMat;
          let isLeafMaterial = false;
          if (m) {
            const isTransparent = m.transparent === true;
            const hasMap = !!m.map;
            const isDoubleSide = m.side === THREE.DoubleSide;
            const hasAlphaTest = m.alphaTest != null && m.alphaTest > 0;
            const meshName = (o.name || "").toLowerCase();
            const matName = (m.name || "").toLowerCase();
            const isLeafByName =
              /leaf|leave|foliage|canopy|frond|branch/i.test(
                meshName + " " + matName,
              );
            isLeafMaterial =
              isTransparent ||
              isLeafByName ||
              (hasMap && (isDoubleSide || hasAlphaTest));
            nodeMat = new THREE.MeshStandardNodeMaterial({
              color:
                m.color && m.color.getHex ? m.color.getHex() : 0x888888,
              roughness: m.roughness != null ? m.roughness : 0.7,
              metalness: m.metalness != null ? m.metalness : 0,
              map: m.map || null,
              normalMap: m.normalMap || null,
              transparent: isLeafMaterial,
              alphaTest: isLeafMaterial
                ? PARAMS.treeAlphaTest
                : m.alphaTest != null
                  ? m.alphaTest
                  : 0,
              opacity: isLeafMaterial
                ? PARAMS.treeOpacity
                : m.opacity != null
                  ? m.opacity
                  : 1,
              side:
                isLeafMaterial || isDoubleSide
                  ? THREE.DoubleSide
                  : m.side != null
                    ? m.side
                    : THREE.FrontSide,
              depthWrite: isLeafMaterial ? PARAMS.treeDepthWrite : true,
            });
            if (isLeafMaterial) treeLeafMaterials.push(nodeMat);
          } else {
            nodeMat = new THREE.MeshStandardNodeMaterial({
              color: 0x2d6b1a,
              roughness: 0.7,
            });
          }
          if (isLeafMaterial) {
            leafGeos.push(g);
            leafMats.push(nodeMat);
          } else {
            trunkGeos.push(g);
            trunkMats.push(nodeMat);
          }
        });

        if (leafGeos.length === 0 && trunkGeos.length === 0) {
          console.warn("pine-transformed.glb: no meshes");
          resolve({
            treesGroup,
            treeInstancedMeshes,
            state,
            respawnTrees,
            MAX_TREES,
            updateTreesCulling,
            treeLeafMaterials,
          });
          return;
        }

        const makeInstanced = (geos, mats) => {
          if (geos.length === 0) return null;
          const geo = mergeGeometries(geos, true);
          geo.computeBoundingSphere();
          const radius = geo.boundingSphere ? geo.boundingSphere.radius : 4;
          if (radius > treeCullRadius) treeCullRadius = radius;
          const im = new THREE.InstancedMesh(
            geo,
            mats.length === 1 ? mats[0] : mats,
            MAX_TREES,
          );
          im.castShadow = true;
          im.receiveShadow = false;
          im.frustumCulled = false;
          return im;
        };

        const trunkMesh = makeInstanced(trunkGeos, trunkMats);
        const leafMesh = makeInstanced(leafGeos, leafMats);
        placeTrees(trunkMesh, leafMesh);

        if (renderer && camera)
          renderer.compileAsync(scene, camera).catch(() => {});

        resolve({
          treesGroup,
          treeInstancedMeshes,
          state,
          respawnTrees,
          MAX_TREES,
          updateTreesCulling,
          treeLeafMaterials,
        });
      },
      undefined,
      (e) => {
        console.warn("pine-transformed.glb load failed", e);
        resolve({
          treesGroup,
          treeInstancedMeshes,
          state,
          respawnTrees,
          MAX_TREES,
          updateTreesCulling,
          treeLeafMaterials,
        });
      },
    );
  });
}
