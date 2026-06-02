/**
 * PBR showcase terrain — ported from `clouds_terrain_1600-superjet-optimized.html`.
 * (Named `daynight-terrain` to avoid the unrelated, pre-existing `terrain.js`.)
 *
 * A heightfield (Perlin FBM + ridged detail + a few hero mountain bumps) with a
 * triplanar `MeshStandardNodeMaterial` that blends three PBR material sets
 * (grass / rock / snow) by world height and slope. Rock/snow also drive a small
 * displacement on the vertex position for extra relief.
 *
 * Self-contained: bakes its own height noise, loads its own textures, exposes
 * `getHeight(x,z)` for placing props. Falls back to a matte material if the
 * texture load fails. `createTerrain()` is async (resolves once textures load).
 */
import * as THREE from "three/webgpu";
import {
  float, vec2, vec3, uniform, uv,
  positionWorld, normalWorld, positionGeometry, normalGeometry,
  texture, normalMap, color,
  abs, max, min, add, mul, sub, pow, dot, sin, fract, smoothstep, clamp, normalize,
} from "three/tsl";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

const DEFAULT_SHAPE = {
  fbmScale: 0.0042, octaves: 5, persistence: 0.48, lacunarity: 1.92,
  heightScale: 235, flatness: 3.4, macroBlend: 0.28, macroFreq: 0.48,
  macroOctaves: 4, peakBias: 0.1, ridgeBoost: 0.038, ridgeFreq: 1.15,
  ridgeOctaves: 2, floorY: -145, mountainReliefMul: 0.34,
  heroRidgeAmp: 68, heroRidgeR: 320000,
  // Island falloff — sinks the outer margin below sea level (coastline + hides
  // the square edge). Large landmass = coast sits near the border.
  coastStart: 0.7, coastEnd: 1.0, sinkDepth: 240, coastNoise: 0.16,
};

