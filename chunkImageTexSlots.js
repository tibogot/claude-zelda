/**
 * Shared image slots for chunk terrain (splatmap-painter-style).
 * Slot 0 = Cobblestone rock (same asset set as splatmap-painter IMG_TEX_SLOTS[2]).
 * ORM DataTexture: R=AO, G=roughness, B/A = normal XY (0–1).
 */
import * as THREE from "three";
import { uniform } from "three/tsl";

function makePlaceholderCanvasTexture(r, g, b) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeNeutralORMDataTexture() {
  const d = new Uint8Array(256 * 256 * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255;
    d[i + 1] = 200;
    d[i + 2] = 128;
    d[i + 3] = 128;
  }
  const dt = new THREE.DataTexture(d, 256, 256, THREE.RGBAFormat);
  dt.wrapS = dt.wrapT = THREE.RepeatWrapping;
  dt.minFilter = dt.magFilter = THREE.LinearFilter;
  dt.colorSpace = THREE.LinearSRGBColorSpace;
  dt.needsUpdate = true;
  return dt;
}

function packChannelIntoDataTexture(dt, imgEl, channelIdx) {
  const size = dt.image.width;
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = size;
  const tmpCtx = tmp.getContext("2d", { willReadFrequently: true });
  tmpCtx.drawImage(imgEl, 0, 0, size, size);
  const src = tmpCtx.getImageData(0, 0, size, size).data;
  const dst = dt.image.data;
  for (let i = 0, n = dst.length >> 2; i < n; i++) dst[i * 4 + channelIdx] = src[i * 4];
  dt.needsUpdate = true;
}

function packNormalIntoDataTextureBA(dt, imgEl) {
  const size = dt.image.width;
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = size;
  const tmpCtx = tmp.getContext("2d", { willReadFrequently: true });
  tmpCtx.drawImage(imgEl, 0, 0, size, size);
  const src = tmpCtx.getImageData(0, 0, size, size).data;
  const dst = dt.image.data;
  for (let i = 0, n = dst.length >> 2; i < n; i++) {
    dst[i * 4 + 2] = src[i * 4];
    dst[i * 4 + 3] = src[i * 4 + 1];
  }
  dt.needsUpdate = true;
}

function drawOntoCanvasTex(slotTex, imgEl, colorSpace) {
  const canvas = slotTex.image;
  const c2d = canvas.getContext("2d");
  c2d.drawImage(imgEl, 0, 0, canvas.width, canvas.height);
  slotTex.colorSpace = colorSpace;
  slotTex.needsUpdate = true;
}

/**
 * @returns {{ slots: object[], loadDefaults: () => Promise<void>, dispose: () => void }}
 */
