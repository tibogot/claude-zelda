import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Pane } from "tweakpane";
import { createStylizedSky } from "./stylized-sky-unreal.js";

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

function fract(x) {
  return x - Math.floor(x);
}

function hash2(x, y) {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
}

function posMod(n, m) {
  return ((n % m) + m) % m;
}

function valueNoise2Tileable(x, y, period) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);

  const x0 = posMod(xi, period);
  const y0 = posMod(yi, period);
  const x1 = posMod(xi + 1, period);
  const y1 = posMod(yi + 1, period);

  const n00 = hash2(x0, y0);
  const n10 = hash2(x1, y0);
  const n01 = hash2(x0, y1);
  const n11 = hash2(x1, y1);

  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return nx0 + (nx1 - nx0) * v;
}

function fbm2Tileable(x, y, basePeriod, octaves = 4) {
  let value = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < octaves; i += 1) {
    value += valueNoise2Tileable(x * freq, y * freq, basePeriod * freq) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return value;
}

function createGroundTextures(config, size = 512) {
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = size;
  colorCanvas.height = size;
  const colorCtx = colorCanvas.getContext("2d");
  const colorImg = colorCtx.createImageData(size, size);

  const roughCanvas = document.createElement("canvas");
  roughCanvas.width = size;
  roughCanvas.height = size;
  const roughCtx = roughCanvas.getContext("2d");
  const roughImg = roughCtx.createImageData(size, size);

  const base = new THREE.Color(config.groundBaseColor);
  const lush = new THREE.Color(config.groundLushColor);
  const dry = new THREE.Color(config.groundDryColor);
  const dirt = new THREE.Color(config.groundDirtColor);
  const mixed = new THREE.Color();

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const uvx = x / size;
      const uvy = y / size;

      const nMacro = fbm2Tileable(
        uvx * config.groundMacroScale,
        uvy * config.groundMacroScale,
        config.groundMacroScale,
        4,
      );
      const nPatch = fbm2Tileable(
        uvx * config.groundPatchScale + 13.0,
        uvy * config.groundPatchScale + 29.0,
        config.groundPatchScale,
        3,
      );
      const nDetail = fbm2Tileable(
        uvx * config.groundDetailScale + 3.7,
        uvy * config.groundDetailScale + 2.1,
        config.groundDetailScale,
        2,
      );
      const dirtMask = Math.max(0, Math.min(1, (nPatch - 0.6) * 2.8));

      mixed.copy(base);
      mixed.lerp(lush, Math.max(0, Math.min(1, (nMacro - 0.35) * config.groundLushBlend)));
      mixed.lerp(dry, Math.max(0, Math.min(1, (0.5 - nMacro) * config.groundDryBlend)));
      mixed.lerp(dirt, dirtMask * config.groundDirtBlend);
      mixed.offsetHSL(0, 0, (nDetail - 0.5) * config.groundDetailStrength);
      mixed.multiplyScalar(config.groundBrightness);
      mixed.r = Math.min(1, Math.max(0, mixed.r));
      mixed.g = Math.min(1, Math.max(0, mixed.g));
      mixed.b = Math.min(1, Math.max(0, mixed.b));

      colorImg.data[i + 0] = Math.round(mixed.r * 255);
      colorImg.data[i + 1] = Math.round(mixed.g * 255);
      colorImg.data[i + 2] = Math.round(mixed.b * 255);
      colorImg.data[i + 3] = 255;

      const rough = Math.max(0, Math.min(1, config.groundRoughnessBase + (1 - nMacro) * 0.2 + dirtMask * 0.1 + nDetail * 0.08));
      const roughByte = Math.round(rough * 255);
      roughImg.data[i + 0] = roughByte;
      roughImg.data[i + 1] = roughByte;
      roughImg.data[i + 2] = roughByte;
      roughImg.data[i + 3] = 255;
    }
  }

  colorCtx.putImageData(colorImg, 0, 0);
  roughCtx.putImageData(roughImg, 0, 0);

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.wrapS = THREE.RepeatWrapping;
  colorMap.wrapT = THREE.RepeatWrapping;
  colorMap.repeat.set(config.groundTextureRepeat, config.groundTextureRepeat);
  colorMap.anisotropy = 8;
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.needsUpdate = true;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.copy(colorMap.repeat);
  roughnessMap.anisotropy = 8;
  roughnessMap.needsUpdate = true;

  return { colorMap, roughnessMap };
}

