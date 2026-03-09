/**
 * Bruneton precomputed atmospheric scattering sky for village.html.
 * Uses a separate WebGL2 context and shaders from:
 * https://github.com/jeantimex/precomputed_atmospheric_scattering
 *
 * Coordinate conversion: village uses Y-up, Bruneton shader uses Z-up.
 * We pass camera position and sun direction in Bruneton space:
 *   (x, y, z)_our -> (x, -z, y)_their  so our Y-up becomes their Z-up.
 */

const CDN =
  "https://cdn.jsdelivr.net/gh/jeantimex/precomputed_atmospheric_scattering@main";

const TRANSMITTANCE_W = 256;
const TRANSMITTANCE_H = 64;
const SCATTERING_W = 256;
const SCATTERING_H = 128;
const SCATTERING_D = 32;
const IRRADIANCE_W = 64;
const IRRADIANCE_H = 16;
const kSunAngularRadius = 0.00935 / 2;
const EARTH_RADIUS_KM = 6360;

// Our Y-up -> their Z-up: (x,y,z) -> (x, -z, y)
function toBrunetonVec3(v) {
  return [v.x, -v.z, v.y];
}

function multiply4x4(A, B, out) {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] =
        A[i * 4] * B[j] +
        A[i * 4 + 1] * B[4 + j] +
        A[i * 4 + 2] * B[8 + j] +
        A[i * 4 + 3] * B[12 + j];
    }
  }
}

function invert4x4(m, out) {
  const n11 = m[0], n12 = m[4], n13 = m[8], n14 = m[12];
  const n21 = m[1], n22 = m[5], n23 = m[9], n24 = m[13];
  const n31 = m[2], n32 = m[6], n33 = m[10], n34 = m[14];
  const n41 = m[3], n42 = m[7], n43 = m[11], n44 = m[15];
  const t11 = n23*n34*n42 - n24*n33*n42 + n24*n32*n43 - n22*n34*n43 - n23*n32*n44 + n22*n33*n44;
  const t12 = n14*n33*n42 - n13*n34*n42 - n14*n32*n43 + n12*n34*n43 + n13*n32*n44 - n12*n33*n44;
  const t13 = n13*n24*n42 - n14*n23*n42 + n14*n22*n43 - n12*n24*n43 - n13*n22*n44 + n12*n23*n44;
  const t14 = n14*n23*n32 - n13*n24*n32 - n14*n22*n33 + n12*n24*n33 + n13*n22*n34 - n12*n23*n34;
  const det = n11*t11 + n21*t12 + n31*t13 + n41*t14;
  if (det === 0) return;
  const idet = 1 / det;
  out[0] = t11*idet; out[4] = (n24*n33*n41 - n23*n34*n41 - n24*n31*n43 + n21*n34*n43 + n23*n31*n44 - n21*n33*n44)*idet;
  out[8] = (n22*n34*n41 - n24*n32*n41 + n24*n31*n42 - n21*n34*n42 - n22*n31*n44 + n21*n32*n44)*idet;
  out[12] = (n23*n32*n41 - n22*n33*n41 - n23*n31*n42 + n21*n33*n42 + n22*n31*n43 - n21*n32*n43)*idet;
  out[1] = t12*idet; out[5] = (n13*n34*n41 - n14*n33*n41 + n14*n31*n43 - n11*n34*n43 - n13*n31*n44 + n11*n33*n44)*idet;
  out[9] = (n14*n32*n41 - n12*n34*n41 - n14*n31*n42 + n11*n34*n42 + n12*n31*n44 - n11*n32*n44)*idet;
  out[13] = (n12*n33*n41 - n13*n32*n41 + n13*n31*n42 - n11*n33*n42 - n12*n31*n43 + n11*n32*n43)*idet;
  out[2] = t13*idet; out[6] = (n14*n23*n41 - n13*n24*n41 - n14*n21*n43 + n11*n24*n43 + n13*n21*n44 - n11*n23*n44)*idet;
  out[10] = (n12*n24*n41 - n14*n22*n41 + n14*n21*n42 - n11*n24*n42 - n12*n21*n44 + n11*n22*n44)*idet;
  out[14] = (n13*n22*n41 - n12*n23*n41 - n13*n21*n42 + n11*n23*n42 + n12*n21*n43 - n11*n22*n43)*idet;
  out[3] = t14*idet; out[7] = (n13*n24*n31 - n14*n23*n31 + n14*n21*n33 - n11*n24*n33 - n13*n21*n34 + n11*n23*n34)*idet;
  out[11] = (n14*n22*n31 - n12*n24*n31 - n14*n21*n32 + n11*n24*n32 + n12*n21*n34 - n11*n22*n34)*idet;
  out[15] = (n12*n23*n31 - n13*n22*n31 + n13*n21*n32 - n11*n23*n32 - n12*n21*n33 + n11*n22*n33)*idet;
}

