import * as THREE from "three";
import {
  ATLAS_VERT,
  ATLAS_FRAG,
  NORMAL_FRAG,
  AO_FRAG,
  ROUGHNESS_METAL_FRAG,
} from "./shaders.js";
import {
  hemiOctaGridToDir,
  isFlatGeometry,
  computeBoundingSphere,
} from "./geometryHelpers.js";

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

export function bakeAtlas(
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
