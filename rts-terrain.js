/**
 * RTS Lab terrain — organic FBM hills with slope-clamped ramps (grass / cliff PBR).
 * Exposes `createRtsTerrain()` → { mesh, getHeight, uniforms, dispose }.
 */
import * as THREE from "three/webgpu";
import {
  float,
  int,
  vec2,
  vec3,
  uniform,
  uv,
  positionWorld,
  normalWorld,
  positionGeometry,
  normalGeometry,
  texture,
  normalMap,
  color,
  abs,
  max,
  min,
  add,
  mul,
  sub,
  pow,
  dot,
  sin,
  fract,
  smoothstep,
  clamp,
  normalize,
} from "three/tsl";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

/** Default RTS map extent (6× the original 240-unit lab). */
export const RTS_MAP_SIZE = 1440;

/** Keys that affect the baked heightfield (mesh rebuild required). */
export const SHAPE_KEYS = [
  "fbmScale",
  "octaves",
  "persistence",
  "lacunarity",
  "heightScale",
  "flatness",
  "macroBlend",
  "macroFreq",
  "macroOctaves",
  "peakBias",
  "ridgeBoost",
  "ridgeFreq",
  "ridgeOctaves",
  "floorY",
  "mountainReliefMul",
  "heroRidgeAmp",
  "heroRidgeR",
  "heroRidgeCx",
  "heroRidgeCz",
  "rampMaxGrade",
  "slopeClampPasses",
];

/** Keys synced to GPU uniforms (live, no rebuild). */
export const SURF_KEYS = [
  "grassScale",
  "cliffScale",
  "albedoMul",
  "cliffLow",
  "cliffHigh",
  "cliffPow",
  "grassJitter",
  "dispStrength",
  "dispCliffMul",
  "dispUvScale",
  "normalGrass",
  "normalCliff",
  "envIntensity",
  "metalness",
];

export const RTS_TERRAIN_DEFAULTS = {
  // ── Heightfield (organic hills + ramp clamp) ──
  fbmScale: 0.0036,
  octaves: 5,
  persistence: 0.5,
  lacunarity: 1.9,
  heightScale: 46,
  flatness: 2.55,
  macroBlend: 0.22,
  macroFreq: 0.5,
  macroOctaves: 4,
  peakBias: 0.05,
  ridgeBoost: 0.016,
  ridgeFreq: 1.1,
  ridgeOctaves: 2,
  floorY: -8,
  mountainReliefMul: 0.24,
  heroRidgeAmp: 18,
  heroRidgeR: 155000,
  heroRidgeCx: 72,
  heroRidgeCz: -96,
  rampMaxGrade: 0.4,
  slopeClampPasses: 12,
  // ── Surface / shading (live uniforms) ──
  grassScale: 0.016,
  cliffScale: 0.0042,
  albedoMul: 0.96,
  cliffLow: 0.22,
  cliffHigh: 0.48,
  cliffPow: 1.15,
  grassJitter: 0.08,
  dispStrength: 0.85,
  dispCliffMul: 1.1,
  dispUvScale: 38,
  normalGrass: 1.05,
  normalCliff: 1.15,
  envIntensity: 0.25,
  metalness: 0.02,
};

const RTS_PEAKS = [
  { cx: -220, cz: 140, r: 520000, a: 32 },
  { cx: 260, cz: -170, r: 560000, a: 36 },
  { cx: 0, cz: 40, r: 440000, a: 22 },
  { cx: -140, cz: -220, r: 400000, a: 18 },
  { cx: 180, cz: 200, r: 420000, a: 20 },
  { cx: -320, cz: -80, r: 380000, a: 16 },
  { cx: 300, cz: 280, r: 400000, a: 18 },
];

function pickShape(params) {
  const out = {};
  for (const k of SHAPE_KEYS) out[k] = params[k] ?? RTS_TERRAIN_DEFAULTS[k];
  return out;
}

function pickSurf(params) {
  const out = {};
  for (const k of SURF_KEYS) out[k] = params[k] ?? RTS_TERRAIN_DEFAULTS[k];
  return out;
}

