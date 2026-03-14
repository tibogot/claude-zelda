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
  sin,
  cos,
  pow,
  smoothstep,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const uFrameOffset = uniform(float(0));
const uWindTime = uniform(float(0));
const uWindStrength = uniform(float(0.3));
const uWindSpeed = uniform(float(1.0));
const uWindDirection = uniform(vec2(1.0, 0.3));

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

const windDisplacement = Fn(([worldPos, heightFactor, seedOffset]) => {
  const windDir = normalize(vec3(uWindDirection.x, 0, uWindDirection.y));
  const phase = add(mul(uWindTime, uWindSpeed), mul(seedOffset, 0.1));
  const wave1 = sin(add(phase, mul(worldPos.x, 0.5)));
  const wave2 = sin(add(mul(phase, 1.3), mul(worldPos.z, 0.4)));
  const wave3 = sin(
    add(mul(phase, 0.7), mul(add(worldPos.x, worldPos.z), 0.3)),
  );
  const combined = mul(add(wave1, add(mul(wave2, 0.5), mul(wave3, 0.3))), 0.55);
  const strength = mul(
    mul(combined, uWindStrength),
    mul(heightFactor, heightFactor),
  );
  return mul(windDir, strength);
});

const _draco = new DRACOLoader();
_draco.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);
const _gltf = new GLTFLoader();
_gltf.setDRACOLoader(_draco);

function hemiOctaGridToDir(gx, gy, out) {
  out.set(gx - gy, 0, -1 + gx + gy);
  out.y = 1 - Math.abs(out.x) - Math.abs(out.z);
  return out.normalize();
}