export async function createStylizedSkyUnrealScene({
  container = document.body,
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8db9ff);

  const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    20000,
  );
  camera.position.set(0, 22, 48);

  const renderer = new THREE.WebGPURenderer({
    antialias: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  try {
    await renderer.init();
  } catch (err) {
    throw new Error(
      `WebGPU renderer init failed: ${err?.message || String(err)}`,
    );
  }
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 8, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.499;
  controls.minDistance = 6;
  controls.maxDistance = 300;

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(3800, 128),
    new THREE.MeshStandardMaterial({
      roughness: 0.98,
      metalness: 0.0,
    }),
  );
  ground.rotation.x = -Math.PI * 0.5;
  ground.position.y = -0.5;
  scene.add(ground);

  const sunLight = new THREE.DirectionalLight(0xfff2cf, 2.4);
  scene.add(sunLight);
  scene.add(sunLight.target);

  const hemi = new THREE.HemisphereLight(0x8fb6ff, 0x35421e, 0.45);
  scene.add(hemi);

  const sky = createStylizedSky();
  sky.mesh.visible = true;
  scene.add(sky.mesh);

  const pane = new Pane({ title: "Stylized Sky Unreal (WebGPU)" });

  const skyU = sky.uniforms;
  const params = {
    skyVisible: true,
    groundVisible: true,
    light: {
      sunAzimuth: 145,
      sunElevation: 30,
      dirColor: "#fff2cf",
      dirIntensity: 2.4,
      hemiSkyColor: "#8fb6ff",
      hemiGroundColor: "#35421e",
      hemiIntensity: 0.45,
      exposure: 1.0,
    },
    dayNight: {
      time: 15.2,
      speed: 6,
      enabled: false,
    },
    c1Angle: sky.windState.c1Angle,
    c1Speed: sky.windState.c1Speed,
    c2Angle: sky.windState.c2Angle,
    c2Speed: sky.windState.c2Speed,
    groundBaseColor: "#4e7241",
    groundLushColor: "#5d8b4a",
    groundDryColor: "#6b6643",
    groundDirtColor: "#544a35",
    groundMacroScale: 8,
    groundPatchScale: 16,
    groundDetailScale: 64,
    groundLushBlend: 1.3,
    groundDryBlend: 1.2,
    groundDirtBlend: 0.45,
    groundDetailStrength: 0.09,
    groundTextureRepeat: 28,
    groundRoughnessBase: 0.72,
    groundBrightness: 1.0,
    fogEnabled: true,
    fogDensity: 0.00016,
    fogAutoSkyColor: true,
    fogColor: "#9bb9c7",
    fogSkyMix: 0.9,
    fogBrightness: 1.0,
  };
  const _dnC0 = new THREE.Color();
  const _dnC1 = new THREE.Color();
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

  let groundTex = createGroundTextures(params, 512);
  ground.material.map = groundTex.colorMap;
  ground.material.roughnessMap = groundTex.roughnessMap;
  ground.material.roughness = 0.98;
  ground.material.needsUpdate = true;

  const rebuildGroundTexture = () => {
    const next = createGroundTextures(params, 512);
    ground.material.map = next.colorMap;
    ground.material.roughnessMap = next.roughnessMap;
    ground.material.needsUpdate = true;
    groundTex.colorMap.dispose();
    groundTex.roughnessMap.dispose();
    groundTex = next;
  };

  const fog = new THREE.FogExp2(0x9bb9c7, params.fogDensity);
  const fogAutoCol = new THREE.Color();
  const fogManualCol = new THREE.Color(params.fogColor);
  const fogFinalCol = new THREE.Color();
  const white = new THREE.Color(0xffffff);

  const applyFogSettings = (sunY = 0.5) => {
    if (!params.fogEnabled) {
      scene.fog = null;
      return;
    }

    if (scene.fog !== fog) scene.fog = fog;
    fog.density = params.fogDensity;

    if (params.fogAutoSkyColor) {
      const sunsetBlend = smoothstep(0.28, -0.05, sunY);
      const nightBlend = smoothstep(0.05, -0.08, sunY);
      fogAutoCol.copy(skyU.horizonColor.value);
      fogAutoCol.lerp(skyU.sunsetColor.value, sunsetBlend * 0.65);
      fogAutoCol.lerp(skyU.groundColor.value, 0.18);
      fogAutoCol.lerp(new THREE.Color(0x1b243a), nightBlend * 0.72);
      fogFinalCol.copy(fogManualCol).lerp(fogAutoCol, params.fogSkyMix);
    } else {
      fogFinalCol.copy(fogManualCol);
    }

    fogFinalCol.multiplyScalar(params.fogBrightness);
    fogFinalCol.lerp(white, Math.max(0, params.fogBrightness - 1) * 0.12);
    fog.color.copy(fogFinalCol);
  };
  let groundRebuildTimer = null;
  const scheduleGroundTextureRebuild = (delayMs = 70) => {
    if (groundRebuildTimer !== null) {
      clearTimeout(groundRebuildTimer);
    }
    groundRebuildTimer = window.setTimeout(() => {
      groundRebuildTimer = null;
      rebuildGroundTexture();
    }, delayMs);
  };

  const applyLighting = () => {
    renderer.toneMappingExposure = params.light.exposure;
    sunLight.color.set(params.light.dirColor).convertSRGBToLinear();
    sunLight.intensity = params.light.dirIntensity;
    hemi.color.set(params.light.hemiSkyColor).convertSRGBToLinear();
    hemi.groundColor.set(params.light.hemiGroundColor).convertSRGBToLinear();
    hemi.intensity = params.light.hemiIntensity;
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
    const lrpCol = (a, b) => `#${_dnC0.set(a).lerp(_dnC1.set(b), t).getHexString()}`;
    params.light.dirColor = lrpCol(k0.dc, k1.dc);
    params.light.dirIntensity = lrp(k0.di, k1.di);
    params.light.hemiSkyColor = lrpCol(k0.sk, k1.sk);
    params.light.hemiGroundColor = lrpCol(k0.gr, k1.gr);
    params.light.hemiIntensity = lrp(k0.hi, k1.hi);
    params.light.exposure = lrp(k0.ex, k1.ex);

    const dnf = Math.max(0, Math.min(1, (-rawElev - 5) / 25));
    const lrpSky = (a, b) => _dnC0.set(a).lerp(_dnC1.set(b), dnf).convertSRGBToLinear();
    skyU.sunsetLow.value.copy(lrpSky("#b82000", "#020408"));
    skyU.sunsetColor.value.copy(lrpSky("#ff7838", "#060a14"));
    skyU.sunsetHigh.value.copy(lrpSky("#e8b0c8", "#0c1828"));
    skyU.zenithColor.value.copy(lrpSky("#1535b0", "#010306"));
    skyU.horizonRingStr.value = 0.22 * (1 - dnf);
  };
  applyLighting();

  const fScene = pane.addFolder({ title: "Scene", expanded: true });
  fScene.addBinding(params, "skyVisible").on("change", (ev) => {
    sky.mesh.visible = ev.value;
  });
  fScene.addBinding(params, "groundVisible").on("change", (ev) => {
    ground.visible = ev.value;
  });

  const fGround = pane.addFolder({ title: "Ground", expanded: false });
  fGround.addBinding(params, "groundBaseColor", { view: "color", label: "base" }).on("change", () => scheduleGroundTextureRebuild(40));
  fGround.addBinding(params, "groundLushColor", { view: "color", label: "lush" }).on("change", () => scheduleGroundTextureRebuild(40));
  fGround.addBinding(params, "groundDryColor", { view: "color", label: "dry" }).on("change", () => scheduleGroundTextureRebuild(40));
  fGround.addBinding(params, "groundDirtColor", { view: "color", label: "dirt" }).on("change", () => scheduleGroundTextureRebuild(40));
  fGround.addBinding(params, "groundMacroScale", { min: 2, max: 32, step: 1, label: "macro scale" }).on("change", () => scheduleGroundTextureRebuild());
  fGround.addBinding(params, "groundPatchScale", { min: 4, max: 64, step: 1, label: "patch scale" }).on("change", () => scheduleGroundTextureRebuild());
  fGround.addBinding(params, "groundDetailScale", { min: 8, max: 256, step: 1, label: "detail scale" }).on("change", () => scheduleGroundTextureRebuild());
  fGround.addBinding(params, "groundTextureRepeat", { min: 4, max: 80, step: 1, label: "tile repeat" }).on("change", () => {
    ground.material.map.repeat.set(params.groundTextureRepeat, params.groundTextureRepeat);
    ground.material.roughnessMap.repeat.copy(ground.material.map.repeat);
    ground.material.needsUpdate = true;
  });
  fGround.addBinding(params, "groundLushBlend", { min: 0, max: 3, step: 0.05, label: "lush blend" }).on("change", () => scheduleGroundTextureRebuild());
  fGround.addBinding(params, "groundDryBlend", { min: 0, max: 3, step: 0.05, label: "dry blend" }).on("change", () => scheduleGroundTextureRebuild());
  fGround.addBinding(params, "groundDirtBlend", { min: 0, max: 1, step: 0.01, label: "dirt blend" }).on("change", () => scheduleGroundTextureRebuild());
  fGround.addBinding(params, "groundDetailStrength", { min: 0, max: 0.2, step: 0.005, label: "detail amount" }).on("change", () => scheduleGroundTextureRebuild());
  fGround.addBinding(params, "groundRoughnessBase", { min: 0.3, max: 1, step: 0.01, label: "roughness base" }).on("change", () => {
    ground.material.roughness = params.groundRoughnessBase;
    ground.material.needsUpdate = true;
  });
  fGround.addBinding(params, "groundBrightness", { min: 0.4, max: 2.0, step: 0.01, label: "overall brightness" }).on("change", () => scheduleGroundTextureRebuild(40));

  const fFog = pane.addFolder({ title: "Fog", expanded: false });
  fFog.addBinding(params, "fogEnabled", { label: "enabled" }).on("change", () => applyFogSettings(sunDir.y));
  fFog.addBinding(params, "fogDensity", { min: 0.00001, max: 0.0025, step: 0.00001, label: "density" }).on("change", () => applyFogSettings(sunDir.y));
  fFog.addBinding(params, "fogAutoSkyColor", { label: "auto sky color" }).on("change", () => applyFogSettings(sunDir.y));
  fFog.addBinding(params, "fogColor", { view: "color", label: "manual color" }).on("change", (ev) => {
    fogManualCol.set(ev.value).convertSRGBToLinear();
    applyFogSettings(sunDir.y);
  });
  fFog.addBinding(params, "fogSkyMix", { min: 0, max: 1, step: 0.01, label: "sky influence" }).on("change", () => applyFogSettings(sunDir.y));
  fFog.addBinding(params, "fogBrightness", { min: 0.4, max: 2, step: 0.01, label: "brightness" }).on("change", () => applyFogSettings(sunDir.y));

  const lightFolder = pane.addFolder({ title: "Lighting", expanded: false });
  lightFolder.addBinding(params.light, "sunAzimuth", { label: "Sun azimuth", min: 0, max: 360, step: 1 });
  lightFolder.addBinding(params.light, "sunElevation", { label: "Sun elevation", min: -10, max: 90, step: 1 });
  lightFolder.addBinding(params.light, "dirColor", { label: "Sun color", view: "color" }).on("change", applyLighting);
  lightFolder.addBinding(params.light, "dirIntensity", { label: "Sun intensity", min: 0, max: 5, step: 0.1 }).on("change", applyLighting);
  lightFolder.addBinding(params.light, "hemiSkyColor", { label: "Ambient sky", view: "color" }).on("change", applyLighting);
  lightFolder.addBinding(params.light, "hemiGroundColor", { label: "Ambient ground", view: "color" }).on("change", applyLighting);
  lightFolder.addBinding(params.light, "hemiIntensity", { label: "Ambient intensity", min: 0, max: 3, step: 0.1 }).on("change", applyLighting);
  lightFolder.addBinding(params.light, "exposure", { label: "Exposure", min: 0.1, max: 2, step: 0.05 }).on("change", applyLighting);

  const dnFolder = pane.addFolder({ title: "Day / Night", expanded: false });
  const dnTimeBinding = dnFolder.addBinding(params.dayNight, "time", {
    label: "Time of day",
    min: 0,
    max: 24,
    step: 0.01,
  }).on("change", ({ value }) => {
    if (!params.dayNight.enabled) syncDayNight(value);
  });
  dnFolder.addBinding(params.dayNight, "speed", {
    label: "Speed (x)",
    min: 0,
    max: 20,
    step: 0.1,
  });
  dnFolder.addBinding(params.dayNight, "enabled", { label: "Animate" });
  dnFolder.addButton({ title: "Set to Noon" }).on("click", () => {
    params.dayNight.time = 12;
    syncDayNight(12);
    dnTimeBinding.refresh();
  });
  dnFolder.addButton({ title: "Set to Sunset" }).on("click", () => {
    params.dayNight.time = 18;
    syncDayNight(18);
    dnTimeBinding.refresh();
  });
  dnFolder.addButton({ title: "Set to Night" }).on("click", () => {
    params.dayNight.time = 0;
    syncDayNight(0);
    dnTimeBinding.refresh();
  });

  const fWind = pane.addFolder({ title: "Cloud Wind", expanded: false });
  fWind.addBinding(params, "c1Angle", { min: 0, max: 360, step: 1 }).on(
    "change",
    (ev) => {
      sky.windState.c1Angle = ev.value;
      sky.updateWind();
    },
  );
  fWind.addBinding(params, "c1Speed", { min: 0, max: 0.05, step: 0.0005 }).on(
    "change",
    (ev) => {
      sky.windState.c1Speed = ev.value;
      sky.updateWind();
    },
  );
  fWind.addBinding(params, "c2Angle", { min: 0, max: 360, step: 1 }).on(
    "change",
    (ev) => {
      sky.windState.c2Angle = ev.value;
      sky.updateWind();
    },
  );
  fWind.addBinding(params, "c2Speed", { min: 0, max: 0.05, step: 0.0005 }).on(
    "change",
    (ev) => {
      sky.windState.c2Speed = ev.value;
      sky.updateWind();
    },
  );

  const fGradient = pane.addFolder({ title: "Gradient Colors", expanded: false });
  bindUniformColor(fGradient, "zenithColor", skyU.zenithColor);
  bindUniformColor(fGradient, "skyColor", skyU.skyColor);
  bindUniformColor(fGradient, "horizonColor", skyU.horizonColor);
  bindUniformColor(fGradient, "sunsetColor", skyU.sunsetColor);
  bindUniformColor(fGradient, "sunsetLow", skyU.sunsetLow);
  bindUniformColor(fGradient, "sunsetHigh", skyU.sunsetHigh);
  bindUniformColor(fGradient, "groundColor", skyU.groundColor);

  const fSun = pane.addFolder({ title: "Sun", expanded: false });
  bindUniformColor(fSun, "sunColor", skyU.sunColor);
  bindUniformFloat(fSun, "sunSize", skyU.sunSize, { min: 0.001, max: 0.08, step: 0.0005 });
  bindUniformFloat(fSun, "sunGlowPower", skyU.sunGlowPower, { min: 1, max: 24, step: 0.1 });
  bindUniformFloat(fSun, "sunGlowStrength", skyU.sunGlowStrength, { min: 0, max: 6, step: 0.01 });
  bindUniformFloat(fSun, "sunHaloStr", skyU.sunHaloStr, { min: 0, max: 2, step: 0.01 });
  bindUniformFloat(fSun, "sunHaloRadius", skyU.sunHaloRadius, { min: 1, max: 6, step: 0.01 });
  bindUniformFloat(fSun, "sunRayCount", skyU.sunRayCount, { min: 1, max: 32, step: 1 });
  bindUniformFloat(fSun, "sunRayStr", skyU.sunRayStr, { min: 0, max: 3, step: 0.01 });
  bindUniformFloat(fSun, "sunRaySharp", skyU.sunRaySharp, { min: 1, max: 20, step: 0.1 });
  bindUniformFloat(fSun, "sunRayLen", skyU.sunRayLen, { min: 0.01, max: 1, step: 0.005 });

  const fHorizon = pane.addFolder({ title: "Horizon Ring", expanded: false });
  bindUniformFloat(fHorizon, "horizonRingStr", skyU.horizonRingStr, { min: 0, max: 2, step: 0.01 });
  bindUniformFloat(fHorizon, "horizonRingWidth", skyU.horizonRingWidth, { min: 0.005, max: 0.5, step: 0.005 });
  bindUniformColor(fHorizon, "horizonRingColor", skyU.horizonRingColor);

  const fCloud1 = pane.addFolder({ title: "Cloud Layer 1", expanded: false });
  bindUniformFloat(fCloud1, "c1Coverage", skyU.c1Coverage, { min: 0, max: 1, step: 0.005 });
  bindUniformFloat(fCloud1, "c1Softness", skyU.c1Softness, { min: 0.01, max: 0.6, step: 0.005 });
  bindUniformFloat(fCloud1, "c1Scale", skyU.c1Scale, { min: 0.05, max: 3, step: 0.01 });
  bindUniformFloat(fCloud1, "c1Height", skyU.c1Height, { min: 0.1, max: 8, step: 0.01 });
  bindUniformFloat(fCloud1, "c1WarpStr", skyU.c1WarpStr, { min: 0, max: 1, step: 0.005 });
  bindUniformFloat(fCloud1, "c1WarpScale", skyU.c1WarpScale, { min: 0.05, max: 2, step: 0.005 });
  bindUniformFloat(fCloud1, "c1Contrast", skyU.c1Contrast, { min: 0.1, max: 3, step: 0.01 });

  const fCloud2 = pane.addFolder({ title: "Cloud Layer 2", expanded: false });
  bindUniformFloat(fCloud2, "c2Coverage", skyU.c2Coverage, { min: 0, max: 1, step: 0.005 });
  bindUniformFloat(fCloud2, "c2Softness", skyU.c2Softness, { min: 0.01, max: 0.6, step: 0.005 });
  bindUniformFloat(fCloud2, "c2Scale", skyU.c2Scale, { min: 0.05, max: 3, step: 0.01 });
  bindUniformFloat(fCloud2, "c2Height", skyU.c2Height, { min: 0.1, max: 8, step: 0.01 });
  bindUniformFloat(fCloud2, "c2WarpStr", skyU.c2WarpStr, { min: 0, max: 1, step: 0.005 });
  bindUniformFloat(fCloud2, "c2WarpScale", skyU.c2WarpScale, { min: 0.05, max: 2, step: 0.005 });
  bindUniformFloat(fCloud2, "c2Contrast", skyU.c2Contrast, { min: 0.1, max: 3, step: 0.01 });

  const fCloudColor = pane.addFolder({ title: "Cloud Shading", expanded: false });
  bindUniformColor(fCloudColor, "cloudLit", skyU.cloudLit);
  bindUniformColor(fCloudColor, "cloudShadow", skyU.cloudShadow);
  bindUniformFloat(fCloudColor, "cloudShadowStr", skyU.cloudShadowStr, { min: 0, max: 2, step: 0.01 });
  bindUniformColor(fCloudColor, "cloudSunset", skyU.cloudSunset);
  bindUniformFloat(fCloudColor, "cloudVertStr", skyU.cloudVertStr, { min: 0, max: 1, step: 0.01 });
  bindUniformColor(fCloudColor, "cloudGradientDark", skyU.cloudGradientDark);

  const fGodRays = pane.addFolder({ title: "God Rays", expanded: false });
  bindUniformFloat(fGodRays, "godRayStr", skyU.godRayStr, { min: 0, max: 2, step: 0.01 });
  bindUniformFloat(fGodRays, "godRayDecay", skyU.godRayDecay, { min: 0.7, max: 0.999, step: 0.001 });

  const fMoon = pane.addFolder({ title: "Moon", expanded: false });
  bindUniformColor(fMoon, "moonColor", skyU.moonColor);
  bindUniformFloat(fMoon, "moonGlowStr", skyU.moonGlowStr, { min: 0, max: 1, step: 0.005 });
  bindUniformFloat(fMoon, "moonGlowPower", skyU.moonGlowPower, { min: 1, max: 40, step: 0.1 });

  const fStars = pane.addFolder({ title: "Stars", expanded: false });
  bindUniformFloat(fStars, "starsDensity", skyU.starsDensity, { min: 1, max: 200, step: 1 });
  bindUniformFloat(fStars, "starsSize", skyU.starsSize, { min: 0.01, max: 0.25, step: 0.001 });
  bindUniformFloat(fStars, "starsBrightness", skyU.starsBrightness, { min: 0, max: 3, step: 0.01 });

  const timer = new THREE.Timer();
  timer.connect(document);
  const sunDir = new THREE.Vector3();

  function updateSunAndSky() {
    sunDir.copy(computeSunDir(params.light.sunAzimuth, params.light.sunElevation));

    const lightDist = 1600;
    sunLight.position.copy(sunDir).multiplyScalar(lightDist);
    sunLight.target.position.set(0, 0, 0);
    sunLight.target.updateMatrixWorld();

    applyFogSettings(sunDir.y);
    sky.update(sunDir, camera.position);
  }

  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  window.addEventListener("resize", onResize);

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = timer.getDelta();
    if (params.dayNight.enabled) {
      params.dayNight.time = (params.dayNight.time + dt * params.dayNight.speed * 0.1 + 24) % 24;
      syncDayNight(params.dayNight.time);
      dnTimeBinding.refresh();
    }
    applyLighting();
    controls.update();
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
      if (groundRebuildTimer !== null) {
        clearTimeout(groundRebuildTimer);
      }
      timer.disconnect(document);
      window.removeEventListener("resize", onResize);
      pane.dispose();
      controls.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      groundTex.colorMap.dispose();
      groundTex.roughnessMap.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    },
  };
}

if (typeof window !== "undefined") {
  createStylizedSkyUnrealScene().catch((err) => {
    console.error("[stylized-sky-unreal-scene] failed to start:", err);
  });
}
