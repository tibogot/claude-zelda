/**
 * Flower field for grass-sandbox — instanced flowers on terrain.
 * Placed at a fixed world position, uses sampleHeight for terrain placement.
 * Uses TSL/NodeMaterial for WebGPU compatibility (color + wind).
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  attribute,
  add,
  sub,
  mul,
  sin,
  cos,
  mix,
  float,
  Fn,
  positionLocal,
  uniform,
  vec3,
  vec4,
  varying,
  max,
  length,
  smoothstep,
  abs,
  div,
  negate,
  modelWorldMatrixInverse,
} from "three/tsl";

function hash(i) {
  let h = (i * 2654435761) >>> 0;
  return (h % 10000) / 10000;
}

function createPetalNormalMap(size = 64, domeStrength = 0.15) {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x - half) / half;
      const v = (y - half) / half;
      const nx = -u * domeStrength;
      const ny = -v * domeStrength;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

const DEFAULT_PARAMS = {
  petalCountMin: 4,
  petalCountMax: 7,
  petalScale: 0.22,
  petalTilt: 0.25,
  petalVariation: 0.06,
  petalColorBase: "#ff88aa",
  petalColorTip: "#ffccdd",
  centerColor: "#ffdd44",
  centerRadius: 0.08,
  centerDomeHeight: 0.02,
  stemColor: "#4a7c3e",
  stemColorTop: "#5a9c4e",
  stemRadius: 0.012,
  stemBaseBend: 0.08,
  stemLeafScale: 0.12,
  flowerHeight: 0.6,
  colorVariation: 0.08,
  normalBend: 0.25,
  normalMapStrength: 0.3,
  subsurfaceStrength: 0.3,
  groundOcclusionStr: 0.3,
  groundColorBleed: 0.1,
  petalGradientBlend: 0.8,
  petalNoiseStr: 0.06,
};

/**
 * Create and setup a flower field on the terrain.
 * @param {THREE.Scene} scene
 * @param {object} options - { sampleHeight, centerX, centerZ, halfWidth, halfDepth, density, texturePath, params }
 * @returns {Promise<{ flowerGroup, update }>}
 */
