/**
 * Folio Showcase — Large field of instanced bushes and trees with LOD.
 * Generates many refs, partitions by distance (LOD0 = near, LOD1 = mid, LOD2 = far),
 * creates foliage with decreasing orientations per LOD for perf. Frustum culling off (InstancedMesh bounds would cull whole mesh).
 */
import * as THREE from "three";
import { createFoliage } from "./foliage.js";
import { createTreesFromFolio } from "./trees.js";

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function partitionByDistance(refs, getPosition, lod0Radius, lod1Radius) {
  const lod0 = [];
  const lod1 = [];
  const lod2 = [];
  const origin = new THREE.Vector3(0, 0, 0);
  for (const ref of refs) {
    const pos = getPosition(ref);
    const dist = new THREE.Vector3(pos.x, 0, pos.z).distanceTo(origin);
    if (dist < lod0Radius) lod0.push(ref);
    else if (dist < lod1Radius) lod1.push(ref);
    else lod2.push(ref);
  }
  return { lod0, lod1, lod2 };
}

/**
 * Create a large field of bushes and trees with 3 LOD levels.
 * LOD0 = near (5 orientations), LOD1 = mid (3), LOD2 = far (1). Frustum culling on.
 * @param {THREE.Scene} scene
 * @param {Object} options - terrainMesh, terrainSize, windOffsetNode, foliageTexture, lightDirection,
 *   visualScene (folio oak visual), groundOffset, colorA, colorB, scaleMultiplier, aoStrength, sssStrength, sssColor,
 *   bushCount, treeCount, lod0Radius, lod1Radius
 */
export function createFieldFoliage(scene, options) {
  const {
    terrainMesh,
    terrainSize,
    windOffsetNode,
    foliageTexture,
    lightDirection,
    visualScene,
    groundOffset = 0,
    colorA = "#b4b536",
    colorB = "#d8cf3b",
    scaleMultiplier = 1,
    aoStrength = 0.35,
    sssStrength = 0.25,
    sssColor = "#6b8c3a",
    bushCount = 600,
    treeCount = 300,
    lod0Radius = 55,
    lod1Radius = 115,
  } = options;

  terrainMesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3(0, -1, 0);
  const hit = new THREE.Vector3();
  const half = terrainSize * 0.48;
  const avoidRadiusSq = 18 * 18;

  const bushRng = seededRandom(12345);
  const bushRefs = [];
  for (let i = 0; i < bushCount; i++) {
    const x = (bushRng() * 2 - 1) * half;
    const z = (bushRng() * 2 - 1) * half;
    if (x * x + z * z < avoidRadiusSq) continue;
    rayOrigin.set(x, 1e4, z);
    raycaster.set(rayOrigin, rayDir);
    const isects = raycaster.intersectObject(terrainMesh, false);
    if (isects.length === 0) continue;
    hit.copy(isects[0].point);
    bushRefs.push({
      position: new THREE.Vector3(hit.x, hit.y, hit.z),
      scale: 0.7 + bushRng() * 0.6,
    });
  }

  const treeRng = seededRandom(67890);
  const treeRefs = [];
  for (let i = 0; i < treeCount; i++) {
    const x = (treeRng() * 2 - 1) * half;
    const z = (treeRng() * 2 - 1) * half;
    if (x * x + z * z < avoidRadiusSq) continue;
    const ref = new THREE.Object3D();
    ref.position.set(x, 0, z);
    ref.scale.setScalar(0.85 + treeRng() * 0.4);
    ref.quaternion.setFromEuler(new THREE.Euler(0, treeRng() * Math.PI * 2, 0));
    treeRefs.push(ref);
  }

  const bushLOD = partitionByDistance(
    bushRefs,
    (r) => r.position,
    lod0Radius,
    lod1Radius
  );
  const treeLOD = partitionByDistance(
    treeRefs,
    (r) => r.position,
    lod0Radius,
    lod1Radius
  );

  const foliageOpts = {
    windOffsetNode,
    foliageTexture,
    lightDirection,
    colorA,
    colorB,
    scaleMultiplier,
    aoStrength,
    sssStrength,
    sssColor,
  };

  const bushLOD0 = bushLOD.lod0.length > 0 ? createFoliage(scene, bushLOD.lod0, { ...foliageOpts, orientationsPerInstance: 5 }) : null;
  const bushLOD1 = bushLOD.lod1.length > 0 ? createFoliage(scene, bushLOD.lod1, { ...foliageOpts, orientationsPerInstance: 3 }) : null;
  const bushLOD2 = bushLOD.lod2.length > 0 ? createFoliage(scene, bushLOD.lod2, { ...foliageOpts, orientationsPerInstance: 1 }) : null;

  for (const b of [bushLOD0, bushLOD1, bushLOD2]) {
    if (b?.mesh) b.mesh.frustumCulled = false;
  }

  const treeOpts = {
    visualScene,
    foliageTexture,
    windOffsetNode,
    lightDirection,
    terrainMesh,
    groundOffset,
    colorA,
    colorB,
    scaleMultiplier,
    aoStrength,
    sssStrength,
    sssColor,
  };

  const treesLOD0 = treeLOD.lod0.length > 0 ? createTreesFromFolio(scene, { ...treeOpts, referencesChildren: treeLOD.lod0, orientationsPerInstance: 5 }) : null;
  const treesLOD1 = treeLOD.lod1.length > 0 ? createTreesFromFolio(scene, { ...treeOpts, referencesChildren: treeLOD.lod1, orientationsPerInstance: 3 }) : null;
  const treesLOD2 = treeLOD.lod2.length > 0 ? createTreesFromFolio(scene, { ...treeOpts, referencesChildren: treeLOD.lod2, orientationsPerInstance: 1 }) : null;

  for (const t of [treesLOD0, treesLOD1, treesLOD2]) {
    if (t?.bodies) t.bodies.frustumCulled = false;
    if (t?.leaves?.mesh) t.leaves.mesh.frustumCulled = false;
  }

  return {
    bushLOD0,
    bushLOD1,
    bushLOD2,
    treesLOD0,
    treesLOD1,
    treesLOD2,
    stats: {
      bushes: { lod0: bushLOD.lod0.length, lod1: bushLOD.lod1.length, lod2: bushLOD.lod2.length },
      trees: { lod0: treeLOD.lod0.length, lod1: treeLOD.lod1.length, lod2: treeLOD.lod2.length },
    },
  };
}