export function createChunkImageSlotSystem() {
  const rockORM = makeNeutralORMDataTexture();
  const slotRock = {
    name: "Rock",
    uvScale: 20.0,
    albedoTex: makePlaceholderCanvasTexture(120, 100, 80),
    ormTex: rockORM,
    uUVScale: uniform(20.0),
    uHasAlbedo: uniform(1),
    uHasNormal: uniform(0),
    uHasRough: uniform(0),
    uHasAO: uniform(0),
    normalStrength: 1.0,
    uNormalStr: uniform(1.0),
    aoStrength: 1.0,
    uAOStr: uniform(1.0),
    roughStrength: 1.0,
    uRoughStr: uniform(1.0),
  };

  const slotGrass = {
    name: "Grass 005",
    uvScale: 3.0,
    albedoTex: makePlaceholderCanvasTexture(80, 140, 60),
    ormTex: makeNeutralORMDataTexture(),
    uUVScale: uniform(3.0),
    uHasAlbedo: uniform(1),
    uHasNormal: uniform(0),
    uHasRough: uniform(0),
    uHasAO: uniform(0),
    normalStrength: 1.0,
    uNormalStr: uniform(1.0),
    aoStrength: 1.0,
    uAOStr: uniform(1.0),
    roughStrength: 1.0,
    uRoughStr: uniform(1.0),
  };

  const slotGround = {
    name: "Ground 037",
    uvScale: 3.0,
    albedoTex: makePlaceholderCanvasTexture(180, 140, 100),
    ormTex: makeNeutralORMDataTexture(),
    uUVScale: uniform(3.0),
    uHasAlbedo: uniform(1),
    uHasNormal: uniform(0),
    uHasRough: uniform(0),
    uHasAO: uniform(0),
    normalStrength: 1.0,
    uNormalStr: uniform(1.0),
    aoStrength: 1.0,
    uAOStr: uniform(1.0),
    roughStrength: 1.0,
    uRoughStr: uniform(1.0),
  };

  const slots = [slotRock, slotGrass, slotGround];
  const loader = new THREE.TextureLoader();

  const ROCK = {
    albedo: "textures/Cobblestone_Irregular_Floor_001_SD/Cobblestone_Irregular_Floor_001_basecolor.png",
    normal: "textures/Cobblestone_Irregular_Floor_001_SD/Cobblestone_Irregular_Floor_001_normal.png",
    ao: "textures/Cobblestone_Irregular_Floor_001_SD/Cobblestone_Irregular_Floor_001_ambientOcclusion.png",
    rough: "textures/Cobblestone_Irregular_Floor_001_SD/Cobblestone_Irregular_Floor_001_roughness.png",
  };

  const GRASS = {
    albedo: "textures/Grass005_1K-JPG_Color.jpg",
    normal: "textures/Grass005_1K-JPG_NormalGL.jpg",
    ao: "textures/Grass005_1K-JPG_AmbientOcclusion.jpg",
    rough: "textures/Grass005_1K-JPG_Roughness.jpg",
  };

  const GROUND = {
    albedo: "textures/Ground037_1K-JPG_Color.jpg",
    normal: "textures/Ground037_1K-JPG_NormalGL.jpg",
    ao: "textures/Ground037_1K-JPG_AmbientOcclusion.jpg",
    rough: "textures/Ground037_1K-JPG_Roughness.jpg",
  };

  function loadSlotPacked(slot, maps, enableFlags) {
    return new Promise((resolve) => {
      let left = 4;
      const done = () => {
        left--;
        if (left <= 0) {
          if (enableFlags.albedo) slot.uHasAlbedo.value = 1;
          if (enableFlags.normal) slot.uHasNormal.value = 1;
          if (enableFlags.rough) slot.uHasRough.value = 1;
          if (enableFlags.ao) slot.uHasAO.value = 1;
          resolve();
        }
      };
      loader.load(
        maps.albedo,
        (t) => {
          drawOntoCanvasTex(slot.albedoTex, t.image, THREE.SRGBColorSpace);
          done();
        },
        undefined,
        () => done(),
      );
      loader.load(
        maps.normal,
        (t) => {
          packNormalIntoDataTextureBA(slot.ormTex, t.image);
          done();
        },
        undefined,
        () => done(),
      );
      loader.load(
        maps.ao,
        (t) => {
          packChannelIntoDataTexture(slot.ormTex, t.image, 0);
          done();
        },
        undefined,
        () => done(),
      );
      loader.load(
        maps.rough,
        (t) => {
          packChannelIntoDataTexture(slot.ormTex, t.image, 1);
          done();
        },
        undefined,
        () => done(),
      );
    });
  }

  async function loadDefaults() {
    await loadSlotPacked(slotRock, ROCK, {
      albedo: true,
      normal: true,
      rough: true,
      ao: true,
    });
    await loadSlotPacked(slotGrass, GRASS, {
      albedo: true,
      normal: true,
      rough: true,
      ao: true,
    });
    await loadSlotPacked(slotGround, GROUND, {
      albedo: true,
      normal: true,
      rough: true,
      ao: true,
    });
  }

  function dispose() {
    for (const s of slots) {
      s.albedoTex.dispose();
      s.ormTex.dispose();
    }
  }

  return { slots, loadDefaults, dispose };
}
