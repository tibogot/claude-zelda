/**
 * fx-rain.js — folio RainLines.js port (Bruno Simon folio-2025).
 */
import * as THREE from "three/webgpu";
import { attribute, float, Fn, fract, mod, step, uniform, vec2, vec3 } from "three/tsl";
import {
  FolioMeshDefaultMaterial,
  createFolioLighting,
  updateFolioLightingFromScene,
} from "./folio-mesh-default-material.js";
import { computeOptimalArea } from "./folio-optimal-area.js";

function remapClamp(input, inLow, inHigh, outLow, outHigh) {
  const t = (input - inLow) / (inHigh - inLow);
  const v = outLow + t * (outHigh - outLow);
  return Math.max(Math.min(v, Math.max(outLow, outHigh)), Math.min(outLow, outHigh));
}

function lerp(a, b, t) {
  return (1 - t) * a + t * b;
}

const LINE_COUNT = Math.pow(2, 11);

function buildRainGeometry(count) {
  const positionArray = new Float32Array(count * 4 * 3);
  const offsetArray = new Float32Array(count * 4 * 2);
  const randomArray = new Float32Array(count * 4);
  const indexArray = new Uint16Array(count * 6);

  for (let lineIndex = 0; lineIndex < count; lineIndex++) {
    const x = Math.random();
    const y = 0;
    const z = Math.random();
    const random = Math.random();

    for (let vertexIndex = 0; vertexIndex < 4; vertexIndex++) {
      const positionIndex = (lineIndex * 4 + vertexIndex) * 3;
      positionArray[positionIndex + 0] = x;
      positionArray[positionIndex + 1] = y;
      positionArray[positionIndex + 2] = z;

      const offsetIndex = (lineIndex * 4 + vertexIndex) * 2;
      offsetArray[offsetIndex + 0] = 0;
      offsetArray[offsetIndex + 1] = 0;

      if (vertexIndex === 0 || vertexIndex === 1) offsetArray[offsetIndex + 0] = 1;
      if (vertexIndex === 0 || vertexIndex === 3) offsetArray[offsetIndex + 1] = 1;

      randomArray[lineIndex * 4 + vertexIndex] = random;
    }

    indexArray[lineIndex * 6 + 0] = lineIndex * 4 + 0;
    indexArray[lineIndex * 6 + 1] = lineIndex * 4 + 3;
    indexArray[lineIndex * 6 + 2] = lineIndex * 4 + 2;
    indexArray[lineIndex * 6 + 3] = lineIndex * 4 + 2;
    indexArray[lineIndex * 6 + 4] = lineIndex * 4 + 1;
    indexArray[lineIndex * 6 + 5] = lineIndex * 4 + 0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positionArray, 3));
  geometry.setAttribute("offset", new THREE.Float32BufferAttribute(offsetArray, 2));
  geometry.setAttribute("random", new THREE.Float32BufferAttribute(randomArray, 1));
  geometry.index = new THREE.Uint16BufferAttribute(indexArray, 1);
  return geometry;
}

/** Folio weather bindings (RainLines update + manual bindings). */
function applyWeatherBindings(state, sh) {
  const rain = state.params.enabled
    ? Math.max(0, Math.min(1, state.params.rain * (sh.density ?? 1)))
    : 0;

  state.visibleRatio.value = Math.pow(rain, 2);

  const baseLength = remapClamp(rain, 0, 1, 1, 3);
  const snowRatio = 1 - Math.pow(1 - Math.max(state.params.snow, 0), 4);
  const snowLength = 0.03;
  state.length.value = lerp(baseLength, snowLength, snowRatio);

  const baseSpeed = remapClamp(rain, 0, 1, 0.2, 0.4);
  const snowSpeed = 0.05;
  state.speed = lerp(baseSpeed, snowSpeed, snowRatio);

  const wind = Math.max(0, Math.min(1, sh.windStrength ?? 1));
  state.incline.value = remapClamp(wind, 0, 1, 0.1, 0.4);
}

/**
 * @param {THREE.Scene} scene
 * @param {object} shared
 */
