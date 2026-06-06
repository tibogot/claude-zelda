/**
 * fx-smoke-fog.js
 * Ground fog bank — few large overlapping cloud billboards (clouddrei.png),
 * world-fixed placement at ground level. Same texture/shading as sky clouds,
 * different layout: one big fog patch, not many tiny puffs.
 */

import * as THREE from "three/webgpu";
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
  positionWorld,
  cameraNear,
  cameraFar,
  perspectiveDepthToViewZ,
  viewportDepthTexture,
} from "three/tsl";
import { sunDirFromTimeOfDay } from "./fx-billboard-clouds.js";

const CLOUD_TEXTURE_URL = "textures/clouddrei.png";
const MAX_INSTANCES = 48;

export const SMOKE_FOG_DEFAULTS = {
  enabled: true,
  seed: 0xf06ba5,

  centerX: 0,
  centerZ: 0,
  spread: 48,

  planeCount: 8,
  scaleMin: 18,
  scaleMax: 32,
  verticalSquash: 0.38,
  heightAboveGround: 0.55,
  heightJitter: 1.1,
  centerBias: 0.55,

  yBillboard: true,
  tileCount: 1,
  atlasFlipX: true,

  windDrift: 0.12,
  useSharedWind: true,
  windAngle: 0,

  fadeNear: 3,
  fadeFar: 90,

  playerFadeNear: 2.5,
  playerFadeFar: 9,

  opacity: 0.78,
  colorLit: "#eef2f6",
  colorShadow: "#8ea0b8",
  shadowStrength: 0.5,
  gradPower: 1.25,
  sunLightStrength: 0.28,
  horizonFogStrength: 0.45,
  horizonFogColor: "#c8d8e8",

  softParticles: true,
  softFadeDist: 1.6,
  renderOrder: 6,
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

export function createSmokeFogFX(scene, shared, getTerrainHeight) {
  const params = { ...SMOKE_FOG_DEFAULTS };

  const cloudTex = new THREE.TextureLoader().load(CLOUD_TEXTURE_URL);
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
  const uFog = uniform(
    new THREE.Color(params.horizonFogColor).convertSRGBToLinear(),
  );
  const uShadowStr = uniform(params.shadowStrength);
  const uMasterOpacity = uniform(params.opacity);
  const uGradPower = uniform(params.gradPower);
  const uSunLightStr = uniform(params.sunLightStrength);
  const uFogStr = uniform(params.horizonFogStrength);
  const uSunDir = uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uTileCount = uniform(Math.max(1, params.tileCount));
  const uFlipEnabled = uniform(params.atlasFlipX ? 1.0 : 0.0);
  const uSoftEnabled = uniform(params.softParticles ? 1.0 : 0.0);
  const uSoftFadeDist = uniform(Math.max(0.01, params.softFadeDist));
  const uPlayerPos = uniform(new THREE.Vector3());
  const uPlayerFadeNear = uniform(params.playerFadeNear);
  const uPlayerFadeFar = uniform(params.playerFadeFar);

  const opacityAttr = attribute("cloudOpacity");
  const tileIdxAttr = attribute("cloudTile");
  const flipAttr = attribute("cloudFlip");

  const baseUV = uv();
  const flipFactor = flipAttr.mul(uFlipEnabled);
  const sampleU = mix(baseUV.x, oneMinus(baseUV.x), flipFactor);
  const atlasU = sampleU.add(tileIdxAttr).div(uTileCount);
  const tex = texture(cloudTex, vec2(atlasU, baseUV.y));

  const sunDirN = normalize(uSunDir);
  const vGrad = saturate(baseUV.y);
  const shaded = mix(uShadow, uLit, pow(vGrad, uGradPower));
  const shadedMixed = mix(uLit, shaded, uShadowStr);
  const fakeUp = vec3(0, pow(vGrad, 0.65), 0);
  const sunFace = saturate(dot(normalize(fakeUp), sunDirN));
  const lit = mix(shadedMixed, uLit, sunFace.mul(uSunLightStr));
  const fogged = mix(lit, uFog, uFogStr);

  const toPlayer = vec2(
    positionWorld.x.sub(uPlayerPos.x),
    positionWorld.z.sub(uPlayerPos.z),
  );
  const playerFade = smoothstep(
    uPlayerFadeNear,
    uPlayerFadeFar,
    toPlayer.length(),
  );

  const sceneViewZ = perspectiveDepthToViewZ(
    viewportDepthTexture(),
    cameraNear,
    cameraFar,
  );
  const depthDelta = positionView.z.sub(sceneViewZ);
  const softFactor = mix(
    float(1.0),
    saturate(depthDelta.div(uSoftFadeDist)),
    uSoftEnabled,
  );

  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.colorNode = fogged.mul(tex.rgb);
  mat.opacityNode = tex.a
    .mul(opacityAttr)
    .mul(uMasterOpacity)
    .mul(playerFade)
    .mul(softFactor);

  const mesh = new THREE.InstancedMesh(geometry, mat, MAX_INSTANCES);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = params.renderOrder;
  scene.add(mesh);

  const planes = [];
  const visible = new Array(MAX_INSTANCES);
  for (let i = 0; i < MAX_INSTANCES; i++) {
    visible[i] = {
      x: 0,
      y: 0,
      z: 0,
      sx: 1,
      sy: 1,
      dist: 0,
      alpha: 1,
      tile: 0,
      flip: 0,
      yaw: 0,
    };
  }
  const sortIdx = new Array(MAX_INSTANCES);
  for (let i = 0; i < MAX_INSTANCES; i++) sortIdx[i] = i;

  const _frustum = new THREE.Frustum();
  const _projScreenMat = new THREE.Matrix4();
  const _dummy = new THREE.Object3D();
  const _tmpSphere = new THREE.Sphere();
  const _qYBill = new THREE.Quaternion();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _sunDir = new THREE.Vector3();
  const _sortCmp = (a, b) => visible[b].dist - visible[a].dist;

  let camera = null;
  let playerPos = null;
  let controls = null;
  let windPhase = 0;

  function terrainY(x, z) {
    return getTerrainHeight(x, z) + (shared.groundY ?? 0);
  }

  function rebuild() {
    planes.length = 0;
    const rand = mulberry32(params.seed >>> 0);
    const n = Math.max(1, Math.min(MAX_INSTANCES, Math.round(params.planeCount)));
    const tileCount = Math.max(1, params.tileCount | 0);
    const bias = THREE.MathUtils.clamp(params.centerBias, 0, 1);

    for (let i = 0; i < n; i++) {
      const r = Math.pow(rand(), 1 - bias * 0.85);
      const ang = rand() * Math.PI * 2;
      planes.push({
        ox: Math.cos(ang) * r * params.spread * 0.5,
        oz: Math.sin(ang) * r * params.spread * 0.5,
        scale: params.scaleMin + rand() * (params.scaleMax - params.scaleMin),
        heightJit: (rand() - 0.5) * 2 * params.heightJitter,
        alphaMul: 0.7 + rand() * 0.3,
        tile: Math.floor(rand() * tileCount),
        flip: rand() < 0.5 ? 1 : 0,
        yaw: rand() * Math.PI * 2,
      });
    }
  }

  function syncUniforms() {
    uLit.value.set(params.colorLit).convertSRGBToLinear();
    uShadow.value.set(params.colorShadow).convertSRGBToLinear();
    uFog.value.set(params.horizonFogColor).convertSRGBToLinear();
    uShadowStr.value = params.shadowStrength;
    uMasterOpacity.value = params.opacity;
    uGradPower.value = params.gradPower;
    uSunLightStr.value = params.sunLightStrength;
    uFogStr.value = params.horizonFogStrength;
    uTileCount.value = Math.max(1, params.tileCount);
    uFlipEnabled.value = params.atlasFlipX ? 1.0 : 0.0;
    uSoftEnabled.value = params.softParticles ? 1.0 : 0.0;
    uSoftFadeDist.value = Math.max(0.01, params.softFadeDist);
    uPlayerFadeNear.value = params.playerFadeNear;
    uPlayerFadeFar.value = Math.max(
      params.playerFadeNear + 0.5,
      params.playerFadeFar,
    );
    mesh.renderOrder = params.renderOrder;
  }

  rebuild();
  syncUniforms();

  function update(dt, _elapsed, sh) {
    if (!params.enabled || planes.length === 0 || !camera) {
      mesh.visible = false;
      mesh.count = 0;
      return;
    }
    mesh.visible = true;
    syncUniforms();

    if (playerPos) uPlayerPos.value.copy(playerPos);

    sunDirFromTimeOfDay(sh.timeOfDay ?? 0.35, _sunDir);
    uSunDir.value.copy(_sunDir);

    let windAngleDeg = params.windAngle;
    if (params.useSharedWind) {
      windAngleDeg = (Math.atan2(sh.windZ ?? 0, sh.windX ?? 1) * 180) / Math.PI;
    }
    const windRad = (windAngleDeg * Math.PI) / 180;
    const wx = Math.cos(windRad);
    const wz = Math.sin(windRad);
    const windMul = params.useSharedWind ? (sh.windStrength ?? 1) : 1;
    windPhase += dt * params.windDrift * windMul;

    _projScreenMat.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    _frustum.setFromProjectionMatrix(_projScreenMat);

    const camPos = camera.position;
    const squash = params.verticalSquash;
    const fadeNear = Math.max(0.5, params.fadeNear);
    const fadeFar = Math.max(fadeNear + 1, params.fadeFar);
    const fadeFarStart = fadeFar * 0.78;

    let vCount = 0;

    for (let i = 0; i < planes.length; i++) {
      const pl = planes[i];
      const px = params.centerX + pl.ox + wx * windPhase;
      const pz = params.centerZ + pl.oz + wz * windPhase;
      const sy = pl.scale * squash;
      const ground = terrainY(px, pz);
      const py = ground + params.heightAboveGround + sy * 0.5 + pl.heightJit;

      const dx = px - camPos.x;
      const dy = py - camPos.y;
      const dz = pz - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > fadeFar) continue;

      _tmpSphere.center.set(px, py, pz);
      _tmpSphere.radius = pl.scale;
      if (!_frustum.intersectsSphere(_tmpSphere)) continue;

      let alpha = pl.alphaMul;
      if (dist < fadeNear) alpha *= dist / fadeNear;
      if (dist > fadeFarStart) {
        alpha *= 1 - (dist - fadeFarStart) / (fadeFar - fadeFarStart);
      }

      const v = visible[vCount];
      v.x = px;
      v.y = py;
      v.z = pz;
      v.sx = pl.scale;
      v.sy = sy;
      v.dist = dist;
      v.alpha = alpha;
      v.tile = pl.tile;
      v.flip = pl.flip;
      v.yaw = params.yBillboard
        ? Math.atan2(camPos.x - px, camPos.z - pz)
        : pl.yaw;
      vCount++;
    }

    if (vCount === 0) {
      mesh.count = 0;
      return;
    }

    for (let i = 0; i < vCount; i++) sortIdx[i] = i;
    sortIdx.length = vCount;
    if (vCount > 1) sortIdx.sort(_sortCmp);
    sortIdx.length = MAX_INSTANCES;

    for (let i = 0; i < vCount; i++) {
      const v = visible[sortIdx[i]];
      _dummy.position.set(v.x, v.y, v.z);
      _qYBill.setFromAxisAngle(_yAxis, v.yaw);
      _dummy.quaternion.copy(_qYBill);
      _dummy.scale.set(v.sx, v.sy, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      opacityArr[i] = v.alpha;
      tileArr[i] = v.tile;
      flipArr[i] = v.flip;
    }

    mesh.count = vCount;
    mesh.instanceMatrix.needsUpdate = true;
    geometry.attributes.cloudOpacity.needsUpdate = true;
    geometry.attributes.cloudTile.needsUpdate = true;
    geometry.attributes.cloudFlip.needsUpdate = true;
  }

  function setView(cam, ctrl) {
    camera = cam;
    controls = ctrl;
  }

  function setPlayer(pos) {
    playerPos = pos;
  }

  function snapCenterToTarget() {
    if (!controls) return;
    params.centerX = controls.target.x;
    params.centerZ = controls.target.z;
  }

  function dispose(sc) {
    sc.remove(mesh);
    geometry.dispose();
    mat.dispose();
    cloudTex.dispose();
  }

  return {
    update,
    dispose,
    rebuild,
    params,
    setView,
    setPlayer,
    snapCenterToTarget,
  };
}

export function buildSmokeFogUI(folder, state) {
  const p = state.params;
  const reb = () => state.rebuild();

  folder.addBinding(p, "enabled", { label: "Enabled" });

  const place = folder.addFolder({ title: "Fog patch", expanded: true });
  place.addBinding(p, "centerX", {
    label: "Center X",
    min: -200,
    max: 200,
    step: 0.5,
  });
  place.addBinding(p, "centerZ", {
    label: "Center Z",
    min: -200,
    max: 200,
    step: 0.5,
  });
  place.addButton({ title: "Snap to view" }).on("click", () =>
    state.snapCenterToTarget(),
  );
  place
    .addBinding(p, "spread", {
      label: "Footprint",
      min: 12,
      max: 120,
      step: 1,
    })
    .on("change", reb);
  place
    .addBinding(p, "planeCount", {
      label: "Layers",
      min: 3,
      max: 24,
      step: 1,
    })
    .on("change", reb);
  place
    .addBinding(p, "centerBias", {
      label: "Center overlap",
      min: 0,
      max: 1,
      step: 0.05,
    })
    .on("change", reb);

  const shape = folder.addFolder({ title: "Planes", expanded: true });
  shape
    .addBinding(p, "scaleMin", {
      label: "Size min",
      min: 6,
      max: 50,
      step: 0.5,
    })
    .on("change", reb);
  shape
    .addBinding(p, "scaleMax", {
      label: "Size max",
      min: 8,
      max: 60,
      step: 0.5,
    })
    .on("change", reb);
  shape.addBinding(p, "verticalSquash", {
    label: "Height squash",
    min: 0.15,
    max: 0.8,
    step: 0.02,
  });
  shape.addBinding(p, "heightAboveGround", {
    label: "Ground lift",
    min: -8,
    max: 4,
    step: 0.05,
  });
  shape
    .addBinding(p, "heightJitter", {
      label: "Layer height",
      min: 0,
      max: 4,
      step: 0.05,
    })
    .on("change", reb);
  shape.addBinding(p, "yBillboard", {
    label: "Face camera (Y)",
  });

  const motion = folder.addFolder({ title: "Motion", expanded: false });
  motion.addBinding(p, "windDrift", {
    label: "Wind drift",
    min: 0,
    max: 1,
    step: 0.02,
  });
  motion.addBinding(p, "useSharedWind", { label: "Env wind dir" });

  const fade = folder.addFolder({ title: "Fade", expanded: true });
  fade.addBinding(p, "fadeNear", {
    label: "Cam near",
    min: 0.5,
    max: 12,
    step: 0.25,
  });
  fade.addBinding(p, "fadeFar", {
    label: "Cam far",
    min: 20,
    max: 150,
    step: 1,
  });
  fade.addBinding(p, "playerFadeNear", {
    label: "Player gone",
    min: 0.5,
    max: 8,
    step: 0.25,
  });
  fade.addBinding(p, "playerFadeFar", {
    label: "Player full",
    min: 2,
    max: 20,
    step: 0.5,
  });
  fade.addBinding(p, "softParticles", { label: "Soft depth" });
  fade.addBinding(p, "softFadeDist", {
    label: "Soft dist",
    min: 0.2,
    max: 4,
    step: 0.05,
  });

  const look = folder.addFolder({ title: "Look", expanded: true });
  look.addBinding(p, "opacity", {
    label: "Opacity",
    min: 0.1,
    max: 1,
    step: 0.01,
  });
  look.addBinding(p, "colorLit", { label: "Lit" });
  look.addBinding(p, "colorShadow", { label: "Shadow" });
  look.addBinding(p, "shadowStrength", {
    label: "Shadow mix",
    min: 0,
    max: 1,
    step: 0.02,
  });
  look.addBinding(p, "horizonFogStrength", {
    label: "Fog tint",
    min: 0,
    max: 1,
    step: 0.02,
  });
  look.addBinding(p, "horizonFogColor", { label: "Fog color" });
  look
    .addBinding(p, "seed", { label: "Seed", min: 0, max: 999999, step: 1 })
    .on("change", reb);
}
