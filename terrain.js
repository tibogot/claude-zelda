/**
 * Terrain: heightmap, trail texture, terrain mesh + TSL material.
 * Exports createTerrain(scene, PARAMS, options) → { terrain, heightTex, trailTex, sampleHeight, updateTrail, regenTerrain, syncTerrainUniforms }.
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
    iy = Math.floor(y),
    fx = x - ix,
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

/**
 * @param {THREE.Scene} scene
 * @param {object} PARAMS
 * @param {{ TERRAIN_SIZE: number, TERRAIN_RES: number, TERRAIN_HEIGHT: number, TRAIL_RES: number, TRAIL_SIZE: number }} options
 */
export function createTerrain(scene, PARAMS, options) {
  const {
    TERRAIN_SIZE,
    TERRAIN_RES,
    TERRAIN_HEIGHT,
    TRAIL_RES,
    TRAIL_SIZE,
  } = options;

  const heightData = new Float32Array(TERRAIN_RES * TERRAIN_RES * 4);
  const heightTex = new THREE.DataTexture(
    heightData,
    TERRAIN_RES,
    TERRAIN_RES,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;

  function generateHeightmap() {
    const mx = PARAMS.mountainStrength;
    const flat = PARAMS.fieldFlatten;
    const lx = PARAMS.lakeCenterX;
    const lz = PARAMS.lakeCenterZ;
    const lr = PARAMS.lakeRadius;
    const ld = PARAMS.lakeDepth;
    const H = PARAMS.terrainHeight;
    for (let y = 0; y < TERRAIN_RES; y++) {
      for (let x = 0; x < TERRAIN_RES; x++) {
        const wx = (x / TERRAIN_RES - 0.5) * TERRAIN_SIZE;
        const wz = (y / TERRAIN_RES - 0.5) * TERRAIN_SIZE;
        const nx = wx * 0.008,
          nz = wz * 0.008;
        const nxL = wx * 0.002,
          nzL = wz * 0.002;
        const roll = fbmNoise(nx, nz, 6);
        const ridge = ridgedFbm(nx * 0.9, nz * 0.9, 5);
        const mountainMask = Math.max(0, fbmNoise(nxL, nzL, 4) - 0.35);
        const mountainMaskSmooth =
          mountainMask * mountainMask * (3 - 2 * mountainMask);
        let h =
          roll * (1 - mountainMaskSmooth * mx) +
          (roll * 0.25 + ridge * 1.1) * mountainMaskSmooth * mx;
        if (flat > 0 && mountainMaskSmooth < 0.5) {
          const f = 1 - flat * (1 - mountainMaskSmooth * 2);
          h *= 0.3 + 0.7 * f;
        }
        h *= H;
        const dx = wx - lx,
          dz = wz - lz;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const lakeFalloff = Math.max(0, 1 - dist / lr);
        const lakeSmooth =
          lakeFalloff * lakeFalloff * (3 - 2 * lakeFalloff);
        h -= ld * lakeSmooth;
        const idx = (y * TERRAIN_RES + x) * 4;
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
    const u = (wx / TERRAIN_SIZE + 0.5) * TERRAIN_RES;
    const v = (wz / TERRAIN_SIZE + 0.5) * TERRAIN_RES;
    const ix = Math.max(0, Math.min(TERRAIN_RES - 2, Math.floor(u)));
    const iy = Math.max(0, Math.min(TERRAIN_RES - 2, Math.floor(v)));
    const fx = u - ix,
      fy = v - iy;
    const h00 = heightData[(iy * TERRAIN_RES + ix) * 4];
    const h10 = heightData[(iy * TERRAIN_RES + ix + 1) * 4];
    const h01 = heightData[((iy + 1) * TERRAIN_RES + ix) * 4];
    const h11 = heightData[((iy + 1) * TERRAIN_RES + ix + 1) * 4];
    return (
      h00 * (1 - fx) * (1 - fy) +
      h10 * fx * (1 - fy) +
      h01 * (1 - fx) * fy +
      h11 * fx * fy
    );
  }

  const trailData = new Float32Array(TRAIL_RES * TRAIL_RES * 4);
  for (let i = 0; i < trailData.length; i += 4) {
    trailData[i] = 1;
    trailData[i + 1] = 0;
    trailData[i + 2] = 0;
    trailData[i + 3] = 1;
  }
  const trailTex = new THREE.DataTexture(
    trailData,
    TRAIL_RES,
    TRAIL_RES,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  trailTex.wrapS = trailTex.wrapT = THREE.ClampToEdgeWrapping;
  trailTex.magFilter = THREE.LinearFilter;
  trailTex.minFilter = THREE.LinearFilter;

  function updateTrail(dt, px, pz) {
    const grow = PARAMS.trailGrowRate,
      crush = PARAMS.trailCrushSpeed;
    const r2 = PARAMS.trailRadius * PARAMS.trailRadius;
    for (let y = 0; y < TRAIL_RES; y++)
      for (let x = 0; x < TRAIL_RES; x++) {
        const idx = (y * TRAIL_RES + x) * 4;
        let scale = trailData[idx];
        const wx = (x / TRAIL_RES - 0.5) * TRAIL_SIZE,
          wz = (y / TRAIL_RES - 0.5) * TRAIL_SIZE;
        const d2 = wx * wx + wz * wz;
        if (d2 < r2 && PARAMS.trailEnabled) {
          const contact = 1.0 - d2 / r2;
          scale += (0.15 - scale) * crush * contact;
        } else {
          scale += (1.0 - scale) * grow;
        }
        trailData[idx] = Math.max(0.1, Math.min(1.0, scale));
      }
    trailTex.needsUpdate = true;
  }

  const texLoader = new THREE.TextureLoader();
  const groundColorTex = texLoader.load(
    "textures/Ground037_1K-JPG_Color.jpg",
  );
  const groundNormalTex = texLoader.load(
    "textures/Ground037_1K-JPG_NormalGL.jpg",
  );
  const groundRoughTex = texLoader.load(
    "textures/Ground037_1K-JPG_Roughness.jpg",
  );
  const groundAOTex = texLoader.load(
    "textures/Ground037_1K-JPG_AmbientOcclusion.jpg",
  );
  const grassColorTex = texLoader.load(
    "textures/Grass005_1K-JPG_Color.jpg",
  );
  const grassNormalTex = texLoader.load(
    "textures/Grass005_1K-JPG_NormalGL.jpg",
  );
  const grassRoughTex = texLoader.load(
    "textures/Grass005_1K-JPG_Roughness.jpg",
  );
  const grassAOTex = texLoader.load(
    "textures/Grass005_1K-JPG_AmbientOcclusion.jpg",
  );
  for (const t of [
    groundColorTex,
    groundNormalTex,
    groundRoughTex,
    groundAOTex,
    grassColorTex,
    grassNormalTex,
    grassRoughTex,
    grassAOTex,
  ]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  groundColorTex.colorSpace = THREE.SRGBColorSpace;
  grassColorTex.colorSpace = THREE.SRGBColorSpace;

  const uGroundDirt = uniform(srgbToLinear(PARAMS.groundDirtColor));
  const uGroundBase = uniform(srgbToLinear(PARAMS.groundBaseColor));
  const uGroundVar = uniform(1.0);
  const uTexTiling = uniform(PARAMS.texTiling);
  const uGrassSlopeMin = uniform(PARAMS.grassSlopeMin);
  const uGrassSlopeMax = uniform(PARAMS.grassSlopeMax);
  const uGrassAmount = uniform(PARAMS.grassAmount);

  const terrainGeo = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_RES - 1,
    TERRAIN_RES - 1,
  );
  terrainGeo.rotateX(-PI / 2);
  const posArr = terrainGeo.attributes.position.array;
  for (let i = 0; i < posArr.length; i += 3) {
    const wx = posArr[i],
      wz = posArr[i + 2];
    posArr[i + 1] = sampleHeight(wx, wz);
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
      mul(smoothstep(0.35, 0.65, combined), uGroundVar),
      slopeBlend,
    );
    const baseColor = mix(texColor, uGroundDirt, mul(dirtMix, 0.58));
    const macro1 = noise12(mul(wp.xz, 0.018));
    const macro2 = noise12(mul(wp.xz, 0.048));
    const macroLightness = sub(1.0, mul(macro1, 0.14));
    const nearWithMacro = mul(baseColor, macroLightness);
    const steepFactor = sub(1.0, smoothstep(0.52, 0.86, normalLocal.y));
    const darkerEarth = vec3(0.22, 0.32, 0.18);
    const nearColor = mix(nearWithMacro, darkerEarth, mul(steepFactor, 0.22));
    const camPos = cameraPosition;
    const dist = length(sub(wp, camPos));
    const farMix = smoothstep(45.0, 115.0, dist);
    const farGrassBase = vec3(0.28, 0.48, 0.2);
    const farPatchLight = add(0.86, mul(macro1, 0.28));
    const farPatchTint = mix(farGrassBase, vec3(0.32, 0.5, 0.22), mul(macro2, 0.2));
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

  function regenTerrain() {
    generateHeightmap();
    const pa = terrainGeo.attributes.position.array;
    for (let i = 0; i < pa.length; i += 3)
      pa[i + 1] = sampleHeight(pa[i], pa[i + 2]);
    terrainGeo.attributes.position.needsUpdate = true;
    terrainGeo.computeVertexNormals();
  }

  function syncTerrainUniforms(PARAMS) {
    uGroundDirt.value.copy(srgbToLinear(PARAMS.groundDirtColor));
    uGroundBase.value.copy(srgbToLinear(PARAMS.groundBaseColor));
    uGroundVar.value = PARAMS.groundVariation ? 1 : 0;
    uTexTiling.value = PARAMS.texTiling;
    uGrassSlopeMin.value = PARAMS.grassSlopeMin;
    uGrassSlopeMax.value = PARAMS.grassSlopeMax;
    uGrassAmount.value = PARAMS.grassAmount;
  }

  return {
    terrain,
    heightTex,
    trailTex,
    sampleHeight,
    updateTrail,
    regenTerrain,
    syncTerrainUniforms,
  };
}
