/**
 * Folio Showcase — Bushes (Bruno Simon style).
 * Places foliage blobs on the terrain. Uses raycast on terrain mesh so Y matches exactly.
 */
import * as THREE from "three";
import { createFoliage } from "./foliage.js";

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * @param {THREE.Scene} scene
 * @param {{
 *   terrainMesh: THREE.Mesh,
 *   terrainSize: number,
 *   count?: number,
 *   windOffsetNode: (pos: any) => any,
 *   foliageTexture: THREE.Texture,
 *   lightDirection: THREE.Vector3,
 *   camera?: THREE.Camera,
 *   colorA?: string,
 *   colorB?: string,
 * }} options
 * @returns {{ mesh: THREE.InstancedMesh }}
 */
export function createBushes(scene, options) {
  const {
    terrainMesh,
    terrainSize,
    count = 120,
    windOffsetNode,
    foliageTexture,
    lightDirection,
    camera,
    colorA = "#b4b536",
    colorB = "#d8cf3b",
  } = options;

  terrainMesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3(0, -1, 0);
  const hit = new THREE.Vector3();

  const half = terrainSize * 0.48;
  const rng = seededRandom(42);
  const references = [];

  for (let i = 0; i < count; i++) {
    const x = (rng() * 2 - 1) * half;
    const z = (rng() * 2 - 1) * half;
    if (x * x + z * z < 15 * 15) continue;

    rayOrigin.set(x, 1e4, z);
    raycaster.set(rayOrigin, rayDirection);
    const intersects = raycaster.intersectObject(terrainMesh, false);
    if (intersects.length === 0) continue;
    hit.copy(intersects[0].point);

    const scale = 0.8 + rng() * 0.6;
    references.push({
      position: new THREE.Vector3(hit.x, hit.y, hit.z),
      scale,
    });
  }

  return createFoliage(scene, references, {
    windOffsetNode,
    foliageTexture,
    lightDirection,
    colorA,
    colorB,
    orientationsPerInstance: options.orientationsPerInstance,
    scaleMultiplier: options.scaleMultiplier,
    aoStrength: options.aoStrength,
    sssStrength: options.sssStrength,
    sssColor: options.sssColor,
    colorVariationStrength: options.colorVariationStrength,
    conditionalDepthEnabled: options.conditionalDepthEnabled,
    depthFadeNear: options.depthFadeNear,
    depthFadeFar: options.depthFadeFar,
    baseContactStrength: options.baseContactStrength,
    alphaThreshold: options.alphaThreshold,
    alphaTest: options.alphaTest,
    leafShapeVariation: options.leafShapeVariation,
  });
}

/**
 * Bushes from folio's exact GLB (bushesReferences-compressed.glb). Positions projected onto our terrain.
 */
export function createBushesFromFolio(scene, options) {
  const {
    bushesReferencesGlb,
    terrainMesh,
    windOffsetNode,
    foliageTexture,
    lightDirection,
    camera,
    colorA = "#b4b536",
    colorB = "#d8cf3b",
    orientationsPerInstance,
    scaleMultiplier,
    aoStrength,
    sssStrength,
    sssColor,
  } = options;

  const children = bushesReferencesGlb.scene?.children ?? [];
  if (children.length === 0) return createFoliage(scene, [], { windOffsetNode, foliageTexture, lightDirection, colorA, colorB, orientationsPerInstance, scaleMultiplier, aoStrength, sssStrength, sssColor });

  terrainMesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const rayOrigin = new THREE.Vector3();
  const rayDirection = new THREE.Vector3(0, -1, 0);
  const hit = new THREE.Vector3();
  const references = [];

  for (const child of children) {
    rayOrigin.set(child.position.x, 1e4, child.position.z);
    raycaster.set(rayOrigin, rayDirection);
    const intersects = raycaster.intersectObject(terrainMesh, false);
    if (intersects.length === 0) continue;
    hit.copy(intersects[0].point);
    const scale = typeof child.scale === "number" ? child.scale : child.scale?.x ?? 1;
    references.push({
      position: new THREE.Vector3(hit.x, hit.y, hit.z),
      scale,
    });
  }

  return createFoliage(scene, references, {
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
    colorVariationStrength: options.colorVariationStrength,
    conditionalDepthEnabled: options.conditionalDepthEnabled,
    depthFadeNear: options.depthFadeNear,
    depthFadeFar: options.depthFadeFar,
    baseContactStrength: options.baseContactStrength,
    alphaThreshold: options.alphaThreshold,
    alphaTest: options.alphaTest,
    leafShapeVariation: options.leafShapeVariation,
  });
}
