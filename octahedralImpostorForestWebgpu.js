/**
 * Forest LOD using WebGPU-baked octahedral atlases (editor pipeline: RM + depth + padded cells).
 * Same layout as octahedralImpostor2.js createOctahedralImpostorForest — near mesh / impostor / mega.
 */
import * as THREE from "three";
import {
  Fn,
  normalize,
  sub,
  mul,
  add,
  div,
  abs,
  vec2,
  vec3,
  vec4,
  sign,
  dot,
  cross,
  floor,
  fract,
  min,
  max,
  clamp,
  saturate,
  texture,
  cameraPosition,
  positionWorld,
  positionView,
  positionLocal,
  float,
  uniform,
  varying,
  select,
  length,
  negate,
  mix,
  smoothstep,
  fwidth,
  pow,
  sin,
  instancedArray,
  instanceIndex,
  screenCoordinate,
  normalWorld,
  uv,
  shadowPositionWorld,
  lightShadowMatrix,
  reference,
  renderGroup,
  BasicShadowFilter,
  PCFShadowFilter,
  PCFSoftShadowFilter,
} from "three/tsl";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  bakeAtlases,
  BAKE_SPHERE_MARGIN,
} from "./octahedral-impostor-webgpu-atlas.js";

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

function extractBakeData(obj) {
  const data = [];
  obj.updateMatrixWorld(true);
  obj.traverse((child) => {
    if (!child.isMesh) return;
    const geo = child.geometry.clone();
    geo.applyMatrix4(child.matrixWorld);
    if (isFlatGeometry(geo)) return;
    const mat = Array.isArray(child.material)
      ? child.material[0]
      : child.material;
    if (!mat) return;
    data.push({ geometry: geo, material: mat });
  });
  return data;
}

const _draco = new DRACOLoader();
_draco.setDecoderPath(
  "https://www.gstatic.com/draco/versioned/decoders/1.5.6/",
);
const _gltf = new GLTFLoader();
_gltf.setDRACOLoader(_draco);

function directionalShadowVisibility(dirLight, depthTexNode, filterFn) {
  const sh = dirLight.shadow;
  const normalBias = reference("normalBias", "float", sh).setGroup(renderGroup);
  const bias = reference("bias", "float", sh).setGroup(renderGroup);

  const biasedWorld = add(shadowPositionWorld, mul(normalWorld, normalBias));
  const clip = lightShadowMatrix(dirLight).mul(vec4(biasedWorld, float(1)));
  const ndc = div(clip.xyz, clip.w);
  const coordZ = ndc.z;
  const shadowCoord = vec3(
    ndc.x,
    sub(float(1), ndc.y),
    add(coordZ, bias),
  );

  const frustumTest = shadowCoord.x
    .greaterThanEqual(float(0))
    .and(shadowCoord.x.lessThanEqual(float(1)))
    .and(shadowCoord.y.greaterThanEqual(float(0)))
    .and(shadowCoord.y.lessThanEqual(float(1)))
    .and(shadowCoord.z.lessThanEqual(float(1)));

  const raw = filterFn({
    depthTexture: depthTexNode,
    shadowCoord,
    shadow: sh,
    depthLayer: 0,
  });
  const shadowIntensity = reference("intensity", "float", sh).setGroup(renderGroup);
  const filtered = frustumTest.select(raw, float(1));
  return mix(float(1), filtered, shadowIntensity);
}

/**
 * Instanced impostor: per-instance center in storage buffer; padded atlas + depth parallax + LOD fade.
 */
