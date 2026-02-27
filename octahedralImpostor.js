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
  Fn,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  positionLocal,
  positionWorld,
  cameraPosition,
  instancedArray,
  instanceIndex,
  varying,
  texture,
  mix,
  clamp,
  saturate,
  floor,
  fract,
  min,
  max,
  dot,
  cross,
  normalize,
  sign,
  abs,
  length,
  add,
  sub,
  mul,
  div,
  negate,
  select,
  screenCoordinate,
  uv,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ─────────────────────────────────────────────────────────────────────────────
// TSL helpers
// ─────────────────────────────────────────────────────────────────────────────

// Per-frame golden-ratio offset for temporal dithering (updated by forest.update())
const uFrameOffset = uniform(float(0));

// Interleaved Gradient Noise — screen-stable dither pattern with temporal jitter
// Returns float in [0, 1). Input: screenCoordinate.xy (raw pixel position).
const IGN = Fn(([coord]) =>
  fract(
    mul(
      float(52.9829189),
      fract(
        add(
          add(mul(float(0.06711056), coord.x), mul(float(0.00583715), coord.y)),
          uFrameOffset,
        ),
      ),
    ),
  ),
);

// ─────────────────────────────────────────────────────────────────────────────
// Loaders
// ─────────────────────────────────────────────────────────────────────────────
const _draco = new DRACOLoader();
_draco.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);
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

// Returns true if the geometry is a degenerate proxy mesh (LOD card, shadow plane, billboard rect).
// Detection uses two independent signals so it works for axis-aligned AND rotated planes:
//   1. Very low vertex count  — a rectangle has 4 verts; any real tree mesh has hundreds.
//   2. Bounding-box flatness  — catches axis-aligned thin planes that happen to have more verts.
const _flatBox = new THREE.Box3();
const _flatSz  = new THREE.Vector3();
function isFlatGeometry(g) {
  const pos = g.attributes.position;
  if (!pos) return false;
  // Signal 1: suspiciously few vertices (quad = 4, simple strip = 6, etc.)
  if (pos.count <= 16) return true;
  // Signal 2: one bounding-box axis is tiny relative to the other two (axis-aligned planes)
  _flatBox.setFromBufferAttribute(pos);
  _flatBox.getSize(_flatSz);
  const maxDim = Math.max(_flatSz.x, _flatSz.y, _flatSz.z);
  const minDim = Math.min(_flatSz.x, _flatSz.y, _flatSz.z);
  return maxDim > 0 && minDim / maxDim < 0.02;
}

function computeBoundingSphere(obj, out, force = false, skipFlat = false) {
  out.makeEmpty();
  const s = new THREE.Sphere();
  function walk(o) {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      if (force || !g.boundingSphere) g.computeBoundingSphere();
      if (skipFlat) {
        const gc = g.clone();
        gc.applyMatrix4(o.matrixWorld);
        if (isFlatGeometry(gc)) return;
      }
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
const ATLAS_VERT = /* glsl */ `#version 300 es
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
const ATLAS_FRAG = /* glsl */ `#version 300 es
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
  if (c.a < alphaTest) discard;
  // Convert sRGB texture + material color to linear.
  // WebGL2 texImage2D(RGBA) returns raw bytes — no gamma decode — so game textures
  // (which are sRGB-encoded) must be linearised here. Storing linear in the atlas
  // means runtime lighting works in linear space; WebGPU handles final sRGB output.
  c.rgb = pow(max(c.rgb, vec3(0.001)), vec3(2.2));
  c.rgb *= pow(max(uMatColor, vec3(0.001)), vec3(2.2));
  // Subtle vertical AO: slight darkening at base (was 0.6–1.0; now 0.92–1.0 to avoid shady/hollow look on rocks)
  float baseY = uSphereCenter.y - uSphereRadius;
  float yNorm = clamp((vWorldPos.y - baseY) / (uSphereRadius * 0.8), 0.0, 1.0);
  float ao = mix(0.92, 1.0, yNorm);
  outColor = vec4(c.rgb * ao, c.a);
}`;

// Normal atlas — stores world-space normals encoded to [0,1] per sprite
const NORMAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map; uniform float alphaTest;
in vec2 vUv; in vec3 vWorldNormal;
out vec4 outColor;
void main() {
  if (texture(map, vUv).a < alphaTest) discard;
  outColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
}`;

// WeakMap so each WebGL2 context (new canvas per bake call) gets its own white texture.
// A plain module variable would cache the texture from the first context and cause
// "bindTexture: object does not belong to this context" on every rebake.
const _whiteTexByCtx = new WeakMap();
function whiteTexture(gl) {
  if (_whiteTexByCtx.has(gl)) return _whiteTexByCtx.get(gl);
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([255, 255, 255, 255]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  _whiteTexByCtx.set(gl, t);
  return t;
}

function buildProgram(gl, vs, fs) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
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
  const pa = geo.getAttribute("position");
  const ua = geo.getAttribute("uv");
  const na = geo.getAttribute("normal");
  const ix = geo.index;
  if (!pa) return;

  const buf = (arr, loc, size) => {
    if (!arr || loc < 0) {
      if (loc >= 0) {
        gl.disableVertexAttribArray(loc);
        gl.vertexAttrib3f(loc, 0, 1, 0);
      }
      return null;
    }
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, arr.array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    return b;
  };

  const b0 = buf(pa, posLoc, pa.itemSize);
  const b1 = ua ? buf(ua, uvLoc, ua.itemSize) : null;
  const b2 = na ? buf(na, normLoc, na.itemSize) : null;

  if (!ua) {
    gl.disableVertexAttribArray(uvLoc);
    gl.vertexAttrib2f(uvLoc, 0, 0);
  }
  if (!na) {
    gl.disableVertexAttribArray(normLoc);
    gl.vertexAttrib3f(normLoc, 0, 1, 0);
  }

  if (ix) {
    const bi = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bi);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ix.array, gl.STATIC_DRAW);
    gl.drawElements(
      gl.TRIANGLES,
      ix.count,
      ix.array instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
      0,
    );
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
  const w = img.width || img.videoWidth,
    h = img.height || img.videoHeight;
  if (!w || !h) return null;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  if (img.data)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      img.data,
    );
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.generateMipmap(gl.TEXTURE_2D);
  return t;
}

