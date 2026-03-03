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
  vec4,
  max,
  sub,
  length,
  smoothstep,
  mix,
  abs,
  div,
  attribute,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  negate,
} from "three/tsl";

function hash(i) {
  let h = (i * 2654435761) >>> 0;
  return (h % 10000) / 10000;
}

/** Procedural normal map: vertical ridges for reed/blade surface detail. */
function createReedNormalMap(size = 64, ridgeStrength = 0.2, ridgeFreq = 8) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const ridge = Math.sin(v * Math.PI * 2 * ridgeFreq) * ridgeStrength;
      const nx = ridge;
      const ny = 0;
      const nz = Math.sqrt(Math.max(0.01, 1 - nx * nx));
      const idx = (y * size + x) * 4;
      data[idx] = (nx * 0.5 + 0.5) * 255;
      data[idx + 1] = (ny * 0.5 + 0.5) * 255;
      data[idx + 2] = (nz * 0.5 + 0.5) * 255;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
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

  // Player interaction uniforms (same as grass/susuki)
  const uTrailCenter = options.uniforms?.uTrailCenter ?? uniform(new THREE.Vector2(9999, 9999));
  const uPlayerPos = options.uniforms?.uPlayerPos ?? uniform(new THREE.Vector3(9999, 0, 9999));
  const uInteractionRange = options.uniforms?.uInteractionRange ?? uniform(9999);
  const uInteractionStrength = options.uniforms?.uInteractionStrength ?? uniform(0);
  const uInteractionHThresh = options.uniforms?.uInteractionHThresh ?? uniform(2);
  const uInteractionRepel = options.uniforms?.uInteractionRepel ?? uniform(1);
  const reedNormalTex = createReedNormalMap(64, 0.25, 6);
  const normalScale = options.normalMapStrength ?? 0.4;

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
    const h = hash(i * 17);
    const h2 = hash(i * 19);
    let scaleMult;
    if (h < 0.18) {
      scaleMult = 0.72 + 0.18 * (h / 0.18) + 0.04 * (h2 - 0.5);
    } else if (h < 0.82) {
      scaleMult = 0.9 + 0.2 * ((h - 0.18) / 0.64) + 0.06 * (h2 - 0.5);
    } else {
      scaleMult = 1.1 + 0.2 * ((h - 0.82) / 0.18) + 0.04 * (h2 - 0.5);
    }
    scaleMult = Math.max(0.65, Math.min(1.35, scaleMult));
    const s = scale * scaleMult;
    const rotY = hash(i * 23) * Math.PI * 2;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, rotY, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
  }

  // Instance positions for player interaction (per-reed world position)
  const instancePosArr = new Float32Array(density * 3);
  for (let i = 0; i < density; i++) {
    const m = matrices[i];
    instancePosArr[i * 3] = m.elements[12];
    instancePosArr[i * 3 + 1] = m.elements[13];
    instancePosArr[i * 3 + 2] = m.elements[14];
  }

  const reedGroup = new THREE.Group();
  for (const m of meshList) {
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    geo.computeBoundingSphere();
    geo.setAttribute("instancePos", new THREE.InstancedBufferAttribute(instancePosArr, 3));
    const src = m.material;
    const hasAlpha =
      (src && src.alphaMap) ||
      (src && src.transparent) ||
      (src && src.alphaTest != null && src.alphaTest > 0);
    let mat;
    if (hasAlpha && src) {
      mat = src.clone();
      mat.alphaTest = 0.25;
      mat.opacity = 1;
      mat.depthWrite = true;
      mat.alphaToCoverage = true;
      if (mat.side == null) mat.side = THREE.DoubleSide;
      mat.normalMap = reedNormalTex;
      mat.normalScale = new THREE.Vector2(normalScale, normalScale);
    } else {
      mat = new THREE.MeshStandardNodeMaterial({
        color: src?.color?.getHex?.() ?? src?.color ?? 0x4a6b3a,
        roughness: src?.roughness ?? 0.9,
        metalness: src?.metalness ?? 0,
        map: src?.map ?? null,
        normalMap: reedNormalTex,
        normalScale: new THREE.Vector2(normalScale, normalScale),
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
      const windAmount = add(bend, micro);
      let pos = add(positionLocal, vec3(mul(cos(windDir), windAmount), 0, mul(sin(windDir), windAmount)));

      // Player interaction (bend away from player — same as susuki: use instance position)
      const instancePosAttr = attribute("instancePos", "vec3");
      const reedBaseWorld = instancePosAttr;
      const repulseCenterXZ = uTrailCenter;
      const pDist = length(sub(reedBaseWorld.xz, repulseCenterXZ));
      const pHD = abs(sub(reedBaseWorld.y, uPlayerPos.y));
      const distFalloff = mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, pDist));
      const heightFalloff = smoothstep(uInteractionHThresh, 0, pHD);
      const pFall = mul(distFalloff, heightFalloff);
      // pTo = direction from player to reed (push away), safe when distance is 0
      const diffXZ = sub(
        vec3(reedBaseWorld.x, 0, reedBaseWorld.z),
        vec3(repulseCenterXZ.x, 0, repulseCenterXZ.y),
      );
      const len = max(length(diffXZ), 0.001);
      const pTo = mul(diffXZ, div(1, len));
      const pAng = mul(
        negate(mix(0, uInteractionStrength, pFall)),
        uInteractionRepel,
      );
      const pushAmount = mul(pAng, heightPct);
      const dispWorld = mul(pTo, pushAmount);
      const dispLocal = modelWorldMatrixInverse.mul(vec4(dispWorld, 0)).xyz;
      pos = add(pos, dispLocal);

      return pos;
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
