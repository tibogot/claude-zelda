import * as THREE from "three";
import {
  uniform,
  mix,
  clamp,
  fog,
  exponentialHeightFogFactor,
  densityFogFactor,
} from "three/tsl";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import { V2_CONFIG } from "./config.js";
import { createPerfState, createToolState, tickPerf } from "./state/toolState.js";
import { TerrainStore } from "../core/terrain/terrainStore.js";
import { TerrainMesher } from "../render/terrain/terrainMesher.js";
import { createSharedTileMaterial } from "../render/terrain/sharedTileMaterial.js";
import { createV2ProceduralGroundMaterial } from "../render/terrain/proceduralGroundMaterial.js";
import { ChunkStreamManager } from "../core/streaming/chunkStreamManager.js";
import { SculptSystem } from "../tools/sculpt/sculptSystem.js";
import { createTweakpaneUi } from "../ui/tweakpaneUi.js";
import { createHud } from "../ui/hud.js";
import { createLensFlareSystem } from "../effects/lensFlare.js";

export async function startV2App() {
  const config = structuredClone(V2_CONFIG);
  const toolState = createToolState();
  const perf = createPerfState();

  const scene = new THREE.Scene();
  // splatmap-chunks.html: physical sky + PMREM — background stays null so SkyMesh fills the view.
  scene.background = null;

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

  /** Same convention as `splatmap-chunks.html` `sunDirectionFromAngles`. */
  const sunDir = new THREE.Vector3();
  function sunDirectionFromAngles(azDeg, elDeg, target = new THREE.Vector3()) {
    const az = THREE.MathUtils.degToRad(azDeg);
    const el = THREE.MathUtils.degToRad(elDeg);
    return target
      .set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az))
      .normalize();
  }

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

  const L = toolState.light;
  const hemi = new THREE.HemisphereLight(L.hemiSkyColor, L.hemiGroundColor, L.hemiIntensity);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(L.dirColor, L.dirIntensity);
  sun.castShadow = true;
  const shadowTarget = new THREE.Object3D();
  scene.add(shadowTarget);
  sun.target = shadowTarget;
  sun.shadow.mapSize.set(toolState.csm.mapSize, toolState.csm.mapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 300;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -300;
  sun.shadow.camera.right = sun.shadow.camera.top = 300;
  sun.shadow.bias = L.shadowBias;
  sun.shadow.normalBias = L.shadowNormalBias;
  scene.add(sun);

  /** splatmap-chunks.html: `CSMShadowNode` (WebGPU); falls back to plain shadow if init fails. */
  let csm = null;
  let _lastCsmCascades = toolState.csm.cascades;
  let _lastCsmMaxFar = toolState.csm.maxFar;
  let _lastCsmMargin = toolState.csm.lightMargin;
  let _lastCsmMapSize = toolState.csm.mapSize;

  function setCsmEnabled(on) {
    if (!sun.shadow) return;
    sun.shadow.shadowNode = on && csm ? csm : null;
  }

  try {
    if (renderer.shadowMap) {
      csm = new CSMShadowNode(sun, {
        cascades: toolState.csm.cascades,
        maxFar: toolState.csm.maxFar,
        mode: "practical",
        lightMargin: toolState.csm.lightMargin,
      });
      if (csm.lights.length > 2) {
        csm.lights[2].shadow.mapSize.set(1024, 1024);
      }
      if (toolState.csm.enabled) {
        sun.shadow.shadowNode = csm;
      }
    }
  } catch (err) {
    console.warn("[V2] CSMShadowNode init failed; using non-CSM directional shadow.", err);
    csm = null;
  }

  const sky = new SkyMesh();
  sky.scale.setScalar(toolState.physicalSky.meshScale);
  if (sky.material) sky.material.fog = false;
  scene.add(sky);

  const F = toolState.fog;
  const uHFogEnabled = uniform(F.height.enabled ? 1 : 0);
  const uHFogColor = uniform(new THREE.Color(F.height.color).convertSRGBToLinear());
  const uHFogDensity = uniform(F.height.density);
  const uHFogHeight = uniform(F.height.height);
  const uDFogEnabled = uniform(F.distance.enabled ? 1 : 0);
  const uDFogColor = uniform(new THREE.Color(F.distance.color).convertSRGBToLinear());
  const uDFogDensity = uniform(F.distance.density);
  const _hFactor = exponentialHeightFogFactor(uHFogDensity, uHFogHeight).mul(uHFogEnabled);
  const _dFactor = densityFogFactor(uDFogDensity).mul(uDFogEnabled);
  const _combinedFactor = clamp(_hFactor.add(_dFactor), 0, 1);
  const _totalW = _hFactor.add(_dFactor).add(0.0001);
  const _blendedFogColor = mix(uHFogColor, uDFogColor, _dFactor.div(_totalW));
  const _combinedFogNode = fog(_blendedFogColor, _combinedFactor);

  // Same as splatmap-chunks.html: assign fogNode ONCE — toggling scene.fogNode at runtime
  // forces every material to recompile (WebGPU watchdog / device lost). Uniforms zero the effect when off.
  scene.fogNode = _combinedFogNode;
  function syncFog() {
    uHFogEnabled.value = F.height.enabled ? 1 : 0;
    uHFogColor.value.set(F.height.color).convertSRGBToLinear();
    uHFogDensity.value = F.height.density;
    uHFogHeight.value = F.height.height;
    uDFogEnabled.value = F.distance.enabled ? 1 : 0;
    uDFogColor.value.set(F.distance.color).convertSRGBToLinear();
    uDFogDensity.value = F.distance.density;
  }
  syncFog();

  let pmremGenerator = null;
  let disposeSkyEnv = null;
  function applyPhysicalSkyMeshUniforms() {
    const S = toolState.physicalSky;
    sky.turbidity.value = S.turbidity;
    sky.rayleigh.value = S.rayleigh;
    sky.mieCoefficient.value = S.mie;
    sky.mieDirectionalG.value = S.mieG;
    sky.cloudCoverage.value = S.cloudCoverage;
    sky.cloudDensity.value = S.cloudDensity;
    sky.cloudElevation.value = S.cloudElevation;
  }

  function rebuildSkyEnv() {
    try {
      if (disposeSkyEnv) {
        disposeSkyEnv();
        disposeSkyEnv = null;
      }
      pmremGenerator = pmremGenerator ?? new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.add(sky.clone());
      const pmremRT = pmremGenerator.fromScene(envScene, 0.04);
      scene.environment = pmremRT.texture;
      disposeSkyEnv = () => pmremRT.dispose();
    } catch (err) {
      console.warn("[V2] PMREM from SkyMesh failed; IBL disabled.", err);
    }
  }

  const terrainStore = new TerrainStore(config);
  terrainStore.preloadChunksInRadius(0, 0, 4);

  const tileTerrainMaterial = createSharedTileMaterial();
  /** Lazily built — matches v1 `chunkGroundTsl` + `chunkMeadowTsl` shared stacks. */
  let proceduralTerrainBundle = null;

  const terrainMesher = new TerrainMesher(config);
  const chunkStream = new ChunkStreamManager({
    config,
    scene,
    terrainStore,
    mesher: terrainMesher,
    material: tileTerrainMaterial,
    perf,
  });

  function getProceduralTerrainBundle() {
    if (!proceduralTerrainBundle) {
      proceduralTerrainBundle = createV2ProceduralGroundMaterial(
        toolState.groundTsl,
        toolState.meadowTsl,
      );
    }
    return proceduralTerrainBundle;
  }

  function syncProceduralTerrainTsl() {
    if (toolState.terrainSurface !== "tsl") return;
    const b = getProceduralTerrainBundle();
    b.syncGround(toolState.groundTsl);
    b.syncMeadow(toolState.meadowTsl);
    b.uMeadowMix.value = toolState.tslGroundUi.meadowMix;
    b.uSlopeMin.value = toolState.tslGroundUi.meadowSlopeMin;
    b.uSlopeMax.value = toolState.tslGroundUi.meadowSlopeMax;
  }

  function applyTerrainSurfaceFromToolState() {
    if (toolState.terrainSurface === "tsl") {
      syncProceduralTerrainTsl();
      chunkStream.setSharedMaterial(getProceduralTerrainBundle().material);
    } else {
      chunkStream.setSharedMaterial(tileTerrainMaterial);
    }
  }
  const sculptSystem = new SculptSystem({
    toolState,
    terrainStore,
    chunkStream,
  });

  const hud = createHud();
  /** @type {ReturnType<typeof createTweakpaneUi>} */
  let ui;
  ui = createTweakpaneUi({
    toolState,
    config,
    sculptSystem,
    perf,
    onConfigChanged: () => {
      chunkStream.update(camera.position);
    },
    onRebuildSkyEnv: rebuildSkyEnv,
    onCsmEnabledChange: setCsmEnabled,
    onFogChange: syncFog,
    onGenerateProceduralTerrain: () => sculptSystem.applyProceduralTerrainAllChunks(),
    onRampCleared: () => syncRampMarker(),
    onTerrainSurfaceChanged: () => {
      applyTerrainSurfaceFromToolState();
      ui?.pane.refresh();
    },
    onTslTerrainSync: () => {
      syncProceduralTerrainTsl();
    },
  });

  /** Engine-style brush preview: translucent hemisphere + edge lines, aligned to surface normal. */
  const brushDomeGeom = new THREE.SphereGeometry(
    1,
    48,
    24,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.5,
  );
  const brushDomeFillMat = new THREE.MeshBasicMaterial({
    color: 0xf5cc52,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  brushDomeFillMat.fog = false;
  const brushDomeFill = new THREE.Mesh(brushDomeGeom, brushDomeFillMat);
  const brushDomeEdgesGeom = new THREE.EdgesGeometry(brushDomeGeom, 22);
  const brushDomeLineMat = new THREE.LineBasicMaterial({
    color: 0xffeebb,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });
  brushDomeLineMat.fog = false;
  const brushDomeLines = new THREE.LineSegments(brushDomeEdgesGeom, brushDomeLineMat);
  const brushPreview = new THREE.Group();
  brushPreview.add(brushDomeFill);
  brushPreview.add(brushDomeLines);
  brushPreview.visible = false;
  brushPreview.renderOrder = 5;
  scene.add(brushPreview);

  const brushRing = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.045, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xf5cc52 }),
  );
  brushRing.visible = false;
  brushRing.material.fog = false;
  brushRing.renderOrder = 5;
  scene.add(brushRing);

  const rampMarkerA = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.045, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xcc66ff }),
  );
  rampMarkerA.rotation.x = Math.PI * 0.5;
  rampMarkerA.visible = false;
  rampMarkerA.material.fog = false;
  rampMarkerA.renderOrder = 5;
  scene.add(rampMarkerA);

  /** Hemisphere: pole +Y; torus (`TorusGeometry`): ring in XY, symmetry axis +Z. */
  const _brushY = new THREE.Vector3(0, 1, 0);
  const _brushZ = new THREE.Vector3(0, 0, 1);
  const brushPick = { point: new THREE.Vector3(), normal: new THREE.Vector3() };

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let pointerDown = false;
  let hudLastMs = 0;

  function updateSunSky() {
    const Li = toolState.light;
    sunDirectionFromAngles(Li.sunAzimuth, Li.sunElevation, sunDir);
    sun.position.copy(sunDir).multiplyScalar(Li.sunDistance);
    sun.color.set(Li.dirColor);
    sun.intensity = Li.dirIntensity;
    hemi.color.set(Li.hemiSkyColor);
    hemi.groundColor.set(Li.hemiGroundColor);
    hemi.intensity = Li.hemiIntensity;
    sun.shadow.bias = Li.shadowBias;
    sun.shadow.normalBias = Li.shadowNormalBias;
    renderer.toneMappingExposure = Li.exposure;
    scene.environmentIntensity = Li.envIntensity;
    applyPhysicalSkyMeshUniforms();
    sky.scale.setScalar(toolState.physicalSky.meshScale);
    if (sky.sunPosition?.value?.copy) {
      sky.sunPosition.value.copy(sunDir);
    } else if (sky.sunPosition?.copy) {
      sky.sunPosition.copy(sunDir);
    }
  }

  updateSunSky();
  rebuildSkyEnv();

  const lensFlare = createLensFlareSystem({
    scene,
    camera,
    getSunDir: () => sunDir,
    getParams: () => toolState.lensFlare,
  });

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
    const h = hits[0];
    brushPick.point.copy(h.point);
    if (h.face) {
      brushPick.normal.copy(h.face.normal).transformDirection(h.object.matrixWorld).normalize();
      if (brushPick.normal.lengthSq() < 1e-6) brushPick.normal.set(0, 1, 0);
    } else {
      brushPick.normal.set(0, 1, 0);
    }
    return brushPick;
  }

  function syncRampMarker() {
    if (
      toolState.mode !== "sculpt" ||
      toolState.sculptMode !== "ramp" ||
      !sculptSystem.hasRampPointA()
    ) {
      rampMarkerA.visible = false;
      return;
    }
    const a = sculptSystem.rampPointA;
    rampMarkerA.visible = true;
    rampMarkerA.position.set(a.x, a.y + 0.04, a.z);
    rampMarkerA.scale.setScalar(toolState.brush.radius);
  }

  function updateBrushPreviewFromPick(hit) {
    if (!hit || toolState.mode !== "sculpt") {
      brushPreview.visible = false;
      brushRing.visible = false;
      syncRampMarker();
      return;
    }
    const r = toolState.brush.radius;
    const nudge = 0.012 + Math.min(0.08, r * 0.0004);
    const useCircle = toolState.brush.previewShape === "circle";
    if (useCircle) {
      brushPreview.visible = false;
      brushRing.visible = true;
      brushRing.scale.setScalar(r);
      brushRing.position.copy(hit.point).addScaledVector(hit.normal, nudge);
      brushRing.quaternion.setFromUnitVectors(_brushZ, hit.normal);
      syncRampMarker();
      return;
    }
    brushRing.visible = false;
    brushPreview.visible = true;
    brushPreview.scale.setScalar(r);
    brushPreview.position.copy(hit.point).addScaledVector(hit.normal, nudge);
    brushPreview.quaternion.setFromUnitVectors(_brushY, hit.normal);
    syncRampMarker();
  }

  function updateBrushPreview(event) {
    updateBrushPreviewFromPick(pickTerrain(event));
  }

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || toolState.mode !== "sculpt") return;
    const hit = pickTerrain(event);
    if (toolState.sculptMode === "ramp") {
      if (!hit) return;
      event.preventDefault();
      if (!sculptSystem.hasRampPointA()) {
        sculptSystem.setRampPointA(hit.point);
      } else {
        sculptSystem.commitRampSecondClick(hit.point);
      }
      syncRampMarker();
      return;
    }
    if (!hit) return;
    event.preventDefault();
    pointerDown = true;
    controls.enabled = false;
    sculptSystem.beginStroke(hit.point, event);
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    const hit = pickTerrain(event);
    updateBrushPreviewFromPick(hit);
    if (!pointerDown || toolState.mode !== "sculpt") return;
    if (!hit) return;
    sculptSystem.applyAt(hit.point, event);
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
    } else if (
      event.code === "KeyR" &&
      toolState.mode === "sculpt" &&
      toolState.sculptMode === "ramp" &&
      sculptSystem.hasRampPointA()
    ) {
      event.preventDefault();
      sculptSystem.clearRampPoint();
      syncRampMarker();
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
    lensFlare.update();

    shadowTarget.position.set(camera.position.x, 0, camera.position.z);
    const csmCfg = toolState.csm;
    const csmChanged =
      csm &&
      csmCfg.enabled &&
      (csmCfg.cascades !== _lastCsmCascades ||
        csmCfg.maxFar !== _lastCsmMaxFar ||
        csmCfg.lightMargin !== _lastCsmMargin ||
        csmCfg.mapSize !== _lastCsmMapSize);
    if (csm?.mainFrustum && csmChanged) {
      _lastCsmCascades = csmCfg.cascades;
      _lastCsmMaxFar = csmCfg.maxFar;
      _lastCsmMargin = csmCfg.lightMargin;
      _lastCsmMapSize = csmCfg.mapSize;
      csm.cascades = csmCfg.cascades;
      csm.maxFar = csmCfg.maxFar;
      csm.lightMargin = csmCfg.lightMargin;
      sun.shadow.mapSize.set(csmCfg.mapSize, csmCfg.mapSize);
      if (csm.lights.length > 2) {
        csm.lights[2].shadow.mapSize.set(1024, 1024);
      }
      csm.updateFrustums();
    }
    if (csm?.mainFrustum && csmCfg.enabled && csmCfg.updateEveryFrame) {
      csm.updateFrustums();
    }

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
      if (csm) {
        sun.shadow.shadowNode = null;
        csm.dispose();
        csm = null;
      }
      scene.environment = null;
      if (disposeSkyEnv) disposeSkyEnv();
      if (pmremGenerator) pmremGenerator.dispose();
      sky.dispose?.();
      lensFlare.dispose();
      ui.dispose();
      chunkStream.dispose();
      terrainMaterial.dispose();
      brushDomeGeom.dispose();
      brushDomeFillMat.dispose();
      brushDomeEdgesGeom.dispose();
      brushDomeLineMat.dispose();
      brushRing.geometry.dispose();
      brushRing.material.dispose();
      rampMarkerA.geometry.dispose();
      rampMarkerA.material.dispose();
      controls.dispose();
      renderer.dispose();
    },
  };
}

