/**
 * Forest fly-through — octahedral-v3 bake + instanced impostor materials.
 * Near mesh / impostor / mega LOD tiers (same layout as octahedralImpostorForestWebgpu).
 */
import * as THREE from "three";
import {
  Fn,
  normalize,
  sub,
  mul,
  add,
  div,
  fract,
  clamp,
  saturate,
  texture,
  cameraPosition,
  positionWorld,
  positionLocal,
  float,
  uniform,
  select,
  length,
  mix,
  smoothstep,
  sin,
  vec2,
  vec3,
  instancedArray,
  screenCoordinate,
  uv,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  bakeAtlases,
  BAKE_SPHERE_MARGIN,
  QUALITY_PRESETS,
} from "./octahedral-v3/octahedral-core.js";
import { createInstancedImpostorMaterials } from "./octahedral-v3/octahedral-instanced.js";

const uFrameOffset = uniform(float(0));
const uWindTime = uniform(float(0));
const uWindStrength = uniform(float(0.3));
const uWindSpeed = uniform(float(1.0));
const uWindDirection = uniform(vec2(1.0, 0.3));

const IGN = Fn(([coord]) =>
  fract(
    mul(
      float(52.9829189),
      fract(
        add(
          add(mul(float(0.06711056), coord.x), mul(float(0.00583715), coord.y)),
          uFrameOffset,
        ),
      ),
    ),
  ),
);

const windDisplacement = Fn(([worldPos, heightFactor, seedOffset]) => {
  const windDir = normalize(vec3(uWindDirection.x, 0, uWindDirection.y));
  const phase = add(mul(uWindTime, uWindSpeed), mul(seedOffset, 0.1));
  const wave1 = sin(add(phase, mul(worldPos.x, 0.5)));
  const wave2 = sin(add(mul(phase, 1.3), mul(worldPos.z, 0.4)));
  const wave3 = sin(
    add(mul(phase, 0.7), mul(add(worldPos.x, worldPos.z), 0.3)),
  );
  const combined = mul(add(wave1, add(mul(wave2, 0.5), mul(wave3, 0.3))), 0.55);
  const strength = mul(
    mul(combined, uWindStrength),
    mul(heightFactor, heightFactor),
  );
  return mul(windDir, strength);
});

const _flatBox = new THREE.Box3();
const _flatSz = new THREE.Vector3();
function isFlatGeometry(g) {
  const pos = g.attributes.position;
  if (!pos) return false;
  if (pos.count <= 16) return true;
  _flatBox.setFromBufferAttribute(pos);
  _flatBox.getSize(_flatSz);
  const maxDim = Math.max(_flatSz.x, _flatSz.y, _flatSz.z);
  const minDim = Math.min(_flatSz.x, _flatSz.y, _flatSz.z);
  return maxDim > 0 && minDim / maxDim < 0.02;
}

function extractBakeData(obj) {
  const data = [];
  obj.updateMatrixWorld(true);
  obj.traverse((child) => {
    if (!child.isMesh) return;
    const geo = child.geometry.clone();
    geo.applyMatrix4(child.matrixWorld);
    if (isFlatGeometry(geo)) return;
    const mat = Array.isArray(child.material)
      ? child.material[0]
      : child.material;
    if (!mat) return;
    data.push({ geometry: geo, material: mat });
  });
  return data;
}

const _draco = new DRACOLoader();
_draco.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);
const _gltf = new GLTFLoader();
_gltf.setDRACOLoader(_draco);

function applyV3QualityPreset(uniforms, presetName, overrides = {}) {
  const preset = QUALITY_PRESETS[presetName] || QUALITY_PRESETS.High;
  uniforms.uUseBary.value = overrides.useBary ?? preset.useBary;
  uniforms.uUseParallax.value = overrides.useParallax ?? preset.useParallax;
  uniforms.uEdgeSmooth.value = overrides.edgeSmooth ?? preset.edgeSmooth;
}

