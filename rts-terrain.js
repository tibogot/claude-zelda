/**
 * RTS Lab terrain — self-contained PBR heightfield for the RTS battlefield.
 * Exposes `createRtsTerrain()` → { mesh, getHeight, uniforms, dispose }.
 *
 * `params` merges heightfield (shape) + surface (surf) knobs. Shape changes
 * require rebuilding the mesh; surf uniforms can be synced live from rts-lab.
 */
import * as THREE from "three/webgpu";
import {
  float,
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

/** Default RTS map extent (3× the original 240-unit lab). */
export const RTS_MAP_SIZE = 720;

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
];

/** Keys synced to GPU uniforms (live, no rebuild). */
export const SURF_KEYS = [
  "grassScale",
  "rockScale",
  "snowScale",
  "albedoMul",
  "snowStart",
  "snowEnd",
  "cliffLow",
  "cliffHigh",
  "cliffPow",
  "rockHeightStart",
  "rockHeightEnd",
  "rockHeightAmt",
  "grassJitter",
  "dispStrength",
  "dispRockMul",
  "dispSnowMul",
  "dispSnowMin",
  "dispUvScale",
  "normalGrass",
  "normalRock",
  "normalSnow",
  "envIntensity",
  "metalness",
];

export const RTS_TERRAIN_DEFAULTS = {
  // ── Heightfield ──
  fbmScale: 0.0035,
  octaves: 5,
  persistence: 0.48,
  lacunarity: 1.92,
  heightScale: 58,
  flatness: 3.4,
  macroBlend: 0.28,
  macroFreq: 0.48,
  macroOctaves: 4,
  peakBias: 0.08,
  ridgeBoost: 0.028,
  ridgeFreq: 1.15,
  ridgeOctaves: 2,
  floorY: -12,
  mountainReliefMul: 0.36,
  heroRidgeAmp: 26,
  heroRidgeR: 145000,
  heroRidgeCx: 36,
  heroRidgeCz: -48,
  // ── Surface / shading (live uniforms) ──
  grassScale: 0.016,
  rockScale: 0.003,
  snowScale: 0.018,
  albedoMul: 0.94,
  snowStart: 52,
  snowEnd: 68,
  cliffLow: 0.14,
  cliffHigh: 0.38,
  cliffPow: 0.7,
  rockHeightStart: 26,
  rockHeightEnd: 44,
  rockHeightAmt: 0.1,
  grassJitter: 0.1,
  dispStrength: 0.6,
  dispRockMul: 1.0,
  dispSnowMul: 0.35,
  dispSnowMin: 62,
  dispUvScale: 42,
  normalGrass: 1.05,
  normalRock: 1.0,
  normalSnow: 1.0,
  envIntensity: 0.25,
  metalness: 0.02,
};

