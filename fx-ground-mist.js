/**
 * fx-ground-mist.js
 * Single localized ground-mist billboard — TSL fBm, world-fixed, ground-anchored.
 * Y-billboard toward camera; dissolves as the player approaches (before contact).
 */

import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial } from "three";
import {
  Fn,
  attribute,
  cameraFar,
  cameraNear,
  dot,
  float,
  floor,
  fract,
  length,
  mix,
  oneMinus,
  perspectiveDepthToViewZ,
  positionView,
  positionWorld,
  sin,
  smoothstep,
  saturate,
  time,
  uniform,
  uv,
  vec2,
  vec3,
  viewportDepthTexture,
} from "three/tsl";

export const GROUND_MIST_DEFAULTS = {
  enabled: true,
  seed: 0xf057,

  centerX: 0,
  centerZ: 20,
  scale: 18,
  verticalSquash: 0.28,
  groundEmbed: 0.02,

  playerFadeNear: 4,
  playerFadeFar: 14,
  cameraFadeFar: 70,

  opacity: 0.78,
  noiseScale: 2.4,
  shaderSpeedMult: 1.0,
  densityMult: 1.0,
  warpMult: 1.0,

  contactFade: 0.32,
  contactSoft: 0.26,
  contactNoiseAmp: 0.3,
  contactNoiseScale: 5.0,
  groundColor: "#b0b0b0",
  groundBleed: 0.5,
  extraLayer: true,
  extraLayerOffset: 0.22,
  extraLayerOpacity: 0.42,

  baseColor: "#c8d4e0",
  hotColor: "#fff4e8",
  softParticles: true,
  softFadeDist: 1.2,
  renderOrder: 6,
};

const hash2 = Fn(([p]) =>
  vec2(
    fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)),
    fract(sin(dot(p, vec2(269.5, 183.3))).mul(43758.5453)),
  ),
);

const gradNoise = Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3).sub(f.mul(2))).toVar();
  const g00 = hash2(i).mul(2).sub(1);
  const g10 = hash2(i.add(vec2(1, 0))).mul(2).sub(1);
  const g01 = hash2(i.add(vec2(0, 1))).mul(2).sub(1);
  const g11 = hash2(i.add(vec2(1, 1))).mul(2).sub(1);
  return mix(
    mix(dot(g00, f), dot(g10, f.sub(vec2(1, 0))), u.x),
    mix(dot(g01, f.sub(vec2(0, 1))), dot(g11, f.sub(vec2(1, 1))), u.x),
    u.y,
  )
    .mul(0.5)
    .add(0.5);
});

const fbm5 = Fn(([p]) => {
  let v = gradNoise(p).mul(0.54);
  v = v.add(gradNoise(p.mul(2.03)).mul(0.25));
  v = v.add(gradNoise(p.mul(4.17)).mul(0.12));
  v = v.add(gradNoise(p.mul(8.21)).mul(0.06));
  v = v.add(gradNoise(p.mul(16.4)).mul(0.03));
  return v;
});

