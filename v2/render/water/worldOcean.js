/**
 * worldOcean.js — global map-covering LOD ocean for v2 (additive system).
 *
 * A single world-spanning sea at a fixed level, built from camera-centered
 * CDLOD clipmap rings, shaded by ocean-shader.js, displaced by the GPU-compute
 * Tessendorf FFT (ocean-fft-gpu.js). Islands are simply terrain above sea level.
 *
 * This is NOT the placed water-body tool (waterSystem/lake) — it's environment
 * infrastructure like the sky, toggled per scene. It reads the engine's shared
 * `globalHeightTex` (R = world Y) so it stays in sync with sculpting for free.
 *
 * Usage (main.js):
 *   const worldOcean = createWorldOcean({ renderer, scene, heightTex, terrainSize });
 *   worldOcean.syncParams(toolState.worldOcean);   // enable + look + LOD
 *   worldOcean.setSunDir(sunDir); worldOcean.setEnvMap(scene.environment);
 *   // each frame, before renderer.render:
 *   worldOcean.update(dtSec, appTimeSec, camera);
 */

import * as THREE from "three";
import { createOceanShader } from "../../../ocean-shader.js";
import {
  createOceanFFTGPUSimulation,
  OCEAN_FFT_GPU_DEFAULTS,
} from "../../../ocean-fft-gpu.js";

// ── CDLOD clipmap geometry (square ring grid in the XZ plane, y = 0) ─────────
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

// Every ring is a proper doubling level (cell ×2) so the vertex morph stitches
// every boundary; extra doubling levels are appended until horizonScale × extent.
function buildClipmap({ levels, gridM, baseCell, horizonScale }) {
  const meshes = [];
  const mainOuter = (gridM * baseCell * Math.pow(2, levels - 1)) / 2;
  const targetOuter = mainOuter * Math.max(1, horizonScale);
  let triCount = 0, lastOuterHalf = 0;
  for (let k = 0; k < levels + 16; k++) {
    const outerHalf = (gridM * baseCell * Math.pow(2, k)) / 2;
    const innerHalf = k === 0 ? 0 : outerHalf / 2;
    const geo = buildRingGeometryXZ(gridM, outerHalf, innerHalf);
    triCount += geo.getIndex().count / 3;
    meshes.push(geo);
    lastOuterHalf = outerHalf;
    if (k >= levels - 1 && outerHalf >= targetOuter) break;
  }
  return { geos: meshes, snapStep: baseCell * 2, triCount, reach: lastOuterHalf };
}

/**
 * @param {object} deps
 * @param {THREE.WebGPURenderer} deps.renderer
 * @param {THREE.Scene} deps.scene
 * @param {THREE.Texture} deps.heightTex — R = world Y (engine globalHeightTex)
 * @param {number} deps.terrainSize — config.world.size
 */
export function createWorldOcean({ renderer, scene, heightTex, terrainSize }) {
  const fft = createOceanFFTGPUSimulation({
    renderer,
    ...OCEAN_FFT_GPU_DEFAULTS,
  });
  // NB: the first FFT compute is deferred to the first enabled frame (see update),
  // so no GPU compute runs at construction (renderer may not be ready yet) or
  // while the ocean is disabled.

  const ocean = createOceanShader({
    heightTex,
    terrainSize,
    fft,
    envMap: scene.environment,
  });

  const group = new THREE.Group();
  group.name = "WorldOcean";
  group.visible = false;
  scene.add(group);

  let enabled = false;
  let seaLevel = 0;
  let fftHz = 30;
  let fftAccum = 0;
  let snapStep = 2;
  let lodSig = "";
  let baked = false; // first enabled-frame FFT bake done?

  function rebuildClip(p) {
    const sig = `${p.levels}|${p.gridM}|${p.baseCell}|${p.horizonScale}`;
    if (sig === lodSig && group.children.length) return;
    lodSig = sig;
    for (let i = group.children.length - 1; i >= 0; i--) {
      const m = group.children[i];
      group.remove(m);
      m.geometry.dispose();
    }
    const clip = buildClipmap(p);
    snapStep = clip.snapStep;
    for (const geo of clip.geos) {
      const mesh = new THREE.Mesh(geo, ocean.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      group.add(mesh);
    }
  }

  return {
    group,
    ocean,
    fft,

    setEnabled(v) {
      enabled = !!v;
      group.visible = enabled;
    },
    setSeaLevel(y) {
      seaLevel = y;
    },
    setEnvMap(tex) {
      if (tex) ocean.setEnvMap(tex);
    },
    setSunDir(v) {
      if (v) ocean.uniforms.sunDir.value.copy(v).normalize();
    },

    /** Push a toolState.worldOcean-shaped object (enable + seaLevel + look + LOD). */
    syncParams(p) {
      if (!p) return;
      rebuildClip(p);
      fftHz = p.fftUpdateHz ?? 30;
      ocean.syncParams(p);
      fft.syncParams(p);
      this.setSeaLevel(p.seaLevel ?? 0);
      this.setEnabled(!!p.enabled);
    },

    /** Call each frame before renderer.render. */
    update(dt, elapsed, camera) {
      if (!enabled || group.children.length === 0) return;
      group.position.set(
        Math.round(camera.position.x / snapStep) * snapStep,
        seaLevel,
        Math.round(camera.position.z / snapStep) * snapStep,
      );
      ocean.uniforms.waterY.value = seaLevel;
      ocean.update(dt, elapsed, null);
      if (!baked) {
        // First enabled frame: full bake so the surface isn't flat. (renderer is
        // guaranteed ready here — we're inside the render loop.)
        fft.update(elapsed);
        baked = true;
        fftAccum = 0;
        return;
      }
      fftAccum += dt;
      const interval = 1 / Math.max(1, fftHz);
      if (fftAccum >= interval) {
        fftAccum = Math.min(fftAccum - interval, interval);
        fft.update(elapsed);
      }
    },

    dispose() {
      for (const m of group.children) m.geometry?.dispose();
      scene.remove(group);
      ocean.material.dispose();
      fft.dispose();
    },
  };
}
