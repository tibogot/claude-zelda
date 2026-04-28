/**
 * Binary terrain project serializer — save/load terrain + splat + trees + settings.
 *
 * File format (.v2terrain):
 *
 *   HEADER (28 bytes — version 2):
 *     [0..3]   magic              "V2TR" (4 bytes ASCII)
 *     [4..5]   version            uint16 LE (2)
 *     [6..9]   worldSize          float32 LE
 *     [10..13] chunkSize          float32 LE
 *     [14..15] dataResolution     uint16 LE
 *     [16..17] splatResolution    uint16 LE
 *     [18..19] terrainChunkCount  uint16 LE
 *     [20..21] splatChunkCount    uint16 LE
 *     [22..25] settingsLength     uint32 LE (bytes of JSON UTF-8)
 *     [26..27] treeChunkCount     uint16 LE (version ≥ 2)
 *
 *   SETTINGS, TERRAIN CHUNKS, SPLAT CHUNKS — same as v1
 *
 *   TREE CHUNKS (treeChunkCount entries, version ≥ 2):
 *     Per entry:
 *       cx: int16 LE, cz: int16 LE        (4 bytes)
 *       instanceCount: uint16 LE           (2 bytes)
 *       Per instance (18 bytes):
 *         x: float32 LE, z: float32 LE,
 *         rotY: float32 LE, scale: float32 LE,
 *         slotIdx: uint16 LE
 */

import { parseChunkKey } from "../terrain/chunkMath.js";

const MAGIC = "V2TR";
const VERSION = 3;
const HEADER_V1 = 26;
const HEADER_V2 = 28;
const TREE_INSTANCE_BYTES = 18;

/**
 * Serialize terrain project to an ArrayBuffer.
 *
 * @param {object} opts
 * @param {import("../terrain/terrainStore.js").TerrainStore} opts.terrainStore
 * @param {import("../paint/splatStore.js").SplatStore} opts.splatStore
 * @param {import("../foliage/treeStore.js").TreeStore} [opts.treeStore]
 * @param {object} opts.config
 * @param {object} opts.toolState — serializable subset
 * @returns {ArrayBuffer}
 */
export function serializeProject({ terrainStore, splatStore, treeStore, config, toolState }) {
  const settingsJson = JSON.stringify(extractSerializableSettings(toolState));
  const settingsBytes = new TextEncoder().encode(settingsJson);

  const dataRes = config.world.dataResolution;
  const perAxis = dataRes + 1;
  const heightsPerChunk = perAxis * perAxis;
  const heightsBytesPerChunk = heightsPerChunk * 4;

  const splatRes = config.paint.splatResolution;
  const splatBytesPerBuf = splatRes * splatRes * 4;
  const splatBytesPerChunk = splatBytesPerBuf * 2;

  const terrainEntries = [...terrainStore.chunkDataMap.entries()];
  const splatEntries = [...splatStore.chunks.entries()];
  const treeEntries = treeStore ? [...treeStore.chunks.entries()].filter(([, t]) => t.length > 0) : [];

  let treeTotalBytes = 0;
  for (const [, trees] of treeEntries) {
    treeTotalBytes += 4 + 2 + trees.length * TREE_INSTANCE_BYTES;
  }

  const totalSize =
    HEADER_V2 +
    settingsBytes.byteLength +
    terrainEntries.length * (4 + heightsBytesPerChunk) +
    splatEntries.length * (4 + splatBytesPerChunk) +
    treeTotalBytes;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let offset = 0;

  // Header (28 bytes — version 2)
  for (let i = 0; i < 4; i++) view.setUint8(offset++, MAGIC.charCodeAt(i));
  view.setUint16(offset, VERSION, true); offset += 2;
  view.setFloat32(offset, config.world.size, true); offset += 4;
  view.setFloat32(offset, config.world.chunkSize, true); offset += 4;
  view.setUint16(offset, dataRes, true); offset += 2;
  view.setUint16(offset, splatRes, true); offset += 2;
  view.setUint16(offset, terrainEntries.length, true); offset += 2;
  view.setUint16(offset, splatEntries.length, true); offset += 2;
  view.setUint32(offset, settingsBytes.byteLength, true); offset += 4;
  view.setUint16(offset, treeEntries.length, true); offset += 2;

  // Settings JSON
  u8.set(settingsBytes, offset);
  offset += settingsBytes.byteLength;

  // Terrain chunks
  for (const [key, heights] of terrainEntries) {
    const { cx, cz } = parseChunkKey(key);
    view.setInt16(offset, cx, true); offset += 2;
    view.setInt16(offset, cz, true); offset += 2;
    u8.set(new Uint8Array(heights.buffer, heights.byteOffset, heights.byteLength), offset);
    offset += heightsBytesPerChunk;
  }

  // Splat chunks (v3: dual splatmaps — data0 + data1 per chunk)
  for (const [key, entry] of splatEntries) {
    const { cx, cz } = parseChunkKey(key);
    view.setInt16(offset, cx, true); offset += 2;
    view.setInt16(offset, cz, true); offset += 2;
    u8.set(entry.data0, offset);
    offset += splatBytesPerBuf;
    u8.set(entry.data1, offset);
    offset += splatBytesPerBuf;
  }

  // Tree chunks
  for (const [key, trees] of treeEntries) {
    const { cx, cz } = parseChunkKey(key);
    view.setInt16(offset, cx, true); offset += 2;
    view.setInt16(offset, cz, true); offset += 2;
    view.setUint16(offset, trees.length, true); offset += 2;
    for (const t of trees) {
      view.setFloat32(offset, t.x, true); offset += 4;
      view.setFloat32(offset, t.z, true); offset += 4;
      view.setFloat32(offset, t.rotY, true); offset += 4;
      view.setFloat32(offset, t.scale, true); offset += 4;
      view.setUint16(offset, t.slotIdx, true); offset += 2;
    }
  }

  return buffer;
}