export function createRainFX(scene, shared, _getTerrainHeight) {
  const params = {
    enabled: true,
    rain: 1.0,
    snow: 0,
    elevation: 20,
    thickness: 0.015,
  };

  const lighting = createFolioLighting();

  const thickness = uniform(0.015);
  const elevation = uniform(20);
  const incline = uniform(0.2);
  const size = uniform(48);
  const center = uniform(vec2());
  const length = uniform(2);
  const localTime = uniform(0);
  const visibleRatio = uniform(0);
  // Separate float uniforms — vec2 uniform math was unreliable in TSL here.
  const billboardX = uniform(0.707);
  const billboardZ = uniform(-0.707);

  const material = new FolioMeshDefaultMaterial(lighting, {
    normalNode: vec3(0, 1, 0),
    transparent: true,
    wireframe: false,
    side: THREE.DoubleSide,
    depthWrite: false,
    hasCoreShadows: false,
    hasDropShadows: false,
    hasLightBounce: false,
    hasFog: false,
    hasWater: false,
  });

  material.positionNode = Fn(() => {
    const newPosition = attribute("position").toVar();
    const offset = attribute("offset");
    const random = attribute("random");
    const inclineDir = vec2(0.707, -0.707);

    newPosition.xz.mulAssign(size);
    newPosition.xz.subAssign(center);
    const halfSize = size.mul(0.5);
    newPosition.x.assign(mod(newPosition.x.add(halfSize), size).sub(halfSize));
    newPosition.z.assign(mod(newPosition.z.add(halfSize), size).sub(halfSize));
    newPosition.xz.addAssign(center);

    const halfWidth = offset.x.mul(thickness);
    newPosition.x.addAssign(billboardX.mul(halfWidth));
    newPosition.z.addAssign(billboardZ.mul(halfWidth));

    const progress = localTime.add(random).mod(1);
    newPosition.y.assign(elevation.add(length));
    newPosition.y.subAssign(length.mul(offset.y.oneMinus()));
    newPosition.y.subAssign(progress.mul(elevation.add(length)));
    newPosition.y.assign(newPosition.y.clamp(0, elevation));

    const visible = step(visibleRatio, fract(random.mul(99)));
    newPosition.y.addAssign(visible.mul(99));

    newPosition.xz.addAssign(inclineDir.mul(newPosition.y.mul(incline).mul(-1)));

    return newPosition;
  })();

  const geometry = buildRainGeometry(LINE_COUNT);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -0.3;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);

  let camera = null;
  let controls = null;
  let speed = 0.25;

  const state = {
    params,
    thickness,
    elevation,
    incline,
    size,
    center,
    length,
    localTime,
    visibleRatio,
    speed,
  };

  function updateRainVolume() {
    const radius = Math.max(10, shared.volume ?? 30);

    if (controls) {
      center.value.set(controls.target.x, controls.target.z);
      size.value = radius * 2;
      return;
    }

    if (!camera) {
      center.value.set(0, 0);
      size.value = radius * 2;
      return;
    }

    const optimal = computeOptimalArea(camera, null);
    center.value.set(optimal.position.x, optimal.position.z);
    size.value = Math.max(radius * 2, optimal.radius * 2);
  }

  function updateBillboard() {
    if (!camera) return;

    const cx = controls ? controls.target.x : center.value.x;
    const cz = controls ? controls.target.z : center.value.y;

    const dx = camera.position.x - cx;
    const dz = camera.position.z - cz;
    const len = Math.hypot(dx, dz);

    if (len > 1e-4) {
      billboardX.value = -dz / len;
      billboardZ.value = dx / len;
    }
  }

  function update(dt, _elapsed, sh) {
    updateFolioLightingFromScene(lighting, scene);

    thickness.value = params.thickness;
    elevation.value = params.elevation;

    applyWeatherBindings(state, sh);

    mesh.visible = visibleRatio.value > 0.00001;
    if (!mesh.visible) return;

    updateRainVolume();
    updateBillboard();
    localTime.value += dt * speed;
  }

  function setCamera(cam) {
    camera = cam;
    updateRainVolume();
    updateBillboard();
  }

  function setView(cam, ctrl) {
    camera = cam;
    controls = ctrl;
    updateRainVolume();
    updateBillboard();
  }

  function onResize() {
    updateRainVolume();
    updateBillboard();
  }

  function dispose(sc) {
    sc.remove(mesh);
    geometry.dispose();
    material.dispose();
  }

  applyWeatherBindings(state, shared);
  updateRainVolume();

  return {
    update,
    dispose,
    params,
    setCamera,
    setView,
    onResize,
    mesh,
  };
}

export function buildRainUI(folder, state) {
  const p = state.params;

  folder.addBinding(p, "enabled", { label: "Enabled" });

  folder.addBinding(p, "rain", {
    label: "Rain",
    min: 0,
    max: 1,
    step: 0.001,
  });

  folder.addBinding(p, "snow", {
    label: "Snow",
    min: -1,
    max: 1,
    step: 0.001,
  });

  folder.addBinding(p, "elevation", {
    label: "Elevation",
    min: 0,
    max: 50,
    step: 0.1,
  });

  folder.addBinding(p, "thickness", {
    label: "Thickness",
    min: 0,
    max: 0.1,
    step: 0.001,
  });
}
