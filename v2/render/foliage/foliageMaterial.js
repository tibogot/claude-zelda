/**
 * TSL foliage material for v2 — sphere normals, wind, SSS, rim, AO.
 * One material per tree preset (each has its own leaf texture + colors).
 */
import * as THREE from "three";
import {
  Fn, float, vec3, vec4,
  uniform, attribute,
  texture, uv,
  mix, smoothstep, clamp,
  sin, cos, max, pow, dot, normalize, length, sub, negate,
  positionLocal, positionWorld,
  normalLocal, normalWorld,
  cameraPosition, modelWorldMatrix,
} from "three/tsl";
import { MeshStandardNodeMaterial } from "three";

export function createFoliageMaterial(opts = {}) {
  const u = {
    time:         uniform(0.0),
    yMin:         uniform(opts.yMin ?? 0.0),
    yMax:         uniform(opts.yMax ?? 8.0),
    bottomColor:  uniform(new THREE.Color(opts.bottomColor ?? "#2d5a1b")),
    topColor:     uniform(new THREE.Color(opts.topColor ?? "#5aaa2a")),
    colorVar:     uniform(opts.colorVar ?? 0.12),
    alphaCutoff:  uniform(opts.alphaCutoff ?? 0.45),
    sssColor:     uniform(new THREE.Color(opts.sssColor ?? "#ffee55")),
    sssStr:       uniform(opts.sssStr ?? 0.55),
    sssPow:       uniform(opts.sssPow ?? 2.0),
    rimColor:     uniform(new THREE.Color(opts.rimColor ?? "#c8ffaa")),
    rimStr:       uniform(opts.rimStr ?? 0.38),
    rimPow:       uniform(opts.rimPow ?? 2.5),
    aoStr:        uniform(opts.aoStr ?? 0.45),
    sunDir:       uniform(new THREE.Vector3(5, 12, 4).normalize()),
    windSpeed:    uniform(opts.windSpeed ?? 0.9),
    windStr:      uniform(opts.windStr ?? 0.13),
    windMicro:    uniform(opts.windMicro ?? 0.04),
    canopyCenter: uniform(new THREE.Vector3(0, 4, 0)),
    aoRadius:     uniform(opts.aoRadius ?? 6.0),
    normalBias:   uniform(opts.normalBias ?? 0.75),
    leafWarp:     uniform(opts.leafWarp ?? 0.28),
  };

  const leafTex = new THREE.Texture();
  const leafMapNode = texture(leafTex);

  const aRand = attribute("aRand", "vec2");

  const positionNode = Fn(() => {
    const phase     = aRand.x.mul(6.2832);
    const tipFactor = positionLocal.y.add(0.5);
    const sway      = sin(u.time.mul(u.windSpeed).add(phase)).mul(u.windStr).mul(tipFactor);
    const micro     = sin(u.time.mul(3.1).add(phase.mul(2.6))).mul(u.windMicro).mul(tipFactor);
    const swayZ     = cos(u.time.mul(u.windSpeed.mul(0.8)).add(phase.mul(1.3))).mul(u.windStr.mul(0.5)).mul(tipFactor);
    return positionLocal.add(vec3(sway.add(micro), float(0), swayZ));
  })();

  const wPos = modelWorldMatrix.mul(positionLocal);
  const sphereDir    = normalize(wPos.xyz.sub(u.canopyCenter));
  const warpedNormal = normalize(normalLocal.add(sin(uv().x.mul(10)).mul(u.leafWarp)));
  const finalNormal  = normalize(mix(warpedNormal, sphereDir, u.normalBias));

  const colorNode = Fn(() => {
    const h1 = aRand.x;
    const h2 = aRand.y;
    const heightFactor = clamp(
      positionWorld.y.sub(u.yMin).div(max(u.yMax.sub(u.yMin), float(0.001))),
      float(0), float(1)
    );
    let col = mix(u.bottomColor, u.topColor, heightFactor);
    const varMul = h1.mul(u.colorVar.mul(2.0)).add(float(1.0).sub(u.colorVar));
    col = col.mul(varMul);
    const hueShift = h2.sub(0.5).mul(u.colorVar.mul(0.4));
    col = vec3(col.x.add(hueShift.mul(0.3)), col.y, col.z.sub(hueShift.mul(0.2)));

    const aoHeight = mix(float(1.0).sub(u.aoStr), float(1.0), heightFactor.mul(0.8).add(0.2));
    col = col.mul(aoHeight);

    const distC = clamp(length(sub(positionWorld, u.canopyCenter)).div(max(u.aoRadius, float(0.001))), float(0), float(1));
    const aoSphere = mix(float(1.0).sub(u.aoStr), float(1.0), distC);
    col = col.mul(aoSphere);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const n = normalWorld;
    const backDot = max(dot(negate(u.sunDir), n), float(0));
    const sss = pow(backDot, u.sssPow).mul(u.sssStr);
    col = col.add(u.sssColor.mul(sss));

    const rimDot = float(1.0).sub(max(dot(n, viewDir), float(0)));
    const rim = pow(rimDot, u.rimPow).mul(u.rimStr);
    col = col.add(u.rimColor.mul(rim));

    return clamp(col, float(0), float(2));
  })();

  const opacityNode = Fn(() => {
    const camDist = length(cameraPosition.sub(positionWorld));
    const distFade = clamp(camDist.div(float(150.0)), float(0), float(1));
    const adaptiveCutoff = mix(u.alphaCutoff, float(0.15), distFade);
    return smoothstep(adaptiveCutoff.sub(0.05), adaptiveCutoff.add(0.05), leafMapNode.r);
  })();

  const mat = new MeshStandardNodeMaterial({
    side:        THREE.DoubleSide,
    transparent: false,
    alphaTest:   0.3,
    roughness:   0.88,
    metalness:   0.0,
    depthWrite:  true,
  });
  mat.positionNode = positionNode;
  mat.normalNode   = finalNormal;
  mat.colorNode    = colorNode;
  mat.opacityNode  = opacityNode;
  mat.envMapIntensity = 0;

  mat.castShadowNode = Fn(() => {
    const a = smoothstep(u.alphaCutoff.sub(0.05), u.alphaCutoff.add(0.05), leafMapNode.r);
    a.lessThan(float(0.5)).discard();
    return vec4(0, 0, 0, 1);
  })();

  return { material: mat, uniforms: u, leafMapNode };
}