function createSeededRandom(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fbm(perlin, x, y, z, octaves, persistence, lacunarity) {
  let total = 0, frequency = 1, amplitude = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += perlin.noise(x * frequency, y * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / Math.max(1e-6, maxValue);
}

function smoothstepJS(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / Math.max(1e-6, e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Scattered islands out in the surrounding water (Gaussian bumps placed near the
// coast margin so they poke above the sunk seabed as separate islands).
const ISLANDS = [
  { cx: 740, cz: 120, r: 7000, a: 250 },
  { cx: -720, cz: -200, r: 6000, a: 225 },
  { cx: 180, cz: 760, r: 5500, a: 210 },
  { cx: -300, cz: 750, r: 6000, a: 230 },
  { cx: 620, cz: -640, r: 5000, a: 200 },
];

export async function createTerrain({ size = 1600, segments = 320, shape = {} } = {}) {
  const ts = { ...DEFAULT_SHAPE, ...shape };
  const perlin = new ImprovedNoise(createSeededRandom(4242));

  function mountainRelief(x, z) {
    const peaks = [
      { cx: -320, cz: 240, r: 280000, a: 175 },
      { cx: 380, cz: -300, r: 310000, a: 220 },
      { cx: 40, cz: -120, r: 240000, a: 145 },
    ];
    let sum = 0;
    for (const p of peaks) {
      const dx = x - p.cx, dz = z - p.cz;
      sum += Math.exp(-(dx * dx + dz * dz) / p.r) * p.a;
    }
    const ridge = Math.exp(
      -((x - 120) * (x - 120) + (z + 160) * (z + 160)) / ts.heroRidgeR,
    ) * ts.heroRidgeAmp;
    return (sum + ridge) * ts.mountainReliefMul;
  }

  function getHeight(x, z) {
    const nx = x * ts.fbmScale, nz = z * ts.fbmScale;
    const oct = THREE.MathUtils.clamp(Math.round(ts.octaves), 1, 14);
    const mOct = THREE.MathUtils.clamp(Math.round(ts.macroOctaves), 1, 8);
    const rOct = THREE.MathUtils.clamp(Math.round(ts.ridgeOctaves), 1, 8);
    const mb = THREE.MathUtils.clamp(ts.macroBlend, 0, 1);
    const mf = ts.macroFreq;
    const macro = fbm(perlin, nx * mf + 1.8, 0, nz * mf - 1.2, mOct, ts.persistence, ts.lacunarity) * 2 - 1;
    let h = fbm(perlin, nx, 0, nz, oct, ts.persistence, ts.lacunarity);
    let t = h * 0.5 + 0.5;
    const flat = Math.max(0.15, ts.flatness);
    t = Math.pow(Math.min(1, Math.max(1e-7, t)), 1 / flat);
    h = t * 2 - 1;
    h = h * (1 - mb) + macro * mb;
    const rid = fbm(perlin, nx * ts.ridgeFreq + 0.2, 2.4, nz * ts.ridgeFreq - 0.3, rOct, ts.persistence * 0.96, ts.lacunarity) * 2 - 1;
    h += Math.max(0, rid) * ts.ridgeBoost;
    const pk = Math.max(0, h);
    h += pk * pk * Math.max(0, ts.peakBias);
    let y = h * ts.heightScale + mountainRelief(x, z);

    // Island falloff: sink the outer margin below sea level so the land meets the
    // water at an irregular coastline and the square edge is hidden underwater.
    const half = size * 0.5;
    const coastN = fbm(perlin, x * 0.004 + 11, 5.1, z * 0.004 - 7, 3, 0.5, 2.0) * ts.coastNoise;
    const edge = Math.max(Math.abs(x), Math.abs(z)) / half + coastN;
    const sink = smoothstepJS(ts.coastStart, ts.coastEnd, edge);
    y -= sink * ts.sinkDepth;

    // Scattered islands out in the surrounding water.
    for (const is of ISLANDS) {
      const dx = x - is.cx, dz = z - is.cz;
      y += Math.exp(-(dx * dx + dz * dz) / is.r) * is.a;
    }

    return Math.max(ts.floorY, y);
  }

  // ── Geometry ──────────────────────────────────────────────────────────────
  const seg = THREE.MathUtils.clamp(Math.round(segments), 32, 512);
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, getHeight(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  // ── Triplanar samplers ────────────────────────────────────────────────────
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

  // ── Material ──────────────────────────────────────────────────────────────
  const baseUrl = import.meta.url;
  const loader = new THREE.TextureLoader();
  const loadTex = (rel, srgb) =>
    new Promise((resolve, reject) => {
      loader.load(new URL(rel, baseUrl).href, (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = 4;
        resolve(t);
      }, undefined, reject);
    });

  const P = "./textures/pbr_materials/";
  let material;
  const allTextures = [];
  try {
    const set = async (dir, base, withDisp) => {
      const m = {
        color: await loadTex(`${P}${dir}/${base}_Color.jpg`, true),
        normal: await loadTex(`${P}${dir}/${base}_NormalGL.jpg`, false),
        roughness: await loadTex(`${P}${dir}/${base}_Roughness.jpg`, false),
        ao: await loadTex(`${P}${dir}/${base}_AmbientOcclusion.jpg`, false),
      };
      if (withDisp) m.displacement = await loadTex(`${P}${dir}/${base}_Displacement.jpg`, false);
      return m;
    };
    const grass = await set("Grass005", "Grass005_1K-JPG", false);
    const rock = await set("Rock028", "Rock028_2K-JPG", true);
    const snow = await set("Snow010A", "Snow010A_1K-JPG", true);
    for (const m of [grass, rock, snow]) allTextures.push(...Object.values(m));

    const uGrassScale = uniform(0.016);
    const uRockScale = uniform(0.003);
    const uSnowScale = uniform(0.018);
    const uDispStrength = uniform(11);
    const uAlbedoMul = uniform(0.94);

    const layerWeights = () => {
      const yW = positionWorld.y;
      const slope = sub(float(1), abs(normalWorld.y));
      const jitter = fract(mul(sin(dot(positionWorld.xz, vec2(127.1, 311.7))), 43758.5453));
      const wSnow = smoothstep(float(158), float(268), yW);

      // Steep faces → cliff rock dominates; starts earlier and reaches full rock sooner.
      const wCliff = pow(smoothstep(float(0.12), float(0.36), slope), float(0.7));
      const wHeightRock = mul(smoothstep(float(48), float(158), yW), float(0.12));
      const wRock = min(
        add(mul(wCliff, sub(float(1), mul(wSnow, float(0.93)))), wHeightRock),
        float(1),
      );
      const wRock2 = mul(wRock, sub(float(1), mul(wSnow, float(0.8))));

      // Grass only on flatter ground — cliffs zero it out instead of leaking through normalization.
      const wGrassFlat = mul(sub(float(1), wCliff), sub(float(1), min(wSnow, float(0.98))));
      const wGrass = mul(
        mul(wGrassFlat, sub(float(1), mul(wRock2, float(0.25)))),
        add(float(0.9), mul(jitter, float(0.1))),
      );

      const wSum = add(add(wGrass, wRock2), wSnow);
      return vec3(wGrass, wRock2, wSnow).div(max(wSum, float(0.001)));
    };

    const gRGB = triRGB(grass.color, uGrassScale), rRGB = triRGB(rock.color, uRockScale), sRGB = triRGB(snow.color, uSnowScale);
    const gR = triR(grass.roughness, uGrassScale), rR = triR(rock.roughness, uRockScale), sR = triR(snow.roughness, uSnowScale);
    const gAo = triR(grass.ao, uGrassScale), rAo = triR(rock.ao, uRockScale), sAo = triR(snow.ao, uSnowScale);

    material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
    material.colorNode = (() => {
      const lw = layerWeights();
      return mul(add(add(mul(gRGB(), lw.x), mul(rRGB(), lw.y)), mul(sRGB(), lw.z)), uAlbedoMul);
    })();
    material.roughnessNode = (() => {
      const lw = layerWeights();
      return clamp(add(add(mul(gR(), lw.x), mul(rR(), lw.y)), mul(sR(), lw.z)), float(0.04), float(1));
    })();
    material.aoNode = (() => {
      const lw = layerWeights();
      return clamp(add(add(mul(gAo(), lw.x), mul(rAo(), lw.y)), mul(sAo(), lw.z)), float(0.25), float(1));
    })();
    material.normalNode = (() => {
      const lw = layerWeights();
      const nG = normalMap(texture(grass.normal, mul(positionWorld.xz, uGrassScale)), vec2(1.05, 1.05));
      const nR = normalMap(texture(rock.normal, mul(positionWorld.xz, uRockScale)), vec2(1, 1));
      const nS = normalMap(texture(snow.normal, mul(positionWorld.xz, uSnowScale)), vec2(1, 1));
      return normalize(add(add(mul(nG, lw.x), mul(nR, lw.y)), mul(nS, lw.z)));
    })();
    material.positionNode = (() => {
      const tu = mul(uv(), float(42));
      const dR = texture(rock.displacement, tu).x;
      const dS = texture(snow.displacement, tu).x;
      const h = positionGeometry.y;
      const slopeD = sub(float(1), abs(normalGeometry.y));
      const wCliffD = pow(smoothstep(float(0.12), float(0.36), slopeD), float(0.7));
      const wS = smoothstep(float(168), float(262), h);
      const wR = mul(
        max(wCliffD, mul(smoothstep(float(12), float(148), h), float(0.55))),
        sub(float(1), mul(wS, float(0.94))),
      );
      const blended = add(mul(dR, wR), mul(dS, wS));
      const lift = sub(blended, mul(float(0.5), add(wR, wS)));
      return positionGeometry.add(normalGeometry.normalize().mul(mul(lift, uDispStrength)));
    })();
    material.metalnessNode = float(0.02);
    material.envMapIntensity = 0.25;
    material.color = new THREE.Color(0xffffff);
  } catch (err) {
    console.warn("[daynight-terrain] PBR textures failed to load — matte fallback.", err);
    material = new THREE.MeshStandardNodeMaterial({ side: THREE.FrontSide });
    material.colorNode = color(0x4a3728);
    material.roughnessNode = float(0.985);
    material.metalnessNode = float(0);
  }

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = "PBRTerrain";
  mesh.receiveShadow = true;

  function dispose() {
    geo.dispose();
    material.dispose();
    for (const t of allTextures) t.dispose?.();
  }

  return { mesh, getHeight, dispose };
}
