import * as THREE from "three";
import {
  Fn, normalize, sub, mul, add, div, abs, vec2, vec3, vec4,
  sign, dot, cross, floor, fract, min, max, clamp, saturate,
  texture, cameraPosition, positionWorld, positionLocal,
  float, uniform, varying, select, length, negate, mix,
  smoothstep, fwidth, pow, normalWorld,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "three/addons/libs/lil-gui.module.min.js";

const ATLAS_SIZE = 2048;
const GRID = 12;

// ─── Hemi-octahedral direction: grid [0,1]² → unit direction (y ≥ 0) ────────
function hemiOctaGridToDir(gx, gy, out) {
  out.set(gx - gy, 0, -1 + gx + gy);
  out.y = 1 - Math.abs(out.x) - Math.abs(out.z);
  return out.normalize();
}

// ─── Atlas baking (cell-by-cell readback → DataTexture) ──────────────────────
async function bakeAtlases(renderer, sourceGeo, sourceMat) {
  sourceGeo.computeBoundingSphere();
  const sphere = sourceGeo.boundingSphere;
  const radius = sphere.radius * 1.08;
  const center = sphere.center.clone();
  const half = radius;

  const ortho = new THREE.OrthographicCamera(-half, half, half, -half, 0.001, radius * 4);
  const cs = Math.floor(ATLAS_SIZE / GRID);
  const dir = new THREE.Vector3();

  const colorMat = new THREE.MeshBasicMaterial({
    color: sourceMat.color ? sourceMat.color.clone() : new THREE.Color(0xffffff),
    map: sourceMat.map || null,
    alphaTest: sourceMat.alphaTest || 0,
    side: THREE.DoubleSide,
  });

  const normalMat = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    colorNode: vec4(mul(add(normalWorld, 1), 0.5), float(1)),
  });

  const colorScene = new THREE.Scene();
  colorScene.add(new THREE.Mesh(sourceGeo, colorMat));
  const normalScene = new THREE.Scene();
  normalScene.add(new THREE.Mesh(sourceGeo, normalMat));

  // One small RT per cell — avoids multi-pass preservation issues in WebGPU
  const cellRT = new THREE.RenderTarget(cs, cs, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
  });

  const savedToneMapping = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(0x000000, 0);

  // Pre-compile both materials so the first render doesn't fail silently
  await renderer.compileAsync(colorScene, ortho);
  await renderer.compileAsync(normalScene, ortho);

  const colorPixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);
  const normalPixels = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE * 4);

  // WebGPU readback pads rows to 256-byte alignment
  const tightRowBytes = cs * 4;
  const paddedRowBytes = Math.ceil(tightRowBytes / 256) * 256;

  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      hemiOctaGridToDir(gx / (GRID - 1), gy / (GRID - 1), dir);
      ortho.position.copy(center).addScaledVector(dir, radius * 2);
      ortho.lookAt(center);
      ortho.updateMatrixWorld(true);

      for (const [sc, dest] of [[colorScene, colorPixels], [normalScene, normalPixels]]) {
        renderer.setRenderTarget(cellRT);
        renderer.autoClear = true;
        renderer.render(sc, ortho);

        const buf = await renderer.readRenderTargetPixelsAsync(cellRT, 0, 0, cs, cs);
        const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

        // Detect actual row stride from buffer size
        const srcStride = (src.length > cs * cs * 4) ? paddedRowBytes : tightRowBytes;

        for (let row = 0; row < cs; row++) {
          const srcOff = (cs - 1 - row) * srcStride; // flip Y: WebGPU top-down → DataTexture bottom-up
          const dy = gy * cs + row;
          const dstOff = (dy * ATLAS_SIZE + gx * cs) * 4;
          dest.set(src.subarray(srcOff, srcOff + tightRowBytes), dstOff);
        }
      }
    }
  }

  cellRT.dispose();
  renderer.setRenderTarget(null);
  renderer.autoClear = true;
  renderer.toneMapping = savedToneMapping;

  const makeTex = (data) => {
    const t = new THREE.DataTexture(data, ATLAS_SIZE, ATLAS_SIZE, THREE.RGBAFormat);
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  };

  return { colorTex: makeTex(colorPixels), normalTex: makeTex(normalPixels), radius, center };
}

