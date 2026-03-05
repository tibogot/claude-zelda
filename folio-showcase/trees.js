/**
 * Folio Showcase — Trees (same as Bruno Simon folio 2025).
 * Uses folio oak tree GLB: trunk as InstancedMesh, leaves as Foliage (same SDF + wind).
 */
import * as THREE from "three";
import { color, Fn, positionGeometry, smoothstep, float, uniform, mix } from "three/tsl";
import { createFoliage } from "./foliage.js";

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * Create trees from folio visual + references GLBs (exact same as folio).
 * Optionally project onto terrain so bases sit on the ground (with a small offset).
 * @param {THREE.Scene} scene
 * @param {{
 *   visualScene: THREE.Group,
 *   referencesChildren: THREE.Object3D[],
 *   foliageTexture: THREE.Texture,
 *   windOffsetNode: (pos: any) => any,
 *   lightDirection: THREE.Vector3,
 *   camera: THREE.Camera,
 *   terrainMesh?: THREE.Mesh,
 *   groundOffset?: number,
 *   colorA?: string,
 *   colorB?: string,
 * }} options
 * @returns {{ bodies: THREE.InstancedMesh, leaves: { mesh: THREE.InstancedMesh, updateMatrices: (c: THREE.Camera) => void } }}
 */
export function createTreesFromFolio(scene, options) {
  const {
    visualScene,
    referencesChildren,
    foliageTexture,
    windOffsetNode,
    lightDirection,
    camera,
    terrainMesh,
    groundOffset = 0,
    colorA = "#b4b536",
    colorB = "#d8cf3b",
    orientationsPerInstance,
    scaleMultiplier,
    aoStrength,
    sssStrength,
    sssColor,
    seeThrough = false,
    colorVariationStrength,
    conditionalDepthEnabled,
    depthFadeNear,
    depthFadeFar,
    baseContactStrength,
    alphaThreshold,
    alphaTest,
    leafShapeVariation,
  } = options;

  const modelParts = { leaves: [], body: null };
  visualScene.traverse((child) => {
    if (!child.isMesh) return;
    if (child.name.startsWith("treeLeaves")) modelParts.leaves.push(child);
    else if (child.name.startsWith("treeBody")) modelParts.body = child;
  });

  if (!modelParts.body) {
    console.warn("Folio trees: no treeBody mesh found");
    return { bodies: null, leaves: null };
  }

  const references = referencesChildren;
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3(0, -1, 0);
  const hit = new THREE.Vector3();

  if (terrainMesh) terrainMesh.updateMatrixWorld(true);

  const adjustedRefs = references.map((ref) => {
    const obj = new THREE.Object3D();
    obj.position.copy(ref.position);
    obj.quaternion.copy(ref.quaternion);
    obj.scale.copy(ref.scale);
    if (terrainMesh) {
      rayOrigin.set(ref.position.x, 1e4, ref.position.z);
      raycaster.set(rayOrigin, rayDir);
      const isects = raycaster.intersectObject(terrainMesh, false);
      if (isects.length > 0) {
        hit.copy(isects[0].point);
        obj.position.y = hit.y + groundOffset;
      }
    }
    obj.updateMatrix();
    return obj;
  });

  const bodyGeometry = modelParts.body.geometry;
  bodyGeometry.computeBoundingBox();
  const bbox = bodyGeometry.boundingBox;
  const extentY = bbox.max.y - bbox.min.y;
  const extentZ = bbox.max.z - bbox.min.z;
  const extentX = bbox.max.x - bbox.min.x;
  const useY = extentY >= extentZ && extentY >= extentX;
  const useZ = extentZ >= extentY && extentZ >= extentX;
  const trunkMin = useZ ? bbox.min.z : bbox.min.y;
  const trunkHeight = useZ ? extentZ : extentY;
  const trunkBaseAoStrength = uniform(options.trunkBaseAoStrength ?? 0.5);
  const trunkBaseAoRange = 0.4;
  const bodyMaterial = new THREE.MeshStandardNodeMaterial({
    colorNode: Fn(() => {
      const baseCol = color(0.45, 0.3, 0.2);
      const alongTrunk = useZ ? positionGeometry.z : positionGeometry.y;
      const baseContactBlend = smoothstep(
        float(trunkMin),
        float(trunkMin + trunkHeight * trunkBaseAoRange),
        alongTrunk
      );
      return mix(baseCol.mul(float(1).sub(trunkBaseAoStrength)), baseCol, baseContactBlend);
    })(),
    roughness: 0.9,
    metalness: 0.05,
  });

  const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, adjustedRefs.length);
  bodies.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  for (let i = 0; i < adjustedRefs.length; i++) {
    bodies.setMatrixAt(i, adjustedRefs[i].matrix);
  }
  bodies.instanceMatrix.needsUpdate = true;
  scene.add(bodies);

  const leafReferences = [];
  for (const treeRef of adjustedRefs) {
    treeRef.updateMatrixWorld(true);
    for (const leaves of modelParts.leaves) {
      const finalMatrix = leaves.matrix.clone().premultiply(treeRef.matrixWorld);
      const ref = new THREE.Object3D();
      ref.applyMatrix4(finalMatrix);
      leafReferences.push(ref);
    }
  }

  if (leafReferences.length === 0) {
    return { bodies, leaves: null, trunkBaseAoStrengthUniform: trunkBaseAoStrength };
  }

  const leavesResult = createFoliage(scene, leafReferences, {
    windOffsetNode,
    foliageTexture,
    lightDirection,
    colorA,
    colorB,
    orientationsPerInstance,
    scaleMultiplier,
    aoStrength,
    sssStrength,
    sssColor,
    seeThrough,
    colorVariationStrength,
    conditionalDepthEnabled,
    depthFadeNear,
    depthFadeFar,
    baseContactStrength,
    alphaThreshold,
    alphaTest,
    leafShapeVariation,
  });

  return { bodies, leaves: leavesResult, trunkBaseAoStrengthUniform: trunkBaseAoStrength };
}