const _flatBox = new THREE.Box3();
const _flatSz = new THREE.Vector3();
function isFlatGeometry(g) {
  const pos = g.attributes.position;
  if (!pos) return false;
  if (pos.count <= 16) return true;
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

const ATLAS_VERT = /* glsl */ `#version 300 es
in vec3 position; in vec2 uv; in vec3 normal;
uniform mat4 modelViewMatrix, projectionMatrix, modelMatrix;
out vec2 vUv;
out vec3 vWorldNormal;
out vec3 vWorldPos;
void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ATLAS_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map;
uniform float alphaTest;
uniform vec3 uMatColor;
uniform vec3 uSphereCenter;
uniform float uSphereRadius;
in vec2 vUv;
in vec3 vWorldNormal;
in vec3 vWorldPos;
out vec4 outColor;
void main() {
  vec4 c = texture(map, vUv);
  if (c.a < alphaTest) discard;
  c.rgb = pow(max(c.rgb, vec3(0.001)), vec3(2.2));
  c.rgb *= pow(max(uMatColor, vec3(0.001)), vec3(2.2));
  float baseY = uSphereCenter.y - uSphereRadius;
  float yNorm = clamp((vWorldPos.y - baseY) / (uSphereRadius * 0.8), 0.0, 1.0);
  float ao = mix(0.92, 1.0, yNorm);
  outColor = vec4(c.rgb * ao, c.a);
}`;

const NORMAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map; uniform float alphaTest;
in vec2 vUv; in vec3 vWorldNormal;
out vec4 outColor;
void main() {
  if (texture(map, vUv).a < alphaTest) discard;
  outColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
}`;

const AO_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map; uniform float alphaTest;
in vec2 vUv; in vec3 vWorldNormal;
out vec4 outColor;
void main() {
  if (texture(map, vUv).a < alphaTest) discard;
  float n = normalize(vWorldNormal).y;
  float ao = 0.5 + 0.5 * n;
  outColor = vec4(ao, ao, ao, 1.0);
}`;

const ROUGHNESS_METAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map;
uniform sampler2D uRoughnessMap;
uniform sampler2D uMetalnessMap;
uniform float alphaTest;
uniform float uRoughness;
uniform float uMetalness;
in vec2 vUv;
out vec4 outColor;
void main() {
  if (texture(map, vUv).a < alphaTest) discard;
  float r = uRoughness * texture(uRoughnessMap, vUv).g;
  float m = uMetalness * texture(uMetalnessMap, vUv).b;
  outColor = vec4(r, m, 0.0, 1.0);
}`;

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
    sphereMargin = 1.05,
  } = {},
) {
  const N = spritesPerSide;
  const Nm1 = Math.max(1, N - 1);
  const ss = textureSize / N;

  let meshes = [];
  modelScene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const _gc = o.geometry.clone();
    _gc.applyMatrix4(o.matrixWorld);
    if (isFlatGeometry(_gc)) return;
    meshes.push(o);
  });
  if (!meshes.length) throw new Error("[OctahedralImpostor] No meshes to bake");

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

  sphere.radius *= sphereMargin;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = textureSize;
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    preserveDrawingBuffer: true,
  });
  if (!gl) throw new Error("[OctahedralImpostor] WebGL2 unavailable");

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

  const normProg = buildProgram(gl, ATLAS_VERT, NORMAL_FRAG);
  const nPosLoc = gl.getAttribLocation(normProg, "position");
  const nUvLoc = gl.getAttribLocation(normProg, "uv");
  const nNormLoc = gl.getAttribLocation(normProg, "normal");
  const uNMV = gl.getUniformLocation(normProg, "modelViewMatrix");
  const uNProj = gl.getUniformLocation(normProg, "projectionMatrix");
  const uNMod = gl.getUniformLocation(normProg, "modelMatrix");
  const uNMap = gl.getUniformLocation(normProg, "map");
  const uNAlpha = gl.getUniformLocation(normProg, "alphaTest");

  const rmProg = buildProgram(gl, ATLAS_VERT, ROUGHNESS_METAL_FRAG);
  const rPosLoc = gl.getAttribLocation(rmProg, "position");
  const rUvLoc = gl.getAttribLocation(rmProg, "uv");
  const rNormLoc = gl.getAttribLocation(rmProg, "normal");
  const uRMV = gl.getUniformLocation(rmProg, "modelViewMatrix");
  const uRProj = gl.getUniformLocation(rmProg, "projectionMatrix");
  const uRMod = gl.getUniformLocation(rmProg, "modelMatrix");
  const uRMap = gl.getUniformLocation(rmProg, "map");
  const uRRoughMap = gl.getUniformLocation(rmProg, "uRoughnessMap");
  const uRMetalMap = gl.getUniformLocation(rmProg, "uMetalnessMap");
  const uRAlpha = gl.getUniformLocation(rmProg, "alphaTest");
  const uRRoughness = gl.getUniformLocation(rmProg, "uRoughness");
  const uRMetalness = gl.getUniformLocation(rmProg, "uMetalness");

  const aoProg = buildProgram(gl, ATLAS_VERT, AO_FRAG);
  const aPosLoc = gl.getAttribLocation(aoProg, "position");
  const aUvLoc = gl.getAttribLocation(aoProg, "uv");
  const aNormLoc = gl.getAttribLocation(aoProg, "normal");
  const uAMV = gl.getUniformLocation(aoProg, "modelViewMatrix");
  const uAProj = gl.getUniformLocation(aoProg, "projectionMatrix");
  const uAMod = gl.getUniformLocation(aoProg, "modelMatrix");
  const uAMap = gl.getUniformLocation(aoProg, "map");
  const uAAlpha = gl.getUniformLocation(aoProg, "alphaTest");

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
    return own ? t : null;
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
    return own ? t : null;
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

  const rmGLTex = makeGLTex();
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    rmGLTex,
    0,
  );
  (() => {
    gl.useProgram(rmProg);
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
          gl.uniformMatrix4fv(uRMV, false, mv.elements);
          gl.uniformMatrix4fv(uRProj, false, cam.projectionMatrix.elements);
          gl.uniformMatrix4fv(uRMod, false, mesh.matrixWorld.elements);
          gl.uniform1f(uRAlpha, mat.alphaTest > 0 ? mat.alphaTest : alphaTest);
          gl.uniform1f(
            uRRoughness,
            typeof mat.roughness === "number" ? mat.roughness : 0.8,
          );
          gl.uniform1f(
            uRMetalness,
            typeof mat.metalness === "number" ? mat.metalness : 0,
          );
          const white = whiteTexture(gl);
          const toDelete = [];
          let t0 = mat.map?.image ? uploadTex(gl, mat.map.image) : null;
          if (t0) toDelete.push(t0);
          if (!t0) t0 = white;
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, t0);
          gl.uniform1i(uRMap, 0);
          let t1 = mat.roughnessMap?.image
            ? uploadTex(gl, mat.roughnessMap.image)
            : null;
          if (t1) toDelete.push(t1);
          if (!t1) t1 = white;
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, t1);
          gl.uniform1i(uRRoughMap, 1);
          let t2 = mat.metalnessMap?.image
            ? uploadTex(gl, mat.metalnessMap.image)
            : null;
          if (t2) toDelete.push(t2);
          if (!t2) t2 = white;
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, t2);
          gl.uniform1i(uRMetalMap, 2);
          drawMesh(gl, mesh.geometry, rPosLoc, rUvLoc, rNormLoc);
          for (const t of toDelete) gl.deleteTexture(t);
        }
      }
    }
    gl.disable(gl.SCISSOR_TEST);
  })();
  const roughnessMetalPixels = new Uint8Array(textureSize * textureSize * 4);
  gl.readPixels(
    0,
    0,
    textureSize,
    textureSize,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    roughnessMetalPixels,
  );

  const aoGLTex = makeGLTex();
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    aoGLTex,
    0,
  );
  const aoPixels = new Uint8Array(textureSize * textureSize * 4);
  gl.useProgram(aoProg);
  renderSprites(aoProg, aPosLoc, aUvLoc, aNormLoc, (mesh, mat, mv) => {
    gl.uniformMatrix4fv(uAMV, false, mv.elements);
    gl.uniformMatrix4fv(uAProj, false, cam.projectionMatrix.elements);
    gl.uniformMatrix4fv(uAMod, false, mesh.matrixWorld.elements);
    gl.uniform1f(uAAlpha, mat.alphaTest > 0 ? mat.alphaTest : alphaTest);
    let t = null,
      own = false;
    if (mat.map?.image) {
      t = uploadTex(gl, mat.map.image);
      own = !!t;
    }
    if (!t) t = whiteTexture(gl);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(uAMap, 0);
    return own ? t : null;
  });
  gl.readPixels(
    0,
    0,
    textureSize,
    textureSize,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    aoPixels,
  );

  gl.deleteTexture(colGLTex);
  gl.deleteTexture(normGLTex);
  gl.deleteTexture(rmGLTex);
  gl.deleteTexture(aoGLTex);
  gl.deleteRenderbuffer(depthRB);
  gl.deleteFramebuffer(fbo);
  gl.deleteProgram(prog);
  gl.deleteProgram(normProg);
  gl.deleteProgram(rmProg);
  gl.deleteProgram(aoProg);

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
    t.anisotropy = 16;
    t.colorSpace = THREE.LinearSRGBColorSpace;
    return t;
  };
  return {
    colorTex: makeTex(colorPixels),
    normalTex: makeTex(normalPixels),
    roughnessMetalTex: makeTex(roughnessMetalPixels),
    aoTex: makeTex(aoPixels),
    sphere,
  };
}

function createImpostorMaterial(
  atlasTex,
  normalTex,
  roughnessMetalTex,
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
  const uSunDir =
    opts.sunDir ?? uniform(new THREE.Vector3(0.5, 1.0, 0.3).normalize());
  const uSunColor =
    opts.sunColor ?? uniform(new THREE.Vector3(0.85, 0.78, 0.6));
  const uAmbColor = opts.ambColor ?? uniform(new THREE.Vector3(0.35, 0.4, 0.5));
  const uHemiSkyColor =
    opts.hemiSkyColor ?? uniform(new THREE.Vector3(0.4, 0.45, 0.5));
  const uHemiGroundColor =
    opts.hemiGroundColor ?? uniform(new THREE.Vector3(0.25, 0.3, 0.2));
  const uLightScale =
    typeof opts.lightScale === "number"
      ? uniform(float(opts.lightScale))
      : (opts.lightScale ?? uniform(float(1.0)));
  const uNormStr =
    opts.normStrUniform ?? uniform(float(opts.normalStrength ?? 1.0));
  const uRimStrength =
    opts.rimStrengthUniform ?? uniform(float(opts.rimStrength ?? 0.14));
  const uRimPower =
    opts.rimPowerUniform ?? uniform(float(opts.rimPower ?? 3.0));
  const rimColorVec =
    opts.rimColor != null
      ? Array.isArray(opts.rimColor)
        ? new THREE.Vector3(
            opts.rimColor[0],
            opts.rimColor[1],
            opts.rimColor[2],
          )
        : opts.rimColor.clone()
      : new THREE.Vector3(0.4, 0.5, 0.65);
  const uRimColor = opts.rimColorUniform ?? uniform(rimColorVec);
  const uDiffuseWrap =
    opts.diffuseWrapUniform ?? uniform(float(opts.diffuseWrap ?? 0.0));

  const receiveShadow = opts.receiveShadow === true;
  const inLightFactor = float(1).toVar();

  const aoTex = opts.aoTex ?? null;
  const uEnableAO = opts.enableAOUniform ?? uniform(float(0));

  const vWeight = varying(vec4(0, 0, 0, 0), "vWeight");
  const vS1 = varying(vec2(0, 0), "vS1");
  const vS2 = varying(vec2(0, 0), "vS2");
  const vS3 = varying(vec2(0, 0), "vS3");
  const vUV1 = varying(vec2(0, 0), "vUV1");
  const vUV2 = varying(vec2(0, 0), "vUV2");
  const vUV3 = varying(vec2(0, 0), "vUV3");

  const centerNode = centersStorage.element(instanceIndex).xyz;

  const encode = Fn(([dir]) => {
    const s = vec3(sign(dir.x), sign(dir.y), sign(dir.z));
    const d = dot(dir, s);
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

  const planeTangent = Fn(([n]) => {
    const up = mix(
      vec3(0, 1, 0),
      vec3(-1, 0, 0),
      max(float(0), sign(sub(n.y, float(0.999)))),
    );
    return normalize(cross(up, n));
  });
  const planeBitangent = Fn(([n, t]) => cross(n, t));

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

  const planeUV = Fn(([n, t, b, camL, vd]) => {
    const denom = dot(vd, n);
    const tt = mul(dot(negate(camL), n), div(1, denom));
    const hit = add(camL, mul(vd, tt));
    const upInPlane = planeUp(n, t);
    return add(vec2(dot(t, hit), dot(upInPlane, hit)), 0.5);
  });

  const positionNodeFn = Fn(() => {
    const nm1 = vec2(sub(uSPS, float(1)), sub(uSPS, float(1)));
    const center = centerNode;
    const camLocal = mul(sub(cameraPosition, center), div(float(1), uScale));
    const camDir = normalize(camLocal);
    const bv = projectVert(camDir);
    const viewDir = normalize(sub(bv, camLocal));
    const grid = mul(encode(camDir), nm1);
    const gf = min(floor(grid), nm1);
    const frac = fract(grid);

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

    return bv;
  });

  const getUV = Fn(([uvf, frame, fs]) =>
    clamp(mul(fs, add(frame, clamp(vec2(uvf.x, uvf.y), 0, 1))), 0, 1),
  );

  const colorNodeFn = Fn(() => {
    const fs = div(float(1), uSPS);

    const c1 = texture(atlasTex, getUV(vUV1, vS1, fs));
    const c2 = mega ? c1 : texture(atlasTex, getUV(vUV2, vS2, fs));
    const c3 = mega ? c1 : texture(atlasTex, getUV(vUV3, vS3, fs));

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
    let blendedRgb = mul(
      dominantRgb,
      div(float(1), max(dominantAlpha, float(0.001))),
    );
    blendedRgb = saturate(blendedRgb);

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
    const worldNormRaw = normalize(sub(mul(normEnc, float(2.0)), float(1.0)));
    const worldNorm = normalize(mix(vec3(0, 1, 0), worldNormRaw, uNormStr));
    const rm1 = texture(roughnessMetalTex, getUV(vUV1, vS1, fs));
    const rm2 = mega ? rm1 : texture(roughnessMetalTex, getUV(vUV2, vS2, fs));
    const rm3 = mega ? rm1 : texture(roughnessMetalTex, getUV(vUV3, vS3, fs));
    const sampledRoughness = mega
      ? rm1.r
      : select(
          vWeight.x
            .greaterThanEqual(vWeight.y)
            .and(vWeight.x.greaterThanEqual(vWeight.z)),
          rm1.r,
          select(vWeight.y.greaterThanEqual(vWeight.z), rm2.r, rm3.r),
        );
    const sampledMetalness = mega
      ? rm1.g
      : select(
          vWeight.x
            .greaterThanEqual(vWeight.y)
            .and(vWeight.x.greaterThanEqual(vWeight.z)),
          rm1.g,
          select(vWeight.y.greaterThanEqual(vWeight.z), rm2.g, rm3.g),
        );
    const NdotL = max(dot(worldNorm, uSunDir), float(0));
    const NdotLWrap = div(
      add(NdotL, uDiffuseWrap),
      add(float(1), uDiffuseWrap),
    );
    const viewDir = normalize(sub(cameraPosition, positionWorld));
    const NdotV = max(dot(worldNorm, viewDir), float(0.001));
    const halfVec = normalize(add(uSunDir, viewDir));
    const NdotH = max(dot(worldNorm, halfVec), float(0));
    const HdotV = max(dot(halfVec, viewDir), float(0.001));
    const roughnessClamp = max(sampledRoughness, float(0.04));
    const a2 = pow(roughnessClamp, float(4));
    const dNH = add(mul(mul(NdotH, NdotH), sub(a2, float(1))), float(1));
    const D = div(a2, add(mul(float(3.14159), mul(dNH, dNH)), float(0.001)));
    const F0 = mix(vec3(0.04, 0.04, 0.04), blendedRgb, sampledMetalness);
    const F = add(
      F0,
      mul(sub(vec3(1, 1, 1), F0), pow(sub(float(1), HdotV), float(5))),
    );
    const k = div(
      mul(add(roughnessClamp, float(1)), add(roughnessClamp, float(1))),
      float(8),
    );
    const G1V = div(NdotV, add(mul(NdotV, sub(float(1), k)), k));
    const G1L = div(
      NdotL,
      add(mul(NdotL, sub(float(1), k)), add(k, float(0.001))),
    );
    const G = mul(G1V, G1L);
    const specDenom = add(mul(mul(float(4), NdotV), NdotL), float(0.001));
    const specContrib = mul(
      div(mul(mul(D, F), G), specDenom),
      mul(uSunColor, select(NdotL.greaterThan(float(0)), NdotL, float(0))),
    );
    const diffuseContrib = mul(
      mul(sub(float(1), sampledMetalness), NdotLWrap),
      mul(blendedRgb, uSunColor),
    );
    const sunContrib = mul(add(diffuseContrib, specContrib), inLightFactor);
    const hemiT = mul(add(worldNorm.y, 1.0), 0.5);
    const hemiAmbient = add(
      uAmbColor,
      mix(uHemiGroundColor, uHemiSkyColor, hemiT),
    );
    let ambientTerm = mul(hemiAmbient, blendedRgb);
    if (aoTex) {
      const ao1 = texture(aoTex, getUV(vUV1, vS1, fs)).r;
      const ao2 = mega ? ao1 : texture(aoTex, getUV(vUV2, vS2, fs)).r;
      const ao3 = mega ? ao1 : texture(aoTex, getUV(vUV3, vS3, fs)).r;
      const aoFactor = mega
        ? ao1
        : select(
            vWeight.x
              .greaterThanEqual(vWeight.y)
              .and(vWeight.x.greaterThanEqual(vWeight.z)),
            ao1,
            select(vWeight.y.greaterThanEqual(vWeight.z), ao2, ao3),
          );
      const aoMult = mix(float(1), aoFactor, uEnableAO);
      ambientTerm = mul(ambientTerm, aoMult);
    }
    let light = add(sunContrib, ambientTerm);
    const rimFactor = mul(uRimStrength, pow(sub(float(1), NdotV), uRimPower));
    light = add(light, mul(rimFactor, uRimColor));
    light = mul(light, uLightScale);

    const dist = length(sub(centerNode, cameraPosition));
    const fadeT = saturate(
      div(sub(dist, sub(uLodDist, uFadeRange)), uFadeRange),
    );
    const fadeTSoft = smoothstep(float(0.15), float(0.85), fadeT);
    const dither = IGN(screenCoordinate.xy);
    const ditheredAlpha = select(
      dither.greaterThan(fadeTSoft),
      float(0.0),
      dominantAlpha,
    );
    const ramp = smoothstep(sub(uLodDist, uFadeRange), uLodDist, dist);
    const alphaOut = mul(ditheredAlpha, ramp);

    return vec4(saturate(light), alphaOut);
  });

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
  mat.positionNode = positionNodeFn();
  mat.colorNode = colorNodeFn();
  mat.transparent = false;
  mat.alphaTest = alphaClamp;
  mat.depthWrite = true;

  if (receiveShadow) {
    mat.receiveShadow = true;
    mat.shadowPositionNode = Fn(() => positionWorld)();
    mat.receivedShadowNode = Fn(([shadow]) => {
      inLightFactor.assign(shadow.r);
      return float(1);
    })();
  }

  return mat;
}

export async function createOctahedralImpostorForest(opts = {}) {
  const {
    modelPath,
    modelScene: _modelSceneOpt = null,
    treeCount = 300,
    treeScale = 1,
    lodDistance = 80,
    radius = 250,
    minRadius = 30,
    centerPosition = [0, 0, 0],
    getTerrainHeight = null,
    lod0AlphaTest = 0.1,
    impostorSettings = {},
  } = opts;

  const iOpts = {
    spritesPerSide: impostorSettings.spritesPerSide ?? 12,
    textureSize: impostorSettings.textureSize ?? 2048,
    alphaClamp: impostorSettings.alphaClamp ?? 0.1,
    alphaTest: impostorSettings.alphaTest ?? 0.05,
    fadeRange: impostorSettings.fadeRange ?? 8,
    lod2Distance: impostorSettings.lod2Distance ?? 150,
    lightScale: impostorSettings.lightScale ?? 1.0,
    bakeOnlyLargestMesh: impostorSettings.bakeOnlyLargestMesh ?? false,
    sphereMargin: impostorSettings.sphereMargin ?? 1.05,
    normalStrength: impostorSettings.normalStrength ?? 1.0,
    rimStrength: impostorSettings.rimStrength ?? 0.14,
    rimPower: impostorSettings.rimPower ?? 3.0,
    rimColor: impostorSettings.rimColor ?? null,
    diffuseWrap: impostorSettings.diffuseWrap ?? 0.0,
    receiveShadow: impostorSettings.receiveShadow ?? false,
  };

  const _uSunDir = uniform(new THREE.Vector3(-1.0, 0.55, 1.0).normalize());
  const _uSunColor = uniform(new THREE.Vector3(0.85, 0.78, 0.6));
  const _uAmbColor = uniform(new THREE.Vector3(0.35, 0.4, 0.5));
  const _uHemiSkyColor = uniform(new THREE.Vector3(0.4, 0.45, 0.5));
  const _uHemiGroundColor = uniform(new THREE.Vector3(0.25, 0.3, 0.2));

  let _lodDist = lodDistance;
  let _lod2Dist = iOpts.lod2Distance;
  let _fadeRange = iOpts.fadeRange;
  const _uLodDist = uniform(float(_lodDist));
  const _uFadeRange = uniform(float(_fadeRange));
  const _uLod2Dist = uniform(float(_lod2Dist));

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

  const bakeResult = bakeAtlas(root, {
    textureSize: iOpts.textureSize,
    spritesPerSide: iOpts.spritesPerSide,
    alphaTest: iOpts.alphaTest,
    bakeOnlyLargestMesh: iOpts.bakeOnlyLargestMesh,
    sphereMargin: iOpts.sphereMargin,
  });
  const { colorTex, normalTex, roughnessMetalTex, aoTex, sphere } = bakeResult;
  const impostorScale = sphere.radius * 2 * treeScale;
  const sphereCenter = sphere.center.clone().multiplyScalar(treeScale);

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
    if (isFlatGeometry(g)) return;
    const m = o.material;
    const name = (o.name + " " + (m?.name ?? "")).toLowerCase();
    const isLeaf =
      m?.transparent ||
      /leaf|leave|foliage|canopy|frond|branch/i.test(name) ||
      (m?.map && (m?.side === THREE.DoubleSide || m?.alphaTest > 0));
    g.computeBoundingBox();
    const geoMinY = g.boundingBox.min.y;
    const geoMaxY = g.boundingBox.max.y;
    const geoHeight = Math.max(0.1, geoMaxY - geoMinY);

    const nodeMat = new THREE.MeshStandardNodeMaterial({
      color: m?.color?.getHex?.() ?? 0x448833,
      roughness: m?.roughness ?? 0.8,
      metalness: m?.metalness ?? 0,
      map: m?.map ?? null,
      transparent: isLeaf,
      alphaTest: isLeaf ? lod0AlphaTest : 0.5,
      side: isLeaf ? THREE.DoubleSide : (m?.side ?? THREE.FrontSide),
      depthWrite: true,
    });

    if (isLeaf) {
      const uGeoMinY = uniform(float(geoMinY));
      const uGeoHeight = uniform(float(geoHeight));
      nodeMat.positionNode = Fn(() => {
        const heightFactor = saturate(
          div(sub(positionLocal.y, uGeoMinY), uGeoHeight),
        );
        const seedOffset = add(positionWorld.x, positionWorld.z);
        const windOffset = windDisplacement(
          positionWorld,
          heightFactor,
          seedOffset,
        );
        return add(positionLocal, windOffset);
      })();
    }

    const matMap = m?.map ?? null;
    nodeMat.alphaNode = Fn(() => {
      const dist = length(sub(positionWorld, cameraPosition));
      const fadeT = saturate(
        div(sub(add(uNearLodDist, uNearFadeRange), dist), uNearFadeRange),
      );
      const fadeTSoft = smoothstep(float(0.15), float(0.85), fadeT);
      const dither = IGN(screenCoordinate.xy);
      const baseAlpha = matMap ? texture(matMap, uv()).a : float(1.0);
      const ditheredAlpha = select(
        dither.greaterThan(fadeTSoft),
        float(0.0),
        baseAlpha,
      );
      const ramp = sub(
        float(1),
        smoothstep(uNearLodDist, add(uNearLodDist, uNearFadeRange), dist),
      );
      return mul(ditheredAlpha, ramp);
    })();

    if (isLeaf) {
      leafGeos.push(g);
      leafMats.push(nodeMat);
    } else {
      trunkGeos.push(g);
      trunkMats.push(nodeMat);
    }
  });

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

    _m.makeRotationY(Math.random() * Math.PI * 2)
      .scale(_sc)
      .setPosition(x, y, z);
    _m.toArray(allNearMats, i * 16);

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

  const planeGeo = new THREE.PlaneGeometry(1, 1);

  const compactCenters = new Float32Array(treeCount * 4);
  const centersStorage = instancedArray(compactCenters, "vec4").setName(
    "impostorCenters",
  );

  const _uLightScale = uniform(float(iOpts.lightScale ?? 1.0));
  const _uNormStr = uniform(float(iOpts.normalStrength ?? 1.0));
  const _uRimStrength = uniform(float(iOpts.rimStrength ?? 0.14));
  const _uRimPower = uniform(float(iOpts.rimPower ?? 3.0));
  const _rimColorVec =
    iOpts.rimColor != null
      ? Array.isArray(iOpts.rimColor)
        ? new THREE.Vector3(
            iOpts.rimColor[0],
            iOpts.rimColor[1],
            iOpts.rimColor[2],
          )
        : iOpts.rimColor.clone()
      : new THREE.Vector3(0.4, 0.5, 0.65);
  const _uRimColor = uniform(_rimColorVec);
  const _uDiffuseWrap = uniform(float(iOpts.diffuseWrap ?? 0.0));

  const _uEnableAO = uniform(float(iOpts.enableAO ? 1 : 0));

  const _sunOpts = {
    sunDir: _uSunDir,
    sunColor: _uSunColor,
    ambColor: _uAmbColor,
    hemiSkyColor: _uHemiSkyColor,
    hemiGroundColor: _uHemiGroundColor,
    lightScale: _uLightScale,
    normStrUniform: _uNormStr,
    rimStrengthUniform: _uRimStrength,
    rimPowerUniform: _uRimPower,
    rimColorUniform: _uRimColor,
    diffuseWrapUniform: _uDiffuseWrap,
    aoTex,
    enableAOUniform: _uEnableAO,
    enableAO: iOpts.enableAO,
  };
  const impostorMat = createImpostorMaterial(
    colorTex,
    normalTex,
    roughnessMetalTex,
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

  const compactCenters2 = new Float32Array(treeCount * 4);
  const centersStorage2 = instancedArray(compactCenters2, "vec4").setName(
    "megaCenters",
  );
  const megaMat = createImpostorMaterial(
    colorTex,
    normalTex,
    roughnessMetalTex,
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

  const _compactNear = new Float32Array(treeCount * 16);
  const _cullSphere = new THREE.Sphere(
    new THREE.Vector3(),
    impostorScale * 0.5,
  );

  let innerDistSq, outerDistSq, inner2DistSq, outer2DistSq;
  function _recomputeThresholds() {
    innerDistSq = (_lodDist - _fadeRange) ** 2;
    outerDistSq = (_lodDist + _fadeRange) ** 2;
    inner2DistSq = (_lod2Dist - _fadeRange) ** 2;
    outer2DistSq = (_lod2Dist + _fadeRange) ** 2;
  }
  _recomputeThresholds();

  let _frameCount = 0;
  let _lastNearCount = 0,
    _lastLod1Count = 0,
    _lastLod2Count = 0;

  let _lastTime = performance.now();

  function update(camera, frustum) {
    _frameCount++;
    uFrameOffset.value = (_frameCount * 0.6180339887) % 1.0;

    const now = performance.now();
    const dt = (now - _lastTime) / 1000;
    _lastTime = now;
    uWindTime.value += dt;

    const cpx = camera.position.x;
    const cpy = camera.position.y;
    const cpz = camera.position.z;

    let nearCount = 0,
      farCount = 0,
      megaCount = 0;

    for (let i = 0; i < treeCount; i++) {
      if (frustum) {
        _cullSphere.center.set(posX[i], posY[i], posZ[i]);
        if (!frustum.intersectsSphere(_cullSphere)) continue;
      }

      const dx = posX[i] - cpx,
        dy = posY[i] - cpy,
        dz = posZ[i] - cpz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq < outerDistSq) {
        for (let j = 0; j < 16; j++)
          _compactNear[nearCount * 16 + j] = allNearMats[i * 16 + j];
        nearCount++;
      }

      if (distSq >= innerDistSq && distSq < inner2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        impostorMesh.setMatrixAt(farCount, _m);
        compactCenters[farCount * 4] = allCenters[i * 3];
        compactCenters[farCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters[farCount * 4 + 2] = allCenters[i * 3 + 2];
        farCount++;
      }

      if (distSq >= inner2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        megaMesh.setMatrixAt(megaCount, _m);
        compactCenters2[megaCount * 4] = allCenters[i * 3];
        compactCenters2[megaCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters2[megaCount * 4 + 2] = allCenters[i * 3 + 2];
        megaCount++;
      }
    }

    for (const nm of nearMeshes) {
      nm.instanceMatrix.array.set(_compactNear.subarray(0, nearCount * 16));
      nm.count = nearCount;
      nm.instanceMatrix.needsUpdate = true;
    }

    impostorMesh.count = farCount;
    impostorMesh.instanceMatrix.needsUpdate = true;
    centersStorage.value.needsUpdate = true;

    wireframeMesh.count = farCount;
    for (let i = 0; i < farCount; i++) {
      impostorMesh.getMatrixAt(i, _m);
      wireframeMesh.setMatrixAt(i, _m);
    }
    wireframeMesh.instanceMatrix.needsUpdate = true;

    megaMesh.count = megaCount;
    megaMesh.instanceMatrix.needsUpdate = true;
    centersStorage2.value.needsUpdate = true;

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
    roughnessMetalTex.dispose();
    aoTex.dispose();
    group.remove(impostorMesh);
    group.remove(wireframeMesh);
    group.remove(megaMesh);
  }

  return {
    group,
    update,
    dispose,
    impostorMesh,
    updateSunDir: (v3) => _uSunDir.value.copy(v3),
    updateSunColor: (v3) => _uSunColor.value.copy(v3),
    updateAmbColor: (v3) => _uAmbColor.value.copy(v3),
    updateHemiColors: (skyV3, groundV3) => {
      _uHemiSkyColor.value.copy(skyV3);
      _uHemiGroundColor.value.copy(groundV3);
    },
    setLightScale: (v) => {
      _uLightScale.value = v;
    },
    setNormalStrength: (v) => {
      _uNormStr.value = v;
    },
    setRimStrength: (v) => {
      _uRimStrength.value = v;
    },
    setRimPower: (v) => {
      _uRimPower.value = v;
    },
    setRimColor: (r, g, b) => {
      _uRimColor.value.set(r, g, b);
    },
    setDiffuseWrap: (v) => {
      _uDiffuseWrap.value = v;
    },
    setEnableAO: (v) => {
      _uEnableAO.value = v ? 1 : 0;
    },
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
    setAlphaClamp: (v) => {
      impostorMat.alphaTest = v;
      megaMat.alphaTest = v;
    },
    setLod0AlphaTest: (v) => {
      leafMats.forEach((mat) => {
        mat.alphaTest = v;
      });
    },
    setLightScale: (v) => {
      _uLightScale.value = v;
    },
    setWindStrength: (v) => {
      uWindStrength.value = v;
    },
    setWindSpeed: (v) => {
      uWindSpeed.value = v;
    },
    setWindDirection: (x, z) => {
      uWindDirection.value.set(x, z);
    },
    setWireframeVisible: (v) => {
      wireframeMesh.visible = !!v;
    },
    setLodVisible: (tier, v) => {
      if (tier === 0) nearMeshes.forEach((m) => (m.visible = v));
      else if (tier === 1) impostorMesh.visible = v;
      else if (tier === 2) megaMesh.visible = v;
    },
    getLodCounts: () => ({
      near: _lastNearCount,
      lod1: _lastLod1Count,
      lod2: _lastLod2Count,
    }),
  };
}
