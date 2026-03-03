/**
 * Reed field for grass-sandbox — instanced reedplant.glb on terrain.
 * FPS test: dense instanced vegetation from GLB.
 * One InstancedMesh per mesh (avoids mergeGeometries uv3 incompatibility).
 * Wind: TSL positionNode, same params as grass/flowers.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  add,
  mul,
  sin,
  cos,
  float,
  Fn,
  instanceIndex,
  positionLocal,
  uniform,
  vec3,
  max,
} from "three/tsl";

function hash(i) {
  let h = (i * 2654435761) >>> 0;
  return (h % 10000) / 10000;
}

/**
 * Create a reed field from reedplant.glb.
 * @param {THREE.Scene} scene
 * @param {object} options - { sampleHeight, centerX, centerZ, halfWidth, halfDepth, density, modelPath, scale }
 * @returns {Promise<{ reedGroup, reedCount }>}
 */
export async function createReedField(scene, options = {}) {
  const {
    sampleHeight,
    centerX = 50,
    centerZ = -40,
    halfWidth = 35,
    halfDepth = 35,
    density = 40 * 40,
    modelPath = "./models/reedplant.glb",
    scale = 0.15,
    scaleVariation = 0.25,
  } = options;

  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().load(modelPath, resolve, undefined, reject);
  });

  const root = gltf.scene;
  const meshList = [];
  root.traverse((o) => {
    if (o.isMesh && o.geometry) meshList.push(o);
  });

  if (meshList.length === 0) {
    console.warn("Reed GLB has no meshes:", modelPath);
    return { reedGroup: new THREE.Group(), reedCount: 0, update: () => {} };
  }

  const windDir = (options.windDir ?? 0.7) * Math.PI;
  const windSpeed = options.windSpeed ?? 1.2;
  const windStr = (options.windStr ?? 0.15) * 0.25;
  const uReedTime = uniform(0);

  let numCellsX = Math.floor(Math.sqrt(density));
  while (density % numCellsX !== 0) numCellsX--;
  const numCellsZ = density / numCellsX;
  const cellW = (halfWidth * 2) / numCellsX;
  const cellH = (halfDepth * 2) / numCellsZ;

  const matrices = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < density; i++) {
    const col = i % numCellsX;
    const row = Math.floor(i / numCellsX);
    const x = centerX - halfWidth + col * cellW + hash(i * 11) * cellW;
    const z = centerZ - halfDepth + row * cellH + hash(i * 13) * cellH;
    const y = sampleHeight(x, z);
    const scaleMult = 1 - scaleVariation * 0.5 + hash(i * 17) * scaleVariation;
    const s = scale * scaleMult;
    const rotY = hash(i * 23) * Math.PI * 2;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
  }

  const reedGroup = new THREE.Group();
  for (const m of meshList) {
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    geo.computeBoundingSphere();
    const src = m.material;
    const hasAlpha =
      (src && src.alphaMap) ||
      (src && src.transparent) ||
      (src && src.alphaTest != null && src.alphaTest > 0);
    let mat;
    if (hasAlpha && src) {
      mat = src.clone();
      mat.alphaTest = 0.05;
      mat.opacity = 1;
      if (mat.side == null) mat.side = THREE.DoubleSide;
    } else {
      mat = new THREE.MeshStandardNodeMaterial({
        color: src?.color?.getHex?.() ?? src?.color ?? 0x4a6b3a,
        roughness: src?.roughness ?? 0.9,
        metalness: src?.metalness ?? 0,
        map: src?.map ?? null,
        normalMap: src?.normalMap ?? null,
        side: THREE.DoubleSide,
      });
    }
    mat.positionNode = Fn(() => {
      const phase = add(
        mul(uReedTime, windSpeed),
        mul(instanceIndex.toFloat(), 1.2),
        windDir
      );
      const heightPct = mul(max(0, positionLocal.y), max(0, positionLocal.y));
      const bend = mul(sin(phase), windStr, heightPct);
      const micro = mul(sin(add(mul(phase, 2.3), instanceIndex.toFloat())), 0.06, windStr, heightPct);
      const amount = add(bend, micro);
      return add(positionLocal, vec3(mul(cos(windDir), amount), 0, mul(sin(windDir), amount)));
    })();
    const im = new THREE.InstancedMesh(geo, mat, density);
    im.castShadow = false;
    im.receiveShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < density; i++) im.setMatrixAt(i, matrices[i]);
    im.instanceMatrix.needsUpdate = true;
    reedGroup.add(im);
  }
  scene.add(reedGroup);

  function update(elapsed) {
    uReedTime.value = elapsed ?? 0;
  }

  return { reedGroup, reedCount: density, update };
}
