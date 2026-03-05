/**
 * Folio Showcase — Terrain
 * Small deformable terrain for showcasing foliage, trees, etc.
 * Importable: use createTerrain(scene, options) in main game.
 *
 * @param {THREE.Scene} scene
 * @param {{ terrainSize?: number, resolution?: number, heightScale?: number, seed?: number, groundColor?: string | number, groundNoiseColor?: string | number, groundNoiseStrength?: number, groundNoiseScale?: number }} options
 * @returns {{ mesh, sampleHeight, heightData, heightTex, terrainSize, resolution, dispose, groundColorUniform, groundNoiseStrengthUniform, groundNoiseScaleUniform }}
 */
import * as THREE from "three";
import { uniform, Fn, positionWorld, mul, add, float, mix } from "three/tsl";
import { noise12 } from "../tsl-utils.js";

function cpuHash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function cpuNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = cpuHash(ix, iy);
  const b = cpuHash(ix + 1, iy);
  const c = cpuHash(ix, iy + 1);
  const d = cpuHash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, octaves = 4) {
  let val = 0;
  let amp = 1;
  let freq = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    val += cpuNoise(x * freq, y * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / total;
}

export function createTerrain(scene, options = {}) {
  const terrainSize = options.terrainSize ?? 80;
  const resolution = options.resolution ?? 128;
  const heightScale = options.heightScale ?? 8;
  const seed = options.seed ?? 1;

  const heightData = new Float32Array(resolution * resolution * 4);
  const heightTex = new THREE.DataTexture(
    heightData,
    resolution,
    resolution,
    THREE.RGBAFormat,
    THREE.FloatType
  );
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;

  function generateHeightmap() {
    const invRes = 1 / resolution;
    const half = terrainSize * 0.5;
    const freq = 0.02 + (seed * 0.001);
    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const wx = (x * invRes - 0.5) * terrainSize;
        const wz = (y * invRes - 0.5) * terrainSize;
        const nx = wx * freq;
        const nz = wz * freq;
        const roll = fbm(nx, nz);
        const ridge = 1 - Math.abs(fbm(nx * 0.8, nz * 0.8));
        const h = (roll * 0.6 + ridge * ridge * 0.4) * heightScale;
        const idx = (y * resolution + x) * 4;
        heightData[idx] = h;
        heightData[idx + 1] = h;
        heightData[idx + 2] = h;
        heightData[idx + 3] = 1;
      }
    }
    heightTex.needsUpdate = true;
  }
  generateHeightmap();

  function sampleHeight(wx, wz) {
    const u = (wx / terrainSize + 0.5) * resolution;
    const v = (wz / terrainSize + 0.5) * resolution;
    const ix = Math.max(0, Math.min(resolution - 2, Math.floor(u)));
    const iy = Math.max(0, Math.min(resolution - 2, Math.floor(v)));
    const fx = u - ix;
    const fy = v - iy;
    const h00 = heightData[(iy * resolution + ix) * 4];
    const h10 = heightData[(iy * resolution + ix + 1) * 4];
    const h01 = heightData[((iy + 1) * resolution + ix) * 4];
    const h11 = heightData[((iy + 1) * resolution + ix + 1) * 4];
    return h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
  }

  const geometry = new THREE.PlaneGeometry(terrainSize, terrainSize, resolution - 1, resolution - 1);
  geometry.rotateX(-Math.PI / 2);
  const posAttr = geometry.attributes.position;
  const invRes = 1 / resolution;
  for (let i = 0; i < posAttr.count; i++) {
    const wx = posAttr.getX(i);
    const wz = posAttr.getZ(i);
    const u = (wx / terrainSize + 0.5) * resolution;
    const v = (wz / terrainSize + 0.5) * resolution;
    const ix = Math.max(0, Math.min(resolution - 2, Math.floor(u)));
    const iy = Math.max(0, Math.min(resolution - 2, Math.floor(v)));
    const fx = u - ix;
    const fy = v - iy;
    const h00 = heightData[(iy * resolution + ix) * 4];
    const h10 = heightData[(iy * resolution + ix + 1) * 4];
    const h01 = heightData[((iy + 1) * resolution + ix) * 4];
    const h11 = heightData[((iy + 1) * resolution + ix + 1) * 4];
    const h = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
    posAttr.setY(i, h);
  }
  geometry.computeVertexNormals();

  const groundColorUniform = uniform(
    new THREE.Color(options.groundColor ?? 0x4a8c30)
  );
  const groundNoiseColorUniform = uniform(
    new THREE.Color(options.groundNoiseColor ?? 0x6b5d3a)
  );
  const groundNoiseStrengthUniform = uniform(options.groundNoiseStrength ?? 0.15);
  const groundNoiseScaleUniform = uniform(options.groundNoiseScale ?? 0.04);
  const material = new THREE.MeshStandardNodeMaterial({
    colorNode: Fn(() => {
      const baseCol = groundColorUniform;
      const noiseCol = groundNoiseColorUniform;
      const wp = positionWorld;
      const n1 = noise12(mul(wp.xz, groundNoiseScaleUniform));
      const n2 = noise12(mul(wp.xz, mul(groundNoiseScaleUniform, 2.5)));
      const n3 = noise12(mul(wp.xz, mul(groundNoiseScaleUniform, 6)));
      const combined = add(n1, mul(n2, 0.5), mul(n3, 0.25)).mul(0.57);
      const blend = mul(combined, groundNoiseStrengthUniform);
      return mix(baseCol, noiseCol, blend);
    })(),
    roughness: 0.9,
    metalness: 0.05,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = "FolioShowcaseTerrain";
  scene.add(mesh);

  function dispose() {
    geometry.dispose();
    material.dispose();
    heightTex.dispose();
    scene.remove(mesh);
  }

  return {
    mesh,
    sampleHeight,
    heightData,
    heightTex,
    terrainSize,
    resolution,
    dispose,
    groundColorUniform,
    groundNoiseColorUniform,
    groundNoiseStrengthUniform,
    groundNoiseScaleUniform,
  };
}
