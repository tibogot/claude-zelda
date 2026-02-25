/**
 * Octahedral Impostor LOD Forest — Three.js WebGPU / TSL
 *
 * Near trees  (< lodDistance): real GLB InstancedMesh
 * Far trees  (>= lodDistance): baked atlas impostor InstancedMesh
 *
 *   const forest = await createOctahedralImpostorForest({ ... });
 *   scene.add(forest.group);
 *   // in animation loop:
 *   forest.update(camera);
 */

import * as THREE from "three";
import {
  Fn, uniform, float, vec2, vec3, vec4,
  positionLocal, cameraPosition,
  instancedArray, instanceIndex,
  varying, texture, mix, clamp, floor, fract,
  min, max, dot, cross, normalize, sign, abs,
  add, sub, mul, div, negate,
} from "three/tsl";
import { GLTFLoader }      from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader }     from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────────
const _draco = new DRACOLoader();
_draco.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.6/");
const _gltf = new GLTFLoader();
_gltf.setDRACOLoader(_draco);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function hemiOctaGridToDir(gx, gy, out) {
  out.set(gx - gy, 0, -1 + gx + gy);
  out.y = 1 - Math.abs(out.x) - Math.abs(out.z);
  return out.normalize();
}

function computeBoundingSphere(obj, out, force = false) {
  out.makeEmpty();
  const s = new THREE.Sphere();
  function walk(o) {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      if (force || !g.boundingSphere) g.computeBoundingSphere();
      s.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      out.union(s);
    }
    for (const c of o.children) walk(c);
  }
  walk(obj);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Atlas baking  (WebGL2 offscreen — with diffuse lighting for depth cues)
// ─────────────────────────────────────────────────────────────────────────────
const ATLAS_VERT = /* glsl */`#version 300 es
in vec3 position; in vec2 uv; in vec3 normal;
uniform mat4 modelViewMatrix, projectionMatrix, modelMatrix;
out vec2 vUv;
out vec3 vWorldNormal;
void main() {
  vUv = uv;
  // world-space normal (model matrix is orthogonal — no need for inverse transpose)
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATLAS_FRAG = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D map;
uniform float alphaTest;
uniform vec3 uSunDir;    // normalised sun direction in world space
uniform vec3 uSunColor;
uniform vec3 uAmbColor;
uniform vec3 uMatColor;  // material diffuse color (for meshes with no texture)
in vec2 vUv;
in vec3 vWorldNormal;
out vec4 outColor;
void main() {
  vec4 c = texture(map, vUv);
  c.rgb *= uMatColor;   // tint by material color
  if (c.a < alphaTest) discard;
  vec3 n = normalize(vWorldNormal);
  float wrap = dot(n, uSunDir) * 0.5 + 0.5;  // wrap-around lighting for foliage
  vec3 light = uAmbColor + uSunColor * wrap;
  outColor = vec4(c.rgb * light, c.a);
}`;

// Sun direction used when baking — matches the scene sun if possible
const BAKE_SUN_DIR   = new THREE.Vector3(0.5, 1.0, 0.3).normalize();
const BAKE_SUN_COLOR = new THREE.Vector3(0.85, 0.78, 0.60);  // warm gold
const BAKE_AMB_COLOR = new THREE.Vector3(0.35, 0.40, 0.50);  // cool blue-grey fill