function createForestImpostorMaterial(
  colorTex,
  normalTex,
  rmTex,
  depthTex,
  impostorScale,
  gridVal,
  atlasSize,
  cellPad,
  centersStorage,
  dirLight,
  renderer,
  opts = {},
) {
  const mega = opts.mega === true;
  const lodDistance = opts.lodDistance ?? 80;
  const fadeRange = opts.fadeRange ?? 8;

  const uSPS = uniform(float(gridVal));
  const uScale = uniform(float(impostorScale));
  const uLodDist = opts.lodDistUniform ?? uniform(float(lodDistance));
  const uFadeRange = opts.fadeRangeUniform ?? uniform(float(fadeRange));
  const uMega = uniform(float(mega ? 1 : 0));

  const uSunDir =
    opts.sunDir ?? uniform(new THREE.Vector3(0.5, 1.0, 0.3).normalize());
  const uSunColor =
    opts.sunColor ?? uniform(new THREE.Vector3(0.85, 0.78, 0.6));
  const uAmbColor = opts.ambColor ?? uniform(new THREE.Vector3(0.35, 0.4, 0.5));
  const uHemiSkyColor =
    opts.hemiSkyColor ?? uniform(new THREE.Vector3(0.4, 0.45, 0.5));
  const uHemiGroundColor =
    opts.hemiGroundColor ?? uniform(new THREE.Vector3(0.25, 0.3, 0.2));
  const uLightScale = opts.lightScale ?? uniform(float(1.0));
  const uNormStr =
    opts.normStrUniform ?? uniform(float(opts.normalStrength ?? 1.0));
  const uRimStr =
    opts.rimStrengthUniform ?? uniform(float(opts.rimStrength ?? 0.14));
  const uRimPow =
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
  const uRimCol = opts.rimColorUniform ?? uniform(rimColorVec);
  const uDiffuseWrap =
    opts.diffuseWrapUniform ?? uniform(float(opts.diffuseWrap ?? 0.0));
  const uEdgeSmoothScale =
    opts.edgeSmoothUniform ?? uniform(float(opts.edgeSmoothScale ?? 1.5));
  const uAlphaClamp =
    opts.alphaClampUniform ?? uniform(float(opts.alphaClamp ?? 0.1));
  const uParallaxStr =
    opts.parallaxStrUniform ?? uniform(float(opts.parallaxStrength ?? 0.12));
  const uLodDither =
    opts.lodDitherUniform ?? uniform(float(opts.lodDither ?? 0));

  const uFogNear = opts.fogNearUniform ?? uniform(float(1e9));
  const uFogFar = opts.fogFarUniform ?? uniform(float(1e9));
  const uFogColor =
    opts.fogColorUniform ??
    uniform(new THREE.Vector3(0.5, 0.65, 0.85));
  const uFogStrength = opts.fogStrengthUniform ?? uniform(float(0));

  const uCellFrac = uniform(float(1 / gridVal));
  const uPadFrac = uniform(float(cellPad / atlasSize));
  const uInnerFrac = uniform(
    float(1 / gridVal - (2 * cellPad) / atlasSize),
  );

  const centerNode = centersStorage.element(instanceIndex).xyz;

  const vWeight = varying(vec4(0, 0, 0, 0), "vWW");
  const vS1 = varying(vec2(0, 0), "vWS1");
  const vS2 = varying(vec2(0, 0), "vWS2");
  const vS3 = varying(vec2(0, 0), "vWS3");
  const vUV1 = varying(vec2(0, 0), "vWUV1");
  const vUV2 = varying(vec2(0, 0), "vWUV2");
  const vUV3 = varying(vec2(0, 0), "vWUV3");

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
      vec3(0, 1, 0),
      vec3(-1, 0, 0),
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
    return add(vec2(dot(t, hit), dot(upP, hit)), float(0.5));
  });

  const posNodeFn = Fn(() => {
    const nm1 = vec2(sub(uSPS, 1), sub(uSPS, 1));
    const center = centerNode;
    const camLocal = mul(sub(cameraPosition, center), div(1, uScale));
    const faceDir = normalize(camLocal);
    const bv = projectVert(faceDir);
    const viewDir = normalize(sub(bv, camLocal));

    const grid = mul(encode(faceDir), nm1);
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
    vS1.assign(s1);
    vS2.assign(s2);
    vS3.assign(s3);

    const pn1 = decode(s1, nm1);
    const pt1 = planeTangent(pn1);
    const pn2 = decode(s2, nm1);
    const pt2 = planeTangent(pn2);
    const pn3 = decode(s3, nm1);
    const pt3 = planeTangent(pn3);
    vUV1.assign(planeUV(pn1, pt1, camLocal, viewDir));
    vUV2.assign(planeUV(pn2, pt2, camLocal, viewDir));
    vUV3.assign(planeUV(pn3, pt3, camLocal, viewDir));

    return bv;
  });

  const getUV = Fn(([uvf, frame]) => {
    const clamped = clamp(vec2(uvf.x, uvf.y), float(0), float(1));
    return add(mul(frame, uCellFrac), add(uPadFrac, mul(clamped, uInnerFrac)));
  });

  const depthParallax = Fn(([localUV, cellNorm, frame]) => {
    const baseAtlasUV = getUV(localUV, frame);
    const d = texture(depthTex, baseAtlasUV).r;
    const relD = sub(float(0.5), d);
    const V = normalize(sub(cameraPosition, positionWorld));
    const T = planeTangent(cellNorm);
    const B = planeUp(cellNorm, T);
    const VdotN = max(dot(V, cellNorm), float(0.3));
    const off = mul(
      vec2(dot(V, T), dot(V, B)),
      div(mul(relD, uParallaxStr), VdotN),
    );
    return getUV(add(localUV, off), frame);
  });

  const phDepth = new THREE.DepthTexture(4, 4);
  phDepth.compareFunction = THREE.LessEqualCompare;
  const uShadowMapDepth = texture(phDepth);

  let shadowFilterFn = PCFSoftShadowFilter;
  const smt = renderer.shadowMap.type;
  if (smt === THREE.BasicShadowMap) shadowFilterFn = BasicShadowFilter;
  else if (smt === THREE.PCFShadowMap) shadowFilterFn = PCFShadowFilter;

  const sunShadow = directionalShadowVisibility(
    dirLight,
    uShadowMapDepth,
    shadowFilterFn,
  );

  const colorNodeFn = Fn(() => {
    const nm1_f = vec2(sub(uSPS, 1), sub(uSPS, 1));

    const cn1 = decode(vS1, nm1_f);
    const cn2 = decode(vS2, nm1_f);
    const cn3 = decode(vS3, nm1_f);

    const puv1 = depthParallax(vUV1, cn1, vS1);
    const puv2 = depthParallax(vUV2, cn2, vS2);
    const puv3 = depthParallax(vUV3, cn3, vS3);

    const c1 = texture(colorTex, puv1);
    const c2 = texture(colorTex, puv2);
    const c3 = texture(colorTex, puv3);

    const isDom1 = vWeight.x
      .greaterThanEqual(vWeight.y)
      .and(vWeight.x.greaterThanEqual(vWeight.z));
    const isDom2 = vWeight.y.greaterThanEqual(vWeight.z);

    const domAlpha = select(
      uMega.greaterThan(float(0.5)),
      c1.a,
      select(isDom1, c1.a, select(isDom2, c2.a, c3.a)),
    );
    const domRgb = select(
      uMega.greaterThan(float(0.5)),
      c1.rgb,
      select(isDom1, c1.rgb, select(isDom2, c2.rgb, c3.rgb)),
    );

    const edgeW = mul(fwidth(domAlpha), uEdgeSmoothScale);
    const smoothedAlpha = smoothstep(
      sub(uAlphaClamp, edgeW),
      add(uAlphaClamp, edgeW),
      domAlpha,
    );
    const albedo = saturate(mul(domRgb, div(1, max(domAlpha, float(0.001)))));

    const n1 = texture(normalTex, puv1).xyz;
    const n2 = texture(normalTex, puv2).xyz;
    const n3 = texture(normalTex, puv3).xyz;
    const normEnc = select(
      uMega.greaterThan(float(0.5)),
      n1,
      select(isDom1, n1, select(isDom2, n2, n3)),
    );
    const wNormRaw = normalize(sub(mul(normEnc, 2.0), 1.0));
    const wNorm = normalize(mix(vec3(0, 1, 0), wNormRaw, uNormStr));

    const rm1 = texture(rmTex, puv1);
    const rm2 = texture(rmTex, puv2);
    const rm3 = texture(rmTex, puv3);
    const rmSel = select(
      uMega.greaterThan(float(0.5)),
      rm1,
      select(isDom1, rm1, select(isDom2, rm2, rm3)),
    );
    const rough = clamp(rmSel.x, float(0.05), float(1));
    const metal = clamp(rmSel.y, float(0), float(1));
    const oneMinusMetal = sub(float(1), metal);

    const INV_PI = float(0.31831);
    const viewDir = normalize(sub(cameraPosition, positionWorld));
    const rawNdotL = dot(wNorm, uSunDir);
    const NdotL = max(rawNdotL, float(0));
    const NdotLWrap = div(
      add(NdotL, uDiffuseWrap),
      add(float(1), uDiffuseWrap),
    );
    const NdotV = max(dot(wNorm, viewDir), float(0.001));

    const diffuse = mul(
      mul(mul(mul(NdotLWrap, INV_PI), oneMinusMetal), albedo),
      uSunColor,
    );

    const H = normalize(add(uSunDir, viewDir));
    const NdotH = max(dot(wNorm, H), float(0));
    const HdotV = max(dot(H, viewDir), float(0.001));
    const a2 = pow(rough, float(4));
    const dNH = add(mul(mul(NdotH, NdotH), sub(a2, 1)), 1);
    const D = div(a2, add(mul(float(3.14159), mul(dNH, dNH)), float(0.001)));
    const F0 = mix(vec3(0.04, 0.04, 0.04), albedo, metal);
    const F = add(
      F0,
      mul(sub(vec3(1, 1, 1), F0), pow(sub(1, HdotV), float(5))),
    );
    const k = div(mul(add(rough, 1), add(rough, 1)), 8);
    const G1V = div(NdotV, add(mul(NdotV, sub(1, k)), k));
    const G1L = div(NdotL, add(mul(NdotL, sub(1, k)), add(k, float(0.001))));
    const spec = mul(
      div(
        mul(mul(D, F), mul(G1V, G1L)),
        add(mul(mul(4, NdotV), NdotL), float(0.001)),
      ),
      mul(uSunColor, max(NdotL, float(0))),
    );

    const hemiT = mul(add(wNorm.y, 1.0), 0.5);
    const hemiIrrad = add(uAmbColor, mix(uHemiGroundColor, uHemiSkyColor, hemiT));
    const ambient = mul(mul(mul(hemiIrrad, INV_PI), oneMinusMetal), albedo);

    const oneMinusRough = sub(float(1), rough);
    const maxSmooth = max(
      vec3(oneMinusRough, oneMinusRough, oneMinusRough),
      F0,
    );
    const envF = add(
      F0,
      mul(sub(maxSmooth, F0), pow(sub(float(1), NdotV), float(5))),
    );
    const envColor = mix(uHemiGroundColor, uHemiSkyColor, hemiT);
    const indirectSpec = mul(envF, envColor);

    const rim = mul(mul(uRimStr, pow(sub(1, NdotV), uRimPow)), uRimCol);
    const sunLit = add(diffuse, spec);
    const shadowedSun = mul(sunLit, sunShadow);
    let lit = add(add(add(shadowedSun, ambient), indirectSpec), rim);
    lit = mul(lit, uLightScale);

    const dist = length(sub(centerNode, cameraPosition));
    const wImpCross = smoothstep(
      sub(uLodDist, uFadeRange),
      add(uLodDist, uFadeRange),
      dist,
    );
    const smoothAlphaOut = mul(smoothedAlpha, wImpCross);

    const fadeT = saturate(
      div(sub(dist, sub(uLodDist, uFadeRange)), uFadeRange),
    );
    const fadeTSoft = smoothstep(float(0.15), float(0.85), fadeT);
    const dither = IGN(screenCoordinate.xy);
    const ditheredAlpha = select(
      dither.greaterThan(fadeTSoft),
      float(0.0),
      smoothedAlpha,
    );
    const rampLegacy = smoothstep(sub(uLodDist, uFadeRange), uLodDist, dist);
    const legacyAlphaOut = mul(ditheredAlpha, rampLegacy);

    const alphaOut = mix(smoothAlphaOut, legacyAlphaOut, uLodDither);

    const fogDepth = negate(positionView.z);
    const fogT = smoothstep(uFogNear, uFogFar, fogDepth);
    const fogMix = mul(fogT, uFogStrength);
    const litRgb = mix(saturate(lit), uFogColor, fogMix);

    return vec4(litRgb, alphaOut);
  });

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
  mat.positionNode = posNodeFn();
  mat.colorNode = colorNodeFn();
  mat.transparent = false;
  mat.alphaTest = 0.005;
  mat.depthWrite = true;
  mat.receiveShadow = true;
  mat.receivedShadowPositionNode = Fn(() => positionWorld)();

  return {
    mat,
    uShadowMapDepth,
    uSunDir,
    uSunColor,
    uAmbColor,
    uHemiSkyColor,
    uHemiGroundColor,
    uLightScale,
    uNormStr,
    uRimStr,
    uRimPow,
    uRimCol,
    uDiffuseWrap,
    uAlphaClamp,
    uEdgeSmoothScale,
    uParallaxStr,
    uLodDist,
    uFadeRange,
    uMega,
    uLodDither,
    uFogNear,
    uFogFar,
    uFogColor,
    uFogStrength,
  };
}