/**
 * Deserialize a .v2terrain ArrayBuffer back into terrain + splat + settings.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{ settings: object, terrainChunks: Map<string, Float32Array>, splatChunks: Map<string, Uint8Array>, worldSize: number, chunkSize: number, dataResolution: number, splatResolution: number }}
 */
export function deserializeProject(buffer) {
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  let offset = 0;

  // Magic check
  const magic = String.fromCharCode(
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
  );
  if (magic !== MAGIC) throw new Error(`Invalid file: expected magic "${MAGIC}", got "${magic}"`);
  offset = 4;

  const version = view.getUint16(offset, true); offset += 2;
  if (version > VERSION) {
    console.warn(`File version ${version} is newer than supported ${VERSION}; loading may fail.`);
  }

  const worldSize = view.getFloat32(offset, true); offset += 4;
  const chunkSize = view.getFloat32(offset, true); offset += 4;
  const dataResolution = view.getUint16(offset, true); offset += 2;
  const splatResolution = view.getUint16(offset, true); offset += 2;
  const terrainChunkCount = view.getUint16(offset, true); offset += 2;
  const splatChunkCount = view.getUint16(offset, true); offset += 2;
  const settingsLength = view.getUint32(offset, true); offset += 4;
  const treeChunkCount = version >= 2 ? view.getUint16(offset, true) : 0;
  if (version >= 2) offset += 2;

  // Settings JSON
  const settingsJson = new TextDecoder().decode(u8.slice(offset, offset + settingsLength));
  const settings = JSON.parse(settingsJson);
  offset += settingsLength;

  // Terrain chunks
  const perAxis = dataResolution + 1;
  const heightsPerChunk = perAxis * perAxis;
  const heightsBytesPerChunk = heightsPerChunk * 4;
  const terrainChunks = new Map();
  for (let i = 0; i < terrainChunkCount; i++) {
    const cx = view.getInt16(offset, true); offset += 2;
    const cz = view.getInt16(offset, true); offset += 2;
    const heights = new Float32Array(heightsPerChunk);
    heights.set(new Float32Array(buffer.slice(offset, offset + heightsBytesPerChunk)));
    offset += heightsBytesPerChunk;
    terrainChunks.set(`${cx},${cz}`, heights);
  }

  // Splat chunks — v3 saves dual buffers (data0 + data1); v2 saves single buffer (= data0)
  const splatBytesPerBuf = splatResolution * splatResolution * 4;
  const splatChunks = new Map();
  for (let i = 0; i < splatChunkCount; i++) {
    const cx = view.getInt16(offset, true); offset += 2;
    const cz = view.getInt16(offset, true); offset += 2;
    const d0 = new Uint8Array(splatBytesPerBuf);
    d0.set(u8.slice(offset, offset + splatBytesPerBuf));
    offset += splatBytesPerBuf;
    let d1;
    if (version >= 3) {
      d1 = new Uint8Array(splatBytesPerBuf);
      d1.set(u8.slice(offset, offset + splatBytesPerBuf));
      offset += splatBytesPerBuf;
    } else {
      d1 = new Uint8Array(splatBytesPerBuf);
    }
    splatChunks.set(`${cx},${cz}`, { d0, d1 });
  }

  // Tree chunks (version ≥ 2)
  const treeChunks = new Map();
  for (let i = 0; i < treeChunkCount; i++) {
    const cx = view.getInt16(offset, true); offset += 2;
    const cz = view.getInt16(offset, true); offset += 2;
    const instanceCount = view.getUint16(offset, true); offset += 2;
    const trees = [];
    for (let j = 0; j < instanceCount; j++) {
      const x = view.getFloat32(offset, true); offset += 4;
      const z = view.getFloat32(offset, true); offset += 4;
      const rotY = view.getFloat32(offset, true); offset += 4;
      const scale = view.getFloat32(offset, true); offset += 4;
      const slotIdx = view.getUint16(offset, true); offset += 2;
      trees.push({ x, z, y: 0, rotY, scale, slotIdx });
    }
    treeChunks.set(`${cx},${cz}`, trees);
  }

  return { settings, terrainChunks, splatChunks, treeChunks, worldSize, chunkSize, dataResolution, splatResolution };
}

