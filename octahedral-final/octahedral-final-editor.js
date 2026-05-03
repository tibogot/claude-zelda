/**
 * Octahedral impostor editor — final lab (self-contained).
 * Entry: octahedral-final-editor.html — fork of octahedral-impostor-editor-webgpu.js
 */
import * as THREE from "three";
import {
  Fn,
  normalize,
  sub,
  mul,
  add,
  div,
  abs,
  vec2,
  vec3,
  vec4,
  sign,
  dot,
  cross,
  floor,
  fract,
  min,
  max,
  clamp,
  saturate,
  texture,
  cameraPosition,
  positionWorld,
  positionLocal,
  positionView,
  float,
  uniform,
  varying,
  select,
  length,
  negate,
  mix,
  smoothstep,
  fwidth,
  pow,
  normalWorld,
  tangentLocal,
  viewportCoordinate,
  uv,
  shadowPositionWorld,
  lightShadowMatrix,
  reference,
  renderGroup,
  BasicShadowFilter,
  PCFShadowFilter,
  PCFSoftShadowFilter,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";

const MODEL_DIR = new URL("../models/", import.meta.url);
function modelUrl(file) {
  return new URL(file, MODEL_DIR).href;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function hemiOctaGridToDir(gx, gy, out) {
  out.set(gx - gy, 0, -1 + gx + gy);
  out.y = 1 - Math.abs(out.x) - Math.abs(out.z);
  return out.normalize();
}

/** View direction → hemi-octahedral atlas UV (for active-cell overlay). */
function hemiOctaEncode(dir) {
  const sx = Math.sign(dir.x) || 1;
  const sy = Math.sign(dir.y) || 1;
  const sz = Math.sign(dir.z) || 1;
  const d = dir.x * sx + dir.y * sy + dir.z * sz;
  return {
    u: 0.5 * (1 + dir.x / d + dir.z / d),
    v: 0.5 * (1 + dir.z / d - dir.x / d),
  };
}

function countRefTriangles(meshData) {
  let t = 0;
  for (const { geometry } of meshData) {
    if (!geometry) continue;
    const ix = geometry.index;
    if (ix) t += ix.count / 3;
    else {
      const n = geometry.attributes?.position?.count || 0;
      t += n / 3;
    }
  }
  return Math.floor(t);
}

function fullOctaGridToDir(gx, gy, out) {
  const ox = gx * 2 - 1;
  const oz = gy * 2 - 1;
  const oy = 1 - Math.abs(ox) - Math.abs(oz);
  if (oy >= 0) {
    out.set(ox, oy, oz);
  } else {
    out.set(
      (1 - Math.abs(oz)) * (ox >= 0 ? 1 : -1),
      oy,
      (1 - Math.abs(ox)) * (oz >= 0 ? 1 : -1),
    );
  }
  return out.normalize();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Per-cell alpha-weighted mipmap generation
// ═══════════════════════════════════════════════════════════════════════════

function generatePerCellMipmaps(pixels, atlasSize, grid) {
  const levels = [pixels];
  let prevSize = atlasSize;
  while (prevSize > 1) {
    const nextSize = prevSize >> 1;
    if (nextSize < 1) break;
    const prev = levels[levels.length - 1];
    const next = new Uint8Array(nextSize * nextSize * 4);
    const prevCellSize = prevSize / grid;
    const nextCellSize = nextSize / grid;

    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        const nx0 = Math.floor(col * nextCellSize);
        const ny0 = Math.floor(row * nextCellSize);
        const nw = Math.floor((col + 1) * nextCellSize) - nx0;
        const nh = Math.floor((row + 1) * nextCellSize) - ny0;

        for (let dy = 0; dy < nh; dy++) {
          for (let dx = 0; dx < nw; dx++) {
            const sx = Math.floor(col * prevCellSize) + dx * 2;
            const sy = Math.floor(row * prevCellSize) + dy * 2;
            const sxMax = Math.floor((col + 1) * prevCellSize) - 1;
            const syMax = Math.floor((row + 1) * prevCellSize) - 1;

            let r = 0,
              g = 0,
              b = 0,
              a = 0,
              cnt = 0;
            for (let oy = 0; oy < 2; oy++) {
              for (let ox = 0; ox < 2; ox++) {
                const px = Math.min(sx + ox, sxMax);
                const py = Math.min(sy + oy, syMax);
                const idx = (py * prevSize + px) * 4;
                const sa = prev[idx + 3];
                if (sa > 0) {
                  r += prev[idx] * sa;
                  g += prev[idx + 1] * sa;
                  b += prev[idx + 2] * sa;
                  a += sa;
                  cnt++;
                }
              }
            }
            const di = ((ny0 + dy) * nextSize + (nx0 + dx)) * 4;
            if (a > 0) {
              next[di] = Math.round(r / a);
              next[di + 1] = Math.round(g / a);
              next[di + 2] = Math.round(b / a);
              next[di + 3] = Math.round(a / Math.max(cnt, 1));
            }
          }
        }
      }
    }
    levels.push(next);
    prevSize = nextSize;
  }
  return levels;
}

function makeTexWithMips(mipLevels, atlasSize, maxAniso, srgb) {
  const t = new THREE.DataTexture(
    mipLevels[0],
    atlasSize,
    atlasSize,
    THREE.RGBAFormat,
  );
  t.mipmaps = [];
  let sz = atlasSize;
  for (let i = 0; i < mipLevels.length; i++) {
    t.mipmaps.push({ data: mipLevels[i], width: sz, height: sz });
    sz >>= 1;
  }
  t.needsUpdate = true;
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Linear → sRGB conversion (8-bit in-place, RGB only)
// ═══════════════════════════════════════════════════════════════════════════

function linearToSrgb(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = pixels[i + c] / 255;
      v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      pixels[i + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Atlas edge dilation — per-cell flood-fill, sets alpha=1 on dilated pixels
// ═══════════════════════════════════════════════════════════════════════════

function dilateAtlasEdges(pixels, size, grid, iterations = 8) {
  const cellSize = size / grid;
  const tmp = new Uint8Array(pixels.length);
  for (let iter = 0; iter < iterations; iter++) {
    tmp.set(pixels);
    for (let cy = 0; cy < grid; cy++) {
      for (let cx = 0; cx < grid; cx++) {
        const x0 = Math.floor(cx * cellSize);
        const y0 = Math.floor(cy * cellSize);
        const x1 = Math.floor((cx + 1) * cellSize);
        const y1 = Math.floor((cy + 1) * cellSize);
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * size + x) * 4;
            if (pixels[i + 3] > 0) continue;
            let r = 0, g = 0, b = 0, cnt = 0;
            for (let dy = -1; dy <= 1; dy++) {
              const ny = y + dy;
              if (ny < y0 || ny >= y1) continue;
              for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const nx = x + dx;
                if (nx < x0 || nx >= x1) continue;
                const ni = (ny * size + nx) * 4;
                if (pixels[ni + 3] > 0) {
                  r += pixels[ni];
                  g += pixels[ni + 1];
                  b += pixels[ni + 2];
                  cnt++;
                }
              }
            }
            if (cnt > 0) {
              tmp[i]     = Math.round(r / cnt);
              tmp[i + 1] = Math.round(g / cnt);
              tmp[i + 2] = Math.round(b / cnt);
              tmp[i + 3] = 1;
            }
          }
        }
      }
    }
    pixels.set(tmp);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Atlas Baking  —  4-pass: color + normal + roughness/metalness + depth
// ═══════════════════════════════════════════════════════════════════════════

/** Padding on bake ortho vs tight bounding sphere (same as legacy sphereMargin). */
const BAKE_SPHERE_MARGIN = 1.04;

async function bakeAtlases(renderer, bakeMeshData, opts) {
  const { grid, atlasSize, maxAniso, cellPad = 4, fullOctahedral = false } = opts;
  const gridToDir = fullOctahedral ? fullOctaGridToDir : hemiOctaGridToDir;
  const cs = Math.floor(atlasSize / grid);
  const pad = cellPad;
  const innerCS = cs - pad * 2;

  const box = new THREE.Box3();
  for (const { geometry } of bakeMeshData) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = sphere.radius * BAKE_SPHERE_MARGIN;
  const center = sphere.center.clone();
  const half = radius;

  const ortho = new THREE.OrthographicCamera(
    -half,
    half,
    half,
    -half,
    0.001,
    radius * 4,
  );
  const dir = new THREE.Vector3();

  const colorScene = new THREE.Scene();
  const normalScene = new THREE.Scene();
  const rmScene = new THREE.Scene();
  const depthScene = new THREE.Scene();

  const BAKE_ALPHA = 0.02;
  const depthNear = radius;
  const depthSpan = 2 * radius;

  for (const { geometry, material } of bakeMeshData) {
    const hasAlpha = !!(material.map || material.alphaMap);

    if (material.normalMap && !geometry.attributes.tangent) {
      try { geometry.computeTangents(); } catch (e) { /* skip if tangents fail */ }
    }

    const colorMat = new THREE.MeshBasicMaterial({
      color: material.color
        ? material.color.clone()
        : new THREE.Color(0xffffff),
      map: material.map || null,
      alphaTest: hasAlpha ? BAKE_ALPHA : 0,
      alphaMap: material.alphaMap || null,
      side: THREE.DoubleSide,
    });
    colorScene.add(new THREE.Mesh(geometry, colorMat));

    const alphaNode = material.map ? texture(material.map, uv()).a : float(1);
    let bakeNormal = normalWorld;
    if (material.normalMap && geometry.attributes.tangent) {
      const tAttr = tangentLocal;
      const T = normalize(tAttr.xyz);
      const N = normalWorld;
      const B = mul(normalize(cross(N, T)), tAttr.w);
      const mapSamp = texture(material.normalMap, uv());
      const mapN = sub(mul(mapSamp.xyz, float(2)), float(1));
      bakeNormal = normalize(add(add(mul(T, mapN.x), mul(B, mapN.y)), mul(N, mapN.z)));
    }
    const nMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(mul(add(bakeNormal, 1), 0.5), alphaNode),
    });
    if (hasAlpha) nMat.alphaTest = BAKE_ALPHA;
    normalScene.add(new THREE.Mesh(geometry.clone(), nMat));

    const r = material.roughness !== undefined ? material.roughness : 0.5;
    const m = material.metalness !== undefined ? material.metalness : 0.0;
    let rNode = float(r);
    let mNode = float(m);
    if (material.roughnessMap)
      rNode = mul(texture(material.roughnessMap, uv()).g, float(r));
    if (material.metalnessMap)
      mNode = mul(texture(material.metalnessMap, uv()).b, float(m));

    const rmMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(rNode, mNode, float(0), alphaNode),
    });
    if (hasAlpha) rmMat.alphaTest = BAKE_ALPHA;
    rmScene.add(new THREE.Mesh(geometry.clone(), rmMat));

    const depthVal = saturate(
      div(sub(negate(positionView.z), float(depthNear)), float(depthSpan)),
    );
    const dMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(depthVal, depthVal, depthVal, alphaNode),
    });
    if (hasAlpha) dMat.alphaTest = BAKE_ALPHA;
    depthScene.add(new THREE.Mesh(geometry.clone(), dMat));
  }

  const cellRT = new THREE.RenderTarget(innerCS, innerCS, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
  });

  const savedTM = renderer.toneMapping;
  const savedOCS = renderer.outputColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  await renderer.compileAsync(colorScene, ortho);
  await renderer.compileAsync(normalScene, ortho);
  await renderer.compileAsync(rmScene, ortho);
  await renderer.compileAsync(depthScene, ortho);

  const colorPixels = new Uint8Array(atlasSize * atlasSize * 4);
  const normalPixels = new Uint8Array(atlasSize * atlasSize * 4);
  const rmPixels = new Uint8Array(atlasSize * atlasSize * 4);
  const depthPixels = new Uint8Array(atlasSize * atlasSize * 4);

  const tightRow = innerCS * 4;
  const paddedRow = Math.ceil(tightRow / 256) * 256;

  const scenes = [
    [colorScene, colorPixels],
    [normalScene, normalPixels],
    [rmScene, rmPixels],
    [depthScene, depthPixels],
  ];

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      gridToDir(gx / (grid - 1), gy / (grid - 1), dir);
      ortho.position.copy(center).addScaledVector(dir, radius * 2);
      ortho.lookAt(center);
      ortho.updateMatrixWorld(true);

      for (const [sc, dest] of scenes) {
        renderer.setRenderTarget(cellRT);
        renderer.autoClear = true;
        renderer.render(sc, ortho);

        const buf = await renderer.readRenderTargetPixelsAsync(
          cellRT,
          0,
          0,
          innerCS,
          innerCS,
        );
        const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        const srcStride =
          src.length > innerCS * innerCS * 4 ? paddedRow : tightRow;

        for (let row = 0; row < innerCS; row++) {
          const srcOff = (innerCS - 1 - row) * srcStride;
          const dy = gy * cs + pad + row;
          const dstOff = (dy * atlasSize + gx * cs + pad) * 4;
          dest.set(src.subarray(srcOff, srcOff + tightRow), dstOff);
        }
      }
    }
  }

  cellRT.dispose();
  renderer.setRenderTarget(null);
  renderer.autoClear = true;
  renderer.toneMapping = savedTM;
  renderer.outputColorSpace = savedOCS;

  linearToSrgb(colorPixels);

  dilateAtlasEdges(colorPixels, atlasSize, grid, 8);
  dilateAtlasEdges(normalPixels, atlasSize, grid, 8);
  dilateAtlasEdges(rmPixels, atlasSize, grid, 8);
  dilateAtlasEdges(depthPixels, atlasSize, grid, 8);

  const colorMips = generatePerCellMipmaps(colorPixels, atlasSize, grid);
  const normalMips = generatePerCellMipmaps(normalPixels, atlasSize, grid);
  const rmMips = generatePerCellMipmaps(rmPixels, atlasSize, grid);
  const depthMips = generatePerCellMipmaps(depthPixels, atlasSize, grid);

  return {
    colorTex: makeTexWithMips(colorMips, atlasSize, maxAniso, true),
    normalTex: makeTexWithMips(normalMips, atlasSize, maxAniso, false),
    rmTex: makeTexWithMips(rmMips, atlasSize, maxAniso, false),
    depthTex: makeTexWithMips(depthMips, atlasSize, maxAniso, false),
    colorPixels,
    normalPixels,
    rmPixels,
    depthPixels,
    radius,
    center,
    grid,
    atlasSize,
    cellPad: pad,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Impostor Material  —  TSL PBR + RM atlas + debug + freeze + dither
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sample the directional light's shadow map without calling TSL shadow(light).
 * shadow(light) always allocates a NEW ShadowNode; the scene light already has one,
 * so two nodes fight over light.shadow.map and the impostor often sees no shadowing.
 * This path uses the same depth texture the renderer fills each frame (uDepth.value
 * updated from dirLight.shadow.map.depthTexture in the render loop).
 * `depthTexNode` must be from `texture(depthTex)`, not `uniform(depthTex)` — filters call `texture(depth, uv)` internally.
 */
function directionalShadowVisibility(dirLight, depthTexNode, filterFn) {
  const sh = dirLight.shadow;
  const normalBias = reference("normalBias", "float", sh).setGroup(renderGroup);
  const bias = reference("bias", "float", sh).setGroup(renderGroup);

  const biasedWorld = add(shadowPositionWorld, mul(normalWorld, normalBias));
  const clip = lightShadowMatrix(dirLight).mul(vec4(biasedWorld, float(1)));
  const ndc = div(clip.xyz, clip.w);
  const coordZ = ndc.z;
  const shadowCoord = vec3(
    ndc.x,
    sub(float(1), ndc.y),
    add(coordZ, bias),
  );

  const frustumTest = shadowCoord.x
    .greaterThanEqual(float(0))
    .and(shadowCoord.x.lessThanEqual(float(1)))
    .and(shadowCoord.y.greaterThanEqual(float(0)))
    .and(shadowCoord.y.lessThanEqual(float(1)))
    .and(shadowCoord.z.lessThanEqual(float(1)));

  const raw = filterFn({
    depthTexture: depthTexNode,
    shadowCoord,
    shadow: sh,
    depthLayer: 0,
  });
  const shadowIntensity = reference("intensity", "float", sh).setGroup(renderGroup);
  const filtered = frustumTest.select(raw, float(1));
  return mix(float(1), filtered, shadowIntensity);
}

function createImpostorMaterial(
  colorTex,
  normalTex,
  rmTex,
  depthTex,
  impostorScale,
  gridVal,
  atlasSize,
  cellPad,
  /** Scene sun — shadow map depth is sampled each frame via uShadowMapDepth. */
  dirLight,
  renderer,
  { fullOctahedral = false } = {},
) {
  const fullOcta = fullOctahedral;
  const uSPS = uniform(float(gridVal));
  const uScale = uniform(float(impostorScale));
  const uCenter = uniform(new THREE.Vector3());

  const uSunDir = uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uSunColor = uniform(new THREE.Vector3(3.0, 2.562, 2.169));
  const uAmbColor = uniform(new THREE.Vector3(0.062, 0.08, 0.101));
  const uHemiSky = uniform(new THREE.Vector3(0.053, 0.098, 0.242));
  const uHemiGround = uniform(new THREE.Vector3(0.02, 0.013, 0.006));
  const uNormStr = uniform(float(1.0));
  const uRimStr = uniform(float(0.14));
  const uRimPow = uniform(float(3.0));
  const uRimCol = uniform(new THREE.Vector3(0.4, 0.5, 0.65));
  const uAlphaCutoff = uniform(float(0.15));
  const uEdgeSmooth = uniform(float(1.5));
  const uDiffuseWrap = uniform(float(0.0));
  const uParallaxStr = uniform(float(0.0));
  const uDither = uniform(float(0));
  const uDebugMode = uniform(float(0)); // 0=lit, 1=normals, 2=raw atlas
  const uFreeze = uniform(float(0));
  const uFreezeDir = uniform(new THREE.Vector3(0, 0, 1));

  const uCellFrac = uniform(float(1 / gridVal));
  const uPadFrac = uniform(float(cellPad / atlasSize));
  const uInnerFrac = uniform(float(1 / gridVal - (2 * cellPad) / atlasSize));

  const vWeight = varying(vec4(0, 0, 0, 0), "vW");
  const vS1 = varying(vec2(0, 0), "vS1");
  const vS2 = varying(vec2(0, 0), "vS2");
  const vS3 = varying(vec2(0, 0), "vS3");
  const vUV1 = varying(vec2(0, 0), "vUV1");
  const vUV2 = varying(vec2(0, 0), "vUV2");
  const vUV3 = varying(vec2(0, 0), "vUV3");

  const encode = fullOcta
    ? Fn(([d]) => {
        const l1 = add(add(abs(d.x), abs(d.y)), abs(d.z));
        const ox = div(d.x, l1);
        const oz = div(d.z, l1);
        const wrapX = mul(sub(float(1), abs(oz)), sign(d.x));
        const wrapZ = mul(sub(float(1), abs(ox)), sign(d.z));
        const isLower = d.y.lessThan(float(0));
        const uvX = select(isLower, wrapX, ox);
        const uvZ = select(isLower, wrapZ, oz);
        return mul(add(vec2(uvX, uvZ), float(1)), float(0.5));
      })
    : Fn(([d]) => {
        const s = vec3(sign(d.x), sign(d.y), sign(d.z));
        const l1 = dot(d, s);
        const o = vec3(div(d.x, l1), div(d.y, l1), div(d.z, l1));
        return mul(vec2(add(1, add(o.x, o.z)), add(1, sub(o.z, o.x))), 0.5);
      });

  const decode = fullOcta
    ? Fn(([gi, nm1]) => {
        const u = vec2(div(gi.x, nm1.x), div(gi.y, nm1.y));
        const ox = sub(mul(u.x, float(2)), float(1));
        const oz = sub(mul(u.y, float(2)), float(1));
        const oy = sub(sub(float(1), abs(ox)), abs(oz));
        const isLower = oy.lessThan(float(0));
        const unwrapX = mul(sub(float(1), abs(oz)), sign(ox));
        const unwrapZ = mul(sub(float(1), abs(ox)), sign(oz));
        const fx = select(isLower, unwrapX, ox);
        const fz = select(isLower, unwrapZ, oz);
        return normalize(vec3(fx, oy, fz));
      })
    : Fn(([gi, nm1]) => {
        const u = vec2(div(gi.x, nm1.x), div(gi.y, nm1.y));
        const px = sub(u.x, u.y);
        const pz = sub(add(u.x, u.y), 1);
        const py = sub(sub(1, abs(px)), abs(pz));
        return normalize(vec3(px, py, pz));
      });

  const planeTangent = Fn(([n]) => {
    const up = mix(
      vec3(0, 1, 0),
      vec3(-1, 0, 0),
      max(float(0), sign(sub(n.y, float(0.999)))),
    );
    return normalize(cross(up, n));
  });

  const planeUp = Fn(([n, t]) => {
    const worldUp = vec3(0, 1, 0);
    const proj = sub(worldUp, mul(n, dot(n, worldUp)));
    const len = length(proj);
    return select(len.lessThan(float(0.001)), t, normalize(proj));
  });

  const projectVert = Fn(([n]) => {
    const t = planeTangent(n);
    const up = planeUp(n, t);
    return add(mul(positionLocal.x, t), mul(positionLocal.y, up));
  });

  const planeUV = Fn(([n, t, camL, vd]) => {
    const denom = dot(vd, n);
    const tt = mul(dot(negate(camL), n), div(1, denom));
    const hit = add(camL, mul(vd, tt));
    const upP = planeUp(n, t);
    return add(vec2(dot(t, hit), dot(upP, hit)), float(0.5));
  });

  // ── vertex stage: same billboard + planeUV as octahedral_impostor_webgpu_showcase.js ──
  // (Cylindrical + billboardUV in uScale=2r broke top views and did not match the bake.)
  const posNodeFn = Fn(() => {
    const nm1 = vec2(sub(uSPS, 1), sub(uSPS, 1));
    const camLocal = mul(sub(cameraPosition, uCenter), div(1, uScale));
    const faceDir = normalize(camLocal);
    const lookupDir = select(
      uFreeze.greaterThan(float(0.5)),
      uFreezeDir,
      faceDir,
    );

    const bv = projectVert(faceDir);
    const viewDir = normalize(sub(bv, camLocal));

    const grid = mul(encode(lookupDir), nm1);
    const gf = min(floor(grid), nm1);
    const fr = fract(grid);

    const w = vec4(
      min(sub(1, fr.x), sub(1, fr.y)),
      abs(sub(fr.x, fr.y)),
      min(fr.x, fr.y),
      max(float(0), sign(sub(fr.x, fr.y))),
    );
    vWeight.assign(w);

    const s1 = gf;
    const s2 = min(add(s1, mix(vec2(0, 1), vec2(1, 0), w.w)), nm1);
    const s3 = min(add(s1, vec2(1, 1)), nm1);
    vS1.assign(s1);
    vS2.assign(s2);
    vS3.assign(s3);

    const pn1 = decode(s1, nm1);
    const pt1 = planeTangent(pn1);
    const pn2 = decode(s2, nm1);
    const pt2 = planeTangent(pn2);
    const pn3 = decode(s3, nm1);
    const pt3 = planeTangent(pn3);
    vUV1.assign(planeUV(pn1, pt1, camLocal, viewDir));
    vUV2.assign(planeUV(pn2, pt2, camLocal, viewDir));
    vUV3.assign(planeUV(pn3, pt3, camLocal, viewDir));

    return bv;
  });

  // ── atlas UV with cell padding ──
  const getUV = Fn(([uvf, frame]) => {
    const clamped = clamp(vec2(uvf.x, uvf.y), float(0), float(1));
    return add(mul(frame, uCellFrac), add(uPadFrac, mul(clamped, uInnerFrac)));
  });

  // ── depth parallax UV offset (3-step iterative refinement) ──
  const depthParallax = Fn(([localUV, cellNorm, frame]) => {
    const V = normalize(sub(cameraPosition, positionWorld));
    const T = planeTangent(cellNorm);
    const B = planeUp(cellNorm, T);
    const VdotN = max(dot(V, cellNorm), float(0.3));
    const viewTS = div(vec2(dot(V, T), dot(V, B)), VdotN);

    const d0 = texture(depthTex, getUV(localUV, frame)).r;
    const uv1 = add(localUV, mul(viewTS, mul(sub(float(0.5), d0), uParallaxStr)));

    const d1 = texture(depthTex, getUV(uv1, frame)).r;
    const uv2 = add(localUV, mul(viewTS, mul(sub(float(0.5), d1), uParallaxStr)));

    const d2 = texture(depthTex, getUV(uv2, frame)).r;
    const uv3 = add(localUV, mul(viewTS, mul(sub(float(0.5), d2), uParallaxStr)));

    return getUV(uv3, frame);
  });

  const phDepth = new THREE.DepthTexture(4, 4);
  phDepth.compareFunction = THREE.LessEqualCompare;
  const uShadowMapDepth = texture(phDepth);

  let shadowFilterFn = PCFSoftShadowFilter;
  const smt = renderer.shadowMap.type;
  if (smt === THREE.BasicShadowMap) shadowFilterFn = BasicShadowFilter;
  else if (smt === THREE.PCFShadowMap) shadowFilterFn = PCFShadowFilter;

  const sunShadow = directionalShadowVisibility(
    dirLight,
    uShadowMapDepth,
    shadowFilterFn,
  );

  // ── fragment stage ──
  const colorNodeFn = Fn(() => {
    const nm1_f = vec2(sub(uSPS, 1), sub(uSPS, 1));

    const cn1 = decode(vS1, nm1_f);
    const cn2 = decode(vS2, nm1_f);
    const cn3 = decode(vS3, nm1_f);

    const puv1 = depthParallax(vUV1, cn1, vS1);
    const puv2 = depthParallax(vUV2, cn2, vS2);
    const puv3 = depthParallax(vUV3, cn3, vS3);

    const c1 = texture(colorTex, puv1);
    const c2 = texture(colorTex, puv2);
    const c3 = texture(colorTex, puv3);

    // Dominant sprite selection (single cell — crisp silhouettes, no ghosting)
    const isDom1 = vWeight.x
      .greaterThanEqual(vWeight.y)
      .and(vWeight.x.greaterThanEqual(vWeight.z));
    const isDom2 = vWeight.y.greaterThanEqual(vWeight.z);
    const domAlpha = select(isDom1, c1.a, select(isDom2, c2.a, c3.a));
    const domRgb = select(isDom1, c1.rgb, select(isDom2, c2.rgb, c3.rgb));

    // IGN dither (optional alternative)
    const wSum = add(add(vWeight.x, vWeight.y), vWeight.z);
    const nw1 = div(vWeight.x, max(wSum, float(0.001)));
    const px = viewportCoordinate.xy;
    const ign = fract(
      mul(
        float(52.9829189),
        fract(add(mul(float(0.06711056), px.x), mul(float(0.00583715), px.y))),
      ),
    );
    const nw12 = div(add(vWeight.x, vWeight.y), max(wSum, float(0.001)));
    const ditS1 = ign.lessThan(nw1);
    const ditS2 = ign.lessThan(nw12);
    const ditAlpha = select(ditS1, c1.a, select(ditS2, c2.a, c3.a));
    const ditRgb = select(ditS1, c1.rgb, select(ditS2, c2.rgb, c3.rgb));

    const useDit = uDither.greaterThan(float(0.5));
    const selAlpha = select(useDit, ditAlpha, domAlpha);
    const selRgb = select(useDit, ditRgb, domRgb);

    const edgeW = mul(fwidth(selAlpha), uEdgeSmooth);
    const alpha = smoothstep(
      sub(uAlphaCutoff, edgeW),
      add(uAlphaCutoff, edgeW),
      selAlpha,
    );
    const albedo = saturate(mul(selRgb, div(1, max(selAlpha, float(0.001)))));

    // Normals
    const n1 = texture(normalTex, puv1).xyz;
    const n2 = texture(normalTex, puv2).xyz;
    const n3 = texture(normalTex, puv3).xyz;
    const normEnc = select(
      useDit,
      select(ditS1, n1, select(ditS2, n2, n3)),
      select(isDom1, n1, select(isDom2, n2, n3)),
    );
    const wNormRaw = normalize(sub(mul(normEnc, 2.0), 1.0));
    const wNorm = normalize(mix(vec3(0, 1, 0), wNormRaw, uNormStr));

    // Roughness / metalness
    const rm1 = texture(rmTex, puv1);
    const rm2 = texture(rmTex, puv2);
    const rm3 = texture(rmTex, puv3);
    const rmSel = select(
      useDit,
      select(ditS1, rm1, select(ditS2, rm2, rm3)),
      select(isDom1, rm1, select(isDom2, rm2, rm3)),
    );
    const rough = clamp(rmSel.x, float(0.05), float(1));
    const metal = clamp(rmSel.y, float(0), float(1));
    const oneMinusMetal = sub(float(1), metal);

    // ── Debug: normals viz ──
    const isNormViz = uDebugMode
      .greaterThan(float(0.5))
      .and(uDebugMode.lessThan(float(1.5)));
    // ── Debug: raw atlas ──
    const isRawViz = uDebugMode.greaterThan(float(1.5));

    // ── PBR lighting ──
    const INV_PI = float(0.31831);
    const viewDir = normalize(sub(cameraPosition, positionWorld));
    const rawNdotL = dot(wNorm, uSunDir);
    const NdotL = max(rawNdotL, float(0));
    const NdotLWrap = div(
      add(NdotL, uDiffuseWrap),
      add(float(1), uDiffuseWrap),
    );
    const NdotV = max(dot(wNorm, viewDir), float(0.001));

    const diffuse = mul(
      mul(mul(mul(NdotLWrap, INV_PI), oneMinusMetal), albedo),
      uSunColor,
    );

    const H = normalize(add(uSunDir, viewDir));
    const NdotH = max(dot(wNorm, H), float(0));
    const HdotV = max(dot(H, viewDir), float(0.001));
    const a2 = pow(rough, float(4));
    const dNH = add(mul(mul(NdotH, NdotH), sub(a2, 1)), 1);
    const D = div(a2, add(mul(float(3.14159), mul(dNH, dNH)), float(0.001)));
    const F0 = mix(vec3(0.04, 0.04, 0.04), albedo, metal);
    const F = add(
      F0,
      mul(sub(vec3(1, 1, 1), F0), pow(sub(1, HdotV), float(5))),
    );
    const k = div(mul(add(rough, 1), add(rough, 1)), 8);
    const G1V = div(NdotV, add(mul(NdotV, sub(1, k)), k));
    const G1L = div(NdotL, add(mul(NdotL, sub(1, k)), add(k, float(0.001))));
    const spec = mul(
      div(
        mul(mul(D, F), mul(G1V, G1L)),
        add(mul(mul(4, NdotV), NdotL), float(0.001)),
      ),
      mul(uSunColor, max(NdotL, float(0))),
    );

    const hemiT = mul(add(wNorm.y, 1.0), 0.5);
    const hemiIrrad = add(uAmbColor, mix(uHemiGround, uHemiSky, hemiT));
    const ambient = mul(mul(mul(hemiIrrad, INV_PI), oneMinusMetal), albedo);

    const oneMinusRough = sub(float(1), rough);
    const maxSmooth = max(
      vec3(oneMinusRough, oneMinusRough, oneMinusRough),
      F0,
    );
    const envF = add(
      F0,
      mul(sub(maxSmooth, F0), pow(sub(float(1), NdotV), float(5))),
    );
    const envColor = mix(uHemiGround, uHemiSky, hemiT);
    const indirectSpec = mul(envF, envColor);

    const rim = mul(mul(uRimStr, pow(sub(1, NdotV), uRimPow)), uRimCol);
    const sunLit = add(diffuse, spec);
    const shadowedSun = mul(sunLit, sunShadow);
    const lit = add(add(add(shadowedSun, ambient), indirectSpec), rim);

    // Final output: pick debug mode or full PBR
    const normVizColor = mul(add(wNorm, float(1)), float(0.5));
    const finalRgb = select(
      isRawViz,
      albedo,
      select(isNormViz, normVizColor, lit),
    );

    return vec4(finalRgb, alpha);
  });

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
  mat.positionNode = posNodeFn();
  mat.colorNode = colorNodeFn();
  mat.transparent = false;
  mat.alphaTest = 0.005;
  mat.depthWrite = true;

  mat.receiveShadow = true;
  mat.receivedShadowPositionNode = Fn(() => positionWorld)();

  return {
    mat,
    uCenter,
    uSunDir,
    uSunColor,
    uAmbColor,
    uHemiSky,
    uHemiGround,
    uNormStr,
    uRimStr,
    uRimPow,
    uRimCol,
    uAlphaCutoff,
    uEdgeSmooth,
    uDiffuseWrap,
    uParallaxStr,
    uScale,
    uSPS,
    uDither,
    uDebugMode,
    uFreeze,
    uFreezeDir,
    uShadowMapDepth,
    shadowPlaceholder: phDepth,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  PNG Export
// ═══════════════════════════════════════════════════════════════════════════

function exportPNG(pixels, width, height, filename) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = y * width * 4;
    img.data.set(pixels.subarray(srcRow, srcRow + width * 4), dstRow);
  }
  ctx.putImageData(img, 0, 0);
  canvas.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════════════════

export async function run() {
  const info = document.getElementById("info");
  const dropOverlay = document.getElementById("drop-overlay");
  const elLd = document.getElementById("ld");
  const elLdMsg = document.getElementById("ld-msg");
  const elLst = document.getElementById("lst");
  const elDockAp = document.getElementById("dock-ap");
  const elCz = document.getElementById("cz");
  const zcCanvas = document.getElementById("zc");
  const elZl = document.getElementById("zl");

  function setBakeOverlay(visible, msg = "", sub = "") {
    if (!elLd) return;
    if (visible) {
      elLd.classList.add("visible");
      if (elLdMsg) elLdMsg.textContent = msg || "Working…";
      if (elLst) elLst.textContent = sub;
    } else {
      elLd.classList.remove("visible");
    }
  }

  info.textContent = "Initialising WebGPU…";

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.insertBefore(renderer.domElement, document.body.firstChild);
  renderer.domElement.style.touchAction = "none";

  const maxAniso = renderer.capabilities
    ? renderer.capabilities.maxAnisotropy || 16
    : 16;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);

  const camera = new THREE.PerspectiveCamera(
    50,
    innerWidth / innerHeight,
    0.1,
    500,
  );
  camera.position.set(0, 3, 10);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  const dirLight = new THREE.DirectionalLight(0xfff5e0, 3.0);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 80;
  const sh = 26;
  dirLight.shadow.camera.left = -sh;
  dirLight.shadow.camera.right = sh;
  dirLight.shadow.camera.top = sh;
  dirLight.shadow.camera.bottom = -sh;
  dirLight.shadow.bias = -0.0002;
  dirLight.shadow.normalBias = 0.025;
  dirLight.target.position.copy(controls.target);
  scene.add(dirLight);
  scene.add(dirLight.target);
  const hemiLight = new THREE.HemisphereLight(0x88bbee, 0x556633, 0.7);
  scene.add(hemiLight);
  const ambLight = new THREE.AmbientLight(0xc0d0e0, 0.35);
  scene.add(ambLight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({
      color: 0x5a7a4a,
      roughness: 0.85,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  function applyShadowToMeshes(root, cast, receive) {
    if (!root) return;
    root.traverse((c) => {
      if (c.isMesh) {
        c.castShadow = cast;
        c.receiveShadow = receive;
      }
    });
  }

  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(
    "https://www.gstatic.com/draco/versioned/decoders/1.5.7/",
  );
  gltfLoader.setDRACOLoader(dracoLoader);

  // ═══════════════════════════════════════════════════════════════════════
  //  State
  // ═══════════════════════════════════════════════════════════════════════

  let sourceGroup = null;
  let bakeMeshData = [];
  let sourceBSphere = null;
  let sourceGroundY = 0;
  let impostor = null;
  let imp = null;
  let atlasResult = null;
  let isBaking = false;
  /** Hemi-octa triplet of cells + weights for atlas overlay; null if full octa or no imp. */
  let activeCells = null;
  let lastDockRedraw = 0;
  let currentModelName = "TorusKnot";

  // FPS counter
  let frameCount = 0,
    lastFpsTime = performance.now(),
    fps = 0;

  function clearDockCanvases() {
    for (const id of ["dock-ac", "dock-an", "dock-arm", "dock-ad"]) {
      const c = document.getElementById(id);
      if (!c) continue;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#12121a";
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }

  function clearScene() {
    if (sourceGroup) {
      scene.remove(sourceGroup);
      sourceGroup = null;
    }
    if (impostor) {
      scene.remove(impostor);
      impostor.geometry.dispose();
      impostor = null;
    }
    if (atlasResult) {
      atlasResult.colorTex.dispose();
      atlasResult.normalTex.dispose();
      atlasResult.rmTex.dispose();
      atlasResult.depthTex.dispose();
      atlasResult = null;
    }
    imp = null;
    activeCells = null;
    bakeMeshData = [];
    clearDockCanvases();
  }

  function extractBakeData(obj) {
    const data = [];
    obj.updateMatrixWorld(true);
    obj.traverse((child) => {
      if (!child.isMesh) return;
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      data.push({ geometry: geo, material: child.material });
    });
    return data;
  }

  function computeBounds(meshData) {
    const box = new THREE.Box3();
    for (const { geometry } of meshData) {
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox);
    }
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    return { sphere, box };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Model loaders
  // ═══════════════════════════════════════════════════════════════════════

  function loadPrimitive(type) {
    clearScene();
    let geo, mat;
    switch (type) {
      case "Sphere":
        geo = new THREE.SphereGeometry(1.2, 64, 64);
        mat = new THREE.MeshStandardMaterial({
          color: 0x7fd0ff,
          roughness: 0.35,
          metalness: 0.15,
        });
        break;
      case "Torus":
        geo = new THREE.TorusGeometry(1, 0.4, 32, 64);
        mat = new THREE.MeshStandardMaterial({
          color: 0xdd8844,
          roughness: 0.4,
          metalness: 0.05,
        });
        break;
      case "Cylinder":
        geo = new THREE.CylinderGeometry(0.6, 0.8, 2.4, 32);
        mat = new THREE.MeshStandardMaterial({
          color: 0x88cc66,
          roughness: 0.6,
          metalness: 0.0,
        });
        break;
      default:
        geo = new THREE.TorusKnotGeometry(1, 0.35, 256, 64);
        mat = new THREE.MeshStandardMaterial({
          color: 0x7fd0ff,
          roughness: 0.35,
          metalness: 0.15,
        });
    }
    currentModelName = type;
    const mesh = new THREE.Mesh(geo, mat);
    sourceGroup = new THREE.Group();
    sourceGroup.add(mesh);
    bakeMeshData = extractBakeData(sourceGroup);
    const bounds = computeBounds(bakeMeshData);
    sourceBSphere = bounds.sphere;
    sourceGroundY = -bounds.box.min.y;
    sourceGroup.position.set(-3, sourceGroundY, 0);
    scene.add(sourceGroup);
    applyShadowToMeshes(sourceGroup, true, true);
    P.roughness = mat.roughness;
    P.metalness = mat.metalness;
  }

  async function setupGLBScene(gltf, name) {
    clearScene();
    currentModelName = name;
    gltf.scene.updateMatrixWorld(true);
    bakeMeshData = extractBakeData(gltf.scene);
    if (bakeMeshData.length === 0) {
      info.textContent = "No meshes found.";
      clearDockCanvases();
      return;
    }
    const bounds = computeBounds(bakeMeshData);
    sourceBSphere = bounds.sphere;
    sourceGroundY = -bounds.box.min.y;
    const firstMat = bakeMeshData[0].material;
    const displayGroup = new THREE.Group();
    gltf.scene.traverse((c) => {
      if (c.isMesh) displayGroup.add(c.clone());
    });
    sourceGroup = displayGroup;
    sourceGroup.position.set(-3, sourceGroundY, 0);
    scene.add(sourceGroup);
    applyShadowToMeshes(sourceGroup, true, true);
    P.roughness = firstMat.roughness !== undefined ? firstMat.roughness : 0.5;
    P.metalness = firstMat.metalness !== undefined ? firstMat.metalness : 0.0;
    await rebake();
  }

  async function loadGLBPath(path, name) {
    info.textContent = `Loading ${name}…`;
    try {
      const gltf = await gltfLoader.loadAsync(path);
      await setupGLBScene(gltf, name);
    } catch (e) {
      info.textContent = "Load error: " + e.message;
      console.error(e);
    }
  }

  async function loadGLB(file) {
    info.textContent = `Loading ${file.name}…`;
    const url = URL.createObjectURL(file);
    try {
      const gltf = await gltfLoader.loadAsync(url);
      URL.revokeObjectURL(url);
      await setupGLBScene(gltf, file.name.replace(/\.[^.]+$/, ""));
    } catch (e) {
      URL.revokeObjectURL(url);
      info.textContent = "GLB load error: " + e.message;
      console.error(e);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Rebake
  // ═══════════════════════════════════════════════════════════════════════

  async function rebake() {
    if (isBaking || bakeMeshData.length === 0) return;
    isBaking = true;
    setBakeOverlay(
      true,
      "Baking atlas…",
      "Color, normal, RM, depth — each cell read back from GPU",
    );
    info.textContent = "Baking…";

    if (impostor) {
      scene.remove(impostor);
      impostor.geometry.dispose();
      impostor = null;
    }
    if (atlasResult) {
      atlasResult.colorTex.dispose();
      atlasResult.normalTex.dispose();
      atlasResult.rmTex.dispose();
      atlasResult.depthTex.dispose();
    }

    try {
      if (elLst) elLst.textContent = "Rendering ortho views + readPixels…";
      atlasResult = await bakeAtlases(renderer, bakeMeshData, {
        grid: P.grid,
        atlasSize: P.atlasSize,
        maxAniso,
        cellPad: P.cellPad,
        fullOctahedral: P.fullOctahedral,
      });

      if (elLst) elLst.textContent = "Building impostor material…";
      info.textContent = "Creating impostor…";
      imp = createImpostorMaterial(
        atlasResult.colorTex,
        atlasResult.normalTex,
        atlasResult.rmTex,
        atlasResult.depthTex,
        atlasResult.radius,
        P.grid,
        P.atlasSize,
        P.cellPad,
        dirLight,
        renderer,
        { fullOctahedral: P.fullOctahedral },
      );

      const impostorGeo = new THREE.PlaneGeometry(1, 1);
      impostor = new THREE.Mesh(impostorGeo, imp.mat);
      const srcWorldCenter = new THREE.Vector3()
        .copy(atlasResult.center)
        .add(sourceGroup.position);
      const R = atlasResult.radius;
      const impWorldCenter = srcWorldCenter
        .clone()
        .add(new THREE.Vector3(6, 0, 0));
      impWorldCenter.y += R * (1 - 1 / BAKE_SPHERE_MARGIN);

      impostor.position.copy(impWorldCenter);
      impostor.scale.setScalar(2 * R);
      impostor.frustumCulled = false;
      imp.uCenter.value.copy(impWorldCenter);
      impostor.castShadow = P.impostorCastShadow;
      impostor.receiveShadow = true;
      scene.add(impostor);

      info.textContent = "Compiling shaders…";
      if (elLst) elLst.textContent = "compileAsync(scene, camera)…";
      await renderer.compileAsync(scene, camera);
      computeActiveCellsForDock();
      drawAtlasDock();
      syncParams();
      updateInfo();
    } catch (e) {
      info.textContent = "Bake error: " + e.message;
      console.error(e);
      atlasResult = null;
      activeCells = null;
      clearDockCanvases();
      updateStatsPanel();
    }
    setBakeOverlay(false);
    isBaking = false;
  }

  function computeActiveCellsForDock() {
    if (!atlasResult || !imp || P.fullOctahedral) {
      activeCells = null;
      return;
    }
    const center = imp.uCenter.value;
    const vd = new THREE.Vector3()
      .subVectors(camera.position, center)
      .normalize();
    const enc = hemiOctaEncode(vd);
    const S = P.grid;
    const Nm1 = S - 1;
    const gx = enc.u * Nm1;
    const gy = enc.v * Nm1;
    const fx = Math.min(Math.floor(gx), Nm1);
    const fy = Math.min(Math.floor(gy), Nm1);
    const frx = gx - fx;
    const fry = gy - fy;
    const wx = Math.min(1 - frx, 1 - fry);
    const wy = Math.abs(frx - fry);
    const wz = Math.min(frx, fry);
    const ww = frx > fry ? 1 : 0;
    activeCells = {
      s1: [fx, fy],
      s2: [
        Math.min(fx + (ww ? 1 : 0), Nm1),
        Math.min(fy + (ww ? 0 : 1), Nm1),
      ],
      s3: [Math.min(fx + 1, Nm1), Math.min(fy + 1, Nm1)],
      weights: [wx, wy, wz],
    };
  }

  function drawAtlasDock() {
    if (!atlasResult) {
      clearDockCanvases();
      return;
    }
    const w = atlasResult.atlasSize;
    const S = atlasResult.grid;
    const sz = 152;
    const showGrid = P.showAtlasGrid;
    const showActive = P.showAtlasActive && !P.fullOctahedral;

    const drawLayer = (pixels, canvasId, overlayGrid) => {
      const c = document.getElementById(canvasId);
      if (!c || !pixels) return;
      const ctx = c.getContext("2d");
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = w;
      const clamped = new Uint8ClampedArray(
        pixels.buffer,
        pixels.byteOffset,
        w * w * 4,
      );
      tmp.getContext("2d").putImageData(new ImageData(clamped, w, w), 0, 0);
      ctx.clearRect(0, 0, sz, sz);
      ctx.save();
      ctx.translate(0, sz);
      ctx.scale(1, -1);
      ctx.drawImage(tmp, 0, 0, sz, sz);
      ctx.restore();

      if (overlayGrid) {
        const step = sz / S;
        ctx.strokeStyle = "rgba(255,255,255,0.28)";
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= S; i++) {
          const p = i * step;
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, sz);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, p);
          ctx.lineTo(sz, p);
          ctx.stroke();
        }
      }
      if (showActive && activeCells && overlayGrid) {
        const step = sz / S;
        const { s1, s2, s3, weights } = activeCells;
        [
          [s1, weights[0], "255,80,80"],
          [s2, weights[1], "80,255,80"],
          [s3, weights[2], "80,80,255"],
        ].forEach(([cell, wt, col]) => {
          if (wt < 0.01) return;
          const a = 0.14 + wt * 0.5;
          const x = cell[0] * step;
          const y = (S - 1 - cell[1]) * step;
          ctx.fillStyle = `rgba(${col},${a})`;
          ctx.fillRect(x, y, step, step);
          ctx.strokeStyle = `rgba(${col},0.95)`;
          ctx.lineWidth = 1;
          ctx.strokeRect(x + 0.5, y + 0.5, step - 1, step - 1);
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.font = "bold 8px monospace";
          ctx.fillText(((wt * 100) | 0) + "%", x + 2, y + step - 2);
        });
      }
    };

    const colorOverlay = showGrid || (showActive && activeCells);
    drawLayer(atlasResult.colorPixels, "dock-ac", colorOverlay);
    drawLayer(atlasResult.normalPixels, "dock-an", showGrid);
    drawLayer(atlasResult.rmPixels, "dock-arm", showGrid);
    drawLayer(atlasResult.depthPixels, "dock-ad", showGrid);
  }

  function updateStatsPanel() {
    const q = (id, t) => {
      const el = document.getElementById(id);
      if (el) el.textContent = t;
    };
    q("st-fps", String(fps));
    if (atlasResult) {
      q("st-atlas", `${atlasResult.atlasSize}²`);
      q("st-grid", `${atlasResult.grid}×${atlasResult.grid}`);
      q(
        "st-csz",
        `${Math.floor(atlasResult.atlasSize / atlasResult.grid)}px`,
      );
      q("st-pad", `${atlasResult.cellPad}px`);
    } else {
      q("st-atlas", "—");
      q("st-grid", "—");
      q("st-csz", "—");
      q("st-pad", "—");
    }
    q("st-mesh", bakeMeshData.length ? String(bakeMeshData.length) : "—");
    q(
      "st-tri",
      bakeMeshData.length
        ? countRefTriangles(bakeMeshData).toLocaleString()
        : "—",
    );
    const t = controls.target;
    const dist = camera.position.distanceTo(t);
    q("st-dist", dist.toFixed(1));
    const dx = camera.position.x - t.x;
    const dz = camera.position.z - t.z;
    q(
      "st-ang",
      `${(((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360).toFixed(0)}°`,
    );
    if (activeCells && !P.fullOctahedral) {
      const { s1, s2, s3 } = activeCells;
      q(
        "st-act",
        `(${s1[0]},${s1[1]})·(${s2[0]},${s2[1]})·(${s3[0]},${s3[1]})`,
      );
    } else if (P.fullOctahedral) {
      q("st-act", "full octa");
    } else {
      q("st-act", "—");
    }
  }

  function updateInfo() {
    const parts = [currentModelName];
    if (P.freeze) parts.push("FROZEN [F]");
    if (P.autoOrbit) parts.push("ORBIT [O]");
    if (P.debugMode === 1) parts.push("NORMALS [N]");
    if (P.debugMode === 2) parts.push("RAW [R]");
    info.textContent = parts.join(" · ");
  }

  function openCellZoomFromEvent(e, pixels, channelLabel) {
    if (!atlasResult || !zcCanvas || !elCz || !elZl) return;
    const w = atlasResult.atlasSize;
    const S = atlasResult.grid;
    const cs = w / S;
    const pd = atlasResult.cellPad;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const col = Math.min(Math.floor(x * S), S - 1);
    const row = S - 1 - Math.min(Math.floor(y * S), S - 1);
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = w;
    const clamped = new Uint8ClampedArray(
      pixels.buffer,
      pixels.byteOffset,
      w * w * 4,
    );
    tmp.getContext("2d").putImageData(new ImageData(clamped, w, w), 0, 0);
    const ctx = zcCanvas.getContext("2d");
    ctx.clearRect(0, 0, 200, 200);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(0, 200);
    ctx.scale(1, -1);
    ctx.drawImage(tmp, col * cs, row * cs, cs, cs, 0, 0, 200, 200);
    ctx.restore();
    const pp = (pd / cs) * 200;
    if (pp > 0 && pd > 0) {
      ctx.strokeStyle = "rgba(255,100,100,0.75)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(pp, pp, 200 - pp * 2, 200 - pp * 2);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,100,100,0.55)";
      ctx.font = "9px monospace";
      ctx.fillText(`pad=${pd}px`, 2, 10);
    }
    elZl.textContent = `${channelLabel} cell (${col},${row})`;
    elCz.style.display = "block";
    elCz.style.left = `${Math.min(e.clientX + 10, innerWidth - 220)}px`;
    elCz.style.top = `${Math.min(e.clientY + 10, innerHeight - 240)}px`;
    setTimeout(() => {
      elCz.style.display = "none";
    }, 4500);
  }

  function attachDockZoomHandlers() {
    const pairs = [
      ["dock-ac", () => atlasResult?.colorPixels, "Color"],
      ["dock-an", () => atlasResult?.normalPixels, "Normal"],
      ["dock-arm", () => atlasResult?.rmPixels, "R/M"],
      ["dock-ad", () => atlasResult?.depthPixels, "Depth"],
    ];
    for (const [id, getPx, label] of pairs) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const pixels = getPx();
        if (!atlasResult || !pixels) return;
        openCellZoomFromEvent(e, pixels, label);
      });
    }
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#dock-ap") && !e.target.closest("#cz"))
        elCz.style.display = "none";
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Params + sync
  // ═══════════════════════════════════════════════════════════════════════

  const P = {
    model: "TorusKnot",
    grid: 12,
    atlasSize: 2048,
    cellPad: 4,
    showAtlas: true,
    showAtlasGrid: false,
    showAtlasActive: true,
    showOriginal: true,
    showImpostor: true,
    sunAzimuth: 225,
    sunElevation: 56,
    sunIntensity: 3.0,
    exposure: 1.0,
    roughness: 0.35,
    metalness: 0.15,
    normalStr: 1.0,
    dither: false,
    rimStr: 0.14,
    rimPow: 3.0,
    alphaCutoff: 0.15,
    edgeSmooth: 1.5,
    diffuseWrap: 0.0,
    parallaxStr: 0.0,
    impostorCastShadow: false,
    debugMode: 0,
    freeze: false,
    autoOrbit: false,
    fullOctahedral: false,
  };

  function syncParams() {
    const az = (P.sunAzimuth * Math.PI) / 180;
    const el = (P.sunElevation * Math.PI) / 180;
    const d = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    ).normalize();
    dirLight.position.copy(d).multiplyScalar(20);
    dirLight.target.position.copy(controls.target);
    dirLight.intensity = P.sunIntensity;
    renderer.toneMappingExposure = P.exposure;

    if (imp) {
      imp.uSunDir.value.copy(d);
      imp.uSunColor.value.set(
        1.0 * P.sunIntensity,
        0.854 * P.sunIntensity,
        0.723 * P.sunIntensity,
      );
      imp.uHemiSky.value.set(
        hemiLight.color.r * hemiLight.intensity,
        hemiLight.color.g * hemiLight.intensity,
        hemiLight.color.b * hemiLight.intensity,
      );
      imp.uHemiGround.value.set(
        hemiLight.groundColor.r * hemiLight.intensity,
        hemiLight.groundColor.g * hemiLight.intensity,
        hemiLight.groundColor.b * hemiLight.intensity,
      );
      imp.uAmbColor.value.set(
        ambLight.color.r * ambLight.intensity,
        ambLight.color.g * ambLight.intensity,
        ambLight.color.b * ambLight.intensity,
      );
      imp.uNormStr.value = P.normalStr;
      imp.uDither.value = P.dither ? 1 : 0;
      imp.uRimStr.value = P.rimStr;
      imp.uRimPow.value = P.rimPow;
      imp.uAlphaCutoff.value = P.alphaCutoff;
      imp.uEdgeSmooth.value = P.edgeSmooth;
      imp.uDiffuseWrap.value = P.diffuseWrap;
      imp.uParallaxStr.value = P.parallaxStr;
      imp.uDebugMode.value = P.debugMode;
      imp.uFreeze.value = P.freeze ? 1 : 0;
    }

    if (sourceGroup) {
      sourceGroup.visible = P.showOriginal;
      sourceGroup.traverse((c) => {
        if (c.isMesh && c.material && c.material.isMeshStandardMaterial) {
          c.material.roughness = P.roughness;
          c.material.metalness = P.metalness;
        }
      });
    }
    if (impostor) {
      impostor.visible = P.showImpostor;
      impostor.castShadow = P.impostorCastShadow;
    }
    if (elDockAp) elDockAp.style.display = P.showAtlas ? "flex" : "none";

    updateInfo();
  }

  function toggleFreeze() {
    P.freeze = !P.freeze;
    if (P.freeze && imp) {
      const camLocal = new THREE.Vector3()
        .subVectors(camera.position, imp.uCenter.value)
        .divideScalar(imp.uScale.value);
      imp.uFreezeDir.value.copy(camLocal.normalize());
    }
    syncParams();
    if (freezeCtrl) freezeCtrl.updateDisplay();
  }

  // ── file input ──
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".glb,.gltf";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length) loadGLB(fileInput.files[0]);
    fileInput.value = "";
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  GUI
  // ═══════════════════════════════════════════════════════════════════════

  const gui = new GUI({ title: "Octahedral Final Editor", width: 240 });
  gui.domElement.style.cssText = "position:fixed;top:8px;right:8px;z-index:10;";

  const GLB_MODELS = {
    "Pine 2": modelUrl("pine2.glb"),
    "Pine 3": modelUrl("pine3.glb"),
    "Cherry Tree": modelUrl("japanese_cherry_tree.glb"),
    Cypress: modelUrl("cypress_tree_compressed.glb"),
    "Palm Tree": modelUrl("realistic_palm_tree_free.glb"),
    Rock: modelUrl("rock_boulder.glb"),
  };
  const ALL_MODELS = [
    "TorusKnot",
    "Sphere",
    "Torus",
    "Cylinder",
    ...Object.keys(GLB_MODELS),
  ];

  const fModel = gui.addFolder("Model");
  fModel
    .add(P, "model", ALL_MODELS)
    .name("Model")
    .onChange((v) => {
      if (GLB_MODELS[v]) {
        loadGLBPath(GLB_MODELS[v], v);
      } else {
        loadPrimitive(v);
        rebake();
      }
    });
  fModel.add({ load: () => fileInput.click() }, "load").name("Load GLB…");
  fModel.add(P, "showOriginal").name("Show original").onChange(syncParams);
  fModel.add(P, "showImpostor").name("Show impostor").onChange(syncParams);

  const fAtlas = gui.addFolder("Atlas");
  fAtlas
    .add(P, "grid", [4, 6, 8, 10, 12, 14, 16])
    .name("Grid")
    .onChange(() => rebake());
  fAtlas
    .add(P, "atlasSize", [512, 1024, 2048, 4096])
    .name("Resolution")
    .onChange(() => rebake());
  fAtlas
    .add(P, "cellPad", 0, 8, 1)
    .name("Cell padding")
    .onChange(() => rebake());
  fAtlas.add(P, "fullOctahedral").name("Full octahedral").onChange(() => rebake());
  fAtlas.add(P, "showAtlas").name("Show atlas panel").onChange(syncParams);
  fAtlas.add({ rebake: () => rebake() }, "rebake").name("Rebake now");

  const fSun = gui.addFolder("Sun");
  fSun.add(P, "sunAzimuth", 0, 360, 1).name("Azimuth").onChange(syncParams);
  fSun
    .add(P, "sunElevation", 5, 90, 0.5)
    .name("Elevation")
    .onChange(syncParams);
  fSun
    .add(P, "sunIntensity", 0.2, 5, 0.1)
    .name("Intensity")
    .onChange(syncParams);
  fSun.add(P, "exposure", 0.2, 3, 0.05).name("Exposure").onChange(syncParams);

  const fMat = gui.addFolder("Material (original)");
  fMat
    .add(P, "roughness", 0.05, 1, 0.01)
    .name("Roughness")
    .onChange(syncParams);
  fMat.add(P, "metalness", 0, 1, 0.01).name("Metalness").onChange(syncParams);
  fMat
    .add(P, "normalStr", 0, 1, 0.02)
    .name("Normal strength")
    .onChange(syncParams);

  const fRender = gui.addFolder("Rendering");
  fRender.add(P, "dither").name("Dither crossfade").onChange(syncParams);
  fRender
    .add(P, "rimStr", 0, 0.5, 0.01)
    .name("Rim strength")
    .onChange(syncParams);
  fRender.add(P, "rimPow", 1, 8, 0.5).name("Rim power").onChange(syncParams);
  fRender
    .add(P, "alphaCutoff", 0.01, 0.5, 0.01)
    .name("Alpha cutoff")
    .onChange(syncParams);
  fRender.add(P, "edgeSmooth", 0, 4, 0.1).name("Edge AA").onChange(syncParams);
  fRender
    .add(P, "diffuseWrap", 0, 0.8, 0.05)
    .name("Diffuse wrap")
    .onChange(syncParams);
  fRender
    .add(P, "parallaxStr", 0, 0.5, 0.01)
    .name("Depth parallax")
    .onChange(syncParams);
  fRender
    .add(P, "impostorCastShadow")
    .name("Cast shadow")
    .onChange(syncParams);

  const fDebug = gui.addFolder("Debug / View");
  fDebug
    .add(P, "debugMode", {
      "Full PBR": 0,
      "Normals [N]": 1,
      "Raw atlas [R]": 2,
    })
    .name("Display")
    .onChange(syncParams);
  let freezeCtrl = fDebug
    .add(P, "freeze")
    .name("Freeze angle [F]")
    .onChange(() => {
      if (P.freeze && imp) {
        const camLocal = new THREE.Vector3()
          .subVectors(camera.position, imp.uCenter.value)
          .divideScalar(imp.uScale.value);
        imp.uFreezeDir.value.copy(camLocal.normalize());
      }
      syncParams();
    });
  fDebug.add(P, "autoOrbit").name("Auto-orbit [O]").onChange(syncParams);
  fDebug
    .add(P, "showAtlasGrid")
    .name("Dock: grid lines")
    .onChange(() => {
      drawAtlasDock();
      updateStatsPanel();
    });
  fDebug
    .add(P, "showAtlasActive")
    .name("Dock: active cells")
    .onChange(() => {
      drawAtlasDock();
      updateStatsPanel();
    });

  attachDockZoomHandlers();

  const fExport = gui.addFolder("Export");
  fExport
    .add(
      {
        fn: () => {
          if (atlasResult)
            exportPNG(
              atlasResult.colorPixels,
              P.atlasSize,
              P.atlasSize,
              `${currentModelName}_color_${P.grid}x${P.grid}.png`,
            );
        },
      },
      "fn",
    )
    .name("Color atlas → PNG");
  fExport
    .add(
      {
        fn: () => {
          if (atlasResult)
            exportPNG(
              atlasResult.normalPixels,
              P.atlasSize,
              P.atlasSize,
              `${currentModelName}_normal_${P.grid}x${P.grid}.png`,
            );
        },
      },
      "fn",
    )
    .name("Normal atlas → PNG");
  fExport
    .add(
      {
        fn: () => {
          if (atlasResult)
            exportPNG(
              atlasResult.rmPixels,
              P.atlasSize,
              P.atlasSize,
              `${currentModelName}_rm_${P.grid}x${P.grid}.png`,
            );
        },
      },
      "fn",
    )
    .name("Rough/Metal atlas → PNG");
  fExport
    .add(
      {
        fn: () => {
          if (atlasResult)
            exportPNG(
              atlasResult.depthPixels,
              P.atlasSize,
              P.atlasSize,
              `${currentModelName}_depth_${P.grid}x${P.grid}.png`,
            );
        },
      },
      "fn",
    )
    .name("Depth atlas → PNG");

  // ═══════════════════════════════════════════════════════════════════════
  //  Keyboard shortcuts
  // ═══════════════════════════════════════════════════════════════════════

  addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    switch (e.code) {
      case "KeyN":
        P.debugMode = P.debugMode === 1 ? 0 : 1;
        syncParams();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        break;
      case "KeyR":
        P.debugMode = P.debugMode === 2 ? 0 : 2;
        syncParams();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        break;
      case "KeyF":
        toggleFreeze();
        break;
      case "KeyO":
        P.autoOrbit = !P.autoOrbit;
        syncParams();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        break;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Drag-and-drop
  // ═══════════════════════════════════════════════════════════════════════

  let dragCounter = 0;
  document.addEventListener("dragenter", (e) => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.style.display = "flex";
  });
  document.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) {
      dropOverlay.style.display = "none";
      dragCounter = 0;
    }
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.style.display = "none";
    const file = e.dataTransfer.files[0];
    if (file && /\.(glb|gltf)$/i.test(file.name)) loadGLB(file);
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Resize + render loop
  // ═══════════════════════════════════════════════════════════════════════

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  loadPrimitive("TorusKnot");
  syncParams();
  await rebake();

  const _orbitAxis = new THREE.Vector3(0, 1, 0);
  renderer.setAnimationLoop(() => {
    // Auto-orbit
    if (P.autoOrbit) {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(_orbitAxis, 0.005);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();

    if (imp?.uShadowMapDepth) {
      if (P.impostorCastShadow) {
        imp.uShadowMapDepth.value = imp.shadowPlaceholder;
      } else {
        const smDt = dirLight.shadow.map?.depthTexture;
        if (smDt) imp.uShadowMapDepth.value = smDt;
      }
    }

    updateStatsPanel();

    const now = performance.now();
    if (now - lastDockRedraw >= 100) {
      lastDockRedraw = now;
      if (atlasResult && imp) computeActiveCellsForDock();
      if (
        P.showAtlas &&
        atlasResult &&
        (P.showAtlasGrid || P.showAtlasActive)
      )
        drawAtlasDock();
    }

    frameCount++;
    if (now - lastFpsTime >= 500) {
      fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
      frameCount = 0;
      lastFpsTime = now;
      updateInfo();
    }

    renderer.render(scene, camera);
  });
}