// ─── TSL Impostor Material ───────────────────────────────────────────────────
function createImpostorMaterial(colorTex, normalTex, impostorScale) {
  const uSPS = uniform(float(GRID));
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
  const uRoughness = uniform(float(0.35));
  const uMetalness = uniform(float(0.15));

  const vWeight = varying(vec4(0, 0, 0, 0), "vW");
  const vS1 = varying(vec2(0, 0), "vS1");
  const vS2 = varying(vec2(0, 0), "vS2");
  const vS3 = varying(vec2(0, 0), "vS3");
  const vUV1 = varying(vec2(0, 0), "vUV1");
  const vUV2 = varying(vec2(0, 0), "vUV2");
  const vUV3 = varying(vec2(0, 0), "vUV3");

  // ── Octahedral encode: unit direction → [0,1]² ──
  const encode = Fn(([d]) => {
    const s = vec3(sign(d.x), sign(d.y), sign(d.z));
    const l1 = dot(d, s);
    const o = vec3(div(d.x, l1), div(d.y, l1), div(d.z, l1));
    return mul(vec2(add(1, add(o.x, o.z)), add(1, sub(o.z, o.x))), 0.5);
  });

  // ── Octahedral decode: grid index → unit direction ──
  const decode = Fn(([gi, nm1]) => {
    const u = vec2(div(gi.x, nm1.x), div(gi.y, nm1.y));
    const px = sub(u.x, u.y);
    const pz = sub(add(u.x, u.y), 1);
    const py = sub(sub(1, abs(px)), abs(pz));
    return normalize(vec3(px, py, pz));
  });

  // ── Plane basis from sprite normal — degenerate-safe ──
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

  // Billboard vertex: orient quad face camera using plane basis
  const projectVert = Fn(([n]) => {
    const t = planeTangent(n);
    const up = planeUp(n, t);
    return add(mul(positionLocal.x, t), mul(positionLocal.y, up));
  });

  // Ray–plane intersection → per-sprite UV (parallax)
  const planeUV = Fn(([n, t, camL, vd]) => {
    const denom = dot(vd, n);
    const tt = mul(dot(negate(camL), n), div(1, denom));
    const hit = add(camL, mul(vd, tt));
    const upP = planeUp(n, t);
    return add(vec2(dot(t, hit), dot(upP, hit)), 0.5);
  });

  // ── Vertex stage: billboard + compute varyings ──
  const posNodeFn = Fn(() => {
    const nm1 = vec2(sub(uSPS, 1), sub(uSPS, 1));
    const camLocal = mul(sub(cameraPosition, uCenter), div(1, uScale));
    const camDir = normalize(camLocal);
    const bv = projectVert(camDir);
    const viewDir = normalize(sub(bv, camLocal));

    // Octahedral grid lookup
    const grid = mul(encode(camDir), nm1);
    const gf = min(floor(grid), nm1);
    const fr = fract(grid);

    // 3-cell blend weights
    const w = vec4(
      min(sub(1, fr.x), sub(1, fr.y)),
      abs(sub(fr.x, fr.y)),
      min(fr.x, fr.y),
      max(float(0), sign(sub(fr.x, fr.y))),
    );
    vWeight.assign(w);

    // 3 nearest sprite indices
    const s1 = gf;
    const s2 = min(add(s1, mix(vec2(0, 1), vec2(1, 0), w.w)), nm1);
    const s3 = min(add(s1, vec2(1, 1)), nm1);
    vS1.assign(s1);
    vS2.assign(s2);
    vS3.assign(s3);

    // Per-sprite parallax UVs via ray-plane intersection
    const pn1 = decode(s1, nm1); const pt1 = planeTangent(pn1);
    const pn2 = decode(s2, nm1); const pt2 = planeTangent(pn2);
    const pn3 = decode(s3, nm1); const pt3 = planeTangent(pn3);
    vUV1.assign(planeUV(pn1, pt1, camLocal, viewDir));
    vUV2.assign(planeUV(pn2, pt2, camLocal, viewDir));
    vUV3.assign(planeUV(pn3, pt3, camLocal, viewDir));

    return bv;
  });

  // ── Atlas cell UV ──
  const getUV = Fn(([uvf, frame, fs]) =>
    clamp(mul(fs, add(frame, clamp(vec2(uvf.x, uvf.y), 0, 1))), 0, 1),
  );

  // ── Fragment stage: sample, dominant-sprite select, PBR light ──
  const colorNodeFn = Fn(() => {
    const fs = div(float(1), uSPS);

    const c1 = texture(colorTex, getUV(vUV1, vS1, fs));
    const c2 = texture(colorTex, getUV(vUV2, vS2, fs));
    const c3 = texture(colorTex, getUV(vUV3, vS3, fs));

    // Dominant sprite (avoids ghosting from blended views)
    const isDom1 = vWeight.x.greaterThanEqual(vWeight.y).and(vWeight.x.greaterThanEqual(vWeight.z));
    const isDom2 = vWeight.y.greaterThanEqual(vWeight.z);

    const domAlpha = select(isDom1, c1.a, select(isDom2, c2.a, c3.a));
    const domRgb = select(isDom1, c1.rgb, select(isDom2, c2.rgb, c3.rgb));

    // Edge anti-aliasing via fwidth smoothstep
    const edgeW = mul(fwidth(domAlpha), uEdgeSmooth);
    const alpha = smoothstep(sub(uAlphaCutoff, edgeW), add(uAlphaCutoff, edgeW), domAlpha);

    // Undo pre-multiplied alpha
    const albedo = saturate(mul(domRgb, div(1, max(domAlpha, float(0.001)))));

    // Normal from atlas (dominant sprite)
    const n1 = texture(normalTex, getUV(vUV1, vS1, fs)).xyz;
    const n2 = texture(normalTex, getUV(vUV2, vS2, fs)).xyz;
    const n3 = texture(normalTex, getUV(vUV3, vS3, fs)).xyz;
    const normEnc = select(isDom1, n1, select(isDom2, n2, n3));
    const wNormRaw = normalize(sub(mul(normEnc, 2.0), 1.0));
    const wNorm = normalize(mix(vec3(0, 1, 0), wNormRaw, uNormStr));

    const INV_PI = float(0.31831);
    const rough = uRoughness;
    const oneMinusMetal = sub(float(1), uMetalness);

    const viewDir = normalize(sub(cameraPosition, positionWorld));
    const NdotL = max(dot(wNorm, uSunDir), float(0));
    const NdotV = max(dot(wNorm, viewDir), float(0.001));

    // Lambert diffuse with 1/π energy conservation (matches MeshStandardMaterial)
    const diffuse = mul(mul(mul(mul(NdotL, INV_PI), oneMinusMetal), albedo), uSunColor);

    // GGX specular with metalness-aware F0
    const H = normalize(add(uSunDir, viewDir));
    const NdotH = max(dot(wNorm, H), float(0));
    const HdotV = max(dot(H, viewDir), float(0.001));
    const a2 = pow(rough, float(4));
    const dNH = add(mul(mul(NdotH, NdotH), sub(a2, 1)), 1);
    const D = div(a2, add(mul(float(3.14159), mul(dNH, dNH)), float(0.001)));
    const F0 = mix(vec3(0.04, 0.04, 0.04), albedo, uMetalness);
    const F = add(F0, mul(sub(vec3(1, 1, 1), F0), pow(sub(1, HdotV), float(5))));
    const k = div(mul(add(rough, 1), add(rough, 1)), 8);
    const G1V = div(NdotV, add(mul(NdotV, sub(1, k)), k));
    const G1L = div(NdotL, add(mul(NdotL, sub(1, k)), add(k, float(0.001))));
    const spec = mul(
      div(mul(mul(D, F), mul(G1V, G1L)), add(mul(mul(4, NdotV), NdotL), float(0.001))),
      mul(uSunColor, max(NdotL, float(0))),
    );

    // Hemisphere ambient (indirect diffuse with 1/π)
    const hemiT = mul(add(wNorm.y, 1.0), 0.5);
    const hemiIrrad = add(uAmbColor, mix(uHemiGround, uHemiSky, hemiT));
    const ambient = mul(mul(mul(hemiIrrad, INV_PI), oneMinusMetal), albedo);

    // Indirect specular — Fresnel-weighted hemisphere approximation (no env map)
    const oneMinusRough = sub(float(1), rough);
    const maxSmooth = max(vec3(oneMinusRough, oneMinusRough, oneMinusRough), F0);
    const envF = add(F0, mul(sub(maxSmooth, F0), pow(sub(float(1), NdotV), float(5))));
    const envColor = mix(uHemiGround, uHemiSky, hemiT);
    const indirectSpec = mul(envF, envColor);

    // Rim (Fresnel-style edge glow)
    const rim = mul(mul(uRimStr, pow(sub(1, NdotV), uRimPow)), uRimCol);

    // Output HDR — let ACES tone mapping handle the highlight compression
    const lit = add(add(add(add(diffuse, spec), ambient), indirectSpec), rim);
    return vec4(lit, alpha);
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
    uRimCol, uAlphaCutoff, uEdgeSmooth, uScale,
    uRoughness, uMetalness,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────
export async function run() {
  const info = document.getElementById("info");
  info.textContent = "Initialising WebGPU…";

  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20252f);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
  camera.position.set(0, 3, 8);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  // Lights (shared by original mesh — impostor has its own TSL lighting)
  const dirLight = new THREE.DirectionalLight(0xffeedd, 2.0);
  dirLight.position.set(5, 10, 5);
  scene.add(dirLight);
  scene.add(new THREE.HemisphereLight(0x6688cc, 0x443322, 0.4));
  scene.add(new THREE.AmbientLight(0x8899aa, 0.25));

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x3a4a3a, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // ── Source geometry — TorusKnot for testing, swap to pine2.glb later ──
  const sourceGeo = new THREE.TorusKnotGeometry(1, 0.35, 256, 64);
  const sourceMat = new THREE.MeshStandardMaterial({ color: 0x7fd0ff, roughness: 0.35, metalness: 0.15 });

  sourceGeo.computeBoundingSphere();
  const sphereCenter = sourceGeo.boundingSphere.center;
  const sphereRadius = sourceGeo.boundingSphere.radius;

  // Original mesh (left side)
  const original = new THREE.Mesh(sourceGeo, sourceMat);
  original.position.set(-3, sphereRadius - sphereCenter.y, 0);
  scene.add(original);

  // ── Bake ──
  info.textContent = "Baking atlas…";
  const { colorTex, normalTex, radius } = await bakeAtlases(renderer, sourceGeo, sourceMat);

  // ── Impostor (right side) ──
  const imp = createImpostorMaterial(colorTex, normalTex, radius);
  const impostorGeo = new THREE.PlaneGeometry(1, 1);
  const impostor = new THREE.Mesh(impostorGeo, imp.mat);
  const impostorY = original.position.y + sphereCenter.y;
  impostor.position.set(3, impostorY, 0);
  impostor.scale.setScalar(2 * radius);
  impostor.frustumCulled = false;
  imp.uCenter.value.copy(impostor.position);
  scene.add(impostor);

  // Debug atlas preview (small plane behind the models)
  const debugAtlas = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 4),
    new THREE.MeshBasicMaterial({ map: colorTex, side: THREE.DoubleSide }),
  );
  debugAtlas.position.set(0, 4.5, -5);
  scene.add(debugAtlas);

  // ── Compile + info ──
  info.textContent = "Compiling shaders…";
  await renderer.compileAsync(scene, camera);
  info.textContent = "WebGPU ✓ — Left: original · Right: impostor · Back: atlas debug — Orbit to compare";

  // ── GUI ──
  const P = {
    sunAzimuth: 225, sunElevation: 56, sunIntensity: 2.0,
    roughness: 0.35, metalness: 0.15,
    normalStr: 1.0, rimStr: 0.14, rimPow: 3,
    alphaCutoff: 0.15, edgeSmooth: 1.5, exposure: 1.0,
  };

  function syncParams() {
    const az = P.sunAzimuth * Math.PI / 180;
    const el = P.sunElevation * Math.PI / 180;
    const d = new THREE.Vector3(
      Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az),
    ).normalize();
    dirLight.position.copy(d).multiplyScalar(20);
    dirLight.intensity = P.sunIntensity;
    imp.uSunDir.value.copy(d);
    imp.uSunColor.value.set(1.0 * P.sunIntensity, 0.854 * P.sunIntensity, 0.723 * P.sunIntensity);
    imp.uRoughness.value = P.roughness;
    imp.uMetalness.value = P.metalness;
    imp.uNormStr.value = P.normalStr;
    imp.uRimStr.value = P.rimStr;
    imp.uRimPow.value = P.rimPow;
    imp.uAlphaCutoff.value = P.alphaCutoff;
    imp.uEdgeSmooth.value = P.edgeSmooth;
    renderer.toneMappingExposure = P.exposure;
    sourceMat.roughness = P.roughness;
    sourceMat.metalness = P.metalness;
  }
  syncParams();

  const gui = new GUI({ title: "Impostor", width: 220 });
  gui.domElement.style.cssText = "position:fixed;top:8px;right:8px;z-index:10;";
  const fSun = gui.addFolder("Sun");
  fSun.add(P, "sunAzimuth", 0, 360, 1).name("Azimuth").onChange(syncParams);
  fSun.add(P, "sunElevation", 5, 90, 0.5).name("Elevation").onChange(syncParams);
  fSun.add(P, "sunIntensity", 0.2, 5, 0.1).name("Intensity").onChange(syncParams);
  fSun.add(P, "exposure", 0.2, 3, 0.05).name("Exposure").onChange(syncParams);
  const fMat = gui.addFolder("Material");
  fMat.add(P, "roughness", 0.05, 1, 0.01).name("Roughness").onChange(syncParams);
  fMat.add(P, "metalness", 0, 1, 0.01).name("Metalness").onChange(syncParams);
  fMat.add(P, "normalStr", 0, 1, 0.02).name("Normal strength").onChange(syncParams);
  const fEdge = gui.addFolder("Edge / Rim");
  fEdge.add(P, "rimStr", 0, 0.5, 0.01).name("Rim strength").onChange(syncParams);
  fEdge.add(P, "rimPow", 1, 8, 0.5).name("Rim power").onChange(syncParams);
  fEdge.add(P, "alphaCutoff", 0.01, 0.5, 0.01).name("Alpha cutoff").onChange(syncParams);
  fEdge.add(P, "edgeSmooth", 0, 4, 0.1).name("Edge AA").onChange(syncParams);

  // ── Resize ──
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ── Render loop ──
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}