export async function initBrunetonSky(canvas) {
  const gl =
    canvas.getContext("webgl2", {
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true, // required so CanvasTexture can read the canvas after draw
    }) || null;
  if (!gl) return { ready: false, draw: () => {}, resize: () => {} };

  const [vertexSrc, atmosphereSrc, fragmentSrc] = await Promise.all([
    fetch(`${CDN}/webgl/vertex_shader.txt`).then((r) => r.text()),
    fetch(`${CDN}/webgl/atmosphere_shader.txt`).then((r) => r.text()),
    fetch(`${CDN}/webgl/fragment_shader.txt`).then((r) => r.text()),
  ]);
  const fullFragmentSrc = atmosphereSrc + "\n" + fragmentSrc;

  const [transmittanceData, scatteringData, irradianceData] = await Promise.all([
    fetch(`${CDN}/public/assets/transmittance.dat`).then((r) => r.arrayBuffer()),
    fetch(`${CDN}/public/assets/scattering.dat`).then((r) => r.arrayBuffer()),
    fetch(`${CDN}/public/assets/irradiance.dat`).then((r) => r.arrayBuffer()),
  ]);
  const tData = new Float32Array(transmittanceData);
  const sData = new Float32Array(scatteringData);
  const iData = new Float32Array(irradianceData);

  const vert = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vert, vertexSrc);
  gl.compileShader(vert);
  if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
    console.error("Bruneton vertex:", gl.getShaderInfoLog(vert));
    return { ready: false, draw: () => {}, resize: () => {} };
  }

  const frag = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(frag, fullFragmentSrc);
  gl.compileShader(frag);
  if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
    console.error("Bruneton fragment:", gl.getShaderInfoLog(frag));
    return { ready: false, draw: () => {}, resize: () => {} };
  }

  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error("Bruneton link:", gl.getProgramInfoLog(program));
    return { ready: false, draw: () => {}, resize: () => {} };
  }

  // Transmittance (2D)
  const transmittanceTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, transmittanceTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    TRANSMITTANCE_W,
    TRANSMITTANCE_H,
    0,
    gl.RGBA,
    gl.FLOAT,
    tData
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Scattering (3D)
  const scatteringTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, scatteringTex);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGBA32F,
    SCATTERING_W,
    SCATTERING_H,
    SCATTERING_D,
    0,
    gl.RGBA,
    gl.FLOAT,
    sData
  );
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  // Dummy single_mie (1x1x1)
  const mieTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_3D, mieTex);
  const mieData = new Float32Array(4);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGBA32F,
    1,
    1,
    1,
    0,
    gl.RGBA,
    gl.FLOAT,
    mieData
  );
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  // Irradiance (2D)
  const irradianceTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, irradianceTex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA32F,
    IRRADIANCE_W,
    IRRADIANCE_H,
    0,
    gl.RGBA,
    gl.FLOAT,
    iData
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Fullscreen quad (clip space: vec4 x,y,z,w)
  const quadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1, 0, 1, 1, -1, 0, 1, -1, 1, 0, 1,
      -1, 1, 0, 1, 1, -1, 0, 1, 1, 1, 0, 1,
    ]),
    gl.STATIC_DRAW
  );

  const earthCenter = [0, 0, -EARTH_RADIUS_KM];
  const whitePoint = [1, 1, 1];
  const sunSize = [Math.tan(kSunAngularRadius), Math.cos(kSunAngularRadius)];

  const uModelFromView = gl.getUniformLocation(program, "model_from_view");
  const uViewFromClip = gl.getUniformLocation(program, "view_from_clip");
  const uCamera = gl.getUniformLocation(program, "camera");
  const uExposure = gl.getUniformLocation(program, "exposure");
  const uWhitePoint = gl.getUniformLocation(program, "white_point");
  const uEarthCenter = gl.getUniformLocation(program, "earth_center");
  const uSunDirection = gl.getUniformLocation(program, "sun_direction");
  const uSunSize = gl.getUniformLocation(program, "sun_size");

  const Tinv = new Float32Array([
    1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1,
  ]);
  const T = new Float32Array([
    1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1,
  ]);
  const viewInv = new Float32Array(16);
  const projInv = new Float32Array(16);
  const modelFromView = new Float32Array(16);
  const viewFromClip = new Float32Array(16);
  const temp4 = new Float32Array(16);

  function draw(camera, sunDir, exposure) {
    const cam = toBrunetonVec3(camera.position);
    const sun = toBrunetonVec3(sunDir);
    camera.matrixWorldInverse.toArray(viewInv);
    camera.projectionMatrixInverse.toArray(projInv);
    // view_ray = model_from_view * (view_from_clip * vertex). We need view ray in their world space.
    // view_from_clip = projInv (clip -> view dir). Our view -> their world = T * inverse(viewInv).
    invert4x4(viewInv, temp4);
    multiply4x4(T, temp4, modelFromView);
    for (let i = 0; i < 16; i++) viewFromClip[i] = projInv[i];

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(program);

    gl.uniformMatrix4fv(uModelFromView, false, modelFromView);
    gl.uniformMatrix4fv(uViewFromClip, false, viewFromClip);
    gl.uniform3fv(uCamera, cam);
    gl.uniform1f(uExposure, exposure);
    gl.uniform3fv(uWhitePoint, whitePoint);
    gl.uniform3fv(uEarthCenter, earthCenter);
    gl.uniform3fv(uSunDirection, sun);
    gl.uniform2fv(uSunSize, sunSize);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, transmittanceTex);
    gl.uniform1i(gl.getUniformLocation(program, "transmittance_texture"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, scatteringTex);
    gl.uniform1i(gl.getUniformLocation(program, "scattering_texture"), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_3D, mieTex);
    gl.uniform1i(
      gl.getUniformLocation(program, "single_mie_scattering_texture"),
      2
    );
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, irradianceTex);
    gl.uniform1i(gl.getUniformLocation(program, "irradiance_texture"), 3);

    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    const loc = gl.getAttribLocation(program, "vertex");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function resize(w, h) {
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  }

  return {
    ready: true,
    draw,
    resize,
  };
}