export async function createOctahedralImpostorForestWebgpu(
  renderer,
  dirLight,
  opts = {},
) {
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
    cellPad = 2,
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
    normalStrength: impostorSettings.normalStrength ?? 1.0,
    rimStrength: impostorSettings.rimStrength ?? 0.14,
    rimPower: impostorSettings.rimPower ?? 3.0,
    rimColor: impostorSettings.rimColor ?? null,
    diffuseWrap: impostorSettings.diffuseWrap ?? 0.0,
    edgeSmoothScale: impostorSettings.edgeSmoothScale ?? 1.5,
    parallaxStrength: impostorSettings.parallaxStrength ?? 0.12,
    lodDither: impostorSettings.lodDither ?? 0,
    fogNear: impostorSettings.fogNear ?? 28,
    fogFar: impostorSettings.fogFar ?? 170,
    fogEnabled: impostorSettings.fogEnabled !== false,
    fogColor: impostorSettings.fogColor ?? 0x87ceeb,
  };

  const grid = iOpts.spritesPerSide;
  const atlasSize = iOpts.textureSize;

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

  let bakeMeshData = extractBakeData(root);
  if (!bakeMeshData.length) throw new Error("[ForestWebGPU] No meshes to bake");

  if (iOpts.bakeOnlyLargestMesh && bakeMeshData.length > 1) {
    let best = null;
    let bestVol = 0;
    for (const entry of bakeMeshData) {
      entry.geometry.computeBoundingSphere();
      const v = entry.geometry.boundingSphere.radius ** 3;
      if (v > bestVol) {
        bestVol = v;
        best = entry;
      }
    }
    for (const e of bakeMeshData) {
      if (e !== best) e.geometry.dispose();
    }
    bakeMeshData = [best];
  }

  const cap = renderer.capabilities;
  const maxAniso =
    cap && typeof cap.getMaxAnisotropy === "function"
      ? cap.getMaxAnisotropy()
      : (cap?.maxAnisotropy ?? 8);
  const atlasResult = await bakeAtlases(renderer, bakeMeshData, {
    grid,
    atlasSize,
    maxAniso,
    cellPad,
  });

  const bakeR = atlasResult.radius;
  const sphereCenter = atlasResult.center.clone().multiplyScalar(treeScale);
  const impostorScale = bakeR * 2 * treeScale;
  const groundLift = bakeR * treeScale * (1 - 1 / BAKE_SPHERE_MARGIN);

  const uNearLodDist = uniform(float(lodDistance));
  const uNearFadeRange = uniform(float(iOpts.fadeRange));
  const _uLodDither = uniform(float(iOpts.lodDither));

  const leafGeos = [];
  const leafMats = [];
  const trunkGeos = [];
  const trunkMats = [];

  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    if (isFlatGeometry(g)) return;
    const m = o.material;
    const mat0 = Array.isArray(m) ? m[0] : m;
    const name = (o.name + " " + (mat0?.name ?? "")).toLowerCase();
    const isLeaf =
      mat0?.transparent ||
      /leaf|leave|foliage|canopy|frond|branch/i.test(name) ||
      (mat0?.map &&
        (mat0?.side === THREE.DoubleSide || mat0?.alphaTest > 0));

    g.computeBoundingBox();
    const geoMinY = g.boundingBox.min.y;
    const geoMaxY = g.boundingBox.max.y;
    const geoHeight = Math.max(0.1, geoMaxY - geoMinY);

    const nodeMat = new THREE.MeshStandardNodeMaterial({
      color: mat0?.color?.getHex?.() ?? 0x448833,
      roughness: mat0?.roughness ?? 0.8,
      metalness: mat0?.metalness ?? 0,
      map: mat0?.map ?? null,
      transparent: isLeaf,
      alphaTest: isLeaf ? lod0AlphaTest : 0.5,
      side: isLeaf ? THREE.DoubleSide : (mat0?.side ?? THREE.FrontSide),
      depthWrite: true,
    });
    nodeMat.fog = true;

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

    const matMap = mat0?.map ?? null;
    nodeMat.alphaNode = Fn(() => {
      const dist = length(sub(positionWorld, cameraPosition));
      const wImp = smoothstep(
        sub(uNearLodDist, uNearFadeRange),
        add(uNearLodDist, uNearFadeRange),
        dist,
      );
      const wMesh = sub(float(1), wImp);
      const baseAlpha = matMap ? texture(matMap, uv()).a : float(1.0);
      const smoothA = mul(baseAlpha, wMesh);

      const fadeT = saturate(
        div(sub(add(uNearLodDist, uNearFadeRange), dist), uNearFadeRange),
      );
      const fadeTSoft = smoothstep(float(0.15), float(0.85), fadeT);
      const dither = IGN(screenCoordinate.xy);
      const ditheredAlpha = select(
        dither.greaterThan(fadeTSoft),
        float(0.0),
        baseAlpha,
      );
      const ramp = sub(
        float(1),
        smoothstep(uNearLodDist, add(uNearLodDist, uNearFadeRange), dist),
      );
      const legacyA = mul(ditheredAlpha, ramp);

      return mix(smoothA, legacyA, _uLodDither);
    })();

    if (isLeaf) {
      leafGeos.push(g);
      leafMats.push(nodeMat);
    } else {
      trunkGeos.push(g);
      trunkMats.push(nodeMat);
    }
  });

  const cx0 = centerPosition[0];
  const cz0 = centerPosition[2];
  const posX = new Float32Array(treeCount);
  const posY = new Float32Array(treeCount);
  const posZ = new Float32Array(treeCount);
  const allNearMats = new Float32Array(treeCount * 16);
  const allImpostorMats = new Float32Array(treeCount * 16);
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
    const wcy = y + sphereCenter.y + groundLift;
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
    "impostorCentersW",
  );

  const _uLightScale = uniform(float(iOpts.lightScale));
  const _uNormStr = uniform(float(iOpts.normalStrength));
  const _uRimStrength = uniform(float(iOpts.rimStrength));
  const _uRimPower = uniform(float(iOpts.rimPower));
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
  const _uDiffuseWrap = uniform(float(iOpts.diffuseWrap));
  const _uEdgeSmoothScale = uniform(float(iOpts.edgeSmoothScale));
  const _uAlphaClamp = uniform(float(iOpts.alphaClamp));
  const _uParallaxStr = uniform(float(iOpts.parallaxStrength));

  const _initFogColor = new THREE.Color(iOpts.fogColor);
  const _uFogNear = uniform(float(iOpts.fogNear));
  const _uFogFar = uniform(
    float(Math.max(iOpts.fogFar, iOpts.fogNear + 0.5)),
  );
  const _uFogColor = uniform(
    new THREE.Vector3(_initFogColor.r, _initFogColor.g, _initFogColor.b),
  );
  const _uFogStrength = uniform(float(iOpts.fogEnabled ? 1 : 0));

  const sunOpts = {
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
    edgeSmoothUniform: _uEdgeSmoothScale,
    alphaClampUniform: _uAlphaClamp,
    parallaxStrUniform: _uParallaxStr,
    fogNearUniform: _uFogNear,
    fogFarUniform: _uFogFar,
    fogColorUniform: _uFogColor,
    fogStrengthUniform: _uFogStrength,
    rimColor: iOpts.rimColor,
    diffuseWrap: iOpts.diffuseWrap,
    parallaxStrength: iOpts.parallaxStrength,
  };

  const impostorPack = createForestImpostorMaterial(
    atlasResult.colorTex,
    atlasResult.normalTex,
    atlasResult.rmTex,
    atlasResult.depthTex,
    impostorScale,
    grid,
    atlasSize,
    cellPad,
    centersStorage,
    dirLight,
    renderer,
    {
      ...sunOpts,
      lodDistance,
      lodDistUniform: _uLodDist,
      fadeRangeUniform: _uFadeRange,
      lodDitherUniform: _uLodDither,
      mega: false,
    },
  );
  const impostorMat = impostorPack.mat;
  impostorMat.fog = false;

  const impostorMesh = new THREE.InstancedMesh(
    planeGeo,
    impostorMat,
    treeCount,
  );
  impostorMesh.castShadow = false;
  impostorMesh.frustumCulled = false;
  impostorMesh.count = 0;
  group.add(impostorMesh);

  const compactCenters2 = new Float32Array(treeCount * 4);
  const centersStorage2 = instancedArray(compactCenters2, "vec4").setName(
    "megaCentersW",
  );

  const megaPack = createForestImpostorMaterial(
    atlasResult.colorTex,
    atlasResult.normalTex,
    atlasResult.rmTex,
    atlasResult.depthTex,
    impostorScale,
    grid,
    atlasSize,
    cellPad,
    centersStorage2,
    dirLight,
    renderer,
    {
      ...sunOpts,
      lodDistance: iOpts.lod2Distance,
      lodDistUniform: _uLod2Dist,
      fadeRangeUniform: _uFadeRange,
      lodDitherUniform: _uLodDither,
      mega: true,
    },
  );
  const megaMat = megaPack.mat;
  megaMat.fog = false;

  const megaMesh = new THREE.InstancedMesh(planeGeo, megaMat, treeCount);
  megaMesh.castShadow = false;
  megaMesh.frustumCulled = false;
  megaMesh.count = 0;
  group.add(megaMesh);

  const _compactNear = new Float32Array(treeCount * 16);
  const _cullSphere = new THREE.Sphere(new THREE.Vector3(), impostorScale * 0.5);

  let innerDistSq, outerDistSq, inner2DistSq, outer2DistSq;
  function _recomputeThresholds() {
    innerDistSq = (_lodDist - _fadeRange) ** 2;
    outerDistSq = (_lodDist + _fadeRange) ** 2;
    inner2DistSq = (_lod2Dist - _fadeRange) ** 2;
    outer2DistSq = (_lod2Dist + _fadeRange) ** 2;
  }
  _recomputeThresholds();

  let _frameCount = 0;
  let _lastNearCount = 0;
  let _lastLod1Count = 0;
  let _lastLod2Count = 0;
  let _lastTime = performance.now();

  function syncShadowMaps() {
    const smDt = dirLight.shadow.map?.depthTexture;
    if (smDt) {
      impostorPack.uShadowMapDepth.value = smDt;
      megaPack.uShadowMapDepth.value = smDt;
    }
  }

  function update(camera, frustum) {
    _frameCount++;
    uFrameOffset.value = (_frameCount * 0.6180339887) % 1.0;

    const now = performance.now();
    const dt = (now - _lastTime) / 1000;
    _lastTime = now;
    uWindTime.value += dt;

    syncShadowMaps();

    const cpx = camera.position.x;
    const cpy = camera.position.y;
    const cpz = camera.position.z;

    let nearCount = 0;
    let farCount = 0;
    let megaCount = 0;

    for (let i = 0; i < treeCount; i++) {
      if (frustum) {
        _cullSphere.center.set(posX[i], posY[i], posZ[i]);
        if (!frustum.intersectsSphere(_cullSphere)) continue;
      }

      const dx = posX[i] - cpx;
      const dy = posY[i] - cpy;
      const dz = posZ[i] - cpz;
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
        compactCenters[farCount * 4 + 3] = 0;
        farCount++;
      }

      if (distSq >= inner2DistSq) {
        _m.fromArray(allImpostorMats, i * 16);
        megaMesh.setMatrixAt(megaCount, _m);
        compactCenters2[megaCount * 4] = allCenters[i * 3];
        compactCenters2[megaCount * 4 + 1] = allCenters[i * 3 + 1];
        compactCenters2[megaCount * 4 + 2] = allCenters[i * 3 + 2];
        compactCenters2[megaCount * 4 + 3] = 0;
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
    impostorMat.dispose();
    megaMat.dispose();
    atlasResult.colorTex.dispose();
    atlasResult.normalTex.dispose();
    atlasResult.rmTex.dispose();
    atlasResult.depthTex.dispose();
    group.remove(impostorMesh);
    group.remove(megaMesh);
    planeGeo.dispose();
  }

  return {
    group,
    update,
    dispose,
    impostorMesh,
    syncShadowMaps,
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
    setLodDistance: (d) => {
      _lodDist = d;
      _uLodDist.value = d;
      uNearLodDist.value = d;
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
      uNearFadeRange.value = f;
      _recomputeThresholds();
    },
    setLodDither: (v) => {
      _uLodDither.value = v;
    },
    setAlphaClamp: (v) => {
      _uAlphaClamp.value = v;
    },
    setEdgeSmoothScale: (v) => {
      _uEdgeSmoothScale.value = v;
    },
    setParallaxStrength: (v) => {
      _uParallaxStr.value = v;
    },
    setFog: (o) => {
      if (o == null) return;
      if (o.near != null) {
        _uFogNear.value = o.near;
        if (_uFogFar.value <= _uFogNear.value)
          _uFogFar.value = _uFogNear.value + 0.5;
      }
      if (o.far != null)
        _uFogFar.value = Math.max(o.far, _uFogNear.value + 0.5);
      if (o.strength != null) _uFogStrength.value = o.strength;
      if (o.color != null && o.color.isColor)
        _uFogColor.value.set(o.color.r, o.color.g, o.color.b);
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
