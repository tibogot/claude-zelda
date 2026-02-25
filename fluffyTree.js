/**
 * fluffyTree.js — Single fluffy anime-style tree for Three.js WebGPU / TSL
 *
 * Adapted from fluffytree-threejs-main by Leonardo Soares Gonçalves (MIT License).
 * Wind + volumetric leaf gradient ported to TSL node materials for WebGPU.
 *
 * Usage:
 *   import { createFluffyTree } from './fluffyTree.js';
 *   const tree = await createFluffyTree({ dirLight, position: [x, y, z] });
 *   scene.add(tree.group);
 *   // in animation loop (pass elapsed time, not delta):
 *   tree.update(elapsed);
 */

import * as THREE from "three";
import {
  Fn, uniform, float, vec3, vec4,
  positionLocal, positionWorld,
  modelWorldMatrix,
  uv, texture,
  mix, smoothstep, normalize, dot,
  sub, add, mul, div,
  sin, cos,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const GLB_URL       = "fluffytree-threejs-main/assets/landscape-glb.glb";
const CANOPY_PREFIX = "NOVA_COPA";

// Any mesh whose name starts with "Landscape" is part of the demo scene
// (ground plane, grass patch) — we hide all of them and keep only the tree.
const SKIP_PREFIX = "Landscape";

// ─────────────────────────────────────────────────────────────────────────────
// Canopy (leaf) material
// ─────────────────────────────────────────────────────────────────────────────
function buildCanopyMaterial(canopyObj, uTime, uSunDir, settings) {
  // World-space bounding-box center — pivot for the volumetric gradient.
  canopyObj.geometry.computeBoundingBox();
  const localCenter = new THREE.Vector3();
  canopyObj.geometry.boundingBox.getCenter(localCenter);
  canopyObj.updateWorldMatrix(true, false);
  const worldCenter = localCenter.applyMatrix4(canopyObj.matrixWorld);

  const leafTex = canopyObj.material.map;

  const uTreeCenter   = uniform(vec3(worldCenter.x, worldCenter.y, worldCenter.z));
  const uWindStrength = uniform(float(settings.windStrength));
  const uWindFreq     = uniform(float(settings.windFrequency));
  const uWindSpeed    = uniform(float(settings.windSpeed));
  const uGradStart    = uniform(float(-1.0));
  const uGradEnd      = uniform(float(2.7));
  const uLitColor     = uniform(vec3(settings.litColor.r,       settings.litColor.g,       settings.litColor.b));
  const uShadowColor  = uniform(vec3(settings.shadowColor.r,    settings.shadowColor.g,    settings.shadowColor.b));
  const uHlColor      = uniform(vec3(settings.highlightColor.r, settings.highlightColor.g, settings.highlightColor.b));
  const uHlStart      = uniform(float(0.5));
  const uHlEnd        = uniform(float(1.8));

  const mat = new THREE.MeshLambertNodeMaterial({
    side:       THREE.DoubleSide,
    alphaTest:  0.5,
    depthWrite: true,
  });

  // Wind: sine approximation — higher vertices sway more.
  mat.positionNode = Fn(() => {
    const worldPos  = mul(modelWorldMatrix, vec4(positionLocal, 1.0)).xyz;
    const t         = mul(uTime, uWindSpeed);
    const nx        = sin(add(mul(worldPos.x, uWindFreq), t));
    const nz        = cos(add(mul(worldPos.z, uWindFreq), mul(t, float(0.7))));
    const noise     = add(nx, nz);
    const windDir   = normalize(vec3(1.0, 0.0, 1.0));
    const heightFac = div(positionLocal.y, float(8.0));
    const disp      = mul(noise, uWindStrength, heightFac);
    return add(positionLocal, mul(windDir, disp));
  })();

  // Volumetric gradient: direction from tree center to fragment dotted with sun.
  mat.colorNode = Fn(() => {
    const fromCenter = normalize(sub(positionWorld, uTreeCenter));
    const alignment  = dot(fromCenter, uSunDir);
    const baseGrad   = smoothstep(uGradStart, uGradEnd, alignment);
    const baseCol    = mix(uShadowColor, uLitColor, baseGrad);
    const hlGrad     = smoothstep(uHlStart, uHlEnd, alignment);
    const gradCol    = mix(baseCol, uHlColor, hlGrad);
    const alpha      = leafTex ? texture(leafTex, uv()).a : float(1.0);
    return vec4(gradCol, alpha);
  })();

  return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export async function createFluffyTree(opts = {}) {
  const {
    position       = [0, 0, 0],
    dirLight       = null,
    litColor       = new THREE.Color(0x21ff08),
    shadowColor    = new THREE.Color(0x001d33),
    highlightColor = new THREE.Color(0x8cff00),
    windStrength   = 0.05,
    windSpeed      = 0.4,
    windFrequency  = 5.0,
  } = opts;

  const uTime   = uniform(float(0));
  const uSunDir = uniform(vec3(0.5, 1.0, 0.3));
  if (dirLight) uSunDir.value.copy(dirLight.position).normalize();

  const gltf = await new Promise((res, rej) =>
    new GLTFLoader().load(GLB_URL, res, undefined, rej)
  );
  const root = gltf.scene;

  // Log every mesh name once so you can see exactly what's in the GLB.
  console.group("[fluffyTree] GLB mesh inventory");
  root.traverse(obj => { if (obj.isMesh) console.log(`  "${obj.name}"`); });
  console.groupEnd();

  // ── Find the trunk's lowest point at root origin, then offset Y so the
  //    trunk base sits exactly on the terrain at position[1]. ──────────────
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);
  let trunkMinY = 0;
  root.traverse(obj => {
    if (obj.name === "Tronco_da_Árvore001") {
      obj.geometry.computeBoundingBox();
      const bb = new THREE.Box3().setFromObject(obj);
      trunkMinY = bb.min.y;
    }
  });
  root.position.set(position[0], position[1] - trunkMinY, position[2]);
  root.updateMatrixWorld(true);

  const toRemove = [];

  root.traverse(obj => {
    if (!obj.isMesh) return;

    // Hide everything that belongs to the demo scene (ground + grass patch).
    if (obj.name.startsWith(SKIP_PREFIX)) {
      toRemove.push(obj);
      return;
    }

    obj.castShadow    = true;
    obj.receiveShadow = true;

    if (obj.name.startsWith(CANOPY_PREFIX)) {
      obj.material = buildCanopyMaterial(obj, uTime, uSunDir, {
        litColor, shadowColor, highlightColor,
        windStrength, windSpeed, windFrequency,
      });
    }
    // Trunk mesh: keep original GLB material, shadows handled automatically.
  });

  // Remove demo-scene meshes from the hierarchy entirely.
  toRemove.forEach(obj => obj.removeFromParent());

  const group = new THREE.Group();
  group.add(root);

  return {
    group,
    update(elapsed) {
      uTime.value = elapsed;
      if (dirLight) uSunDir.value.copy(dirLight.position).normalize();
    },
  };
}
