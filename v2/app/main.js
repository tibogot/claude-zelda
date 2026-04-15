import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import { V2_CONFIG } from "./config.js";
import { createPerfState, createToolState, tickPerf } from "./state/toolState.js";
import { TerrainStore } from "../core/terrain/terrainStore.js";
import { TerrainMesher } from "../render/terrain/terrainMesher.js";
import { createSharedTileMaterial } from "../render/terrain/sharedTileMaterial.js";
import { ChunkStreamManager } from "../core/streaming/chunkStreamManager.js";
import { SculptSystem } from "../tools/sculpt/sculptSystem.js";
import { createTweakpaneUi } from "../ui/tweakpaneUi.js";
import { createHud } from "../ui/hud.js";

export async function startV2App() {
  const config = structuredClone(V2_CONFIG);
  const toolState = createToolState();
  const perf = createPerfState();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(config.render.clearColor);

  const camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.1,
    5000,
  );
  camera.position.set(160, 140, 180);

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.render.maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);
  await renderer.init();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 10, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 15;
  controls.maxDistance = 1500;
  // Match splatmap-chunks.html interaction: LMB sculpt, MMB orbit, RMB pan.
  controls.mouseButtons = {
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN,
  };

  const hemi = new THREE.HemisphereLight(0xd7ebff, 0x5d6460, toolState.sky.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff8ea, toolState.sky.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = 2500;
  sun.shadow.camera.left = -500;
  sun.shadow.camera.right = 500;
  sun.shadow.camera.top = 500;
  sun.shadow.camera.bottom = -500;
  scene.add(sun);
  scene.add(sun.target);

  const sky = new SkyMesh();
  sky.scale.setScalar(4500);
  scene.add(sky);

  const terrainStore = new TerrainStore(config);
  terrainStore.preloadChunksInRadius(0, 0, 4);

  const terrainMaterial = createSharedTileMaterial();
  const terrainMesher = new TerrainMesher(config);
  const chunkStream = new ChunkStreamManager({
    config,
    scene,
    terrainStore,
    mesher: terrainMesher,
    material: terrainMaterial,
    perf,
  });
  const sculptSystem = new SculptSystem({
    toolState,
    terrainStore,
    chunkStream,
  });

  const hud = createHud();
  const ui = createTweakpaneUi({
    toolState,
    config,
    sculptSystem,
    perf,
    onConfigChanged: () => {
      chunkStream.update(camera.position);
    },
  });

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.045, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xf5cc52 }),
  );
  ring.rotation.x = Math.PI * 0.5;
  ring.visible = false;
  scene.add(ring);

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerDown = false;
  let hudLastMs = 0;

  function updateSunSky() {
    const elev = THREE.MathUtils.degToRad(toolState.sky.elevationDeg);
    const az = THREE.MathUtils.degToRad(toolState.sky.azimuthDeg);
    const dir = new THREE.Vector3(
      Math.cos(elev) * Math.sin(az),
      Math.sin(elev),
      Math.cos(elev) * Math.cos(az),
    ).normalize();
    sun.position.copy(dir).multiplyScalar(700);
    sun.target.position.set(0, 0, 0);
    hemi.intensity = toolState.sky.hemiIntensity;
    sun.intensity = toolState.sky.sunIntensity;
    if (sky.sunPosition?.value?.copy) {
      sky.sunPosition.value.copy(dir);
    } else if (sky.sunPosition?.copy) {
      // Fallback for potential SkyMesh API variation.
      sky.sunPosition.copy(dir);
    }
    sky.position.copy(camera.position);
  }

  function updatePointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function pickTerrain(event) {
    updatePointer(event);
    const targets = chunkStream.raycastMeshes();
    if (targets.length === 0) return null;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    return hits[0].point;
  }

  function updateBrushRing(event) {
    const hit = pickTerrain(event);
    if (!hit) {
      ring.visible = false;
      return;
    }
    ring.visible = true;
    ring.scale.setScalar(toolState.brush.radius);
    ring.position.set(hit.x, hit.y + 0.08, hit.z);
  }

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || toolState.mode !== "sculpt") return;
    const hit = pickTerrain(event);
    if (!hit) return;
    event.preventDefault();
    pointerDown = true;
    controls.enabled = false;
    sculptSystem.beginStroke(hit, event);
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    updateBrushRing(event);
    if (!pointerDown || toolState.mode !== "sculpt") return;
    const hit = pickTerrain(event);
    if (!hit) return;
    sculptSystem.applyAt(hit, event);
  });

  // splatmap-chunks-main.js: Shift+wheel → brush size, Alt+wheel → strength (Shift wins if both).
  function onCanvasWheelBrush(e) {
    if (!e.shiftKey && !e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.deltaY < 0 ? 1 : -1;
    if (e.shiftKey) {
      toolState.brush.radius = THREE.MathUtils.clamp(
        toolState.brush.radius + dir * 2,
        config.sculpt.brushMin,
        config.sculpt.brushMax,
      );
    } else {
      toolState.brush.strength = THREE.MathUtils.clamp(
        toolState.brush.strength + dir * 0.05,
        config.sculpt.strengthMin,
        config.sculpt.strengthMax,
      );
    }
    ui.refreshBrush();
  }
  renderer.domElement.addEventListener("wheel", onCanvasWheelBrush, {
    passive: false,
    capture: true,
  });

  window.addEventListener("pointerup", () => {
    if (!pointerDown) return;
    pointerDown = false;
    controls.enabled = true;
    sculptSystem.endStroke();
  });

  window.addEventListener("keydown", (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.code === "KeyZ") {
      event.preventDefault();
      if (event.shiftKey) sculptSystem.redo();
      else sculptSystem.undo();
    } else if (ctrl && event.code === "KeyY") {
      event.preventDefault();
      sculptSystem.redo();
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dtMs = now - last;
    last = now;
    tickPerf(perf, now, dtMs);

    controls.update();
    updateSunSky();
    chunkStream.update(camera.position);

    let tris = 0;
    for (const ch of chunkStream.activeChunks.values()) {
      tris += ch.segments * ch.segments * 2;
    }
    perf.trisApprox = tris;

    if (now - hudLastMs > 180) {
      hud.update({ perf, toolState, sculptSystem });
      ui.refreshPerf();
      hudLastMs = now;
    }
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    renderer,
    dispose() {
      renderer.domElement.removeEventListener("wheel", onCanvasWheelBrush, { capture: true });
      ui.dispose();
      chunkStream.dispose();
      terrainMaterial.dispose();
      ring.geometry.dispose();
      ring.material.dispose();
      controls.dispose();
      renderer.dispose();
    },
  };
}