/** Download a Blob as a file via invisible anchor click. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 100);
}

/** Open a file picker and resolve with the chosen File (or null on cancel). */
export function openFilePicker(accept = ".v2terrain") {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Extract the JSON-safe subset of toolState we want to persist.
 * Excludes transient UI state, keeps paint config, surface, light, etc.
 */
function extractSerializableSettings(toolState) {
  return {
    terrainSurface: toolState.terrainSurface,
    textureSlots: { ...toolState.textureSlots },
    paint: {
      activeLayer: toolState.paint.activeLayer,
      layerSlotIds: [...toolState.paint.layerSlotIds],
      noiseMask: toolState.paint.noiseMask,
      noiseScale: toolState.paint.noiseScale,
      noiseOctaves: toolState.paint.noiseOctaves,
      noiseEdgeOnly: toolState.paint.noiseEdgeOnly,
      heightBlend: toolState.paint.heightBlend,
      heightContrast: toolState.paint.heightContrast,
    },
    autoCliffEnabled: toolState.autoCliffEnabled,
    autoCliff: { ...toolState.autoCliff },
    light: { ...toolState.light },
    skyMode: toolState.skyMode,
    physicalSky: { ...toolState.physicalSky },
    lensFlare: { ...toolState.lensFlare },
    csm: { ...toolState.csm },
    fog: {
      height: { ...toolState.fog.height },
      distance: { ...toolState.fog.distance },
    },
    playSpawn: { ...toolState.playSpawn },
    groundTsl: JSON.parse(JSON.stringify(toolState.groundTsl)),
    meadowTsl: JSON.parse(JSON.stringify(toolState.meadowTsl)),
    tslGroundUi: { ...toolState.tslGroundUi },
    treePaint: { ...toolState.treePaint },
    treeLod: { ...toolState.treeLod },
    foliageLod: { ...toolState.foliageLod },
    treeSlots: toolState.treeSlots.map((s) => ({ ...s, foliage: { ...s.foliage } })),
    grass: { ...toolState.grass },
    cliffs: { ...toolState.cliffs },
    cliffInstances: toolState._cliffExportData?.() ?? null,
    props: { ...toolState.props },
    propSlots: toolState.propSlots.map((s) => ({ name: s.name })),
    propInstances: toolState._propExportData?.() ?? null,
    road: { ...toolState.road },
    roads: toolState._roadExportData?.() ?? null,
    river: { ...toolState.river },
    rivers: toolState._riverExportData?.() ?? null,
    spline: { ...toolState.spline },
    splinePath: toolState._splineExportData?.() ?? null,
    water: { ...toolState.water },
    waterBodies: toolState._waterExportData?.() ?? null,
    waterfall: { ...toolState.waterfall },
    waterfallItems: toolState._waterfallExportData?.() ?? null,
    decal: { ...toolState.decal },
    decals: toolState._decalExportData?.() ?? null,
    barrier: { ...toolState.barrier },
    barrierChunks: toolState._barrierExportData?.() ?? null,
    hole: { ...toolState.hole },
    holeChunks: toolState._holeExportData?.() ?? null,
    ambientFx: { ...toolState.ambientFx },
    ambientFxEmitters: toolState._ambientFxExportData?.() ?? null,
    fleur: { ...toolState.fleur, colorA: { ...toolState.fleur.colorA }, colorB: { ...toolState.fleur.colorB } },
    fleurPositions: toolState._fleurExportData?.() ?? null,
    fleurInteraction: {
      interactRadius: toolState.fleur.interactRadius,
      interactStrength: toolState.fleur.interactStrength,
      interactGain: toolState.fleur.interactGain,
      windAmp: toolState.fleur.windAmp,
      windSpeed: toolState.fleur.windSpeed,
    },
  };
}

/**
 * Apply loaded settings back onto a live toolState (shallow merge per section).
 */
export function applySettings(toolState, settings) {
  if (!settings) return;
  if (settings.terrainSurface) toolState.terrainSurface = settings.terrainSurface;
  if (settings.textureSlots) Object.assign(toolState.textureSlots, settings.textureSlots);
  if (settings.paint) {
    if (settings.paint.activeLayer != null) toolState.paint.activeLayer = settings.paint.activeLayer;
    if (settings.paint.layerSlotIds) toolState.paint.layerSlotIds = settings.paint.layerSlotIds;
    if (settings.paint.noiseMask != null) toolState.paint.noiseMask = settings.paint.noiseMask;
    if (settings.paint.noiseScale != null) toolState.paint.noiseScale = settings.paint.noiseScale;
    if (settings.paint.noiseOctaves != null) toolState.paint.noiseOctaves = settings.paint.noiseOctaves;
    if (settings.paint.noiseEdgeOnly != null) toolState.paint.noiseEdgeOnly = settings.paint.noiseEdgeOnly;
    if (settings.paint.heightBlend != null) toolState.paint.heightBlend = settings.paint.heightBlend;
    if (settings.paint.heightContrast != null) toolState.paint.heightContrast = settings.paint.heightContrast;
  }
  if (settings.autoCliffEnabled != null) toolState.autoCliffEnabled = settings.autoCliffEnabled;
  if (settings.autoCliff) Object.assign(toolState.autoCliff, settings.autoCliff);
  if (settings.light) Object.assign(toolState.light, settings.light);
  if (settings.skyMode) toolState.skyMode = settings.skyMode;
  if (settings.physicalSky) Object.assign(toolState.physicalSky, settings.physicalSky);
  if (settings.lensFlare) Object.assign(toolState.lensFlare, settings.lensFlare);
  if (settings.csm) Object.assign(toolState.csm, settings.csm);
  if (settings.fog) {
    if (settings.fog.height) Object.assign(toolState.fog.height, settings.fog.height);
    if (settings.fog.distance) Object.assign(toolState.fog.distance, settings.fog.distance);
  }
  if (settings.playSpawn) Object.assign(toolState.playSpawn, settings.playSpawn);
  if (settings.groundTsl) Object.assign(toolState.groundTsl, JSON.parse(JSON.stringify(settings.groundTsl)));
  if (settings.meadowTsl) Object.assign(toolState.meadowTsl, JSON.parse(JSON.stringify(settings.meadowTsl)));
  if (settings.tslGroundUi) Object.assign(toolState.tslGroundUi, settings.tslGroundUi);
  if (settings.treePaint) Object.assign(toolState.treePaint, settings.treePaint);
  if (settings.treeLod) Object.assign(toolState.treeLod, settings.treeLod);
  if (settings.foliageLod) Object.assign(toolState.foliageLod, settings.foliageLod);
  if (settings.treeSlots) {
    for (let i = 0; i < settings.treeSlots.length && i < toolState.treeSlots.length; i++) {
      Object.assign(toolState.treeSlots[i], settings.treeSlots[i]);
    }
  }
  if (settings.grass) Object.assign(toolState.grass, settings.grass);
  if (settings.cliffs) Object.assign(toolState.cliffs, settings.cliffs);
  if (settings.props) Object.assign(toolState.props, settings.props);
  if (settings.road) Object.assign(toolState.road, settings.road);
  if (settings.river) Object.assign(toolState.river, settings.river);
  if (settings.spline) Object.assign(toolState.spline, settings.spline);
  if (settings.water) Object.assign(toolState.water, settings.water);
  if (settings.waterfall) Object.assign(toolState.waterfall, settings.waterfall);
  if (settings.decal) Object.assign(toolState.decal, settings.decal);
  if (settings.barrier) Object.assign(toolState.barrier, settings.barrier);
  if (settings.hole) Object.assign(toolState.hole, settings.hole);
  if (settings.ambientFx) Object.assign(toolState.ambientFx, settings.ambientFx);
  if (settings.fleur) {
    const src = settings.fleur;
    const dst = toolState.fleur;
    for (const k of Object.keys(src)) {
      if (k === "colorA" || k === "colorB") {
        if (src[k]) Object.assign(dst[k], src[k]);
      } else if (k in dst) {
        dst[k] = src[k];
      }
    }
  }
}
