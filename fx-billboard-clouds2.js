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
  vec3,
  dot,
  normalize,
  oneMinus,
} from "three/tsl";

const CLOUD_TEXTURE_URL = "textures/clouddrei.png";
const MAX_INSTANCES = 800;

/** Default params tuned for the Ambient FX Editor preview scene. */
export const BILLBOARD_CLOUD_DEFAULTS = {
  enabled: true,
  seed: 0xc10d5,

  cloudCount: 45,
  segmentsPerCloud: 6,

  spread: 110,
  followCamera: true,
  altitude: 16,
  altitudeJitter: 4,
  clusterRadius: 12,
  clusterHeight: 3,

  scaleMin: 5,
  scaleMax: 14,
  verticalSquash: 0.55,

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
  geometry.setAttribute(
    "cloudOpacity",
    new THREE.InstancedBufferAttribute(opacityArr, 1),
  );

  const uLit = uniform(new THREE.Color(params.colorLit).convertSRGBToLinear());
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

  const tex = texture(cloudTex, uv());
  const opacityAttr = attribute("cloudOpacity");

  const vGrad = saturate(uv().y);
  const shaded = mix(uShadow, uLit, pow(vGrad, uGradPower));
  const shadedMixed = mix(uLit, shaded, uShadowStr);

  const fakeUp = vec3(0, pow(vGrad, 0.65), 0);
  const sunFace = saturate(dot(normalize(fakeUp), normalize(uSunDir)));
  const sunBoosted = mix(shadedMixed, uLit, sunFace.mul(uSunLightStr));

  const rimBand = smoothstep(0.25, 0.45, vGrad).mul(
    oneMinus(smoothstep(0.72, 0.92, vGrad)),
  );
  const rim = vec3(1, 0.98, 0.92).mul(
    rimBand.mul(uRimStr).mul(pow(sunFace, uRimPow)),
  );
  const withRim = sunBoosted.add(rim);

  const withSunset = mix(withRim, uSunset, uSunElev.mul(uSunsetStr));
  const fogged = mix(withSunset, uFog, uFogStr);

  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  mat.colorNode = fogged.mul(tex.rgb);
  mat.opacityNode = tex.a.mul(opacityAttr).mul(uMasterOpacity);

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
    visible[i] = { x: 0, y: 0, z: 0, scale: 0, dist: 0, alpha: 0 };
  }
  const sortIdx = new Array(MAX_INSTANCES);
  for (let i = 0; i < MAX_INSTANCES; i++) sortIdx[i] = i;

  const _frustum = new THREE.Frustum();
  const _projScreenMat = new THREE.Matrix4();
  const _dummy = new THREE.Object3D();
  const _tmpSphere = new THREE.Sphere();
  const _sunDir = new THREE.Vector3();
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
      const cy = params.altitude + (rand() - 0.5) * 2 * params.altitudeJitter;

      for (let s = 0; s < params.segmentsPerCloud; s++) {
        if (segments.length >= targetCount) break;
        const ang = rand() * Math.PI * 2;
        const r = Math.pow(rand(), 0.7) * params.clusterRadius;
        const ox = Math.cos(ang) * r;
        const oz = Math.sin(ang) * r;
        const oy = (rand() - 0.5) * params.clusterHeight;
        const scale =
          params.scaleMin + rand() * (params.scaleMax - params.scaleMin);
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
      windAngleDeg = (Math.atan2(sh.windZ, sh.windX) * 180) / Math.PI;
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

    const camQuat = camera.quaternion;
    const camPos = camera.position;
    const squash = params.verticalSquash;
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

    for (let i = 0; i < vCount; i++) sortIdx[i] = i;
    sortIdx.length = vCount;
    if (vCount > 1) sortIdx.sort(_sortCmp);
    sortIdx.length = MAX_INSTANCES;

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
  layout
    .addBinding(p, "cloudCount", {
      label: "Cloud clusters",
      min: 1,
      max: 150,
      step: 1,
    })
    .on("change", () => state.rebuild());
  layout
    .addBinding(p, "segmentsPerCloud", {
      label: "Segments / cluster",
      min: 1,
      max: 12,
      step: 1,
    })
    .on("change", () => state.rebuild());
  layout
    .addBinding(p, "spread", {
      label: "Spread",
      min: 20,
      max: 400,
      step: 5,
    })
    .on("change", () => state.rebuild());
  layout.addBinding(p, "followCamera", {
    label: "Follow camera XZ",
  });
  layout
    .addBinding(p, "altitude", {
      label: "Altitude",
      min: 2,
      max: 80,
      step: 0.5,
    })
    .on("change", () => state.rebuild());
  layout
    .addBinding(p, "altitudeJitter", {
      label: "Altitude jitter",
      min: 0,
      max: 40,
      step: 0.5,
    })
    .on("change", () => state.rebuild());
  layout
    .addBinding(p, "clusterRadius", {
      label: "Cluster radius",
      min: 2,
      max: 80,
      step: 1,
    })
    .on("change", () => state.rebuild());
  layout
    .addBinding(p, "clusterHeight", {
      label: "Cluster height",
      min: 0,
      max: 40,
      step: 0.5,
    })
    .on("change", () => state.rebuild());

  const size = folder.addFolder({ title: "Size", expanded: true });
  size
    .addBinding(p, "scaleMin", {
      label: "Scale min",
      min: 1,
      max: 80,
      step: 0.5,
    })
    .on("change", () => state.rebuild());
  size
    .addBinding(p, "scaleMax", {
      label: "Scale max",
      min: 1,
      max: 120,
      step: 0.5,
    })
    .on("change", () => state.rebuild());
  size.addBinding(p, "verticalSquash", {
    label: "Vertical squash",
    min: 0.2,
    max: 1.2,
    step: 0.05,
  });

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

  const color = folder.addFolder({ title: "Color & light", expanded: true });
  color.addBinding(p, "colorLit", { label: "Lit" });
  color.addBinding(p, "colorShadow", { label: "Shadow" });
  color.addBinding(p, "shadowStrength", {
    label: "Shadow strength",
    min: 0,
    max: 1,
    step: 0.01,
  });
  color.addBinding(p, "gradPower", {
    label: "Vertical grad power",
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
