/**
 * fx-billboard-clouds.js
 * Genshin / Zelda-style instanced billboard clouds for the Ambient FX Editor.
 *
 * Exposes:
 *   createBillboardCloudFX(scene, shared)
 *   buildBillboardCloudUI(folder, state)
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  texture,
  uv,
  mix,
  pow,
  float,
  saturate,
  smoothstep,
  uniform,
  attribute,
  vec2,
  vec3,
  dot,
  normalize,
  oneMinus,
  sqrt,
  positionView,
  cameraNear,
  cameraFar,
  perspectiveDepthToViewZ,
  viewportDepthTexture,
} from "three/tsl";

const CLOUD_TEXTURE_URL = "textures/clouddrei.png";
const MAX_INSTANCES = 2400;

/** Default params tuned for the Ambient FX Editor preview scene. */
export const BILLBOARD_CLOUD_DEFAULTS = {
  enabled: true,
  seed: 0xc10d5,

  cloudCount: 45,
  segmentsPerCloud: 6,
  crossQuads: 1,

  spread: 110,
  followCamera: true,
  altitude: 16,
  altitudeJitter: 4,
  clusterRadius: 12,
  clusterHeight: 3,

  scaleMin: 5,
  scaleMax: 14,
  verticalSquash: 0.55,
  yLock: 0.4,

  windSpeed: 2.5,
  windAngle: 45,
  useSharedWind: true,
  drift: 1.2,

  fadeNear: 6,
  fadeFar: 95,

  opacity: 0.92,
  colorLit: "#ffffff",
  colorShadow: "#8ea8c8",
  shadowStrength: 0.55,
  gradPower: 1.4,
  sunLightStrength: 0.35,
  sphericalShading: true,
  sphericalDepth: 1.0,
  tileCount: 1,
  atlasFlipX: true,
  softParticles: true,
  softFadeDist: 2.0,
  sunsetTint: "#ffd6a8",
  sunsetStrength: 0.6,
  rimStrength: 0.22,
  rimPower: 2.5,
  horizonFogStrength: 0.35,
  horizonFogColor: "#b8deff",

  renderOrder: 5,
};

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

function wrapCoord(v, spread) {
  const half = spread * 0.5;
  return ((((v + half) % spread) + spread) % spread) - half;
}

/** Sun direction (world space, toward the sun). Matches ambient-fx-editor lighting. */
export function sunDirFromTimeOfDay(timeOfDay, target = new THREE.Vector3()) {
  const sunAngle = (timeOfDay - 0.25) * Math.PI * 2;
  const sunY = Math.sin(sunAngle);
  const sunX = Math.cos(sunAngle) * 0.5;
  return target.set(sunX, Math.max(sunY, 0.05), 0.35).normalize();
}