/**
 * Create large trees: same trunk + foliage style as folio, but 2x scale and more leaf clusters per tree.
 * Pass a subset of references (e.g. first N) so regular and large trees don't overlap.
 */
export function createLargeTreesFromFolio(scene, options) {
  const {
    visualScene,
    referencesChildren,
    foliageTexture,
    windOffsetNode,
    lightDirection,
    terrainMesh,
    groundOffset = 0,
    colorA = "#8fa835",
    colorB = "#b8c94e",
    orientationsPerInstance,
    scaleMultiplier,
    aoStrength,
    sssStrength,
    sssColor,
    seeThrough = false,
    colorVariationStrength,
    conditionalDepthEnabled,
    depthFadeNear,
    depthFadeFar,
    baseContactStrength,
    alphaThreshold,
    alphaTest,
    leafShapeVariation,
    largeTreeScale = 2,
    leafDensityMultiplier = 2,
  } = options;

  const modelParts = { leaves: [], body: null };
  visualScene.traverse((child) => {
    if (!child.isMesh) return;
    if (child.name.startsWith("treeLeaves")) modelParts.leaves.push(child);
    else if (child.name.startsWith("treeBody")) modelParts.body = child;
  });

  if (!modelParts.body) {
    console.warn("Folio large trees: no treeBody mesh found");
    return { bodies: null, leaves: null };
  }

  const references = referencesChildren;
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDir = new THREE.Vector3(0, -1, 0);
  const hit = new THREE.Vector3();
  const rng = seededRandom(9999);

  if (terrainMesh) terrainMesh.updateMatrixWorld(true);

  const adjustedRefs = references.map((ref) => {
    const obj = new THREE.Object3D();
    obj.position.copy(ref.position);
    obj.quaternion.copy(ref.quaternion);
    obj.scale.copy(ref.scale).multiplyScalar(largeTreeScale);
    if (terrainMesh) {
      rayOrigin.set(ref.position.x, 1e4, ref.position.z);
      raycaster.set(rayOrigin, rayDir);
      const isects = raycaster.intersectObject(terrainMesh, false);
      if (isects.length > 0) {
        hit.copy(isects[0].point);
        obj.position.y = hit.y + groundOffset;
      }
    }
    obj.updateMatrix();
    return obj;
  });

  const bodyGeometry = modelParts.body.geometry;
  bodyGeometry.computeBoundingBox();
  const bbox = bodyGeometry.boundingBox;
  const extentY = bbox.max.y - bbox.min.y;
  const extentZ = bbox.max.z - bbox.min.z;
  const extentX = bbox.max.x - bbox.min.x;
  const useY = extentY >= extentZ && extentY >= extentX;
  const useZ = extentZ >= extentY && extentZ >= extentX;
  const trunkMin = useZ ? bbox.min.z : bbox.min.y;
  const trunkHeight = useZ ? extentZ : extentY;
  const trunkBaseAoStrength = uniform(options.trunkBaseAoStrength ?? 0.5);
  const trunkBaseAoRange = 0.4;
  const bodyMaterial = new THREE.MeshStandardNodeMaterial({
    colorNode: Fn(() => {
      const baseCol = color(0.45, 0.3, 0.2);
      const alongTrunk = useZ ? positionGeometry.z : positionGeometry.y;
      const baseContactBlend = smoothstep(
        float(trunkMin),
        float(trunkMin + trunkHeight * trunkBaseAoRange),
        alongTrunk
      );
      return mix(baseCol.mul(float(1).sub(trunkBaseAoStrength)), baseCol, baseContactBlend);
    })(),
    roughness: 0.9,
    metalness: 0.05,
  });

  const bodies = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, adjustedRefs.length);
  bodies.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  for (let i = 0; i < adjustedRefs.length; i++) {
    bodies.setMatrixAt(i, adjustedRefs[i].matrix);
  }
  bodies.instanceMatrix.needsUpdate = true;
  scene.add(bodies);

  const leafReferences = [];
  const offset = new THREE.Vector3();
  for (const treeRef of adjustedRefs) {
    treeRef.updateMatrixWorld(true);
    for (const leaves of modelParts.leaves) {
      for (let d = 0; d < leafDensityMultiplier; d++) {
        const finalMatrix = leaves.matrix.clone().premultiply(treeRef.matrixWorld);
        const ref = new THREE.Object3D();
        ref.applyMatrix4(finalMatrix);
        if (d > 0) {
          offset.set((rng() - 0.5) * 1.2, (rng() - 0.5) * 1.2, (rng() - 0.5) * 1.2);
          ref.position.add(offset);
          const s = 0.85 + rng() * 0.3;
          ref.scale.multiplyScalar(s);
        }
        leafReferences.push(ref);
      }
    }
  }

  if (leafReferences.length === 0) {
    return { bodies, leaves: null, trunkBaseAoStrengthUniform: trunkBaseAoStrength };
  }

  const leavesResult = createFoliage(scene, leafReferences, {
    windOffsetNode,
    foliageTexture,
    lightDirection,
    colorA,
    colorB,
    orientationsPerInstance,
    scaleMultiplier,
    aoStrength,
    sssStrength,
    sssColor,
    seeThrough,
    colorVariationStrength,
    conditionalDepthEnabled,
    depthFadeNear,
    depthFadeFar,
    baseContactStrength,
    alphaThreshold,
    alphaTest,
    leafShapeVariation,
  });

  return { bodies, leaves: leavesResult, trunkBaseAoStrengthUniform: trunkBaseAoStrength };
}