export function createGroundMistFX(scene, shared, getTerrainHeight) {
  const params = { ...GROUND_MIST_DEFAULTS };

  const geometry = new THREE.PlaneGeometry(1, 1);
  const opacityArr = new Float32Array(2);
  const seedArr = new Float32Array([params.seed * 0.001, params.seed * 0.001 + 0.37]);
  geometry.setAttribute(
    "mistOpacity",
    new THREE.InstancedBufferAttribute(opacityArr, 1),
  );
  geometry.setAttribute(
    "mistSeed",
    new THREE.InstancedBufferAttribute(seedArr, 1),
  );

  const uBaseColor = uniform(new THREE.Color(params.baseColor));
  const uHotColor = uniform(new THREE.Color(params.hotColor));
  const uMasterOpacity = uniform(params.opacity);
  const uNoiseScale = uniform(params.noiseScale);
  const uShaderSpeed = uniform(params.shaderSpeedMult);
  const uDensity = uniform(params.densityMult);
  const uWarp = uniform(params.warpMult);
  const uContactFade = uniform(float(params.contactFade));
  const uContactSoft = uniform(float(params.contactSoft));
  const uContactNoiseAmp = uniform(float(params.contactNoiseAmp));
  const uContactNoiseScale = uniform(float(params.contactNoiseScale));
  const uGroundColor = uniform(new THREE.Color(params.groundColor));
  const uGroundBleed = uniform(float(params.groundBleed));
  const uPlayerPos = uniform(new THREE.Vector3());
  const uPlayerFadeNear = uniform(params.playerFadeNear);
  const uPlayerFadeFar = uniform(params.playerFadeFar);
  const uSoftEnabled = uniform(params.softParticles ? 1.0 : 0.0);
  const uSoftFadeDist = uniform(Math.max(0.01, params.softFadeDist));

  const opacityAttr = attribute("mistOpacity");
  const seedAttr = attribute("mistSeed");

  const st = uv();
  const t = time.mul(uShaderSpeed);
  const seedOff = seedAttr.mul(17.31);
  const p0 = vec2(
    st.x.mul(3.2).add(t.mul(0.9)).add(seedOff),
    st.y.mul(1.6).sub(t.mul(0.12)).add(seedOff.mul(0.37)),
  ).toVar();
  const warpX = fbm5(p0.mul(0.55).add(vec2(0.0, t.mul(0.35)))).sub(0.5);
  const warpY = fbm5(p0.mul(0.75).sub(vec2(t.mul(0.28), 0.0))).sub(0.5);
  const p = p0.add(vec2(warpX, warpY).mul(uWarp.mul(0.45))).toVar();
  const n1 = fbm5(p.mul(uNoiseScale)).toVar();
  const n2 = fbm5(p.mul(2.3).add(vec2(t.mul(0.22), t.mul(-0.18)))).toVar();

  const edgeN = fbm5(
    vec2(
      st.x.mul(uContactNoiseScale).add(seedOff).add(t.mul(0.12)),
      seedOff.mul(0.41).add(t.mul(0.06)),
    ),
  );
  const rippledFade = uContactFade.add(edgeN.sub(0.5).mul(uContactNoiseAmp));
  const groundBand = oneMinus(
    smoothstep(rippledFade, rippledFade.add(uContactSoft), st.y),
  ).pow(1.35);

  const fineBreak = fbm5(
    vec2(
      st.x.mul(uContactNoiseScale.mul(2.1)),
      st.y.mul(4.5).add(t.mul(0.05)),
    ),
  );
  const breakup = smoothstep(0.08, 0.52, fineBreak.mul(0.55).add(st.y.mul(0.65)));
  const groundContact = groundBand.mul(mix(float(0.35), float(1.0), breakup));

  const edgeX = smoothstep(0.02, 0.14, st.x).mul(
    smoothstep(0.02, 0.16, float(1.0).sub(st.x)),
  );
  const wisps = smoothstep(0.38, 0.88, n1.mul(0.82).add(n2.mul(0.68)));
  const noiseAlpha = groundContact
    .mul(edgeX)
    .mul(wisps)
    .mul(uDensity)
    .saturate();

  const toPlayer = vec2(
    positionWorld.x.sub(uPlayerPos.x),
    positionWorld.z.sub(uPlayerPos.z),
  );
  const distXZ = length(toPlayer);
  const playerFade = smoothstep(uPlayerFadeNear, uPlayerFadeFar, distXZ);

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

  const glow = smoothstep(0.65, 1.0, n2).mul(0.25);
  const mistRgb = mix(uBaseColor, uHotColor, glow.add(noiseAlpha.mul(0.2)));
  const bleedMask = oneMinus(st.y)
    .pow(2.4)
    .mul(uGroundBleed)
    .mul(saturate(oneMinus(st.y.div(uContactSoft.add(0.12)))));
  const rgb = mix(mistRgb, uGroundColor, bleedMask);

  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.colorNode = rgb;
  mat.opacityNode = noiseAlpha
    .mul(opacityAttr)
    .mul(uMasterOpacity)
    .mul(playerFade)
    .mul(softFactor);

  const mesh = new THREE.InstancedMesh(geometry, mat, 2);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = params.renderOrder;
  scene.add(mesh);

  const _dummy = new THREE.Object3D();
  const _qYBill = new THREE.Quaternion();
  const _yAxis = new THREE.Vector3(0, 1, 0);

  let camera = null;
  let playerPos = null;
  let controls = null;

  function terrainY(x, z) {
    return getTerrainHeight(x, z) + (shared.groundY ?? 0);
  }

  function syncUniforms() {
    uBaseColor.value.set(params.baseColor);
    uHotColor.value.set(params.hotColor);
    uMasterOpacity.value = params.opacity;
    uNoiseScale.value = params.noiseScale;
    uShaderSpeed.value = params.shaderSpeedMult;
    uDensity.value = params.densityMult;
    uWarp.value = params.warpMult;
    uContactFade.value = params.contactFade;
    uContactSoft.value = params.contactSoft;
    uContactNoiseAmp.value = params.contactNoiseAmp;
    uContactNoiseScale.value = params.contactNoiseScale;
    uGroundColor.value.set(params.groundColor);
    uGroundBleed.value = params.groundBleed;
    uPlayerFadeNear.value = params.playerFadeNear;
    uPlayerFadeFar.value = Math.max(
      params.playerFadeNear + 1,
      params.playerFadeFar,
    );
    uSoftEnabled.value = params.softParticles ? 1.0 : 0.0;
    uSoftFadeDist.value = Math.max(0.01, params.softFadeDist);
    mesh.renderOrder = params.renderOrder;
  }

  syncUniforms();

  function update(_dt, _elapsed, _sh) {
    if (!params.enabled || !camera) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    syncUniforms();

    if (playerPos) uPlayerPos.value.copy(playerPos);

    const camPos = camera.position;
    const px = params.centerX;
    const pz = params.centerZ;
    const ground = terrainY(px, pz);
    const squash = params.verticalSquash;
    const halfH = params.scale * squash * 0.5;
    const py = ground + halfH + params.groundEmbed;

    const dx = px - camPos.x;
    const dy = py - camPos.y;
    const dz = pz - camPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const fadeFar = Math.max(10, params.cameraFadeFar);
    const fadeFarStart = fadeFar * 0.78;

    if (dist > fadeFar) {
      mesh.count = 0;
      return;
    }

    let alpha = 1.0;
    if (dist > fadeFarStart) {
      alpha = 1 - (dist - fadeFarStart) / (fadeFar - fadeFarStart);
    }

    const yawToCam = Math.atan2(camPos.x - px, camPos.z - pz);
    _qYBill.setFromAxisAngle(_yAxis, yawToCam);

    let vCount = 0;

    _dummy.position.set(px, py, pz);
    _dummy.quaternion.copy(_qYBill);
    _dummy.scale.set(params.scale, params.scale * squash, params.scale);
    _dummy.updateMatrix();
    mesh.setMatrixAt(vCount, _dummy.matrix);
    opacityArr[vCount] = alpha;
    seedArr[vCount] = params.seed * 0.001;
    vCount++;

    if (params.extraLayer) {
      const layerHalf = params.scale * squash * 0.42 * 0.5;
      const layerY = ground + layerHalf + params.extraLayerOffset + params.groundEmbed;
      _dummy.position.set(px, layerY, pz);
      _dummy.quaternion.copy(_qYBill);
      _dummy.scale.set(
        params.scale * 0.92,
        params.scale * squash * 0.42,
        params.scale * 0.92,
      );
      _dummy.updateMatrix();
      mesh.setMatrixAt(vCount, _dummy.matrix);
      opacityArr[vCount] = alpha * params.extraLayerOpacity;
      seedArr[vCount] = params.seed * 0.001 + 0.37;
      vCount++;
    }

    mesh.count = vCount;
    mesh.instanceMatrix.needsUpdate = true;
    geometry.attributes.mistOpacity.needsUpdate = true;
    geometry.attributes.mistSeed.needsUpdate = true;
  }

  function setView(cam, ctrl) {
    camera = cam;
    controls = ctrl;
  }

  function snapCenterToTarget() {
    if (!controls || !camera) return;
    const tx = controls.target.x;
    const tz = controls.target.z;
    let dx = tx - camera.position.x;
    let dz = tz - camera.position.z;
    const len = Math.hypot(dx, dz) || 1;
    const placeDist = Math.min(22, len * 0.4);
    params.centerX = tx - (dx / len) * placeDist;
    params.centerZ = tz - (dz / len) * placeDist;
  }

  function dispose(sc) {
    sc.remove(mesh);
    geometry.dispose();
    mat.dispose();
  }

  function setCamera(cam) {
    camera = cam;
  }

  function setPlayer(pos) {
    playerPos = pos;
  }

  return {
    update,
    dispose,
    params,
    setCamera,
    setPlayer,
    setView,
    snapCenterToTarget,
  };
}

