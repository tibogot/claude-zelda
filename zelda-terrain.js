/**
 * Zelda BOTW-style terrain: height curve (TTG), ridged peaks (BOTW),
 * mountain band, explicit peaks. Showcase + game.
 */
import * as THREE from "three";
import {
  Fn,
  uniform,
  vec3,
  vec4,
  uv,
  mix,
  smoothstep,
  mul,
  add,
  sub,
  max,
  length,
  texture,
  normalMap,
  float,
  positionLocal,
  modelWorldMatrix,
  cameraPosition,
  normalLocal,
} from "three/tsl";
import { noise12 } from "./tsl-utils.js";

const PI = Math.PI;

function srgbToLinear(hex) {
  const c = new THREE.Color(hex);
  c.convertSRGBToLinear();
  return c;
}

function cpuHash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function cpuNoise(x, y) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const a = cpuHash(ix, iy),
    b = cpuHash(ix + 1, iy),
    c = cpuHash(ix, iy + 1),
    d = cpuHash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbmNoise(x, y, octaves) {
  let val = 0,
    amp = 1,
    freq = 1,
    total = 0;
  for (let i = 0; i < octaves; i++) {
    val += cpuNoise(x * freq, y * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / total;
}

function ridgedFbm(x, y, octaves) {
  let val = 0,
    amp = 1,
    freq = 1,
    total = 0;
  for (let i = 0; i < octaves; i++) {
    let n = cpuNoise(x * freq, y * freq);
    n = 1 - Math.abs(n);
    n = n * n;
    val += n * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / total;
}

/** TTG/Unity style: power > 1 = flat valleys + sharp peaks (BOTW-like). */
function applyHeightCurve(t, power) {
  if (power <= 0 || Math.abs(power - 1) < 0.01) return t;
  return Math.pow(Math.max(0, Math.min(1, t)), power);
}

/**
 * Generate BOTW-style heightmap (smooth, no terraces).
 * Heights in world units; treat 1 unit = 1 m for scale (e.g. 1200 = 1200 m peak).
 * Ridged noise in mountains, height curve, mountain band, explicit peaks, two basins.
 */
function generateHeightmap(PARAMS, terrainSize, terrainRes) {
  const data = new Float32Array(terrainRes * terrainRes);
  const mx = PARAMS.mountainStrength ?? 0.8;
  const flat = PARAMS.fieldFlatten ?? 0.5;
  const H = PARAMS.terrainHeight ?? 380;
  const heightCurvePower = PARAMS.heightCurvePower ?? 1.8;
  const ridgedInMountains = PARAMS.ridgedInMountains ?? 0.9;
  const mountainHeightMultiplier = PARAMS.mountainHeightMultiplier ?? 2.2;
  const mountainMaskThreshold = PARAMS.mountainMaskThreshold ?? 0.18;
  const mountainBandStrength = PARAMS.mountainBandStrength ?? 0;
  const heightBiasNorth = PARAMS.heightBiasNorth ?? 0;

  const lx = PARAMS.lakeCenterX ?? -60;
  const lz = PARAMS.lakeCenterZ ?? 50;
  const lr = PARAMS.lakeRadius ?? 42;
  const ld = PARAMS.lakeDepth ?? 10;

  const l2x = PARAMS.secondLakeCenterX ?? 0;
  const l2z = PARAMS.secondLakeCenterZ ?? 0;
  const l2r = PARAMS.secondLakeRadius ?? 0;
  const l2d = PARAMS.secondLakeDepth ?? 0;

  const peak1X = PARAMS.peak1X ?? -120;
  const peak1Z = PARAMS.peak1Z ?? 120;
  const peak1Height = PARAMS.peak1Height ?? 0;
  const peak1Radius = Math.max(20, PARAMS.peak1Radius ?? 80);
  const peak2X = PARAMS.peak2X ?? 0;
  const peak2Z = PARAMS.peak2Z ?? 0;
  const peak2Height = PARAMS.peak2Height ?? 0;
  const peak2Radius = Math.max(20, PARAMS.peak2Radius ?? 60);

  for (let y = 0; y < terrainRes; y++) {
    for (let x = 0; x < terrainRes; x++) {
      const wx = (x / terrainRes - 0.5) * terrainSize;
      const wz = (y / terrainRes - 0.5) * terrainSize;
      const nx = wx * 0.008;
      const nz = wz * 0.008;
      const nxL = wx * 0.001;
      const nzL = wz * 0.001;

      const roll = fbmNoise(nx, nz, 6);
      const ridge = ridgedFbm(nx * 0.9, nz * 0.9, 5);
      const mountainMask = Math.max(0, fbmNoise(nxL, nzL, 4) - mountainMaskThreshold);
      const mountainMaskSmooth =
        mountainMask * mountainMask * (3 - 2 * mountainMask);

      let rawFactor =
        roll * (1 - mountainMaskSmooth * mx) +
        (roll * 0.2 + ridge * 1.0) * mountainMaskSmooth * mx;
      if (ridgedInMountains > 0 && mountainMaskSmooth > 0.25) {
        const blend = Math.min(1, (mountainMaskSmooth - 0.25) / 0.35);
        rawFactor =
          rawFactor * (1 - blend * ridgedInMountains) +
          ridge * blend * ridgedInMountains;
      }
      rawFactor = applyHeightCurve(rawFactor, heightCurvePower);

      if (flat > 0 && mountainMaskSmooth < 0.5) {
        const f = 1 - flat * (1 - mountainMaskSmooth * 2);
        rawFactor *= 0.35 + 0.65 * f;
      }

      let h =
        rawFactor *
        H *
        (1 + (mountainHeightMultiplier - 1) * mountainMaskSmooth);

      if (mountainBandStrength > 0) {
        const band = (wz / (terrainSize * 0.5) + 1) * 0.5;
        h += mountainBandStrength * H * band;
      }

      if (peak1Height > 0) {
        const d1x = wx - peak1X;
        const d1z = wz - peak1Z;
        const distSq = d1x * d1x + d1z * d1z;
        const sigma = peak1Radius * 0.6;
        h += peak1Height * Math.exp(-distSq / (2 * sigma * sigma));
      }
      if (peak2Height > 0 && peak2Radius > 0) {
        const d2x = wx - peak2X;
        const d2z = wz - peak2Z;
        const distSq = d2x * d2x + d2z * d2z;
        const sigma = peak2Radius * 0.6;
        h += peak2Height * Math.exp(-distSq / (2 * sigma * sigma));
      }

      const dx = wx - lx;
      const dz = wz - lz;
      let dist = Math.sqrt(dx * dx + dz * dz);
      let lakeFalloff = Math.max(0, 1 - dist / lr);
      let lakeSmooth = lakeFalloff * lakeFalloff * (3 - 2 * lakeFalloff);
      h -= ld * lakeSmooth;

      if (l2r > 0) {
        const d2x = wx - l2x;
        const d2z = wz - l2z;
        dist = Math.sqrt(d2x * d2x + d2z * d2z);
        lakeFalloff = Math.max(0, 1 - dist / l2r);
        lakeSmooth = lakeFalloff * lakeFalloff * (3 - 2 * lakeFalloff);
        h -= l2d * lakeSmooth;
      }

      if (heightBiasNorth !== 0) {
        const northNorm = wz / (terrainSize * 0.5);
        h += heightBiasNorth * Math.max(-1, Math.min(1, northNorm));
      }

      data[y * terrainRes + x] = Math.max(0, h);
    }
  }
  return data;
}

function sampleHeightFromData(heightData, wx, wz, terrainSize, terrainRes) {
  const u = (wx / terrainSize + 0.5) * terrainRes;
  const v = (wz / terrainSize + 0.5) * terrainRes;
  const ix = Math.max(0, Math.min(terrainRes - 2, Math.floor(u)));
  const iy = Math.max(0, Math.min(terrainRes - 2, Math.floor(v)));
  const fx = u - ix,
    fy = v - iy;
  const h00 = heightData[iy * terrainRes + ix];
  const h10 = heightData[iy * terrainRes + ix + 1];
  const h01 = heightData[(iy + 1) * terrainRes + ix];
  const h11 = heightData[(iy + 1) * terrainRes + ix + 1];
  return (
    h00 * (1 - fx) * (1 - fy) +
    h10 * fx * (1 - fy) +
    h01 * (1 - fx) * fy +
    h11 * fx * fy
  );
}

/**
 * Create Zelda BOTW-style terrain and add to scene.
 * @param {THREE.Scene} scene
 * @param {object} PARAMS - all terrain + material params (see zelda-terrain-showcase.html)
 * @param {{ TERRAIN_SIZE?: number, TERRAIN_RES?: number }} options - override size/res from PARAMS
 * @returns {{ terrain: THREE.Mesh, sampleHeight: (wx: number, wz: number) => number, regenTerrain: () => void, syncTerrainUniforms: () => void }}
 */
export function createTerrain(scene, PARAMS, options = {}) {
  const terrainSize = options.TERRAIN_SIZE ?? PARAMS.terrainSize ?? 800;
  const terrainRes = options.TERRAIN_RES ?? PARAMS.terrainRes ?? 384;

  const texLoader = new THREE.TextureLoader();
  let groundColorTex, groundNormalTex, groundRoughTex, groundAOTex;
  let grassColorTex, grassNormalTex, grassRoughTex, grassAOTex;
  const terrainReadyPromise = new Promise((resolve, reject) => {
    const paths = [
      "textures/Ground037_1K-JPG_Color.jpg",
      "textures/Ground037_1K-JPG_NormalGL.jpg",
      "textures/Ground037_1K-JPG_Roughness.jpg",
      "textures/Ground037_1K-JPG_AmbientOcclusion.jpg",
      "textures/Grass005_1K-JPG_Color.jpg",
      "textures/Grass005_1K-JPG_NormalGL.jpg",
      "textures/Grass005_1K-JPG_Roughness.jpg",
      "textures/Grass005_1K-JPG_AmbientOcclusion.jpg",
    ];
    let pending = paths.length;
    const onLoad = () => {
      if (--pending === 0) resolve();
    };
    groundColorTex = texLoader.load(paths[0], onLoad, undefined, reject);
    groundNormalTex = texLoader.load(paths[1], onLoad, undefined, reject);
    groundRoughTex = texLoader.load(paths[2], onLoad, undefined, reject);
    groundAOTex = texLoader.load(paths[3], onLoad, undefined, reject);
    grassColorTex = texLoader.load(paths[4], onLoad, undefined, reject);
    grassNormalTex = texLoader.load(paths[5], onLoad, undefined, reject);
    grassRoughTex = texLoader.load(paths[6], onLoad, undefined, reject);
    grassAOTex = texLoader.load(paths[7], onLoad, undefined, reject);
  });
  [
    groundColorTex,
    groundNormalTex,
    groundRoughTex,
    groundAOTex,
    grassColorTex,
    grassNormalTex,
    grassRoughTex,
    grassAOTex,
  ].forEach((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  });
  groundColorTex.colorSpace = THREE.SRGBColorSpace;
  grassColorTex.colorSpace = THREE.SRGBColorSpace;

  const uGroundDirt = uniform(
    srgbToLinear(PARAMS.groundDirtColor ?? "#8b6f4a"),
  );
  const uGroundBase = uniform(
    srgbToLinear(PARAMS.groundBaseColor ?? "#4a9030"),
  );
  const uTexTiling = uniform(PARAMS.texTiling ?? 60);
  const uGrassSlopeMin = uniform(PARAMS.grassSlopeMin ?? 0.5);
  const uGrassSlopeMax = uniform(PARAMS.grassSlopeMax ?? 0.92);
  const uGrassAmount = uniform(PARAMS.grassAmount ?? 1.0);

  let heightData = generateHeightmap(PARAMS, terrainSize, terrainRes);
  let terrainGeo = new THREE.PlaneGeometry(
    terrainSize,
    terrainSize,
    terrainRes - 1,
    terrainRes - 1,
  );
  terrainGeo.rotateX(-PI / 2);
  const posArr = terrainGeo.attributes.position.array;
  for (let i = 0; i < posArr.length; i += 3) {
    const wx = posArr[i],
      wz = posArr[i + 2];
    posArr[i + 1] = sampleHeightFromData(
      heightData,
      wx,
      wz,
      terrainSize,
      terrainRes,
    );
  }
  terrainGeo.computeVertexNormals();

  const terrainMat = new THREE.MeshStandardNodeMaterial({
    roughness: 1,
    metalness: 0,
  });
  const tiledUV = uv().mul(uTexTiling);
  terrainMat.colorNode = Fn(() => {
    const grassCol = uGroundBase;
    const groundCol = texture(groundColorTex, tiledUV).rgb;
    const grassFactor = mul(
      smoothstep(uGrassSlopeMin, uGrassSlopeMax, normalLocal.y),
      uGrassAmount,
    );
    const texColor = mix(groundCol, grassCol, grassFactor);
    const wp = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    const n1 = noise12(mul(wp.xz, 0.03)),
      n2 = noise12(mul(wp.xz, 0.08)),
      n3 = noise12(mul(wp.xz, 0.2));
    const combined = add(n1, mul(n2, 0.5), mul(n3, 0.25)).mul(0.57);
    const slopeBlend = smoothstep(0.85, 0.6, normalLocal.y);
    const dirtMix = max(
      mul(smoothstep(0.35, 0.65, combined), float(1)),
      slopeBlend,
    );
    const baseColor = mix(texColor, uGroundDirt, mul(dirtMix, 0.58));
    const macro1 = noise12(mul(wp.xz, 0.018));
    const macro2 = noise12(mul(wp.xz, 0.048));
    const macroLightness = sub(1.0, mul(macro1, 0.14));
    const nearWithMacro = mul(baseColor, macroLightness);
    const steepFactor = sub(1.0, smoothstep(0.52, 0.86, normalLocal.y));
    const darkerEarth = vec3(0.22, 0.32, 0.18);
    const nearColor = mix(
      nearWithMacro,
      darkerEarth,
      mul(steepFactor, 0.22),
    );
    const camPos = cameraPosition;
    const dist = length(sub(wp, camPos));
    const farMix = smoothstep(45.0, 115.0, dist);
    const farGrassBase = vec3(0.28, 0.48, 0.2);
    const farPatchLight = add(0.86, mul(macro1, 0.28));
    const farPatchTint = mix(
      farGrassBase,
      vec3(0.32, 0.5, 0.22),
      mul(macro2, 0.2),
    );
    const farColor = mul(farPatchTint, farPatchLight);
    return mix(nearColor, farColor, farMix);
  })();
  const grassNorm = texture(grassNormalTex, tiledUV);
  const groundNorm = texture(groundNormalTex, tiledUV);
  const grassRough = texture(grassRoughTex, tiledUV).r;
  const groundRough = texture(groundRoughTex, tiledUV).r;
  const grassAO = texture(grassAOTex, tiledUV);
  const groundAO = texture(groundAOTex, tiledUV);
  const terrainGrassFactor = mul(
    smoothstep(uGrassSlopeMin, uGrassSlopeMax, normalLocal.y),
    uGrassAmount,
  );
  terrainMat.normalNode = normalMap(
    mix(groundNorm, grassNorm, terrainGrassFactor),
  );
  terrainMat.roughnessNode = max(
    mix(groundRough, grassRough, terrainGrassFactor),
    float(0.6),
  );
  terrainMat.aoNode = mix(
    vec3(1, 1, 1),
    mix(groundAO, grassAO, terrainGrassFactor),
    float(0.76),
  );
  terrainMat.envMapIntensity = 0.85;

  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  function sampleHeight(wx, wz) {
    const size = PARAMS.terrainSize ?? 800;
    const res = PARAMS.terrainRes ?? 384;
    return sampleHeightFromData(heightData, wx, wz, size, res);
  }

  function regenTerrain() {
    const size = PARAMS.terrainSize ?? 800;
    const res = PARAMS.terrainRes ?? 384;
    heightData = generateHeightmap(PARAMS, size, res);
    if (terrainGeo) terrainGeo.dispose();
    terrainGeo = new THREE.PlaneGeometry(size, size, res - 1, res - 1);
    terrainGeo.rotateX(-PI / 2);
    const arr = terrainGeo.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const wx = arr[i],
        wz = arr[i + 2];
      arr[i + 1] = sampleHeightFromData(heightData, wx, wz, size, res);
    }
    terrainGeo.computeVertexNormals();
    terrain.geometry = terrainGeo;
  }

  function syncTerrainUniforms() {
    uGroundDirt.value.copy(srgbToLinear(PARAMS.groundDirtColor ?? "#8b6f4a"));
    uGroundBase.value.copy(srgbToLinear(PARAMS.groundBaseColor ?? "#4a9030"));
    uTexTiling.value = PARAMS.texTiling ?? 60;
    uGrassSlopeMin.value = PARAMS.grassSlopeMin ?? 0.5;
    uGrassSlopeMax.value = PARAMS.grassSlopeMax ?? 0.92;
    uGrassAmount.value = PARAMS.grassAmount ?? 1.0;
  }

  /** Returns heights in column-major for Rapier. Use colliderRes <= 256 to avoid WASM limits. */
  function getHeightDataForCollider(colliderRes = 128) {
    const size = PARAMS.terrainSize ?? 800;
    const res = PARAMS.terrainRes ?? 384;
    const R = Math.max(2, Math.min(256, colliderRes));
    const colMajor = new Float32Array(R * R);
    for (let col = 0; col < R; col++) {
      for (let row = 0; row < R; row++) {
        const u = (col / (R - 1)) * (res - 1);
        const v = (row / (R - 1)) * (res - 1);
        const ix = Math.min(Math.floor(u), res - 2);
        const iy = Math.min(Math.floor(v), res - 2);
        const fx = u - ix;
        const fy = v - iy;
        const h00 = heightData[iy * res + ix];
        const h10 = heightData[iy * res + ix + 1];
        const h01 = heightData[(iy + 1) * res + ix];
        const h11 = heightData[(iy + 1) * res + ix + 1];
        const h = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
        colMajor[row + col * R] = h;
      }
    }
    return { heights: colMajor, terrainSize: size, terrainRes: R };
  }

  return {
    terrain,
    sampleHeight,
    regenTerrain,
    syncTerrainUniforms,
    getHeightDataForCollider,
    /** Resolves when terrain textures have finished loading. Spawn character after this. */
    whenReady: terrainReadyPromise,
  };
}
