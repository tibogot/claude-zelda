/**
 * flowing-lines.js — Flowing ribbon lines that follow terrain contours.
 * Vanilla JS / WebGPU TSL port of the original R3F FlowingLines component.
 *
 * Creates smooth, animated flowing ribbons using CPU vertex updates.
 * Each ribbon is a PlaneGeometry whose vertices are updated each frame
 * along a parametric path, with terrain height lookup.
 *
 * Usage:
 *   import { createFlowingLines } from './flowing-lines.js';
 *   const flowing = createFlowingLines({
 *     scene,
 *     getTerrainHeight: (x, z) => sampleHeight(x, z),  // or (x,z) => 0 for flat
 *     lineCount: 8,
 *     lineLength: 12,
 *     segments: 20,
 *   });
 *   // In animation loop:
 *   flowing.update(timer.getElapsed());
 *
 * Key implementation:
 * - PlaneGeometry(length, width, segments, 1) → (segments+1)*2 vertices per ribbon
 * - Top and bottom vertex rows share same X/Z (synchronized path)
 * - Parametric path: x = pathRadius*sin(...), z = pathRadius*cos(...)
 * - Terrain height from getTerrainHeight(x, z) callback
 */
import * as THREE from "three";
import { uniform, uv, mul, texture } from "three/tsl";

// ─── Default params ─────────────────────────────────────────────────────────
const DEFAULTS = {
  enabled: true,
  lineCount: 8,
  lineLength: 12,
  lineWidth: 0.15,
  segments: 20,
  heightOffset: 0.3,
  verticalWave: 0.08,
  animationSpeed: 1,
  pathRadius: 25,
  pathFrequency: 0.8,
  lineColor: "#a8d8ea",
  lineOpacity: 0.7,
  boundaryRadius: 50,
};

function createGradientTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createLinearGradient(0, 0, 64, 0);
  gradient.addColorStop(0.0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.5, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1.0, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 8);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

/**
 * @param {Object} options
 * @param {THREE.Scene} options.scene
 * @param {(x: number, z: number) => number} options.getTerrainHeight — terrain height at (x,z)
 * @param {boolean} [options.enabled=true]
 * @param {number} [options.lineCount=8]
 * @param {number} [options.lineLength=12]
 * @param {number} [options.lineWidth=0.15]
 * @param {number} [options.segments=20]
 * @param {number} [options.heightOffset=0.3]
 * @param {number} [options.verticalWave=0.08]
 * @param {number} [options.animationSpeed=1]
 * @param {number} [options.pathRadius=25]
 * @param {number} [options.pathFrequency=0.8]
 * @param {string} [options.lineColor='#a8d8ea']
 * @param {number} [options.lineOpacity=0.7]
 * @param {number} [options.boundaryRadius=50]
 */
export function createFlowingLines({
  scene,
  getTerrainHeight,
  enabled = DEFAULTS.enabled,
  lineCount = DEFAULTS.lineCount,
  lineLength = DEFAULTS.lineLength,
  lineWidth = DEFAULTS.lineWidth,
  segments = DEFAULTS.segments,
  heightOffset = DEFAULTS.heightOffset,
  verticalWave = DEFAULTS.verticalWave,
  animationSpeed = DEFAULTS.animationSpeed,
  pathRadius = DEFAULTS.pathRadius,
  pathFrequency = DEFAULTS.pathFrequency,
  lineColor = DEFAULTS.lineColor,
  lineOpacity = DEFAULTS.lineOpacity,
  boundaryRadius = DEFAULTS.boundaryRadius,
} = {}) {
  if (!scene || typeof getTerrainHeight !== "function") {
    console.warn("flowing-lines: scene and getTerrainHeight are required");
    return { group: new THREE.Group(), update: () => {} };
  }

  const gradientTexture = createGradientTexture();
  if (!gradientTexture) {
    console.warn("flowing-lines: could not create gradient texture");
    return { group: new THREE.Group(), update: () => {} };
  }

  const uColor = uniform(new THREE.Color(lineColor).convertSRGBToLinear());
  const uOpacity = uniform(lineOpacity);

  const lineMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  const gradTex = texture(gradientTexture, uv());
  lineMaterial.colorNode = mul(gradTex.rgb, uColor);
  lineMaterial.opacityNode = mul(gradTex.a, uOpacity);

  const group = new THREE.Group();
  const linesData = [];

  // Runtime-tweakable params (read from this each frame)
  const params = {
    enabled,
    heightOffset,
    verticalWave,
    animationSpeed,
    pathRadius,
    pathFrequency,
  };

  const pointsPerRow = segments + 1;

  for (let i = 0; i < lineCount; i++) {
    const geometry = new THREE.PlaneGeometry(lineLength, lineWidth, segments, 1);
    const mesh = new THREE.Mesh(geometry, lineMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 999;

    const pos = geometry.getAttribute("position");
    const rnda = Math.random();
    const rndb = Math.random();
    const rndc = Math.random();
    const rndd = Math.random();

    linesData.push({
      mesh,
      pos,
      rnda,
      rndb,
      rndc,
      rndd,
    });
    group.add(mesh);
  }

  scene.add(group);

  function updateVertex(line, vertIdx, time) {
    const segmentIndex = vertIdx % pointsPerRow;
    const t = (time * 1000) / (3000 / params.animationSpeed) + segmentIndex / 60;

    const x = params.pathRadius * Math.sin(params.pathFrequency * line.rnda * t + 6 * line.rndb);
    const z = params.pathRadius * Math.cos(params.pathFrequency * line.rndc * t + 6 * line.rndd);

    const terrainY = getTerrainHeight(x, z);
    const waveOffset =
      params.verticalWave *
      (vertIdx > segments ? 1 : -1) *
      Math.cos((segmentIndex - segments / 2) / 8);
    const y = terrainY + params.heightOffset + waveOffset;

    line.pos.setXYZ(vertIdx, x, y, -z);
  }

  function update(time) {
    if (!params.enabled || linesData.length === 0) return;

    for (let lineIdx = 0; lineIdx < linesData.length; lineIdx++) {
      const line = linesData[lineIdx];
      const vertexCount = line.pos.count;

      for (let i = 0; i < vertexCount; i++) {
        updateVertex(line, i, time);
      }

      line.pos.needsUpdate = true;
      line.mesh.geometry.computeBoundingSphere();
      line.mesh.geometry.computeBoundingBox();
    }
  }

  // Initial position
  update(0);

  return {
    group,
    linesData,
    params,
    update,
    uColor,
    uOpacity,
    setParams: (p) => {
      if (p.lineColor != null) uColor.value.copy(new THREE.Color(p.lineColor).convertSRGBToLinear());
      if (p.lineOpacity != null) uOpacity.value = p.lineOpacity;
    },
  };
}

export default createFlowingLines;