export function buildGroundMistUI(folder, state) {
  const p = state.params;

  folder.addBinding(p, "enabled", { label: "Enabled" });

  const place = folder.addFolder({ title: "Placement", expanded: true });
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
  place.addButton({ title: "Snap to view target" }).on("click", () =>
    state.snapCenterToTarget(),
  );
  place.addBinding(p, "scale", {
    label: "Size",
    min: 4,
    max: 40,
    step: 0.5,
  });
  place.addBinding(p, "verticalSquash", {
    label: "Flatness",
    min: 0.12,
    max: 0.6,
    step: 0.01,
  });
  place.addBinding(p, "groundEmbed", {
    label: "Ground embed",
    min: 0,
    max: 0.2,
    step: 0.005,
  });

  const contact = folder.addFolder({ title: "Ground contact", expanded: true });
  contact.addBinding(p, "contactFade", {
    label: "Edge height",
    min: 0.05,
    max: 0.55,
    step: 0.01,
  });
  contact.addBinding(p, "contactSoft", {
    label: "Edge soft",
    min: 0.05,
    max: 0.5,
    step: 0.01,
  });
  contact.addBinding(p, "contactNoiseAmp", {
    label: "Ripple amp",
    min: 0,
    max: 0.6,
    step: 0.01,
  });
  contact.addBinding(p, "contactNoiseScale", {
    label: "Ripple freq",
    min: 1,
    max: 12,
    step: 0.1,
  });
  contact.addBinding(p, "groundColor", { label: "Ground tint" });
  contact.addBinding(p, "groundBleed", {
    label: "Ground bleed",
    min: 0,
    max: 1,
    step: 0.02,
  });
  contact.addBinding(p, "extraLayer", { label: "2nd wisp layer" });
  contact.addBinding(p, "extraLayerOffset", {
    label: "2nd layer lift",
    min: 0.05,
    max: 0.8,
    step: 0.02,
  });
  contact.addBinding(p, "extraLayerOpacity", {
    label: "2nd layer op",
    min: 0.1,
    max: 1,
    step: 0.02,
  });

  const fade = folder.addFolder({ title: "Player fade", expanded: true });
  fade.addBinding(p, "playerFadeNear", {
    label: "Gone by",
    min: 1,
    max: 10,
    step: 0.25,
  });
  fade.addBinding(p, "playerFadeFar", {
    label: "Full by",
    min: 4,
    max: 30,
    step: 0.5,
  });
  fade.addBinding(p, "cameraFadeFar", {
    label: "Camera far",
    min: 20,
    max: 150,
    step: 1,
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
    min: 0.05,
    max: 1,
    step: 0.01,
  });
  look.addBinding(p, "noiseScale", {
    label: "Noise scale",
    min: 0.5,
    max: 6,
    step: 0.05,
  });
  look.addBinding(p, "densityMult", {
    label: "Density",
    min: 0.3,
    max: 2.5,
    step: 0.05,
  });
  look.addBinding(p, "warpMult", {
    label: "Warp",
    min: 0.2,
    max: 2.5,
    step: 0.05,
  });
  look.addBinding(p, "shaderSpeedMult", {
    label: "Anim speed",
    min: 0.1,
    max: 3,
    step: 0.05,
  });
  look.addBinding(p, "baseColor", { label: "Base" });
  look.addBinding(p, "hotColor", { label: "Highlight" });
}