function bakeAtlas(
  modelScene,
  {
    textureSize = 2048,
    spritesPerSide = 12,
    alphaTest = 0.4,
    bakeOnlyLargestMesh = false,
    sphereMargin = 1.05,  // inflate bounding sphere slightly to prevent orthographic frustum clipping
  } = {},
) {
  const N = spritesPerSide;
  const Nm1 = Math.max(1, N - 1);
  const ss = textureSize / N;

  let meshes = [];
  modelScene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    // Skip flat/degenerate meshes (LOD cards, shadow planes) — they corrupt atlas sprites
    const _gc = o.geometry.clone();
    _gc.applyMatrix4(o.matrixWorld);
    if (isFlatGeometry(_gc)) return;
    meshes.push(o);
  });
  if (!meshes.length) throw new Error("[OctahedralImpostor] No meshes to bake");

  // If the GLB has multiple objects (e.g. several trees), bake only the largest mesh so each cell = one object.
  let sphere = new THREE.Sphere();
  if (bakeOnlyLargestMesh && meshes.length > 1) {
    let best = meshes[0];
    let bestVol = 0;
    const s = new THREE.Sphere();
    for (const m of meshes) {
      computeBoundingSphere(m, s, true);
      const v = s.radius * s.radius * s.radius;
      if (v > bestVol) {
        bestVol = v;
        best = m;
      }
    }
    meshes = [best];
    computeBoundingSphere(best, sphere, true);
  } else {
    sphere = computeBoundingSphere(modelScene, new THREE.Sphere(), true, true);
  }

  // Inflate bounding sphere by the margin so geometry at the sphere surface doesn't
  // get clipped by the orthographic bake frustum (exactly sphere.radius wide).
  // The same inflated radius is returned and used for impostorScale at runtime — both stay in sync.
  sphere.radius *= sphereMargin;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = textureSize;
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("[OctahedralImpostor] WebGL2 unavailable");

  // ── Albedo program (albedo * AO — no directional light, moved to runtime) ──
  const prog = buildProgram(gl, ATLAS_VERT, ATLAS_FRAG);
  const posLoc = gl.getAttribLocation(prog, "position");
  const uvLoc = gl.getAttribLocation(prog, "uv");
  const normLoc = gl.getAttribLocation(prog, "normal");
  const uMV = gl.getUniformLocation(prog, "modelViewMatrix");
  const uProj = gl.getUniformLocation(prog, "projectionMatrix");
  const uMod = gl.getUniformLocation(prog, "modelMatrix");
  const uMap = gl.getUniformLocation(prog, "map");
  const uAlpha = gl.getUniformLocation(prog, "alphaTest");
  const uMatCol = gl.getUniformLocation(prog, "uMatColor");
  const uSphCtr = gl.getUniformLocation(prog, "uSphereCenter");
  const uSphRad = gl.getUniformLocation(prog, "uSphereRadius");

  // ── Normal program (world-space normals → [0,1] RGBA) ──
  const normProg = buildProgram(gl, ATLAS_VERT, NORMAL_FRAG);
  const nPosLoc = gl.getAttribLocation(normProg, "position");
  const nUvLoc = gl.getAttribLocation(normProg, "uv");
  const nNormLoc = gl.getAttribLocation(normProg, "normal");
  const uNMV = gl.getUniformLocation(normProg, "modelViewMatrix");
  const uNProj = gl.getUniformLocation(normProg, "projectionMatrix");
  const uNMod = gl.getUniformLocation(normProg, "modelMatrix");
  const uNMap = gl.getUniformLocation(normProg, "map");
  const uNAlpha = gl.getUniformLocation(normProg, "alphaTest");

  // No margin — sphere already encloses all geometry for orthographic projection
  const half = sphere.radius;
  const cam = new THREE.OrthographicCamera(
    -half,
    half,
    half,
    -half,
    0.001,
    sphere.radius * 4,
  );

  const fbo = gl.createFramebuffer();
  const depthRB = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
  gl.renderbufferStorage(
    gl.RENDERBUFFER,
    gl.DEPTH_COMPONENT16,
    textureSize,
    textureSize,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER,
    gl.DEPTH_ATTACHMENT,
    gl.RENDERBUFFER,
    depthRB,
  );

  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  const camPos = new THREE.Vector3();
  const viewMat = new THREE.Matrix4();

  const makeGLTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      textureSize,
      textureSize,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
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
        cam.position.copy(camPos);
        cam.lookAt(sphere.center);
        cam.updateMatrixWorld(true);
        viewMat.copy(cam.matrixWorldInverse);
        const x0 = col * ss,
          y0 = row * ss;
        gl.viewport(x0, y0, ss, ss);
        gl.scissor(x0, y0, ss, ss);
        gl.enable(gl.SCISSOR_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        for (const mesh of meshes) {
          const mat = Array.isArray(mesh.material)
            ? mesh.material[0]
            : mesh.material;
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
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    colGLTex,
    0,
  );
  gl.useProgram(prog);
  gl.uniform3f(uSphCtr, sphere.center.x, sphere.center.y, sphere.center.z);
  gl.uniform1f(uSphRad, sphere.radius);

  renderSprites(prog, posLoc, uvLoc, normLoc, (mesh, mat, mv) => {
    gl.uniformMatrix4fv(uMV, false, mv.elements);
    gl.uniformMatrix4fv(uProj, false, cam.projectionMatrix.elements);
    gl.uniformMatrix4fv(uMod, false, mesh.matrixWorld.elements);
    gl.uniform1f(uAlpha, mat.alphaTest > 0 ? mat.alphaTest : alphaTest);
    const col = mat.color;
    const mc = col
      ? typeof col.getHex === "function"
        ? { r: col.r, g: col.g, b: col.b }
        : { r: col.r ?? 1, g: col.g ?? 1, b: col.b ?? 1 }
      : { r: 1, g: 1, b: 1 };
    gl.uniform3f(uMatCol, mc.r, mc.g, mc.b);
    let t = null,
      own = false;
    if (mat.map?.image) {
      t = uploadTex(gl, mat.map.image);
      own = !!t;
    }
    if (!t) t = whiteTexture(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(uMap, 0);
    return own ? t : null; // returned texture is deleted after drawMesh
  });
  const colorPixels = new Uint8Array(textureSize * textureSize * 4);
  gl.readPixels(
    0,
    0,
    textureSize,
    textureSize,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    colorPixels,
  );

  // Do NOT flip atlas vertically — keep native bake order: V=0 = view -Y = bottom of mesh, V=1 = top.
  // Runtime getUV uses uvf.y directly so quad top (uvf.y=1) samples atlas V=1 = top of mesh.
  // (Removing flipAtlasCellsVertical to avoid view-dependent vertical shift bugs.)
  // const flipAtlasCellsVertical = (pixels) => { ... };
  // flipAtlasCellsVertical(colorPixels);

  // ── Pass 2: World-space normals ───────────────────────────────────────────
  const normGLTex = makeGLTex();
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    normGLTex,
    0,
  );

  renderSprites(normProg, nPosLoc, nUvLoc, nNormLoc, (mesh, mat, mv) => {
    gl.uniformMatrix4fv(uNMV, false, mv.elements);
    gl.uniformMatrix4fv(uNProj, false, cam.projectionMatrix.elements);
    gl.uniformMatrix4fv(uNMod, false, mesh.matrixWorld.elements);
    gl.uniform1f(uNAlpha, mat.alphaTest > 0 ? mat.alphaTest : alphaTest);
    let t = null,
      own = false;
    if (mat.map?.image) {
      t = uploadTex(gl, mat.map.image);
      own = !!t;
    }
    if (!t) t = whiteTexture(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(uNMap, 0);
    return own ? t : null; // returned texture is deleted after drawMesh
  });
  const normalPixels = new Uint8Array(textureSize * textureSize * 4);
  gl.readPixels(
    0,
    0,
    textureSize,
    textureSize,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    normalPixels,
  );
  // flipAtlasCellsVertical(normalPixels);  // match color: no flip, native V=0=bottom

  // ── Cleanup ───────────────────────────────────────────────────────────────
  gl.deleteTexture(colGLTex);
  gl.deleteTexture(normGLTex);
  gl.deleteRenderbuffer(depthRB);
  gl.deleteFramebuffer(fbo);
  gl.deleteProgram(prog);
  gl.deleteProgram(normProg);

  const makeTex = (pixels) => {
    const t = new THREE.DataTexture(
      pixels,
      textureSize,
      textureSize,
      THREE.RGBAFormat,
    );
    t.needsUpdate = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 4;
    t.colorSpace = THREE.LinearSRGBColorSpace; // atlas stores linear (bake uses no gamma encode)
    return t;
  };
  // No flipY — DataTexture row-0 = bottom matches readPixels row-0 = bottom
  return {
    colorTex: makeTex(colorPixels),
    normalTex: makeTex(normalPixels),
    sphere,
  };
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
function createImpostorMaterial(
  atlasTex,
  normalTex,
  impostorScale,
  centersStorage,
  opts = {},
) {
  const spritesPerSide = opts.spritesPerSide ?? 12;
  const alphaClamp = opts.alphaClamp ?? 0.4;
  const lodDistance = opts.lodDistance ?? 80;
  const fadeRange = opts.fadeRange ?? 8;
  const mega = opts.mega ?? false;

  const uSPS = uniform(spritesPerSide);
  const uScale = uniform(impostorScale);
  const uLodDist = opts.lodDistUniform ?? uniform(float(lodDistance));
  const uFadeRange = opts.fadeRangeUniform ?? uniform(float(fadeRange));
  // Dynamic lighting uniforms (shared via opts.sunDir etc. from forest scope)
  const uSunDir =
    opts.sunDir ?? uniform(new THREE.Vector3(0.5, 1.0, 0.3).normalize());
  const uSunColor =
    opts.sunColor ?? uniform(new THREE.Vector3(0.85, 0.78, 0.6));
  const uAmbColor = opts.ambColor ?? uniform(new THREE.Vector3(0.35, 0.4, 0.5));
  const uLightScale =
    typeof opts.lightScale === "number"
      ? uniform(float(opts.lightScale))
      : (opts.lightScale ?? uniform(float(1.0))); // e.g. 0.8 for rocks to match PBR

  // Varyings: sprite weights, indices, and pre-computed sprite UVs (vertex-stage parallax)
  const vWeight = varying(vec4(0, 0, 0, 0), "vWeight");
  const vS1 = varying(vec2(0, 0), "vS1");
  const vS2 = varying(vec2(0, 0), "vS2");
  const vS3 = varying(vec2(0, 0), "vS3");
  const vUV1 = varying(vec2(0, 0), "vUV1"); // ray-plane UV for sprite 1 (vertex-stage)
  const vUV2 = varying(vec2(0, 0), "vUV2"); // ray-plane UV for sprite 2
  const vUV3 = varying(vec2(0, 0), "vUV3"); // ray-plane UV for sprite 3

  // Per-instance center (world-space sphere centre) from storage buffer
  // Read xyz from vec4 (vec3 in WebGPU storage buffers needs 16-byte/4-float alignment)
  const centerNode = centersStorage.element(instanceIndex).xyz;

  // ── Encoding / decoding (hemi-octahedron) ──────────────────────────────────
  const encode = Fn(([dir]) => {
    // Project unit direction onto octahedron, then remap to hemi [0,1]^2
    const s = vec3(sign(dir.x), sign(dir.y), sign(dir.z));
    const d = dot(dir, s); // L1 norm = |x|+|y|+|z|
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
    const up = mix(
      vec3(0, 1, 0),
      vec3(-1, 0, 0),
      max(float(0), sign(sub(n.y, float(0.999)))),
    );
    return normalize(cross(up, n));
  });
  const planeBitangent = Fn(([n, t]) => cross(n, t));

  // World-up in plane: matches bake camera (0,1,0) so quad and UV share same vertical axis.
  const planeUp = Fn(([n, t]) => {
    const worldUp = vec3(0, 1, 0);
    const proj = sub(worldUp, mul(n, dot(n, worldUp)));
    const len = length(proj);
    return select(len.lessThan(float(0.001)), t, normalize(proj));
  });

  // Billboard: use planeUp for vertical so quad bottom = world bottom = mesh bottom in texture.
  const projectVert = Fn(([n]) => {
    const t = planeTangent(n);
    const up = planeUp(n, t);
    return add(mul(positionLocal.x, t), mul(positionLocal.y, up));
  });

  // Ray–plane intersection → sprite UV within a frame (same up axis as quad).
  const planeUV = Fn(([n, t, b, camL, vd]) => {
    const denom = dot(vd, n);
    const tt = mul(dot(negate(camL), n), div(1, denom));
    const hit = add(camL, mul(vd, tt));
    const upInPlane = planeUp(n, t);
    return add(vec2(dot(t, hit), dot(upInPlane, hit)), 0.5);
  });

  // ── Position node — billboard vertex (engine applies T*S instance matrix) ──
  const positionNodeFn = Fn(() => {
    const nm1 = vec2(sub(uSPS, float(1)), sub(uSPS, float(1)));

    // Per-instance sphere center from storage buffer
    const center = centerNode;

    // Camera position in LOCAL space (sphere-radius-normalized)
    const camLocal = mul(sub(cameraPosition, center), div(float(1), uScale));
    const camDir = normalize(camLocal);

    // Billboard vertex in local space (±0.5 × tangent/bitangent)
    const bv = projectVert(camDir);

    // View direction from billboard vertex toward camera (vertex-stage parallax)
    const viewDir = normalize(sub(bv, camLocal));

    // Octahedral grid lookup and trilinear blend weights
    const grid = mul(encode(camDir), nm1);
    const gf = min(floor(grid), nm1);
    const frac = fract(grid);

    // w.w MUST be binary: use sign() clamped to [0,1] = same as ceil(x-y) for frac ∈ [0,1)
    const w = vec4(
      min(sub(1, frac.x), sub(1, frac.y)),
      abs(sub(frac.x, frac.y)),
      min(frac.x, frac.y),
      max(float(0), sign(sub(frac.x, frac.y))),
    );
    vWeight.assign(w);

    const s1 = gf;
    const s2 = min(add(s1, mix(vec2(0, 1), vec2(1, 0), w.w)), nm1);
    const s3 = min(add(s1, vec2(1, 1)), nm1);
    vS1.assign(s1);
    vS2.assign(s2);
    vS3.assign(s3);

    // Compute ray-plane UVs per-vertex and pass as varyings.
    // Vertex-stage is stable (no per-fragment divergence at oblique angles).
    const pn1 = decode(s1, nm1);
    const pt1 = planeTangent(pn1);
    const pb1 = planeBitangent(pn1, pt1);
    const pn2 = decode(s2, nm1);
    const pt2 = planeTangent(pn2);
    const pb2 = planeBitangent(pn2, pt2);
    const pn3 = decode(s3, nm1);
    const pt3 = planeTangent(pn3);
    const pb3 = planeBitangent(pn3, pt3);
    vUV1.assign(planeUV(pn1, pt1, pb1, camLocal, viewDir));
    vUV2.assign(planeUV(pn2, pt2, pb2, camLocal, viewDir));
    vUV3.assign(planeUV(pn3, pt3, pb3, camLocal, viewDir));

    // Return billboard vertex offset in local space.
    // InstancedMesh applies T(center)*S(scale) → correct world position.
    return bv;
  });

  // ── Color node — uses vertex-stage parallax UVs (interpolated from positionNodeFn) ──
  // Native bake: V=0 = bottom of mesh, V=1 = top. Quad top (uvf.y=1) → sample V=1 = top of mesh.
  const getUV = Fn(([uvf, frame, fs]) =>
    clamp(
      mul(fs, add(frame, clamp(vec2(uvf.x, uvf.y), 0, 1))),
      0,
      1,
    ),
  );

  const colorNodeFn = Fn(() => {
    const fs = div(float(1), uSPS);

    const c1 = texture(atlasTex, getUV(vUV1, vS1, fs));
    const c2 = mega ? c1 : texture(atlasTex, getUV(vUV2, vS2, fs));
    const c3 = mega ? c1 : texture(atlasTex, getUV(vUV3, vS3, fs));

    // ── Alpha and color: dominant sprite only — avoids trunk/foliage ghosting from other views ──
    const dominantAlpha = mega
      ? c1.a
      : select(
          vWeight.x
            .greaterThanEqual(vWeight.y)
            .and(vWeight.x.greaterThanEqual(vWeight.z)),
          c1.a,
          select(vWeight.y.greaterThanEqual(vWeight.z), c2.a, c3.a),
        );
    const dominantRgb = mega
      ? c1.rgb
      : select(
          vWeight.x
            .greaterThanEqual(vWeight.y)
            .and(vWeight.x.greaterThanEqual(vWeight.z)),
          c1.rgb,
          select(vWeight.y.greaterThanEqual(vWeight.z), c2.rgb, c3.rgb),
        );
    // Undo pre-multiplied alpha from atlas bake
    let blendedRgb = mul(
      dominantRgb,
      div(float(1), max(dominantAlpha, float(0.001))),
    );
    blendedRgb = saturate(blendedRgb);

    // ── Normal: match dominant sprite so lighting is consistent with color ──
    const n1 = texture(normalTex, getUV(vUV1, vS1, fs)).xyz;
    const n2 = mega ? n1 : texture(normalTex, getUV(vUV2, vS2, fs)).xyz;
    const n3 = mega ? n1 : texture(normalTex, getUV(vUV3, vS3, fs)).xyz;
    const normEnc = mega
      ? n1
      : select(
          vWeight.x
            .greaterThanEqual(vWeight.y)
            .and(vWeight.x.greaterThanEqual(vWeight.z)),
          n1,
          select(vWeight.y.greaterThanEqual(vWeight.z), n2, n3),
        );
    const worldNorm = normalize(sub(mul(normEnc, float(2.0)), float(1.0)));
    // Lambert diffuse — back faces get 0 sun contribution (correct).
    // Wrap (dot*0.5+0.5) was causing perpendicular faces to receive sunColor*0.5 phantom light,
    // making impostors 2-3× brighter than the real PBR mesh at matching view angles.
    const diffuse = max(dot(worldNorm, uSunDir), float(0));
    // Light can exceed 1.0 — let the renderer's tone mapping handle compression
    let light = add(uAmbColor, mul(uSunColor, diffuse));
    light = mul(light, uLightScale);

    // ── LOD dither fade-in ──
    const dist = length(sub(centerNode, cameraPosition));
    const fadeT = saturate(
      div(sub(dist, sub(uLodDist, uFadeRange)), uFadeRange),
    );
    const dither = IGN(screenCoordinate.xy);
    const alphaOut = select(
      dither.greaterThan(fadeT),
      float(0.0),
      dominantAlpha,
    );

    return vec4(mul(blendedRgb, light), alphaOut);
  });

  // FrontSide only — avoids drawing both sides of the billboard (was causing layered/ghost look)
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
  mat.positionNode = positionNodeFn(); // positionNode = local-space pos, engine applies instanceMatrix
  mat.colorNode = colorNodeFn();
  mat.transparent = false; // alpha-tested opaque → depthWrite stays true
  mat.alphaTest = alphaClamp;
  mat.depthWrite = true;
  return mat;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────
export async function createOctahedralImpostorForest(opts = {}) {
  const {
    modelPath,
    modelScene: _modelSceneOpt = null,  // optional pre-built Three.js scene (skips GLTF load)
    treeCount = 300,
    treeScale = 1,
    lodDistance = 80,
    radius = 250,
    minRadius = 30,
    centerPosition = [0, 0, 0],
    getTerrainHeight = null,
    impostorSettings = {},
  } = opts;

  const iOpts = {
    spritesPerSide: impostorSettings.spritesPerSide ?? 12,
    textureSize: impostorSettings.textureSize ?? 2048,
    alphaClamp: impostorSettings.alphaClamp ?? 0.1, // runtime discard — low to keep soft foliage
    alphaTest: impostorSettings.alphaTest ?? 0.05, // bake discard — very low to capture full foliage
    fadeRange: impostorSettings.fadeRange ?? 8, // crossfade half-width in world units
    lod2Distance: impostorSettings.lod2Distance ?? 150, // mega-impostor starts here
    lightScale: impostorSettings.lightScale ?? 1.0, // 1 = default; e.g. 0.8 for rocks to match PBR
    bakeOnlyLargestMesh: impostorSettings.bakeOnlyLargestMesh ?? false, // if true, bake only the largest mesh (avoids "4 small + 1 big" per cell)
    sphereMargin: impostorSettings.sphereMargin ?? 1.05, // bounding sphere inflation factor (1.05 = 5% margin)
  };

  // Dynamic lighting uniforms shared by all impostor materials (regular + mega)
  // Initialised to match game defaults; updated via forest.updateSunDir() etc. each frame
  const _uSunDir = uniform(new THREE.Vector3(-1.0, 0.55, 1.0).normalize());
  const _uSunColor = uniform(new THREE.Vector3(0.85, 0.78, 0.6));
  const _uAmbColor = uniform(new THREE.Vector3(0.35, 0.4, 0.5));

  // LOD distance uniforms — lifted to forest scope so setters can update them at runtime
  let _lodDist = lodDistance;
  let _lod2Dist = iOpts.lod2Distance;
  let _fadeRange = iOpts.fadeRange;
  const _uLodDist = uniform(float(_lodDist));
  const _uFadeRange = uniform(float(_fadeRange));
  const _uLod2Dist = uniform(float(_lod2Dist));

  // ── Load model ──────────────────────────────────────────────────────────────
  let root;
  if (_modelSceneOpt) {
    root = _modelSceneOpt;
  } else {
    const gltf = await new Promise((res, rej) =>
      _gltf.load(modelPath, res, undefined, rej),
    );
    root = gltf.scene;
  }
  root.updateMatrixWorld(true);

  // ── Bake atlas (albedo+AO pass + world-normal pass) ────────────────────────
  const bakeResult = bakeAtlas(root, {
    textureSize: iOpts.textureSize,
    spritesPerSide: iOpts.spritesPerSide,
    alphaTest: iOpts.alphaTest,
    bakeOnlyLargestMesh: iOpts.bakeOnlyLargestMesh,
    sphereMargin: iOpts.sphereMargin,
  });
  const { colorTex, normalTex, sphere } = bakeResult;
  // Use the same sphere the bake used (important when bakeOnlyLargestMesh: one mesh = one sphere)
  const impostorScale = sphere.radius * 2 * treeScale;
  const sphereCenter = sphere.center.clone().multiplyScalar(treeScale);

  // ── Near-LOD geometry ──────────────────────────────────────────────────────
  // Uniforms for dither fade-out on near LOD0 trees as they approach lodDistance
  const uNearLodDist = uniform(float(lodDistance));
  const uNearFadeRange = uniform(float(iOpts.fadeRange));

  const leafGeos = [],
    leafMats = [],
    trunkGeos = [],
    trunkMats = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    // Skip flat/degenerate meshes (LOD cards, shadow planes, billboard proxies left in the export).
    // A genuine tree mesh has significant extent in all 3 axes; a flat plane has near-zero in one.
    if (isFlatGeometry(g)) return;
    const m = o.material;
    const name = (o.name + " " + (m?.name ?? "")).toLowerCase();
    const isLeaf =
      m?.transparent ||
      /leaf|leave|foliage|canopy|frond|branch/i.test(name) ||
      (m?.map && (m?.side === THREE.DoubleSide || m?.alphaTest > 0));
    const nodeMat = new THREE.MeshStandardNodeMaterial({
      color: m?.color?.getHex?.() ?? 0x448833,
      roughness: m?.roughness ?? 0.8,
      metalness: m?.metalness ?? 0,
      map: m?.map ?? null,
      transparent: false,
      alphaTest: isLeaf ? iOpts.alphaTest : 0.5, // 0.5 lets dither-discard (alpha=0) work on trunks too
      side: isLeaf ? THREE.DoubleSide : (m?.side ?? THREE.FrontSide),
      depthWrite: true,
    });

    // LOD dither fade-out: near tree disappears as it approaches lodDistance
    // fadeT: 1=near camera (fully visible), 0=at/past lodDist (fully dithered away)
    const matMap = m?.map ?? null;
    nodeMat.alphaNode = Fn(() => {
      const dist = length(sub(positionWorld, cameraPosition));
      const fadeT = saturate(
        div(sub(add(uNearLodDist, uNearFadeRange), dist), uNearFadeRange),
      );
      const dither = IGN(screenCoordinate.xy);
      // For leaves: preserve texture alpha for leaf shape; for trunk: fully opaque when not dithered
      const baseAlpha = matMap ? texture(matMap, uv()).a : float(1.0);
      return select(dither.greaterThan(fadeT), float(0.0), baseAlpha);
    })();

    if (isLeaf) {
      leafGeos.push(g);
      leafMats.push(nodeMat);
    } else {
      trunkGeos.push(g);
      trunkMats.push(nodeMat);
    }
  });

  // ── Scatter positions ───────────────────────────────────────────────────────
  const cx0 = centerPosition[0],
    cz0 = centerPosition[2];
  const posX = new Float32Array(treeCount);
  const posY = new Float32Array(treeCount);
  const posZ = new Float32Array(treeCount);
  const allNearMats = new Float32Array(treeCount * 16);
  const allImpostorMats = new Float32Array(treeCount * 16); // T(center)*S(impostorScale)
  const allCenters = new Float32Array(treeCount * 3);

  const _m = new THREE.Matrix4();
  const _sc = new THREE.Vector3(treeScale, treeScale, treeScale);

  for (let i = 0; i < treeCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = minRadius + Math.random() * (radius - minRadius);
    const x = cx0 + Math.cos(angle) * dist;
    const z = cz0 + Math.sin(angle) * dist;
    const y = getTerrainHeight ? getTerrainHeight(x, z) : centerPosition[1];

    posX[i] = x;
    posY[i] = y;
    posZ[i] = z;

    // Near: TRS with treeScale
    _m.makeRotationY(Math.random() * Math.PI * 2)
      .scale(_sc)
      .setPosition(x, y, z);
    _m.toArray(allNearMats, i * 16);

    // Impostor: T(sphereCenter) * S(impostorScale).
    // sphereCenter.y (= sphere.center.y * treeScale) matches where the bake camera aimed (sphere.center),
    // so UV=0.5 in the atlas sprite lands at the correct world height for every model.
    const wcx = x + sphereCenter.x;
    const wcy = y + sphereCenter.y;
    const wcz = z + sphereCenter.z;
    allCenters[i * 3] = wcx;
    allCenters[i * 3 + 1] = wcy;
    allCenters[i * 3 + 2] = wcz;
    _m.identity()
      .makeScale(impostorScale, impostorScale, impostorScale)
      .setPosition(wcx, wcy, wcz);
    _m.toArray(allImpostorMats, i * 16);
  }

  // ── Near InstancedMeshes ────────────────────────────────────────────────────
  const group = new THREE.Group();
  const nearMeshes = [];

  const makeNearMesh = (geos, mats) => {
    if (!geos.length) return null;
    const geo = mergeGeometries(geos, true);
    geo.computeBoundingSphere();
    const im = new THREE.InstancedMesh(
      geo,
      mats.length === 1 ? mats[0] : mats,
      treeCount,
    );
    im.castShadow = true;
    im.frustumCulled = false;
    for (let i = 0; i < treeCount; i++) {
      _m.fromArray(allNearMats, i * 16);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
    im.count = treeCount;
    group.add(im);
    nearMeshes.push(im);
    return im;
  };
  makeNearMesh(trunkGeos, trunkMats);
  makeNearMesh(leafGeos, leafMats);

  // ── Impostor InstancedMesh ─────────────────────────────────────────────────
  const planeGeo = new THREE.PlaneGeometry(1, 1);

  // Storage buffer for per-instance center positions (compacted each frame)
  // IMPORTANT: WebGPU storage buffers require 16-byte (vec4) alignment for vec3 data.
  // Using vec4 with 4th component = 0 padding to avoid per-instance read misalignment.
  const compactCenters = new Float32Array(treeCount * 4); // 4 floats per entry
  const centersStorage = instancedArray(compactCenters, "vec4").setName(
    "impostorCenters",
  );

  // Shared lightScale uniform — both materials use the same node so one setter updates both
  const _uLightScale = uniform(float(iOpts.lightScale ?? 1.0));

  const _sunOpts = {
    sunDir: _uSunDir,
    sunColor: _uSunColor,
    ambColor: _uAmbColor,
    lightScale: _uLightScale,  // pass pre-created uniform so both materials share it
  };
  const impostorMat = createImpostorMaterial(
    colorTex,
    normalTex,
    impostorScale,
    centersStorage,
    {
      ...iOpts,
      lodDistance,
      ..._sunOpts,
      lodDistUniform: _uLodDist,
      fadeRangeUniform: _uFadeRange,
    },
  );
  const impostorMesh = new THREE.InstancedMesh(
    planeGeo,
    impostorMat,
    treeCount,
  );
  impostorMesh.castShadow = false;
  impostorMesh.frustumCulled = false;
  impostorMesh.count = 0;
  group.add(impostorMesh);

  // ── Wireframe overlay for debug (same geometry + instance matrices as LOD1 impostor)
  const wireframeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    depthTest: true,
    depthWrite: false,
  });
  const wireframeMesh = new THREE.InstancedMesh(
    planeGeo,
    wireframeMat,
    treeCount,
  );
  wireframeMesh.castShadow = false;
  wireframeMesh.frustumCulled = false;
  wireframeMesh.count = 0;
  wireframeMesh.visible = false;
  group.add(wireframeMesh);

  // ── LOD3 Mega-impostor (single-sprite, beyond lod2Distance) ────────────────
  const compactCenters2 = new Float32Array(treeCount * 4);
  const centersStorage2 = instancedArray(compactCenters2, "vec4").setName(
    "megaCenters",
  );
  const megaMat = createImpostorMaterial(
    colorTex,
    normalTex,
    impostorScale,
    centersStorage2,
    {
      ...iOpts,
      lodDistance: iOpts.lod2Distance,
      mega: true,
      ..._sunOpts,
      lodDistUniform: _uLod2Dist,
      fadeRangeUniform: _uFadeRange,
    },
  );
  const megaMesh = new THREE.InstancedMesh(planeGeo, megaMat, treeCount);
  megaMesh.castShadow = false;
  megaMesh.frustumCulled = false;
  megaMesh.count = 0;
  group.add(megaMesh);

  // ── LOD update ─────────────────────────────────────────────────────────────
  const _compactNear = new Float32Array(treeCount * 16);
  const _cullSphere = new THREE.Sphere(
    new THREE.Vector3(),
    impostorScale * 0.5,
  );

  // LOD overlap zones — mutable so setters can update them at runtime
  let innerDistSq, outerDistSq, inner2DistSq, outer2DistSq;
  function _recomputeThresholds() {
    innerDistSq = (_lodDist - _fadeRange) ** 2;
    outerDistSq = (_lodDist + _fadeRange) ** 2;
    inner2DistSq = (_lod2Dist - _fadeRange) ** 2;
    outer2DistSq = (_lod2Dist + _fadeRange) ** 2;
  }
  _recomputeThresholds();

  let _frameCount = 0;
  // LOD count monitors — updated every frame, read by getLodCounts()
  let _lastNearCount = 0,
    _lastLod1Count = 0,
    _lastLod2Count = 0;

  function update(camera, frustum) {
    // Temporal dithering: advance golden-ratio frame offset for IGN jitter
    _frameCount++;
    uFrameOffset.value = (_frameCount * 0.6180339887) % 1.0;

    const cpx = camera.position.x;
    const cpy = camera.position.y;
    const cpz = camera.position.z;

    let nearCount = 0,
      farCount = 0,
      megaCount = 0;

    for (let i = 0; i < treeCount; i++) {
      // Frustum cull first — skips invisible trees cheaply
      if (frustum) {
        _cullSphere.center.set(posX[i], posY[i], posZ[i]);
        if (!frustum.intersectsSphere(_cullSphere)) continue;
      }

      const dx = posX[i] - cpx,
        dy = posY[i] - cpy,
        dz = posZ[i] - cpz;
      const distSq = dx * dx + dy * dy + dz * dz;

      // LOD0: real model — shown up to (lodDist + fadeRange) for smooth crossfade
      if (distSq < outerDistSq) {
        for (let j = 0; j < 16; j++)
          _compactNear[nearCount * 16 + j] = allNearMats[i * 16 + j];
        nearCount++;
      }

      // LOD1: standard impostor — only before mega starts (no overlap = no double-drawn layer)
      if (distSq >= innerDistSq && distSq < inner2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        impostorMesh.setMatrixAt(farCount, _m);
        compactCenters[farCount * 4] = allCenters[i * 3];
        compactCenters[farCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters[farCount * 4 + 2] = allCenters[i * 3 + 2];
        farCount++;
      }

      // LOD2: mega-impostor (single sprite) — shown from (lod2Dist - fadeRange) outward
      if (distSq >= inner2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        megaMesh.setMatrixAt(megaCount, _m);
        compactCenters2[megaCount * 4] = allCenters[i * 3];
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

    // Wireframe overlay: same count and matrices as LOD1
    wireframeMesh.count = farCount;
    for (let i = 0; i < farCount; i++) {
      impostorMesh.getMatrixAt(i, _m);
      wireframeMesh.setMatrixAt(i, _m);
    }
    wireframeMesh.instanceMatrix.needsUpdate = true;

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
    for (const nm of nearMeshes) {
      nm.geometry.dispose();
      group.remove(nm);
    }
    planeGeo.dispose();
    impostorMat.dispose();
    megaMat.dispose();
    wireframeMat.dispose();
    colorTex.dispose();
    normalTex.dispose();
    group.remove(impostorMesh);
    group.remove(wireframeMesh);
    group.remove(megaMesh);
  }

  return {
    group,
    update,
    dispose,
    impostorMesh,
    // Lighting (instant)
    updateSunDir: (v3) => _uSunDir.value.copy(v3),
    updateSunColor: (v3) => _uSunColor.value.copy(v3),
    updateAmbColor: (v3) => _uAmbColor.value.copy(v3),
    setLightScale: (v) => { _uLightScale.value = v; },
    // LOD distances (instant — updates uniforms + recomputes JS thresholds)
    setLodDistance: (d) => {
      _lodDist = d;
      _uLodDist.value = d;
      _recomputeThresholds();
    },
    setLod2Distance: (d) => {
      _lod2Dist = d;
      _uLod2Dist.value = d;
      _recomputeThresholds();
    },
    setFadeRange: (f) => {
      _fadeRange = f;
      _uFadeRange.value = f;
      _recomputeThresholds();
    },
    // Alpha cutout on impostor materials (instant)
    setAlphaClamp: (v) => {
      impostorMat.alphaTest = v;
      megaMat.alphaTest = v;
    },
    // Debug: show wireframe of impostor plane(s)
    setWireframeVisible: (v) => {
      wireframeMesh.visible = !!v;
    },
    // Per-LOD visibility for debug isolation
    setLodVisible: (tier, v) => {
      if (tier === 0) nearMeshes.forEach((m) => (m.visible = v));
      else if (tier === 1) impostorMesh.visible = v;
      else if (tier === 2) megaMesh.visible = v;
    },
    // Frame counts for monitors
    getLodCounts: () => ({
      near: _lastNearCount,
      lod1: _lastLod1Count,
      lod2: _lastLod2Count,
    }),
  };
}
