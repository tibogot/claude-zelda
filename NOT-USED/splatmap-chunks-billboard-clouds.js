import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  texture,
  uv,
  mix,
  pow,
  float,
  saturate,
  mul,
  uniform,
  attribute,
} from "three/tsl";
import { PARAMS } from "./splatmap-chunks-params.js";

/**
 * Billboard clouds (Genshin/Zelda-style).
 * Instanced camera-facing quads with TSL shading, manual frustum cull,
 * no per-frame sort.
 */
export function createBillboardClouds(scene) {
  const MAX_INSTANCES = 800;
  const cloudTexLoader = new THREE.TextureLoader();
  const cloudTex = cloudTexLoader.load(
    "https://rawcdn.githack.com/pmndrs/drei-assets/9225a9f1fbd449d9411125c2f419b843d0308c9f/cloud.png",
  );
  cloudTex.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.PlaneGeometry(1, 1);
  const opacityArr = new Float32Array(MAX_INSTANCES);
  geometry.setAttribute(
    "cloudOpacity",
    new THREE.InstancedBufferAttribute(opacityArr, 1),
  );

  const BC = PARAMS.sky.billboardClouds;
  const uLit = uniform(
    new THREE.Color(BC.colorLit).convertSRGBToLinear(),
  );
  const uShadow = uniform(
    new THREE.Color(BC.colorShadow).convertSRGBToLinear(),
  );
  const uSunset = uniform(
    new THREE.Color(BC.sunsetTint).convertSRGBToLinear(),
  );
  const uShadowStr = uniform(BC.shadowStrength);
  const uSunsetStr = uniform(BC.sunsetStrength);
  const uMasterOpacity = uniform(BC.opacity);
  const uSunElev = uniform(0.0);

  const tex = texture(cloudTex, uv());
  const opacityAttr = attribute("cloudOpacity");
  // Fake vertical lighting: bottom = shadow, top = lit (flat-bottom cumulus)
  const vGrad = saturate(uv().y);
  const shaded = mix(uShadow, uLit, pow(vGrad, float(1.4)));
  const shadedMixed = mix(uLit, shaded, uShadowStr);
  const withSunset = mix(shadedMixed, uSunset, uSunElev.mul(uSunsetStr));

  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  mat.colorNode = withSunset.mul(tex.rgb);
  mat.opacityNode = tex.a.mul(opacityAttr).mul(uMasterOpacity);

  const mesh = new THREE.InstancedMesh(geometry, mat, MAX_INSTANCES);
  mesh.count = 0;
  mesh.frustumCulled = false; // we cull per-instance manually
  mesh.renderOrder = 5;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  const segments = [];
  // Pre-allocated visible buffer to avoid per-frame allocations
  const visible = new Array(MAX_INSTANCES);
  for (let i = 0; i < MAX_INSTANCES; i++) {
    visible[i] = { x: 0, y: 0, z: 0, scale: 0, dist: 0, alpha: 0 };
  }
  const sortIdx = new Array(MAX_INSTANCES);
  for (let i = 0; i < MAX_INSTANCES; i++) sortIdx[i] = i;
  const _frustum = new THREE.Frustum();
  const _projScreenMat = new THREE.Matrix4();
  const _dummy = new THREE.Object3D();
  const _tmpPos = new THREE.Vector3();
  const _tmpSphere = new THREE.Sphere();
  let _sortVCount = 0;
  const _sortCmp = (a, b) => visible[b].dist - visible[a].dist;

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function rebuild() {
    const P = PARAMS.sky.billboardClouds;
    segments.length = 0;
    const rand = mulberry32(0xc10d5);
    const targetCount = Math.min(
      P.cloudCount * P.segmentsPerCloud,
      MAX_INSTANCES,
    );
    for (let c = 0; c < P.cloudCount; c++) {
      const cx = (rand() - 0.5) * P.spread;
      const cz = (rand() - 0.5) * P.spread;
      const cy = P.altitude + (rand() - 0.5) * 2 * P.altitudeJitter;
      for (let s = 0; s < P.segmentsPerCloud; s++) {
        if (segments.length >= targetCount) break;
        const ang = rand() * Math.PI * 2;
        // Sqrt-ish distribution keeps cluster centers denser than edges
        const r = Math.pow(rand(), 0.7) * P.clusterRadius;
        const ox = Math.cos(ang) * r;
        const oz = Math.sin(ang) * r;
        const oy = (rand() - 0.5) * 20;
        const scale = P.scaleMin + rand() * (P.scaleMax - P.scaleMin);
        segments.push({
          cx,
          cy,
          cz,
          ox,
          oy,
          oz,
          scale,
          phase: rand() * Math.PI * 2,
        });
      }
    }
  }
  rebuild();

  let windPhase = 0;

  function update(dtSec, cameraRef, sunDirRef, appT) {
    const P = PARAMS.sky.billboardClouds;
    if (!P.enabled || segments.length === 0) {
      mesh.count = 0;
      mesh.visible = false;
      return;
    }
    mesh.visible = true;

    uLit.value.set(P.colorLit).convertSRGBToLinear();
    uShadow.value.set(P.colorShadow).convertSRGBToLinear();
    uSunset.value.set(P.sunsetTint).convertSRGBToLinear();
    uShadowStr.value = P.shadowStrength;
    uSunsetStr.value = P.sunsetStrength;
    uMasterOpacity.value = P.opacity;
    uSunElev.value = THREE.MathUtils.clamp(1 - sunDirRef.y * 2.5, 0, 1);

    const windRad = (P.windAngle * Math.PI) / 180;
    const wx = Math.cos(windRad);
    const wz = Math.sin(windRad);
    windPhase += dtSec * P.windSpeed;
    const halfSpread = P.spread * 0.5;

    _projScreenMat.multiplyMatrices(
      cameraRef.projectionMatrix,
      cameraRef.matrixWorldInverse,
    );
    _frustum.setFromProjectionMatrix(_projScreenMat);

    const camQuat = cameraRef.quaternion;
    const camPos = cameraRef.position;
    const squash = P.verticalSquash;
    const fadeNear = Math.max(1, P.fadeNear);
    const fadeFar = Math.max(fadeNear + 1, P.fadeFar);
    const fadeFarStart = fadeFar * 0.75;

    // Pass 1: frustum-cull + distance-fade → pre-allocated visible list
    let vCount = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      let px = seg.cx + seg.ox + wx * windPhase;
      let pz = seg.cz + seg.oz + wz * windPhase;
      px =
        ((((px + halfSpread) % P.spread) + P.spread) % P.spread) -
        halfSpread;
      pz =
        ((((pz + halfSpread) % P.spread) + P.spread) % P.spread) -
        halfSpread;
      const py =
        seg.cy + seg.oy + Math.sin(appT * 0.3 + seg.phase) * P.drift;

      const dx = px - camPos.x;
      const dy = py - camPos.y;
      const dz = pz - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > fadeFar) continue;

      _tmpSphere.center.set(px, py, pz);
      _tmpSphere.radius = seg.scale;
      if (!_frustum.intersectsSphere(_tmpSphere)) continue;

      let alpha = 1.0;
      if (dist < fadeNear) alpha = dist / fadeNear;
      if (dist > fadeFarStart)
        alpha *= 1 - (dist - fadeFarStart) / (fadeFar - fadeFarStart);

      const v = visible[vCount];
      v.x = px;
      v.y = py;
      v.z = pz;
      v.scale = seg.scale;
      v.dist = dist;
      v.alpha = alpha;
      vCount++;
      if (vCount >= MAX_INSTANCES) break;
    }

    // Pass 2: sort far→near via numeric index array.
    // Truncating .length is safe here — sortIdx holds only numbers
    // that get rewritten on every frame.
    for (let i = 0; i < vCount; i++) sortIdx[i] = i;
    sortIdx.length = vCount;
    if (vCount > 1) sortIdx.sort(_sortCmp);
    sortIdx.length = MAX_INSTANCES;

    // Pass 3: upload matrices + per-instance opacity (far→near)
    for (let i = 0; i < vCount; i++) {
      const v = visible[sortIdx[i]];
      _dummy.position.set(v.x, v.y, v.z);
      _dummy.quaternion.copy(camQuat);
      _dummy.scale.set(v.scale, v.scale * squash, v.scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      opacityArr[i] = v.alpha;
    }

    mesh.count = vCount;
    if (vCount > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      geometry.attributes.cloudOpacity.needsUpdate = true;
    }
  }

  return { mesh, rebuild, update };
}
