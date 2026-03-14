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
  smoothstep,
  fwidth,
  pow,
} from "three/tsl";
import { IGN } from "./tslWind.js";

export function createImpostorMaterial(
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
  const uEdgeSmoothScale = opts.edgeSmoothUniform ?? uniform(float(1.5));
  const uAlphaClamp = opts.alphaClampUniform ?? uniform(float(alphaClamp));

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
    const edgeW = mul(fwidth(dominantAlpha), uEdgeSmoothScale);
    const smoothedAlpha = smoothstep(
      sub(uAlphaClamp, edgeW),
      add(uAlphaClamp, edgeW),
      dominantAlpha,
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
      smoothedAlpha,
    );
    const ramp = smoothstep(sub(uLodDist, uFadeRange), uLodDist, dist);
    const alphaOut = mul(ditheredAlpha, ramp);
    return vec4(saturate(light), alphaOut);
  });

  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
  mat.positionNode = positionNodeFn();
  mat.colorNode = colorNodeFn();
  mat.transparent = false;
  mat.alphaTest = 0.005;
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
