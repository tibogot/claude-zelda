import * as THREE from "three";
import {
  Fn,
  uniform,
  float,
  positionLocal,
  positionWorld,
  cameraPosition,
  instancedArray,
  texture,
  uv,
  saturate,
  div,
  sub,
  add,
  mul,
  length,
  smoothstep,
  select,
  screenCoordinate,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bakeAtlas } from "./atlasBaking.js";
import { isFlatGeometry } from "./geometryHelpers.js";
import {
  uFrameOffset,
  uWindTime,
  uWindStrength,
  uWindSpeed,
  uWindDirection,
  IGN,
  windDisplacement,
} from "./tslWind.js";
import { createImpostorMaterial } from "./impostorMaterial.js";

const _draco = new DRACOLoader();
_draco.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);
const _gltf = new GLTFLoader();
_gltf.setDRACOLoader(_draco);

export async function createOctahedralImpostorForest(opts = {}) {
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
  } = opts;

  const iOpts = {
    spritesPerSide: impostorSettings.spritesPerSide ?? 12,
    textureSize: impostorSettings.textureSize ?? 2048,
    alphaClamp: impostorSettings.alphaClamp ?? 0.1,
    alphaTest: impostorSettings.alphaTest ?? 0.05,
    fadeRange: impostorSettings.fadeRange ?? 8,
    lod2Distance: impostorSettings.lod2Distance ?? 150,
    lightScale: impostorSettings.lightScale ?? 1.0,
    bakeOnlyLargestMesh: impostorSettings.bakeOnlyLargestMesh ?? false,
    sphereMargin: impostorSettings.sphereMargin ?? 1.05,
    normalStrength: impostorSettings.normalStrength ?? 1.0,
    rimStrength: impostorSettings.rimStrength ?? 0.14,
    rimPower: impostorSettings.rimPower ?? 3.0,
    rimColor: impostorSettings.rimColor ?? null,
    diffuseWrap: impostorSettings.diffuseWrap ?? 0.0,
    receiveShadow: impostorSettings.receiveShadow ?? false,
    enableAO: impostorSettings.enableAO ?? false,
    edgeSmoothScale: impostorSettings.edgeSmoothScale ?? 1.5,
  };

  const _uSunDir = uniform(new THREE.Vector3(-1.0, 0.55, 1.0).normalize());
  const _uSunColor = uniform(new THREE.Vector3(0.85, 0.78, 0.6));
  const _uAmbColor = uniform(new THREE.Vector3(0.35, 0.4, 0.5));
  const _uHemiSkyColor = uniform(new THREE.Vector3(0.4, 0.45, 0.5));
  const _uHemiGroundColor = uniform(new THREE.Vector3(0.25, 0.3, 0.2));

  let _lodDist = lodDistance;
  let _lod2Dist = iOpts.lod2Distance;
  let _fadeRange = iOpts.fadeRange;
  const _uLodDist = uniform(float(_lodDist));
  const _uFadeRange = uniform(float(_fadeRange));
  const _uLod2Dist = uniform(float(_lod2Dist));

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

  const bakeResult = bakeAtlas(root, {
    textureSize: iOpts.textureSize,
    spritesPerSide: iOpts.spritesPerSide,
    alphaTest: iOpts.alphaTest,
    bakeOnlyLargestMesh: iOpts.bakeOnlyLargestMesh,
    sphereMargin: iOpts.sphereMargin,
  });
  const { colorTex, normalTex, roughnessMetalTex, aoTex, sphere } = bakeResult;
  const impostorScale = sphere.radius * 2 * treeScale;
  const sphereCenter = sphere.center.clone().multiplyScalar(treeScale);

  const uNearLodDist = uniform(float(lodDistance));
  const uNearFadeRange = uniform(float(iOpts.fadeRange));

  const leafGeos = [],
    leafMats = [],
    trunkGeos = [],
    trunkMats = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (isFlatGeometry(g)) return;
    const m = o.material;
    const name = (o.name + " " + (m?.name ?? "")).toLowerCase();
    const isLeaf =
      m?.transparent ||
      /leaf|leave|foliage|canopy|frond|branch/i.test(name) ||
      (m?.map && (m?.side === THREE.DoubleSide || m?.alphaTest > 0));
    g.computeBoundingBox();
    const geoMinY = g.boundingBox.min.y;
    const geoMaxY = g.boundingBox.max.y;
    const geoHeight = Math.max(0.1, geoMaxY - geoMinY);

    const nodeMat = new THREE.MeshStandardNodeMaterial({
      color: m?.color?.getHex?.() ?? 0x448833,
      roughness: m?.roughness ?? 0.8,
      metalness: m?.metalness ?? 0,
      map: m?.map ?? null,
      transparent: isLeaf,
      alphaTest: isLeaf ? lod0AlphaTest : 0.5,
      side: isLeaf ? THREE.DoubleSide : (m?.side ?? THREE.FrontSide),
      depthWrite: true,
    });

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

    const matMap = m?.map ?? null;
    nodeMat.alphaNode = Fn(() => {
      const dist = length(sub(positionWorld, cameraPosition));
      const fadeT = saturate(
        div(sub(add(uNearLodDist, uNearFadeRange), dist), uNearFadeRange),
      );
      const fadeTSoft = smoothstep(float(0.15), float(0.85), fadeT);
      const dither = IGN(screenCoordinate.xy);
      const baseAlpha = matMap ? texture(matMap, uv()).a : float(1.0);
      const ditheredAlpha = select(
        dither.greaterThan(fadeTSoft),
        float(0.0),
        baseAlpha,
      );
      const ramp = sub(
        float(1),
        smoothstep(uNearLodDist, add(uNearLodDist, uNearFadeRange), dist),
      );
      return mul(ditheredAlpha, ramp);
    })();

    if (isLeaf) {
      leafGeos.push(g);
      leafMats.push(nodeMat);
    } else {
      trunkGeos.push(g);
      trunkMats.push(nodeMat);
    }
  });

  const cx0 = centerPosition[0],
    cz0 = centerPosition[2];
  const posX = new Float32Array(treeCount);
  const posY = new Float32Array(treeCount);
  const posZ = new Float32Array(treeCount);
  const allNearMats = new Float32Array(treeCount * 16);
  const allImpostorMats = new Float32Array(treeCount * 16);
  const allCenters = new Float32Array(treeCount * 3);

  const _m = new THREE.Matrix4();
  const _sc = new THREE.Vector3(treeScale, treeScale, treeScale);

  for (let i = 0; i < treeCount; i++) {
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
    const wcy = y + sphereCenter.y;
    const wcz = z + sphereCenter.z;
    allCenters[i * 3] = wcx;
    allCenters[i * 3 + 1] = wcy;
    allCenters[i * 3 + 2] = wcz;
    _m.identity()
      .makeScale(impostorScale, impostorScale, impostorScale)
      .setPosition(wcx, wcy, wcz);
    _m.toArray(allImpostorMats, i * 16);
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
      treeCount,
    );
    im.castShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < treeCount; i++) {
      _m.fromArray(allNearMats, i * 16);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.count = treeCount;
    group.add(im);
    nearMeshes.push(im);
    return im;
  };
  makeNearMesh(trunkGeos, trunkMats);
  makeNearMesh(leafGeos, leafMats);

  const planeGeo = new THREE.PlaneGeometry(1, 1);

  const compactCenters = new Float32Array(treeCount * 4);
  const centersStorage = instancedArray(compactCenters, "vec4").setName(
    "impostorCenters",
  );

  const _uLightScale = uniform(float(iOpts.lightScale ?? 1.0));
  const _uNormStr = uniform(float(iOpts.normalStrength ?? 1.0));
  const _uRimStrength = uniform(float(iOpts.rimStrength ?? 0.14));
  const _uRimPower = uniform(float(iOpts.rimPower ?? 3.0));
  const _rimColorVec =
    iOpts.rimColor != null
      ? Array.isArray(iOpts.rimColor)
        ? new THREE.Vector3(
            iOpts.rimColor[0],
            iOpts.rimColor[1],
            iOpts.rimColor[2],
          )
        : iOpts.rimColor.clone()
      : new THREE.Vector3(0.4, 0.5, 0.65);
  const _uRimColor = uniform(_rimColorVec);
  const _uDiffuseWrap = uniform(float(iOpts.diffuseWrap ?? 0.0));
  const _uEnableAO = uniform(float(iOpts.enableAO ? 1 : 0));
  const _uEdgeSmoothScale = uniform(float(iOpts.edgeSmoothScale ?? 1.5));
  const _uAlphaClamp = uniform(float(iOpts.alphaClamp ?? 0.1));

  const _sunOpts = {
    sunDir: _uSunDir,
    sunColor: _uSunColor,
    ambColor: _uAmbColor,
    hemiSkyColor: _uHemiSkyColor,
    hemiGroundColor: _uHemiGroundColor,
    lightScale: _uLightScale,
    normStrUniform: _uNormStr,
    rimStrengthUniform: _uRimStrength,
    rimPowerUniform: _uRimPower,
    rimColorUniform: _uRimColor,
    diffuseWrapUniform: _uDiffuseWrap,
    aoTex,
    enableAOUniform: _uEnableAO,
    enableAO: iOpts.enableAO,
    edgeSmoothUniform: _uEdgeSmoothScale,
    alphaClampUniform: _uAlphaClamp,
  };
  const impostorMat = createImpostorMaterial(
    colorTex,
    normalTex,
    roughnessMetalTex,
    impostorScale,
    centersStorage,
    {
      ...iOpts,
      lodDistance,
      ..._sunOpts,
      lodDistUniform: _uLodDist,
      fadeRangeUniform: _uFadeRange,
    },
  );
  const impostorMesh = new THREE.InstancedMesh(
    planeGeo,
    impostorMat,
    treeCount,
  );
  impostorMesh.castShadow = false;
  impostorMesh.frustumCulled = false;
  impostorMesh.count = 0;
  group.add(impostorMesh);

  const wireframeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    depthTest: true,
    depthWrite: false,
  });
  const wireframeMesh = new THREE.InstancedMesh(
    planeGeo,
    wireframeMat,
    treeCount,
  );
  wireframeMesh.castShadow = false;
  wireframeMesh.frustumCulled = false;
  wireframeMesh.count = 0;
  wireframeMesh.visible = false;
  group.add(wireframeMesh);

  const compactCenters2 = new Float32Array(treeCount * 4);
  const centersStorage2 = instancedArray(compactCenters2, "vec4").setName(
    "megaCenters",
  );
  const megaMat = createImpostorMaterial(
    colorTex,
    normalTex,
    roughnessMetalTex,
    impostorScale,
    centersStorage2,
    {
      ...iOpts,
      lodDistance: iOpts.lod2Distance,
      mega: true,
      ..._sunOpts,
      lodDistUniform: _uLod2Dist,
      fadeRangeUniform: _uFadeRange,
    },
  );
  const megaMesh = new THREE.InstancedMesh(planeGeo, megaMat, treeCount);
  megaMesh.castShadow = false;
  megaMesh.frustumCulled = false;
  megaMesh.count = 0;
  group.add(megaMesh);

  const _compactNear = new Float32Array(treeCount * 16);
  const _cullSphere = new THREE.Sphere(
    new THREE.Vector3(),
    impostorScale * 0.5,
  );

  let innerDistSq, outerDistSq, inner2DistSq, outer2DistSq;
  function _recomputeThresholds() {
    innerDistSq = (_lodDist - _fadeRange) ** 2;
    outerDistSq = (_lodDist + _fadeRange) ** 2;
    inner2DistSq = (_lod2Dist - _fadeRange) ** 2;
    outer2DistSq = (_lod2Dist + _fadeRange) ** 2;
  }
  _recomputeThresholds();

  let _frameCount = 0;
  let _lastNearCount = 0,
    _lastLod1Count = 0,
    _lastLod2Count = 0;
  let _lastTime = performance.now();

  function update(camera, frustum) {
    _frameCount++;
    uFrameOffset.value = (_frameCount * 0.6180339887) % 1.0;
    const now = performance.now();
    const dt = (now - _lastTime) / 1000;
    _lastTime = now;
    uWindTime.value += dt;

    const cpx = camera.position.x;
    const cpy = camera.position.y;
    const cpz = camera.position.z;
    let nearCount = 0,
      farCount = 0,
      megaCount = 0;

    for (let i = 0; i < treeCount; i++) {
      if (frustum) {
        _cullSphere.center.set(posX[i], posY[i], posZ[i]);
        if (!frustum.intersectsSphere(_cullSphere)) continue;
      }
      const dx = posX[i] - cpx,
        dy = posY[i] - cpy,
        dz = posZ[i] - cpz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < outerDistSq) {
        for (let j = 0; j < 16; j++)
          _compactNear[nearCount * 16 + j] = allNearMats[i * 16 + j];
        nearCount++;
      }
      if (distSq >= innerDistSq && distSq < inner2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        impostorMesh.setMatrixAt(farCount, _m);
        compactCenters[farCount * 4] = allCenters[i * 3];
        compactCenters[farCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters[farCount * 4 + 2] = allCenters[i * 3 + 2];
        farCount++;
      }
      if (distSq >= inner2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        megaMesh.setMatrixAt(megaCount, _m);
        compactCenters2[megaCount * 4] = allCenters[i * 3];
        compactCenters2[megaCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters2[megaCount * 4 + 2] = allCenters[i * 3 + 2];
        megaCount++;
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
    wireframeMesh.count = farCount;
    for (let i = 0; i < farCount; i++) {
      impostorMesh.getMatrixAt(i, _m);
      wireframeMesh.setMatrixAt(i, _m);
    }
    wireframeMesh.instanceMatrix.needsUpdate = true;
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
    planeGeo.dispose();
    impostorMat.dispose();
    megaMat.dispose();
    wireframeMat.dispose();
    colorTex.dispose();
    normalTex.dispose();
    roughnessMetalTex.dispose();
    aoTex.dispose();
    group.remove(impostorMesh);
    group.remove(wireframeMesh);
    group.remove(megaMesh);
  }

  return {
    group,
    update,
    dispose,
    impostorMesh,
    updateSunDir: (v3) => _uSunDir.value.copy(v3),
    updateSunColor: (v3) => _uSunColor.value.copy(v3),
    updateAmbColor: (v3) => _uAmbColor.value.copy(v3),
    updateHemiColors: (skyV3, groundV3) => {
      _uHemiSkyColor.value.copy(skyV3);
      _uHemiGroundColor.value.copy(groundV3);
    },
    setLightScale: (v) => {
      _uLightScale.value = v;
    },
    setNormalStrength: (v) => {
      _uNormStr.value = v;
    },
    setRimStrength: (v) => {
      _uRimStrength.value = v;
    },
    setRimPower: (v) => {
      _uRimPower.value = v;
    },
    setRimColor: (r, g, b) => {
      _uRimColor.value.set(r, g, b);
    },
    setDiffuseWrap: (v) => {
      _uDiffuseWrap.value = v;
    },
    setEnableAO: (v) => {
      _uEnableAO.value = v ? 1 : 0;
    },
    setLodDistance: (d) => {
      _lodDist = d;
      _uLodDist.value = d;
      _recomputeThresholds();
    },
    setLod2Distance: (d) => {
      _lod2Dist = d;
      _uLod2Dist.value = d;
      _recomputeThresholds();
    },
    setFadeRange: (f) => {
      _fadeRange = f;
      _uFadeRange.value = f;
      _recomputeThresholds();
    },
    setAlphaClamp: (v) => {
      _uAlphaClamp.value = v;
    },
    setEdgeSmoothScale: (v) => {
      _uEdgeSmoothScale.value = v;
    },
    setLod0AlphaTest: (v) => {
      leafMats.forEach((mat) => {
        mat.alphaTest = v;
      });
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
    setWireframeVisible: (v) => {
      wireframeMesh.visible = !!v;
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
  };
}