let _whiteTex = null;
function whiteTexture(gl) {
  if (_whiteTex) return _whiteTex;
  _whiteTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, _whiteTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([210,210,210,255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return _whiteTex;
}

function buildProgram(gl, vs, fs) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("[atlas shader] " + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error("[atlas program] " + gl.getProgramInfoLog(p));
  return p;
}

function drawMesh(gl, geo, posLoc, uvLoc, normLoc) {
  const pa  = geo.getAttribute("position");
  const ua  = geo.getAttribute("uv");
  const na  = geo.getAttribute("normal");
  const ix  = geo.index;
  if (!pa) return;

  const buf = (arr, loc, size) => {
    if (!arr || loc < 0) { if (loc >= 0) { gl.disableVertexAttribArray(loc); gl.vertexAttrib3f(loc,0,1,0); } return null; }
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, arr.array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return b;
  };

  const b0 = buf(pa, posLoc, pa.itemSize);
  const b1 = ua  ? buf(ua,  uvLoc,   ua.itemSize)   : null;
  const b2 = na  ? buf(na,  normLoc, na.itemSize)   : null;

  if (!ua) { gl.disableVertexAttribArray(uvLoc);   gl.vertexAttrib2f(uvLoc, 0, 0); }
  if (!na) { gl.disableVertexAttribArray(normLoc); gl.vertexAttrib3f(normLoc, 0, 1, 0); }

  if (ix) {
    const bi = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix.array, gl.STATIC_DRAW);
    gl.drawElements(gl.TRIANGLES, ix.count, ix.array instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
    gl.deleteBuffer(bi);
  } else {
    gl.drawArrays(gl.TRIANGLES, 0, pa.count);
  }
  if (b0) gl.deleteBuffer(b0);
  if (b1) gl.deleteBuffer(b1);
  if (b2) gl.deleteBuffer(b2);
}

function uploadTex(gl, img) {
  if (!img) return null;
  const w = img.width || img.videoWidth, h = img.height || img.videoHeight;
  if (!w || !h) return null;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  if (img.data)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, img.data);
  else
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

function bakeAtlas(modelScene, { textureSize = 2048, spritesPerSide = 12, alphaTest = 0.4 } = {}) {
  const sphere = computeBoundingSphere(modelScene, new THREE.Sphere(), true);
  const N      = spritesPerSide;
  const Nm1    = Math.max(1, N - 1);
  const ss     = textureSize / N;

  const meshes = [];
  modelScene.traverse(o => { if (o.isMesh && o.geometry) meshes.push(o); });
  if (!meshes.length) throw new Error("[OctahedralImpostor] No meshes to bake");

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = textureSize;
  const gl = canvas.getContext("webgl2", { alpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("[OctahedralImpostor] WebGL2 unavailable");

  const prog = buildProgram(gl, ATLAS_VERT, ATLAS_FRAG);
  gl.useProgram(prog);

  const posLoc  = gl.getAttribLocation(prog, "position");
  const uvLoc   = gl.getAttribLocation(prog, "uv");
  const normLoc = gl.getAttribLocation(prog, "normal");
  const uMV     = gl.getUniformLocation(prog, "modelViewMatrix");
  const uProj   = gl.getUniformLocation(prog, "projectionMatrix");
  const uMod    = gl.getUniformLocation(prog, "modelMatrix");
  const uMap    = gl.getUniformLocation(prog, "map");
  const uAlpha  = gl.getUniformLocation(prog, "alphaTest");
  const uSunDir  = gl.getUniformLocation(prog, "uSunDir");
  const uSunCol  = gl.getUniformLocation(prog, "uSunColor");
  const uAmbCol  = gl.getUniformLocation(prog, "uAmbColor");
  const uMatCol  = gl.getUniformLocation(prog, "uMatColor");

  gl.uniform3f(uSunDir,  BAKE_SUN_DIR.x,   BAKE_SUN_DIR.y,   BAKE_SUN_DIR.z);
  gl.uniform3f(uSunCol,  BAKE_SUN_COLOR.x, BAKE_SUN_COLOR.y, BAKE_SUN_COLOR.z);
  gl.uniform3f(uAmbCol,  BAKE_AMB_COLOR.x, BAKE_AMB_COLOR.y, BAKE_AMB_COLOR.z);

  // Use tight orthographic frustum so tree fills the cell (better texel usage)
  const half = sphere.radius * 1.0;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 0.001, sphere.radius * 4);

  const fbo    = gl.createFramebuffer();
  const colTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureSize, textureSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const depthRB = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, textureSize, textureSize);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(   gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,   colTex,  0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,  gl.RENDERBUFFER, depthRB);

  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const camPos  = new THREE.Vector3();
  const viewMat = new THREE.Matrix4();

  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      hemiOctaGridToDir(col / Nm1, row / Nm1, camPos);
      camPos.multiplyScalar(sphere.radius * 2).add(sphere.center);
      cam.position.copy(camPos);
      cam.lookAt(sphere.center);
      cam.updateMatrixWorld(true);
      viewMat.copy(cam.matrixWorldInverse);

      const x0 = col * ss, y0 = row * ss;
      gl.viewport(x0, y0, ss, ss);
      gl.scissor( x0, y0, ss, ss);
      gl.enable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      for (const mesh of meshes) {
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!mat) continue;
        const mv = viewMat.clone().multiply(mesh.matrixWorld);
        gl.uniformMatrix4fv(uMV,   false, mv.elements);
        gl.uniformMatrix4fv(uProj, false, cam.projectionMatrix.elements);
        gl.uniformMatrix4fv(uMod,  false, mesh.matrixWorld.elements);
        gl.uniform1f(uAlpha, mat.alphaTest > 0 ? mat.alphaTest : alphaTest);

        // Material base color (sRGB → linear for correct baking)
        const mc = mat.color ?? { r: 1, g: 1, b: 1 };
        gl.uniform3f(uMatCol, mc.r, mc.g, mc.b);

        let t = null, own = false;
        if (mat.map?.image) { t = uploadTex(gl, mat.map.image); own = !!t; }
        if (!t) t = whiteTexture(gl);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.uniform1i(uMap, 0);
        drawMesh(gl, mesh.geometry, posLoc, uvLoc, normLoc);
        if (own) gl.deleteTexture(t);
      }
    }
  }
  gl.disable(gl.SCISSOR_TEST);

  // readPixels: WebGL row-0 = bottom; DataTexture row-0 = bottom → no flipY needed
  const pixels = new Uint8Array(textureSize * textureSize * 4);
  gl.readPixels(0, 0, textureSize, textureSize, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  gl.deleteTexture(colTex);
  gl.deleteRenderbuffer(depthRB);
  gl.deleteFramebuffer(fbo);
  gl.deleteProgram(prog);

  const tex = new THREE.DataTexture(pixels, textureSize, textureSize, THREE.RGBAFormat);
  tex.needsUpdate    = true;
  tex.minFilter      = THREE.LinearMipmapLinearFilter;
  tex.magFilter      = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy     = 4;
  // No flipY — DataTexture default is false, which matches readPixels orientation
  return tex;
}

