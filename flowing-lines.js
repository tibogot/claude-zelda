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
import { uniform, uv, mul, texture, positionWorld, cameraPosition, sub, length, smoothstep, float } from "three/tsl";

// ─── CPU noise for path wobble ───────────────────────────────────────────────
function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function noise2d(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

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
 * @param {number} [options.pathNoise=0] — Realistic: add path wobble (0–4)
 * @param {number} [options.windDirX=0] — Realistic: wind drift X
 * @param {number} [options.windDirZ=0] — Realistic: wind drift Z
 * @param {number} [options.windSpeed=0] — Realistic: wind drift speed
 * @param {number} [options.perLineSpeedVariation=0] — Realistic: 0–0.5
 * @param {number} [options.perLineRadiusVariation=0] — Realistic: 0–0.5
 * @param {number} [options.thicknessVariation=0] — Realistic: 0–1 (thinner at tips)
 * @param {number} [options.depthFadeNear=0] — Realistic: fade start distance (0=off)
 * @param {number} [options.depthFadeFar=0] — Realistic: fade end distance
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
  pathNoise = 0,
  windDirX = 0,
  windDirZ = 0,
  windSpeed = 0,
  perLineSpeedVariation = 0,
  perLineRadiusVariation = 0,
  thicknessVariation = 0,
  depthFadeNear = 0,
  depthFadeFar = 0,
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
  const uDepthFadeNear = uniform(depthFadeNear);
  const uDepthFadeFar = uniform(depthFadeFar);

  const lineMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  const gradTex = texture(gradientTexture, uv());
  let opacityNode = mul(gradTex.a, uOpacity);
  if (depthFadeNear > 0 && depthFadeFar > depthFadeNear) {
    const dist = length(sub(positionWorld, cameraPosition));
    const depthFade = smoothstep(uDepthFadeNear, uDepthFadeFar, dist).oneMinus();
    opacityNode = mul(opacityNode, depthFade);
  }
  lineMaterial.colorNode = mul(gradTex.rgb, uColor);
  lineMaterial.opacityNode = opacityNode;

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
    pathNoise,
    windDirX,
    windDirZ,
    windSpeed,
    perLineSpeedVariation,
    perLineRadiusVariation,
    thicknessVariation,
    depthFadeNear,
    depthFadeFar,
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
    const rndSpeed = 1 + (Math.random() - 0.5) * 2 * perLineSpeedVariation;
    const rndRadius = 1 + (Math.random() - 0.5) * 2 * perLineRadiusVariation;

    linesData.push({
      mesh,
      pos,
      rnda,
      rndb,
      rndc,
      rndd,
      rndSpeed,
      rndRadius,
    });
    group.add(mesh);
  }

  scene.add(group);

  function updateVertex(line, vertIdx, time) {
    const segmentIndex = vertIdx % pointsPerRow;
    const speedMult = line.rndSpeed ?? 1;
    const radiusMult = line.rndRadius ?? 1;
    const t = (time * 1000) / (3000 / (params.animationSpeed * speedMult)) + segmentIndex / 60;

    let x = params.pathRadius * radiusMult * Math.sin(params.pathFrequency * line.rnda * t + 6 * line.rndb);
    let z = params.pathRadius * radiusMult * Math.cos(params.pathFrequency * line.rndc * t + 6 * line.rndd);

    if (params.pathNoise > 0) {
      const n = noise2d(x * 0.08 + time * 0.3, z * 0.08) * 2 - 1;
      const n2 = noise2d(z * 0.06 - time * 0.2, x * 0.06) * 2 - 1;
      x += n * params.pathNoise + n2 * params.pathNoise * 0.5;
      z += n2 * params.pathNoise + n * params.pathNoise * 0.5;
    }

    if (params.windSpeed !== 0) {
      x += params.windDirX * params.windSpeed * time;
      z += params.windDirZ * params.windSpeed * time;
    }

    const terrainY = getTerrainHeight(x, z);

    let thicknessScale = 1;
    if (params.thicknessVariation > 0) {
      const tNorm = segmentIndex / segments;
      thicknessScale = Math.sin(tNorm * Math.PI);
    }

    const waveOffset =
      params.verticalWave *
      thicknessScale *
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
    uDepthFadeNear,
    uDepthFadeFar,
    setParams: (p) => {
      if (p.lineColor != null) uColor.value.copy(new THREE.Color(p.lineColor).convertSRGBToLinear());
      if (p.lineOpacity != null) uOpacity.value = p.lineOpacity;
      if (p.depthFadeNear != null) uDepthFadeNear.value = p.depthFadeNear;
      if (p.depthFadeFar != null) uDepthFadeFar.value = p.depthFadeFar <= 0 ? 9999 : p.depthFadeFar;
    },
  };
}

export default createFlowingLines;