export function setFoliageTexture(foliageMat, tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  foliageMat.leafMapNode.value = tex;
}

export function applyPresetMaterial(foliageMat, preset) {
  const u = foliageMat.uniforms;
  const m = preset.material || {};
  const w = preset.wind || {};

  if (m.bottomColor) u.bottomColor.value.set(m.bottomColor);
  if (m.topColor)    u.topColor.value.set(m.topColor);
  if (m.colorVar != null)    u.colorVar.value    = m.colorVar;
  if (m.alphaCutoff != null) u.alphaCutoff.value  = m.alphaCutoff;
  if (m.roughness != null)   foliageMat.material.roughness = m.roughness;
  if (m.sssStr != null)      u.sssStr.value       = m.sssStr;
  if (m.sssPow != null)      u.sssPow.value       = m.sssPow;
  if (m.rimStr != null)      u.rimStr.value        = m.rimStr;
  if (m.rimPow != null)      u.rimPow.value        = m.rimPow;
  if (m.aoStr != null)       u.aoStr.value         = m.aoStr;
  if (m.normalBias != null)  u.normalBias.value    = m.normalBias;
  if (m.leafWarp != null)    u.leafWarp.value      = m.leafWarp;

  if (w.windSpeed != null) u.windSpeed.value = w.windSpeed;
  if (w.windStr != null)   u.windStr.value   = w.windStr;
  if (w.windMicro != null) u.windMicro.value = w.windMicro;
}

export function updateFoliageBounds(foliageMat, yMin, yMax, canopyCenter, aoRadius) {
  const u = foliageMat.uniforms;
  u.yMin.value = yMin;
  u.yMax.value = yMax;
  u.canopyCenter.value.copy(canopyCenter);
  u.aoRadius.value = aoRadius;
}