function createSeededRandom(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fbm(perlin, x, y, z, octaves, persistence, lacunarity) {
  let total = 0;
  let frequency = 1;
  let amplitude = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += perlin.noise(x * frequency, y * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / Math.max(1e-6, maxValue);
}

export async function createRtsTerrain(
  size = RTS_MAP_SIZE,
  segments = 288,
  params = {},
) {
  const ts = pickShape({ ...RTS_TERRAIN_DEFAULTS, ...params });
  const surf = pickSurf({ ...RTS_TERRAIN_DEFAULTS, ...params });
  const perlin = new ImprovedNoise(createSeededRandom(4242));

  function mountainRelief(x, z) {
    let sum = 0;
    for (const p of RTS_PEAKS) {
      const dx = x - p.cx;
      const dz = z - p.cz;
      sum += Math.exp(-(dx * dx + dz * dz) / p.r) * p.a;
    }
    const ridge = Math.exp(
      -((x - ts.heroRidgeCx) * (x - ts.heroRidgeCx) +
        (z - ts.heroRidgeCz) * (z - ts.heroRidgeCz)) /
        ts.heroRidgeR,
    ) * ts.heroRidgeAmp;
    return (sum + ridge) * ts.mountainReliefMul;
  }

  function rawHeight(x, z) {
    const nx = x * ts.fbmScale;
    const nz = z * ts.fbmScale;
    const oct = THREE.MathUtils.clamp(Math.round(ts.octaves), 1, 14);
    const mOct = THREE.MathUtils.clamp(Math.round(ts.macroOctaves), 1, 8);
    const rOct = THREE.MathUtils.clamp(Math.round(ts.ridgeOctaves), 1, 8);
    const mb = THREE.MathUtils.clamp(ts.macroBlend, 0, 1);
    const mf = ts.macroFreq;
    const macro =
      fbm(perlin, nx * mf + 1.8, 0, nz * mf - 1.2, mOct, ts.persistence, ts.lacunarity) *
        2 -
      1;
    let h = fbm(perlin, nx, 0, nz, oct, ts.persistence, ts.lacunarity);
    let t = h * 0.5 + 0.5;
    const flat = Math.max(0.15, ts.flatness);
    t = Math.pow(Math.min(1, Math.max(1e-7, t)), 1 / flat);
    h = t * 2 - 1;
    h = h * (1 - mb) + macro * mb;
    const rid =
      fbm(
        perlin,
        nx * ts.ridgeFreq + 0.2,
        2.4,
        nz * ts.ridgeFreq - 0.3,
        rOct,
        ts.persistence * 0.96,
        ts.lacunarity,
      ) *
        2 -
      1;
    h += Math.max(0, rid) * ts.ridgeBoost;
    const pk = Math.max(0, h);
    h += pk * pk * Math.max(0, ts.peakBias);
    const y = h * ts.heightScale + mountainRelief(x, z);
    return Math.max(ts.floorY, y);
  }

  const seg = THREE.MathUtils.clamp(Math.round(segments), 32, 512);
  const vertsX = seg + 1;
  const heights = new Float32Array(vertsX * vertsX);
  const half = size * 0.5;

  function gridIdx(xi, zi) {
    return zi * vertsX + xi;
  }

  function gridWorld(xi, zi) {
    return {
      x: -half + (xi / seg) * size,
      z: -half + (zi / seg) * size,
    };
  }

  for (let zi = 0; zi <= seg; zi++) {
    for (let xi = 0; xi <= seg; xi++) {
      const { x, z } = gridWorld(xi, zi);
      heights[gridIdx(xi, zi)] = rawHeight(x, z);
    }
  }

  const edgeDist = size / seg;
  const maxDelta = edgeDist * THREE.MathUtils.clamp(ts.rampMaxGrade, 0.15, 0.85);
  const passes = THREE.MathUtils.clamp(Math.round(ts.slopeClampPasses), 0, 24);

  for (let pass = 0; pass < passes; pass++) {
    for (let zi = 0; zi <= seg; zi++) {
      for (let xi = 0; xi <= seg; xi++) {
        const i = gridIdx(xi, zi);
        let h = heights[i];
        if (xi < seg) {
          const j = gridIdx(xi + 1, zi);
          const dh = heights[j] - h;
          if (dh > maxDelta) heights[j] = h + maxDelta;
          else if (dh < -maxDelta) heights[j] = h - maxDelta;
        }
        if (zi < seg) {
          const j = gridIdx(xi, zi + 1);
          const dh = heights[j] - h;
          if (dh > maxDelta) heights[j] = h + maxDelta;
          else if (dh < -maxDelta) heights[j] = h - maxDelta;
        }
      }
    }
  }

  const flattenPads = (params.flattenPads || []).map((pad) => ({
    x: pad.x,
    z: pad.z,
    radius: pad.radius ?? 34,
    height: pad.height ?? rawHeight(pad.x, pad.z),
  }));

  function applyFlattenPadsToGrid() {
    for (const pad of flattenPads) {
      for (let zi = 0; zi <= seg; zi++) {
        for (let xi = 0; xi <= seg; xi++) {
          const { x, z } = gridWorld(xi, zi);
          const dx = x - pad.x;
          const dz = z - pad.z;
          const r = pad.radius;
          const d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          const d = Math.sqrt(d2);
          const t = d / r;
          const w = 1 - t * t * (3 - 2 * t);
          const i = gridIdx(xi, zi);
          heights[i] = heights[i] * (1 - w) + pad.height * w;
        }
      }
    }
  }

  applyFlattenPadsToGrid();

  function sampleHeightGrid(x, z) {
    const u = ((x + half) / size) * seg;
    const v = ((z + half) / size) * seg;
    const xi = Math.floor(u);
    const zi = Math.floor(v);
    const fx = u - xi;
    const fz = v - zi;
    const x0 = THREE.MathUtils.clamp(xi, 0, seg);
    const x1 = THREE.MathUtils.clamp(xi + 1, 0, seg);
    const z0 = THREE.MathUtils.clamp(zi, 0, seg);
    const z1 = THREE.MathUtils.clamp(zi + 1, 0, seg);
    const h00 = heights[gridIdx(x0, z0)];
    const h10 = heights[gridIdx(x1, z0)];
    const h01 = heights[gridIdx(x0, z1)];
    const h11 = heights[gridIdx(x1, z1)];
    const hx0 = h00 * (1 - fx) + h10 * fx;
    const hx1 = h01 * (1 - fx) + h11 * fx;
    return hx0 * (1 - fz) + hx1 * fz;
  }

  function getHeight(x, z) {
    return sampleHeightGrid(x, z);
  }

  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let zi = 0; zi <= seg; zi++) {
    for (let xi = 0; xi <= seg; xi++) {
      const i = gridIdx(xi, zi);
      const vi = zi * vertsX + xi;
      pos.setY(vi, heights[i]);
    }
  }
  geo.computeVertexNormals();

  const ARRAY_RES = 1024;
  function buildLayerArray(maps, srgb) {
    const count = maps.length;
    const stride = ARRAY_RES * ARRAY_RES * 4;
    const data = new Uint8Array(stride * count);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = ARRAY_RES;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    for (let i = 0; i < count; i++) {
      const img = maps[i]?.image;
      if (!img) continue;
      ctx.clearRect(0, 0, ARRAY_RES, ARRAY_RES);
      ctx.drawImage(img, 0, 0, ARRAY_RES, ARRAY_RES);
      data.set(ctx.getImageData(0, 0, ARRAY_RES, ARRAY_RES).data, i * stride);
    }
    const tex = new THREE.DataArrayTexture(data, ARRAY_RES, ARRAY_RES, count);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearMipMapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }

  const baseUrl = import.meta.url;
  const loader = new THREE.TextureLoader();
  const loadTex = (rel, srgb) =>
    new Promise((resolve, reject) => {
      loader.load(
        new URL(rel, baseUrl).href,
        (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.colorSpace = srgb
            ? THREE.SRGBColorSpace
            : THREE.LinearSRGBColorSpace;
          t.minFilter = THREE.LinearMipmapLinearFilter;
          t.magFilter = THREE.LinearFilter;
          t.anisotropy = 4;
          resolve(t);
        },
        undefined,
        reject,
      );
    });

  const P = "./textures/pbr_materials/";
  let material;
  const uniforms = {};
  const allTextures = [];
  try {
    const setJpg = async (dir, base, withDisp) => {
      const m = {
        color: await loadTex(`${P}${dir}/${base}_Color.jpg`, true),
        normal: await loadTex(`${P}${dir}/${base}_NormalGL.jpg`, false),
        roughness: await loadTex(`${P}${dir}/${base}_Roughness.jpg`, false),
        ao: await loadTex(`${P}${dir}/${base}_AmbientOcclusion.jpg`, false),
      };
      if (withDisp) {
        m.displacement = await loadTex(
          `${P}${dir}/${base}_Displacement.jpg`,
          false,
        );
      }
      return m;
    };

    const grass = await setJpg("Grass005", "Grass005_1K-JPG", false);
    const cliff = {
      color: await loadTex(
        `${P}cliff_rocks_07_2k/cliff_rocks_07_basecolor_2k.png`,
        true,
      ),
      normal: await loadTex(
        `${P}cliff_rocks_07_2k/cliff_rocks_07_normal_gl_2k.png`,
        false,
      ),
      roughness: await loadTex(
        `${P}cliff_rocks_07_2k/cliff_rocks_07_roughness_2k.png`,
        false,
      ),
      ao: await loadTex(
        `${P}cliff_rocks_07_2k/cliff_rocks_07_ambientocclusion_2k.png`,
        false,
      ),
      displacement: await loadTex(
        `${P}cliff_rocks_07_2k/cliff_rocks_07_height_2k.png`,
        false,
      ),
    };

    const layers = [grass, cliff];
    for (const m of layers) allTextures.push(...Object.values(m));

    const colorArray = buildLayerArray(
      layers.map((l) => l.color),
      true,
    );
    const normalArray = buildLayerArray(
      layers.map((l) => l.normal),
      false,
    );
    const roughArray = buildLayerArray(
      layers.map((l) => l.roughness),
      false,
    );
    const aoArray = buildLayerArray(
      layers.map((l) => l.ao),
      false,
    );
    const dispArray = buildLayerArray([null, cliff.displacement], false);
    allTextures.push(colorArray, normalArray, roughArray, aoArray, dispArray);

    const L_GRASS = int(0);
    const L_CLIFF = int(1);

    const uGrassScale = uniform(surf.grassScale);
    const uCliffScale = uniform(surf.cliffScale);
    const uAlbedoMul = uniform(surf.albedoMul);
    const uCliffLow = uniform(surf.cliffLow);
    const uCliffHigh = uniform(surf.cliffHigh);
    const uCliffPow = uniform(surf.cliffPow);
    const uGrassJitter = uniform(surf.grassJitter);
    const uDispStrength = uniform(surf.dispStrength);
    const uDispCliffMul = uniform(surf.dispCliffMul);
    const uDispUvScale = uniform(surf.dispUvScale);
    const uNormalGrass = uniform(surf.normalGrass);
    const uNormalCliff = uniform(surf.normalCliff);
    const uEnvIntensity = uniform(surf.envIntensity);
    const uMetalness = uniform(surf.metalness);

    Object.assign(uniforms, {
      grassScale: uGrassScale,
      cliffScale: uCliffScale,
      albedoMul: uAlbedoMul,
      cliffLow: uCliffLow,
      cliffHigh: uCliffHigh,
      cliffPow: uCliffPow,
      grassJitter: uGrassJitter,
      dispStrength: uDispStrength,
      dispCliffMul: uDispCliffMul,
      dispUvScale: uDispUvScale,
      normalGrass: uNormalGrass,
      normalCliff: uNormalCliff,
      envIntensity: uEnvIntensity,
      metalness: uMetalness,
    });

    const layerWeights = () => {
      const slope = sub(float(1), abs(normalWorld.y));
      const jitter = fract(
        mul(sin(dot(positionWorld.xz, vec2(127.1, 311.7))), 43758.5453),
      );
      const wCliff = pow(smoothstep(uCliffLow, uCliffHigh, slope), uCliffPow);
      const wGrass = mul(
        sub(float(1), wCliff),
        add(sub(float(1), uGrassJitter), mul(jitter, uGrassJitter)),
      );
      const wSum = add(wGrass, wCliff);
      return vec2(wGrass, wCliff).div(max(wSum, float(0.001)));
    };

    const layerRGB = (arr, layer, sc) =>
      texture(arr, mul(positionWorld.xz, sc)).depth(layer).rgb;
    const layerR = (arr, layer, sc) =>
      texture(arr, mul(positionWorld.xz, sc)).depth(layer).r;

    const gRGB = () => layerRGB(colorArray, L_GRASS, uGrassScale);
    const cRGB = () => layerRGB(colorArray, L_CLIFF, uCliffScale);
    const gR = () => layerR(roughArray, L_GRASS, uGrassScale);
    const cR = () => layerR(roughArray, L_CLIFF, uCliffScale);
    const gAo = () => layerR(aoArray, L_GRASS, uGrassScale);
    const cAo = () => layerR(aoArray, L_CLIFF, uCliffScale);

    material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
    material.envMapIntensity = 0;
    material.colorNode = (() => {
      const lw = layerWeights();
      return mul(add(mul(gRGB(), lw.x), mul(cRGB(), lw.y)), uAlbedoMul);
    })();
    material.roughnessNode = (() => {
      const lw = layerWeights();
      return clamp(
        add(mul(gR(), lw.x), mul(cR(), lw.y)),
        float(0.04),
        float(1),
      );
    })();
    material.aoNode = (() => {
      const lw = layerWeights();
      return clamp(
        add(mul(gAo(), lw.x), mul(cAo(), lw.y)),
        float(0.25),
        float(1),
      );
    })();
    material.normalNode = (() => {
      const lw = layerWeights();
      const nG = normalMap(
        texture(normalArray, mul(positionWorld.xz, uGrassScale)).depth(L_GRASS),
        vec2(uNormalGrass, uNormalGrass),
      );
      const nC = normalMap(
        texture(normalArray, mul(positionWorld.xz, uCliffScale)).depth(L_CLIFF),
        vec2(uNormalCliff, uNormalCliff),
      );
      return normalize(add(mul(nG, lw.x), mul(nC, lw.y)));
    })();
    material.positionNode = (() => {
      const tu = mul(uv(), uDispUvScale);
      const dC = texture(dispArray, tu).depth(L_CLIFF).x;
      const slopeD = sub(float(1), abs(normalGeometry.y));
      const wCliffD = pow(smoothstep(uCliffLow, uCliffHigh, slopeD), uCliffPow);
      const lift = mul(mul(sub(dC, float(0.5)), wCliffD), uDispCliffMul);
      return positionGeometry.add(
        normalGeometry.normalize().mul(mul(lift, uDispStrength)),
      );
    })();
    material.metalnessNode = uMetalness;
    material.color = new THREE.Color(0xffffff);
  } catch (err) {
    console.warn("[rts-terrain] PBR textures failed to load — matte fallback.", err);
    material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
    material.colorNode = color(0x4a5c3a);
    material.roughnessNode = float(0.985);
    material.metalnessNode = float(0);
  }

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "RtsTerrain";
  mesh.receiveShadow = true;

  function dispose() {
    geo.dispose();
    material.dispose();
    for (const t of allTextures) t.dispose?.();
  }

  return { mesh, getHeight, uniforms, dispose, shape: ts, surf };
}

/** Push all surface uniform values from a params object. */
export function syncRtsTerrainUniforms(uniforms, params = {}) {
  if (!uniforms) return;
  const surf = pickSurf({ ...RTS_TERRAIN_DEFAULTS, ...params });
  for (const k of SURF_KEYS) {
    if (uniforms[k]) uniforms[k].value = surf[k];
  }
}
