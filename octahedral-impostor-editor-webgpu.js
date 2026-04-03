import * as THREE from "three";
import {
  Fn, normalize, sub, mul, add, div, abs, vec2, vec3, vec4,
  sign, dot, cross, floor, fract, min, max, clamp, saturate,
  texture, cameraPosition, positionWorld, positionLocal, positionView,
  float, uniform, varying, select, length, negate, mix,
  smoothstep, fwidth, pow, normalWorld, viewportCoordinate, uv,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function hemiOctaGridToDir(gx, gy, out) {
  out.set(gx - gy, 0, -1 + gx + gy);
  out.y = 1 - Math.abs(out.x) - Math.abs(out.z);
  return out.normalize();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Atlas Baking  —  3-pass: color + normal + roughness/metalness
// ═══════════════════════════════════════════════════════════════════════════

async function bakeAtlases(renderer, bakeMeshData, opts) {
  const { grid, atlasSize, maxAniso } = opts;
  const cs = Math.floor(atlasSize / grid);

  const box = new THREE.Box3();
  for (const { geometry } of bakeMeshData) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = sphere.radius * 1.08;
  const center = sphere.center.clone();
  const half = radius;

  const ortho = new THREE.OrthographicCamera(-half, half, half, -half, 0.001, radius * 4);
  const dir = new THREE.Vector3();

  const colorScene = new THREE.Scene();
  const normalScene = new THREE.Scene();
  const rmScene = new THREE.Scene();
  const depthScene = new THREE.Scene();

  const BAKE_ALPHA = 0.05;
  const depthNear = radius;
  const depthSpan = 2 * radius;

  for (const { geometry, material } of bakeMeshData) {
    const hasAlpha = !!(material.map || material.alphaMap);

    const colorMat = new THREE.MeshBasicMaterial({
      color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
      map: material.map || null,
      alphaTest: hasAlpha ? BAKE_ALPHA : 0,
      alphaMap: material.alphaMap || null,
      side: THREE.DoubleSide,
    });
    colorScene.add(new THREE.Mesh(geometry, colorMat));

    const alphaNode = material.map ? texture(material.map, uv()).a : float(1);
    const nMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(mul(add(normalWorld, 1), 0.5), alphaNode),
    });
    if (hasAlpha) nMat.alphaTest = BAKE_ALPHA;
    normalScene.add(new THREE.Mesh(geometry.clone(), nMat));

    const r = material.roughness !== undefined ? material.roughness : 0.5;
    const m = material.metalness !== undefined ? material.metalness : 0.0;
    let rNode = float(r);
    let mNode = float(m);
    if (material.roughnessMap) rNode = mul(texture(material.roughnessMap, uv()).g, float(r));
    if (material.metalnessMap) mNode = mul(texture(material.metalnessMap, uv()).b, float(m));

    const rmMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(rNode, mNode, float(0), alphaNode),
    });
    if (hasAlpha) rmMat.alphaTest = BAKE_ALPHA;
    rmScene.add(new THREE.Mesh(geometry.clone(), rmMat));

    const depthVal = saturate(div(sub(negate(positionView.z), float(depthNear)), float(depthSpan)));
    const dMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(depthVal, depthVal, depthVal, alphaNode),
    });
    if (hasAlpha) dMat.alphaTest = BAKE_ALPHA;
    depthScene.add(new THREE.Mesh(geometry.clone(), dMat));
  }

  const cellRT = new THREE.RenderTarget(cs, cs, {
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

  const tightRow = cs * 4;
  const paddedRow = Math.ceil(tightRow / 256) * 256;

  const scenes = [
    [colorScene, colorPixels],
    [normalScene, normalPixels],
    [rmScene, rmPixels],
    [depthScene, depthPixels],
  ];

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      hemiOctaGridToDir(gx / (grid - 1), gy / (grid - 1), dir);
      ortho.position.copy(center).addScaledVector(dir, radius * 2);
      ortho.lookAt(center);
      ortho.updateMatrixWorld(true);

      for (const [sc, dest] of scenes) {
        renderer.setRenderTarget(cellRT);
        renderer.autoClear = true;
        renderer.render(sc, ortho);

        const buf = await renderer.readRenderTargetPixelsAsync(cellRT, 0, 0, cs, cs);
        const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        const srcStride = (src.length > cs * cs * 4) ? paddedRow : tightRow;

        for (let row = 0; row < cs; row++) {
          const srcOff = (cs - 1 - row) * srcStride;
          const dy = gy * cs + row;
          const dstOff = (dy * atlasSize + gx * cs) * 4;
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

  const makeTex = (data, srgb = false) => {
    const t = new THREE.DataTexture(data, atlasSize, atlasSize, THREE.RGBAFormat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = maxAniso;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };

  return {
    colorTex: makeTex(colorPixels), normalTex: makeTex(normalPixels),
    rmTex: makeTex(rmPixels), depthTex: makeTex(depthPixels),
    colorPixels, normalPixels, rmPixels, depthPixels,
    radius, center, grid, atlasSize,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Impostor Material  —  TSL PBR + RM atlas + debug + freeze + dither
// ═══════════════════════════════════════════════════════════════════════════

function createImpostorMaterial(colorTex, normalTex, rmTex, depthTex, impostorScale, gridVal, atlasSize) {
  const uSPS = uniform(float(gridVal));
  const uScale = uniform(float(impostorScale));
  const uCenter = uniform(new THREE.Vector3());

  const uSunDir = uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uSunColor = uniform(new THREE.Vector3(2.0, 1.708, 1.446));
  const uAmbColor = uniform(new THREE.Vector3(0.062, 0.080, 0.101));
  const uHemiSky = uniform(new THREE.Vector3(0.053, 0.098, 0.242));
  const uHemiGround = uniform(new THREE.Vector3(0.020, 0.013, 0.006));
  const uNormStr = uniform(float(1.0));
  const uRimStr = uniform(float(0.14));
  const uRimPow = uniform(float(3.0));
  const uRimCol = uniform(new THREE.Vector3(0.4, 0.5, 0.65));
  const uAlphaCutoff = uniform(float(0.15));
  const uEdgeSmooth = uniform(float(1.5));
  const uDiffuseWrap = uniform(float(0.0));
  const uParallaxStr = uniform(float(0.0));
  const uDither = uniform(float(0));
  const uDebugMode = uniform(float(0));    // 0=lit, 1=normals, 2=raw atlas
  const uFreeze = uniform(float(0));
  const uFreezeDir = uniform(new THREE.Vector3(0, 0, 1));

  // Half-texel inset to prevent cross-cell bleeding
  const cellPx = Math.floor(atlasSize / gridVal);
  const htx = 0.5 / cellPx;
  const uHTX = uniform(float(htx));

  const vWeight = varying(vec4(0, 0, 0, 0), "vW");
  const vS1 = varying(vec2(0, 0), "vS1");
  const vS2 = varying(vec2(0, 0), "vS2");
  const vS3 = varying(vec2(0, 0), "vS3");
  const vUV1 = varying(vec2(0, 0), "vUV1");
  const vUV2 = varying(vec2(0, 0), "vUV2");
  const vUV3 = varying(vec2(0, 0), "vUV3");

  const encode = Fn(([d]) => {
    const s = vec3(sign(d.x), sign(d.y), sign(d.z));
    const l1 = dot(d, s);
    const o = vec3(div(d.x, l1), div(d.y, l1), div(d.z, l1));
    return mul(vec2(add(1, add(o.x, o.z)), add(1, sub(o.z, o.x))), 0.5);
  });

  const decode = Fn(([gi, nm1]) => {
    const u = vec2(div(gi.x, nm1.x), div(gi.y, nm1.y));
    const px = sub(u.x, u.y);
    const pz = sub(add(u.x, u.y), 1);
    const py = sub(sub(1, abs(px)), abs(pz));
    return normalize(vec3(px, py, pz));
  });

  const planeTangent = Fn(([n]) => {
    const up = mix(
      vec3(0, 1, 0), vec3(-1, 0, 0),
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
    return add(vec2(dot(t, hit), dot(upP, hit)), 0.5);
  });

  // ── vertex stage: billboard + octahedral lookup (with freeze support) ──
  const posNodeFn = Fn(() => {
    const nm1 = vec2(sub(uSPS, 1), sub(uSPS, 1));
    const camLocal = mul(sub(cameraPosition, uCenter), div(1, uScale));
    const actualCamDir = normalize(camLocal);

    // Billboard always faces real camera
    const bv = projectVert(actualCamDir);
    const viewDir = normalize(sub(bv, camLocal));

    // Atlas lookup: frozen or actual direction
    const lookupDir = select(
      uFreeze.greaterThan(float(0.5)), uFreezeDir, actualCamDir,
    );

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

    return bv;
  });

  // ── atlas UV with half-texel inset ──
  const getUV = Fn(([uvf, frame, fs]) => {
    const clamped = clamp(vec2(uvf.x, uvf.y), uHTX, sub(float(1), uHTX));
    return clamp(mul(fs, add(frame, clamped)), 0, 1);
  });

  // ── depth parallax UV offset ──
  const depthParallax = Fn(([localUV, cellNorm, frame, fs]) => {
    const baseAtlasUV = getUV(localUV, frame, fs);
    const d = texture(depthTex, baseAtlasUV).r;
    const relD = sub(float(0.5), d);
    const V = normalize(sub(cameraPosition, positionWorld));
    const T = planeTangent(cellNorm);
    const B = planeUp(cellNorm, T);
    const VdotN = max(dot(V, cellNorm), float(0.3));
    const off = mul(vec2(dot(V, T), dot(V, B)), div(mul(relD, uParallaxStr), VdotN));
    return getUV(add(localUV, off), frame, fs);
  });

  // ── fragment stage ──
  const colorNodeFn = Fn(() => {
    const fs = div(float(1), uSPS);
    const nm1_f = vec2(sub(uSPS, 1), sub(uSPS, 1));

    const cn1 = decode(vS1, nm1_f);
    const cn2 = decode(vS2, nm1_f);
    const cn3 = decode(vS3, nm1_f);

    const puv1 = depthParallax(vUV1, cn1, vS1, fs);
    const puv2 = depthParallax(vUV2, cn2, vS2, fs);
    const puv3 = depthParallax(vUV3, cn3, vS3, fs);

    const c1 = texture(colorTex, puv1);
    const c2 = texture(colorTex, puv2);
    const c3 = texture(colorTex, puv3);

    // Dominant sprite selection (single cell — avoids ghosting on complex shapes)
    const isDom1 = vWeight.x.greaterThanEqual(vWeight.y).and(vWeight.x.greaterThanEqual(vWeight.z));
    const isDom2 = vWeight.y.greaterThanEqual(vWeight.z);
    const domAlpha = select(isDom1, c1.a, select(isDom2, c2.a, c3.a));
    const domRgb = select(isDom1, c1.rgb, select(isDom2, c2.rgb, c3.rgb));

    // IGN dither (optional alternative)
    const px = viewportCoordinate.xy;
    const ign = fract(mul(float(52.9829189), fract(add(mul(float(0.06711056), px.x), mul(float(0.00583715), px.y)))));
    const wSum = add(add(vWeight.x, vWeight.y), vWeight.z);
    const nw1 = div(vWeight.x, max(wSum, float(0.001)));
    const nw12 = div(add(vWeight.x, vWeight.y), max(wSum, float(0.001)));
    const ditS1 = ign.lessThan(nw1);
    const ditS2 = ign.lessThan(nw12);
    const ditAlpha = select(ditS1, c1.a, select(ditS2, c2.a, c3.a));
    const ditRgb = select(ditS1, c1.rgb, select(ditS2, c2.rgb, c3.rgb));

    const useDit = uDither.greaterThan(float(0.5));
    const selAlpha = select(useDit, ditAlpha, domAlpha);
    const selRgb = select(useDit, ditRgb, domRgb);

    const edgeW = mul(fwidth(selAlpha), uEdgeSmooth);
    const alpha = smoothstep(sub(uAlphaCutoff, edgeW), add(uAlphaCutoff, edgeW), selAlpha);
    const albedo = saturate(mul(selRgb, div(1, max(selAlpha, float(0.001)))));

    // Normals
    const n1 = texture(normalTex, puv1).xyz;
    const n2 = texture(normalTex, puv2).xyz;
    const n3 = texture(normalTex, puv3).xyz;
    const normEnc = select(useDit,
      select(ditS1, n1, select(ditS2, n2, n3)),
      select(isDom1, n1, select(isDom2, n2, n3)),
    );
    const wNormRaw = normalize(sub(mul(normEnc, 2.0), 1.0));
    const wNorm = normalize(mix(vec3(0, 1, 0), wNormRaw, uNormStr));

    // Roughness / metalness
    const rm1 = texture(rmTex, puv1);
    const rm2 = texture(rmTex, puv2);
    const rm3 = texture(rmTex, puv3);
    const rmSel = select(useDit,
      select(ditS1, rm1, select(ditS2, rm2, rm3)),
      select(isDom1, rm1, select(isDom2, rm2, rm3)),
    );
    const rough = clamp(rmSel.x, float(0.05), float(1));
    const metal = clamp(rmSel.y, float(0), float(1));
    const oneMinusMetal = sub(float(1), metal);

    // ── Debug: normals viz ──
    const isNormViz = uDebugMode.greaterThan(float(0.5)).and(uDebugMode.lessThan(float(1.5)));
    // ── Debug: raw atlas ──
    const isRawViz = uDebugMode.greaterThan(float(1.5));

    // ── PBR lighting ──
    const INV_PI = float(0.31831);
    const viewDir = normalize(sub(cameraPosition, positionWorld));
    const rawNdotL = dot(wNorm, uSunDir);
    const NdotL = max(rawNdotL, float(0));
    const NdotLWrap = div(add(NdotL, uDiffuseWrap), add(float(1), uDiffuseWrap));
    const NdotV = max(dot(wNorm, viewDir), float(0.001));

    const diffuse = mul(mul(mul(mul(NdotLWrap, INV_PI), oneMinusMetal), albedo), uSunColor);

    const H = normalize(add(uSunDir, viewDir));
    const NdotH = max(dot(wNorm, H), float(0));
    const HdotV = max(dot(H, viewDir), float(0.001));
    const a2 = pow(rough, float(4));
    const dNH = add(mul(mul(NdotH, NdotH), sub(a2, 1)), 1);
    const D = div(a2, add(mul(float(3.14159), mul(dNH, dNH)), float(0.001)));
    const F0 = mix(vec3(0.04, 0.04, 0.04), albedo, metal);
    const F = add(F0, mul(sub(vec3(1, 1, 1), F0), pow(sub(1, HdotV), float(5))));
    const k = div(mul(add(rough, 1), add(rough, 1)), 8);
    const G1V = div(NdotV, add(mul(NdotV, sub(1, k)), k));
    const G1L = div(NdotL, add(mul(NdotL, sub(1, k)), add(k, float(0.001))));
    const spec = mul(
      div(mul(mul(D, F), mul(G1V, G1L)), add(mul(mul(4, NdotV), NdotL), float(0.001))),
      mul(uSunColor, max(NdotL, float(0))),
    );

    const hemiT = mul(add(wNorm.y, 1.0), 0.5);
    const hemiIrrad = add(uAmbColor, mix(uHemiGround, uHemiSky, hemiT));
    const ambient = mul(mul(mul(hemiIrrad, INV_PI), oneMinusMetal), albedo);

    const oneMinusRough = sub(float(1), rough);
    const maxSmooth = max(vec3(oneMinusRough, oneMinusRough, oneMinusRough), F0);
    const envF = add(F0, mul(sub(maxSmooth, F0), pow(sub(float(1), NdotV), float(5))));
    const envColor = mix(uHemiGround, uHemiSky, hemiT);
    const indirectSpec = mul(envF, envColor);

    const rim = mul(mul(uRimStr, pow(sub(1, NdotV), uRimPow)), uRimCol);
    const lit = add(add(add(add(diffuse, spec), ambient), indirectSpec), rim);

    // Final output: pick debug mode or full PBR
    const normVizColor = mul(add(wNorm, float(1)), float(0.5));
    const finalRgb = select(isRawViz, albedo, select(isNormViz, normVizColor, lit));

    return vec4(finalRgb, alpha);
  });

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
  mat.positionNode = posNodeFn();
  mat.colorNode = colorNodeFn();
  mat.transparent = false;
  mat.alphaTest = 0.005;
  mat.depthWrite = true;

  return {
    mat, uCenter, uSunDir, uSunColor, uAmbColor,
    uHemiSky, uHemiGround, uNormStr, uRimStr, uRimPow,
    uRimCol, uAlphaCutoff, uEdgeSmooth, uDiffuseWrap, uParallaxStr,
    uScale, uSPS, uDither, uDebugMode, uFreeze, uFreezeDir,
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
  canvas.toBlob(blob => {
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
  info.textContent = "Initialising WebGPU…";

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);

  const maxAniso = renderer.capabilities ? (renderer.capabilities.maxAnisotropy || 16) : 16;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20252f);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, 3, 10);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);
  scene.add(new THREE.HemisphereLight(0x6688cc, 0x443322, 0.4));
  scene.add(new THREE.AmbientLight(0x8899aa, 0.25));

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 60),
    new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const gltfLoader = new GLTFLoader();
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
  gltfLoader.setDRACOLoader(dracoLoader);

  // ═══════════════════════════════════════════════════════════════════════
  //  State
  // ═══════════════════════════════════════════════════════════════════════

  let sourceGroup = null;
  let bakeMeshData = [];
  let sourceBSphere = null;
  let impostor = null;
  let imp = null;
  let atlasResult = null;
  let debugAtlasColor = null;
  let debugAtlasNormal = null;
  let debugAtlasRM = null;
  let debugAtlasDepth = null;
  let isBaking = false;
  let currentModelName = "TorusKnot";

  // FPS counter
  let frameCount = 0, lastFpsTime = performance.now(), fps = 0;

  function clearScene() {
    if (sourceGroup) { scene.remove(sourceGroup); sourceGroup = null; }
    if (impostor) { scene.remove(impostor); impostor.geometry.dispose(); impostor = null; }
    if (debugAtlasColor) { scene.remove(debugAtlasColor); debugAtlasColor = null; }
    if (debugAtlasNormal) { scene.remove(debugAtlasNormal); debugAtlasNormal = null; }
    if (debugAtlasRM) { scene.remove(debugAtlasRM); debugAtlasRM = null; }
    if (debugAtlasDepth) { scene.remove(debugAtlasDepth); debugAtlasDepth = null; }
    if (atlasResult) {
      atlasResult.colorTex.dispose();
      atlasResult.normalTex.dispose();
      atlasResult.rmTex.dispose();
      atlasResult.depthTex.dispose();
      atlasResult = null;
    }
    imp = null;
    bakeMeshData = [];
  }

  function extractBakeData(obj) {
    const data = [];
    obj.updateMatrixWorld(true);
    obj.traverse(child => {
      if (!child.isMesh) return;
      const geo = child.geometry.clone();
      geo.applyMatrix4(child.matrixWorld);
      data.push({ geometry: geo, material: child.material });
    });
    return data;
  }

  function computeBoundingSphere(meshData) {
    const box = new THREE.Box3();
    for (const { geometry } of meshData) {
      geometry.computeBoundingBox();
      box.union(geometry.boundingBox);
    }
    const s = new THREE.Sphere();
    box.getBoundingSphere(s);
    return s;
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
    sourceBSphere = computeBoundingSphere(bakeMeshData);
    sourceGroup.position.set(-3, sourceBSphere.radius - sourceBSphere.center.y, 0);
    scene.add(sourceGroup);
    P.roughness = mat.roughness;
    P.metalness = mat.metalness;
  }

  async function loadGLB(file) {
    info.textContent = `Loading ${file.name}…`;
    const url = URL.createObjectURL(file);
    try {
      const gltf = await gltfLoader.loadAsync(url);
      URL.revokeObjectURL(url);
      clearScene();
      currentModelName = file.name.replace(/\.[^.]+$/, "");

      gltf.scene.updateMatrixWorld(true);
      sourceGroup = gltf.scene;
      bakeMeshData = extractBakeData(sourceGroup);

      if (bakeMeshData.length === 0) {
        info.textContent = "No meshes found in GLB.";
        return;
      }
      sourceBSphere = computeBoundingSphere(bakeMeshData);
      const firstMat = bakeMeshData[0].material;

      const displayGroup = new THREE.Group();
      gltf.scene.traverse(child => {
        if (child.isMesh) {
          const m = child.clone();
          displayGroup.add(m);
        }
      });
      sourceGroup = displayGroup;
      sourceGroup.position.set(-3, -sourceBSphere.center.y + sourceBSphere.radius, 0);
      scene.add(sourceGroup);

      P.roughness = firstMat.roughness !== undefined ? firstMat.roughness : 0.5;
      P.metalness = firstMat.metalness !== undefined ? firstMat.metalness : 0.0;
      await rebake();
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
    info.textContent = "Baking atlas (3-pass)…";

    if (impostor) { scene.remove(impostor); impostor.geometry.dispose(); impostor = null; }
    if (debugAtlasColor) { scene.remove(debugAtlasColor); debugAtlasColor = null; }
    if (debugAtlasNormal) { scene.remove(debugAtlasNormal); debugAtlasNormal = null; }
    if (debugAtlasRM) { scene.remove(debugAtlasRM); debugAtlasRM = null; }
    if (debugAtlasDepth) { scene.remove(debugAtlasDepth); debugAtlasDepth = null; }
    if (atlasResult) {
      atlasResult.colorTex.dispose();
      atlasResult.normalTex.dispose();
      atlasResult.rmTex.dispose();
      atlasResult.depthTex.dispose();
    }

    try {
      atlasResult = await bakeAtlases(renderer, bakeMeshData, {
        grid: P.grid, atlasSize: P.atlasSize, maxAniso,
      });

      info.textContent = "Creating impostor…";
      imp = createImpostorMaterial(
        atlasResult.colorTex, atlasResult.normalTex, atlasResult.rmTex,
        atlasResult.depthTex, atlasResult.radius, P.grid, P.atlasSize,
      );

      const impostorGeo = new THREE.PlaneGeometry(1, 1);
      impostor = new THREE.Mesh(impostorGeo, imp.mat);
      const impostorY = sourceBSphere.radius - sourceBSphere.center.y;
      impostor.position.set(3, impostorY + sourceBSphere.center.y, 0);
      impostor.scale.setScalar(2 * atlasResult.radius);
      impostor.frustumCulled = false;
      imp.uCenter.value.copy(impostor.position);
      scene.add(impostor);

      const ps = 2.5;
      debugAtlasColor = new THREE.Mesh(
        new THREE.PlaneGeometry(ps, ps),
        new THREE.MeshBasicMaterial({ map: atlasResult.colorTex, side: THREE.DoubleSide }),
      );
      debugAtlasColor.position.set(-3.2, 5.5, -6);
      debugAtlasColor.visible = P.showAtlas;
      scene.add(debugAtlasColor);

      debugAtlasNormal = new THREE.Mesh(
        new THREE.PlaneGeometry(ps, ps),
        new THREE.MeshBasicMaterial({ map: atlasResult.normalTex, side: THREE.DoubleSide }),
      );
      debugAtlasNormal.position.set(0, 5.5, -6);
      debugAtlasNormal.visible = P.showAtlas;
      scene.add(debugAtlasNormal);

      debugAtlasRM = new THREE.Mesh(
        new THREE.PlaneGeometry(ps, ps),
        new THREE.MeshBasicMaterial({ map: atlasResult.rmTex, side: THREE.DoubleSide }),
      );
      debugAtlasRM.position.set(3.2, 5.5, -6);
      debugAtlasRM.visible = P.showAtlas;
      scene.add(debugAtlasRM);

      debugAtlasDepth = new THREE.Mesh(
        new THREE.PlaneGeometry(ps, ps),
        new THREE.MeshBasicMaterial({ map: atlasResult.depthTex, side: THREE.DoubleSide }),
      );
      debugAtlasDepth.position.set(6.4, 5.5, -6);
      debugAtlasDepth.visible = P.showAtlas;
      scene.add(debugAtlasDepth);

      info.textContent = "Compiling shaders…";
      await renderer.compileAsync(scene, camera);
      syncParams();
      updateInfo();
    } catch (e) {
      info.textContent = "Bake error: " + e.message;
      console.error(e);
    }
    isBaking = false;
  }

  function updateInfo() {
    const parts = [
      `${currentModelName}`,
      `Grid ${P.grid}×${P.grid}`,
      `Atlas ${P.atlasSize}px`,
      `${bakeMeshData.length} mesh(es)`,
      `FPS ${fps}`,
    ];
    if (P.freeze) parts.push("FROZEN [F]");
    if (P.autoOrbit) parts.push("ORBIT [O]");
    if (P.debugMode === 1) parts.push("NORMALS [N]");
    if (P.debugMode === 2) parts.push("RAW [R]");
    info.textContent = parts.join(" · ");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Params + sync
  // ═══════════════════════════════════════════════════════════════════════

  const P = {
    model: "TorusKnot",
    grid: 12, atlasSize: 2048,
    showAtlas: true, showOriginal: true, showImpostor: true,
    sunAzimuth: 225, sunElevation: 56, sunIntensity: 2.0, exposure: 1.0,
    roughness: 0.35, metalness: 0.15, normalStr: 1.0,
    dither: false,
    rimStr: 0.14, rimPow: 3.0,
    alphaCutoff: 0.15, edgeSmooth: 1.5, diffuseWrap: 0.0, parallaxStr: 0.0,
    debugMode: 0, freeze: false, autoOrbit: false,
  };

  function syncParams() {
    if (!imp) return;

    const az = P.sunAzimuth * Math.PI / 180;
    const el = P.sunElevation * Math.PI / 180;
    const d = new THREE.Vector3(
      Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az),
    ).normalize();
    dirLight.position.copy(d).multiplyScalar(20);
    dirLight.intensity = P.sunIntensity;
    renderer.toneMappingExposure = P.exposure;

    imp.uSunDir.value.copy(d);
    imp.uSunColor.value.set(
      1.0 * P.sunIntensity, 0.854 * P.sunIntensity, 0.723 * P.sunIntensity,
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

    if (sourceGroup) {
      sourceGroup.visible = P.showOriginal;
      sourceGroup.traverse(c => {
        if (c.isMesh && c.material && c.material.isMeshStandardMaterial) {
          c.material.roughness = P.roughness;
          c.material.metalness = P.metalness;
        }
      });
    }
    if (impostor) impostor.visible = P.showImpostor;
    if (debugAtlasColor) debugAtlasColor.visible = P.showAtlas;
    if (debugAtlasNormal) debugAtlasNormal.visible = P.showAtlas;
    if (debugAtlasRM) debugAtlasRM.visible = P.showAtlas;
    if (debugAtlasDepth) debugAtlasDepth.visible = P.showAtlas;

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

  const gui = new GUI({ title: "Impostor Editor", width: 240 });
  gui.domElement.style.cssText = "position:fixed;top:8px;right:8px;z-index:10;";

  const fModel = gui.addFolder("Model");
  fModel.add(P, "model", ["TorusKnot", "Sphere", "Torus", "Cylinder"]).name("Primitive").onChange(v => {
    loadPrimitive(v);
    rebake();
  });
  fModel.add({ load: () => fileInput.click() }, "load").name("Load GLB…");
  fModel.add(P, "showOriginal").name("Show original").onChange(syncParams);
  fModel.add(P, "showImpostor").name("Show impostor").onChange(syncParams);

  const fAtlas = gui.addFolder("Atlas");
  fAtlas.add(P, "grid", [4, 6, 8, 10, 12, 14, 16]).name("Grid").onChange(() => rebake());
  fAtlas.add(P, "atlasSize", [512, 1024, 2048, 4096]).name("Resolution").onChange(() => rebake());
  fAtlas.add(P, "showAtlas").name("Show preview").onChange(syncParams);
  fAtlas.add({ rebake: () => rebake() }, "rebake").name("Rebake now");

  const fSun = gui.addFolder("Sun");
  fSun.add(P, "sunAzimuth", 0, 360, 1).name("Azimuth").onChange(syncParams);
  fSun.add(P, "sunElevation", 5, 90, 0.5).name("Elevation").onChange(syncParams);
  fSun.add(P, "sunIntensity", 0.2, 5, 0.1).name("Intensity").onChange(syncParams);
  fSun.add(P, "exposure", 0.2, 3, 0.05).name("Exposure").onChange(syncParams);

  const fMat = gui.addFolder("Material (original)");
  fMat.add(P, "roughness", 0.05, 1, 0.01).name("Roughness").onChange(syncParams);
  fMat.add(P, "metalness", 0, 1, 0.01).name("Metalness").onChange(syncParams);
  fMat.add(P, "normalStr", 0, 1, 0.02).name("Normal strength").onChange(syncParams);

  const fRender = gui.addFolder("Rendering");
  fRender.add(P, "dither").name("Dither crossfade").onChange(syncParams);
  fRender.add(P, "rimStr", 0, 0.5, 0.01).name("Rim strength").onChange(syncParams);
  fRender.add(P, "rimPow", 1, 8, 0.5).name("Rim power").onChange(syncParams);
  fRender.add(P, "alphaCutoff", 0.01, 0.5, 0.01).name("Alpha cutoff").onChange(syncParams);
  fRender.add(P, "edgeSmooth", 0, 4, 0.1).name("Edge AA").onChange(syncParams);
  fRender.add(P, "diffuseWrap", 0, 0.8, 0.05).name("Diffuse wrap").onChange(syncParams);
  fRender.add(P, "parallaxStr", 0, 0.5, 0.01).name("Depth parallax").onChange(syncParams);

  const fDebug = gui.addFolder("Debug / View");
  fDebug.add(P, "debugMode", { "Full PBR": 0, "Normals [N]": 1, "Raw atlas [R]": 2 }).name("Display").onChange(syncParams);
  let freezeCtrl = fDebug.add(P, "freeze").name("Freeze angle [F]").onChange(() => {
    if (P.freeze && imp) {
      const camLocal = new THREE.Vector3()
        .subVectors(camera.position, imp.uCenter.value)
        .divideScalar(imp.uScale.value);
      imp.uFreezeDir.value.copy(camLocal.normalize());
    }
    syncParams();
  });
  fDebug.add(P, "autoOrbit").name("Auto-orbit [O]").onChange(syncParams);

  const fExport = gui.addFolder("Export");
  fExport.add({
    fn: () => { if (atlasResult) exportPNG(atlasResult.colorPixels, P.atlasSize, P.atlasSize, `${currentModelName}_color_${P.grid}x${P.grid}.png`); },
  }, "fn").name("Color atlas → PNG");
  fExport.add({
    fn: () => { if (atlasResult) exportPNG(atlasResult.normalPixels, P.atlasSize, P.atlasSize, `${currentModelName}_normal_${P.grid}x${P.grid}.png`); },
  }, "fn").name("Normal atlas → PNG");
  fExport.add({
    fn: () => { if (atlasResult) exportPNG(atlasResult.rmPixels, P.atlasSize, P.atlasSize, `${currentModelName}_rm_${P.grid}x${P.grid}.png`); },
  }, "fn").name("Rough/Metal atlas → PNG");
  fExport.add({
    fn: () => { if (atlasResult) exportPNG(atlasResult.depthPixels, P.atlasSize, P.atlasSize, `${currentModelName}_depth_${P.grid}x${P.grid}.png`); },
  }, "fn").name("Depth atlas → PNG");

  // ═══════════════════════════════════════════════════════════════════════
  //  Keyboard shortcuts
  // ═══════════════════════════════════════════════════════════════════════

  addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    switch (e.code) {
      case "KeyN":
        P.debugMode = P.debugMode === 1 ? 0 : 1;
        syncParams();
        gui.controllersRecursive().forEach(c => c.updateDisplay());
        break;
      case "KeyR":
        P.debugMode = P.debugMode === 2 ? 0 : 2;
        syncParams();
        gui.controllersRecursive().forEach(c => c.updateDisplay());
        break;
      case "KeyF":
        toggleFreeze();
        break;
      case "KeyO":
        P.autoOrbit = !P.autoOrbit;
        syncParams();
        gui.controllersRecursive().forEach(c => c.updateDisplay());
        break;
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  Drag-and-drop
  // ═══════════════════════════════════════════════════════════════════════

  let dragCounter = 0;
  document.addEventListener("dragenter", e => { e.preventDefault(); dragCounter++; dropOverlay.style.display = "flex"; });
  document.addEventListener("dragleave", e => { e.preventDefault(); dragCounter--; if (dragCounter <= 0) { dropOverlay.style.display = "none"; dragCounter = 0; } });
  document.addEventListener("dragover", e => e.preventDefault());
  document.addEventListener("drop", e => {
    e.preventDefault(); dragCounter = 0; dropOverlay.style.display = "none";
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

    // FPS
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 500) {
      fps = Math.round(frameCount / ((now - lastFpsTime) / 1000));
      frameCount = 0;
      lastFpsTime = now;
      updateInfo();
    }

    renderer.render(scene, camera);
  });
}