const RTS_PEAKS = [
  { cx: -110, cz: 70, r: 250000, a: 44 },
  { cx: 130, cz: -85, r: 270000, a: 48 },
  { cx: 0, cz: 30, r: 200000, a: 32 },
  { cx: -60, cz: -120, r: 180000, a: 28 },
  { cx: 85, cz: 110, r: 190000, a: 30 },
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

  const flattenPads = (params.flattenPads || []).map((pad) => ({
    x: pad.x,
    z: pad.z,
    radius: pad.radius ?? 34,
    height: pad.height ?? rawHeight(pad.x, pad.z),
  }));

  function applyFlattenPads(x, z, y) {
    for (const pad of flattenPads) {
      const dx = x - pad.x;
      const dz = z - pad.z;
      const r = pad.radius;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      const d = Math.sqrt(d2);
      const t = d / r;
      const w = 1 - t * t * (3 - 2 * t);
      y = y * (1 - w) + pad.height * w;
    }
    return y;
  }

  function getHeight(x, z) {
    return applyFlattenPads(x, z, rawHeight(x, z));
  }

  const seg = THREE.MathUtils.clamp(Math.round(segments), 32, 512);
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, getHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const triRGB = (tex, sc) => () => {
    const w = pow(abs(normalWorld), vec3(3, 3, 3));
    const ws = max(add(add(w.x, w.y), w.z), float(1e-4));
    const tw = w.div(ws);
    const ax = texture(tex, mul(vec2(positionWorld.y, positionWorld.z), sc)).rgb;
    const ay = texture(tex, mul(positionWorld.xz, sc)).rgb;
    const az = texture(tex, mul(positionWorld.xy, sc)).rgb;
    return add(add(mul(ax, tw.x), mul(ay, tw.y)), mul(az, tw.z));
  };
  const triR = (tex, sc) => () => {
    const w = pow(abs(normalWorld), vec3(3, 3, 3));
    const ws = max(add(add(w.x, w.y), w.z), float(1e-4));
    const tw = w.div(ws);
    const ax = texture(tex, mul(vec2(positionWorld.y, positionWorld.z), sc)).x;
    const ay = texture(tex, mul(positionWorld.xz, sc)).x;
    const az = texture(tex, mul(positionWorld.xy, sc)).x;
    return add(add(mul(ax, tw.x), mul(ay, tw.y)), mul(az, tw.z));
  };

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
    const set = async (dir, base, withDisp) => {
      const m = {
        color: await loadTex(`${P}${dir}/${base}_Color.jpg`, true),
        normal: await loadTex(`${P}${dir}/${base}_NormalGL.jpg`, false),
        roughness: await loadTex(`${P}${dir}/${base}_Roughness.jpg`, false),
        ao: await loadTex(`${P}${dir}/${base}_AmbientOcclusion.jpg`, false),
      };
      if (withDisp)
        m.displacement = await loadTex(
          `${P}${dir}/${base}_Displacement.jpg`,
          false,
        );
      return m;
    };
    const grass = await set("Grass005", "Grass005_1K-JPG", false);
    const rock = await set("Rock028", "Rock028_2K-JPG", true);
    const snow = await set("Snow010A", "Snow010A_1K-JPG", true);
    for (const m of [grass, rock, snow]) allTextures.push(...Object.values(m));

    const uGrassScale = uniform(surf.grassScale);
    const uRockScale = uniform(surf.rockScale);
    const uSnowScale = uniform(surf.snowScale);
    const uAlbedoMul = uniform(surf.albedoMul);
    const uSnowStart = uniform(surf.snowStart);
    const uSnowEnd = uniform(surf.snowEnd);
    const uCliffLow = uniform(surf.cliffLow);
    const uCliffHigh = uniform(surf.cliffHigh);
    const uCliffPow = uniform(surf.cliffPow);
    const uRockHStart = uniform(surf.rockHeightStart);
    const uRockHEnd = uniform(surf.rockHeightEnd);
    const uRockHAmt = uniform(surf.rockHeightAmt);
    const uGrassJitter = uniform(surf.grassJitter);
    const uDispStrength = uniform(surf.dispStrength);
    const uDispRockMul = uniform(surf.dispRockMul);
    const uDispSnowMul = uniform(surf.dispSnowMul);
    const uDispSnowMin = uniform(surf.dispSnowMin);
    const uDispUvScale = uniform(surf.dispUvScale);
    const uNormalGrass = uniform(surf.normalGrass);
    const uNormalRock = uniform(surf.normalRock);
    const uNormalSnow = uniform(surf.normalSnow);
    const uEnvIntensity = uniform(surf.envIntensity);
    const uMetalness = uniform(surf.metalness);

    Object.assign(uniforms, {
      grassScale: uGrassScale,
      rockScale: uRockScale,
      snowScale: uSnowScale,
      albedoMul: uAlbedoMul,
      snowStart: uSnowStart,
      snowEnd: uSnowEnd,
      cliffLow: uCliffLow,
      cliffHigh: uCliffHigh,
      cliffPow: uCliffPow,
      rockHeightStart: uRockHStart,
      rockHeightEnd: uRockHEnd,
      rockHeightAmt: uRockHAmt,
      grassJitter: uGrassJitter,
      dispStrength: uDispStrength,
      dispRockMul: uDispRockMul,
      dispSnowMul: uDispSnowMul,
      dispSnowMin: uDispSnowMin,
      dispUvScale: uDispUvScale,
      normalGrass: uNormalGrass,
      normalRock: uNormalRock,
      normalSnow: uNormalSnow,
      envIntensity: uEnvIntensity,
      metalness: uMetalness,
    });

    const layerWeights = () => {
      const yW = positionWorld.y;
      const slope = sub(float(1), abs(normalWorld.y));
      const jitter = fract(
        mul(sin(dot(positionWorld.xz, vec2(127.1, 311.7))), 43758.5453),
      );
      const wSnow = smoothstep(uSnowStart, uSnowEnd, yW);
      const wCliff = pow(smoothstep(uCliffLow, uCliffHigh, slope), uCliffPow);
      const wHeightRock = mul(
        smoothstep(uRockHStart, uRockHEnd, yW),
        uRockHAmt,
      );
      const wRock = min(
        add(mul(wCliff, sub(float(1), mul(wSnow, float(0.93)))), wHeightRock),
        float(1),
      );
      const wRock2 = mul(wRock, sub(float(1), mul(wSnow, float(0.8))));
      const wGrassFlat = mul(
        sub(float(1), wCliff),
        sub(float(1), min(wSnow, float(0.98))),
      );
      const wGrass = mul(
        mul(wGrassFlat, sub(float(1), mul(wRock2, float(0.25)))),
        add(sub(float(1), uGrassJitter), mul(jitter, uGrassJitter)),
      );
      const wSum = add(add(wGrass, wRock2), wSnow);
      return vec3(wGrass, wRock2, wSnow).div(max(wSum, float(0.001)));
    };

    const gRGB = triRGB(grass.color, uGrassScale);
    const rRGB = triRGB(rock.color, uRockScale);
    const sRGB = triRGB(snow.color, uSnowScale);
    const gR = triR(grass.roughness, uGrassScale);
    const rR = triR(rock.roughness, uRockScale);
    const sR = triR(snow.roughness, uSnowScale);
    const gAo = triR(grass.ao, uGrassScale);
    const rAo = triR(rock.ao, uRockScale);
    const sAo = triR(snow.ao, uSnowScale);

    material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
    material.colorNode = (() => {
      const lw = layerWeights();
      return mul(
        add(add(mul(gRGB(), lw.x), mul(rRGB(), lw.y)), mul(sRGB(), lw.z)),
        uAlbedoMul,
      );
    })();
    material.roughnessNode = (() => {
      const lw = layerWeights();
      return clamp(
        add(add(mul(gR(), lw.x), mul(rR(), lw.y)), mul(sR(), lw.z)),
        float(0.04),
        float(1),
      );
    })();
    material.aoNode = (() => {
      const lw = layerWeights();
      return clamp(
        add(add(mul(gAo(), lw.x), mul(rAo(), lw.y)), mul(sAo(), lw.z)),
        float(0.25),
        float(1),
      );
    })();
    material.normalNode = (() => {
      const lw = layerWeights();
      const nG = normalMap(
        texture(grass.normal, mul(positionWorld.xz, uGrassScale)),
        vec2(uNormalGrass, uNormalGrass),
      );
      const nR = normalMap(
        texture(rock.normal, mul(positionWorld.xz, uRockScale)),
        vec2(uNormalRock, uNormalRock),
      );
      const nS = normalMap(
        texture(snow.normal, mul(positionWorld.xz, uSnowScale)),
        vec2(uNormalSnow, uNormalSnow),
      );
      return normalize(add(add(mul(nG, lw.x), mul(nR, lw.y)), mul(nS, lw.z)));
    })();
    material.positionNode = (() => {
      const tu = mul(uv(), uDispUvScale);
      const dR = texture(rock.displacement, tu).x;
      const dS = texture(snow.displacement, tu).x;
      const h = positionGeometry.y;
      const slopeD = sub(float(1), abs(normalGeometry.y));
      const wCliffD = pow(smoothstep(uCliffLow, uCliffHigh, slopeD), uCliffPow);
      const wSnowDisp = smoothstep(uDispSnowMin, add(uDispSnowMin, float(10)), h);
      const wRockDisp = max(
        wCliffD,
        mul(smoothstep(uRockHStart, uRockHEnd, h), float(0.45)),
      );
      const wR = mul(wRockDisp, sub(float(1), mul(wSnowDisp, float(0.9))));
      const blended = add(
        mul(mul(dR, wR), uDispRockMul),
        mul(mul(dS, wSnowDisp), uDispSnowMul),
      );
      const active = max(wR, wSnowDisp);
      const lift = sub(blended, mul(float(0.5), active));
      return positionGeometry.add(
        normalGeometry.normalize().mul(mul(lift, uDispStrength)),
      );
    })();
    material.metalnessNode = uMetalness;
    material.envMapIntensity = surf.envIntensity;
    material.color = new THREE.Color(0xffffff);
  } catch (err) {
    console.warn("[rts-terrain] PBR textures failed to load — matte fallback.", err);
    material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
    material.colorNode = color(0x4a3728);
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