export function createBillboardCloudFX(scene, shared) {
  const params = { ...BILLBOARD_CLOUD_DEFAULTS };

  const cloudTexLoader = new THREE.TextureLoader();
  const cloudTex = cloudTexLoader.load(CLOUD_TEXTURE_URL);
  cloudTex.colorSpace = THREE.SRGBColorSpace;

  const geometry = new THREE.PlaneGeometry(1, 1);
  const opacityArr = new Float32Array(MAX_INSTANCES);
  const tileArr = new Float32Array(MAX_INSTANCES);
  const flipArr = new Float32Array(MAX_INSTANCES);
  geometry.setAttribute(
    "cloudOpacity",
    new THREE.InstancedBufferAttribute(opacityArr, 1),
  );
  geometry.setAttribute(
    "cloudTile",
    new THREE.InstancedBufferAttribute(tileArr, 1),
  );
  geometry.setAttribute(
    "cloudFlip",
    new THREE.InstancedBufferAttribute(flipArr, 1),
  );

  const uLit = uniform(
    new THREE.Color(params.colorLit).convertSRGBToLinear(),
  );
  const uShadow = uniform(
    new THREE.Color(params.colorShadow).convertSRGBToLinear(),
  );
  const uSunset = uniform(
    new THREE.Color(params.sunsetTint).convertSRGBToLinear(),
  );
  const uFog = uniform(
    new THREE.Color(params.horizonFogColor).convertSRGBToLinear(),
  );
  const uShadowStr = uniform(params.shadowStrength);
  const uSunsetStr = uniform(params.sunsetStrength);
  const uMasterOpacity = uniform(params.opacity);
  const uSunElev = uniform(0.0);
  const uGradPower = uniform(params.gradPower);
  const uSunLightStr = uniform(params.sunLightStrength);
  const uRimStr = uniform(params.rimStrength);
  const uRimPow = uniform(params.rimPower);
  const uFogStr = uniform(params.horizonFogStrength);
  const uSunDir = uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uCamRight = uniform(new THREE.Vector3(1, 0, 0));
  const uCamUp = uniform(new THREE.Vector3(0, 1, 0));
  const uCamFwd = uniform(new THREE.Vector3(0, 0, 1));
  const uSphericalMix = uniform(params.sphericalShading ? 1.0 : 0.0);
  const uSphericalDepth = uniform(params.sphericalDepth);
  const uTileCount = uniform(Math.max(1, params.tileCount));
  const uFlipEnabled = uniform(params.atlasFlipX ? 1.0 : 0.0);
  const uSoftEnabled = uniform(params.softParticles ? 1.0 : 0.0);
  const uSoftFadeDist = uniform(Math.max(0.01, params.softFadeDist));

  const opacityAttr = attribute("cloudOpacity");
  const tileIdxAttr = attribute("cloudTile");
  const flipAttr = attribute("cloudFlip");

  // Atlas UV: 1xN strip atlas. Per-instance tile index picks the column;
  // optional per-instance horizontal flip doubles variety for free.
  const baseUV = uv();
  const flipFactor = flipAttr.mul(uFlipEnabled);
  const sampleU = mix(baseUV.x, oneMinus(baseUV.x), flipFactor);
  const atlasU = sampleU.add(tileIdxAttr).div(uTileCount);
  const atlasUV = vec2(atlasU, baseUV.y);
  const tex = texture(cloudTex, atlasUV);

  const sunDirN = normalize(uSunDir);

  // --- Path A: legacy vertical-gradient lighting ---
  const vGrad = saturate(baseUV.y);
  const shadedA = mix(uShadow, uLit, pow(vGrad, uGradPower));
  const shadedAMixed = mix(uLit, shadedA, uShadowStr);
  const fakeUpA = vec3(0, pow(vGrad, 0.65), 0);
  const sunFaceA = saturate(dot(normalize(fakeUpA), sunDirN));
  const sunBoostedA = mix(shadedAMixed, uLit, sunFaceA.mul(uSunLightStr));
  const rimBandA = smoothstep(0.25, 0.45, vGrad).mul(
    oneMinus(smoothstep(0.72, 0.92, vGrad)),
  );
  const rimA = vec3(1, 0.98, 0.92).mul(
    rimBandA.mul(uRimStr).mul(pow(sunFaceA, uRimPow)),
  );

  // --- Path B: per-fragment spherical (puff) normal in world space ---
  // Treat each billboard as a hemisphere bulging toward the camera. Build a
  // world-space normal from centered UV + camera basis, then real N·L lighting.
  const cu = baseUV.x.sub(0.5).mul(2.0);
  const cv = baseUV.y.sub(0.5).mul(2.0);
  const r2 = saturate(cu.mul(cu).add(cv.mul(cv)));
  const nz = sqrt(oneMinus(r2)).mul(uSphericalDepth);
  const nWorld = normalize(
    uCamRight.mul(cu).add(uCamUp.mul(cv)).add(uCamFwd.mul(nz)),
  );
  const NdotL = dot(nWorld, sunDirN);
  // Wrap diffuse: clouds scatter light, so terminator sits at N·L ≈ -0.2 not 0.
  const litness = pow(saturate(NdotL.mul(0.5).add(0.5)), uGradPower);
  const shadedB = mix(uShadow, uLit, litness);
  const shadedBMixed = mix(uLit, shadedB, uShadowStr);
  const sunFaceB = saturate(NdotL);
  const sunBoostedB = mix(shadedBMixed, uLit, sunFaceB.mul(uSunLightStr));
  // Silver lining: silhouette edge × sun behind cloud.
  const edge = oneMinus(nz);
  const backlight = saturate(NdotL.negate());
  const rimB = vec3(1, 0.98, 0.92).mul(
    edge.mul(pow(backlight, uRimPow)).mul(uRimStr),
  );

  const sunBoosted = mix(sunBoostedA, sunBoostedB, uSphericalMix);
  const rim = mix(rimA, rimB, uSphericalMix);
  const withRim = sunBoosted.add(rim);

  const withSunset = mix(withRim, uSunset, uSunElev.mul(uSunsetStr));
  const fogged = mix(withSunset, uFog, uFogStr);

  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // Soft particles: fade alpha where the cloud fragment approaches the
  // opaque scene depth, killing the hard polygon edge at terrain intersections.
  // Both viewZ values are negative; cloud in front of geometry → cloudViewZ
  // is greater (less negative), so delta > 0 means "in front by delta units".
  const sceneViewZ = perspectiveDepthToViewZ(
    viewportDepthTexture(),
    cameraNear,
    cameraFar,
  );
  const depthDelta = positionView.z.sub(sceneViewZ);
  const softness = saturate(depthDelta.div(uSoftFadeDist));
  const softFactor = mix(float(1.0), softness, uSoftEnabled);

  mat.colorNode = fogged.mul(tex.rgb);
  mat.opacityNode = tex.a.mul(opacityAttr).mul(uMasterOpacity).mul(softFactor);

  const mesh = new THREE.InstancedMesh(geometry, mat, MAX_INSTANCES);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = params.renderOrder;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  scene.add(mesh);

  const segments = [];
  const visible = new Array(MAX_INSTANCES);
  for (let i = 0; i < MAX_INSTANCES; i++) {
    visible[i] = { x: 0, y: 0, z: 0, scale: 0, dist: 0, alpha: 0, tile: 0, flip: 0, yaw: 0, crossPath: 0 };
  }
  const sortIdx = new Array(MAX_INSTANCES);
  for (let i = 0; i < MAX_INSTANCES; i++) sortIdx[i] = i;

  const _frustum = new THREE.Frustum();
  const _projScreenMat = new THREE.Matrix4();
  const _dummy = new THREE.Object3D();
  const _tmpSphere = new THREE.Sphere();
  const _sunDir = new THREE.Vector3();
  const _qYBill = new THREE.Quaternion();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _sortCmp = (a, b) => visible[b].dist - visible[a].dist;

  let windPhase = 0;
  let camera = null;

  function syncUniforms() {
    uLit.value.set(params.colorLit).convertSRGBToLinear();
    uShadow.value.set(params.colorShadow).convertSRGBToLinear();
    uSunset.value.set(params.sunsetTint).convertSRGBToLinear();
    uFog.value.set(params.horizonFogColor).convertSRGBToLinear();
    uShadowStr.value = params.shadowStrength;
    uSunsetStr.value = params.sunsetStrength;
    uMasterOpacity.value = params.opacity;
    uGradPower.value = params.gradPower;
    uSunLightStr.value = params.sunLightStrength;
    uRimStr.value = params.rimStrength;
    uRimPow.value = params.rimPower;
    uFogStr.value = params.horizonFogStrength;
    uSphericalMix.value = params.sphericalShading ? 1.0 : 0.0;
    uSphericalDepth.value = params.sphericalDepth;
    uTileCount.value = Math.max(1, params.tileCount);
    uFlipEnabled.value = params.atlasFlipX ? 1.0 : 0.0;
    uSoftEnabled.value = params.softParticles ? 1.0 : 0.0;
    uSoftFadeDist.value = Math.max(0.01, params.softFadeDist);
    mesh.renderOrder = params.renderOrder;
  }

  function rebuild() {
    segments.length = 0;
    const rand = mulberry32(params.seed >>> 0);
    const targetCount = Math.min(
      params.cloudCount * params.segmentsPerCloud,
      MAX_INSTANCES,
    );

    for (let c = 0; c < params.cloudCount; c++) {
      const cx = (rand() - 0.5) * params.spread;
      const cz = (rand() - 0.5) * params.spread;
      const cy =
        params.altitude + (rand() - 0.5) * 2 * params.altitudeJitter;

      for (let s = 0; s < params.segmentsPerCloud; s++) {
        if (segments.length >= targetCount) break;
        const ang = rand() * Math.PI * 2;
        const r = Math.pow(rand(), 0.7) * params.clusterRadius;
        const ox = Math.cos(ang) * r;
        const oz = Math.sin(ang) * r;
        const oy = (rand() - 0.5) * params.clusterHeight;
        const scale =
          params.scaleMin + rand() * (params.scaleMax - params.scaleMin);
        const tileCount = Math.max(1, params.tileCount | 0);
        const tile = Math.floor(rand() * tileCount);
        const flip = rand() < 0.5 ? 1 : 0;
        segments.push({
          cx,
          cy,
          cz,
          ox,
          oy,
          oz,
          scale,
          phase: rand() * Math.PI * 2,
          tile,
          flip,
          baseYaw: rand() * Math.PI * 2,
        });
      }
    }
  }

  rebuild();
  syncUniforms();

  function update(dt, appT, sh) {
    if (!params.enabled || segments.length === 0 || !camera) {
      mesh.count = 0;
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    syncUniforms();

    sunDirFromTimeOfDay(sh.timeOfDay, _sunDir);
    uSunDir.value.copy(_sunDir);
    uSunElev.value = THREE.MathUtils.clamp(1 - _sunDir.y * 2.5, 0, 1);

    let windAngleDeg = params.windAngle;
    if (params.useSharedWind) {
      windAngleDeg =
        (Math.atan2(sh.windZ, sh.windX) * 180) / Math.PI;
    }
    const windRad = (windAngleDeg * Math.PI) / 180;
    const wx = Math.cos(windRad);
    const wz = Math.sin(windRad);
    const windMul = params.useSharedWind ? sh.windStrength : 1;
    windPhase += dt * params.windSpeed * windMul;

    _projScreenMat.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    _frustum.setFromProjectionMatrix(_projScreenMat);

    // Camera basis in world space (columns of camera.matrixWorld). Drives the
    // spherical-normal lighting in Path B — must update every frame.
    const cm = camera.matrixWorld.elements;
    uCamRight.value.set(cm[0], cm[1], cm[2]);
    uCamUp.value.set(cm[4], cm[5], cm[6]);
    uCamFwd.value.set(cm[8], cm[9], cm[10]);

    const camQuat = camera.quaternion;
    const camPos = camera.position;
    const squash = params.verticalSquash;
    const yLock = THREE.MathUtils.clamp(params.yLock, 0, 1);
    const yLockOn = yLock > 0;
    const yLockFull = yLock >= 1;
    const crossN = THREE.MathUtils.clamp(params.crossQuads | 0, 1, 3);
    const cardYawStep = Math.PI / crossN;
    const fadeNear = Math.max(1, params.fadeNear);
    const fadeFar = Math.max(fadeNear + 1, params.fadeFar);
    const fadeFarStart = fadeFar * 0.75;
    const camAnchorX = params.followCamera ? camPos.x : 0;
    const camAnchorZ = params.followCamera ? camPos.z : 0;

    let vCount = 0;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      let px = seg.cx + seg.ox + wx * windPhase + camAnchorX;
      let pz = seg.cz + seg.oz + wz * windPhase + camAnchorZ;
      px = wrapCoord(px, params.spread);
      pz = wrapCoord(pz, params.spread);
      const py =
        seg.cy + seg.oy + Math.sin(appT * 0.3 + seg.phase) * params.drift;

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
      if (dist > fadeFarStart) {
        alpha *= 1 - (dist - fadeFarStart) / (fadeFar - fadeFarStart);
      }

      if (crossN > 1) {
        // Cross-quads: fan out into N world-yaw-locked cards 180/N° apart.
        // yLock blends the cluster's yaw between baked-random and toward-camera.
        const yawToCam = Math.atan2(camPos.x - px, camPos.z - pz);
        let delta = yawToCam - seg.baseYaw;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        const yawBlend = seg.baseYaw + delta * yLock;
        for (let card = 0; card < crossN; card++) {
          if (vCount >= MAX_INSTANCES) break;
          const v = visible[vCount];
          v.x = px;
          v.y = py;
          v.z = pz;
          v.scale = seg.scale;
          v.dist = dist;
          v.alpha = alpha;
          v.tile = seg.tile;
          v.flip = seg.flip;
          v.yaw = yawBlend + card * cardYawStep;
          v.crossPath = 1;
          vCount++;
        }
      } else {
        const v = visible[vCount];
        v.x = px;
        v.y = py;
        v.z = pz;
        v.scale = seg.scale;
        v.dist = dist;
        v.alpha = alpha;
        v.tile = seg.tile;
        v.flip = seg.flip;
        v.yaw = 0;
        v.crossPath = 0;
        vCount++;
      }
      if (vCount >= MAX_INSTANCES) break;
    }

    for (let i = 0; i < vCount; i++) sortIdx[i] = i;
    sortIdx.length = vCount;
    if (vCount > 1) sortIdx.sort(_sortCmp);
    sortIdx.length = MAX_INSTANCES;

    for (let i = 0; i < vCount; i++) {
      const v = visible[sortIdx[i]];
      _dummy.position.set(v.x, v.y, v.z);
      if (v.crossPath) {
        // Cross-quad card: pre-computed world-Y yaw, fully Y-locked.
        _qYBill.setFromAxisAngle(_yAxis, v.yaw);
        _dummy.quaternion.copy(_qYBill);
      } else if (yLockOn) {
        // Y-axis billboard: quad rotates around world up to face camera in XZ,
        // staying vertical instead of rolling with camera pitch/roll.
        const yawToCam = Math.atan2(camPos.x - v.x, camPos.z - v.z);
        _qYBill.setFromAxisAngle(_yAxis, yawToCam);
        if (yLockFull) {
          _dummy.quaternion.copy(_qYBill);
        } else {
          _dummy.quaternion.copy(camQuat).slerp(_qYBill, yLock);
        }
      } else {
        _dummy.quaternion.copy(camQuat);
      }
      _dummy.scale.set(v.scale, v.scale * squash, v.scale);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      opacityArr[i] = v.alpha;
      tileArr[i] = v.tile;
      flipArr[i] = v.flip;
    }

    mesh.count = vCount;
    if (vCount > 0) {
      mesh.instanceMatrix.needsUpdate = true;
      geometry.attributes.cloudOpacity.needsUpdate = true;
      geometry.attributes.cloudTile.needsUpdate = true;
      geometry.attributes.cloudFlip.needsUpdate = true;
    }
  }

  function dispose(sc) {
    sc.remove(mesh);
    geometry.dispose();
    mat.dispose();
    cloudTex.dispose();
  }

  function setCamera(cam) {
    camera = cam;
  }

  function exportParams() {
    return JSON.parse(JSON.stringify(params));
  }

  function importParams(next) {
    Object.assign(params, next);
    syncUniforms();
    rebuild();
  }

  return {
    mesh,
    params,
    rebuild,
    update,
    dispose,
    setCamera,
    exportParams,
    importParams,
  };
}

