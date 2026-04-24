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
import { createAutoCliffUniforms } from "../../chunkTerrainAutoCliff.js";
import { createTextureLibrary } from "../core/textures/textureLibrary.js";
import { createV2ImageTexGroundMaterial } from "../render/terrain/sharedImgTexMaterial.js";
import { createSplatOverlay } from "../render/terrain/splatOverlayTsl.js";
import { SplatStore } from "../core/paint/splatStore.js";
import { PaintSystem } from "../tools/paint/paintSystem.js";
import {
  serializeProject,
  deserializeProject,
  downloadBlob,
  openFilePicker,
  applySettings,
} from "../core/io/terrainSerializer.js";
import { TreeStore } from "../core/foliage/treeStore.js";
import { TreeLodRenderer } from "../render/foliage/treeLodRenderer.js";
import { TreeSystem } from "../tools/foliage/treeSystem.js";
import { loadTreeGlbFromFile, openGlbPicker, initGlbLoaderRenderer } from "../core/foliage/glbLoader.js";
import { FoliageLodRenderer } from "../render/foliage/foliageLodRenderer.js";
import { loadFullPresetFromFile } from "../core/foliage/presetLoader.js";
import { GrassManager } from "../render/foliage/grassManager.js";
import { GrassPaintSystem } from "../tools/foliage/grassPaintSystem.js";
import { CliffGrassPaintSystem } from "../tools/foliage/cliffGrassPaintSystem.js";
import { PlayMode } from "../play/playMode.js";
import { createGroundTslBundle } from "../../chunkGroundTsl.js";
import { RoadSystem } from "../tools/road/roadSystem.js";
import { RoadPlanarReflection } from "../core/road/roadReflection.js";
import { CliffStore } from "../core/cliffs/cliffStore.js";
import { CliffInstancer } from "../core/cliffs/cliffInstancer.js";
import { CliffSystem } from "../tools/cliffs/cliffSystem.js";
import { CliffBvh } from "../core/cliffs/cliffBvh.js";
import { createCliffInstancerBlendMaterial } from "../../cliffInstancerBlendMaterial.js";
import { PropStore } from "../core/props/propStore.js";
import { PropInstancer } from "../core/props/propInstancer.js";
import { PropSystem } from "../tools/props/propSystem.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";

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
  renderer.shadowMap.transmitted = true;
  document.body.appendChild(renderer.domElement);
  await renderer.init();
  initGlbLoaderRenderer(renderer);

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

  const HTEX_RES = 512;
  const globalHeightTexData = new Float32Array(HTEX_RES * HTEX_RES * 4);
  const globalHeightTex = new THREE.DataTexture(
    globalHeightTexData,
    HTEX_RES,
    HTEX_RES,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  globalHeightTex.wrapS = globalHeightTex.wrapT = THREE.ClampToEdgeWrapping;
  globalHeightTex.minFilter = THREE.LinearFilter;
  globalHeightTex.magFilter = THREE.LinearFilter;
  globalHeightTex.needsUpdate = true;

  function rebuildGlobalHeightTexture() {
    const ws = config.world.size;
    for (let iz = 0; iz < HTEX_RES; iz++) {
      for (let ix = 0; ix < HTEX_RES; ix++) {
        const wx = ws * ((ix + 0.5) / HTEX_RES - 0.5);
        const wz = ws * ((iz + 0.5) / HTEX_RES - 0.5);
        const h = terrainStore.getWorldHeight(wx, wz);
        const i = (iz * HTEX_RES + ix) * 4;
        globalHeightTexData[i] = h;
        globalHeightTexData[i + 1] = 0;
        globalHeightTexData[i + 2] = 0;
        globalHeightTexData[i + 3] = 1;
      }
    }
    globalHeightTex.needsUpdate = true;
  }

  rebuildGlobalHeightTexture();
  let heightTexDirty = false;
  let lastHeightTexSyncMs = 0;

  const cliffU = createAutoCliffUniforms();

  const textureLibrary = createTextureLibrary();
  let textureLibraryReady = false;
  textureLibrary
    .loadDefaultsAsync()
    .then(() => {
      textureLibraryReady = true;
      invalidateSurfaceMaterials();
      tryBuildCliffBlendMaterial();
    })
    .catch((err) => console.warn("TextureLibrary defaults failed:", err));
  textureLibrary.addOnChange(({ kind }) => {
    if (typeof kind === "string" && kind.startsWith("map:")) {
      invalidateSurfaceMaterials();
    }
  });

  function syncCliffUniformsFromParams() {
    const ac = toolState.autoCliff;
    cliffU.uSlopeStart.value = ac.slopeStart;
    cliffU.uSlopeEnd.value = ac.slopeEnd;
    cliffU.uRockScale.value = ac.rockScale;
    cliffU.uRockBrightness.value = ac.rockBrightness;
    cliffU.uRockContrast.value = ac.rockContrast;
    cliffU.uRockTint.value.set(ac.rockTint).convertSRGBToLinear();
    cliffU.uRockNormalStr.value = ac.rockNormalStr;
    cliffU.uRockBlendSharp.value = ac.rockBlendSharp;
    cliffU.uRockRoughMul.value = ac.rockRoughMul;
    cliffU.uTriplanarSharp.value = ac.triplanarSharp;
  }

  function buildCliffDeps() {
    if (!toolState.autoCliffEnabled || !textureLibraryReady) return null;
    const slot = textureLibrary.getSlot(toolState.textureSlots.cliffSlotId);
    if (!slot) return null;
    return {
      heightTex: globalHeightTex,
      rockColorTex: slot.albedoTex,
      rockDataTex: slot.ormTex,
      cliffU,
      worldSize: config.world.size,
      worldHalf: config.world.size * 0.5,
      htexRes: HTEX_RES,
    };
  }

  const tileTerrainMaterial = createSharedTileMaterial();
  const sharedGroundBundle = createGroundTslBundle(toolState.groundTsl);
  let proceduralTerrainBundle = null;
  let imageTexTerrainBundle = null;

  const splatStore = new SplatStore(config);
  const placeholderSplatTex = (() => {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  })();

  function buildSplatOverlay() {
    if (!textureLibraryReady) return null;
    const slots = toolState.paint.layerSlotIds.map((id) => textureLibrary.getSlot(id));
    if (slots.some((s) => !s)) return null;
    return createSplatOverlay(slots, config.world.chunkSize, config.world.size);
  }

  /** Returns the splatTexNode from whichever surface material is active (if any). */
  function getActiveSplatTexNode() {
    if (toolState.terrainSurface === "tsl" && proceduralTerrainBundle) {
      return proceduralTerrainBundle.splatTexNode;
    }
    if (toolState.terrainSurface === "image" && imageTexTerrainBundle) {
      return imageTexTerrainBundle.splatTexNode;
    }
    return null;
  }

  function setupSplatSwapFromStore(mesh) {
    const prev = mesh.onBeforeRender;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      if (prev) prev(renderer, scene, camera, geometry, material, group);
      const node = getActiveSplatTexNode();
      if (!node) return;
      const key = mesh.userData.chunkKey;
      const entry = splatStore.getChunkSplatByKey(key);
      node.value = entry?.tex ?? placeholderSplatTex;
    };
  }

  const terrainMesher = new TerrainMesher(config);
  const chunkStream = new ChunkStreamManager({
    config,
    scene,
    terrainStore,
    mesher: terrainMesher,
    material: tileTerrainMaterial,
    perf,
    onChunkCreated: (mesh) => {
      setupSplatSwapFromStore(mesh);
    },
  });

  function disposeProceduralBundle() {
    if (proceduralTerrainBundle) {
      proceduralTerrainBundle.material.dispose();
      proceduralTerrainBundle = null;
    }
  }
  function disposeImageTexBundle() {
    if (imageTexTerrainBundle) {
      imageTexTerrainBundle.material.dispose();
      imageTexTerrainBundle = null;
    }
  }
  function invalidateSurfaceMaterials() {
    disposeProceduralBundle();
    disposeImageTexBundle();
    applyTerrainSurfaceFromToolState();
  }

  function getProceduralTerrainBundle() {
    if (!proceduralTerrainBundle) {
      syncCliffUniformsFromParams();
      proceduralTerrainBundle = createV2ProceduralGroundMaterial(
        toolState.groundTsl,
        toolState.meadowTsl,
        buildCliffDeps(),
        buildSplatOverlay(),
        sharedGroundBundle,
      );
    }
    return proceduralTerrainBundle;
  }

  function getImageTexTerrainBundle() {
    if (!imageTexTerrainBundle) {
      syncCliffUniformsFromParams();
      const groundSlot = textureLibrary.getSlot(toolState.textureSlots.groundSlotId);
      imageTexTerrainBundle = createV2ImageTexGroundMaterial(
        groundSlot,
        config.world.size,
        buildCliffDeps(),
        buildSplatOverlay(),
        toolState.meadowTsl,
      );
    }
    return imageTexTerrainBundle;
  }

  function syncProceduralTerrainTsl() {
    sharedGroundBundle.syncFromParams(toolState.groundTsl);
    const b = getProceduralTerrainBundle();
    b.syncMeadow(toolState.meadowTsl);
  }

  function applyTerrainSurfaceFromToolState() {
    if (toolState.terrainSurface === "tsl") {
      syncProceduralTerrainTsl();
      chunkStream.setSharedMaterial(getProceduralTerrainBundle().material);
    } else if (toolState.terrainSurface === "image") {
      chunkStream.setSharedMaterial(getImageTexTerrainBundle().material);
    } else {
      chunkStream.setSharedMaterial(tileTerrainMaterial);
    }
  }

  function markHeightTexDirty() {
    heightTexDirty = true;
  }
  const sculptSystem = new SculptSystem({
    toolState,
    terrainStore,
    chunkStream,
    onHeightsChanged: () => {
      markHeightTexDirty();
      treeStore.syncAllHeights(terrainStore);
    },
  });
  const paintSystem = new PaintSystem({ toolState, splatStore, config });

  const treeStore = new TreeStore(config);
  const treeLodRenderer = new TreeLodRenderer(scene, config);
  const treeSystem = new TreeSystem({ toolState, treeStore, terrainStore, config });
  const foliageLodRenderer = new FoliageLodRenderer(scene, config);

  const grassManager = new GrassManager({ scene, camera, config });
  const grassPaintSystem = new GrassPaintSystem({ toolState, grassManager, config });
  const cliffGrassPaintSystem = new CliffGrassPaintSystem({ toolState, grassManager, config });
  const roadReflection = new RoadPlanarReflection({
    renderer, scene, camera, resScale: 0.35,
  });
  const roadSystem = new RoadSystem({
    scene, camera, toolState,
    getWorldHeight: (x, z) => terrainStore.getWorldHeight(x, z),
    reflectTex: roadReflection.texture,
    terrainStore,
    chunkStream,
  });

  const cliffStore = new CliffStore();
  const cliffInstancer = new CliffInstancer(scene, cliffStore);
  const cliffBvh = new CliffBvh(cliffStore);
  const cliffSystem = new CliffSystem({ toolState, cliffStore, cliffInstancer, cliffBvh, terrainStore });
  const cliffSlotToType = {};

  const propStore = new PropStore();
  const propInstancer = new PropInstancer(scene, propStore);
  const propSystem = new PropSystem({ toolState, propStore, propInstancer, cliffBvh, terrainStore, config });
  let propUiCallbacks = {};

  const dummyCliffPaintTex = (() => {
    const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  })();
  let cliffBlendPack = null;

  function tryBuildCliffBlendMaterial() {
    if (cliffBlendPack) return;
    if (!textureLibraryReady) return;
    const slot = textureLibrary.getSlot(toolState.textureSlots.cliffSlotId);
    if (!slot) return;
    const c = toolState.cliffs;
    cliffU.uRockScale.value = c.blendRockScale;
    cliffU.uRockBrightness.value = c.blendRockBrightness;
    cliffU.uRockContrast.value = c.blendRockContrast;
    cliffU.uTriplanarSharp.value = c.blendTriplanarSharp;
    cliffBlendPack = createCliffInstancerBlendMaterial(
      config.world.size, config.world.size * 0.5,
      slot.albedoTex, slot.ormTex,
      cliffU, dummyCliffPaintTex
    );
    cliffBlendPack.uCBSlopeLow.value = c.blendSlopeLow;
    cliffBlendPack.uCBSlopeHigh.value = c.blendSlopeHigh;
    cliffBlendPack.uCBNoiseScale.value = c.blendNoiseScale;
    cliffBlendPack.uCBNoiseStr.value = c.blendNoiseStr;
    cliffBlendPack.uCBGroundScale.value = c.blendGroundScale;
    cliffInstancer.setMaterial(cliffBlendPack.material);
    console.log("[V2] Cliff blend material created");
  }

  function getWorldHeight(x, z) {
    if (cliffBvh.baked) {
      const h = cliffBvh.sampleHeight(x, z);
      if (h != null) return h;
    }
    return terrainStore.getWorldHeight(x, z);
  }

  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode("translate");
  transformControls.enabled = false;
  transformControls.visible = false;
  scene.add(transformControls.getHelper());
  transformControls.addEventListener("change", () => {
    if (toolState.mode === "cliffs" && cliffInstancer.hasSelection) {
      cliffSystem.handleTransformChange();
    }
    if (toolState.mode === "props" && propInstancer.hasSelection) {
      propSystem.handleTransformChange();
    }
  });
  transformControls.addEventListener("mouseDown", () => {
    controls.enabled = false;
  });
  transformControls.addEventListener("mouseUp", () => {
    controls.enabled = toolState.mode !== "play";
    if (toolState.mode === "cliffs") cliffSystem.handleTransformEnd();
    if (toolState.mode === "props") propSystem.handleTransformEnd();
  });

  const playMode = new PlayMode({
    scene, camera, renderer, controls,
    getWorldHeight,
    getTerrainHeight: (x, z) => terrainStore.getWorldHeight(x, z),
    worldHalf: config.world.size * 0.5,
    cliffBvh,
  });

  const hud = createHud();
  /** @type {ReturnType<typeof createTweakpaneUi>} */
  let ui;
  ui = createTweakpaneUi({
    toolState,
    config,
    sculptSystem,
    perf,
    textureLibrary,
    onConfigChanged: () => {
      chunkStream.update(camera.position);
    },
    onRebuildSkyEnv: rebuildSkyEnv,
    onCsmEnabledChange: setCsmEnabled,
    onFogChange: syncFog,
    onGenerateProceduralTerrain: () => sculptSystem.applyProceduralTerrainAllChunks(),
    onRunGlobalErosion: () => sculptSystem.applyGlobalErosion(),
    onRampCleared: () => syncRampMarker(),
    onTerrainSurfaceChanged: () => {
      applyTerrainSurfaceFromToolState();
      ui?.pane.refresh();
    },
    onTslTerrainSync: () => {
      syncProceduralTerrainTsl();
    },
    onAutoCliffChanged: (kind) => {
      syncCliffUniformsFromParams();
      if (kind === "toggle") invalidateSurfaceMaterials();
    },
    onCliffSlotChanged: () => {
      invalidateSurfaceMaterials();
    },
    onGroundSlotChanged: () => {
      disposeImageTexBundle();
      if (toolState.terrainSurface === "image") applyTerrainSurfaceFromToolState();
    },
    onModeChanged: () => {
      if (toolState.mode !== "sculpt") {
        sculptSystem.clearRampPoint();
      }
      if (toolState.mode === "paint" && toolState.terrainSurface === "tile") {
        toolState.terrainSurface = "tsl";
        applyTerrainSurfaceFromToolState();
        ui?.pane.refresh();
      }
      if (toolState.mode === "grass" && !toolState.grass.enabled) {
        toolState.grass.enabled = true;
        grassManager.syncUniforms(toolState.grass, sunDir);
        ui?.pane.refresh();
      }
      if (toolState.mode !== "cliffs") {
        deactivateCliffSelection();
      }
      if (toolState.mode !== "props") {
        deactivatePropSelection();
      }
      if (toolState.mode === "play") {
        playMode.enter();
        const tpEl = document.querySelector(".tp-dfwv");
        if (tpEl) tpEl.style.display = "none";
      } else if (playMode.active) {
        playMode.exit();
        const tpEl = document.querySelector(".tp-dfwv");
        if (tpEl) tpEl.style.display = "";
      }
      updateBrushPreviewFromPick(null);
    },
    onPaintLayersChanged: () => {
      invalidateSurfaceMaterials();
    },
    onPaintFill: () => paintSystem.fillWithActiveLayer(),
    onPaintClear: () => paintSystem.clearAll(),
    onImportTreeGlb: async (slotIdx, lod) => {
      const file = await openGlbPicker();
      if (!file) return;
      try {
        const { submeshes, name } = await loadTreeGlbFromFile(file);
        treeLodRenderer.setSlotModel(slotIdx, lod, submeshes, toolState.treeLod.castShadow);
        if (lod === 0) toolState.treeSlots[slotIdx].name = name;
        ui?.pane.refresh();
        console.log(`[V2] Tree slot ${slotIdx} LOD${lod}: loaded ${submeshes.length} submesh(es) from ${file.name}`);
      } catch (err) {
        console.error(`[V2] Failed to load GLB for slot ${slotIdx} LOD${lod}:`, err);
      }
    },
    onLoadTreePreset: async (slotIdx) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        try {
          const { foliagePreset, trunkSubmeshes, trunkLod1Submeshes, json } = await loadFullPresetFromFile(file);

          if (trunkSubmeshes) {
            treeLodRenderer.setSlotModel(slotIdx, 0, trunkSubmeshes, toolState.treeLod.castShadow);
            console.log(`[V2] Trunk LOD0 loaded: ${json.trunkFile} (${trunkSubmeshes.length} submesh)`);
          }
          if (trunkLod1Submeshes) {
            treeLodRenderer.setSlotModel(slotIdx, 1, trunkLod1Submeshes, toolState.treeLod.castShadow);
            console.log(`[V2] Trunk LOD1 loaded: ${json.trunkLod1File}`);
          }

          foliageLodRenderer.setSlotPreset(slotIdx, foliagePreset);

          toolState.treeSlots[slotIdx].presetFile = file.name;
          toolState.treeSlots[slotIdx].name = json.presetName || file.name.replace(/\.json$/, "");
          if (json.trunkScale != null) {
            toolState.treeSlots[slotIdx].baseScale = json.trunkScale;
          }

          const f = toolState.treeSlots[slotIdx].foliage;
          const m = json.material || {};
          const w = json.wind || {};
          if (m.bottomColor) f.bottomColor = m.bottomColor;
          if (m.topColor)    f.topColor    = m.topColor;
          if (m.colorVar != null)    f.colorVar    = m.colorVar;
          if (m.alphaCutoff != null) f.alphaCutoff = m.alphaCutoff;
          if (m.normalBias != null)  f.normalBias  = m.normalBias;
          if (m.leafWarp != null)    f.leafWarp    = m.leafWarp;
          if (m.aoStr != null)       f.aoStr       = m.aoStr;
          if (m.sssStr != null)      f.sssStr      = m.sssStr;
          if (m.sssPow != null)      f.sssPow      = m.sssPow;
          if (m.sssColor)            f.sssColor    = m.sssColor;
          if (m.rimStr != null)      f.rimStr      = m.rimStr;
          if (m.rimPow != null)      f.rimPow      = m.rimPow;
          if (m.rimColor)            f.rimColor    = m.rimColor;
          if (w.windSpeed != null)   f.windSpeed   = w.windSpeed;
          if (w.windStr != null)     f.windStr     = w.windStr;
          if (w.windMicro != null)   f.windMicro   = w.windMicro;

          ui?.pane.refresh();
          console.log(`[V2] Tree preset "${json.presetName}" loaded into slot ${slotIdx} (baseScale=${json.trunkScale ?? 1}, ${foliagePreset.lods[0]?.count ?? 0} leaves LOD0)`);
        } catch (err) {
          console.error(`[V2] Failed to load tree preset for slot ${slotIdx}:`, err);
        }
      };
      input.click();
    },
    onFoliageParamChanged: (slotIdx) => {
      const preset = foliageLodRenderer.slotPresets[slotIdx];
      if (!preset) return;
      const f = toolState.treeSlots[slotIdx].foliage;
      const u = preset.uniforms;
      u.bottomColor.value.set(f.bottomColor);
      u.topColor.value.set(f.topColor);
      u.colorVar.value    = f.colorVar;
      u.alphaCutoff.value = f.alphaCutoff;
      u.normalBias.value  = f.normalBias;
      u.leafWarp.value    = f.leafWarp;
      u.aoStr.value       = f.aoStr;
      u.sssStr.value      = f.sssStr;
      u.sssPow.value      = f.sssPow;
      u.sssColor.value.set(f.sssColor);
      u.rimStr.value      = f.rimStr;
      u.rimPow.value      = f.rimPow;
      u.rimColor.value.set(f.rimColor);
      u.windSpeed.value   = f.windSpeed;
      u.windStr.value     = f.windStr;
      u.windMicro.value   = f.windMicro;
    },
    onRemoveTreeSlot: (slotIdx) => {
      treeLodRenderer.disposeSlot(slotIdx);
      foliageLodRenderer.clearSlot(slotIdx);
      console.log(`[V2] Tree slot ${slotIdx} models removed`);
    },
    onClearAllTrees: () => {
      treeSystem.clearAll();
    },
    onTreeLodChanged: () => {},
    onFoliageLodChanged: () => {},
    onGrassChanged: () => {
      grassManager.syncUniforms(toolState.grass, sunDir);
    },
    onGrassRebuildGeos: () => {
      grassManager.syncUniforms(toolState.grass, sunDir);
      grassManager.rebuildGeometries(toolState.grass);
    },
    onGrassFill: () => {
      toolState.grass.enabled = true;
      grassManager.fillDensity();
      grassManager.syncUniforms(toolState.grass, sunDir);
      ui?.pane.refresh();
    },
    onGrassClear: () => {
      grassManager.clearDensity();
    },
    onCliffGrassFill: () => {
      toolState.grass.enabled = true;
      grassManager.fillCliffDensity();
      grassManager.syncUniforms(toolState.grass, sunDir);
      ui?.pane.refresh();
    },
    onCliffGrassClear: () => {
      grassManager.clearCliffDensity();
    },
    onGrassSaveDensity: () => {
      const data = grassManager.densityTex.image.data;
      const blob = new Blob([data.buffer], { type: "application/octet-stream" });
      downloadBlob(blob, "gemini-grass-density.bin");
    },
    onGrassLoadDensity: async () => {
      const file = await openFilePicker(".bin,image/png");
      if (!file) return;
      const buf = await file.arrayBuffer();
      const loaded = new Uint8Array(buf);
      const texData = grassManager.densityTex.image.data;
      texData.set(loaded.subarray(0, texData.length));
      grassManager.densityTex.needsUpdate = true;
      if (!toolState.grass.enabled) {
        toolState.grass.enabled = true;
        grassManager.syncUniforms(toolState.grass, sunDir);
        ui?.pane.refresh();
      }
    },
    onTreeCastShadowChanged: () => {
      for (let i = 0; i < toolState.treeSlots.length; i++) {
        treeLodRenderer.setCastShadow(i, toolState.treeLod.castShadow);
      }
    },
    onImportCliffGlb: async (slotIdx) => {
      tryBuildCliffBlendMaterial();
      const file = await openGlbPicker();
      if (!file) return;
      try {
        const { submeshes, name } = await loadTreeGlbFromFile(file);
        const gltfScene = new THREE.Group();
        for (const sm of submeshes) {
          const mesh = new THREE.Mesh(sm.geometry, sm.material);
          mesh.applyMatrix4(sm.localMatrix);
          gltfScene.add(mesh);
        }
        const typeIdx = cliffStore.registerType(gltfScene, name);
        if (typeIdx >= 0) {
          cliffInstancer.onTypeRegistered(typeIdx);
          if (cliffBlendPack) cliffInstancer.setMaterial(cliffBlendPack.material);
          cliffSlotToType[slotIdx] = typeIdx;
          toolState.cliffSlots[slotIdx].name = name;
          toolState.cliffSlots[slotIdx].loaded = true;
          toolState.cliffs.activeSlot = slotIdx;
          console.log(`[V2] Cliff slot ${slotIdx} "${name}" loaded (${submeshes.length} submeshes)`);
        }
        ui?.pane.refresh();
      } catch (err) {
        console.error("[V2] Failed to load cliff GLB:", err);
      }
    },
    onRemoveCliffSlot: (slotIdx) => {
      delete cliffSlotToType[slotIdx];
      toolState.cliffSlots[slotIdx].loaded = false;
      toolState.cliffSlots[slotIdx].name = `Cliff ${slotIdx + 1}`;
      ui?.pane.refresh();
      console.log(`[V2] Cliff slot ${slotIdx} cleared`);
    },
    onDeleteSelectedCliff: () => cliffSystem.handleDelete(),
    onClearAllCliffs: () => cliffSystem.clearAll(),
    onRebakeBvh: () => {
      cliffBvh.bake(terrainStore, config, [propStore]);
      grassManager.rebuildCliffHeightTex(cliffBvh, terrainStore, config.world.size);
      console.log("[V2] BVH rebaked (cliffs + props) + cliff height tex updated");
    },
    onCliffTransformModeChanged: () => {
      transformControls.setMode(toolState.cliffs.transformMode);
    },
    onRoadChanged: () => {
      roadSystem.syncMaterial();
      roadSystem.rebuildAllMeshes();
      ui?.pane.refresh();
    },
    onRoadNewRoad: () => roadSystem.startNewRoad(),
    onRoadDeleteActive: () => { roadSystem.deleteActiveRoad(); ui?.pane.refresh(); },
    onRoadDeleteSelected: () => { roadSystem.deleteSelected(); ui?.pane.refresh(); },
    onRoadSnapY: () => { roadSystem.snapSelectedYToTerrain(); ui?.pane.refresh(); },
    onRoadFlattenTerrain: () => {
      roadSystem.flattenTerrainUnderRoads();
      roadSystem.rebuildAllMeshes();
    },
    onRoadSelectedYChanged: () => roadSystem.setSelectedPointY(toolState.road.selectedPointY),
    onRoadActiveIndexChanged: () => {
      roadSystem._clampActive();
      roadSystem.selectedIdx = -1;
      roadSystem._rebuildVisual();
      ui?.pane.refresh();
    },
    onCliffBlendChanged: () => {
      if (!cliffBlendPack) return;
      const c = toolState.cliffs;
      cliffBlendPack.uCBSlopeLow.value = c.blendSlopeLow;
      cliffBlendPack.uCBSlopeHigh.value = c.blendSlopeHigh;
      cliffBlendPack.uCBNoiseScale.value = c.blendNoiseScale;
      cliffBlendPack.uCBNoiseStr.value = c.blendNoiseStr;
      cliffBlendPack.uCBGroundScale.value = c.blendGroundScale;
      cliffU.uRockScale.value = c.blendRockScale;
      cliffU.uRockBrightness.value = c.blendRockBrightness;
      cliffU.uRockContrast.value = c.blendRockContrast;
      cliffU.uTriplanarSharp.value = c.blendTriplanarSharp;
    },
    onImportPropGlb: async () => {
      const file = await openGlbPicker();
      if (!file) return;
      try {
        const { submeshes, name } = await loadTreeGlbFromFile(file);
        const gltfScene = new THREE.Group();
        for (const sm of submeshes) {
          const mesh = new THREE.Mesh(sm.geometry, sm.material);
          mesh.applyMatrix4(sm.localMatrix);
          gltfScene.add(mesh);
        }
        const typeIdx = propStore.registerType(gltfScene, name);
        if (typeIdx >= 0) {
          propInstancer.onTypeRegistered(typeIdx);
          const slotIdx = toolState.propSlots.length;
          toolState.propSlots.push({ name, loaded: true, typeIdx });
          toolState.props.activeSlot = slotIdx;
          propUiCallbacks._rebuildPropUi?.();
          console.log(`[V2] Prop "${name}" imported (type ${typeIdx}, ${submeshes.length} submeshes)`);
        }
        ui?.pane.refresh();
      } catch (err) {
        console.error("[V2] Failed to load prop GLB:", err);
      }
    },
    onRemovePropSlot: (slotIdx) => {
      toolState.propSlots.splice(slotIdx, 1);
      if (toolState.props.activeSlot >= toolState.propSlots.length) {
        toolState.props.activeSlot = Math.max(0, toolState.propSlots.length - 1);
      }
      ui?.pane.refresh();
      console.log(`[V2] Prop slot ${slotIdx} removed`);
    },
    onDeleteSelectedProp: () => {
      propSystem.handleDelete();
      deactivatePropSelection();
    },
    onClearAllProps: () => propSystem.clearAll(),
    onPropTransformModeChanged: () => {
      transformControls.setMode(toolState.props.transformMode);
    },
    onSaveProject: () => {
      toolState._cliffExportData = () => cliffStore.exportData();
      toolState._propExportData = () => propStore.exportData();
      const buf = serializeProject({ terrainStore, splatStore, treeStore, config, toolState });
      delete toolState._cliffExportData;
      delete toolState._propExportData;
      const blob = new Blob([buf], { type: "application/octet-stream" });
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      downloadBlob(blob, `terrain-${ts}.v2terrain`);
    },
    onLoadProject: async () => {
      const file = await openFilePicker(".v2terrain");
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const project = deserializeProject(buf);
        // Restore terrain heights
        for (const [key, heights] of project.terrainChunks) {
          terrainStore.chunkDataMap.set(key, heights);
        }
        // Restore splat paint
        splatStore.restoreFromSnapshot(project.splatChunks);
        // Restore trees
        if (project.treeChunks) {
          treeStore.clear();
          treeStore.restoreFromSnapshot(project.treeChunks);
          treeStore.syncAllHeights(terrainStore);
        }
        // Restore settings
        applySettings(toolState, project.settings);
        // Restore cliff instances (types must be re-imported by user)
        if (project.settings?.cliffInstances) {
          const typeNameToIdx = {};
          for (let i = 0; i < cliffStore.types.length; i++) {
            typeNameToIdx[cliffStore.types[i].name] = i;
          }
          cliffStore.clear();
          cliffStore.importData(project.settings.cliffInstances, typeNameToIdx);
        }
        // Restore prop instances (types must be re-imported by user)
        if (project.settings?.propInstances) {
          const typeNameToIdx = {};
          for (let i = 0; i < propStore.types.length; i++) {
            typeNameToIdx[propStore.types[i].name] = i;
          }
          propStore.clear();
          propStore.importData(project.settings.propInstances, typeNameToIdx);
        }
        sharedGroundBundle.syncFromParams(toolState.groundTsl);
        // Rebuild everything
        invalidateSurfaceMaterials();
        rebuildGlobalHeightTexture();
        syncFog();
        rebuildSkyEnv();
        chunkStream.markAllDirty();
        chunkStream.update(camera.position);
        grassManager.syncUniforms(toolState.grass, sunDir);
        grassManager.rebuildGeometries(toolState.grass);
        ui?.pane.refresh();
        const treeCount = treeStore.totalCount;
        console.log(`[V2] Loaded project: ${project.terrainChunks.size} terrain chunks, ${project.splatChunks.size} splat chunks, ${treeCount} trees`);
      } catch (err) {
        console.error("[V2] Failed to load project:", err);
      }
    },
  });

  propUiCallbacks = ui.propCallbacks;

  playMode.onExit = () => {
    toolState.mode = "view";
    playMode.exit();
    const tpEl = document.querySelector(".tp-dfwv");
    if (tpEl) tpEl.style.display = "";
    ui?.pane.refresh();
  };

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

  roadReflection.excludeFromReflection(brushPreview);
  roadReflection.excludeFromReflection(brushRing);
  roadReflection.excludeFromReflection(roadSystem.handleGroup);

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

  grassManager.init(globalHeightTex, sunDir, toolState.grass, {
    groundColorAtWorldXZ: sharedGroundBundle.groundColorAtWorldXZ,
  });
  grassManager.precompile(renderer, camera);

  // Pre-compile terrain pipelines for all LOD segment counts to avoid hitches
  {
    const tmpMeshes = [];
    for (const level of config.lod.levels) {
      const geo = terrainMesher.pool.acquire(level.segments);
      const m = new THREE.Mesh(geo, tileTerrainMaterial);
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.position.set(0, -9999, 0);
      scene.add(m);
      tmpMeshes.push({ mesh: m, geo, segs: level.segments });
    }
    await renderer.compileAsync(scene, camera);
    for (const { mesh, geo, segs } of tmpMeshes) {
      scene.remove(mesh);
      terrainMesher.pool.release(segs, geo);
    }
  }

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

  function isBrushMode() {
    return toolState.mode === "sculpt" || toolState.mode === "paint" || toolState.mode === "treePaint" || toolState.mode === "grass" || toolState.mode === "cliffGrass" || (toolState.mode === "props" && toolState.props.placementMode === "paint");
  }

  function updateBrushPreviewFromPick(hit) {
    if (!hit || !isBrushMode()) {
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

  function activateCliffSelection(instIdx) {
    cliffInstancer.select(instIdx);
    transformControls.attach(cliffInstancer.proxyObject);
    transformControls.setMode(toolState.cliffs.transformMode);
    transformControls.enabled = true;
    transformControls.visible = true;
  }

  function deactivateCliffSelection() {
    cliffInstancer.clearSelection();
    transformControls.detach();
    transformControls.enabled = false;
    transformControls.visible = false;
  }

  function activatePropSelection(instIdx) {
    propInstancer.select(instIdx);
    transformControls.attach(propInstancer.proxyObject);
    transformControls.setMode(toolState.props.transformMode);
    transformControls.enabled = true;
    transformControls.visible = true;
  }

  function deactivatePropSelection() {
    propInstancer.clearSelection();
    transformControls.detach();
    transformControls.enabled = false;
    transformControls.visible = false;
  }

  renderer.domElement.addEventListener("pointerdown", (event) => {
    if (toolState.mode === "cliffs" && event.button === 0 && !transformControls.dragging) {
      const hit = pickTerrain(event);
      if (hit) {
        const typeIdx = cliffSlotToType[toolState.cliffs.activeSlot];
        if (typeIdx == null) return;
        event.preventDefault();
        const instIdx = cliffSystem.handlePlace(hit.point, typeIdx);
        if (instIdx != null) activateCliffSelection(instIdx);
      }
      return;
    }
    if (toolState.mode === "props" && toolState.props.placementMode === "place" && event.button === 0 && !transformControls.dragging) {
      const hit = pickTerrain(event);
      if (hit) {
        const slot = toolState.propSlots[toolState.props.activeSlot];
        if (!slot || slot.typeIdx == null) return;
        event.preventDefault();
        const instIdx = propSystem.handlePlace(hit.point, slot.typeIdx);
        if (instIdx != null) activatePropSelection(instIdx);
      }
      return;
    }
    if (toolState.mode === "road" && event.button === 0) {
      event.preventDefault();
      updatePointer(event);
      raycaster.setFromCamera(pointerNdc, camera);
      const picked = roadSystem.pickPoint(raycaster);
      if (picked >= 0) {
        roadSystem.selectedIdx = picked;
        roadSystem.dragging = true;
        controls.enabled = false;
        roadSystem._rebuildHandles();
        roadSystem._updateSelectedY();
        ui?.pane.refresh();
      } else {
        const hit = pickTerrain(event);
        if (hit) {
          roadSystem.addPoint(hit.point);
          ui?.pane.refresh();
        }
      }
      return;
    }
    if (event.button !== 0 || !isBrushMode()) return;
    const hit = pickTerrain(event);
    if (toolState.mode === "sculpt" && toolState.sculptMode === "ramp") {
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
    if (toolState.mode === "sculpt") {
      sculptSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "paint") {
      paintSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "treePaint") {
      treeSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "grass") {
      grassPaintSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "cliffGrass") {
      cliffGrassPaintSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "props") {
      propSystem.beginStroke(hit.point, event);
    }
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (toolState.mode === "road" && roadSystem.dragging && roadSystem.selectedIdx >= 0) {
      const hit = pickTerrain(event);
      if (hit) roadSystem.moveSelected(hit.point);
      return;
    }
    const hit = pickTerrain(event);
    updateBrushPreviewFromPick(hit);
    if (!pointerDown || !isBrushMode() || !hit) return;
    if (toolState.mode === "sculpt") {
      sculptSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "paint") {
      paintSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "treePaint") {
      treeSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "grass") {
      grassPaintSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "cliffGrass") {
      cliffGrassPaintSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "props") {
      propSystem.applyAt(hit.point, event);
    }
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

  renderer.domElement.addEventListener("contextmenu", (event) => {
    if (toolState.mode === "cliffs") {
      event.preventDefault();
      updatePointer(event);
      raycaster.setFromCamera(pointerNdc, camera);
      const hit = cliffInstancer.raycast(raycaster);
      if (hit) {
        activateCliffSelection(hit.instIdx);
      } else {
        deactivateCliffSelection();
      }
    } else if (toolState.mode === "props") {
      event.preventDefault();
      updatePointer(event);
      raycaster.setFromCamera(pointerNdc, camera);
      const hit = propInstancer.raycast(raycaster);
      if (hit) {
        activatePropSelection(hit.instIdx);
      } else {
        deactivatePropSelection();
      }
    }
  });

  window.addEventListener("pointerup", () => {
    if (roadSystem.dragging) {
      roadSystem.dragging = false;
      controls.enabled = true;
    }
    if (!pointerDown) return;
    pointerDown = false;
    controls.enabled = true;
    if (toolState.mode === "sculpt") {
      sculptSystem.endStroke();
    } else if (toolState.mode === "paint") {
      paintSystem.endStroke();
    } else if (toolState.mode === "treePaint") {
      treeSystem.endStroke();
    } else if (toolState.mode === "grass") {
      grassPaintSystem.endStroke();
    } else if (toolState.mode === "cliffGrass") {
      cliffGrassPaintSystem.endStroke();
    } else if (toolState.mode === "props") {
      propSystem.endStroke();
    }
  });

  function activeEditSystem() {
    if (toolState.mode === "paint") return paintSystem;
    if (toolState.mode === "treePaint") return treeSystem;
    if (toolState.mode === "grass") return grassPaintSystem;
    if (toolState.mode === "cliffGrass") return cliffGrassPaintSystem;
    if (toolState.mode === "road") return roadSystem;
    if (toolState.mode === "cliffs") return cliffSystem;
    if (toolState.mode === "props") return propSystem;
    return sculptSystem;
  }

  window.addEventListener("keydown", (event) => {
    const ctrl = event.ctrlKey || event.metaKey;
    if (ctrl && event.code === "KeyZ") {
      event.preventDefault();
      const sys = activeEditSystem();
      if (event.shiftKey) sys.redo();
      else sys.undo();
    } else if (ctrl && event.code === "KeyY") {
      event.preventDefault();
      activeEditSystem().redo();
    } else if (event.code === "Delete" && toolState.mode === "road") {
      event.preventDefault();
      roadSystem.deleteSelected();
      ui?.pane.refresh();
    } else if (
      event.code === "KeyR" &&
      toolState.mode === "sculpt" &&
      toolState.sculptMode === "ramp" &&
      sculptSystem.hasRampPointA()
    ) {
      event.preventDefault();
      sculptSystem.clearRampPoint();
      syncRampMarker();
    } else if (event.code === "Delete" && toolState.mode === "cliffs") {
      event.preventDefault();
      cliffSystem.handleDelete();
      deactivateCliffSelection();
    } else if (event.code === "Delete" && toolState.mode === "props") {
      event.preventDefault();
      propSystem.handleDelete();
      deactivatePropSelection();
    } else if (toolState.mode === "cliffs" && !ctrl) {
      if (event.code === "KeyW") {
        toolState.cliffs.transformMode = "translate";
        transformControls.setMode("translate");
        ui?.pane.refresh();
      } else if (event.code === "KeyE") {
        toolState.cliffs.transformMode = "rotate";
        transformControls.setMode("rotate");
        ui?.pane.refresh();
      } else if (event.code === "KeyR") {
        toolState.cliffs.transformMode = "scale";
        transformControls.setMode("scale");
        ui?.pane.refresh();
      } else if (event.code >= "Digit1" && event.code <= "Digit5") {
        const slot = parseInt(event.code.charAt(5)) - 1;
        if (slot < toolState.cliffSlots.length) {
          toolState.cliffs.activeSlot = slot;
          ui?.pane.refresh();
        }
      }
    } else if (toolState.mode === "props" && !ctrl) {
      if (event.code === "KeyW") {
        toolState.props.transformMode = "translate";
        transformControls.setMode("translate");
        ui?.pane.refresh();
      } else if (event.code === "KeyE") {
        toolState.props.transformMode = "rotate";
        transformControls.setMode("rotate");
        ui?.pane.refresh();
      } else if (event.code === "KeyR") {
        toolState.props.transformMode = "scale";
        transformControls.setMode("scale");
        ui?.pane.refresh();
      }
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  let last = performance.now();
  let _lastLightSnap = "";
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dtMs = now - last;
    last = now;
    tickPerf(perf, now, dtMs);

    if (!playMode.active) controls.update();
    playMode.update(dtMs * 0.001);
    if (playMode.active) camera.updateMatrixWorld(true);
    const focusPos = playMode.active ? playMode.playerPos : camera.position;

    const Li = toolState.light;
    const S = toolState.physicalSky;
    const lightSnap = `${Li.sunAzimuth},${Li.sunElevation},${Li.dirColor},${Li.dirIntensity},${Li.hemiSkyColor},${Li.hemiGroundColor},${Li.hemiIntensity},${Li.shadowBias},${Li.shadowNormalBias},${Li.exposure},${Li.envIntensity},${Li.sunDistance},${S.turbidity},${S.rayleigh},${S.mie},${S.mieG},${S.cloudCoverage},${S.cloudDensity},${S.cloudElevation},${S.meshScale}`;
    if (lightSnap !== _lastLightSnap) {
      _lastLightSnap = lightSnap;
      updateSunSky();
      if (grassManager.uniforms) grassManager.uniforms.uSunDir.value.copy(sunDir);
      foliageLodRenderer.updateSunDirection(sunDir);
    }
    lensFlare.update();

    shadowTarget.position.set(focusPos.x, 0, focusPos.z);
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

    if (heightTexDirty && now - lastHeightTexSyncMs > 500) {
      rebuildGlobalHeightTexture();
      heightTexDirty = false;
      lastHeightTexSyncMs = now;
    }

    chunkStream.update(focusPos);
    cliffInstancer.update();
    propInstancer.update();
    treeLodRenderer.update(treeStore, camera, toolState.treeLod);
    foliageLodRenderer.update(treeStore, camera, toolState.foliageLod);
    foliageLodRenderer.updateTime(now * 0.001);
    if (grassManager.uniforms) {
      grassManager.uniforms.uPlayerPos.value.copy(focusPos);
    }
    grassManager.update(toolState.grass, playMode.active ? playMode.playerPos : null);

    if (now - hudLastMs > 180) {
      let tris = 0;
      for (const ch of chunkStream.activeChunks.values()) {
        tris += ch.segments * ch.segments * 2;
      }
      perf.trisApprox = tris;
      hud.update({ perf, toolState, sculptSystem });
      ui.refreshPerf();
      hudLastMs = now;
    }
    if (toolState.road.enhanced && roadSystem.segments.length > 0 && toolState.road.reflectStrength > 0) {
      roadReflection.setReflectY(roadSystem.getAverageY());
      const roadMeshes = roadSystem.getRoadMeshes();
      roadReflection.render(roadMeshes);
      roadSystem.updateReflectVP(roadReflection.reflectVP);
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
      treeLodRenderer.dispose();
      cliffInstancer.dispose();
      propInstancer.dispose();
      transformControls.dispose();
      grassManager.dispose();
      roadSystem.dispose();
      roadReflection.dispose();
      playMode.dispose();
      tileTerrainMaterial.dispose();
      disposeProceduralBundle();
      disposeImageTexBundle();
      splatStore.dispose();
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