export async function createFlowerField(scene, options = {}) {
  const {
    sampleHeight,
    centerX = -50,
    centerZ = -30,
    halfWidth = 40,
    halfDepth = 40,
    density = 30 * 30 * 3,
    texturePath = "./textures/petal-alpha.png",
    params: userParams = {},
  } = options;

  const p = { ...DEFAULT_PARAMS, ...userParams };
  const groundColor = new THREE.Color(0x2d4a2d);

  const petalTex = await new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(texturePath, resolve, undefined, reject);
  });
  const petalNormalTex = createPetalNormalMap(64, 0.2);
  const petalGeo = new THREE.PlaneGeometry(1, 1, 1, 1);

  function buildFlowerHeadGeometry(petalCount) {
    const pc = Math.max(3, Math.min(12, Math.floor(petalCount)));
    const group = new THREE.Group();
    const geometriesToMerge = [];
    for (let i = 0; i < pc; i++) {
      const baseAngle = (i / pc) * Math.PI * 2;
      const vary = ((i * 7) % 100) / 100;
      const angleOffset = (vary - 0.5) * 2 * p.petalVariation;
      const scaleMul = 1 + (vary - 0.5) * 2 * p.petalVariation;
      const angle = baseAngle + angleOffset;
      const petalGroup = new THREE.Group();
      petalGroup.rotation.y = angle;
      const petal = new THREE.Mesh(petalGeo.clone(), new THREE.MeshBasicMaterial());
      petal.scale.set(p.petalScale * scaleMul, p.petalScale * scaleMul, 1);
      petal.rotation.x = -Math.PI / 2 - p.petalTilt;
      petal.position.set(0, 0.001, 0.5 * p.petalScale);
      petalGroup.add(petal);
      group.add(petalGroup);
    }
    group.updateMatrixWorld(true);
    const groupInv = group.matrixWorld.clone().invert();
    group.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const geo = child.geometry.clone().applyMatrix4(
          groupInv.clone().multiply(child.matrixWorld)
        );
        geometriesToMerge.push(geo);
      }
    });
    const merged = mergeGeometries(geometriesToMerge);
    geometriesToMerge.forEach((g) => g.dispose());
    const pos = merged.attributes.position;
    const radialNorm = new Float32Array(pos.count);
    const maxR = p.petalScale * 1.2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      radialNorm[i] = Math.min(1, Math.sqrt(x * x + z * z) / maxR);
    }
    merged.setAttribute("aRadialNorm", new THREE.BufferAttribute(radialNorm, 1));
    const norm = merged.attributes.normal;
    if (pos && norm) {
      const flatUp = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const n = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        if (v.length() > 0.01) {
          n.fromBufferAttribute(norm, i);
          const radial = v.clone().normalize();
          n.lerpVectors(flatUp, radial, p.normalBend).normalize();
          norm.setXYZ(i, n.x, n.y, n.z);
        }
      }
      norm.needsUpdate = true;
    }
    return merged;
  }

  let numCellsX = Math.floor(Math.sqrt(density));
  while (density % numCellsX !== 0) numCellsX--;
  const numCellsZ = density / numCellsX;
  const cellW = (halfWidth * 2) / numCellsX;
  const cellH = (halfDepth * 2) / numCellsZ;

  const off = [];
  const flowerIndex = [];
  const flowerHeight = [];
  const petalCounts = [];
  const flowerRotation = [];
  const colors = [];
  const baseColor = new THREE.Color(p.petalColorBase);
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);
  const pcMin = Math.floor(p.petalCountMin);
  const pcMax = Math.floor(p.petalCountMax);

  for (let i = 0; i < density; i++) {
    const col = i % numCellsX;
    const row = Math.floor(i / numCellsX);
    const x = centerX - halfWidth + col * cellW + hash(i * 11) * cellW;
    const z = centerZ - halfDepth + row * cellH + hash(i * 13) * cellH;
    const h = p.flowerHeight * (0.85 + hash(i * 17) * 0.3);
    off.push(x, sampleHeight(x, z), z);
    flowerIndex.push(i);
    flowerHeight.push(h);
    petalCounts.push(pcMin + Math.floor(hash(i * 19) * (pcMax - pcMin + 1)));
    flowerRotation.push(hash(i * 23) * Math.PI * 2);
    const hue = (hash(i * 31) - 0.5) * 2 * p.colorVariation;
    colors.push(new THREE.Color().setHSL((hsl.h + hue) % 1, hsl.s, hsl.l));
  }

  const count = density;
  const maxHeight = Math.max(...flowerHeight);
  const dummy = new THREE.Object3D();
  const flowerGroup = new THREE.Group();
  flowerGroup.position.set(0, 0, 0);

  const byPetalCount = {};
  for (let i = 0; i < count; i++) {
    const pc = Math.floor(petalCounts[i]);
    if (!byPetalCount[pc]) byPetalCount[pc] = [];
    byPetalCount[pc].push(i);
  }

  const flowerHeadMeshes = [];
  const windDir = (options.windDir ?? 0.7) * Math.PI;
  const windSpeed = options.windSpeed ?? 1.2;
  const windStr = (options.windStr ?? 0.15) * 0.4;

  // Instance positions for player interaction (flower center: top of stem)
  const instancePosArr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    instancePosArr[i * 3] = off[i * 3];
    instancePosArr[i * 3 + 1] = off[i * 3 + 1] + flowerHeight[i];
    instancePosArr[i * 3 + 2] = off[i * 3 + 2];
  }

  // Player interaction uniforms (same as grass/susuki/reed)
  const uTrailCenter = options.uniforms?.uTrailCenter ?? uniform(new THREE.Vector2(9999, 9999));
  const uPlayerPos = options.uniforms?.uPlayerPos ?? uniform(new THREE.Vector3(9999, 0, 9999));
  const uInteractionRange = options.uniforms?.uInteractionRange ?? uniform(9999);
  const uInteractionStrength = options.uniforms?.uInteractionStrength ?? uniform(0);
  const uInteractionHThresh = options.uniforms?.uInteractionHThresh ?? uniform(2);
  const uInteractionRepel = options.uniforms?.uInteractionRepel ?? uniform(1);

  // TSL uniforms (WebGPU-compatible)
  const uFlowerTime = uniform(0);
  const uPetalColorBase = uniform(new THREE.Color(p.petalColorBase).convertSRGBToLinear());
  const uPetalColorTip = uniform(new THREE.Color(p.petalColorTip).convertSRGBToLinear());
  const uPetalGradientBlend = uniform(p.petalGradientBlend);

  const flowerHeadMat = new THREE.MeshStandardNodeMaterial({
    map: petalTex,
    alphaMap: petalTex,
    normalMap: petalNormalTex,
    normalScale: new THREE.Vector2(p.normalMapStrength, p.normalMapStrength),
    transparent: true,
    alphaTest: 0.02,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    roughness: 0.85,
    metalness: 0,
  });
  // Wind + player interaction: vertex displacement — radial falloff so petals bend from center
  flowerHeadMat.positionNode = (() => {
    const aIdx = attribute("aFlowerIndex", "float");
    const aHeight = attribute("aFlowerHeight", "float");
    const aRadial = attribute("aRadialNorm", "float");
    const instancePosAttr = attribute("instancePos", "vec3");
    const phase = add(
      mul(uFlowerTime, windSpeed),
      mul(aIdx, 1.2),
      windDir
    );
    const bend = mul(sin(phase), windStr, aHeight, aRadial);
    const micro = mul(sin(add(mul(phase, 2.3), mul(aIdx, 3))), 0.08, windStr, aHeight, aRadial);
    const amount = add(bend, micro);
    let pos = add(
      positionLocal,
      vec3(mul(cos(windDir), amount), 0, mul(sin(windDir), amount))
    );
    // Player interaction (bend away, same as susuki/reed)
    const reedBaseWorld = instancePosAttr;
    const pDist = length(sub(reedBaseWorld.xz, uTrailCenter));
    const pHD = abs(sub(reedBaseWorld.y, uPlayerPos.y));
    const distFalloff = mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, pDist));
    const heightFalloff = smoothstep(uInteractionHThresh, 0, pHD);
    const pFall = mul(distFalloff, heightFalloff);
    const diffXZ = sub(
      vec3(reedBaseWorld.x, 0, reedBaseWorld.z),
      vec3(uTrailCenter.x, 0, uTrailCenter.y),
    );
    const len = max(length(diffXZ), 0.001);
    const pTo = mul(diffXZ, div(1, len));
    const pAng = mul(negate(mix(0, uInteractionStrength, pFall)), uInteractionRepel);
    const heightPct = aRadial;
    const pushAmount = mul(pAng, heightPct);
    const dispWorld = mul(pTo, pushAmount);
    const dispLocal = modelWorldMatrixInverse.mul(vec4(dispWorld, 0)).xyz;
    pos = add(pos, dispLocal);
    return pos;
  })();
  // Pink gradient: base (center) → tip (edge)
  flowerHeadMat.colorNode = mix(
    uPetalColorBase,
    mix(uPetalColorBase, uPetalColorTip, attribute("aRadialNorm", "float")),
    uPetalGradientBlend
  );

  const useGrad = p.petalGradientBlend > 0.01;
  for (const [pcStr, indices] of Object.entries(byPetalCount)) {
    const pc = parseInt(pcStr, 10);
    const baseGeo = buildFlowerHeadGeometry(pc);
    const instGeo = new THREE.InstancedBufferGeometry().copy(baseGeo);
    instGeo.instanceCount = indices.length;
    const idxArr = new Float32Array(indices.length);
    const hArr = new Float32Array(indices.length);
    const posArr = new Float32Array(indices.length * 3);
    indices.forEach((ii, j) => {
      idxArr[j] = flowerIndex[ii];
      hArr[j] = flowerHeight[ii];
      posArr[j * 3] = instancePosArr[ii * 3];
      posArr[j * 3 + 1] = instancePosArr[ii * 3 + 1];
      posArr[j * 3 + 2] = instancePosArr[ii * 3 + 2];
    });
    instGeo.setAttribute("aFlowerIndex", new THREE.InstancedBufferAttribute(idxArr, 1));
    instGeo.setAttribute("aFlowerHeight", new THREE.InstancedBufferAttribute(hArr, 1));
    instGeo.setAttribute("instancePos", new THREE.InstancedBufferAttribute(posArr, 3));
    const mesh = new THREE.InstancedMesh(instGeo, flowerHeadMat, indices.length);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    indices.forEach((ii, j) => {
      dummy.position.set(off[ii * 3], off[ii * 3 + 1] + flowerHeight[ii], off[ii * 3 + 2]);
      dummy.rotation.set(0, flowerRotation[ii], 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(j, dummy.matrix);
      mesh.setColorAt(j, useGrad ? new THREE.Color(0xffffff) : colors[ii]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    flowerGroup.add(mesh);
    flowerHeadMeshes.push(mesh);
    baseGeo.dispose();
  }

  const centerGeo = new THREE.SphereGeometry(p.centerRadius, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
  centerGeo.scale(1, Math.max(0.1, p.centerDomeHeight / Math.max(p.centerRadius, 0.01)), 1);
  centerGeo.translate(0, 0.0005, 0);
  const centerInstancedGeo = new THREE.InstancedBufferGeometry().copy(centerGeo);
  centerInstancedGeo.instanceCount = count;
  centerInstancedGeo.setAttribute("aFlowerIndex", new THREE.InstancedBufferAttribute(new Float32Array(flowerIndex), 1));
  centerInstancedGeo.setAttribute("aFlowerHeight", new THREE.InstancedBufferAttribute(new Float32Array(flowerHeight), 1));
  centerInstancedGeo.setAttribute("instancePos", new THREE.InstancedBufferAttribute(instancePosArr, 3));
  const centerMat = new THREE.MeshStandardNodeMaterial({
    color: p.centerColor,
    normalMap: petalNormalTex,
    normalScale: new THREE.Vector2(p.normalMapStrength * 0.5, p.normalMapStrength * 0.5),
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  centerMat.positionNode = (() => {
    const aIdx = attribute("aFlowerIndex", "float");
    const aHeight = attribute("aFlowerHeight", "float");
    const instancePosAttr = attribute("instancePos", "vec3");
    const phase = add(mul(uFlowerTime, windSpeed), mul(aIdx, 1.2), windDir);
    const bend = mul(sin(phase), windStr, aHeight, 0.6);
    const micro = mul(sin(add(mul(phase, 2.3), mul(aIdx, 3))), 0.06, windStr, aHeight);
    const amount = add(bend, micro);
    let pos = add(positionLocal, vec3(mul(cos(windDir), amount), 0, mul(sin(windDir), amount)));
    // Player interaction
    const reedBaseWorld = instancePosAttr;
    const pDist = length(sub(reedBaseWorld.xz, uTrailCenter));
    const pHD = abs(sub(reedBaseWorld.y, uPlayerPos.y));
    const distFalloff = mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, pDist));
    const heightFalloff = smoothstep(uInteractionHThresh, 0, pHD);
    const pFall = mul(distFalloff, heightFalloff);
    const diffXZ = sub(vec3(reedBaseWorld.x, 0, reedBaseWorld.z), vec3(uTrailCenter.x, 0, uTrailCenter.y));
    const len = max(length(diffXZ), 0.001);
    const pTo = mul(diffXZ, div(1, len));
    const pAng = mul(negate(mix(0, uInteractionStrength, pFall)), uInteractionRepel);
    const dispWorld = mul(pTo, pAng);
    const dispLocal = modelWorldMatrixInverse.mul(vec4(dispWorld, 0)).xyz;
    pos = add(pos, dispLocal);
    return pos;
  })();
  const centerMesh = new THREE.InstancedMesh(centerInstancedGeo, centerMat, count);
  centerMesh.frustumCulled = false;
  centerMesh.renderOrder = -1;
  for (let i = 0; i < count; i++) {
    dummy.position.set(off[i * 3], off[i * 3 + 1] + flowerHeight[i], off[i * 3 + 2]);
    dummy.rotation.set(0, flowerRotation[i], 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    centerMesh.setMatrixAt(i, dummy.matrix);
  }
  centerMesh.instanceMatrix.needsUpdate = true;
  flowerGroup.add(centerMesh);

  const stemBaseGeo = new THREE.CylinderGeometry(p.stemRadius * 1.1, p.stemRadius, 1, 6, 16);
  const stemInstancedGeo = new THREE.InstancedBufferGeometry().copy(stemBaseGeo);
  stemInstancedGeo.instanceCount = count;
  stemInstancedGeo.setAttribute("aStemIndex", new THREE.InstancedBufferAttribute(new Float32Array(flowerIndex), 1));
  stemInstancedGeo.setAttribute("aStemHeight", new THREE.InstancedBufferAttribute(new Float32Array(flowerHeight), 1));
  stemInstancedGeo.setAttribute("instancePos", new THREE.InstancedBufferAttribute(instancePosArr, 3));
  const uStemTime = uniform(0);
  const uStemColorBase = uniform(new THREE.Color(p.stemColor).convertSRGBToLinear());
  const uStemColorTop = uniform(new THREE.Color(p.stemColorTop).convertSRGBToLinear());
  const vStemHeightNorm = varying(float(0), "vStemHeightNorm");
  const stemMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  stemMat.colorNode = mix(uStemColorBase, uStemColorTop, vStemHeightNorm);
  stemMat.positionNode = Fn(() => {
    const aIdx = attribute("aStemIndex", "float");
    const aHeight = attribute("aStemHeight", "float");
    const instancePosAttr = attribute("instancePos", "vec3");
    const heightPct = add(positionLocal.y, 0.5);
    vStemHeightNorm.assign(heightPct);
    const topFactor = mul(heightPct, heightPct);
    const baseBend = mul(
      mul(sub(1, heightPct), sub(1, heightPct)),
      p.stemBaseBend,
      aHeight,
      0.5
    );
    const phase = add(mul(uStemTime, windSpeed), mul(aIdx, 1.2), windDir);
    const bend = mul(sin(phase), windStr, aHeight, topFactor);
    const micro = mul(sin(add(mul(phase, 2.3), mul(aIdx, 3))), 0.06, windStr, aHeight, topFactor);
    const amount = add(bend, micro);
    const windX = add(mul(cos(windDir), amount), mul(cos(add(windDir, 0.5)), baseBend));
    const windZ = add(mul(sin(windDir), amount), mul(sin(add(windDir, 0.5)), baseBend));
    let pos = add(positionLocal, vec3(windX, 0, windZ));
    // Player interaction (stem bends more at top)
    const reedBaseWorld = instancePosAttr;
    const pDist = length(sub(reedBaseWorld.xz, uTrailCenter));
    const pHD = abs(sub(reedBaseWorld.y, uPlayerPos.y));
    const distFalloff = mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, pDist));
    const heightFalloff = smoothstep(uInteractionHThresh, 0, pHD);
    const pFall = mul(distFalloff, heightFalloff);
    const diffXZ = sub(vec3(reedBaseWorld.x, 0, reedBaseWorld.z), vec3(uTrailCenter.x, 0, uTrailCenter.y));
    const len = max(length(diffXZ), 0.001);
    const pTo = mul(diffXZ, div(1, len));
    const pAng = mul(negate(mix(0, uInteractionStrength, pFall)), uInteractionRepel);
    const pushAmount = mul(pAng, topFactor);
    const dispWorld = mul(pTo, pushAmount);
    const dispLocal = modelWorldMatrixInverse.mul(vec4(dispWorld, 0)).xyz;
    pos = add(pos, dispLocal);
    return pos;
  })();
  const stemMesh = new THREE.InstancedMesh(stemInstancedGeo, stemMat, count);
  stemMesh.frustumCulled = false;
  const r = p.stemRadius * 1.05;
  for (let i = 0; i < count; i++) {
    const h = flowerHeight[i];
    dummy.position.set(off[i * 3], off[i * 3 + 1] + h / 2, off[i * 3 + 2]);
    dummy.scale.set(1, h, 1);
    dummy.rotation.set(0, flowerRotation[i], 0);
    dummy.updateMatrix();
    stemMesh.setMatrixAt(i, dummy.matrix);
  }
  stemMesh.instanceMatrix.needsUpdate = true;
  flowerGroup.add(stemMesh);

  const leafScale = Math.max(0.01, p.stemLeafScale);
  const leafGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
  leafGeo.scale(leafScale * 0.4, leafScale, 1);
  leafGeo.translate(0, -0.5 * leafScale, 0);
  leafGeo.rotateX(-Math.PI / 2);
  const leafInstancedGeo = new THREE.InstancedBufferGeometry().copy(leafGeo);
  leafInstancedGeo.instanceCount = count * 2;
  const leafMat = new THREE.MeshStandardMaterial({
    map: petalTex,
    alphaMap: petalTex,
    color: p.stemColor,
    transparent: true,
    alphaTest: 0.01,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const leafMesh = new THREE.InstancedMesh(leafInstancedGeo, leafMat, count * 2);
  leafMesh.frustumCulled = false;
  for (let i = 0; i < count; i++) {
    const h = flowerHeight[i];
    const stemY = off[i * 3 + 1] + h * 0.18;
    const tilt = (hash(i * 37) - 0.5) * 0.3;
    for (let L = 0; L < 2; L++) {
      const angle = hash(i * 47 + L * 13) * Math.PI * 2;
      dummy.position.set(
        off[i * 3] + r * Math.cos(angle),
        stemY,
        off[i * 3 + 2] + r * Math.sin(angle)
      );
      dummy.rotation.set(tilt, angle, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      leafMesh.setMatrixAt(i * 2 + L, dummy.matrix);
    }
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  flowerGroup.add(leafMesh);

  scene.add(flowerGroup);

  function update(elapsed) {
    const t = elapsed ?? 0;
    uFlowerTime.value = t;
    uStemTime.value = t;
  }

  return { flowerGroup, update, flowerCount: count };
}
