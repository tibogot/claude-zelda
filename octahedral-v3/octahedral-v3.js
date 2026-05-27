/**
 * Octahedral Impostor Editor v3 — same pipeline as v2, custom inspector UI.
 * Entry: octahedral-v3.html
 */
import * as THREE from "three";
import {
  Fn, normalize, sub, mul, add, div, abs, vec2, vec3, vec4, sign, dot, cross,
  floor, fract, min, max, clamp, saturate, texture, cameraPosition,
  positionWorld, positionLocal, positionView, float, uniform, varying, select,
  length, negate, mix, smoothstep, fwidth, pow, sin, cos, normalWorld,
  tangentLocal, viewportCoordinate, uv,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { createUiHelpers } from "./custom-ui.js";

const MODEL_DIR = new URL("../models/", import.meta.url);
const modelUrl = (file) => new URL(file, MODEL_DIR).href;
// Share persisted settings with v2 so only the UI differs between editors.
const STORAGE_KEY = "octa-v2-state";
const LEGACY_STORAGE_KEY = "octa-v3-state";

// ═══════════════════════════════════════════════════════════════════════════
//  Octahedral mapping helpers (CPU side — used for active-cell overlay)
// ═══════════════════════════════════════════════════════════════════════════

function hemiOctaGridToDir(gx, gy, out) {
  out.set(gx - gy, 0, -1 + gx + gy);
  out.y = 1 - Math.abs(out.x) - Math.abs(out.z);
  return out.normalize();
}

function fullOctaGridToDir(gx, gy, out) {
  const ox = gx * 2 - 1, oz = gy * 2 - 1;
  const oy = 1 - Math.abs(ox) - Math.abs(oz);
  if (oy >= 0) out.set(ox, oy, oz);
  else out.set((1 - Math.abs(oz)) * (ox >= 0 ? 1 : -1), oy, (1 - Math.abs(ox)) * (oz >= 0 ? 1 : -1));
  return out.normalize();
}

function hemiOctaEncodeCPU(dir) {
  const sx = Math.sign(dir.x) || 1;
  const sy = Math.sign(dir.y) || 1;
  const sz = Math.sign(dir.z) || 1;
  const d = dir.x * sx + dir.y * sy + dir.z * sz;
  return { u: 0.5 * (1 + dir.x / d + dir.z / d), v: 0.5 * (1 + dir.z / d - dir.x / d) };
}

function countTris(meshData) {
  let t = 0;
  for (const { geometry } of meshData) {
    if (!geometry) continue;
    if (geometry.index) t += geometry.index.count / 3;
    else t += (geometry.attributes?.position?.count || 0) / 3;
  }
  return Math.floor(t);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Per-cell alpha-weighted mipmaps + sRGB + dilation
// ═══════════════════════════════════════════════════════════════════════════

// Stop generating mip levels once cells drop below this many pixels — past
// here the per-cell averages become noise and just confuse trilinear filtering.
const MIN_CELL_PIXELS_FOR_MIP = 4;

function generatePerCellMipmaps(pixels, atlasSize, grid) {
  const levels = [pixels];
  let prevSize = atlasSize;
  while (prevSize > 1) {
    const nextSize = prevSize >> 1;
    if (nextSize < 1) break;
    if (nextSize / grid < MIN_CELL_PIXELS_FOR_MIP) break;
    const prev = levels[levels.length - 1];
    const next = new Uint8Array(nextSize * nextSize * 4);
    const prevCS = prevSize / grid, nextCS = nextSize / grid;
    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        const nx0 = Math.floor(col * nextCS), ny0 = Math.floor(row * nextCS);
        const nw = Math.floor((col + 1) * nextCS) - nx0;
        const nh = Math.floor((row + 1) * nextCS) - ny0;
        for (let dy = 0; dy < nh; dy++) {
          for (let dx = 0; dx < nw; dx++) {
            const sx = Math.floor(col * prevCS) + dx * 2;
            const sy = Math.floor(row * prevCS) + dy * 2;
            const sxMax = Math.floor((col + 1) * prevCS) - 1;
            const syMax = Math.floor((row + 1) * prevCS) - 1;
            let r = 0, g = 0, b = 0, a = 0, cnt = 0;
            for (let oy = 0; oy < 2; oy++) {
              for (let ox = 0; ox < 2; ox++) {
                const px = Math.min(sx + ox, sxMax), py = Math.min(sy + oy, syMax);
                const idx = (py * prevSize + px) * 4;
                const sa = prev[idx + 3];
                if (sa > 0) { r += prev[idx] * sa; g += prev[idx + 1] * sa; b += prev[idx + 2] * sa; a += sa; cnt++; }
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
  const t = new THREE.DataTexture(mipLevels[0], atlasSize, atlasSize, THREE.RGBAFormat);
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

function linearToSrgb(pixels) {
  for (let i = 0; i < pixels.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = pixels[i + c] / 255;
      v = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
      pixels[i + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
}

function downsample2x(src, srcSize) {
  const dstSize = srcSize >> 1;
  const dst = new Uint8Array(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const si = ((y * 2 + dy) * srcSize + (x * 2 + dx)) * 4;
          const sa = src[si + 3];
          r += src[si] * sa; g += src[si + 1] * sa; b += src[si + 2] * sa; a += sa;
        }
      }
      const di = (y * dstSize + x) * 4;
      if (a > 0) {
        dst[di] = Math.round(r / a);
        dst[di + 1] = Math.round(g / a);
        dst[di + 2] = Math.round(b / a);
        dst[di + 3] = Math.round(a / 4);
      }
    }
  }
  return dst;
}

function dilateAtlasEdges(pixels, size, grid, iterations = 8) {
  const cs = size / grid;
  const tmp = new Uint8Array(pixels.length);
  for (let iter = 0; iter < iterations; iter++) {
    tmp.set(pixels);
    for (let cy = 0; cy < grid; cy++) {
      for (let cx = 0; cx < grid; cx++) {
        const x0 = Math.floor(cx * cs), y0 = Math.floor(cy * cs);
        const x1 = Math.floor((cx + 1) * cs), y1 = Math.floor((cy + 1) * cs);
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
                  r += pixels[ni]; g += pixels[ni + 1]; b += pixels[ni + 2]; cnt++;
                }
              }
            }
            if (cnt > 0) {
              tmp[i] = Math.round(r / cnt);
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
//  Atlas bake — 4 passes (color, normal, RM, depth) — supersample 2× + AA
// ═══════════════════════════════════════════════════════════════════════════

const BAKE_SPHERE_MARGIN = 1.02;

async function bakeAtlases(renderer, meshData, opts) {
  const { grid, atlasSize, maxAniso, cellPad = 4, fullOctahedral = false } = opts;
  const gridToDir = fullOctahedral ? fullOctaGridToDir : hemiOctaGridToDir;
  const cs = Math.floor(atlasSize / grid);
  const pad = cellPad;
  const innerCS = cs - pad * 2;

  // Bounds
  const box = new THREE.Box3();
  for (const { geometry } of meshData) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = sphere.radius * BAKE_SPHERE_MARGIN;
  const center = sphere.center.clone();

  const ortho = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.001, radius * 4);
  const dir = new THREE.Vector3();

  const colorScene = new THREE.Scene();
  const normalScene = new THREE.Scene();
  const rmScene = new THREE.Scene();
  const depthScene = new THREE.Scene();

  const BAKE_ALPHA = 0.02;
  const depthNear = radius;
  const depthSpan = 2 * radius;

  for (const { geometry, material } of meshData) {
    const hasAlpha = !!(material.map || material.alphaMap);
    const hasVColors = !!(geometry.attributes.color && material.vertexColors);

    if (material.normalMap && !geometry.attributes.tangent) {
      try { geometry.computeTangents(); } catch (e) { /* skip */ }
    }

    // Color
    const colorMat = new THREE.MeshBasicMaterial({
      color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
      map: material.map || null,
      vertexColors: hasVColors,
      alphaTest: hasAlpha ? BAKE_ALPHA : 0,
      alphaMap: material.alphaMap || null,
      side: THREE.DoubleSide,
    });
    colorScene.add(new THREE.Mesh(geometry, colorMat));

    // Normal — bake world-space normal with normal map applied
    const alphaNode = material.map ? texture(material.map, uv()).a : float(1);
    let bakeNormal = normalWorld;
    if (material.normalMap && geometry.attributes.tangent) {
      const T = normalize(tangentLocal.xyz);
      const N = normalWorld;
      const B = mul(normalize(cross(N, T)), tangentLocal.w);
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

    // R/M
    const r = material.roughness !== undefined ? material.roughness : 0.5;
    const m = material.metalness !== undefined ? material.metalness : 0.0;
    let rNode = float(r), mNode = float(m);
    if (material.roughnessMap) rNode = mul(texture(material.roughnessMap, uv()).g, float(r));
    if (material.metalnessMap) mNode = mul(texture(material.metalnessMap, uv()).b, float(m));
    const rmMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(rNode, mNode, float(0), alphaNode),
    });
    if (hasAlpha) rmMat.alphaTest = BAKE_ALPHA;
    rmScene.add(new THREE.Mesh(geometry.clone(), rmMat));

    // Depth (linear 0..1 from near to far along view dir)
    const depthVal = saturate(div(sub(negate(positionView.z), float(depthNear)), float(depthSpan)));
    const dMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(depthVal, depthVal, depthVal, alphaNode),
    });
    if (hasAlpha) dMat.alphaTest = BAKE_ALPHA;
    depthScene.add(new THREE.Mesh(geometry.clone(), dMat));
  }

  // Supersample 2× then downsample
  const ssScale = 2;
  const ssCS = innerCS * ssScale;
  const cellRT = new THREE.RenderTarget(ssCS, ssCS, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
    samples: 1,
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

  const ssTightRow = ssCS * 4;
  const ssPaddedRow = Math.ceil(ssTightRow / 256) * 256;
  const ssFlipped = new Uint8Array(ssCS * ssCS * 4);

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

        const buf = await renderer.readRenderTargetPixelsAsync(cellRT, 0, 0, ssCS, ssCS);
        const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        const srcStride = src.length > ssCS * ssCS * 4 ? ssPaddedRow : ssTightRow;

        for (let row = 0; row < ssCS; row++) {
          const srcOff = (ssCS - 1 - row) * srcStride;
          const dstOff = row * ssTightRow;
          ssFlipped.set(src.subarray(srcOff, srcOff + ssTightRow), dstOff);
        }

        const dsCell = downsample2x(ssFlipped, ssCS);
        const dsRow = innerCS * 4;
        for (let row = 0; row < innerCS; row++) {
          const dy = gy * cs + pad + row;
          const dstOff = (dy * atlasSize + gx * cs + pad) * 4;
          const srcOff = row * dsRow;
          dest.set(dsCell.subarray(srcOff, srcOff + dsRow), dstOff);
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

  dilateAtlasEdges(colorPixels,  atlasSize, grid, 8);
  dilateAtlasEdges(normalPixels, atlasSize, grid, 8);
  dilateAtlasEdges(rmPixels,     atlasSize, grid, 8);
  dilateAtlasEdges(depthPixels,  atlasSize, grid, 8);

  return {
    colorTex:  makeTexWithMips(generatePerCellMipmaps(colorPixels,  atlasSize, grid), atlasSize, maxAniso, true),
    normalTex: makeTexWithMips(generatePerCellMipmaps(normalPixels, atlasSize, grid), atlasSize, maxAniso, false),
    rmTex:     makeTexWithMips(generatePerCellMipmaps(rmPixels,     atlasSize, grid), atlasSize, maxAniso, false),
    depthTex:  makeTexWithMips(generatePerCellMipmaps(depthPixels,  atlasSize, grid), atlasSize, maxAniso, false),
    colorPixels, normalPixels, rmPixels, depthPixels,
    radius, center, grid, atlasSize, cellPad: pad,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Impostor materials — MeshStandardNodeMaterial + shadow caster
// ═══════════════════════════════════════════════════════════════════════════

function createImpostorMaterials(textures, opts) {
  const { colorTex, normalTex, rmTex, depthTex } = textures;
  const { impostorScale, gridVal, atlasSize, cellPad, fullOctahedral = false } = opts;

  // ── Uniforms (shared between main + depth materials) ────────────────────
  const uSPS         = uniform(float(gridVal));
  const uScale       = uniform(float(impostorScale));
  const uCenter      = uniform(new THREE.Vector3());
  const uTime        = uniform(float(0));

  const uNormStr     = uniform(float(1.0));
  const uAlphaCutoff = uniform(float(0.5));
  const uEdgeSmooth  = uniform(float(1.5));
  const uParallaxStr = uniform(float(0.0));

  const uUseBary     = uniform(float(0));   // 0=dominant, 1=barycentric blend
  const uUseParallax = uniform(float(0));   // 0=off, 1=on
  const uUseDither   = uniform(float(0));   // 0=hard, 1=dither cross-fade

  const uFreeze      = uniform(float(0));
  const uFreezeDir   = uniform(new THREE.Vector3(0, 0, 1));

  const uWindAmp     = uniform(float(0));   // 0 = no wind
  const uWindFreq    = uniform(float(1.5));

  // Translucency (back-lit SSS — added via emissiveNode)
  const uTransAmt    = uniform(float(0));
  const uTransPow    = uniform(float(3.0));
  const uTransTint   = uniform(new THREE.Vector3(0.9, 1.0, 0.7));
  const uSunDir      = uniform(new THREE.Vector3(0.5, 0.7, 0.5).normalize());
  const uSunColor    = uniform(new THREE.Vector3(1, 1, 1));

  // Atlas geometry
  const uCellFrac    = uniform(float(1 / gridVal));
  const uPadFrac     = uniform(float(cellPad / atlasSize));
  const uInnerFrac   = uniform(float(1 / gridVal - (2 * cellPad) / atlasSize));

  // Debug
  const uDebugMode   = uniform(float(0)); // 0=PBR, 1=normals, 2=raw atlas

  // Vertex→fragment varyings
  const vWeight = varying(vec4(0, 0, 0, 0), "vW");
  const vS1     = varying(vec2(0, 0), "vS1");
  const vS2     = varying(vec2(0, 0), "vS2");
  const vS3     = varying(vec2(0, 0), "vS3");
  const vUV1    = varying(vec2(0, 0), "vUV1");
  const vUV2    = varying(vec2(0, 0), "vUV2");
  const vUV3    = varying(vec2(0, 0), "vUV3");

  // ── Octa encode / decode (hemi or full) ──────────────────────────────────
  const encode = fullOctahedral
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

  const decode = fullOctahedral
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

  // Build orthonormal frame on the cell plane
  const planeTangent = Fn(([n]) => {
    const up = mix(vec3(0, 1, 0), vec3(-1, 0, 0),
      max(float(0), sign(sub(n.y, float(0.999)))));
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

  // ── Vertex stage: billboard + cell triplet + wind ────────────────────────
  const positionFn = Fn(() => {
    const nm1 = vec2(sub(uSPS, 1), sub(uSPS, 1));
    const camLocal = mul(sub(cameraPosition, uCenter), div(1, uScale));
    const faceDir = normalize(camLocal);
    const lookupDir = select(uFreeze.greaterThan(float(0.5)), uFreezeDir, faceDir);

    const bv = projectVert(faceDir);
    const viewDir = normalize(sub(bv, camLocal));

    // Cell triplet (hemi octa barycentric)
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
    vS1.assign(s1); vS2.assign(s2); vS3.assign(s3);

    const pn1 = decode(s1, nm1); const pt1 = planeTangent(pn1);
    const pn2 = decode(s2, nm1); const pt2 = planeTangent(pn2);
    const pn3 = decode(s3, nm1); const pt3 = planeTangent(pn3);
    vUV1.assign(planeUV(pn1, pt1, camLocal, viewDir));
    vUV2.assign(planeUV(pn2, pt2, camLocal, viewDir));
    vUV3.assign(planeUV(pn3, pt3, camLocal, viewDir));

    // Wind sway — base-anchored, horizontal in local space
    // heightW = 0 at bottom edge (localY = -0.5), 1 at top edge (localY = 0.5)
    const heightW = add(positionLocal.y, float(0.5));
    const phase = add(mul(uTime, uWindFreq), mul(uCenter.x, float(0.37)));
    const phaseZ = add(mul(uTime, mul(uWindFreq, float(0.83))), mul(uCenter.z, float(0.41)));
    const swayX = mul(sin(phase), uWindAmp);
    const swayZ = mul(cos(phaseZ), mul(uWindAmp, float(0.4)));
    const windOffset = mul(vec3(swayX, float(0), swayZ), heightW);

    return add(bv, windOffset);
  });

  // ── Atlas UV with padding ────────────────────────────────────────────────
  const getUV = Fn(([uvf, frame]) => {
    const clamped = clamp(vec2(uvf.x, uvf.y), float(0), float(1));
    return add(mul(frame, uCellFrac), add(uPadFrac, mul(clamped, uInnerFrac)));
  });

  // ── Depth parallax (3-step iterative) — gated by uUseParallax ────────────
  const depthParallax = Fn(([localUV, cellNorm, frame]) => {
    const V = normalize(sub(cameraPosition, positionWorld));
    const T = planeTangent(cellNorm);
    const B = planeUp(cellNorm, T);
    const VdotN = max(dot(V, cellNorm), float(0.3));
    const eff = mul(uParallaxStr, uUseParallax);
    const viewTS = div(vec2(dot(V, T), dot(V, B)), VdotN);
    const d0 = texture(depthTex, getUV(localUV, frame)).r;
    const uv1 = add(localUV, mul(viewTS, mul(sub(float(0.5), d0), eff)));
    const d1 = texture(depthTex, getUV(uv1, frame)).r;
    const uv2 = add(localUV, mul(viewTS, mul(sub(float(0.5), d1), eff)));
    const d2 = texture(depthTex, getUV(uv2, frame)).r;
    const uv3 = add(localUV, mul(viewTS, mul(sub(float(0.5), d2), eff)));
    return getUV(uv3, frame);
  });

  // ── Fragment: sample 3 cells, blend or pick dominant ─────────────────────
  const nm1f = vec2(sub(uSPS, 1), sub(uSPS, 1));
  const cn1 = decode(vS1, nm1f);
  const cn2 = decode(vS2, nm1f);
  const cn3 = decode(vS3, nm1f);

  const puv1 = depthParallax(vUV1, cn1, vS1);
  const puv2 = depthParallax(vUV2, cn2, vS2);
  const puv3 = depthParallax(vUV3, cn3, vS3);

  const c1 = texture(colorTex, puv1);
  const c2 = texture(colorTex, puv2);
  const c3 = texture(colorTex, puv3);

  const isDom1 = vWeight.x.greaterThanEqual(vWeight.y).and(vWeight.x.greaterThanEqual(vWeight.z));
  const isDom2 = vWeight.y.greaterThanEqual(vWeight.z);
  const domAlpha = select(isDom1, c1.a, select(isDom2, c2.a, c3.a));
  const domRgb = select(isDom1, c1.rgb, select(isDom2, c2.rgb, c3.rgb));

  const wSum = add(add(vWeight.x, vWeight.y), vWeight.z);
  const nw1 = div(vWeight.x, max(wSum, float(0.001)));
  const nw2 = div(vWeight.y, max(wSum, float(0.001)));
  const nw3 = div(vWeight.z, max(wSum, float(0.001)));
  const baryRgb = add(add(mul(c1.rgb, nw1), mul(c2.rgb, nw2)), mul(c3.rgb, nw3));
  const baryAlpha = add(add(mul(c1.a, nw1), mul(c2.a, nw2)), mul(c3.a, nw3));

  // Dither stochastic selection (alternative to soft blend)
  const px = viewportCoordinate.xy;
  const ign = fract(mul(float(52.9829189),
    fract(add(mul(float(0.06711056), px.x), mul(float(0.00583715), px.y)))));
  const nw12 = add(nw1, nw2);
  const ditS1 = ign.lessThan(nw1);
  const ditS2 = ign.lessThan(nw12);
  const ditRgb = select(ditS1, c1.rgb, select(ditS2, c2.rgb, c3.rgb));
  const ditAlpha = select(ditS1, c1.a, select(ditS2, c2.a, c3.a));

  // Selection logic:
  //   dither path overrides everything when uUseDither
  //   else: uUseBary chooses barycentric vs dominant
  const baryOrDomRgb = mix(domRgb, baryRgb, uUseBary);
  const baryOrDomA   = mix(domAlpha, baryAlpha, uUseBary);
  const finalAlbedo  = mix(baryOrDomRgb, ditRgb,   uUseDither);
  const finalAlphaR  = mix(baryOrDomA,   ditAlpha, uUseDither);

  // Edge AA via fwidth on the chosen alpha (smoothstep around cutoff)
  const edgeW = mul(fwidth(finalAlphaR), uEdgeSmooth);
  const smoothAlpha = smoothstep(sub(uAlphaCutoff, edgeW), add(uAlphaCutoff, edgeW), finalAlphaR);

  // Normals — bary or dominant
  const n1 = texture(normalTex, puv1).xyz;
  const n2 = texture(normalTex, puv2).xyz;
  const n3 = texture(normalTex, puv3).xyz;
  const wN1 = normalize(sub(mul(n1, 2.0), 1.0));
  const wN2 = normalize(sub(mul(n2, 2.0), 1.0));
  const wN3 = normalize(sub(mul(n3, 2.0), 1.0));
  const baryN = normalize(add(add(mul(wN1, nw1), mul(wN2, nw2)), mul(wN3, nw3)));
  const domN  = select(isDom1, wN1, select(isDom2, wN2, wN3));
  const blendedWorldN = normalize(mix(domN, baryN, uUseBary));
  // Normal strength = lerp from flat-up to atlas normal
  const finalWorldN = normalize(mix(vec3(0, 1, 0), blendedWorldN, uNormStr));

  // Roughness / metalness
  const rm1 = texture(rmTex, puv1);
  const rm2 = texture(rmTex, puv2);
  const rm3 = texture(rmTex, puv3);
  const baryRM = add(add(mul(rm1.xy, nw1), mul(rm2.xy, nw2)), mul(rm3.xy, nw3));
  const domRM  = select(isDom1, rm1.xy, select(isDom2, rm2.xy, rm3.xy));
  const finalRM = mix(domRM, baryRM, uUseBary);
  const finalRough = clamp(finalRM.x, float(0.05), float(1));
  const finalMetal = clamp(finalRM.y, float(0), float(1));

  // Depth-based AO
  const dep1 = texture(depthTex, puv1).r;
  const dep2 = texture(depthTex, puv2).r;
  const dep3 = texture(depthTex, puv3).r;
  const baryDepth = add(add(mul(dep1, nw1), mul(dep2, nw2)), mul(dep3, nw3));
  const ao = saturate(sub(float(1), mul(float(0.5), baryDepth)));

  // Translucency / back-lit SSS — only inside silhouette, scales with sun
  const viewDirW = normalize(sub(cameraPosition, positionWorld));
  const backLit = pow(saturate(dot(viewDirW, negate(uSunDir))), uTransPow);
  const translucency = mul(mul(mul(backLit, uTransAmt), mul(finalAlbedo, uTransTint)), uSunColor);

  // Debug overrides
  const isNormViz = uDebugMode.greaterThan(float(0.5)).and(uDebugMode.lessThan(float(1.5)));
  const isRawViz  = uDebugMode.greaterThan(float(1.5));
  const normVizCol = mul(add(finalWorldN, float(1)), float(0.5));
  const displayColor = select(isRawViz, finalAlbedo, select(isNormViz, normVizCol, finalAlbedo));
  const displayEmissive = select(isRawViz, vec3(0, 0, 0), select(isNormViz, normVizCol, translucency));

  // ── Main material (MeshStandardNodeMaterial — full scene lighting) ───────
  const mainMat = new THREE.MeshStandardNodeMaterial();
  mainMat.side = THREE.FrontSide;
  mainMat.transparent = false;
  mainMat.alphaTest = 0.5;
  // alphaToCoverage default OFF — when ON, MSAA stippling on the fwidth-smoothed
  // alpha shatters foliage silhouettes without TAA to resolve. Toggle from GUI.
  mainMat.alphaToCoverage = false;
  mainMat.depthWrite = true;
  mainMat.positionNode  = positionFn();
  mainMat.colorNode     = displayColor;
  mainMat.normalNode    = finalWorldN;
  mainMat.roughnessNode = finalRough;
  mainMat.metalnessNode = finalMetal;
  mainMat.aoNode        = ao;
  mainMat.opacityNode   = smoothAlpha;
  mainMat.emissiveNode  = displayEmissive;

  // Shadow casting — Renderer._getShadowNodes() picks these up per-draw and
  // patches them onto the shared ShadowPassMaterial. cameraPosition during the
  // shadow pass IS the sun position, so positionFn() orients the billboard
  // toward the sun and the atlas alpha samples at the sun's view direction →
  // the shadow silhouette matches what the sun actually sees.
  mainMat.castShadowPositionNode = positionFn();
  mainMat.castShadowNode         = vec4(float(0), float(0), float(0), smoothAlpha);

  return {
    mainMat,
    uniforms: {
      uSPS, uScale, uCenter, uTime,
      uNormStr, uAlphaCutoff, uEdgeSmooth, uParallaxStr,
      uUseBary, uUseParallax, uUseDither,
      uFreeze, uFreezeDir,
      uWindAmp, uWindFreq,
      uTransAmt, uTransPow, uTransTint,
      uSunDir, uSunColor,
      uDebugMode,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Misc helpers
// ═══════════════════════════════════════════════════════════════════════════

function exportPNG(pixels, width, height, filename) {
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
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

function loadState() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY) ||
      "{}";
    return JSON.parse(raw);
  } catch (e) { return {}; }
}
function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

const QUALITY_PRESETS = {
  Low:    { useBary: 0, useParallax: 0, edgeSmooth: 1.2 },
  Medium: { useBary: 1, useParallax: 0, edgeSmooth: 1.5 },
  High:   { useBary: 1, useParallax: 1, edgeSmooth: 1.5 },
};

const CAM_PRESETS = {
  Front:  { az:   0, el: 15, dist: 11 },
  Side:   { az:  90, el: 15, dist: 11 },
  Top:    { az:   0, el: 75, dist: 11 },
  Hero:   { az:  35, el: 20, dist:  9 },
};

// ═══════════════════════════════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════════════════════════════

export async function run() {
  // DOM refs
  const $ = (id) => document.getElementById(id);
  const tbStatus = $("tb-status");
  const tbModel  = $("tb-model");
  const tbMode   = $("tb-mode");
  const tbFreeze = $("tb-freeze");
  const tbOrbit  = $("tb-orbit");
  const tbQual   = $("tb-quality");
  const loading  = $("loading");
  const loadMsg  = $("loading-msg");
  const loadSub  = $("loading-sub");
  const dock     = $("dock");
  const zoomEl   = $("zoom");
  const zoomCv   = $("zoom-canvas");
  const zoomLbl  = $("zoom-label");
  const dropEl   = $("drop");
  const appEl    = $("app");
  const viewportEl = $("viewport");

  const setStatus = (msg, warn = false) => {
    tbStatus.textContent = msg;
    tbStatus.classList.toggle("warn", !!warn);
    tbStatus.classList.toggle("bad", !!warn);
    tbStatus.classList.toggle("on", !warn);
  };
  const showLoading = (visible, msg = "Working…", sub = "") => {
    loading.classList.toggle("show", visible);
    if (visible) { loadMsg.textContent = msg; loadSub.textContent = sub; }
  };

  setStatus("Initializing WebGPU…");

  // ── Renderer ───────────────────────────────────────────────────────────
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Required to enable per-mesh castShadowNode / castShadowPositionNode overrides.
  // Without this, the shadow pass uses the shared ShadowPassMaterial as-is and our
  // impostor casts a flat-quad shadow instead of the sun-view silhouette.
  renderer.shadowMap.transmitted = true;
  viewportEl.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";

  function resizeRenderer() {
    const w = viewportEl.clientWidth;
    const h = viewportEl.clientHeight;
    if (w < 1 || h < 1) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  const maxAniso = renderer.capabilities?.maxAnisotropy || 16;

  // ── Scene ──────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  // Fog is kept on the scene; the GUI toggle attaches/detaches it so changes
  // are free of recompile cost.
  const sceneFog = new THREE.Fog(0x87ceeb, 60, 220);
  scene.fog = sceneFog;

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, 3, 10);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  resizeRenderer();

  // Lights — these drive the MeshStandardNodeMaterial for free
  const dirLight = new THREE.DirectionalLight(0xfff5e0, 3.0);
  dirLight.position.set(5, 10, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 80;
  const sh = 26;
  dirLight.shadow.camera.left = -sh; dirLight.shadow.camera.right = sh;
  dirLight.shadow.camera.top  =  sh; dirLight.shadow.camera.bottom = -sh;
  dirLight.shadow.bias = -0.0002;
  dirLight.shadow.normalBias = 0.025;
  dirLight.target.position.copy(controls.target);
  scene.add(dirLight); scene.add(dirLight.target);

  const hemiLight = new THREE.HemisphereLight(0x88bbee, 0x556633, 0.7);
  scene.add(hemiLight);
  const ambLight = new THREE.AmbientLight(0xc0d0e0, 0.35);
  scene.add(ambLight);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({
      color: 0x5a7a4a, roughness: 0.9,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── Loaders ────────────────────────────────────────────────────────────
  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
  gltfLoader.setDRACOLoader(dracoLoader);

  function applyShadowToMeshes(root, cast, receive) {
    if (!root) return;
    root.traverse((c) => { if (c.isMesh) { c.castShadow = cast; c.receiveShadow = receive; } });
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

  // ── State ──────────────────────────────────────────────────────────────
  let sourceGroup = null;
  let bakeMeshData = [];
  let sourceGroundY = 0;
  let impostor = null;
  let impUniforms = null;
  let atlasResult = null;
  let isBaking = false;
  let activeCells = null;
  let lastDockRedraw = 0;
  let currentModelName = "TorusKnot";
  let uiHidden = false;
  let uiRefresh = () => {};
  let frameCount = 0, lastFpsTime = performance.now(), fps = 0;

  function clearScene() {
    if (sourceGroup) { scene.remove(sourceGroup); sourceGroup = null; }
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
    impUniforms = null;
    activeCells = null;
    bakeMeshData = [];
    clearDockCanvases();
  }

  // ── Model loading ──────────────────────────────────────────────────────
  function loadPrimitive(type) {
    clearScene();
    let geo, mat;
    switch (type) {
      case "Sphere":
        geo = new THREE.SphereGeometry(1.2, 64, 64);
        mat = new THREE.MeshStandardMaterial({ color: 0x7fd0ff, roughness: 0.35, metalness: 0.15 });
        break;
      case "Torus":
        geo = new THREE.TorusGeometry(1, 0.4, 32, 64);
        mat = new THREE.MeshStandardMaterial({ color: 0xdd8844, roughness: 0.4, metalness: 0.05 });
        break;
      case "Cylinder":
        geo = new THREE.CylinderGeometry(0.6, 0.8, 2.4, 32);
        mat = new THREE.MeshStandardMaterial({ color: 0x88cc66, roughness: 0.6, metalness: 0.0 });
        break;
      default:
        geo = new THREE.TorusKnotGeometry(1, 0.35, 256, 64);
        mat = new THREE.MeshStandardMaterial({ color: 0x7fd0ff, roughness: 0.35, metalness: 0.15 });
    }
    currentModelName = type;
    const mesh = new THREE.Mesh(geo, mat);
    sourceGroup = new THREE.Group();
    sourceGroup.add(mesh);
    bakeMeshData = extractBakeData(sourceGroup);
    const bounds = computeBounds(bakeMeshData);
    sourceGroundY = -bounds.box.min.y;
    sourceGroup.position.set(-3, sourceGroundY, 0);
    scene.add(sourceGroup);
    applyShadowToMeshes(sourceGroup, true, true);
    P.roughness = mat.roughness; P.metalness = mat.metalness;
  }

  async function setupGLBScene(gltf, name) {
    clearScene();
    currentModelName = name;
    gltf.scene.updateMatrixWorld(true);
    bakeMeshData = extractBakeData(gltf.scene);
    if (bakeMeshData.length === 0) {
      setStatus("No meshes found in model.", true);
      return;
    }
    const bounds = computeBounds(bakeMeshData);
    sourceGroundY = -bounds.box.min.y;
    const firstMat = bakeMeshData[0].material;
    const displayGroup = new THREE.Group();
    gltf.scene.traverse((c) => {
      if (!c.isMesh) return;
      const clone = c.clone();
      // GLB foliage often ships with transparent:true which kills depth sorting
      // when seen from above (alpha-blended leaves can't z-test each other,
      // back leaves render in front of nearer ones). Force alpha cutout +
      // double-sided so the reference looks right from any angle.
      if (clone.material && (clone.material.map || clone.material.alphaMap)) {
        clone.material = clone.material.clone();
        clone.material.transparent = false;
        clone.material.alphaTest = 0.5;
        clone.material.depthWrite = true;
        clone.material.side = THREE.DoubleSide;
      }
      displayGroup.add(clone);
    });
    sourceGroup = displayGroup;
    sourceGroup.position.set(-3, sourceGroundY, 0);
    scene.add(sourceGroup);
    applyShadowToMeshes(sourceGroup, true, true);
    P.roughness = firstMat.roughness !== undefined ? firstMat.roughness : 0.5;
    P.metalness = firstMat.metalness !== undefined ? firstMat.metalness : 0.0;
  }

  async function loadGLBPath(path, name) {
    setStatus(`Loading ${name}…`);
    try {
      const gltf = await gltfLoader.loadAsync(path);
      await setupGLBScene(gltf, name);
      setStatus(`Loaded ${name}`);
    } catch (e) { setStatus("Load error: " + e.message, true); console.error(e); }
  }
  async function loadGLB(file) {
    setStatus(`Loading ${file.name}…`);
    const url = URL.createObjectURL(file);
    try {
      const gltf = await gltfLoader.loadAsync(url);
      URL.revokeObjectURL(url);
      await setupGLBScene(gltf, file.name.replace(/\.[^.]+$/, ""));
      setStatus(`Loaded ${file.name}`);
    } catch (e) {
      URL.revokeObjectURL(url);
      setStatus("Load error: " + e.message, true); console.error(e);
    }
  }

  // ── Rebake ─────────────────────────────────────────────────────────────
  async function rebake() {
    if (isBaking || bakeMeshData.length === 0) return;
    isBaking = true;
    showLoading(true, "Baking atlas…", "color · normal · roughness/metalness · depth");
    setStatus("Baking…");

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
      atlasResult = await bakeAtlases(renderer, bakeMeshData, {
        grid: P.grid,
        atlasSize: P.atlasSize,
        maxAniso,
        cellPad: P.cellPad,
        fullOctahedral: P.fullOctahedral,
      });

      loadSub.textContent = "Building impostor materials…";
      const built = createImpostorMaterials(
        {
          colorTex:  atlasResult.colorTex,
          normalTex: atlasResult.normalTex,
          rmTex:     atlasResult.rmTex,
          depthTex:  atlasResult.depthTex,
        },
        {
          impostorScale: atlasResult.radius,
          gridVal:       P.grid,
          atlasSize:     P.atlasSize,
          cellPad:       P.cellPad,
          fullOctahedral: P.fullOctahedral,
        },
      );
      impUniforms = built.uniforms;

      const geo = new THREE.PlaneGeometry(1, 1);
      impostor = new THREE.Mesh(geo, built.mainMat);

      const R = atlasResult.radius;
      // Lay out reference and impostor with ~2.5R clearance, scaled to model size
      const gap = Math.max(6, R * 2.5);
      sourceGroup.position.set(-gap / 2, sourceGroundY, 0);

      const srcWorldCenter = new THREE.Vector3()
        .copy(atlasResult.center)
        .add(sourceGroup.position);
      const impWorldCenter = srcWorldCenter.clone().add(new THREE.Vector3(gap, 0, 0));
      impWorldCenter.y += R * (1 - 1 / BAKE_SPHERE_MARGIN);

      impostor.position.copy(impWorldCenter);
      impostor.scale.setScalar(2 * R);

      // Re-aim camera at midpoint and back off based on model size
      const mid = new THREE.Vector3().addVectors(srcWorldCenter, impWorldCenter).multiplyScalar(0.5);
      controls.target.set(mid.x, Math.max(R * 0.45, 0.8), mid.z);
      dirLight.target.position.copy(controls.target);
      // Fit both meshes in the horizontal frame: total span = gap + 2R, leave 15% margin
      const aspect = viewportEl.clientWidth / Math.max(viewportEl.clientHeight, 1);
      const halfFovV = (camera.fov * 0.5 * Math.PI) / 180;
      const halfFovH = Math.atan(Math.tan(halfFovV) * aspect);
      const span = gap + R * 2;
      const fitDist = (span * 0.58) / Math.tan(halfFovH);
      const camDir = camera.position.clone().sub(controls.target).normalize();
      if (camDir.lengthSq() < 0.01) camDir.set(0, 0.3, 1).normalize();
      camera.position.copy(controls.target).addScaledVector(camDir, fitDist);
      controls.update();
      impostor.frustumCulled = false;
      impUniforms.uCenter.value.copy(impWorldCenter);
      impostor.castShadow = true;
      impostor.receiveShadow = true;
      scene.add(impostor);

      loadSub.textContent = "Compiling shaders…";
      await renderer.compileAsync(scene, camera);
      computeActiveCells();
      drawAtlasDock();
      syncParams();
      updateTopbar();
      setStatus(`Ready · ${currentModelName}`);
    } catch (e) {
      setStatus("Bake error: " + e.message, true);
      console.error(e);
      atlasResult = null;
      activeCells = null;
      clearDockCanvases();
    }
    showLoading(false);
    isBaking = false;
  }

  // ── Atlas dock ─────────────────────────────────────────────────────────
  function clearDockCanvases() {
    for (const id of ["dock-color", "dock-normal", "dock-rm", "dock-depth"]) {
      const c = $(id);
      if (!c) continue;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#12121a";
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }

  function computeActiveCells() {
    if (!atlasResult || !impUniforms || P.fullOctahedral) { activeCells = null; return; }
    const center = impUniforms.uCenter.value;
    const vd = new THREE.Vector3().subVectors(camera.position, center).normalize();
    const enc = hemiOctaEncodeCPU(vd);
    const S = P.grid, Nm1 = S - 1;
    const gx = enc.u * Nm1, gy = enc.v * Nm1;
    const fx = Math.min(Math.floor(gx), Nm1), fy = Math.min(Math.floor(gy), Nm1);
    const frx = gx - fx, fry = gy - fy;
    const wx = Math.min(1 - frx, 1 - fry);
    const wy = Math.abs(frx - fry);
    const wz = Math.min(frx, fry);
    const ww = frx > fry ? 1 : 0;
    activeCells = {
      s1: [fx, fy],
      s2: [Math.min(fx + (ww ? 1 : 0), Nm1), Math.min(fy + (ww ? 0 : 1), Nm1)],
      s3: [Math.min(fx + 1, Nm1), Math.min(fy + 1, Nm1)],
      weights: [wx, wy, wz],
    };
  }

  function drawAtlasDock() {
    if (!atlasResult) { clearDockCanvases(); return; }
    const w = atlasResult.atlasSize;
    const S = atlasResult.grid;
    const sz = 148;
    const showGrid = P.showGrid;
    const showActive = P.showActive && !P.fullOctahedral;

    const drawLayer = (pixels, canvasId, overlay) => {
      const c = $(canvasId);
      if (!c || !pixels) return;
      const ctx = c.getContext("2d");
      const tmp = document.createElement("canvas");
      tmp.width = w; tmp.height = w;
      const clamped = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, w * w * 4);
      tmp.getContext("2d").putImageData(new ImageData(clamped, w, w), 0, 0);
      ctx.clearRect(0, 0, sz, sz);
      ctx.save();
      ctx.translate(0, sz); ctx.scale(1, -1);
      ctx.drawImage(tmp, 0, 0, sz, sz);
      ctx.restore();

      if (overlay && showGrid) {
        const step = sz / S;
        ctx.strokeStyle = "rgba(255,255,255,0.22)";
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= S; i++) {
          const p = i * step;
          ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, sz); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(sz, p); ctx.stroke();
        }
      }
      if (overlay && showActive && activeCells) {
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

    drawLayer(atlasResult.colorPixels,  "dock-color",  true);
    drawLayer(atlasResult.normalPixels, "dock-normal", true);
    drawLayer(atlasResult.rmPixels,     "dock-rm",     true);
    drawLayer(atlasResult.depthPixels,  "dock-depth",  true);
  }

  function openZoomFromEvent(e, pixels, label) {
    if (!atlasResult || !pixels) return;
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
    tmp.width = w; tmp.height = w;
    const clamped = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, w * w * 4);
    tmp.getContext("2d").putImageData(new ImageData(clamped, w, w), 0, 0);
    const ctx = zoomCv.getContext("2d");
    ctx.clearRect(0, 0, 220, 220);
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(0, 220); ctx.scale(1, -1);
    ctx.drawImage(tmp, col * cs, row * cs, cs, cs, 0, 0, 220, 220);
    ctx.restore();
    const pp = (pd / cs) * 220;
    if (pp > 0 && pd > 0) {
      ctx.strokeStyle = "rgba(255,100,100,0.7)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(pp, pp, 220 - pp * 2, 220 - pp * 2);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,100,100,0.55)";
      ctx.font = "9px monospace";
      ctx.fillText(`pad=${pd}px`, 2, 10);
    }
    zoomLbl.textContent = `${label} cell (${col},${row})`;
    zoomEl.style.display = "block";
    zoomEl.style.left = `${Math.min(e.clientX + 10, innerWidth - 240)}px`;
    zoomEl.style.top  = `${Math.min(e.clientY + 10, innerHeight - 260)}px`;
    clearTimeout(openZoomFromEvent._t);
    openZoomFromEvent._t = setTimeout(() => { zoomEl.style.display = "none"; }, 5000);
  }

  function attachDockHandlers() {
    const pairs = [
      ["dock-color",  () => atlasResult?.colorPixels,  "Color"],
      ["dock-normal", () => atlasResult?.normalPixels, "Normal"],
      ["dock-rm",     () => atlasResult?.rmPixels,     "R/M"],
      ["dock-depth",  () => atlasResult?.depthPixels,  "Depth"],
    ];
    for (const [id, getPx, label] of pairs) {
      const el = $(id);
      if (!el) continue;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const px = getPx();
        if (px) openZoomFromEvent(e, px, label);
      });
    }
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#dock") && !e.target.closest("#zoom")) zoomEl.style.display = "none";
    });
  }

  // ── Stats / topbar ─────────────────────────────────────────────────────
  function updateStats() {
    const q = (id, t) => { const el = $(id); if (el) el.textContent = t; };
    q("s-fps", String(fps));
    if (atlasResult) {
      q("s-atlas", `${atlasResult.atlasSize}²`);
      q("s-grid",  `${atlasResult.grid}×${atlasResult.grid}`);
      q("s-cell",  `${Math.floor(atlasResult.atlasSize / atlasResult.grid)}px`);
    } else {
      q("s-atlas", "—"); q("s-grid", "—"); q("s-cell", "—");
    }
    q("s-tris", bakeMeshData.length ? countTris(bakeMeshData).toLocaleString() : "—");
    const t = controls.target;
    const dx = camera.position.x - t.x, dz = camera.position.z - t.z;
    q("s-yaw", `${(((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360).toFixed(0)}°`);
    if (activeCells && !P.fullOctahedral) {
      const { s1, s2, s3 } = activeCells;
      q("s-active", `(${s1[0]},${s1[1]})·(${s2[0]},${s2[1]})·(${s3[0]},${s3[1]})`);
    } else q("s-active", P.fullOctahedral ? "full" : "—");
  }
  function updateTopbar() {
    tbModel.textContent = currentModelName;
    tbQual.textContent  = P.quality;
    tbMode.textContent  = P.debugMode === 1 ? "Normals" : P.debugMode === 2 ? "Raw" : "PBR";
    tbMode.classList.toggle("on",   P.debugMode === 0);
    tbMode.classList.toggle("warn", P.debugMode !== 0);
    tbFreeze.textContent = P.freeze ? "Frozen" : "Live";
    tbFreeze.classList.toggle("warn", P.freeze);
    tbOrbit.textContent  = P.autoOrbit ? "Orbit" : "Manual";
    tbOrbit.classList.toggle("on", P.autoOrbit);
  }

  // ── Params + sync ──────────────────────────────────────────────────────
  const saved = loadState();
  const P = {
    model: "TorusKnot",
    grid: 12,
    atlasSize: 2048,
    cellPad: 4,
    fullOctahedral: false,
    quality: "High",
    showOriginal: true,
    showImpostor: true,
    showAtlas: true,
    showGrid: false,
    showActive: true,
    sunAzimuth: 225,
    sunElevation: 56,
    sunIntensity: 3.0,
    exposure: 1.0,
    fog: true,
    fogNear: 60,
    fogFar: 220,
    roughness: 0.35,
    metalness: 0.15,
    normalStr: 1.0,
    alphaCutoff: 0.5,
    edgeSmooth: 1.5,
    parallaxStr: 0.05,
    dither: false,
    alphaToCoverage: false,
    windAmp: 0.0,
    windFreq: 1.5,
    translucency: 0.0,
    translucencyPower: 3.0,
    translucencyTint: "#e6ffb3",
    debugMode: 0,
    freeze: false,
    autoOrbit: false,
    ...saved,
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

    scene.fog = P.fog ? sceneFog : null;
    sceneFog.near = P.fogNear;
    sceneFog.far = P.fogFar;

    // Apply quality preset onto rendering uniforms
    const preset = QUALITY_PRESETS[P.quality] || QUALITY_PRESETS.High;

    if (impUniforms) {
      impUniforms.uNormStr.value     = P.normalStr;
      impUniforms.uAlphaCutoff.value = P.alphaCutoff;
      impUniforms.uEdgeSmooth.value  = preset.edgeSmooth;
      impUniforms.uParallaxStr.value = P.parallaxStr;
      impUniforms.uUseBary.value     = preset.useBary;
      impUniforms.uUseParallax.value = preset.useParallax;
      impUniforms.uUseDither.value   = P.dither ? 1 : 0;
      impUniforms.uDebugMode.value   = P.debugMode;
      impUniforms.uFreeze.value      = P.freeze ? 1 : 0;
      impUniforms.uWindAmp.value     = P.windAmp;
      impUniforms.uWindFreq.value    = P.windFreq;
      impUniforms.uTransAmt.value    = P.translucency;
      impUniforms.uTransPow.value    = P.translucencyPower;
      const tc = new THREE.Color(P.translucencyTint);
      impUniforms.uTransTint.value.set(tc.r, tc.g, tc.b);

      impUniforms.uSunDir.value.copy(d);
      const lc = dirLight.color;
      impUniforms.uSunColor.value.set(
        lc.r * P.sunIntensity, lc.g * P.sunIntensity, lc.b * P.sunIntensity,
      );
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
      // alphaToCoverage flips between the binary cutout pipeline and the
      // MSAA-stochastic-coverage pipeline. Toggling requires a recompile,
      // which three.js triggers via needsUpdate.
      if (impostor.material.alphaToCoverage !== P.alphaToCoverage) {
        impostor.material.alphaToCoverage = P.alphaToCoverage;
        impostor.material.needsUpdate = true;
      }
    }
    const atlasPanel = document.getElementById("atlas-panel");
    if (atlasPanel && !uiHidden) atlasPanel.style.display = P.showAtlas ? "" : "none";
    if (dock && !uiHidden) dock.style.display = P.showAtlas ? "flex" : "none";

    // Save and refresh topbar
    const persist = { ...P }; delete persist.freeze; delete persist.debugMode;
    saveState(persist);
    updateTopbar();
    uiRefresh();
  }

  function toggleFreeze() {
    P.freeze = !P.freeze;
    if (P.freeze && impUniforms) {
      const camLocal = new THREE.Vector3()
        .subVectors(camera.position, impUniforms.uCenter.value)
        .divideScalar(impUniforms.uScale.value);
      impUniforms.uFreezeDir.value.copy(camLocal.normalize());
    }
    syncParams();
    uiRefresh();
  }

  function applyCameraPreset(name) {
    const p = CAM_PRESETS[name]; if (!p) return;
    const az = (p.az * Math.PI) / 180, el = (p.el * Math.PI) / 180;
    const t = controls.target;
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.sin(az),
      Math.sin(el),
      Math.cos(el) * Math.cos(az),
    );
    camera.position.copy(t).addScaledVector(dir, p.dist);
    controls.update();
  }

  function cycleQuality() {
    const order = ["Low", "Medium", "High"];
    const i = (order.indexOf(P.quality) + 1) % order.length;
    P.quality = order[i];
    syncParams();
    uiRefresh();
  }

  function toggleUiHidden() {
    uiHidden = !uiHidden;
    appEl.classList.toggle("ui-hidden", uiHidden);
    resizeRenderer();
  }

  // ── File input ─────────────────────────────────────────────────────────
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = ".glb,.gltf";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);
  fileInput.addEventListener("change", async () => {
    if (fileInput.files.length) {
      await loadGLB(fileInput.files[0]);
      updateTopbar();
      await rebake();
    }
    fileInput.value = "";
  });

  // ── Custom inspector UI ────────────────────────────────────────────────
  const inspector = document.getElementById("inspector-scroll");
  const ui = createUiHelpers();
  uiRefresh = () => ui.refreshAll();

  const GLB_MODELS = {
    "Pine 2":      modelUrl("pine2.glb"),
    "Pine 3":      modelUrl("pine3.glb"),
    "Cherry Tree": modelUrl("japanese_cherry_tree.glb"),
    "Cypress":     modelUrl("cypress_tree_compressed.glb"),
    "Palm Tree":   modelUrl("realistic_palm_tree_free.glb"),
    "Rock":        modelUrl("rock_boulder.glb"),
  };
  const ALL_MODELS = ["TorusKnot", "Sphere", "Torus", "Cylinder", ...Object.keys(GLB_MODELS)];
  const modelOpts = {};
  for (const m of ALL_MODELS) modelOpts[m] = m;

  const fModel = ui._section(inspector, "Model");
  ui._dropdown(fModel, P, "model", {
    label: "Model",
    options: modelOpts,
    onChange: async () => {
      if (GLB_MODELS[P.model]) await loadGLBPath(GLB_MODELS[P.model], P.model);
      else loadPrimitive(P.model);
      updateTopbar();
      await rebake();
    },
  });
  ui._button(fModel, { title: "Load GLB…", onClick: () => fileInput.click() });
  ui._button(fModel, { title: "Rebake atlas [B]", onClick: () => rebake() });
  ui._toggle(fModel, P, "showOriginal", { label: "Show original", onChange: syncParams });
  ui._toggle(fModel, P, "showImpostor", { label: "Show impostor", onChange: syncParams });

  const fAtlas = ui._section(inspector, "Atlas (auto-rebake)");
  ui._dropdown(fAtlas, P, "grid", {
    label: "Grid",
    options: { "4": 4, "6": 6, "8": 8, "10": 10, "12": 12, "14": 14, "16": 16 },
    onChange: () => rebake(),
  });
  ui._dropdown(fAtlas, P, "atlasSize", {
    label: "Resolution",
    options: { "512": 512, "1024": 1024, "2048": 2048, "4096": 4096 },
    onChange: () => rebake(),
  });
  ui._slider(fAtlas, P, "cellPad", { label: "Cell padding", min: 0, max: 8, step: 1, onChange: () => rebake() });
  ui._toggle(fAtlas, P, "fullOctahedral", { label: "Full octahedral", onChange: () => rebake() });

  const fQual = ui._section(inspector, "Quality");
  ui._dropdown(fQual, P, "quality", {
    label: "Preset [Q]",
    options: { Low: "Low", Medium: "Medium", High: "High" },
    onChange: syncParams,
  });
  ui._slider(fQual, P, "alphaCutoff", { label: "Alpha cutoff", min: 0.05, max: 0.95, step: 0.01, onChange: syncParams });
  ui._slider(fQual, P, "parallaxStr", { label: "Parallax depth", min: 0, max: 0.3, step: 0.005, onChange: syncParams });
  ui._slider(fQual, P, "normalStr", { label: "Normal strength", min: 0, max: 1, step: 0.02, onChange: syncParams });
  ui._toggle(fQual, P, "dither", { label: "Dither cross-fade", onChange: syncParams });
  ui._toggle(fQual, P, "alphaToCoverage", { label: "Alpha-to-coverage", onChange: syncParams });

  const fTree = ui._section(inspector, "Trees & foliage", false);
  ui._slider(fTree, P, "translucency", { label: "Back-light SSS", min: 0, max: 1.5, step: 0.02, onChange: syncParams });
  ui._slider(fTree, P, "translucencyPower", { label: "SSS sharpness", min: 1, max: 12, step: 0.5, onChange: syncParams });
  ui._color(fTree, P, "translucencyTint", { label: "SSS tint", onChange: syncParams });
  ui._slider(fTree, P, "windAmp", { label: "Wind amplitude", min: 0, max: 0.08, step: 0.002, onChange: syncParams });
  ui._slider(fTree, P, "windFreq", { label: "Wind frequency", min: 0.2, max: 4, step: 0.05, onChange: syncParams });

  const fSun = ui._section(inspector, "Lighting");
  ui._slider(fSun, P, "sunAzimuth", { label: "Sun azimuth", min: 0, max: 360, step: 1, onChange: syncParams });
  ui._slider(fSun, P, "sunElevation", { label: "Sun elevation", min: 5, max: 90, step: 0.5, onChange: syncParams });
  ui._slider(fSun, P, "sunIntensity", { label: "Sun intensity", min: 0.2, max: 5, step: 0.1, onChange: syncParams });
  ui._slider(fSun, P, "exposure", { label: "Exposure", min: 0.2, max: 3, step: 0.05, onChange: syncParams });
  ui._toggle(fSun, P, "fog", { label: "Fog", onChange: syncParams });
  ui._slider(fSun, P, "fogNear", { label: "Fog near", min: 0, max: 200, step: 1, onChange: syncParams });
  ui._slider(fSun, P, "fogFar", { label: "Fog far", min: 50, max: 500, step: 1, onChange: syncParams });

  const fMat = ui._section(inspector, "Original material", false);
  ui._slider(fMat, P, "roughness", { label: "Roughness", min: 0.05, max: 1, step: 0.01, onChange: syncParams });
  ui._slider(fMat, P, "metalness", { label: "Metalness", min: 0, max: 1, step: 0.01, onChange: syncParams });

  const fDbg = ui._section(inspector, "Debug / view");
  ui._dropdown(fDbg, P, "debugMode", {
    label: "Display",
    options: { "Full PBR": 0, "Normals [N]": 1, "Raw atlas [R]": 2 },
    onChange: syncParams,
  });
  ui._toggle(fDbg, P, "freeze", {
    label: "Freeze angle [F]",
    onChange: () => {
      if (P.freeze && impUniforms) {
        const camLocal = new THREE.Vector3()
          .subVectors(camera.position, impUniforms.uCenter.value)
          .divideScalar(impUniforms.uScale.value);
        impUniforms.uFreezeDir.value.copy(camLocal.normalize());
      }
      syncParams();
    },
  });
  ui._toggle(fDbg, P, "autoOrbit", { label: "Auto-orbit [O]", onChange: syncParams });
  ui._toggle(fDbg, P, "showAtlas", { label: "Show atlas dock", onChange: syncParams });
  ui._toggle(fDbg, P, "showGrid", { label: "Dock: grid lines", onChange: () => drawAtlasDock() });
  ui._toggle(fDbg, P, "showActive", { label: "Dock: active cells", onChange: () => drawAtlasDock() });

  const fCam = ui._section(inspector, "Camera", false);
  for (const name of Object.keys(CAM_PRESETS)) {
    ui._button(fCam, { title: name, onClick: () => applyCameraPreset(name) });
  }

  const fExp = ui._section(inspector, "Export", false);
  const mkExport = (key, label) => ui._button(fExp, {
    title: `${label} → PNG`,
    onClick: () => {
      if (!atlasResult) return;
      exportPNG(atlasResult[key], P.atlasSize, P.atlasSize,
        `${currentModelName}_${label}_${P.grid}x${P.grid}.png`);
    },
  });
  mkExport("colorPixels", "color");
  mkExport("normalPixels", "normal");
  mkExport("rmPixels", "rm");
  mkExport("depthPixels", "depth");

  document.getElementById("btn-load")?.addEventListener("click", () => fileInput.click());
  document.getElementById("btn-rebake")?.addEventListener("click", () => rebake());
  document.getElementById("btn-hide-ui")?.addEventListener("click", toggleUiHidden);

  attachDockHandlers();

  // ── Hotkeys ────────────────────────────────────────────────────────────
  addEventListener("keydown", (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    switch (e.code) {
      case "KeyN": P.debugMode = P.debugMode === 1 ? 0 : 1; syncParams(); uiRefresh(); break;
      case "KeyR": P.debugMode = P.debugMode === 2 ? 0 : 2; syncParams(); uiRefresh(); break;
      case "KeyF": toggleFreeze(); break;
      case "KeyO": P.autoOrbit = !P.autoOrbit; syncParams(); uiRefresh(); break;
      case "KeyB": rebake(); break;
      case "KeyQ": cycleQuality(); break;
      case "KeyH": toggleUiHidden(); break;
      case "Digit1": applyCameraPreset("Front"); break;
      case "Digit2": applyCameraPreset("Side");  break;
      case "Digit3": applyCameraPreset("Top");   break;
      case "Digit4": applyCameraPreset("Hero");  break;
    }
  });

  // ── Drag-and-drop ──────────────────────────────────────────────────────
  let dragCounter = 0;
  addEventListener("dragenter", (e) => { e.preventDefault(); dragCounter++; dropEl.style.display = "flex"; });
  addEventListener("dragleave", (e) => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dropEl.style.display = "none"; dragCounter = 0; } });
  addEventListener("dragover",  (e) => e.preventDefault());
  addEventListener("drop", async (e) => {
    e.preventDefault(); dragCounter = 0; dropEl.style.display = "none";
    const file = e.dataTransfer.files[0];
    if (file && /\.(glb|gltf)$/i.test(file.name)) {
      await loadGLB(file);
      updateTopbar();
      await rebake();
    }
  });

  // ── Resize ─────────────────────────────────────────────────────────────
  addEventListener("resize", () => resizeRenderer());

  // ── Init + render loop ─────────────────────────────────────────────────
  if (GLB_MODELS[P.model]) await loadGLBPath(GLB_MODELS[P.model], P.model);
  else loadPrimitive(P.model);
  syncParams();
  await rebake();

  const _orbitAxis = new THREE.Vector3(0, 1, 0);
  const startTime = performance.now();

  renderer.setAnimationLoop(() => {
    if (P.autoOrbit) {
      const offset = camera.position.clone().sub(controls.target);
      offset.applyAxisAngle(_orbitAxis, 0.005);
      camera.position.copy(controls.target).add(offset);
    }
    controls.update();

    // Wind/animation time
    if (impUniforms) {
      impUniforms.uTime.value = (performance.now() - startTime) / 1000;
    }

    updateStats();

    const now = performance.now();
    if (now - lastDockRedraw >= 100) {
      lastDockRedraw = now;
      if (atlasResult && impUniforms) computeActiveCells();
      if (P.showAtlas && atlasResult && (P.showGrid || P.showActive)) drawAtlasDock();
    }

    frameCount++;
    if (now - lastFpsTime >= 500) {
      fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
      frameCount = 0; lastFpsTime = now;
    }

    renderer.render(scene, camera);
  });
}