export function buildBillboardCloudUI(folder, state) {
  const p = state.params;

  folder.addBinding(p, "enabled", { label: "Enabled" });

  folder
    .addButton({ title: "Rebuild layout" })
    .on("click", () => state.rebuild());

  const layout = folder.addFolder({ title: "Layout", expanded: true });
  layout.addBinding(p, "seed", {
    label: "Seed",
    min: 0,
    max: 0xffffffff,
    step: 1,
  });
  layout.addBinding(p, "cloudCount", {
    label: "Cloud clusters",
    min: 1,
    max: 150,
    step: 1,
  }).on("change", () => state.rebuild());
  layout.addBinding(p, "segmentsPerCloud", {
    label: "Segments / cluster",
    min: 1,
    max: 12,
    step: 1,
  }).on("change", () => state.rebuild());
  layout.addBinding(p, "crossQuads", {
    label: "Cross-quads / seg",
    min: 1,
    max: 3,
    step: 1,
  });
  layout.addBinding(p, "spread", {
    label: "Spread",
    min: 20,
    max: 400,
    step: 5,
  }).on("change", () => state.rebuild());
  layout.addBinding(p, "followCamera", {
    label: "Follow camera XZ",
  });
  layout.addBinding(p, "altitude", {
    label: "Altitude",
    min: 2,
    max: 80,
    step: 0.5,
  }).on("change", () => state.rebuild());
  layout.addBinding(p, "altitudeJitter", {
    label: "Altitude jitter",
    min: 0,
    max: 40,
    step: 0.5,
  }).on("change", () => state.rebuild());
  layout.addBinding(p, "clusterRadius", {
    label: "Cluster radius",
    min: 2,
    max: 80,
    step: 1,
  }).on("change", () => state.rebuild());
  layout.addBinding(p, "clusterHeight", {
    label: "Cluster height",
    min: 0,
    max: 40,
    step: 0.5,
  }).on("change", () => state.rebuild());

  const size = folder.addFolder({ title: "Size", expanded: true });
  size.addBinding(p, "scaleMin", {
    label: "Scale min",
    min: 1,
    max: 80,
    step: 0.5,
  }).on("change", () => state.rebuild());
  size.addBinding(p, "scaleMax", {
    label: "Scale max",
    min: 1,
    max: 120,
    step: 0.5,
  }).on("change", () => state.rebuild());
  size.addBinding(p, "verticalSquash", {
    label: "Vertical squash",
    min: 0.2,
    max: 1.2,
    step: 0.05,
  });
  size.addBinding(p, "yLock", {
    label: "Y-axis lock",
    min: 0,
    max: 1,
    step: 0.01,
  });

  const atlas = folder.addFolder({ title: "Atlas / variety", expanded: true });
  atlas.addBinding(p, "tileCount", {
    label: "Atlas tiles (1xN)",
    min: 1,
    max: 8,
    step: 1,
  }).on("change", () => state.rebuild());
  atlas.addBinding(p, "atlasFlipX", { label: "Random flip X" });

  const motion = folder.addFolder({ title: "Motion", expanded: true });
  motion.addBinding(p, "windSpeed", {
    label: "Wind speed",
    min: 0,
    max: 20,
    step: 0.1,
  });
  motion.addBinding(p, "windAngle", {
    label: "Wind angle °",
    min: 0,
    max: 360,
    step: 1,
  });
  motion.addBinding(p, "useSharedWind", {
    label: "Use env wind dir",
  });
  motion.addBinding(p, "drift", {
    label: "Vertical drift",
    min: 0,
    max: 8,
    step: 0.1,
  });

  const fade = folder.addFolder({ title: "Distance fade", expanded: true });
  fade.addBinding(p, "fadeNear", {
    label: "Fade near",
    min: 0,
    max: 200,
    step: 1,
  });
  fade.addBinding(p, "fadeFar", {
    label: "Fade far",
    min: 10,
    max: 500,
    step: 5,
  });
  fade.addBinding(p, "opacity", {
    label: "Master opacity",
    min: 0.05,
    max: 1,
    step: 0.01,
  });

  const soft = folder.addFolder({ title: "Soft particles", expanded: true });
  soft.addBinding(p, "softParticles", { label: "Enabled" });
  soft.addBinding(p, "softFadeDist", {
    label: "Fade distance",
    min: 0.05,
    max: 20,
    step: 0.05,
  });

  const color = folder.addFolder({ title: "Color & light", expanded: true });
  color.addBinding(p, "sphericalShading", { label: "Spherical normals" });
  color.addBinding(p, "sphericalDepth", {
    label: "Puff depth",
    min: 0.2,
    max: 2.0,
    step: 0.05,
  });
  color.addBinding(p, "colorLit", { label: "Lit" });
  color.addBinding(p, "colorShadow", { label: "Shadow" });
  color.addBinding(p, "shadowStrength", {
    label: "Shadow strength",
    min: 0,
    max: 1,
    step: 0.01,
  });
  color.addBinding(p, "gradPower", {
    label: "Lighting falloff",
    min: 0.5,
    max: 4,
    step: 0.05,
  });
  color.addBinding(p, "sunLightStrength", {
    label: "Sun facing",
    min: 0,
    max: 1,
    step: 0.01,
  });
  color.addBinding(p, "sunsetTint", { label: "Sunset tint" });
  color.addBinding(p, "sunsetStrength", {
    label: "Sunset strength",
    min: 0,
    max: 1,
    step: 0.01,
  });
  color.addBinding(p, "rimStrength", {
    label: "Rim strength",
    min: 0,
    max: 1,
    step: 0.01,
  });
  color.addBinding(p, "rimPower", {
    label: "Rim power",
    min: 0.5,
    max: 8,
    step: 0.1,
  });
  color.addBinding(p, "horizonFogColor", { label: "Horizon fog" });
  color.addBinding(p, "horizonFogStrength", {
    label: "Horizon fog mix",
    min: 0,
    max: 1,
    step: 0.01,
  });

  const adv = folder.addFolder({ title: "Advanced", expanded: false });
  adv.addBinding(p, "renderOrder", {
    label: "Render order",
    min: -10,
    max: 20,
    step: 1,
  });

  const io = folder.addFolder({ title: "Export / import", expanded: false });
  io.addButton({ title: "Copy params JSON" }).on("click", () => {
    const json = JSON.stringify(state.exportParams(), null, 2);
    navigator.clipboard?.writeText(json);
  });
}
