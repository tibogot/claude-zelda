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
  positionLocal, positionWorld, cameraPosition,
  instancedArray, instanceIndex,
  varying, texture, mix, clamp, saturate, floor, fract,
  min, max, dot, cross, normalize, sign, abs, length,
  add, sub, mul, div, negate, select,
  screenCoordinate, uv,
} from "three/tsl";
import { GLTFLoader }      from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader }     from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// TSL helpers
// ─────────────────────────────────────────────────────────────────────────────

// Per-frame golden-ratio offset for temporal dithering (updated by forest.update())
const uFrameOffset = uniform(float(0));

// Interleaved Gradient Noise — screen-stable dither pattern with temporal jitter
// Returns float in [0, 1). Input: screenCoordinate.xy (raw pixel position).
const IGN = Fn(([coord]) =>
  fract(mul(float(52.9829189), fract(
    add(add(mul(float(0.06711056), coord.x), mul(float(0.00583715), coord.y)), uFrameOffset)
  )))
);

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
out vec3 vWorldPos;
void main() {
  vUv = uv;
  // world-space normal (model matrix is orthogonal — no need for inverse transpose)
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Bakes albedo * AO only — directional lighting applied at runtime via normal atlas
const ATLAS_FRAG = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D map;
uniform float alphaTest;
uniform vec3 uMatColor;    // material diffuse color
uniform vec3 uSphereCenter;
uniform float uSphereRadius;
in vec2 vUv;
in vec3 vWorldNormal;
in vec3 vWorldPos;
out vec4 outColor;
void main() {
  vec4 c = texture(map, vUv);
  c.rgb *= uMatColor;
  if (c.a < alphaTest) discard;
  // Soft vertical AO: darker at base of tree, full brightness at crown
  float baseY = uSphereCenter.y - uSphereRadius;
  float yNorm = clamp((vWorldPos.y - baseY) / (uSphereRadius * 0.8), 0.0, 1.0);
  float ao = mix(0.6, 1.0, yNorm);
  outColor = vec4(c.rgb * ao, c.a);
}`;

// Normal atlas — stores world-space normals encoded to [0,1] per sprite
const NORMAL_FRAG = /* glsl */`#version 300 es
precision highp float;
uniform sampler2D map; uniform float alphaTest;
in vec2 vUv; in vec3 vWorldNormal;
out vec4 outColor;
void main() {
  if (texture(map, vUv).a < alphaTest) discard;
  outColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
}`;

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
  const N   = spritesPerSide;
  const Nm1 = Math.max(1, N - 1);
  const ss  = textureSize / N;

  const meshes = [];
  modelScene.traverse(o => { if (o.isMesh && o.geometry) meshes.push(o); });
  if (!meshes.length) throw new Error("[OctahedralImpostor] No meshes to bake");

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = textureSize;
  const gl = canvas.getContext("webgl2", { alpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("[OctahedralImpostor] WebGL2 unavailable");

  // ── Albedo program (albedo * AO — no directional light, moved to runtime) ──
  const prog    = buildProgram(gl, ATLAS_VERT, ATLAS_FRAG);
  const posLoc  = gl.getAttribLocation(prog, "position");
  const uvLoc   = gl.getAttribLocation(prog, "uv");
  const normLoc = gl.getAttribLocation(prog, "normal");
  const uMV     = gl.getUniformLocation(prog, "modelViewMatrix");
  const uProj   = gl.getUniformLocation(prog, "projectionMatrix");
  const uMod    = gl.getUniformLocation(prog, "modelMatrix");
  const uMap    = gl.getUniformLocation(prog, "map");
  const uAlpha  = gl.getUniformLocation(prog, "alphaTest");
  const uMatCol = gl.getUniformLocation(prog, "uMatColor");
  const uSphCtr = gl.getUniformLocation(prog, "uSphereCenter");
  const uSphRad = gl.getUniformLocation(prog, "uSphereRadius");

  // ── Normal program (world-space normals → [0,1] RGBA) ──
  const normProg  = buildProgram(gl, ATLAS_VERT, NORMAL_FRAG);
  const nPosLoc   = gl.getAttribLocation(normProg, "position");
  const nUvLoc    = gl.getAttribLocation(normProg, "uv");
  const nNormLoc  = gl.getAttribLocation(normProg, "normal");
  const uNMV      = gl.getUniformLocation(normProg, "modelViewMatrix");
  const uNProj    = gl.getUniformLocation(normProg, "projectionMatrix");
  const uNMod     = gl.getUniformLocation(normProg, "modelMatrix");
  const uNMap     = gl.getUniformLocation(normProg, "map");
  const uNAlpha   = gl.getUniformLocation(normProg, "alphaTest");

  const half = sphere.radius * 1.0;
  const cam  = new THREE.OrthographicCamera(-half, half, half, -half, 0.001, sphere.radius * 4);

  const fbo     = gl.createFramebuffer();
  const depthRB = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, textureSize, textureSize);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const camPos  = new THREE.Vector3();
  const viewMat = new THREE.Matrix4();

  const makeGLTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureSize, textureSize, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };

  // Shared sprite render loop — called once per pass.
  // setupMesh() returns the GL texture to delete after drawing (or null).
  const renderSprites = (prog, pL, uL, nL, setupMesh) => {
    gl.useProgram(prog);
    gl.clearColor(0, 0, 0, 0);
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        hemiOctaGridToDir(col / Nm1, row / Nm1, camPos);
        camPos.multiplyScalar(sphere.radius * 2).add(sphere.center);
        cam.position.copy(camPos); cam.lookAt(sphere.center);
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
          const ownTex = setupMesh(mesh, mat, mv);
          drawMesh(gl, mesh.geometry, pL, uL, nL);
          if (ownTex) gl.deleteTexture(ownTex);
        }
      }
    }
    gl.disable(gl.SCISSOR_TEST);
  };

  // ── Pass 1: Albedo + AO ───────────────────────────────────────────────────
  const colGLTex = makeGLTex();
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colGLTex, 0);
  gl.useProgram(prog);
  gl.uniform3f(uSphCtr, sphere.center.x, sphere.center.y, sphere.center.z);
  gl.uniform1f(uSphRad, sphere.radius);

  renderSprites(prog, posLoc, uvLoc, normLoc, (mesh, mat, mv) => {
    gl.uniformMatrix4fv(uMV,   false, mv.elements);
    gl.uniformMatrix4fv(uProj, false, cam.projectionMatrix.elements);
    gl.uniformMatrix4fv(uMod,  false, mesh.matrixWorld.elements);
    gl.uniform1f(uAlpha, mat.alphaTest > 0 ? mat.alphaTest : alphaTest);
    const mc = mat.color ?? { r: 1, g: 1, b: 1 };
    gl.uniform3f(uMatCol, mc.r, mc.g, mc.b);
    let t = null, own = false;
    if (mat.map?.image) { t = uploadTex(gl, mat.map.image); own = !!t; }
    if (!t) t = whiteTexture(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(uMap, 0);
    return own ? t : null;  // returned texture is deleted after drawMesh
  });
  const colorPixels = new Uint8Array(textureSize * textureSize * 4);
  gl.readPixels(0, 0, textureSize, textureSize, gl.RGBA, gl.UNSIGNED_BYTE, colorPixels);

  // ── Pass 2: World-space normals ───────────────────────────────────────────
  const normGLTex = makeGLTex();
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, normGLTex, 0);

  renderSprites(normProg, nPosLoc, nUvLoc, nNormLoc, (mesh, mat, mv) => {
    gl.uniformMatrix4fv(uNMV,   false, mv.elements);
    gl.uniformMatrix4fv(uNProj, false, cam.projectionMatrix.elements);
    gl.uniformMatrix4fv(uNMod,  false, mesh.matrixWorld.elements);
    gl.uniform1f(uNAlpha, mat.alphaTest > 0 ? mat.alphaTest : alphaTest);
    let t = null, own = false;
    if (mat.map?.image) { t = uploadTex(gl, mat.map.image); own = !!t; }
    if (!t) t = whiteTexture(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(uNMap, 0);
    return own ? t : null;  // returned texture is deleted after drawMesh
  });
  const normalPixels = new Uint8Array(textureSize * textureSize * 4);
  gl.readPixels(0, 0, textureSize, textureSize, gl.RGBA, gl.UNSIGNED_BYTE, normalPixels);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  gl.deleteTexture(colGLTex);
  gl.deleteTexture(normGLTex);
  gl.deleteRenderbuffer(depthRB);
  gl.deleteFramebuffer(fbo);
  gl.deleteProgram(prog);
  gl.deleteProgram(normProg);

  const makeTex = (pixels) => {
    const t = new THREE.DataTexture(pixels, textureSize, textureSize, THREE.RGBAFormat);
    t.needsUpdate    = true;
    t.minFilter      = THREE.LinearMipmapLinearFilter;
    t.magFilter      = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy     = 4;
    return t;
  };
  // No flipY — DataTexture row-0 = bottom matches readPixels row-0 = bottom
  return { colorTex: makeTex(colorPixels), normalTex: makeTex(normalPixels) };
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
function createImpostorMaterial(atlasTex, normalTex, impostorScale, centersStorage, opts = {}) {
  const spritesPerSide = opts.spritesPerSide ?? 12;
  const alphaClamp     = opts.alphaClamp     ?? 0.4;
  const lodDistance    = opts.lodDistance    ?? 80;
  const fadeRange      = opts.fadeRange      ?? 8;
  const mega           = opts.mega           ?? false;

  const uSPS       = uniform(spritesPerSide);
  const uScale     = uniform(impostorScale);
  const uLodDist   = opts.lodDistUniform   ?? uniform(float(lodDistance));
  const uFadeRange = opts.fadeRangeUniform ?? uniform(float(fadeRange));
  // Dynamic lighting uniforms (shared via opts.sunDir etc. from forest scope)
  const uSunDir   = opts.sunDir   ?? uniform(new THREE.Vector3( 0.5,  1.0,  0.3).normalize());
  const uSunColor = opts.sunColor ?? uniform(new THREE.Vector3(0.85, 0.78, 0.60));
  const uAmbColor = opts.ambColor ?? uniform(new THREE.Vector3(0.35, 0.40, 0.50));

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

    // ── Albedo blend (mega: 1 sprite; standard: 3-sprite trilinear) ──
    const c1 = texture(atlasTex, getUV(vUV1, vS1, fs));
    const blended = mega
      ? c1
      : add(add(mul(c1, vWeight.x), mul(texture(atlasTex, getUV(vUV2, vS2, fs)), vWeight.y)), mul(texture(atlasTex, getUV(vUV3, vS3, fs)), vWeight.z));

    // ── Normal blend → dynamic lighting ──
    const n1 = texture(normalTex, getUV(vUV1, vS1, fs)).xyz;
    const normEnc = mega
      ? n1
      : add(add(mul(n1, vWeight.x), mul(texture(normalTex, getUV(vUV2, vS2, fs)).xyz, vWeight.y)), mul(texture(normalTex, getUV(vUV3, vS3, fs)).xyz, vWeight.z));
    const worldNorm = normalize(sub(mul(normEnc, float(2.0)), float(1.0)));
    // Wrap-around lighting (foliage-friendly: softer than hard dot)
    const wrap  = add(mul(dot(worldNorm, uSunDir), 0.5), 0.5);
    const light = add(uAmbColor, mul(uSunColor, wrap));

    // ── LOD dither fade-in ──
    const dist   = length(sub(centerNode, cameraPosition));
    const fadeT  = saturate(div(sub(dist, sub(uLodDist, uFadeRange)), uFadeRange));
    const dither = IGN(screenCoordinate.xy);
    const alphaOut = select(dither.greaterThan(fadeT), float(0.0), blended.a);

    return vec4(mul(blended.rgb, light), alphaOut);
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
    fadeRange:      impostorSettings.fadeRange      ?? 8,     // crossfade half-width in world units
    lod2Distance:   impostorSettings.lod2Distance   ?? 150,   // mega-impostor starts here
  };

  // Dynamic lighting uniforms shared by all impostor materials (regular + mega)
  // Initialised to match game defaults; updated via forest.updateSunDir() each frame
  const _uSunDir   = uniform(new THREE.Vector3(-1.0, 0.55, 1.0).normalize());
  const _uSunColor = uniform(new THREE.Vector3(0.85, 0.78, 0.60));
  const _uAmbColor = uniform(new THREE.Vector3(0.35, 0.40, 0.50));

  // LOD distance uniforms — lifted to forest scope so setters can update them at runtime
  let _lodDist   = lodDistance;
  let _lod2Dist  = iOpts.lod2Distance;
  let _fadeRange = iOpts.fadeRange;
  const _uLodDist   = uniform(float(_lodDist));
  const _uFadeRange = uniform(float(_fadeRange));
  const _uLod2Dist  = uniform(float(_lod2Dist));

  // ── Load model ──────────────────────────────────────────────────────────────
  const gltf = await new Promise((res, rej) => _gltf.load(modelPath, res, undefined, rej));
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // ── Bounding sphere (unscaled) ──────────────────────────────────────────────
  const sphere          = computeBoundingSphere(root, new THREE.Sphere(), true);
  const impostorScale   = sphere.radius * 2 * treeScale;
  const sphereCenter    = sphere.center.clone().multiplyScalar(treeScale);

  // ── Bake atlas (albedo+AO pass + world-normal pass) ────────────────────────
  const { colorTex, normalTex } = bakeAtlas(root, {
    textureSize:    iOpts.textureSize,
    spritesPerSide: iOpts.spritesPerSide,
    alphaTest:      iOpts.alphaTest,
  });

  // ── Near-LOD geometry ──────────────────────────────────────────────────────
  // Uniforms for dither fade-out on near LOD0 trees as they approach lodDistance
  const uNearLodDist   = uniform(float(lodDistance));
  const uNearFadeRange = uniform(float(iOpts.fadeRange));

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
      alphaTest: isLeaf ? iOpts.alphaTest : 0.5,  // 0.5 lets dither-discard (alpha=0) work on trunks too
      side:      isLeaf ? THREE.DoubleSide : (m?.side ?? THREE.FrontSide),
      depthWrite: true,
    });

    // LOD dither fade-out: near tree disappears as it approaches lodDistance
    // fadeT: 1=near camera (fully visible), 0=at/past lodDist (fully dithered away)
    const matMap = m?.map ?? null;
    nodeMat.alphaNode = Fn(() => {
      const dist   = length(sub(positionWorld, cameraPosition));
      const fadeT  = saturate(div(sub(add(uNearLodDist, uNearFadeRange), dist), uNearFadeRange));
      const dither = IGN(screenCoordinate.xy);
      // For leaves: preserve texture alpha for leaf shape; for trunk: fully opaque when not dithered
      const baseAlpha = matMap ? texture(matMap, uv()).a : float(1.0);
      return select(dither.greaterThan(fadeT), float(0.0), baseAlpha);
    })();

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

  const _sunOpts = { sunDir: _uSunDir, sunColor: _uSunColor, ambColor: _uAmbColor };
  const impostorMat  = createImpostorMaterial(colorTex, normalTex, impostorScale, centersStorage,
    { ...iOpts, lodDistance, ..._sunOpts, lodDistUniform: _uLodDist, fadeRangeUniform: _uFadeRange });
  const impostorMesh = new THREE.InstancedMesh(planeGeo, impostorMat, treeCount);
  impostorMesh.castShadow    = false;
  impostorMesh.frustumCulled = false;
  impostorMesh.count         = 0;
  group.add(impostorMesh);

  // ── LOD3 Mega-impostor (single-sprite, beyond lod2Distance) ────────────────
  const compactCenters2 = new Float32Array(treeCount * 4);
  const centersStorage2 = instancedArray(compactCenters2, "vec4").setName("megaCenters");
  const megaMat  = createImpostorMaterial(colorTex, normalTex, impostorScale, centersStorage2,
    { ...iOpts, lodDistance: iOpts.lod2Distance, mega: true, ..._sunOpts, lodDistUniform: _uLod2Dist, fadeRangeUniform: _uFadeRange });
  const megaMesh = new THREE.InstancedMesh(planeGeo, megaMat, treeCount);
  megaMesh.castShadow    = false;
  megaMesh.frustumCulled = false;
  megaMesh.count         = 0;
  group.add(megaMesh);

  // ── LOD update ─────────────────────────────────────────────────────────────
  const _compactNear    = new Float32Array(treeCount * 16);
  const _cullSphere     = new THREE.Sphere(new THREE.Vector3(), impostorScale * 0.5);

  // LOD overlap zones — mutable so setters can update them at runtime
  let innerDistSq, outerDistSq, inner2DistSq, outer2DistSq;
  function _recomputeThresholds() {
    innerDistSq  = (_lodDist  - _fadeRange) ** 2;
    outerDistSq  = (_lodDist  + _fadeRange) ** 2;
    inner2DistSq = (_lod2Dist - _fadeRange) ** 2;
    outer2DistSq = (_lod2Dist + _fadeRange) ** 2;
  }
  _recomputeThresholds();

  let _frameCount = 0;
  // LOD count monitors — updated every frame, read by getLodCounts()
  let _lastNearCount = 0, _lastLod1Count = 0, _lastLod2Count = 0;

  function update(camera, frustum) {
    // Temporal dithering: advance golden-ratio frame offset for IGN jitter
    _frameCount++;
    uFrameOffset.value = (_frameCount * 0.6180339887) % 1.0;

    const cpx = camera.position.x;
    const cpy = camera.position.y;
    const cpz = camera.position.z;

    let nearCount = 0, farCount = 0, megaCount = 0;

    for (let i = 0; i < treeCount; i++) {
      // Frustum cull first — skips invisible trees cheaply
      if (frustum) {
        _cullSphere.center.set(posX[i], posY[i], posZ[i]);
        if (!frustum.intersectsSphere(_cullSphere)) continue;
      }

      const dx = posX[i] - cpx, dy = posY[i] - cpy, dz = posZ[i] - cpz;
      const distSq = dx*dx + dy*dy + dz*dz;

      // LOD0: real model — shown up to (lodDist + fadeRange) for smooth crossfade
      if (distSq < outerDistSq) {
        for (let j = 0; j < 16; j++) _compactNear[nearCount * 16 + j] = allNearMats[i * 16 + j];
        nearCount++;
      }

      // LOD1: standard impostor — shown from (lodDist - fadeRange) to (lod2Dist + fadeRange)
      if (distSq >= innerDistSq && distSq < outer2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        impostorMesh.setMatrixAt(farCount, _m);
        compactCenters[farCount * 4]     = allCenters[i * 3];
        compactCenters[farCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters[farCount * 4 + 2] = allCenters[i * 3 + 2];
        farCount++;
      }

      // LOD2: mega-impostor (single sprite) — shown from (lod2Dist - fadeRange) outward
      if (distSq >= inner2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        megaMesh.setMatrixAt(megaCount, _m);
        compactCenters2[megaCount * 4]     = allCenters[i * 3];
        compactCenters2[megaCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters2[megaCount * 4 + 2] = allCenters[i * 3 + 2];
        megaCount++;
      }
    }

    // Near meshes
    for (const nm of nearMeshes) {
      nm.instanceMatrix.array.set(_compactNear.subarray(0, nearCount * 16));
      nm.count = nearCount;
      nm.instanceMatrix.needsUpdate = true;
    }

    // LOD1 impostors
    impostorMesh.count = farCount;
    impostorMesh.instanceMatrix.needsUpdate = true;
    centersStorage.value.needsUpdate = true;

    // LOD2 mega-impostors
    megaMesh.count = megaCount;
    megaMesh.instanceMatrix.needsUpdate = true;
    centersStorage2.value.needsUpdate = true;

    // Store counts for external monitors
    _lastNearCount = nearCount;
    _lastLod1Count = farCount;
    _lastLod2Count = megaCount;
  }

  function dispose() {
    for (const nm of nearMeshes) { nm.geometry.dispose(); group.remove(nm); }
    planeGeo.dispose();
    impostorMat.dispose();
    megaMat.dispose();
    colorTex.dispose();
    normalTex.dispose();
    group.remove(impostorMesh);
    group.remove(megaMesh);
  }

  return {
    group,
    update,
    dispose,
    impostorMesh,
    // Lighting (instant)
    updateSunDir:    (v3) => _uSunDir.value.copy(v3),
    updateSunColor:  (v3) => _uSunColor.value.copy(v3),
    updateAmbColor:  (v3) => _uAmbColor.value.copy(v3),
    // LOD distances (instant — updates uniforms + recomputes JS thresholds)
    setLodDistance:  (d) => { _lodDist  = d; _uLodDist.value  = d; _recomputeThresholds(); },
    setLod2Distance: (d) => { _lod2Dist = d; _uLod2Dist.value = d; _recomputeThresholds(); },
    setFadeRange:    (f) => { _fadeRange = f; _uFadeRange.value = f; _recomputeThresholds(); },
    // Alpha cutout on impostor materials (instant)
    setAlphaClamp:   (v) => { impostorMat.alphaTest = v; megaMat.alphaTest = v; },
    // Per-LOD visibility for debug isolation
    setLodVisible:   (tier, v) => {
      if (tier === 0) nearMeshes.forEach(m => m.visible = v);
      else if (tier === 1) impostorMesh.visible = v;
      else if (tier === 2) megaMesh.visible = v;
    },
    // Frame counts for monitors
    getLodCounts:    () => ({ near: _lastNearCount, lod1: _lastLod1Count, lod2: _lastLod2Count }),
  };
}
