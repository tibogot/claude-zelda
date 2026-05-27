/**
 * ghibli-sky-scene.js — Demo scene for the Ghibli procedural sky.
 */

import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Pane } from "tweakpane";
import { createGhibliSky } from "./ghibli-sky.js";

function degToRad(v) {
  return (v * Math.PI) / 180;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function computeSunDir(azimuthDeg, elevationDeg) {
  const az = degToRad(azimuthDeg);
  const el = degToRad(elevationDeg);
  const y = Math.sin(el);
  const h = Math.cos(el);
  const x = Math.sin(az) * h;
  const z = Math.cos(az) * h;
  return new THREE.Vector3(x, y, z).normalize();
}

function bindUniformFloat(folder, label, uniformRef, opts) {
  const model = { [label]: uniformRef.value };
  folder.addBinding(model, label, opts).on("change", (ev) => {
    uniformRef.value = ev.value;
  });
}

function bindUniformColor(folder, label, uniformRef) {
  const model = { [label]: `#${uniformRef.value.getHexString()}` };
  folder.addBinding(model, label, { view: "color" }).on("change", (ev) => {
    uniformRef.value.set(ev.value).convertSRGBToLinear();
  });
}

const DN_KEYS = [
  { h: 0, dc: "#203060", di: 0, sk: "#1e2845", gr: "#0d1018", hi: 0.1, ex: 0.28 },
  { h: 6, dc: "#ff9060", di: 0.6, sk: "#ffb068", gr: "#553322", hi: 0.2, ex: 0.45 },
  { h: 9, dc: "#ffe8c0", di: 2.0, sk: "#c8e0ff", gr: "#887055", hi: 0.35, ex: 0.5 },
  { h: 12, dc: "#ffffff", di: 2.5, sk: "#c8e0ff", gr: "#88aa55", hi: 0.4, ex: 0.55 },
  { h: 15, dc: "#ffe8c0", di: 2.0, sk: "#c8d8ff", gr: "#887055", hi: 0.35, ex: 0.5 },
  { h: 18, dc: "#ff6030", di: 0.6, sk: "#ff9050", gr: "#441818", hi: 0.2, ex: 0.44 },
  { h: 21, dc: "#1a2050", di: 0, sk: "#1a2040", gr: "#0d1015", hi: 0.12, ex: 0.28 },
  { h: 24, dc: "#203060", di: 0, sk: "#1e2845", gr: "#0d1018", hi: 0.1, ex: 0.28 },
];

export async function createGhibliSkyScene({ container = document.body } = {}) {
  const scene = new THREE.Scene();
  scene.background = null;

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    20000,
  );
  camera.position.set(0, 38, 38);

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  await renderer.init();
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 28, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.499;
  controls.minDistance = 8;
  controls.maxDistance = 280;

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3800, 96),
    new THREE.MeshStandardMaterial({
      color: 0x4a7040,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.y = -0.5;
  scene.add(ground);

  const sunLight = new THREE.DirectionalLight(0xfff2cf, 2.3);
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemi = new THREE.HemisphereLight(0x9ec8ff, 0x35421e, 0.42);
  scene.add(hemi);

  const sky = createGhibliSky();
  scene.add(sky.mesh);

  const skyU = sky.uniforms;
  const params = {
    skyVisible: true,
    groundVisible: true,
    light: {
      sunAzimuth: 135,
      sunElevation: 28,
      dirColor: "#fff2cf",
      dirIntensity: 2.3,
      hemiSkyColor: "#9ec8ff",
      hemiGroundColor: "#35421e",
      hemiIntensity: 0.42,
      exposure: 1.0,
      envIntensity: 1.0,
    },
    dayNight: {
      time: 14.5,
      speed: 5,
      enabled: false,
    },
    c1Angle: sky.windState.c1Angle,
    c1Speed: sky.windState.c1Speed,
    c2Angle: sky.windState.c2Angle,
    c2Speed: sky.windState.c2Speed,
    fogEnabled: true,
    fogDensity: 0.00007,
    fogSkyMix: 0.88,
  };

  const fog = new THREE.FogExp2(0xa8c8e0, params.fogDensity);
  const fogAutoCol = new THREE.Color();
  const _dnC0 = new THREE.Color();
  const _dnC1 = new THREE.Color();

  const applyFog = (sunY = 0.5) => {
    if (!params.fogEnabled) {
      scene.fog = null;
      return;
    }
    if (scene.fog !== fog) scene.fog = fog;
    fog.density = params.fogDensity;
    const sunsetBlend = smoothstep(0.26, -0.04, sunY);
    const nightBlend = smoothstep(0.04, -0.1, sunY);
    fogAutoCol.copy(skyU.horizonColor.value);
    fogAutoCol.lerp(skyU.sunsetColor.value, sunsetBlend * 0.6);
    fogAutoCol.lerp(skyU.groundColor.value, 0.15);
    fogAutoCol.lerp(new THREE.Color(0x141c30), nightBlend * 0.75);
    fog.color.copy(fogAutoCol);
  };

  const applyLighting = () => {
    renderer.toneMappingExposure = params.light.exposure;
    sunLight.color.set(params.light.dirColor).convertSRGBToLinear();
    sunLight.intensity = params.light.dirIntensity;
    hemi.color.set(params.light.hemiSkyColor).convertSRGBToLinear();
    hemi.groundColor.set(params.light.hemiGroundColor).convertSRGBToLinear();
    hemi.intensity = params.light.hemiIntensity;
    scene.environmentIntensity = params.light.envIntensity;
  };

  const syncDayNight = (hours) => {
    const h = ((hours % 24) + 24) % 24;
    const rawElev = Math.sin(((h - 6) / 12) * Math.PI) * 85;
    params.light.sunAzimuth = (h / 24) * 360;
    params.light.sunElevation = Math.max(-10, rawElev);

    let k0 = DN_KEYS[0];
    let k1 = DN_KEYS[1];
    for (let i = 0; i < DN_KEYS.length - 1; i += 1) {
      if (h >= DN_KEYS[i].h && h < DN_KEYS[i + 1].h) {
        k0 = DN_KEYS[i];
        k1 = DN_KEYS[i + 1];
        break;
      }
    }
    const t = (h - k0.h) / (k1.h - k0.h);
    const lrp = (a, b) => a + (b - a) * t;
    const lrpCol = (a, b) =>
      `#${_dnC0.set(a).lerp(_dnC1.set(b), t).getHexString()}`;
    params.light.dirColor = lrpCol(k0.dc, k1.dc);
    params.light.dirIntensity = lrp(k0.di, k1.di);
    params.light.hemiSkyColor = lrpCol(k0.sk, k1.sk);
    params.light.hemiGroundColor = lrpCol(k0.gr, k1.gr);
    params.light.hemiIntensity = lrp(k0.hi, k1.hi);
    params.light.exposure = lrp(k0.ex, k1.ex);

    const dnf = Math.max(0, Math.min(1, (-rawElev - 5) / 25));
    const lrpSky = (a, b) =>
      _dnC0.set(a).lerp(_dnC1.set(b), dnf).convertSRGBToLinear();
    skyU.zenithColor.value.copy(lrpSky("#1e5cb8", "#040818"));
    skyU.skyColor.value.copy(lrpSky("#52c4f0", "#0c1428"));
    skyU.horizonColor.value.copy(lrpSky("#d8eeff", "#182038"));
    skyU.sunsetLow.value.copy(lrpSky("#c83818", "#020408"));
    skyU.sunsetColor.value.copy(lrpSky("#ff8848", "#060a14"));
    skyU.sunsetHigh.value.copy(lrpSky("#f0b8d8", "#0c1828"));
    skyU.horizonRingStr.value = 0.28 * (1 - dnf * 0.85);
    skyU.nightCloudStr.value = 0.08 + dnf * 0.14;
  };

  applyLighting();

  const pane = new Pane({ title: "Ghibli Sky (WebGPU)" });
  const sunDir = new THREE.Vector3();
  let pmremGenerator = null;
  let disposeSkyEnv = null;
  let envRebakeTimer = null;
  let lastAnimEnvRebake = 0;

  function rebuildSkyEnv() {
    sunDir.copy(
      computeSunDir(params.light.sunAzimuth, params.light.sunElevation),
    );
    sky.update(sunDir, camera.position);
    try {
      if (disposeSkyEnv) {
        disposeSkyEnv();
        disposeSkyEnv = null;
      }
      pmremGenerator = pmremGenerator ?? new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      const probe = new THREE.Mesh(sky.mesh.geometry, sky.mesh.material);
      probe.position.copy(sky.mesh.position);
      probe.scale.copy(sky.mesh.scale);
      envScene.add(probe);
      const pmremRT = pmremGenerator.fromScene(envScene, 0.04);
      scene.environment = pmremRT.texture;
      disposeSkyEnv = () => pmremRT.dispose();
    } catch (err) {
      console.warn("[ghibli-sky-scene] PMREM failed:", err);
    }
  }

  function scheduleSkyEnvRebake() {
    if (envRebakeTimer) clearTimeout(envRebakeTimer);
    envRebakeTimer = setTimeout(() => {
      envRebakeTimer = null;
      rebuildSkyEnv();
    }, 220);
  }

  function updateSunAndSky() {
    sunDir.copy(
      computeSunDir(params.light.sunAzimuth, params.light.sunElevation),
    );
    sunLight.position.copy(sunDir).multiplyScalar(1600);
    sunLight.target.position.set(0, 0, 0);
    sunLight.target.updateMatrixWorld();
    applyFog(sunDir.y);
    sky.update(sunDir, camera.position);
  }

  const fScene = pane.addFolder({ title: "Scene", expanded: true });
  fScene.addBinding(params, "skyVisible").on("change", (ev) => {
    sky.mesh.visible = ev.value;
  });
  fScene.addBinding(params, "groundVisible").on("change", (ev) => {
    ground.visible = ev.value;
  });
  fScene.addButton({ title: "Rebake sky IBL" }).on("click", rebuildSkyEnv);

  const fFog = pane.addFolder({ title: "Fog", expanded: false });
  fFog.addBinding(params, "fogEnabled", { label: "enabled" }).on("change", () =>
    applyFog(sunDir.y),
  );
  fFog.addBinding(params, "fogDensity", {
    min: 0.00001,
    max: 0.002,
    step: 0.00001,
    label: "density",
  }).on("change", () => applyFog(sunDir.y));

  const lightFolder = pane.addFolder({ title: "Lighting", expanded: false });
  lightFolder
    .addBinding(params.light, "sunAzimuth", { min: 0, max: 360, step: 1, label: "azimuth" })
    .on("change", scheduleSkyEnvRebake);
  lightFolder
    .addBinding(params.light, "sunElevation", { min: -10, max: 90, step: 1, label: "elevation" })
    .on("change", scheduleSkyEnvRebake);
  lightFolder
    .addBinding(params.light, "exposure", { min: 0.1, max: 2, step: 0.05 })
    .on("change", applyLighting);
  lightFolder
    .addBinding(params.light, "envIntensity", { min: 0, max: 3, step: 0.05, label: "IBL" })
    .on("change", applyLighting);

  const dnFolder = pane.addFolder({ title: "Day / Night", expanded: true });
  const dnTimeBinding = dnFolder
    .addBinding(params.dayNight, "time", { min: 0, max: 24, step: 0.01, label: "time" })
    .on("change", ({ value }) => {
      if (!params.dayNight.enabled) syncDayNight(value);
    });
  dnFolder.addBinding(params.dayNight, "speed", { min: 0, max: 20, step: 0.1 });
  dnFolder.addBinding(params.dayNight, "enabled", { label: "animate" });
  dnFolder.addButton({ title: "Noon" }).on("click", () => {
    params.dayNight.time = 12;
    syncDayNight(12);
    dnTimeBinding.refresh();
    rebuildSkyEnv();
  });
  dnFolder.addButton({ title: "Sunset" }).on("click", () => {
    params.dayNight.time = 18;
    syncDayNight(18);
    dnTimeBinding.refresh();
    rebuildSkyEnv();
  });
  dnFolder.addButton({ title: "Night" }).on("click", () => {
    params.dayNight.time = 0;
    syncDayNight(0);
    dnTimeBinding.refresh();
    rebuildSkyEnv();
  });

  const fWind = pane.addFolder({ title: "Cloud Wind", expanded: false });
  fWind.addBinding(params, "c1Angle", { min: 0, max: 360, step: 1 }).on("change", (ev) => {
    sky.windState.c1Angle = ev.value;
    sky.updateWind();
  });
  fWind.addBinding(params, "c1Speed", { min: 0, max: 0.02, step: 0.0005 }).on("change", (ev) => {
    sky.windState.c1Speed = ev.value;
    sky.updateWind();
  });
  fWind.addBinding(params, "c2Angle", { min: 0, max: 360, step: 1 }).on("change", (ev) => {
    sky.windState.c2Angle = ev.value;
    sky.updateWind();
  });
  fWind.addBinding(params, "c2Speed", { min: 0, max: 0.02, step: 0.0005 }).on("change", (ev) => {
    sky.windState.c2Speed = ev.value;
    sky.updateWind();
  });

  const fGradient = pane.addFolder({ title: "Sky Colors", expanded: false });
  bindUniformColor(fGradient, "zenith", skyU.zenithColor);
  bindUniformColor(fGradient, "mid", skyU.skyColor);
  bindUniformColor(fGradient, "horizon", skyU.horizonColor);
  bindUniformColor(fGradient, "sunsetLow", skyU.sunsetLow);
  bindUniformColor(fGradient, "sunset", skyU.sunsetColor);
  bindUniformColor(fGradient, "sunsetHigh", skyU.sunsetHigh);

  const fCumulus = pane.addFolder({ title: "Cumulus (big fluffy)", expanded: true });
  bindUniformFloat(fCumulus, "density", skyU.c1Density, { min: 0.2, max: 0.85, step: 0.01 });
  bindUniformFloat(fCumulus, "softness", skyU.c1Softness, { min: 0.1, max: 0.6, step: 0.01 });
  bindUniformFloat(fCumulus, "scale", skyU.c1Scale, { min: 1, max: 12, step: 0.05 });
  bindUniformFloat(fCumulus, "macroScale", skyU.c1MacroScale, { min: 0.3, max: 3, step: 0.01, label: "cluster size" });
  bindUniformFloat(fCumulus, "bodyScale", skyU.c1BodyScale, { min: 0.8, max: 6, step: 0.01, label: "puff size" });
  bindUniformFloat(fCumulus, "fluffScale", skyU.c1FluffScale, { min: 2, max: 16, step: 0.05, label: "edge detail" });
  bindUniformFloat(fCumulus, "clusterLo", skyU.c1ClusterLo, { min: 0.2, max: 0.6, step: 0.01, label: "cluster lo" });
  bindUniformFloat(fCumulus, "clusterHi", skyU.c1ClusterHi, { min: 0.4, max: 0.85, step: 0.01, label: "cluster hi" });
  bindUniformFloat(fCumulus, "warp", skyU.c1WarpStr, { min: 0, max: 1.2, step: 0.01 });
  bindUniformFloat(fCumulus, "stretchX", skyU.c1StretchX, { min: 0.15, max: 1.2, step: 0.01 });
  bindUniformFloat(fCumulus, "stretchY", skyU.c1StretchY, { min: 0.5, max: 2.5, step: 0.01 });

  const fWispy = pane.addFolder({ title: "Distant Haze", expanded: false });
  bindUniformFloat(fWispy, "density", skyU.c2Density, { min: 0.1, max: 0.9, step: 0.01 });
  bindUniformFloat(fWispy, "strength", skyU.c2Strength, { min: 0, max: 0.5, step: 0.01 });

  const fShade = pane.addFolder({ title: "Cloud Shading", expanded: false });
  bindUniformColor(fShade, "lit", skyU.cloudLit);
  bindUniformColor(fShade, "shadow", skyU.cloudShadow);
  bindUniformColor(fShade, "underside", skyU.cloudUnderside);
  bindUniformFloat(fShade, "shadowStr", skyU.shadowStr, { min: 0, max: 1.5, step: 0.01 });
  bindUniformFloat(fShade, "undersideStr", skyU.undersideStr, { min: 0, max: 1, step: 0.01 });
  bindUniformFloat(fShade, "rimStr", skyU.rimStr, { min: 0, max: 1.5, step: 0.01 });
  bindUniformFloat(fShade, "nightClouds", skyU.nightCloudStr, { min: 0, max: 0.6, step: 0.01 });

  const timer = new THREE.Timer();
  timer.connect(document);

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  updateSunAndSky();
  rebuildSkyEnv();

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = timer.getDelta();
    const elapsed = timer.getElapsed();

    if (params.dayNight.enabled) {
      params.dayNight.time =
        (params.dayNight.time + dt * params.dayNight.speed * 0.1 + 24) % 24;
      syncDayNight(params.dayNight.time);
      dnTimeBinding.refresh();
      if (elapsed - lastAnimEnvRebake > 2.5) {
        rebuildSkyEnv();
        lastAnimEnvRebake = elapsed;
      }
    }

    applyLighting();
    controls.update();
    camera.updateMatrixWorld();
    updateSunAndSky();
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    renderer,
    controls,
    sky,
    pane,
    dispose() {
      renderer.setAnimationLoop(null);
      if (envRebakeTimer) clearTimeout(envRebakeTimer);
      timer.disconnect(document);
      window.removeEventListener("resize", onResize);
      pane.dispose();
      controls.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      if (disposeSkyEnv) disposeSkyEnv();
      scene.environment = null;
      if (pmremGenerator) pmremGenerator.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    },
  };
}