// ─────────────────────────────────────────────────────────────────────────────
// TSL Impostor Material
//
// KEY POINTS:
//   • positionNode  — returns billboard vertex offset in LOCAL space.
//     The renderer then applies instanceMatrix(T*S) + view + projection.
//     This is the correct hook for custom vertex positions on InstancedMesh.
//   • Per-instance center comes from an instancedArray storage buffer indexed
//     by instanceIndex — the proven pattern for WebGPU custom vertex shaders.
//   • Full ray-plane intersection for sprite UV (not flat quad UV!) gives the
//     correct parallax that makes octahedral impostors look 3D.
//   • varyings pass sprite indices + UVs from vertex to fragment stage.
// ─────────────────────────────────────────────────────────────────────────────
function createImpostorMaterial(atlasTex, impostorScale, centersStorage, opts = {}) {
  const spritesPerSide = opts.spritesPerSide ?? 12;
  const alphaClamp     = opts.alphaClamp     ?? 0.4;

  const uSPS   = uniform(spritesPerSide);
  const uScale = uniform(impostorScale);

  // Varyings: sprite weights, indices, and per-vertex ray-plane UVs
  const vWeight = varying(vec4(0,0,0,0), "vWeight");
  const vS1     = varying(vec2(0,0),     "vS1");
  const vS2     = varying(vec2(0,0),     "vS2");
  const vS3     = varying(vec2(0,0),     "vS3");
  const vUV1    = varying(vec2(0,0),     "vUV1");
  const vUV2    = varying(vec2(0,0),     "vUV2");
  const vUV3    = varying(vec2(0,0),     "vUV3");

  // Per-instance center (world-space sphere centre) from storage buffer
  // Read xyz from vec4 (vec3 in WebGPU storage buffers needs 16-byte/4-float alignment)
  const centerNode = centersStorage.element(instanceIndex).xyz;

  // ── Encoding / decoding (hemi-octahedron) ──────────────────────────────────
  const encode = Fn(([dir]) => {
    // Project unit direction onto octahedron, then remap to hemi [0,1]^2
    const s   = vec3(sign(dir.x), sign(dir.y), sign(dir.z));
    const d   = dot(dir, s);                    // L1 norm = |x|+|y|+|z|
    const oct = vec3(div(dir.x, d), div(dir.y, d), div(dir.z, d));
    return mul(vec2(add(1, add(oct.x, oct.z)), add(1, sub(oct.z, oct.x))), 0.5);
  });

  const decode = Fn(([gi, nm1]) => {
    const uv = vec2(div(gi.x, nm1.x), div(gi.y, nm1.y));
    const px = sub(uv.x, uv.y);
    const pz = sub(add(uv.x, uv.y), 1);
    const py = sub(sub(1, abs(px)), abs(pz));
    return normalize(vec3(px, py, pz));
  });

  // ── Plane basis — degenerate-safe (mirrors TSX computePlaneBasis) ───────────
  const planeTangent = Fn(([n]) => {
    // When n ≈ (0,1,0) the cross is degenerate → fall back to (-1,0,0) as up
    const up = mix(vec3(0,1,0), vec3(-1,0,0),
                   max(float(0), sign(sub(n.y, float(0.999)))));
    return normalize(cross(up, n));
  });
  const planeBitangent = Fn(([n, t]) => cross(n, t));

  // Billboard vertex offset in local coords (positionLocal.xy ∈ ±0.5)
  const projectVert = Fn(([n]) => {
    const t = planeTangent(n);
    const b = planeBitangent(n, t);
    return add(mul(positionLocal.x, t), mul(positionLocal.y, b));
  });

  // Ray–plane intersection → sprite UV within a frame
  // Plane: passes through origin, normal n; ray: from camL toward vd
  const planeUV = Fn(([n, t, b, camL, vd]) => {
    const denom = dot(vd, n);
    const tt    = mul(dot(negate(camL), n), div(1, denom));
    const hit   = add(camL, mul(vd, tt));
    return add(vec2(dot(t, hit), dot(b, hit)), 0.5);
  });

  // ── Position node — billboard vertex (engine applies T*S instance matrix) ──
  const positionNodeFn = Fn(() => {
    const nm1 = vec2(sub(uSPS, float(1)), sub(uSPS, float(1)));

    // Per-instance sphere center from storage buffer
    const center = centerNode;

    // Camera position in LOCAL space (sphere-radius-normalized)
    // camLocal ∈ roughly [-6, 6] range when tree is at ~100m distance
    const camLocal = mul(sub(cameraPosition, center), div(float(1), uScale));
    const camDir   = normalize(camLocal);

    // Billboard vertex in local space (±0.5 × tangent/bitangent)
    const bv = projectVert(camDir);

    // View direction from billboard vertex toward camera (for parallax UV)
    const viewDir = normalize(sub(bv, camLocal));

    // Octahedral grid lookup and trilinear blend weights
    const grid = mul(encode(camDir), nm1);
    const gf   = min(floor(grid), nm1);
    const frac = fract(grid);

    // w.w MUST be binary: use sign() clamped to [0,1] = same as ceil(x-y) for frac ∈ [0,1)
    const w = vec4(
      min(sub(1, frac.x), sub(1, frac.y)),
      abs(sub(frac.x, frac.y)),
      min(frac.x, frac.y),
      max(float(0), sign(sub(frac.x, frac.y)))
    );
    vWeight.assign(w);

    const s1 = gf;
    const s2 = min(add(s1, mix(vec2(0,1), vec2(1,0), w.w)), nm1);
    const s3 = min(add(s1, vec2(1,1)), nm1);
    vS1.assign(s1); vS2.assign(s2); vS3.assign(s3);

    // Decode sprite normals and compute per-vertex ray-plane UV for each sprite
    const n1 = decode(s1, nm1); const t1 = planeTangent(n1); const b1 = planeBitangent(n1, t1);
    const n2 = decode(s2, nm1); const t2 = planeTangent(n2); const b2 = planeBitangent(n2, t2);
    const n3 = decode(s3, nm1); const t3 = planeTangent(n3); const b3 = planeBitangent(n3, t3);

    vUV1.assign(planeUV(n1, t1, b1, camLocal, viewDir));
    vUV2.assign(planeUV(n2, t2, b2, camLocal, viewDir));
    vUV3.assign(planeUV(n3, t3, b3, camLocal, viewDir));

    // Return billboard vertex offset in local space.
    // InstancedMesh applies T(center)*S(scale) → correct world position.
    return bv;
  });

  // ── Color node — sample atlas with interpolated ray-plane UVs ──────────────
  const getUV = Fn(([uvf, frame, fs]) =>
    clamp(mul(fs, add(frame, clamp(uvf, 0, 1))), 0, 1)
  );

  const colorNodeFn = Fn(() => {
    const fs = div(float(1), uSPS);

    const c1 = texture(atlasTex, getUV(vUV1, vS1, fs));
    const c2 = texture(atlasTex, getUV(vUV2, vS2, fs));
    const c3 = texture(atlasTex, getUV(vUV3, vS3, fs));

    // Weighted blend of 3 nearest sprites (binary add chain — add() is binary in TSL)
    // Atlas stores straight (non-premultiplied) RGBA — no un-premultiply needed
    const blended = add(add(mul(c1, vWeight.x), mul(c2, vWeight.y)), mul(c3, vWeight.z));
    return blended;   // alphaTest will discard below threshold
  });

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  mat.positionNode = positionNodeFn();  // positionNode = local-space pos, engine applies instanceMatrix
  mat.colorNode    = colorNodeFn();
  mat.transparent  = false;            // alpha-tested opaque → depthWrite stays true
  mat.alphaTest    = alphaClamp;
  mat.depthWrite   = true;
  return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export async function createOctahedralImpostorForest(opts = {}) {
  const {
    modelPath,
    treeCount        = 300,
    treeScale        = 1,
    lodDistance      = 80,
    radius           = 250,
    minRadius        = 30,
    centerPosition   = [0, 0, 0],
    getTerrainHeight = null,
    impostorSettings = {},
  } = opts;

  const iOpts = {
    spritesPerSide: impostorSettings.spritesPerSide ?? 12,
    textureSize:    impostorSettings.textureSize    ?? 2048,
    alphaClamp:     impostorSettings.alphaClamp     ?? 0.1,   // runtime discard — low to keep soft foliage
    alphaTest:      impostorSettings.alphaTest      ?? 0.05,  // bake discard — very low to capture full foliage
  };

  // ── Load model ──────────────────────────────────────────────────────────────
  const gltf = await new Promise((res, rej) => _gltf.load(modelPath, res, undefined, rej));
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // ── Bounding sphere (unscaled) ──────────────────────────────────────────────
  const sphere          = computeBoundingSphere(root, new THREE.Sphere(), true);
  const impostorScale   = sphere.radius * 2 * treeScale;
  const sphereCenter    = sphere.center.clone().multiplyScalar(treeScale);

  // ── Bake atlas ─────────────────────────────────────────────────────────────
  const atlas = bakeAtlas(root, {
    textureSize:    iOpts.textureSize,
    spritesPerSide: iOpts.spritesPerSide,
    alphaTest:      iOpts.alphaTest,
  });

  // ── Near-LOD geometry ──────────────────────────────────────────────────────
  const leafGeos = [], leafMats = [], trunkGeos = [], trunkMats = [];
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const m    = o.material;
    const name = (o.name + " " + (m?.name ?? "")).toLowerCase();
    const isLeaf = m?.transparent
      || /leaf|leave|foliage|canopy|frond|branch/i.test(name)
      || (m?.map && (m?.side === THREE.DoubleSide || m?.alphaTest > 0));
    const nodeMat = new THREE.MeshStandardNodeMaterial({
      color:     m?.color?.getHex?.() ?? 0x448833,
      roughness: m?.roughness ?? 0.8,
      metalness: m?.metalness ?? 0,
      map:       m?.map ?? null,
      transparent: false,
      alphaTest: isLeaf ? iOpts.alphaTest : 0,
      side:      isLeaf ? THREE.DoubleSide : (m?.side ?? THREE.FrontSide),
      depthWrite: true,
    });
    if (isLeaf) { leafGeos.push(g); leafMats.push(nodeMat); }
    else        { trunkGeos.push(g); trunkMats.push(nodeMat); }
  });

  // ── Scatter positions ───────────────────────────────────────────────────────
  const cx0 = centerPosition[0], cz0 = centerPosition[2];
  const posX = new Float32Array(treeCount);
  const posY = new Float32Array(treeCount);
  const posZ = new Float32Array(treeCount);
  const allNearMats     = new Float32Array(treeCount * 16);
  const allImpostorMats = new Float32Array(treeCount * 16);  // T(center)*S(impostorScale)
  const allCenters      = new Float32Array(treeCount * 3);

  const _m  = new THREE.Matrix4();
  const _sc = new THREE.Vector3(treeScale, treeScale, treeScale);

  for (let i = 0; i < treeCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist  = minRadius + Math.random() * (radius - minRadius);
    const x     = cx0 + Math.cos(angle) * dist;
    const z     = cz0 + Math.sin(angle) * dist;
    const y     = getTerrainHeight ? getTerrainHeight(x, z) : centerPosition[1];

    posX[i] = x; posY[i] = y; posZ[i] = z;

    // Near: TRS with treeScale
    _m.makeRotationY(Math.random() * Math.PI * 2).scale(_sc).setPosition(x, y, z);
    _m.toArray(allNearMats, i * 16);

    // Impostor: T(sphereCenter) * S(impostorScale) — shader reads translation = center
    const wcx = x + sphereCenter.x;
    const wcy = y + sphereCenter.y;
    const wcz = z + sphereCenter.z;
    allCenters[i * 3]     = wcx;
    allCenters[i * 3 + 1] = wcy;
    allCenters[i * 3 + 2] = wcz;
    _m.identity().makeScale(impostorScale, impostorScale, impostorScale).setPosition(wcx, wcy, wcz);
    _m.toArray(allImpostorMats, i * 16);
  }

  // ── Near InstancedMeshes ────────────────────────────────────────────────────
  const group      = new THREE.Group();
  const nearMeshes = [];

  const makeNearMesh = (geos, mats) => {
    if (!geos.length) return null;
    const geo = mergeGeometries(geos, true);
    geo.computeBoundingSphere();
    const im = new THREE.InstancedMesh(geo, mats.length === 1 ? mats[0] : mats, treeCount);
    im.castShadow    = true;
    im.frustumCulled = false;
    for (let i = 0; i < treeCount; i++) { _m.fromArray(allNearMats, i * 16); im.setMatrixAt(i, _m); }
    im.instanceMatrix.needsUpdate = true;
    im.count = treeCount;
    group.add(im);
    nearMeshes.push(im);
    return im;
  };
  makeNearMesh(trunkGeos, trunkMats);
  makeNearMesh(leafGeos,  leafMats);

  // ── Impostor InstancedMesh ─────────────────────────────────────────────────
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  // Storage buffer for per-instance center positions (compacted each frame)
  // IMPORTANT: WebGPU storage buffers require 16-byte (vec4) alignment for vec3 data.
  // Using vec4 with 4th component = 0 padding to avoid per-instance read misalignment.
  const compactCenters  = new Float32Array(treeCount * 4);  // 4 floats per entry
  const centersStorage  = instancedArray(compactCenters, "vec4").setName("impostorCenters");

  const impostorMat  = createImpostorMaterial(atlas, impostorScale, centersStorage, iOpts);
  const impostorMesh = new THREE.InstancedMesh(planeGeo, impostorMat, treeCount);
  impostorMesh.castShadow    = false;
  impostorMesh.frustumCulled = false;
  impostorMesh.count         = 0;
  group.add(impostorMesh);

  // ── LOD update ─────────────────────────────────────────────────────────────
  const _compactNear = new Float32Array(treeCount * 16);
  const lodDistSq    = lodDistance * lodDistance;

  function update(camera) {
    const cpx = camera.position.x;
    const cpy = camera.position.y;
    const cpz = camera.position.z;

    let nearCount = 0, farCount = 0;

    for (let i = 0; i < treeCount; i++) {
      const dx = posX[i] - cpx, dy = posY[i] - cpy, dz = posZ[i] - cpz;

      if (dx*dx + dy*dy + dz*dz < lodDistSq) {
        // Near: real model
        for (let j = 0; j < 16; j++) _compactNear[nearCount * 16 + j] = allNearMats[i * 16 + j];
        nearCount++;
      } else {
        // Far: impostor — also write center to compact buffer (stride 4 for WebGPU vec4 alignment)
        _m.fromArray(allImpostorMats, i * 16);
        impostorMesh.setMatrixAt(farCount, _m);
        compactCenters[farCount * 4]     = allCenters[i * 3];
        compactCenters[farCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters[farCount * 4 + 2] = allCenters[i * 3 + 2];
        // compactCenters[farCount * 4 + 3] = 0;  // padding — Float32Array defaults to 0
        farCount++;
      }
    }

    // Near meshes
    for (const nm of nearMeshes) {
      nm.instanceMatrix.array.set(_compactNear.subarray(0, nearCount * 16));
      nm.count = nearCount;
      nm.instanceMatrix.needsUpdate = true;
    }

    // Far impostors — trigger re-upload of center buffer
    impostorMesh.count = farCount;
    impostorMesh.instanceMatrix.needsUpdate = true;
    centersStorage.value.needsUpdate = true;
  }

  function dispose() {
    for (const nm of nearMeshes) { nm.geometry.dispose(); group.remove(nm); }
    planeGeo.dispose();
    impostorMat.dispose();
    atlas.dispose();
    group.remove(impostorMesh);
  }

  return { group, update, dispose, impostorMesh };
}
