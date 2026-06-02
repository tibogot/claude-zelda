/**
 * Ocean wrapper for the daynight-sky lab.
 *
 * Reuses the SHARED, UNEDITED ocean modules (`ocean-shader.js`,
 * `ocean-fft-gpu.js`) — importing them does not modify them, so v2/editor keeps
 * working. This module just ports the host-side assembly that ocean-editor.html
 * does (CDLOD clipmap geometry + GPU-FFT sim + heightmap), and exposes a small
 * API so the page can drop an ocean in with one call.
 *
 *   const ocean = await createOcean({ renderer, terrainSize, getHeight, seaLevel });
 *   scene.add(ocean.group);
 *   // each frame:
 *   ocean.update(dt, elapsed, camera, sunDir);
 *   // reflections:
 *   ocean.setEnvMap(skyPmremTexture);
 *
 * Reflections are PMREM-environment based, so the ocean is just a mesh group in
 * the scene — it composites into the page's sceneRT and gets cloud depth
 * occlusion for free. Feed it a PMREM of the sky via `setEnvMap`.
 */
import * as THREE from "three/webgpu";
import { createOceanShader, OCEAN_DEFAULTS } from "./ocean-shader.js";
import { createOceanFFTGPUSimulation, OCEAN_FFT_GPU_DEFAULTS } from "./ocean-fft-gpu.js";

// ─── Clipmap geometry (ported verbatim from ocean-editor.html) ──────────────
function buildRingGeometryXZ(seg, outerHalf, innerHalf) {
  const N = seg + 1;
  const cell = (outerHalf * 2) / seg;
  const positions = new Float32Array(N * N * 3);
  const aCell = new Float32Array(N * N);
  const aOuter = new Float32Array(N * N);
  let p = 0, q = 0;
  for (let j = 0; j < N; j++) {
    const z = -outerHalf + j * cell;
    for (let i = 0; i < N; i++) {
      positions[p] = -outerHalf + i * cell;
      positions[p + 1] = 0;
      positions[p + 2] = z;
      aCell[q] = cell;
      aOuter[q] = outerHalf;
      p += 3; q += 1;
    }
  }
  const idx = [];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const cx = -outerHalf + (i + 0.5) * cell;
      const cz = -outerHalf + (j + 0.5) * cell;
      if (Math.max(Math.abs(cx), Math.abs(cz)) < innerHalf - 1e-3) continue;
      const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aCell", new THREE.BufferAttribute(aCell, 1));
  geo.setAttribute("aOuterHalf", new THREE.BufferAttribute(aOuter, 1));
  geo.setIndex(idx);
  return geo;
}

function buildClipmapOcean({ levels, gridM, baseCell, horizonScale, material }) {
  const group = new THREE.Group();
  const meshes = [];
  const mainOuter = (gridM * baseCell * Math.pow(2, levels - 1)) / 2;
  const targetOuter = mainOuter * Math.max(1, horizonScale);
  for (let k = 0; k < levels + 16; k++) {
    const outerHalf = (gridM * baseCell * Math.pow(2, k)) / 2;
    const innerHalf = k === 0 ? 0 : outerHalf / 2;
    const geo = buildRingGeometryXZ(gridM, outerHalf, innerHalf);
    const mesh = new THREE.Mesh(geo, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    group.add(mesh);
    meshes.push(mesh);
    if (k >= levels - 1 && outerHalf >= targetOuter) break;
  }
  return { group, meshes, snapStep: baseCell * 2 };
}

/**
 * @param {object} opts
 * @param {THREE.WebGPURenderer} opts.renderer
 * @param {number} opts.terrainSize        — world size of the terrain (e.g. 1600)
 * @param {(x:number,z:number)=>number} opts.getHeight — seabed world Y sampler
 * @param {number} [opts.seaLevel]         — water surface Y
 * @param {number} [opts.heightRes]        — seabed height texture resolution
 */
export async function createOcean({
  renderer, terrainSize = 1600, getHeight, seaLevel = -20,
  heightRes = 256, seed = 1337, windAngleDeg = 35,
  levels = 7, gridM = 64, baseCell = 1.0, horizonScale = 6.0, fftUpdateHz = 30,
}) {
  // ── Seabed height texture (R = seabed world Y) for depth / shore shading ──
  const data = new Float32Array(heightRes * heightRes);
  for (let j = 0; j < heightRes; j++) {
    const wz = (j / (heightRes - 1) - 0.5) * terrainSize;
    for (let i = 0; i < heightRes; i++) {
      const wx = (i / (heightRes - 1) - 0.5) * terrainSize;
      data[j * heightRes + i] = getHeight(wx, wz);
    }
  }
  const heightTex = new THREE.DataTexture(
    data, heightRes, heightRes, THREE.RedFormat, THREE.FloatType,
  );
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.flipY = false;
  heightTex.needsUpdate = true;

  // ── GPU-FFT wave simulation ───────────────────────────────────────────────
  const fftGpu = createOceanFFTGPUSimulation({
    renderer, seed, windAngleDeg, ...OCEAN_FFT_GPU_DEFAULTS,
  });
  fftGpu.update(0); // bake frame 0 so the surface isn't flat before the first tick

  // ── Ocean material + clipmap ──────────────────────────────────────────────
  const ocean = createOceanShader({
    heightTex, terrainSize, fft: fftGpu, envMap: null,
  });
  ocean.syncParams({ ...OCEAN_DEFAULTS });

  const clip = buildClipmapOcean({ levels, gridM, baseCell, horizonScale, material: ocean.material });
  const group = clip.group;
  group.name = "DayNightOcean";
  group.position.y = seaLevel;

  let _waterY = seaLevel;
  let _fftAccum = 0;
  let _fftEnabled = true;

  function update(dt, elapsed, camera, sunDir) {
    if (!group.visible) return;
    // Recenter the clipmap on the camera, snapped to the finest 2-cell grid.
    const step = clip.snapStep;
    group.position.set(
      Math.round(camera.position.x / step) * step,
      _waterY,
      Math.round(camera.position.z / step) * step,
    );
    ocean.uniforms.waterY.value = _waterY;
    if (sunDir) ocean.uniforms.sunDir.value.copy(sunDir).normalize();
    ocean.update(dt, elapsed, null);

    if (_fftEnabled) {
      _fftAccum += dt;
      const interval = 1 / Math.max(1, fftUpdateHz);
      if (_fftAccum >= interval) {
        _fftAccum = Math.min(_fftAccum - interval, interval);
        fftGpu.update(elapsed);
      }
    }
  }

  return {
    group,
    uniforms: ocean.uniforms,
    update,
    setEnvMap: (tex) => ocean.setEnvMap(tex),
    setWaterY: (y) => { _waterY = y; group.position.y = y; },
    setVisible: (v) => { group.visible = v; },
    syncParams: (p) => ocean.syncParams(p),
    dispose() {
      for (const m of clip.meshes) m.geometry.dispose();
      ocean.material.dispose();
      heightTex.dispose();
    },
  };
}
