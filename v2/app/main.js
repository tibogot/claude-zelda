import * as THREE from "three";
import {
  uniform,
  Fn,
  float,
  vec2,
  step,
  texture,
  positionLocal,
  mix,
  clamp,
  fog,
  exponentialHeightFogFactor,
  densityFogFactor,
} from "three/tsl";
import { CSMShadowNode } from "three/addons/csm/CSMShadowNode.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SkyMesh } from "three/addons/objects/SkyMesh.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";
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
import { BrushMask } from "../core/paint/brushMask.js";
import { buildLayerArrayTextures } from "../core/paint/layerArrayBuilder.js";
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
import { FoliageStore } from "../core/foliage/foliageStore.js";
import { FoliagePaintSystem } from "../tools/foliage/foliagePaintSystem.js";
import { BillboardRenderer } from "../render/foliage/billboardRenderer.js";
import { loadFullPresetFromFile, loadFullPresetFromUrl } from "../core/foliage/presetLoader.js";
import { GrassManager } from "../render/foliage/grassManager.js";
import { GrassPaintSystem } from "../tools/foliage/grassPaintSystem.js";
import { CliffGrassPaintSystem } from "../tools/foliage/cliffGrassPaintSystem.js";
import { PlayMode } from "../play/playMode.js";
import { createV2AudioSystem } from "../audio/createV2AudioSystem.js";
import { createGroundTslBundle } from "../../chunkGroundTsl.js";
import { RoadSystem } from "../tools/road/roadSystem.js";
import { FullRoadSystem } from "../tools/fullRoad/fullRoadSystem.js";
import { RoadPlanarReflection } from "../core/road/roadReflection.js";
import { RiverSystem } from "../tools/river/riverSystem.js";
import { SplineSystem } from "../tools/spline/splineSystem.js";
import { CliffStore } from "../core/cliffs/cliffStore.js";
import { CliffInstancer } from "../core/cliffs/cliffInstancer.js";
import { CliffSystem } from "../tools/cliffs/cliffSystem.js";
import { CliffBvh } from "../core/cliffs/cliffBvh.js";
import { createCliffInstancerBlendMaterial } from "../../cliffInstancerBlendMaterial.js";
import { PropStore } from "../core/props/propStore.js";
import { PropInstancer } from "../core/props/propInstancer.js";
import { PropSystem } from "../tools/props/propSystem.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { WaterStore } from "../core/water/waterStore.js";
import { createWaterMaterials } from "../render/water/waterMaterial.js";
import { WaterSystem } from "../tools/water/waterSystem.js";
import { DecalSystem } from "../tools/decals/decalSystem.js";
import { WaterfallSystem } from "../tools/waterfall/waterfallSystem.js";
import { BarrierStore } from "../core/barrier/barrierStore.js";
import { BarrierSystem } from "../tools/barrier/barrierSystem.js";
import { BarrierOverlay } from "../render/barrier/barrierOverlay.js";
import { HoleStore } from "../core/hole/holeStore.js";
import { HoleSystem } from "../tools/hole/holeSystem.js";
import { HoleOverlay } from "../render/hole/holeOverlay.js";
import { createFleurSystem, FLEUR_PRESETS, FLEUR_ALPHA_URLS } from "../../fleur-painter.js";
import { createAmbientFxStore } from "../core/ambientfx/ambientFxStore.js";
import { BorderMountains } from "../render/terrain/borderMountains.js";

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
  let disposeHdrEnv = null;
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
      applyPhysicalSkyMeshUniforms();
      updateSunSky();
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

  let hdrTexture = null;
  let hdrFileName = null;

  function rebuildHdrEnv() {
    if (!hdrTexture) return;
    try {
      if (disposeHdrEnv) {
        disposeHdrEnv();
        disposeHdrEnv = null;
      }
      pmremGenerator = pmremGenerator ?? new THREE.PMREMGenerator(renderer);
      const pmremRT = pmremGenerator.fromEquirectangular(hdrTexture);
      scene.environment = pmremRT.texture;
      scene.background = hdrTexture;
      disposeHdrEnv = () => pmremRT.dispose();
    } catch (err) {
      console.warn("[V2] PMREM from HDR failed; IBL disabled.", err);
      scene.environment = null;
      scene.background = hdrTexture;
    }
  }

  function applySkyMode(mode) {
    toolState.skyMode = mode;
    if (mode === "physical") {
      if (disposeHdrEnv) {
        disposeHdrEnv();
        disposeHdrEnv = null;
      }
      sky.visible = true;
      scene.background = null;
      scene.backgroundIntensity = 1;
      rebuildSkyEnv();
    } else if (mode === "hdr") {
      sky.visible = false;
      if (hdrTexture) {
        if (disposeSkyEnv) {
          disposeSkyEnv();
          disposeSkyEnv = null;
        }
        rebuildHdrEnv();
      } else {
        if (disposeHdrEnv) {
          disposeHdrEnv();
          disposeHdrEnv = null;
        }
        scene.background = null;
        scene.backgroundIntensity = 1;
        scene.environment = null;
      }
    }
    updateSunSky();
  }

  function importHdr() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".hdr";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const loader = new HDRLoader();
      loader.load(url, (tex) => {
        URL.revokeObjectURL(url);
        tex.mapping = THREE.EquirectangularReflectionMapping;
        if (hdrTexture) hdrTexture.dispose();
        hdrTexture = tex;
        hdrFileName = file.name;
        applySkyMode("hdr");
        ui?.pane.refresh();
      });
    };
    input.click();
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
    const d = new Uint8Array(1 * 1 * 2 * 4);
    const t = new THREE.DataArrayTexture(d, 1, 1, 2);
    t.format = THREE.RGBAFormat;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  })();
  const placeholderHoleTex = (() => {
    const d = new Uint8Array([0, 0, 0, 0]);
    const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  })();
  let tileHoleTexNode = null;

  let _layerArrayAlbedo = null;
  let _layerArrayOrm = null;

  function buildSplatOverlay() {
    if (!textureLibraryReady) return null;
    const slots = toolState.paint.layerSlotIds.map((id) => textureLibrary.getSlot(id));
    if (slots.some((s) => !s)) return null;
    // Dispose previous array textures
    _layerArrayAlbedo?.dispose();
    _layerArrayOrm?.dispose();
    const { albedoArrayTex, ormArrayTex } = buildLayerArrayTextures(
      textureLibrary, toolState.paint.layerSlotIds,
    );
    _layerArrayAlbedo = albedoArrayTex;
    _layerArrayOrm = ormArrayTex;
    return createSplatOverlay(slots, config.world.chunkSize, config.world.size, albedoArrayTex, ormArrayTex);
  }

  /** Returns both splatmap texture nodes from whichever surface material is active. */
  function getActiveSplatNodes() {
    let bundle = null;
    if (toolState.terrainSurface === "tsl" && proceduralTerrainBundle) {
      bundle = proceduralTerrainBundle;
    } else if (toolState.terrainSurface === "image" && imageTexTerrainBundle) {
      bundle = imageTexTerrainBundle;
    }
    if (!bundle) return null;
    return {
      node0: bundle.splatTexNode,
      node1: bundle.splat1TexNode,
      holeNode: bundle.holeTexNode,
    };
  }

  function syncSoloLayer() {
    const v = toolState.paint.soloLayer;
    if (proceduralTerrainBundle?.uSoloLayer) proceduralTerrainBundle.uSoloLayer.value = v;
    if (imageTexTerrainBundle?.uSoloLayer) imageTexTerrainBundle.uSoloLayer.value = v;
  }

  function syncHeightBlend() {
    const hb = toolState.paint.heightBlend;
    const hc = toolState.paint.heightContrast;
    if (proceduralTerrainBundle?.uHeightBlend) {
      proceduralTerrainBundle.uHeightBlend.value = hb;
      proceduralTerrainBundle.uHeightContrast.value = hc;
    }
    if (imageTexTerrainBundle?.uHeightBlend) {
      imageTexTerrainBundle.uHeightBlend.value = hb;
      imageTexTerrainBundle.uHeightContrast.value = hc;
    }
  }

  function setupSplatSwapFromStore(mesh) {
    const prev = mesh.onBeforeRender;
    mesh.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      if (prev) prev(renderer, scene, camera, geometry, material, group);
      const nodes = getActiveSplatNodes();
      if (!nodes) return;
      const key = mesh.userData.chunkKey;
      const entry = splatStore.getChunkSplatByKey(key);
      const tex = entry?.combinedTex ?? placeholderSplatTex;
      const holeEntry = holeStore.getChunkByKey(key);
      const holeTex = holeEntry?.tex ?? placeholderHoleTex;
      if (nodes.node0) nodes.node0.value = tex;
      if (nodes.node1) nodes.node1.value = tex;
      if (nodes.holeNode) nodes.holeNode.value = holeTex;
      if (tileHoleTexNode) tileHoleTexNode.value = holeTex;
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

  const borderMountains = new BorderMountains(config);
  borderMountains.setMaterial(tileTerrainMaterial);
  scene.add(borderMountains.group);

  function rebuildBorderMountains() {
    borderMountains.rebuild(terrainStore, toolState.borderMountains, (mesh) => {
      setupSplatSwapFromStore(mesh);
    });
  }

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
    let mat;
    if (toolState.terrainSurface === "tsl") {
      syncProceduralTerrainTsl();
      mat = getProceduralTerrainBundle().material;
    } else if (toolState.terrainSurface === "image") {
      mat = getImageTexTerrainBundle().material;
    } else {
      mat = tileTerrainMaterial;
    }
    chunkStream.setSharedMaterial(mat);
    borderMountains.setMaterial(mat);
    syncSoloLayer();
    syncHeightBlend();
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
      fleurSystem.syncHeights();
      ambientFxStore.syncHeights();
      splineSystem?.syncGuardrailsToGround?.();
      splineSystem?.syncKerbsToGround?.();
      splineSystem?.syncLinearFeaturesToGround?.();
    },
  });
  const brushMask = new BrushMask();
  const paintSystem = new PaintSystem({ toolState, splatStore, config, brushMask });
  const holeStore = new HoleStore(config);
  const holeSystem = new HoleSystem({ toolState, holeStore, chunkStream });
  const holeOverlay = new HoleOverlay(scene, config);
  {
    const cs = float(config.world.chunkSize);
    tileHoleTexNode = texture(
      placeholderHoleTex,
      positionLocal.xz.div(cs).add(vec2(0.5, 0.5)),
    );
    tileTerrainMaterial.opacityNode = Fn(() => {
      return float(1.0).sub(step(float(0.25), tileHoleTexNode.r));
    })();
    tileTerrainMaterial.alphaTest = 0.5;
    tileTerrainMaterial.transparent = false;
  }

  const treeStore = new TreeStore(config);
  const treeLodRenderer = new TreeLodRenderer(scene, config);
  const treeSystem = new TreeSystem({ toolState, treeStore, terrainStore, config });
  const foliageLodRenderer = new FoliageLodRenderer(scene, config);

  const foliageStore = new FoliageStore(config);
  const billboardRenderer = new BillboardRenderer(scene, config);
  const foliagePaintSystem = new FoliagePaintSystem({ toolState, foliageStore, terrainStore, config });

  for (let i = 0; i < toolState.foliageSlots.length; i++) {
    billboardRenderer.rebuildSlot(i, toolState.foliageSlots[i]);
  }

  const grassManager = new GrassManager({ scene, camera, config });
  const grassPaintSystem = new GrassPaintSystem({ toolState, grassManager, config });
  const cliffGrassPaintSystem = new CliffGrassPaintSystem({ toolState, grassManager, config });
  const roadReflection = new RoadPlanarReflection({
    renderer, scene, camera, resScale: 0.75,
  });
  const roadSystem = new RoadSystem({
    scene, camera, toolState,
    getWorldHeight: (x, z) => terrainStore.getWorldHeight(x, z),
    reflectTex: roadReflection.texture,
    terrainStore,
    chunkStream,
  });
  const fullRoadSystem = new FullRoadSystem({
    scene,
    toolState,
    getWorldHeight: (x, z) => terrainStore.getWorldHeight(x, z),
    reflectTex: roadReflection.texture,
    terrainStore,
    chunkStream,
    graphMode: "fullRoad",
  });
  const smartRoadToolStateView = {};
  Object.defineProperty(smartRoadToolStateView, "fullRoad", {
    get: () => toolState.smartRoad,
  });
  Object.defineProperty(smartRoadToolStateView, "mode", {
    get: () => toolState.mode,
  });
  const smartRoadSystem = new FullRoadSystem({
    scene,
    toolState: smartRoadToolStateView,
    getWorldHeight: (x, z) => terrainStore.getWorldHeight(x, z),
    reflectTex: roadReflection.texture,
    terrainStore,
    chunkStream,
    useLabNetworkGeometry: true,
    graphMode: "smartRoad",
  });
  const riverSystem = new RiverSystem({
    scene,
    toolState,
    getWorldHeight: (x, z) => terrainStore.getWorldHeight(x, z),
  });
  const cliffStore = new CliffStore();
  const cliffInstancer = new CliffInstancer(scene, cliffStore);
  const cliffBvh = new CliffBvh(cliffStore);
  const cliffSystem = new CliffSystem({ toolState, cliffStore, cliffInstancer, cliffBvh, terrainStore });
  const cliffSlotToType = {};

  const propStore = new PropStore();
  const propInstancer = new PropInstancer(scene, propStore);
  const propSystem = new PropSystem({ toolState, propStore, propInstancer, cliffBvh, terrainStore, config });
  const splineSystem = new SplineSystem({
    scene,
    toolState,
    config,
    terrainStore,
    chunkStream,
    treeStore,
    propStore,
    getWorldHeight: (x, z) => terrainStore.getWorldHeight(x, z),
    getRoadSegments: () => roadSystem.getSegmentsSnapshot(),
  });
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
  fullRoadSystem.setTransformControls(transformControls);
  smartRoadSystem.setTransformControls(transformControls);
  const activeGraphRoadSystem = () =>
    toolState.mode === "smartRoad" ? smartRoadSystem : fullRoadSystem;
  const activeGraphRoadParams = () =>
    toolState.mode === "smartRoad" ? toolState.smartRoad : toolState.fullRoad;
  transformControls.addEventListener("change", () => {
    if (toolState.mode === "cliffs" && cliffInstancer.hasSelection) {
      cliffSystem.handleTransformChange();
    }
    if (toolState.mode === "props" && propInstancer.hasSelection) {
      propSystem.handleTransformChange();
    }
    if (toolState.mode === "decals" && decalSystem.selectedIndex >= 0) {
      const dd = decalSystem.decals[decalSystem.selectedIndex];
      if (dd && !dd.soloMesh) decalSystem.handleTransformChange();
    }
    if (toolState.mode === "fullRoad" && fullRoadSystem.selectedDecalId != null) {
      fullRoadSystem.handleDecalTransformChange();
    }
    if (toolState.mode === "smartRoad" && smartRoadSystem.selectedDecalId != null) {
      smartRoadSystem.handleDecalTransformChange();
    }
  });
  transformControls.addEventListener("mouseDown", () => {
    controls.enabled = false;
  });
  transformControls.addEventListener("mouseUp", () => {
    controls.enabled = toolState.mode !== "play";
    if (toolState.mode === "cliffs") cliffSystem.handleTransformEnd();
    if (toolState.mode === "props") propSystem.handleTransformEnd();
    if (toolState.mode === "decals") decalSystem.handleTransformEnd();
    if (toolState.mode === "fullRoad") fullRoadSystem.handleDecalTransformEnd();
    if (toolState.mode === "smartRoad") smartRoadSystem.handleDecalTransformEnd();
  });

  // ── Water system ──────────────────────────────────────────────────────────
  const waterStore = new WaterStore(scene);
  const waterMaterials = createWaterMaterials({
    heightTex: globalHeightTex,
    terrainSize: config.world.size,
  });
  const waterSystem = new WaterSystem({
    waterStore,
    waterMaterials,
    toolState,
    transformControls,
  });
  const waterfallSystem = new WaterfallSystem({
    scene,
    toolState,
    transformControls,
  });
  const decalSystem = new DecalSystem({
    scene,
    toolState,
    transformControls,
    getWorldHeight,
    roadSystem,
    chunkStream,
  });
  let _appTimeSec = 0;

  const barrierStore = new BarrierStore(config);
  const barrierSystem = new BarrierSystem({ toolState, barrierStore, config });
  const barrierOverlay = new BarrierOverlay(scene, config);

  for (let i = 0; i < FLEUR_ALPHA_URLS.length; i++) {
    if (!FLEUR_ALPHA_URLS[i].startsWith("../")) {
      FLEUR_ALPHA_URLS[i] = "../" + FLEUR_ALPHA_URLS[i];
    }
  }
  const fleurSystem = createFleurSystem(
    scene,
    (x, z) => terrainStore.getWorldHeight(x, z),
  );

  function syncFleurInteraction() {
    const fp = toolState.fleur;
    fleurSystem.setInteractionRadius(fp.interactRadius);
    fleurSystem.setInteractionStrength(fp.interactStrength);
    fleurSystem.setRepulseGain(fp.interactGain);
    fleurSystem.setWindAmp(fp.windAmp);
    fleurSystem.setWindSpeed(fp.windSpeed);
  }

  // ── Ambient FX system ──
  const ambientFxStore = createAmbientFxStore(
    scene,
    (x, z) => terrainStore.getWorldHeight(x, z),
    "../textures/",
  );
  ambientFxStore.setFlapSpeed(toolState.ambientFx.flapSpeed);
  ambientFxStore.setFlapAngle(toolState.ambientFx.flapAngle);
  ambientFxStore.setGlideRatio(toolState.ambientFx.glideRatio);
  ambientFxStore.setRingsVisible(false);

  function syncAmbientFxUniforms() {
    const afx = toolState.ambientFx;
    ambientFxStore.setFlapSpeed(afx.flapSpeed);
    ambientFxStore.setFlapAngle(afx.flapAngle);
    ambientFxStore.setGlideRatio(afx.glideRatio);
  }

  function paintAmbientFxAt(wx, wz, erase) {
    const afx = toolState.ambientFx;
    if (erase) {
      ambientFxStore.removeInBrush(wx, wz, afx.emitterRadius);
    } else {
      ambientFxStore.addInBrush(wx, wz, afx.emitterRadius, afx.effectType, afx.density);
    }
  }

  function paintFleurAt(wx, wz, erase) {
    const fp = toolState.fleur;
    const radius = toolState.brush.radius;
    if (erase) {
      fleurSystem.removeInBrush(wx, wz, radius);
    } else {
      fleurSystem.addInBrush(
        wx, wz, radius,
        fp.perStroke, fp.minSpacing,
        fp.scaleMin, fp.scaleMax,
        fp.hoverBase, fp.hoverVariance,
        fp.activeSlot,
        fp.subMode === "stem" ? "stem" : "ground",
        fp.bloomShape,
      );
    }
  }

  const audioSystem = createV2AudioSystem({ toolState });
  const playMode = new PlayMode({
    scene, camera, renderer, controls,
    getWorldHeight,
    getTerrainHeight: (x, z) => terrainStore.getWorldHeight(x, z),
    worldHalf: config.world.size * 0.5,
    cliffBvh,
    isBarrierBlocked: (wx, wz) => barrierStore.isBlocked(wx, wz),
    smokeSettings: toolState.playSmoke,
    carSettings: toolState.playCar,
    carAudioSettings: toolState.playCarAudio,
    spawnSettings: toolState.playSpawn,
    audioSystem,
    excludeFromReflection: (obj) => roadReflection.excludeFromReflection(obj),
  });
  const gestureAudioUnlock = () => {
    audioSystem.unlock();
  };
  window.addEventListener("pointerdown", gestureAudioUnlock, { once: true, capture: true });
  window.addEventListener("keydown", gestureAudioUnlock, { once: true, capture: true });

  function applyModeChangedEffects() {
    if (toolState.mode !== "sculpt") {
      sculptSystem.clearRampPoint();
    }
    if (toolState.mode !== "paint" && toolState.paint.soloLayer >= 0) {
      toolState.paint.soloLayer = -1;
      syncSoloLayer();
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
    if (toolState.mode !== "water") {
      waterSystem.deselect();
    }
    if (toolState.mode !== "waterfall") {
      waterfallSystem.deselect();
    } else {
      transformControls.setMode(toolState.waterfall.transformMode || "translate");
    }
    if (toolState.mode !== "decals") {
      decalSystem.deselect();
    } else {
      transformControls.setMode(toolState.decal.transformMode || "translate");
      if (decalSystem.selectedIndex >= 0) {
        decalSystem.selectByIndex(decalSystem.selectedIndex);
      }
    }
    if (toolState.mode !== "fullRoad" && toolState.mode !== "smartRoad") {
      fullRoadSystem.deselectDecal();
      fullRoadSystem._clearDecalPreview();
      smartRoadSystem.deselectDecal();
      smartRoadSystem._clearDecalPreview();
    } else if (activeGraphRoadParams().decalMode && activeGraphRoadSystem().selectedDecalId != null) {
      transformControls.setMode(activeGraphRoadParams().decalTransformMode || "translate");
    }
    if (toolState.mode !== "spline") {
      splineSystem.dragging = false;
    }
    roadSystem.handleGroup.visible = toolState.mode === "road" && toolState.road.showHandles;
    fullRoadSystem.handleGroup.visible = toolState.mode === "fullRoad" && toolState.fullRoad.showHandles;
    smartRoadSystem.handleGroup.visible = toolState.mode === "smartRoad" && toolState.smartRoad.showHandles;
    riverSystem.handleGroup.visible = toolState.mode === "river" && toolState.river.showHandles;
    splineSystem.handleGroup.visible = toolState.mode === "spline" && toolState.spline.showHandles;
    if (toolState.mode !== "spline") splineSystem.clearPreview();
    if (ui?.waterFolder) ui.waterFolder.hidden = toolState.mode !== "water";
    if (ui?.decalFolder) ui.decalFolder.hidden = toolState.mode !== "decals";
    if (ui?.barrierFolder) ui.barrierFolder.expanded = toolState.mode === "barrier";
    if (ui?.holeFolder) ui.holeFolder.expanded = toolState.mode === "hole";
    if (ui?.fleurFolder) ui.fleurFolder.hidden = toolState.mode !== "fleurs";
    if (ui?.ambientFxFolder) ui.ambientFxFolder.hidden = toolState.mode !== "ambientfx";
    if (toolState.mode === "ambientfx") {
      ambientFxStore.setRingsVisible(toolState.ambientFx.showRings);
    } else {
      ambientFxStore.setRingsVisible(false);
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
    syncPlaySpawnMarker();
  }

  const hud = createHud();
  /** @type {ReturnType<typeof createTweakpaneUi>} */
  let ui;
  ui = createTweakpaneUi({
    toolState,
    config,
    sculptSystem,
    perf,
    textureLibrary,
    brushMask,
    onConfigChanged: () => {
      chunkStream.update(camera.position);
    },
    onRebuildSkyEnv: rebuildSkyEnv,
    onSkyModeChanged: applySkyMode,
    onImportHdr: importHdr,
    onCsmEnabledChange: setCsmEnabled,
    onFogChange: syncFog,
    onGenerateProceduralTerrain: () => {
      sculptSystem.applyProceduralTerrainAllChunks();
      if (toolState.borderMountains.enabled) rebuildBorderMountains();
    },
    onRunGlobalErosion: () => sculptSystem.applyGlobalErosion(),
    onBorderMountainsRebuild: rebuildBorderMountains,
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
    onPlaySpawnChanged: () => {
      syncPlaySpawnMarker();
    },
    onRebuildCarAudio: () => {
      playMode.rebuildCarAudio();
    },
    onModeChanged: applyModeChangedEffects,
    onPaintLayersChanged: () => {
      invalidateSurfaceMaterials();
    },
    onPaintFill: () => paintSystem.fillWithActiveLayer(),
    onPaintClear: () => paintSystem.clearAll(),
    onSoloLayerChanged: () => syncSoloLayer(),
    onHeightBlendChanged: () => syncHeightBlend(),
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
    onLoadFoliageTexture: async (slotIdx) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/*";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const loader = new THREE.TextureLoader();
        loader.load(url, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          toolState.foliageSlots[slotIdx].textureUrl = url;
          billboardRenderer.setSlotTexture(slotIdx, tex, toolState.foliageSlots[slotIdx]);
          console.log(`[V2] Foliage slot ${slotIdx} texture loaded`);
        });
      };
      input.click();
    },
    onFoliageSlotStructureChanged: (slotIdx) => {
      billboardRenderer.rebuildSlot(slotIdx, toolState.foliageSlots[slotIdx]);
    },
    onFoliageSlotMaterialChanged: (slotIdx) => {
      billboardRenderer.updateSlotUniforms(slotIdx, toolState.foliageSlots[slotIdx]);
    },
    onClearAllFoliage: () => {
      foliagePaintSystem.clearAll();
    },
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
      cliffBvh.bake(terrainStore, config, [propStore, splineSystem, fullRoadSystem, smartRoadSystem, waterfallSystem]);
      grassManager.rebuildCliffHeightTex(cliffBvh, terrainStore, config.world.size);
      console.log("[V2] BVH rebaked (cliffs + props + spline/full-road/smart-road accessories + waterfalls) + cliff height tex updated");
    },
    onCliffTransformModeChanged: () => {
      transformControls.setMode(toolState.cliffs.transformMode);
    },
    onRoadChanged: () => {
      roadSystem.saveActiveStyle();
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
      markHeightTexDirty();
      treeStore.syncAllHeights(terrainStore);
      splineSystem.syncGuardrailsToGround();
      splineSystem.syncKerbsToGround();
      splineSystem.syncLinearFeaturesToGround();
      ui?.pane.refresh();
    },
    onRoadApplyStabilityPreset: () => {
      const rp = toolState.road;
      rp.heightOffset = 0.15;
      rp.adaptiveLift = true;
      rp.slopeLift = 0.35;
      rp.liftMax = 0.6;
      roadSystem.syncMaterial();
      roadSystem.rebuildAllMeshes();
      ui?.pane.refresh();
    },
    onFullRoadChanged: () => {
      const sys = activeGraphRoadSystem();
      sys.syncMaterial();
      sys.rebuildAllMeshes();
      sys._rebuildHandles();
      ui?.pane.refresh();
    },
    onFullRoadStartBranch: () => {
      activeGraphRoadSystem().startBranch();
      ui?.pane.refresh();
    },
    onFullRoadDeleteSelected: () => {
      activeGraphRoadSystem().deleteSelected();
      ui?.pane.refresh();
    },
    onFullRoadClearAll: () => {
      activeGraphRoadSystem().clearAll();
      ui?.pane.refresh();
    },
    onFullRoadSnapY: () => {
      activeGraphRoadSystem().snapSelectedYToTerrain();
      ui?.pane.refresh();
    },
    onFullRoadSelectedYChanged: () => {
      activeGraphRoadSystem().setSelectedPointY(activeGraphRoadParams().selectedPointY);
      ui?.pane.refresh();
    },
    onFullRoadToggleJunction: () => {
      activeGraphRoadSystem().toggleSelectedJunction();
      ui?.pane.refresh();
    },
    onFullRoadFlattenTerrain: () => {
      const sys = activeGraphRoadSystem();
      sys.flattenTerrainUnderRoads();
      sys.rebuildAllMeshes();
      markHeightTexDirty();
      treeStore.syncAllHeights(terrainStore);
      splineSystem.syncGuardrailsToGround();
      splineSystem.syncKerbsToGround();
      splineSystem.syncLinearFeaturesToGround();
      ui?.pane.refresh();
    },
    onFullRoadApplyCityPreset: () => {
      const rp = activeGraphRoadParams();
      rp.width = 12;
      rp.heightOffset = 0.08;
      rp.junctionRadius = 10;
      rp.centerLine = true;
      rp.centerLineDashed = true;
      rp.doubleCenterLine = false;
      rp.laneLines = false;
      rp.lineWidth = 0.025;
      rp.colorBrightness = 0.65;
      rp.texScale = 3.0;
      const sys = activeGraphRoadSystem();
      sys.syncMaterial();
      sys.rebuildAllMeshes();
      sys._rebuildHandles();
      ui?.pane.refresh();
    },
    onAccessoryTypeChanged: () => {
      activeGraphRoadSystem().cancelAccessoryPaint();
      ui?.pane.refresh();
    },
    onAccessoryParamsChanged: () => {
      activeGraphRoadSystem().rebuildAllAccessories();
      ui?.pane.refresh();
    },
    onAccessoryClearAll: () => {
      activeGraphRoadSystem().clearAllAccessories();
      ui?.pane.refresh();
    },
    onDecalModeToggle: () => {
      if (!activeGraphRoadParams().decalMode) {
        const sys = activeGraphRoadSystem();
        sys._clearDecalPreview();
        sys.deselectDecal();
      }
      ui?.pane.refresh();
    },
    onDecalTransformModeChanged: () => {
      if (activeGraphRoadSystem().selectedDecalId != null) {
        transformControls.setMode(activeGraphRoadParams().decalTransformMode);
      }
    },
    onDecalDeleteSelected: () => {
      activeGraphRoadSystem().deleteSelectedDecal();
      ui?.pane.refresh();
    },
    onDecalTypeChanged: () => {
      ui?.pane.refresh();
    },
    onDecalParamsChanged: () => {
      activeGraphRoadSystem().rebuildAllDecals();
      ui?.pane.refresh();
    },
    onDecalClearAll: () => {
      activeGraphRoadSystem().clearAllDecals();
      ui?.pane.refresh();
    },
    onRiverChanged: () => {
      riverSystem.syncMaterial();
      riverSystem.rebuildAllMeshes();
      ui?.pane.refresh();
    },
    onRiverNewRiver: () => riverSystem.startNewRiver(),
    onRiverDeleteActive: () => { riverSystem.deleteActiveRiver(); ui?.pane.refresh(); },
    onRiverDeleteSelected: () => { riverSystem.deleteSelected(); ui?.pane.refresh(); },
    onRiverSelectedYChanged: () => riverSystem.setSelectedPointY(toolState.river.selectedPointY),
    onRiverActiveIndexChanged: () => {
      riverSystem._clampActive();
      riverSystem.selectedIdx = -1;
      riverSystem._rebuildVisual();
      ui?.pane.refresh();
    },
    onRoadSelectedYChanged: () => roadSystem.setSelectedPointY(toolState.road.selectedPointY),
    onRoadStyleSectionChanged: () => {
      roadSystem._clampActiveStyleSection();
      roadSystem.loadActiveStyle();
      ui?.pane.refresh();
    },
    onRoadNewStyleSection: () => {
      roadSystem.createStyleSectionAtSelected();
      ui?.pane.refresh();
    },
    onRoadDeleteStyleSection: () => {
      roadSystem.deleteActiveStyleSection();
      ui?.pane.refresh();
    },
    onRoadFlattenTerrain: () => {
      roadSystem.flattenTerrainUnderRoads();
      roadSystem.rebuildAllMeshes();
      markHeightTexDirty();
      treeStore.syncAllHeights(terrainStore);
      splineSystem.syncGuardrailsToGround();
      splineSystem.syncKerbsToGround();
      splineSystem.syncLinearFeaturesToGround();
      ui?.pane.refresh();
    },
    onRoadActiveIndexChanged: () => {
      roadSystem._clampActive();
      toolState.road.activeStyleSectionIndex = 0;
      roadSystem.selectedIdx = -1;
      roadSystem.loadActiveStyle();
      roadSystem._rebuildVisual();
      ui?.pane.refresh();
    },
    onSplineChanged: () => {
      splineSystem._rebuildVisual();
      ui?.pane.refresh();
    },
    onSplineDeleteSelected: () => {
      splineSystem.deleteSelected();
      ui?.pane.refresh();
    },
    onSplineClearAll: () => {
      splineSystem.clearAll();
      ui?.pane.refresh();
    },
    onSplineSelectedYChanged: () => {
      splineSystem.setSelectedPointY(toolState.spline.selectedPointY);
      ui?.pane.refresh();
    },
    onSplineClosedChanged: () => {
      splineSystem.setClosed(toolState.spline.closed);
      ui?.pane.refresh();
    },
    onSplinePreview: () => splineSystem.preview(),
    onSplineBake: () => {
      splineSystem.bakePlacement();
      ui?.pane.refresh();
    },
    onSplineClearPreview: () => splineSystem.clearPreview(),
    onSplineApplyPlateau: () => {
      const changed = splineSystem.applyPlateau();
      if (!changed) return;
      markHeightTexDirty();
      treeStore.syncAllHeights(terrainStore);
      splineSystem.syncGuardrailsToGround();
      splineSystem.syncKerbsToGround();
      splineSystem.syncLinearFeaturesToGround();
      ui?.pane.refresh();
    },
    onSplineClearTunnels: () => {
      splineSystem.clearTunnels();
      ui?.pane.refresh();
    },
    onSplineClearLinearFeatures: () => {
      splineSystem.clearLinearFeatures();
      ui?.pane.refresh();
    },
    onSplineKerbSelect: () => {
      splineSystem.selectActiveKerb();
      ui?.pane.refresh();
    },
    onSplineKerbApply: () => {
      splineSystem.syncActiveKerbFromToolState();
      ui?.pane.refresh();
    },
    onSplineKerbDelete: () => {
      splineSystem.deleteActiveKerb();
      ui?.pane.refresh();
    },
    onSplineKerbDuplicate: () => {
      splineSystem.duplicateActiveKerb();
      ui?.pane.refresh();
    },
    onSplineKerbSuggestFromCurvature: () => {
      splineSystem.suggestKerbFromRoadCurvature();
      ui?.pane.refresh();
    },
    onSplineKerbLiveChanged: (changedKey) => {
      if (changedKey === "activeKerbIndex") {
        splineSystem.selectActiveKerb();
        ui?.pane.refresh();
        return;
      }
      if (!toolState.spline.kerbAutoApplyActive) return;
      splineSystem.syncActiveKerbFromToolState();
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
    onAddPrimitive: (primitiveName) => {
      const existing = toolState.propSlots.find((s) => s.name === primitiveName && s.builtin);
      if (existing) {
        toolState.props.activeSlot = toolState.propSlots.indexOf(existing);
        ui?.pane.refresh();
        return;
      }
      const defs = {
        Cube:     () => new THREE.BoxGeometry(1, 1, 1),
        Sphere:   () => new THREE.SphereGeometry(0.5, 32, 16),
        Cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
        Plane:    () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        Cone:     () => new THREE.ConeGeometry(0.5, 1, 32),
        Torus:    () => new THREE.TorusGeometry(0.4, 0.15, 16, 32),
      };
      const factory = defs[primitiveName];
      if (!factory) return;
      const geometry = factory();
      const material = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.6, metalness: 0.1 });
      const typeIdx = propStore.registerPrimitive(primitiveName, geometry, material);
      if (typeIdx >= 0) {
        propInstancer.onTypeRegistered(typeIdx);
        const slotIdx = toolState.propSlots.length;
        toolState.propSlots.push({ name: primitiveName, loaded: true, typeIdx, builtin: true });
        toolState.props.activeSlot = slotIdx;
        propUiCallbacks._rebuildPropUi?.();
        console.log(`[V2] Primitive "${primitiveName}" added (type ${typeIdx})`);
      }
      ui?.pane.refresh();
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
    onWaterChanged: () => {
      waterMaterials.syncUniforms(toolState.water);
    },
    onSaveWater: () => waterSystem.saveJSON(),
    onLoadWater: async () => {
      const file = await openFilePicker(".json");
      if (!file) return;
      try {
        await waterSystem.loadJSON(file);
        ui?.pane.refresh();
      } catch (err) {
        console.error("[V2] Failed to load water-bodies.json", err);
      }
    },
    onDeleteSelectedWater: () => {
      waterSystem.deleteSelected();
      ui?.pane.refresh();
    },
    onClearAllWater: () => {
      waterSystem.clearAll();
      ui?.pane.refresh();
    },
    onWaterfallChanged: () => {
      waterfallSystem.syncMaterial();
      waterfallSystem.refreshMeshesFromParams();
      ui?.pane.refresh();
    },
    onDeleteSelectedWaterfall: () => {
      waterfallSystem.deleteSelected();
      ui?.pane.refresh();
    },
    onClearAllWaterfalls: () => {
      waterfallSystem.clearAll();
      ui?.pane.refresh();
    },
    onDecalLoadImage: () => decalSystem.openImagePicker(),
    onDecalOpacityChanged: () => {
      decalSystem.applyOpacityToSelected();
      ui?.pane.refresh();
    },
    onDecalAlignChanged: () => {},
    onDecalRefit: () => {
      decalSystem.refitSelectedToTerrain();
      ui?.pane.refresh();
    },
    onDecalDeleteSelected: () => {
      decalSystem.deleteSelected();
      ui?.pane.refresh();
    },
    onDecalClearAll: () => {
      decalSystem.clearAll();
      ui?.pane.refresh();
    },
    onDecalSaveJson: () => {
      const data = decalSystem.exportData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      downloadBlob(blob, "decals.json");
    },
    onDecalLoadJson: async () => {
      const file = await openFilePicker(".json");
      if (!file) return;
      try {
        const text = await file.text();
        await decalSystem.importData(JSON.parse(text));
        ui?.pane.refresh();
      } catch (err) {
        console.error("[V2] Failed to load decals.json", err);
      }
    },
    onDecalTransformModeChanged: () => {
      transformControls.setMode(toolState.decal.transformMode);
    },
    onBarrierOverlayChanged: () => {
      syncBarrierOverlay();
    },
    onBarrierClear: () => {
      barrierSystem.clearAll();
      syncBarrierOverlay();
    },
    onBarrierFill: () => {
      barrierSystem.fillAll();
      syncBarrierOverlay();
    },
    onHoleOverlayChanged: () => {
      syncHoleOverlay();
    },
    onHoleClear: () => {
      holeSystem.clearAll();
      syncHoleOverlay();
    },
    onFleurChanged: () => {},
    onFleurColorChanged: (slot) => {
      const fp = toolState.fleur;
      if (slot === "A") {
        fleurSystem.setColorA(fp.colorA.inner, fp.colorA.outer, fp.colorA.glow);
      } else {
        fleurSystem.setColorB(fp.colorB.inner, fp.colorB.outer, fp.colorB.glow);
      }
    },
    onFleurStemChanged: () => {
      fleurSystem.setStemColors(toolState.fleur.stemBase, toolState.fleur.stemTop);
    },
    onFleurStemCurveChanged: () => {
      fleurSystem.setStemStaticCurve(toolState.fleur.stemStaticCurve);
    },
    onFleurInteractionChanged: () => {
      syncFleurInteraction();
    },
    onFleurClear: () => {
      fleurSystem.clear();
    },
    onAmbientFxFlapChanged: () => {
      syncAmbientFxUniforms();
    },
    onAmbientFxRingsChanged: () => {
      ambientFxStore.setRingsVisible(toolState.ambientFx.showRings && toolState.mode === "ambientfx");
    },
    onAmbientFxClear: () => {
      ambientFxStore.clear();
    },
    onSaveProject: () => {
      toolState._cliffExportData = () => cliffStore.exportData();
      toolState._propExportData = () => propStore.exportData();
      toolState._waterExportData = () => waterStore.exportData();
      toolState._waterfallExportData = () => waterfallSystem.exportData();
      toolState._barrierExportData = () => barrierStore.exportData();
      toolState._holeExportData = () => holeStore.exportData();
      toolState._fleurExportData = () => fleurSystem.getPositions();
      toolState._ambientFxExportData = () => ambientFxStore.getEmitters();
      toolState._roadExportData = () => roadSystem.exportData();
      toolState._fullRoadExportData = () => fullRoadSystem.exportData();
      toolState._smartRoadExportData = () => smartRoadSystem.exportData();
      toolState._riverExportData = () => riverSystem.exportData();
      toolState._splineExportData = () => splineSystem.exportData();
      toolState._decalExportData = () => decalSystem.exportData();
      const buf = serializeProject({ terrainStore, splatStore, treeStore, config, toolState });
      delete toolState._cliffExportData;
      delete toolState._propExportData;
      delete toolState._waterExportData;
      delete toolState._waterfallExportData;
      delete toolState._barrierExportData;
      delete toolState._holeExportData;
      delete toolState._fleurExportData;
      delete toolState._ambientFxExportData;
      delete toolState._roadExportData;
      delete toolState._fullRoadExportData;
      delete toolState._smartRoadExportData;
      delete toolState._riverExportData;
      delete toolState._splineExportData;
      delete toolState._decalExportData;
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
        riverSystem.syncMaterial();
        fullRoadSystem.syncMaterial();
        smartRoadSystem.syncMaterial();
        if (project.settings?.roads) roadSystem.importData(project.settings.roads);
        if (project.settings?.fullRoadNetwork) fullRoadSystem.importData(project.settings.fullRoadNetwork);
        else fullRoadSystem.importData(null);
        if (project.settings?.smartRoadNetwork) smartRoadSystem.importData(project.settings.smartRoadNetwork);
        else smartRoadSystem.importData(null);
        if (project.settings?.rivers) riverSystem.importData(project.settings.rivers);
        else riverSystem.importData([]);
        if (project.settings?.splinePath) splineSystem.importData(project.settings.splinePath);
        else splineSystem.importData({ points: [] });
        // Restore cliff instances (types must be re-imported by user)
        if (project.settings?.cliffInstances) {
          const typeNameToIdx = {};
          for (let i = 0; i < cliffStore.types.length; i++) {
            typeNameToIdx[cliffStore.types[i].name] = i;
          }
          cliffStore.clear();
          cliffStore.importData(project.settings.cliffInstances, typeNameToIdx);
        }
        // Auto-restore primitive prop types from saved slots
        if (project.settings?.propSlots) {
          for (const slot of project.settings.propSlots) {
            if (slot.builtin) propUiCallbacks.onAddPrimitive?.(slot.name);
          }
        }
        // Restore prop instances (GLB types must be re-imported by user)
        if (project.settings?.propInstances) {
          const typeNameToIdx = {};
          for (let i = 0; i < propStore.types.length; i++) {
            typeNameToIdx[propStore.types[i].name] = i;
          }
          propStore.clear();
          propStore.importData(project.settings.propInstances, typeNameToIdx);
        }
        // Restore water bodies
        if (project.settings?.waterBodies) {
          waterSystem.applyBodies(project.settings.waterBodies);
          waterMaterials.syncUniforms(toolState.water);
        }
        waterfallSystem.syncMaterial();
        if (project.settings?.waterfallItems) {
          waterfallSystem.importData(project.settings.waterfallItems);
        } else {
          waterfallSystem.clearAll();
        }
        if (project.settings?.decals && Array.isArray(project.settings.decals)) {
          await decalSystem.importData(project.settings.decals);
        } else {
          decalSystem.clearAll();
        }
        // Restore barriers
        barrierOverlay.clear();
        barrierStore.dispose();
        if (project.settings?.barrierChunks) {
          barrierStore.importData(project.settings.barrierChunks);
        }
        holeOverlay.clear();
        holeStore.dispose();
        if (project.settings?.holeChunks) {
          holeStore.importData(project.settings.holeChunks);
        }
        // Restore flowers
        if (project.settings?.fleurPositions && Array.isArray(project.settings.fleurPositions)) {
          fleurSystem.setPositions(project.settings.fleurPositions);
        } else {
          fleurSystem.clear();
        }
        if (project.settings?.fleurInteraction) {
          const fi = project.settings.fleurInteraction;
          const fp = toolState.fleur;
          if (fi.interactRadius != null) fp.interactRadius = fi.interactRadius;
          if (fi.interactStrength != null) fp.interactStrength = fi.interactStrength;
          if (fi.interactGain != null) fp.interactGain = fi.interactGain;
          if (fi.windAmp != null) fp.windAmp = fi.windAmp;
          if (fi.windSpeed != null) fp.windSpeed = fi.windSpeed;
          syncFleurInteraction();
        }
        // Restore ambient FX emitters
        if (project.settings?.ambientFxEmitters && Array.isArray(project.settings.ambientFxEmitters)) {
          ambientFxStore.setEmitters(project.settings.ambientFxEmitters);
        } else {
          ambientFxStore.clear();
        }
        syncAmbientFxUniforms();

        // Auto-reload tree presets (trunk GLBs + foliage) for slots that had them
        const presetLoads = [];
        for (let si = 0; si < toolState.treeSlots.length; si++) {
          const slot = toolState.treeSlots[si];
          if (!slot.presetFile) continue;
          presetLoads.push((async (slotIdx, filename) => {
            try {
              const { foliagePreset, trunkSubmeshes, trunkLod1Submeshes, json } = await loadFullPresetFromUrl(filename);
              if (trunkSubmeshes) {
                treeLodRenderer.setSlotModel(slotIdx, 0, trunkSubmeshes, toolState.treeLod.castShadow);
              }
              if (trunkLod1Submeshes) {
                treeLodRenderer.setSlotModel(slotIdx, 1, trunkLod1Submeshes, toolState.treeLod.castShadow);
              }
              foliageLodRenderer.setSlotPreset(slotIdx, foliagePreset);
              console.log(`[V2] Auto-loaded preset "${filename}" into slot ${slotIdx}`);
            } catch (err) {
              console.warn(`[V2] Could not auto-load preset "${filename}" for slot ${slotIdx}:`, err.message);
            }
          })(si, slot.presetFile));
        }
        if (presetLoads.length > 0) {
          Promise.all(presetLoads).then(() => {
            console.log(`[V2] All tree presets restored (${presetLoads.length} slot(s))`);
          });
        }

        sharedGroundBundle.syncFromParams(toolState.groundTsl);
        // Rebuild everything
        invalidateSurfaceMaterials();
        rebuildGlobalHeightTexture();
        grassManager.rebuildTerrainNormalTex(config.world.size);
        syncFog();
        if (toolState.skyMode === "hdr" && !hdrTexture) toolState.skyMode = "physical";
        applySkyMode(toolState.skyMode);
        chunkStream.markAllDirty();
        chunkStream.update(camera.position);
        if (toolState.borderMountains.enabled) rebuildBorderMountains();
        grassManager.syncUniforms(toolState.grass, sunDir);
        grassManager.rebuildGeometries(toolState.grass);
        syncPlaySpawnMarker();
        ui?.pane.refresh();
        const treeCount = treeStore.totalCount;
        console.log(`[V2] Loaded project: ${project.terrainChunks.size} terrain chunks, ${project.splatChunks.size} splat chunks, ${treeCount} trees`);
      } catch (err) {
        console.error("[V2] Failed to load project:", err);
      }
    },
  });

  function syncBarrierOverlay() {
    if (playMode.active) {
      barrierOverlay.sync(barrierStore, false, 0);
      return;
    }
    const showInMode = toolState.mode === "barrier";
    const visible = showInMode || toolState.barrier.showOverlay;
    barrierOverlay.sync(barrierStore, visible, toolState.barrier.overlayOpacity);
  }
  syncBarrierOverlay();

  function syncHoleOverlay() {
    if (playMode.active) {
      holeOverlay.sync(holeStore, false, 0);
      return;
    }
    const showInMode = toolState.mode === "hole";
    const visible = showInMode || toolState.hole.showOverlay;
    holeOverlay.sync(holeStore, visible, toolState.hole.overlayOpacity);
  }
  syncHoleOverlay();

  propUiCallbacks = ui.propCallbacks;

  playMode.onExit = () => {
    toolState.mode = "view";
    playMode.exit();
    const tpEl = document.querySelector(".tp-dfwv");
    if (tpEl) tpEl.style.display = "";
    syncPlaySpawnMarker();
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

  const spawnMarker = new THREE.Group();
  const spawnRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.055, 8, 72),
    new THREE.MeshBasicMaterial({ color: 0x4de3ff }),
  );
  spawnRing.rotation.x = Math.PI * 0.5;
  spawnRing.material.fog = false;
  spawnRing.renderOrder = 6;
  const spawnArrow = new THREE.Mesh(
    new THREE.ConeGeometry(0.28, 1.1, 4),
    new THREE.MeshBasicMaterial({ color: 0x4de3ff }),
  );
  spawnArrow.position.set(0, 1.15, -1.15);
  spawnArrow.rotation.x = -Math.PI * 0.5;
  spawnArrow.material.fog = false;
  spawnArrow.renderOrder = 6;
  spawnMarker.add(spawnRing, spawnArrow);
  spawnMarker.visible = false;
  scene.add(spawnMarker);

  roadReflection.excludeFromReflection(brushPreview);
  roadReflection.excludeFromReflection(brushRing);
  roadReflection.excludeFromReflection(spawnMarker);
  roadReflection.excludeFromReflection(roadSystem.handleGroup);
  roadReflection.excludeFromReflection(fullRoadSystem.handleGroup);
  roadReflection.excludeFromReflection(smartRoadSystem.handleGroup);
  roadReflection.excludeFromReflection(riverSystem.handleGroup);
  roadReflection.excludeFromReflection(splineSystem.handleGroup);
  roadReflection.excludeFromReflection(splineSystem.previewGroup);
  roadReflection.excludeFromReflection(splineSystem.trainMesh);
  roadReflection.excludeFromReflection(barrierOverlay.group);
  roadReflection.excludeFromReflection(holeOverlay.group);

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
    if (toolState.skyMode === "hdr") {
      scene.environmentIntensity = Li.hdrEnvIntensity ?? 1;
      scene.backgroundIntensity = Li.hdrBackgroundIntensity ?? 0.7;
    } else {
      scene.environmentIntensity = Li.envIntensity;
      scene.backgroundIntensity = 1;
    }
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
  grassManager.rebuildTerrainNormalTex(config.world.size);
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

  function syncPlaySpawnMarker() {
    const spawn = toolState.playSpawn;
    if (!spawn?.enabled || playMode.active) {
      spawnMarker.visible = false;
      return;
    }
    const y = terrainStore.getWorldHeight(spawn.x, spawn.z);
    spawn.y = y;
    spawnMarker.visible = true;
    spawnMarker.position.set(spawn.x, y + 0.08, spawn.z);
    spawnMarker.rotation.y = THREE.MathUtils.degToRad(spawn.yawDeg || 0);
  }

  function isBrushMode() {
    return toolState.mode === "sculpt" || toolState.mode === "paint" || toolState.mode === "treePaint" || toolState.mode === "foliagePaint" || toolState.mode === "grass" || toolState.mode === "cliffGrass" || toolState.mode === "barrier" || toolState.mode === "hole" || toolState.mode === "fleurs" || toolState.mode === "ambientfx" || (toolState.mode === "props" && toolState.props.placementMode === "paint");
  }

  function updateBrushPreviewFromPick(hit) {
    if (!hit || !isBrushMode()) {
      brushPreview.visible = false;
      brushRing.visible = false;
      syncRampMarker();
      return;
    }
    const r = toolState.mode === "ambientfx" ? toolState.ambientFx.emitterRadius : toolState.brush.radius;
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
    if (toolState.mode === "playSpawn" && event.button === 0) {
      const hit = pickTerrain(event);
      if (hit) {
        event.preventDefault();
        const spawn = toolState.playSpawn;
        spawn.enabled = true;
        spawn.x = hit.point.x;
        spawn.y = hit.point.y;
        spawn.z = hit.point.z;
        syncPlaySpawnMarker();
        ui?.pane.refresh();
      }
      return;
    }
    if (toolState.mode === "water" && event.button === 0) {
      if (transformControls.dragging) return;
      event.preventDefault();
      updatePointer(event);
      const hit = pickTerrain(event);
      const consumed = waterSystem.handlePointerDown(pointerNdc, camera, hit?.point);
      if (consumed) ui?.pane.refresh();
      return;
    }
    if (toolState.mode === "waterfall" && event.button === 0) {
      if (transformControls.dragging) return;
      event.preventDefault();
      updatePointer(event);
      const hit = pickTerrain(event);
      const consumed = waterfallSystem.handlePointerDown(pointerNdc, camera, hit?.point);
      if (consumed) ui?.pane.refresh();
      return;
    }
    if (toolState.mode === "decals" && event.button === 0) {
      if (transformControls.dragging) return;
      event.preventDefault();
      if (decalSystem.handlePointerDown(camera, event.clientX, event.clientY, renderer.domElement)) {
        ui?.pane.refresh();
      }
      return;
    }
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
    if ((toolState.mode === "fullRoad" || toolState.mode === "smartRoad") && event.button === 0) {
      event.preventDefault();
      updatePointer(event);
      raycaster.setFromCamera(pointerNdc, camera);
      const graphRoadSystem = activeGraphRoadSystem();
      
      // Decal placement/selection mode
      if (activeGraphRoadParams().decalMode) {
        // Don't interfere with gizmo dragging
        if (transformControls.dragging) return;
        
        // First try to pick an existing decal
        const pickedDecal = graphRoadSystem.pickDecal(raycaster);
        if (pickedDecal) {
          graphRoadSystem.selectDecal(pickedDecal.id);
          ui?.pane.refresh();
          return;
        }

        // No decal clicked - place a new one
        const hit = pickTerrain(event);
        if (hit) {
          graphRoadSystem.deselectDecal(); // Deselect any selected decal
          graphRoadSystem.placeDecal(hit.point);
          ui?.pane.refresh();
        }
        return;
      }
      
      // Accessory painting mode (guardrails, kerbs, barriers, fences, tunnels)
      const activeRoadParams = activeGraphRoadParams();
      const accType = activeRoadParams.accessoryType;
      const isPaintMode = accType && (
        (accType === "guardrail" && activeRoadParams.guardrailMode) ||
        (accType === "kerb" && activeRoadParams.kerbMode) ||
        (accType === "barrier" && activeRoadParams.barrierMode) ||
        (accType === "fence" && activeRoadParams.fenceMode) ||
        (accType === "tunnel" && activeRoadParams.tunnelMode)
      );
      // Also check if shift key is held as quick paint mode
      if (isPaintMode || event.shiftKey) {
        const hit = pickTerrain(event);
        if (hit) {
          const started = graphRoadSystem.startAccessoryPaint(hit.point, accType);
          if (started) {
            graphRoadSystem._paintingAccessoryActive = true;
            controls.enabled = false;
          }
        }
        return;
      }
      
      const picked = graphRoadSystem.pickNode(raycaster);
      if (picked != null) {
        graphRoadSystem.selectedNodeId = picked;
        graphRoadSystem.dragging = true;
        controls.enabled = false;
        graphRoadSystem._rebuildHandles();
        graphRoadSystem._updateSelectedY();
        ui?.pane.refresh();
      } else {
        const hit = pickTerrain(event);
        if (hit) {
          graphRoadSystem.addOrConnect(hit.point);
          ui?.pane.refresh();
        }
      }
      return;
    }
    if (toolState.mode === "river" && event.button === 0) {
      event.preventDefault();
      updatePointer(event);
      raycaster.setFromCamera(pointerNdc, camera);
      const picked = riverSystem.pickPoint(raycaster);
      if (picked >= 0) {
        riverSystem.selectedIdx = picked;
        riverSystem.dragging = true;
        controls.enabled = false;
        riverSystem._rebuildHandles();
        riverSystem._updateSelectedY();
        ui?.pane.refresh();
      } else {
        const hit = pickTerrain(event);
        if (hit) {
          riverSystem.addPoint(hit.point);
          ui?.pane.refresh();
        }
      }
      return;
    }
    if (toolState.mode === "spline" && event.button === 0) {
      event.preventDefault();
      updatePointer(event);
      raycaster.setFromCamera(pointerNdc, camera);
      const picked = splineSystem.pickPoint(raycaster);
      if (picked >= 0) {
        splineSystem.selectedIdx = picked;
        splineSystem.dragging = true;
        controls.enabled = false;
        splineSystem._rebuildVisual();
        splineSystem._updateSelectedY();
        ui?.pane.refresh();
      } else {
        const hit = pickTerrain(event);
        if (hit) {
          splineSystem.addPoint(hit.point);
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
    } else if (toolState.mode === "foliagePaint") {
      foliagePaintSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "grass") {
      grassPaintSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "cliffGrass") {
      cliffGrassPaintSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "props") {
      propSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "barrier") {
      barrierSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "hole") {
      holeSystem.beginStroke(hit.point, event);
    } else if (toolState.mode === "fleurs") {
      paintFleurAt(hit.point.x, hit.point.z, toolState.fleur.erase || event.shiftKey);
    } else if (toolState.mode === "ambientfx") {
      paintAmbientFxAt(hit.point.x, hit.point.z, toolState.ambientFx.erase || event.shiftKey);
    }
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (toolState.mode === "play") return;
    if (toolState.mode === "road" && roadSystem.dragging && roadSystem.selectedIdx >= 0) {
      const hit = pickTerrain(event);
      if (hit) roadSystem.moveSelected(hit.point);
      return;
    }
    if ((toolState.mode === "fullRoad" || toolState.mode === "smartRoad") && activeGraphRoadSystem().dragging && activeGraphRoadSystem().selectedNodeId != null) {
      const hit = pickTerrain(event);
      if (hit) activeGraphRoadSystem().moveSelected(hit.point);
      return;
    }
    if ((toolState.mode === "fullRoad" || toolState.mode === "smartRoad") && activeGraphRoadSystem()._paintingAccessoryActive) {
      const hit = pickTerrain(event);
      if (hit) activeGraphRoadSystem().continueAccessoryPaint(hit.point);
      return;
    }
    // Decal preview on hover
    if ((toolState.mode === "fullRoad" || toolState.mode === "smartRoad") && activeGraphRoadParams().decalMode) {
      const hit = pickTerrain(event);
      if (hit) {
        activeGraphRoadSystem().updateDecalPreview(hit.point);
      }
    }
    if (toolState.mode === "river" && riverSystem.dragging && riverSystem.selectedIdx >= 0) {
      const hit = pickTerrain(event);
      if (hit) riverSystem.moveSelected(hit.point);
      return;
    }
    if (toolState.mode === "spline" && splineSystem.dragging && splineSystem.selectedIdx >= 0) {
      const hit = pickTerrain(event);
      if (hit) splineSystem.moveSelected(hit.point);
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
    } else if (toolState.mode === "foliagePaint") {
      foliagePaintSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "grass") {
      grassPaintSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "cliffGrass") {
      cliffGrassPaintSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "props") {
      propSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "barrier") {
      barrierSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "hole") {
      holeSystem.applyAt(hit.point, event);
    } else if (toolState.mode === "fleurs") {
      paintFleurAt(hit.point.x, hit.point.z, toolState.fleur.erase || event.shiftKey);
    } else if (toolState.mode === "ambientfx") {
      paintAmbientFxAt(hit.point.x, hit.point.z, toolState.ambientFx.erase || event.shiftKey);
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
    if (fullRoadSystem.dragging) {
      fullRoadSystem.dragging = false;
      controls.enabled = true;
    }
    if (smartRoadSystem.dragging) {
      smartRoadSystem.dragging = false;
      controls.enabled = true;
    }
    if (fullRoadSystem._paintingAccessoryActive) {
      fullRoadSystem._paintingAccessoryActive = false;
      fullRoadSystem.endAccessoryPaint();
      controls.enabled = true;
      ui?.pane.refresh();
    }
    if (smartRoadSystem._paintingAccessoryActive) {
      smartRoadSystem._paintingAccessoryActive = false;
      smartRoadSystem.endAccessoryPaint();
      controls.enabled = true;
      ui?.pane.refresh();
    }
    if (riverSystem.dragging) {
      riverSystem.dragging = false;
      controls.enabled = true;
    }
    if (splineSystem.dragging) {
      splineSystem.dragging = false;
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
    } else if (toolState.mode === "foliagePaint") {
      foliagePaintSystem.endStroke();
    } else if (toolState.mode === "grass") {
      grassPaintSystem.endStroke();
    } else if (toolState.mode === "cliffGrass") {
      cliffGrassPaintSystem.endStroke();
    } else if (toolState.mode === "props") {
      propSystem.endStroke();
    } else if (toolState.mode === "barrier") {
      barrierSystem.endStroke();
    } else if (toolState.mode === "hole") {
      holeSystem.endStroke();
    }
  });

  function activeEditSystem() {
    if (toolState.mode === "paint") return paintSystem;
    if (toolState.mode === "treePaint") return treeSystem;
    if (toolState.mode === "foliagePaint") return foliagePaintSystem;
    if (toolState.mode === "grass") return grassPaintSystem;
    if (toolState.mode === "cliffGrass") return cliffGrassPaintSystem;
    if (toolState.mode === "road") return roadSystem;
    if (toolState.mode === "fullRoad") return fullRoadSystem;
    if (toolState.mode === "smartRoad") return smartRoadSystem;
    if (toolState.mode === "river") return riverSystem;
    if (toolState.mode === "spline") return splineSystem;
    if (toolState.mode === "cliffs") return cliffSystem;
    if (toolState.mode === "props") return propSystem;
    if (toolState.mode === "water") return waterSystem;
    if (toolState.mode === "waterfall") return waterfallSystem;
    if (toolState.mode === "decals") return decalSystem;
    if (toolState.mode === "barrier") return barrierSystem;
    if (toolState.mode === "hole") return holeSystem;
    return sculptSystem;
  }

  window.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) return;
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
    } else if (event.code === "Delete" && (toolState.mode === "fullRoad" || toolState.mode === "smartRoad")) {
      event.preventDefault();
      activeGraphRoadSystem().deleteSelected();
      ui?.pane.refresh();
    } else if (event.code === "Delete" && toolState.mode === "river") {
      event.preventDefault();
      riverSystem.deleteSelected();
      ui?.pane.refresh();
    } else if (event.code === "Delete" && toolState.mode === "spline") {
      event.preventDefault();
      splineSystem.deleteSelected();
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
    } else if (
      event.code === "KeyW" && !ctrl &&
      toolState.mode !== "cliffs" &&
      toolState.mode !== "props" &&
      toolState.mode !== "water" &&
      toolState.mode !== "waterfall" &&
      toolState.mode !== "decals" &&
      toolState.mode !== "play"
    ) {
      event.preventDefault();
      toolState.mode = "water";
      applyModeChangedEffects();
    } else if (event.code === "KeyW" && !ctrl && toolState.mode === "water") {
      event.preventDefault();
      toolState.mode = "view";
      applyModeChangedEffects();
    } else if (event.code === "Delete" && toolState.mode === "water") {
      event.preventDefault();
      waterSystem.deleteSelected();
      ui?.pane.refresh();
    } else if (event.code === "Delete" && toolState.mode === "waterfall") {
      event.preventDefault();
      waterfallSystem.deleteSelected();
      ui?.pane.refresh();
    } else if (event.code === "Delete" && toolState.mode === "decals") {
      event.preventDefault();
      decalSystem.deleteSelected();
      ui?.pane.refresh();
    } else if (event.code === "KeyD" && !ctrl && toolState.mode !== "play" && toolState.mode !== "decals") {
      event.preventDefault();
      toolState.mode = "decals";
      applyModeChangedEffects();
    } else if (event.code === "KeyD" && !ctrl && toolState.mode === "decals") {
      event.preventDefault();
      toolState.mode = "view";
      applyModeChangedEffects();
    } else if (toolState.mode === "water" && !ctrl) {
      if (event.code === "KeyE") {
        event.preventDefault();
        waterSystem.setTransformMode("translate");
      } else if (event.code === "KeyR") {
        event.preventDefault();
        waterSystem.setTransformMode("rotate");
      } else if (event.code === "KeyT") {
        event.preventDefault();
        waterSystem.setTransformMode("scale");
      }
    } else if (event.code === "KeyH" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "waterfall" ? "view" : "waterfall";
      applyModeChangedEffects();
    } else if (toolState.mode === "decals" && !ctrl) {
      if (event.code === "KeyW") {
        event.preventDefault();
        decalSystem.setTransformMode("translate");
        ui?.pane.refresh();
      } else if (event.code === "KeyE") {
        event.preventDefault();
        decalSystem.setTransformMode("rotate");
        ui?.pane.refresh();
      } else if (event.code === "KeyR") {
        event.preventDefault();
        decalSystem.setTransformMode("scale");
        ui?.pane.refresh();
      }
    } else if (toolState.mode === "waterfall" && !ctrl) {
      if (event.code === "KeyW") {
        event.preventDefault();
        toolState.waterfall.transformMode = "translate";
        transformControls.setMode("translate");
        ui?.pane.refresh();
      } else if (event.code === "KeyE") {
        event.preventDefault();
        toolState.waterfall.transformMode = "rotate";
        transformControls.setMode("rotate");
        ui?.pane.refresh();
      } else if (event.code === "KeyR") {
        event.preventDefault();
        toolState.waterfall.transformMode = "scale";
        transformControls.setMode("scale");
        ui?.pane.refresh();
      }
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
    } else if (event.code === "KeyK" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "spline" ? "view" : "spline";
      applyModeChangedEffects();
    } else if (event.code === "KeyV" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "river" ? "view" : "river";
      applyModeChangedEffects();
    } else if (event.code === "KeyM" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "fleurs" ? "view" : "fleurs";
      applyModeChangedEffects();
    } else if (event.code === "KeyX" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "ambientfx" ? "view" : "ambientfx";
      applyModeChangedEffects();
    } else if (event.code === "KeyF" && !ctrl && !playMode.active && toolState.mode !== "play") {
      event.preventDefault();
      toolState.mode = "play";
      applyModeChangedEffects();
    } else if (event.code === "KeyP" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "paint" ? "view" : "paint";
      applyModeChangedEffects();
    } else if (event.code === "KeyT" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "treePaint" ? "view" : "treePaint";
      applyModeChangedEffects();
    } else if (event.code === "KeyS" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "sculpt" ? "view" : "sculpt";
      applyModeChangedEffects();
    } else if (event.code === "KeyG" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "grass" ? "view" : "grass";
      applyModeChangedEffects();
    } else if (event.code === "KeyI" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "props" ? "view" : "props";
      applyModeChangedEffects();
    } else if (event.code === "KeyO" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "cliffs" ? "view" : "cliffs";
      applyModeChangedEffects();
    } else if (event.code === "KeyL" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "foliagePaint" ? "view" : "foliagePaint";
      applyModeChangedEffects();
    } else if (event.code === "KeyB" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "barrier" ? "view" : "barrier";
      applyModeChangedEffects();
    } else if (event.code === "KeyZ" && !ctrl && !playMode.active) {
      event.preventDefault();
      toolState.mode = toolState.mode === "playSpawn" ? "view" : "playSpawn";
      applyModeChangedEffects();
    }
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (csm?.mainFrustum && toolState.csm.enabled) csm.updateFrustums();
  });

  let last = performance.now();
  let _lastLightSnap = "";
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const dtMs = now - last;
    last = now;
    tickPerf(perf, now, dtMs);

    if (!playMode.active) controls.update();
    const dtSec = dtMs * 0.001;
    playMode.update(dtSec);
    audioSystem.update(dtSec);
    camera.updateMatrixWorld();
    const focusPos = playMode.active ? playMode.playerPos : camera.position;

    const Li = toolState.light;
    const S = toolState.physicalSky;
    const lightSnap = `${Li.sunAzimuth},${Li.sunElevation},${Li.dirColor},${Li.dirIntensity},${Li.hemiSkyColor},${Li.hemiGroundColor},${Li.hemiIntensity},${Li.shadowBias},${Li.shadowNormalBias},${Li.exposure},${Li.envIntensity},${Li.hdrEnvIntensity},${Li.hdrBackgroundIntensity},${Li.sunDistance},${S.turbidity},${S.rayleigh},${S.mie},${S.mieG},${S.cloudCoverage},${S.cloudDensity},${S.cloudElevation},${S.meshScale}`;
    if (lightSnap !== _lastLightSnap) {
      _lastLightSnap = lightSnap;
      updateSunSky();
      if (grassManager.uniforms) grassManager.uniforms.uSunDir.value.copy(sunDir);
      foliageLodRenderer.updateSunDirection(sunDir);
      billboardRenderer.updateSunDirection(sunDir);
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
      grassManager.rebuildTerrainNormalTex(config.world.size);
      heightTexDirty = false;
      lastHeightTexSyncMs = now;
    }

    chunkStream.update(focusPos);
    cliffInstancer.update();
    propInstancer.update();
    treeLodRenderer.update(treeStore, camera, toolState.treeLod);
    foliageLodRenderer.update(treeStore, camera, toolState.foliageLod);
    foliageLodRenderer.updateTime(now * 0.001);
    billboardRenderer.update(foliageStore, camera, toolState.foliageLod);
    billboardRenderer.updateTime(now * 0.001);
    if (grassManager.uniforms) {
      grassManager.uniforms.uPlayerPos.value.copy(focusPos);
    }
    grassManager.update(toolState.grass, playMode.active ? playMode.playerPos : null);

    fleurSystem.update(playMode.active ? playMode.playerPos : focusPos, _appTimeSec);

    const afx = toolState.ambientFx;
    ambientFxStore.update(focusPos, _appTimeSec, afx.windX, afx.windZ, afx.windStrength);

    syncBarrierOverlay();
    syncHoleOverlay();

    // Water: advance time + lake reflections
    _appTimeSec += Math.min(0.05, dtSec);
    waterMaterials.updateTime(_appTimeSec);
    if (waterStore.lakeBodies.length > 0) {
      waterMaterials.lakeShader.update(dtSec, _appTimeSec, waterStore.lakeBodies);
      if (toolState.water.reflectionEnabled) {
        waterMaterials.setReflectionParams(toolState.water.reflectionScale, toolState.water.reflectionEveryN);
        waterMaterials.renderLakeReflection(
          camera, renderer, scene, waterStore.bodies, waterStore.lakeBodies,
          [grassManager.group],
        );
      } else {
        waterMaterials.lakeShader.uniforms.reflectEnabled.value = 0;
      }
    }
    waterfallSystem.update(dtSec);

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
    // Road reflection disabled for now (re-enable later)
    // if (roadSystem.hasReflectiveRoads() || fullRoadSystem.hasReflectiveRoads() || smartRoadSystem.hasReflectiveRoads()) {
    //   roadReflection.render(...);
    // }
    riverSystem.update(dtMs * 0.001);
    splineSystem.update(dtMs * 0.001);
    renderer.render(scene, camera);
  });

  return {
    scene,
    camera,
    renderer,
    /** Howler-based mixer + `register()` for gameplay sounds */
    audioSystem,
    dispose() {
      renderer.domElement.removeEventListener("wheel", onCanvasWheelBrush, { capture: true });
      if (csm) {
        sun.shadow.shadowNode = null;
        csm.dispose();
        csm = null;
      }
      scene.environment = null;
      scene.background = null;
      if (disposeHdrEnv) disposeHdrEnv();
      if (hdrTexture) hdrTexture.dispose();
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
      ambientFxStore.clear();
      roadSystem.dispose();
      fullRoadSystem.dispose();
      smartRoadSystem.dispose();
      riverSystem.dispose();
      splineSystem.dispose();
      roadReflection.dispose();
      waterMaterials.dispose();
      waterfallSystem.dispose();
      playMode.dispose();
      audioSystem.dispose();
      tileTerrainMaterial.dispose();
      disposeProceduralBundle();
      disposeImageTexBundle();
      _layerArrayAlbedo?.dispose();
      _layerArrayOrm?.dispose();
      splatStore.dispose();
      barrierStore.dispose();
      barrierOverlay.dispose();
      holeStore.dispose();
      holeOverlay.dispose();
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