export async function createOctahedralImpostorForestV3(
  renderer,
  dirLight,
  opts = {},
) {
  const {
    modelPath,
    modelScene: _modelSceneOpt = null,
    treeCount = 300,
    treeScale = 1,
    lodDistance = 80,
    radius = 250,
    minRadius = 30,
    centerPosition = [0, 0, 0],
    getTerrainHeight = null,
    lod0AlphaTest = 0.1,
    impostorSettings = {},
    cellPad = 4,
    skipNearMeshes = false,
    fixedPlacements = null,
    impostorStandalone = false,
    placementCapacity = null,
  } = opts;

  const skipNear = skipNearMeshes === true;
  const useFixed =
    Array.isArray(fixedPlacements) && fixedPlacements.length > 0;
  const capExtra =
    typeof placementCapacity === "number" && placementCapacity > 0
      ? Math.floor(placementCapacity)
      : 0;
  const capacity = useFixed
    ? Math.max(fixedPlacements.length, capExtra || fixedPlacements.length)
    : Math.max(1, treeCount | 0);

  const iOpts = {
    spritesPerSide: impostorSettings.spritesPerSide ?? 12,
    textureSize: impostorSettings.textureSize ?? 2048,
    alphaCutoff: impostorSettings.alphaCutoff ?? 0.1,
    alphaTest: impostorSettings.alphaTest ?? 0.05,
    fadeRange: impostorSettings.fadeRange ?? 8,
    lod2Distance: impostorSettings.lod2Distance ?? 150,
    bakeOnlyLargestMesh: impostorSettings.bakeOnlyLargestMesh ?? false,
    normalStrength: impostorSettings.normalStrength ?? 1.0,
    edgeSmoothScale: impostorSettings.edgeSmoothScale ?? 1.5,
    parallaxStrength: impostorSettings.parallaxStrength ?? 0.05,
    lodDither: impostorSettings.lodDither ?? 0,
    quality: impostorSettings.quality ?? "High",
    useBary: impostorSettings.useBary,
    useParallax: impostorSettings.useParallax,
    normRmBary: impostorSettings.normRmBary ?? false,
    cellDither: impostorSettings.cellDither ?? false,
    translucency: impostorSettings.translucency ?? 0.08,
    translucencyPower: impostorSettings.translucencyPower ?? 3,
    windAmp: impostorSettings.windAmp ?? 0.04,
    windFreq: impostorSettings.windFreq ?? 1.5,
    fullOctahedral: impostorSettings.fullOctahedral === true,
    exclusiveLod: impostorSettings.exclusiveLod !== false,
  };

  const grid = iOpts.spritesPerSide;
  const atlasSize = iOpts.textureSize;

  let _lodDist = lodDistance;
  let _lod2Dist = iOpts.lod2Distance;
  let _fadeRange = iOpts.fadeRange;
  let _lodDither = iOpts.lodDither;
  const _uLodDist = uniform(float(_lodDist));
  const _uFadeRange = uniform(float(_fadeRange));
  const _uLod2Dist = uniform(float(_lod2Dist));
  const _uLodDither = uniform(float(iOpts.lodDither));

  let root;
  if (_modelSceneOpt) {
    root = _modelSceneOpt;
  } else {
    const gltf = await new Promise((res, rej) =>
      _gltf.load(modelPath, res, undefined, rej),
    );
    root = gltf.scene;
  }
  root.updateMatrixWorld(true);

  let bakeMeshData = extractBakeData(root);
  if (!bakeMeshData.length) throw new Error("[ForestV3] No meshes to bake");

  if (iOpts.bakeOnlyLargestMesh && bakeMeshData.length > 1) {
    let best = null;
    let bestVol = 0;
    for (const entry of bakeMeshData) {
      entry.geometry.computeBoundingSphere();
      const v = entry.geometry.boundingSphere.radius ** 3;
      if (v > bestVol) {
        bestVol = v;
        best = entry;
      }
    }
    for (const e of bakeMeshData) {
      if (e !== best) e.geometry.dispose();
    }
    bakeMeshData = [best];
  }

  const cap = renderer.capabilities;
  const maxAniso =
    cap && typeof cap.getMaxAnisotropy === "function"
      ? cap.getMaxAnisotropy()
      : (cap?.maxAnisotropy ?? 8);
  const atlasResult = await bakeAtlases(renderer, bakeMeshData, {
    grid,
    atlasSize,
    maxAniso,
    cellPad,
    fullOctahedral: iOpts.fullOctahedral,
  });

  const bakeR = atlasResult.radius;
  const sphereCenter = atlasResult.center.clone().multiplyScalar(treeScale);
  const impostorScale = bakeR * 2 * treeScale;
  const groundLift = bakeR * treeScale * (1 - 1 / BAKE_SPHERE_MARGIN);

  const uNearLodDist = uniform(float(lodDistance));
  const uNearFadeRange = uniform(float(iOpts.fadeRange));
  const _uNearLodDither = uniform(float(iOpts.lodDither));

  const leafGeos = [];
  const leafMats = [];
  const trunkGeos = [];
  const trunkMats = [];

  if (!skipNear) {
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      if (isFlatGeometry(g)) return;
      const m = o.material;
      const mat0 = Array.isArray(m) ? m[0] : m;
      const name = (o.name + " " + (mat0?.name ?? "")).toLowerCase();
      const isLeaf =
        mat0?.transparent ||
        /leaf|leave|foliage|canopy|frond|branch/i.test(name) ||
        (mat0?.map &&
          (mat0?.side === THREE.DoubleSide || mat0?.alphaTest > 0));

      g.computeBoundingBox();
      const geoMinY = g.boundingBox.min.y;
      const geoMaxY = g.boundingBox.max.y;
      const geoHeight = Math.max(0.1, geoMaxY - geoMinY);

      const nodeMat = new THREE.MeshStandardNodeMaterial({
        color: mat0?.color?.getHex?.() ?? 0x448833,
        roughness: mat0?.roughness ?? 0.8,
        metalness: mat0?.metalness ?? 0,
        map: mat0?.map ?? null,
        // Alpha cutout — transparent:true alpha-blends overlapping leaf cards and
        // they cannot depth-sort (classic foliage artifact). Same fix as octahedral-v3 editor.
        transparent: false,
        alphaTest: isLeaf ? lod0AlphaTest : 0.5,
        side: isLeaf ? THREE.DoubleSide : (mat0?.side ?? THREE.FrontSide),
        depthWrite: true,
        forceSinglePass: isLeaf,
      });
      nodeMat.fog = true;

      if (isLeaf) {
        const uGeoMinY = uniform(float(geoMinY));
        const uGeoHeight = uniform(float(geoHeight));
        nodeMat.positionNode = Fn(() => {
          const heightFactor = saturate(
            div(sub(positionLocal.y, uGeoMinY), uGeoHeight),
          );
          const seedOffset = add(positionWorld.x, positionWorld.z);
          const windOffset = windDisplacement(
            positionWorld,
            heightFactor,
            seedOffset,
          );
          return add(positionLocal, windOffset);
        })();
      }

      const matMap = mat0?.map ?? null;
      if (isLeaf) {
        if (iOpts.exclusiveLod) {
          nodeMat.alphaNode = Fn(() =>
            matMap ? texture(matMap, uv()).a : float(1.0),
          )();
        } else {
          // Stochastic dither fade while crossfade overlap is active.
          nodeMat.alphaNode = Fn(() => {
            const dist = length(sub(positionWorld, cameraPosition));
            const baseAlpha = matMap ? texture(matMap, uv()).a : float(1.0);
            const fadeT = saturate(
              div(sub(add(uNearLodDist, uNearFadeRange), dist), uNearFadeRange),
            );
            const fadeTSoft = smoothstep(float(0.15), float(0.85), fadeT);
            const dither = IGN(screenCoordinate.xy);
            return select(dither.greaterThan(fadeTSoft), float(0.0), baseAlpha);
          })();
        }
      } else if (!iOpts.exclusiveLod) {
        nodeMat.alphaNode = Fn(() => {
          const dist = length(sub(positionWorld, cameraPosition));
          const wImp = smoothstep(
            sub(uNearLodDist, uNearFadeRange),
            add(uNearLodDist, uNearFadeRange),
            dist,
          );
          const wMesh = sub(float(1), wImp);
          const baseAlpha = matMap ? texture(matMap, uv()).a : float(1.0);
          const smoothA = mul(baseAlpha, wMesh);

          const fadeT = saturate(
            div(sub(add(uNearLodDist, uNearFadeRange), dist), uNearFadeRange),
          );
          const fadeTSoft = smoothstep(float(0.15), float(0.85), fadeT);
          const dither = IGN(screenCoordinate.xy);
          const ditheredAlpha = select(
            dither.greaterThan(fadeTSoft),
            float(0.0),
            baseAlpha,
          );
          const ramp = sub(
            float(1),
            smoothstep(uNearLodDist, add(uNearLodDist, uNearFadeRange), dist),
          );
          const legacyA = mul(ditheredAlpha, ramp);

          return mix(smoothA, legacyA, _uNearLodDither);
        })();
      }

      if (isLeaf) {
        leafGeos.push(g);
        leafMats.push(nodeMat);
      } else {
        trunkGeos.push(g);
        trunkMats.push(nodeMat);
      }
    });
  }

  const cx0 = centerPosition[0];
  const cz0 = centerPosition[2];
  const posX = new Float32Array(capacity);
  const posY = new Float32Array(capacity);
  const posZ = new Float32Array(capacity);
  const allNearMats = new Float32Array(capacity * 16);
  const allImpostorMats = new Float32Array(capacity * 16);
  const allCenters = new Float32Array(capacity * 3);

  const _m = new THREE.Matrix4();
  const _sc = new THREE.Vector3(treeScale, treeScale, treeScale);
  const _scPer = new THREE.Vector3();
  const _sphereScaled = new THREE.Vector3();

  let placementCount = capacity;

  function applyPlacementsFromArray(arr) {
    const n = arr.length;
    if (n > capacity) {
      console.warn(
        "[ForestWebGPU] applyPlacementsFromArray: count exceeds capacity",
      );
      return false;
    }
    placementCount = n;
    for (let i = 0; i < n; i++) {
      const { x, y, z, scale: scRaw } = arr[i];
      const sc =
        typeof scRaw === "number" && Number.isFinite(scRaw) ? scRaw : 1;
      const ry = Math.PI * 2 * ((x * 13.7 + z * 7.3) % 1);
      posX[i] = x;
      posY[i] = y;
      posZ[i] = z;
      _scPer.set(sc, sc, sc);
      _sphereScaled.copy(atlasResult.center).multiplyScalar(sc);
      const impS = bakeR * 2 * sc;
      const gLift = bakeR * sc * (1 - 1 / BAKE_SPHERE_MARGIN);

      _m.makeRotationY(ry).scale(_scPer).setPosition(x, y, z);
      _m.toArray(allNearMats, i * 16);

      const wcx = x + _sphereScaled.x;
      const wcy = y + _sphereScaled.y + gLift;
      const wcz = z + _sphereScaled.z;
      allCenters[i * 3] = wcx;
      allCenters[i * 3 + 1] = wcy;
      allCenters[i * 3 + 2] = wcz;
      _m.identity().makeScale(impS, impS, impS).setPosition(wcx, wcy, wcz);
      _m.toArray(allImpostorMats, i * 16);
    }
    return true;
  }

  if (useFixed) {
    applyPlacementsFromArray(fixedPlacements);
  } else {
    placementCount = capacity;
    for (let i = 0; i < capacity; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = minRadius + Math.random() * (radius - minRadius);
      const x = cx0 + Math.cos(angle) * dist;
      const z = cz0 + Math.sin(angle) * dist;
      const y = getTerrainHeight ? getTerrainHeight(x, z) : centerPosition[1];

      posX[i] = x;
      posY[i] = y;
      posZ[i] = z;

      _m.makeRotationY(Math.random() * Math.PI * 2)
        .scale(_sc)
        .setPosition(x, y, z);
      _m.toArray(allNearMats, i * 16);

      const wcx = x + sphereCenter.x;
      const wcy = y + sphereCenter.y + groundLift;
      const wcz = z + sphereCenter.z;
      allCenters[i * 3] = wcx;
      allCenters[i * 3 + 1] = wcy;
      allCenters[i * 3 + 2] = wcz;
      _m.identity()
        .makeScale(impostorScale, impostorScale, impostorScale)
        .setPosition(wcx, wcy, wcz);
      _m.toArray(allImpostorMats, i * 16);
    }
  }

  const group = new THREE.Group();
  const nearMeshes = [];

  const makeNearMesh = (geos, mats) => {
    if (!geos.length) return null;
    const geo = mergeGeometries(geos, true);
    geo.computeBoundingSphere();
    const im = new THREE.InstancedMesh(
      geo,
      mats.length === 1 ? mats[0] : mats,
      capacity,
    );
    im.castShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < placementCount; i++) {
      _m.fromArray(allNearMats, i * 16);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.count = placementCount;
    group.add(im);
    nearMeshes.push(im);
    return im;
  };
  makeNearMesh(trunkGeos, trunkMats);
  makeNearMesh(leafGeos, leafMats);

  const planeGeo = new THREE.PlaneGeometry(1, 1);
  const compactCenters = new Float32Array(capacity * 4);
  const centersStorage = instancedArray(compactCenters, "vec4").setName(
    "impostorCentersW",
  );

  const matCommon = {
    impostorScale,
    gridVal: grid,
    atlasSize,
    cellPad,
    fullOctahedral: iOpts.fullOctahedral,
  };
  const texPack = {
    colorTex: atlasResult.colorTex,
    normalTex: atlasResult.normalTex,
    rmTex: atlasResult.rmTex,
    depthTex: atlasResult.depthTex,
  };

  function initImpostorUniforms(uniforms) {
    applyV3QualityPreset(uniforms, iOpts.quality, {
      useBary: iOpts.useBary,
      useParallax: iOpts.useParallax,
      edgeSmooth: iOpts.edgeSmoothScale,
    });
    uniforms.uNormStr.value = iOpts.normalStrength;
    uniforms.uAlphaCutoff.value = iOpts.alphaCutoff;
    uniforms.uParallaxStr.value = iOpts.parallaxStrength;
    uniforms.uNormRmBary.value = iOpts.normRmBary ? 1 : 0;
    uniforms.uUseDither.value = iOpts.cellDither ? 1 : 0;
    uniforms.uTransAmt.value = iOpts.translucency;
    uniforms.uTransPow.value = iOpts.translucencyPower;
    uniforms.uWindAmp.value = iOpts.windAmp;
    uniforms.uWindFreq.value = iOpts.windFreq;
  }

  const impostorPack = createInstancedImpostorMaterials(texPack, {
    ...matCommon,
    centersStorage,
    lodDistUniform: _uLodDist,
    fadeRangeUniform: _uFadeRange,
    lodDitherUniform: _uLodDither,
  });
  initImpostorUniforms(impostorPack.uniforms);
  const impostorMat = impostorPack.mainMat;

  const impostorMesh = new THREE.InstancedMesh(
    planeGeo,
    impostorMat,
    capacity,
  );
  impostorMesh.castShadow = false;
  impostorMesh.frustumCulled = false;
  impostorMesh.count = 0;
  group.add(impostorMesh);

  const compactCenters2 = new Float32Array(capacity * 4);
  const centersStorage2 = instancedArray(compactCenters2, "vec4").setName(
    "megaCentersW",
  );

  const megaPack = createInstancedImpostorMaterials(texPack, {
    ...matCommon,
    centersStorage: centersStorage2,
    lodDistUniform: _uLod2Dist,
    fadeRangeUniform: _uFadeRange,
    lodDitherUniform: _uLodDither,
  });
  initImpostorUniforms(megaPack.uniforms);
  const megaMat = megaPack.mainMat;

  if (iOpts.exclusiveLod && !impostorStandalone) {
    // CPU picks one LOD per tree; shader LOD fade would zero opacity at the boundary.
    _uLodDist.value = -1e9;
    _uLod2Dist.value = -1e9;
    _uFadeRange.value = 100;
    _uLodDither.value = 0;
  }

  if (impostorStandalone) {
    impostorPack.uniforms.uLodDist.value = -1e9;
    impostorPack.uniforms.uFadeRange.value = 100;
    impostorPack.uniforms.uLodDither.value = 0;
    megaPack.uniforms.uLodDist.value = -1e9;
    megaPack.uniforms.uFadeRange.value = 100;
    megaPack.uniforms.uLodDither.value = 0;
  }

  const megaMesh = new THREE.InstancedMesh(planeGeo, megaMat, capacity);
  megaMesh.castShadow = false;
  megaMesh.frustumCulled = false;
  megaMesh.count = 0;
  group.add(megaMesh);

  const _compactNear = new Float32Array(capacity * 16);
  const _cullSphere = new THREE.Sphere(new THREE.Vector3(), impostorScale * 0.5);

  let innerDistSq, outerDistSq, inner2DistSq, outer2DistSq, lodDistSq, lod2DistSq;
  function _recomputeThresholds() {
    lodDistSq = _lodDist ** 2;
    lod2DistSq = _lod2Dist ** 2;
    innerDistSq = (_lodDist - _fadeRange) ** 2;
    outerDistSq = (_lodDist + _fadeRange) ** 2;
    inner2DistSq = (_lod2Dist - _fadeRange) ** 2;
    outer2DistSq = (_lod2Dist + _fadeRange) ** 2;
  }
  _recomputeThresholds();

  let _frameCount = 0;
  let _lastNearCount = 0;
  let _lastLod1Count = 0;
  let _lastLod2Count = 0;
  let _lastTime = performance.now();

  function update(camera, frustum) {
    _frameCount++;
    uFrameOffset.value = (_frameCount * 0.6180339887) % 1.0;

    const now = performance.now();
    const dt = (now - _lastTime) / 1000;
    _lastTime = now;
    uWindTime.value += dt;
    impostorPack.uniforms.uTime.value += dt;
    megaPack.uniforms.uTime.value += dt;

    const cpx = camera.position.x;
    const cpy = camera.position.y;
    const cpz = camera.position.z;

    let nearCount = 0;
    let farCount = 0;
    let megaCount = 0;

    for (let i = 0; i < placementCount; i++) {
      if (frustum) {
        _cullSphere.center.set(posX[i], posY[i], posZ[i]);
        if (!frustum.intersectsSphere(_cullSphere)) continue;
      }

      const dx = posX[i] - cpx;
      const dy = posY[i] - cpy;
      const dz = posZ[i] - cpz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (iOpts.exclusiveLod) {
        if (distSq < lodDistSq) {
          for (let j = 0; j < 16; j++)
            _compactNear[nearCount * 16 + j] = allNearMats[i * 16 + j];
          nearCount++;
        } else if (distSq < lod2DistSq) {
          _m.fromArray(allImpostorMats, i * 16);
          impostorMesh.setMatrixAt(farCount, _m);
          compactCenters[farCount * 4] = allCenters[i * 3];
          compactCenters[farCount * 4 + 1] = allCenters[i * 3 + 1];
          compactCenters[farCount * 4 + 2] = allCenters[i * 3 + 2];
          compactCenters[farCount * 4 + 3] = 0;
          farCount++;
        } else {
          _m.fromArray(allImpostorMats, i * 16);
          megaMesh.setMatrixAt(megaCount, _m);
          compactCenters2[megaCount * 4] = allCenters[i * 3];
          compactCenters2[megaCount * 4 + 1] = allCenters[i * 3 + 1];
          compactCenters2[megaCount * 4 + 2] = allCenters[i * 3 + 2];
          compactCenters2[megaCount * 4 + 3] = 0;
          megaCount++;
        }
      } else if (distSq < outerDistSq) {
        for (let j = 0; j < 16; j++)
          _compactNear[nearCount * 16 + j] = allNearMats[i * 16 + j];
        nearCount++;
      }

      if (!iOpts.exclusiveLod) {
        if (distSq >= innerDistSq && distSq < inner2DistSq) {
          _m.fromArray(allImpostorMats, i * 16);
          impostorMesh.setMatrixAt(farCount, _m);
          compactCenters[farCount * 4] = allCenters[i * 3];
          compactCenters[farCount * 4 + 1] = allCenters[i * 3 + 1];
          compactCenters[farCount * 4 + 2] = allCenters[i * 3 + 2];
          compactCenters[farCount * 4 + 3] = 0;
          farCount++;
        }

        if (distSq >= inner2DistSq) {
          _m.fromArray(allImpostorMats, i * 16);
          megaMesh.setMatrixAt(megaCount, _m);
          compactCenters2[megaCount * 4] = allCenters[i * 3];
          compactCenters2[megaCount * 4 + 1] = allCenters[i * 3 + 1];
          compactCenters2[megaCount * 4 + 2] = allCenters[i * 3 + 2];
          compactCenters2[megaCount * 4 + 3] = 0;
          megaCount++;
        }
      }
    }

    for (const nm of nearMeshes) {
      nm.instanceMatrix.array.set(_compactNear.subarray(0, nearCount * 16));
      nm.count = nearCount;
      nm.instanceMatrix.needsUpdate = true;
    }

    impostorMesh.count = farCount;
    impostorMesh.instanceMatrix.needsUpdate = true;
    centersStorage.value.needsUpdate = true;

    megaMesh.count = megaCount;
    megaMesh.instanceMatrix.needsUpdate = true;
    centersStorage2.value.needsUpdate = true;

    _lastNearCount = nearCount;
    _lastLod1Count = farCount;
    _lastLod2Count = megaCount;
  }

  function dispose() {
    for (const nm of nearMeshes) {
      nm.geometry.dispose();
      group.remove(nm);
    }
    impostorMat.dispose();
    megaMat.dispose();
    atlasResult.colorTex.dispose();
    atlasResult.normalTex.dispose();
    atlasResult.rmTex.dispose();
    atlasResult.depthTex.dispose();
    group.remove(impostorMesh);
    group.remove(megaMesh);
    planeGeo.dispose();
  }

  return {
    group,
    update,
    dispose,
    impostorMesh,
    impostorUniforms: impostorPack.uniforms,
    megaUniforms: megaPack.uniforms,
    updateSunDir: (v3) => {
      impostorPack.uniforms.uSunDir.value.copy(v3);
      megaPack.uniforms.uSunDir.value.copy(v3);
    },
    updateSunColor: (v3) => {
      impostorPack.uniforms.uSunColor.value.copy(v3);
      megaPack.uniforms.uSunColor.value.copy(v3);
    },
    setNormalStrength: (v) => {
      impostorPack.uniforms.uNormStr.value = v;
      megaPack.uniforms.uNormStr.value = v;
    },
    setAlphaCutoff: (v) => {
      impostorPack.uniforms.uAlphaCutoff.value = v;
      megaPack.uniforms.uAlphaCutoff.value = v;
    },
    setQualityPreset: (name, overrides = {}) => {
      applyV3QualityPreset(impostorPack.uniforms, name, overrides);
      applyV3QualityPreset(megaPack.uniforms, name, overrides);
    },
    setUseBary: (v) => {
      const n = v ? 1 : 0;
      impostorPack.uniforms.uUseBary.value = n;
      megaPack.uniforms.uUseBary.value = n;
    },
    setNormRmBary: (v) => {
      const n = v ? 1 : 0;
      impostorPack.uniforms.uNormRmBary.value = n;
      megaPack.uniforms.uNormRmBary.value = n;
    },
    setUseParallax: (v) => {
      const n = v ? 1 : 0;
      impostorPack.uniforms.uUseParallax.value = n;
      megaPack.uniforms.uUseParallax.value = n;
    },
    setCellDither: (v) => {
      const n = v ? 1 : 0;
      impostorPack.uniforms.uUseDither.value = n;
      megaPack.uniforms.uUseDither.value = n;
    },
    setLodDistance: (d) => {
      _lodDist = d;
      if (!iOpts.exclusiveLod) {
        _uLodDist.value = d;
        uNearLodDist.value = d;
      }
      _recomputeThresholds();
    },
    setLod2Distance: (d) => {
      _lod2Dist = d;
      if (!iOpts.exclusiveLod) {
        _uLod2Dist.value = d;
      }
      _recomputeThresholds();
    },
    setFadeRange: (f) => {
      _fadeRange = f;
      if (!iOpts.exclusiveLod) {
        _uFadeRange.value = f;
        uNearFadeRange.value = f;
      }
      _recomputeThresholds();
    },
    setLodDither: (v) => {
      _lodDither = v;
      if (!iOpts.exclusiveLod) {
        _uLodDither.value = v;
        _uNearLodDither.value = v;
      }
    },
    setTranslucency: (str, pow) => {
      impostorPack.uniforms.uTransAmt.value = str;
      impostorPack.uniforms.uTransPow.value = pow;
      megaPack.uniforms.uTransAmt.value = str;
      megaPack.uniforms.uTransPow.value = pow;
    },
    setEdgeSmoothScale: (v) => {
      impostorPack.uniforms.uEdgeSmooth.value = v;
      megaPack.uniforms.uEdgeSmooth.value = v;
    },
    setParallaxStrength: (v) => {
      impostorPack.uniforms.uParallaxStr.value = v;
      megaPack.uniforms.uParallaxStr.value = v;
    },
    setImpostorWind: (amp, freq) => {
      impostorPack.uniforms.uWindAmp.value = amp;
      impostorPack.uniforms.uWindFreq.value = freq;
      megaPack.uniforms.uWindAmp.value = amp;
      megaPack.uniforms.uWindFreq.value = freq;
    },
    setWindStrength: (v) => {
      uWindStrength.value = v;
    },
    setWindSpeed: (v) => {
      uWindSpeed.value = v;
    },
    setWindDirection: (x, z) => {
      uWindDirection.value.set(x, z);
    },
    setLodVisible: (tier, v) => {
      if (tier === 0) nearMeshes.forEach((m) => (m.visible = v));
      else if (tier === 1) impostorMesh.visible = v;
      else if (tier === 2) megaMesh.visible = v;
    },
    getLodCounts: () => ({
      near: _lastNearCount,
      lod1: _lastLod1Count,
      lod2: _lastLod2Count,
    }),
    capacity,
    getPlacementCount: () => placementCount,
    rebuildPlacements(arr) {
      if (!applyPlacementsFromArray(arr)) return false;
      for (let i = 0; i < placementCount; i++) {
        _m.fromArray(allImpostorMats, i * 16);
        impostorMesh.setMatrixAt(i, _m);
        megaMesh.setMatrixAt(i, _m);
      }
      for (const nm of nearMeshes) {
        for (let j = 0; j < placementCount; j++) {
          _m.fromArray(allNearMats, j * 16);
          nm.setMatrixAt(j, _m);
        }
        nm.count = placementCount;
        nm.instanceMatrix.needsUpdate = true;
      }
      impostorMesh.count = 0;
      megaMesh.count = 0;
      impostorMesh.instanceMatrix.needsUpdate = true;
      megaMesh.instanceMatrix.needsUpdate = true;
      centersStorage.value.needsUpdate = true;
      centersStorage2.value.needsUpdate = true;
      return true;
    },
    paintWriteImpostorSlot(dst, treeIdx) {
      _m.fromArray(allImpostorMats, treeIdx * 16);
      impostorMesh.setMatrixAt(dst, _m);
      compactCenters[dst * 4] = allCenters[treeIdx * 3];
      compactCenters[dst * 4 + 1] = allCenters[treeIdx * 3 + 1];
      compactCenters[dst * 4 + 2] = allCenters[treeIdx * 3 + 2];
      compactCenters[dst * 4 + 3] = 0;
    },
    paintWriteMegaSlot(dst, treeIdx) {
      _m.fromArray(allImpostorMats, treeIdx * 16);
      megaMesh.setMatrixAt(dst, _m);
      compactCenters2[dst * 4] = allCenters[treeIdx * 3];
      compactCenters2[dst * 4 + 1] = allCenters[treeIdx * 3 + 1];
      compactCenters2[dst * 4 + 2] = allCenters[treeIdx * 3 + 2];
      compactCenters2[dst * 4 + 3] = 0;
    },
    paintFinishImpostorMega(impostorWritten, megaWritten) {
      impostorMesh.count = impostorWritten;
      megaMesh.count = megaWritten;
      impostorMesh.instanceMatrix.needsUpdate = true;
      megaMesh.instanceMatrix.needsUpdate = true;
      centersStorage.value.needsUpdate = true;
      centersStorage2.value.needsUpdate = true;
    },
  };
}
