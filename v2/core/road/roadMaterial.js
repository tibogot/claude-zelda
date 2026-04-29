import * as THREE from "three";
import { MeshPhysicalNodeMaterial } from "three";
import {
  Fn, float, vec2, vec3, vec4, uv, mix, max, min, step, smoothstep,
  fract, dot, texture, positionWorld, cameraPosition, length,
  normalize, sub, attribute, abs,
} from "three/tsl";
import { uniform } from "three/tsl";

export function createRoadUniforms(params) {
  return {
    uRoadWidth: uniform(params.width ?? 5),
    uTexScale: uniform(params.texScale ?? 1.0),
    // edge lines
    uLineColor: uniform(new THREE.Color(params.lineColor)),
    uLineWidth: uniform(params.lineWidth),
    uLineSoftness: uniform(params.lineSoftness),
    uLineInset: uniform(params.lineInset ?? 0.04),
    // edge blend
    uEdgeBlendWidth: uniform(params.edgeBlendWidth ?? 0.12),
    uEdgeBlendNoise: uniform(params.edgeBlendNoise ?? 8.0),
    // center line
    uCenterLine: uniform(params.centerLine ? 1 : 0),
    uCenterLineColor: uniform(new THREE.Color(params.centerLineColor ?? "#f0c040")),
    uCenterLineWidth: uniform(params.centerLineWidth ?? 0.02),
    uCenterLineSoftness: uniform(params.centerLineSoftness ?? 0.01),
    uCenterLineDashed: uniform(params.centerLineDashed !== false ? 1 : 0),
    uCenterLineDashScale: uniform(params.centerLineDashScale ?? 0.3),
    // double-lane highway
    uDoubleCenterLine: uniform(params.doubleCenterLine ? 1 : 0),
    uCenterLineGap: uniform(params.centerLineGap ?? 0.012),
    uCenterLeftEnabled: uniform(params.centerLeftEnabled !== false ? 1 : 0),
    uCenterLeftColor: uniform(new THREE.Color(params.centerLeftColor ?? params.centerLineColor ?? "#f0c040")),
    uCenterLeftDashed: uniform(params.centerLeftDashed ? 1 : 0),
    uCenterRightEnabled: uniform(params.centerRightEnabled !== false ? 1 : 0),
    uCenterRightColor: uniform(new THREE.Color(params.centerRightColor ?? params.centerLineColor ?? "#f0c040")),
    uCenterRightDashed: uniform(params.centerRightDashed ? 1 : 0),
    uLaneLines: uniform(params.laneLines ? 1 : 0),
    uLaneLineWidth: uniform(params.laneLineWidth ?? 0.004),
    uLaneDashScale: uniform(params.laneDashScale ?? 0.3),
    // color adjustments
    uColorTint: uniform(new THREE.Color(params.colorTint ?? "#ffffff")),
    uColorBrightness: uniform(params.colorBrightness ?? 1.0),
    // PBR / enhanced
    uEnhanced: uniform(0),
    uNormalStrength: uniform(params.normalStrength ?? 1.0),
    uRoughnessBase: uniform(params.roughnessBase ?? 0.55),
    uReflectStrength: uniform(params.reflectStrength ?? 0.6),
    uLodNear: uniform(params.lodNear ?? 30),
    uLodMid: uniform(params.lodMid ?? 80),
    uLodFar: uniform(params.lodFar ?? 200),
    uMixBlur: uniform(params.mixBlur ?? 0.08),
    uMixStrength: uniform(params.mixStrength ?? 1.5),
    uMixContrast: uniform(params.mixContrast ?? 1.0),
    uNormalDistort: uniform(params.normalDistort ?? 0.12),
    // procedural aging
    uDirtAmount: uniform(params.dirtAmount ?? 0.0),
    uDirtScale: uniform(params.dirtScale ?? 3.0),
    uDirtContrast: uniform(params.dirtContrast ?? 0.5),
    uDirtTint: uniform(new THREE.Color(params.dirtTint ?? "#8f8578")),
    uEdgeDirtBoost: uniform(params.edgeDirtBoost ?? 0.0),
    uWearAmount: uniform(params.wearAmount ?? 0.0),
    uWearScale: uniform(params.wearScale ?? 8.0),
    uWearContrast: uniform(params.wearContrast ?? 0.5),
    uWearDarken: uniform(params.wearDarken ?? 0.2),
    uScratchAmount: uniform(params.scratchAmount ?? 0.0),
    uScratchScale: uniform(params.scratchScale ?? 24.0),
    uScratchThinness: uniform(params.scratchThinness ?? 0.8),
    uRoughnessDirtBoost: uniform(params.roughnessDirtBoost ?? 0.0),
    uRoughnessWearReduce: uniform(params.roughnessWearReduce ?? 0.0),
    uReflectVP: uniform(new THREE.Matrix4()),
    uReflectTex: null,
    // fallback procedural
    uAsphaltDark: uniform(new THREE.Color(params.asphaltDark)),
    uAsphaltLight: uniform(new THREE.Color(params.asphaltLight)),
    uGrainScale: uniform(params.grainScale),
    uGrainStrength: uniform(params.grainStrength),
  };
}

const _nHash = Fn(([p]) => {
  const pp = fract(p.mul(vec2(127.1, 311.7)));
  const d = dot(pp, pp.add(45.32));
  return fract(pp.x.add(d).mul(pp.y.add(d)));
});
const _vNoise = Fn(([p]) => {
  const i = p.floor();
  const f = fract(p);
  const uu = f.mul(f).mul(float(3).sub(f.mul(2)));
  return mix(
    mix(_nHash(i), _nHash(i.add(vec2(1, 0))), uu.x),
    mix(_nHash(i.add(vec2(0, 1))), _nHash(i.add(vec2(1, 1))), uu.x),
    uu.y,
  );
});
const _fbm2 = Fn(([p]) => {
  const v = _vNoise(p).mul(0.5).toVar();
  v.addAssign(_vNoise(p.mul(2)).mul(0.25));
  return v;
});

function _buildRoadColor(diffuseTex, u) {
  const {
    uRoadWidth, uTexScale,
    uLineColor, uLineWidth, uLineSoftness, uLineInset,
    uCenterLine, uCenterLineColor, uCenterLineWidth, uCenterLineSoftness,
    uCenterLineDashed, uCenterLineDashScale,
    uDoubleCenterLine, uCenterLineGap,
    uCenterLeftEnabled, uCenterLeftColor, uCenterLeftDashed,
    uCenterRightEnabled, uCenterRightColor, uCenterRightDashed,
    uLaneLines, uLaneLineWidth, uLaneDashScale,
    uColorTint, uColorBrightness,
    uAsphaltDark, uAsphaltLight, uGrainScale, uGrainStrength,
    uDirtAmount, uDirtScale, uDirtContrast, uDirtTint, uEdgeDirtBoost,
    uWearAmount, uWearScale, uWearContrast, uWearDarken,
    uScratchAmount, uScratchScale, uScratchThinness,
  } = u;

  return Fn(() => {
    const uvCoord = uv();
    const junction = attribute("aJunction");
    const arcLen = uvCoord.x;
    const v = uvCoord.y;

    const texUV = vec2(arcLen.div(uRoadWidth).mul(uTexScale), v.mul(uTexScale));

    const base = (() => {
      let col;
      if (diffuseTex) {
        col = texture(diffuseTex, texUV).rgb;
      } else {
        const grainUV = texUV.mul(uGrainScale);
        const g1 = _fbm2(grainUV);
        const g2 = _fbm2(grainUV.mul(2.35).add(vec2(0.61, 1.93)));
        const grain = g1.mul(0.62).add(g2.mul(0.38));
        const tone = grain.mul(uGrainStrength).add(0.5).clamp(float(0), float(1));
        col = mix(uAsphaltDark, uAsphaltLight, tone);
      }
      return col.mul(uColorTint).mul(uColorBrightness).toVar();
    })();

    // Procedural road aging: macro dirt + tire wear + micro scratches
    const centerDist = abs(v.sub(0.5)).mul(2).clamp(float(0), float(1));
    const dirtEdgeMask = centerDist.pow(1.6);
    const dirtBase = _fbm2(texUV.mul(uDirtScale.mul(0.22)));
    const dirtLo = float(0.42).sub(uDirtContrast.mul(0.22));
    const dirtHi = float(0.68).add(uDirtContrast.mul(0.22));
    const dirtMask = smoothstep(dirtLo, dirtHi, dirtBase)
      .add(dirtEdgeMask.mul(uEdgeDirtBoost))
      .mul(uDirtAmount)
      .clamp(float(0), float(1));

    const wearBandL = float(1).sub(smoothstep(float(0.0), float(0.14), abs(v.sub(0.33))));
    const wearBandR = float(1).sub(smoothstep(float(0.0), float(0.14), abs(v.sub(0.67))));
    const wearBand = max(wearBandL, wearBandR);
    const wearStreak = _fbm2(vec2(arcLen.mul(uWearScale.mul(0.34)), v.mul(uWearScale.mul(0.08))));
    const wearLo = float(0.34).sub(uWearContrast.mul(0.2));
    const wearHi = float(0.66).add(uWearContrast.mul(0.2));
    const wearMask = smoothstep(wearLo, wearHi, wearStreak).mul(wearBand).mul(uWearAmount).clamp(float(0), float(1));

    const scratchField = _fbm2(texUV.mul(uScratchScale).add(vec2(_fbm2(texUV.mul(1.7)), _fbm2(texUV.mul(2.3)))));
    const scratchMask = smoothstep(uScratchThinness, float(0.995), scratchField).mul(uScratchAmount).clamp(float(0), float(1));

    const dirtColor = base.mul(uDirtTint);
    const withDirt = mix(base, dirtColor, dirtMask);
    const withWear = mix(withDirt, withDirt.mul(float(1).sub(uWearDarken)), wearMask);
    const agedBase = mix(withWear, withWear.mul(0.72), scratchMask);

    // edge lines — inset from road edge
    const ew = max(uLineWidth, float(0.0001));
    const softEps = max(uLineSoftness, float(1e-6));
    const leftCenter = uLineInset.add(ew.mul(0.5));
    const leftDist = abs(v.sub(leftCenter));
    const leftLine = float(1).sub(smoothstep(ew.mul(0.5), ew.mul(0.5).add(softEps), leftDist));
    const rightCenter = float(1).sub(uLineInset).sub(ew.mul(0.5));
    const rightDist = abs(v.sub(rightCenter));
    const rightLine = float(1).sub(smoothstep(ew.mul(0.5), ew.mul(0.5).add(softEps), rightDist));

    // center line — single or double
    const cw = max(uCenterLineWidth, float(0.0001));
    const cs = max(uCenterLineSoftness, float(1e-6));

    // single center line (when doubleCenterLine is off)
    const distCenter = abs(v.sub(0.5));
    const singleCenterBand = float(1).sub(smoothstep(cw, cw.add(cs), distCenter));
    const singleDashMask = mix(
      float(1),
      step(float(0.5), fract(arcLen.mul(uCenterLineDashScale))),
      uCenterLineDashed,
    );

    // double center lines: two solid yellow lines offset from center by half the gap
    const halfGap = uCenterLineGap.mul(0.5);
    const leftCenterPos = float(0.5).sub(halfGap).sub(cw.mul(0.5));
    const rightCenterPos = float(0.5).add(halfGap).add(cw.mul(0.5));
    const distLeftCenter = abs(v.sub(leftCenterPos));
    const distRightCenter = abs(v.sub(rightCenterPos));
    const leftCenterBand = float(1).sub(smoothstep(cw.mul(0.5), cw.mul(0.5).add(cs), distLeftCenter));
    const rightCenterBand = float(1).sub(smoothstep(cw.mul(0.5), cw.mul(0.5).add(cs), distRightCenter));
    const leftCenterDashMask = mix(
      float(1),
      step(float(0.5), fract(arcLen.mul(uCenterLineDashScale))),
      uCenterLeftDashed,
    );
    const rightCenterDashMask = mix(
      float(1),
      step(float(0.5), fract(arcLen.mul(uCenterLineDashScale))),
      uCenterRightDashed,
    );
    const singleCenterMask = singleCenterBand.mul(singleDashMask).mul(uCenterLine).mul(float(1).sub(uDoubleCenterLine));
    const leftCenterMask = leftCenterBand.mul(leftCenterDashMask).mul(uCenterLeftEnabled).mul(uCenterLine).mul(uDoubleCenterLine);
    const rightCenterMask = rightCenterBand.mul(rightCenterDashMask).mul(uCenterRightEnabled).mul(uCenterLine).mul(uDoubleCenterLine);

    // lane separator lines (dashed white, between edge line and center)
    const lw = max(uLaneLineWidth, float(0.0001));
    const leftLanePos = leftCenter.add(leftCenterPos).mul(0.5);
    const rightLanePos = rightCenter.add(rightCenterPos).mul(0.5);
    const leftLaneSingle = leftCenter.add(float(0.5)).mul(0.5);
    const rightLaneSingle = rightCenter.add(float(0.5)).mul(0.5);
    const leftLaneV = mix(leftLaneSingle, leftLanePos, uDoubleCenterLine);
    const rightLaneV = mix(rightLaneSingle, rightLanePos, uDoubleCenterLine);
    const laneDash = step(float(0.5), fract(arcLen.mul(uLaneDashScale)));
    const leftLaneBand = float(1).sub(smoothstep(lw.mul(0.5), lw.mul(0.5).add(cs), abs(v.sub(leftLaneV))));
    const rightLaneBand = float(1).sub(smoothstep(lw.mul(0.5), lw.mul(0.5).add(cs), abs(v.sub(rightLaneV))));
    const laneMask = max(leftLaneBand, rightLaneBand).mul(laneDash).mul(uLaneLines);

    // junction mask — fade lines at intersections
    const junctionMask = float(1).sub(step(float(0.2), junction));
    const edgeMask = max(leftLine, rightLine).mul(junctionMask).clamp(float(0), float(1));

    // compose: base → edge lines → lane lines → single/double center markings
    const result = mix(agedBase, uLineColor, edgeMask);
    const withLanes = mix(result, uLineColor, laneMask.mul(junctionMask).clamp(float(0), float(1)));
    const withSingleCenter = mix(withLanes, uCenterLineColor, singleCenterMask.mul(junctionMask).clamp(float(0), float(1)));
    const withLeftCenter = mix(withSingleCenter, uCenterLeftColor, leftCenterMask.mul(junctionMask).clamp(float(0), float(1)));
    return mix(withLeftCenter, uCenterRightColor, rightCenterMask.mul(junctionMask).clamp(float(0), float(1))).saturate();
  })();
}

export function createRoadMaterial(uniforms, diffuseTex, armTex, normalTex, reflectTex) {
  const {
    uRoadWidth, uTexScale,
    uEdgeBlendWidth, uEdgeBlendNoise,
    uEnhanced, uNormalStrength, uRoughnessBase, uReflectStrength,
    uLodNear, uLodMid, uLodFar,
    uMixBlur, uMixStrength, uMixContrast, uNormalDistort,
    uDirtAmount, uDirtScale, uDirtContrast, uEdgeDirtBoost,
    uWearAmount, uWearScale, uWearContrast,
    uScratchAmount, uScratchScale, uScratchThinness,
    uRoughnessDirtBoost, uRoughnessWearReduce,
    uReflectVP,
  } = uniforms;

  const roadColor = _buildRoadColor(diffuseTex, uniforms);

  const distLod = Fn(() => {
    const dist = length(sub(positionWorld.xz, cameraPosition.xz));
    return smoothstep(uLodNear, uLodFar, dist);
  })();

  const nearFactor = Fn(() => {
    const dist = length(sub(positionWorld.xz, cameraPosition.xz));
    return float(1).sub(smoothstep(uLodNear, uLodMid, dist));
  })();

  const reflectFade = Fn(() => {
    const dist = length(sub(positionWorld.xz, cameraPosition.xz));
    return float(1).sub(smoothstep(uLodMid, uLodFar, dist));
  })();

  const mat = new MeshPhysicalNodeMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    polygonOffsetUnits: -6,
    stencilWrite: true,
    stencilFunc: THREE.NotEqualStencilFunc,
    stencilRef: 1,
    stencilZPass: THREE.ReplaceStencilOp,
    stencilFail: THREE.KeepStencilOp,
    stencilZFail: THREE.KeepStencilOp,
  });

  const roadUV = Fn(() => {
    const uvCoord = uv();
    return vec2(uvCoord.x.div(uRoadWidth).mul(uTexScale), uvCoord.y.mul(uTexScale));
  })();

  const getReflectUV = Fn(() => {
    const clip = uReflectVP.mul(vec4(positionWorld, 1.0));
    const ndc = clip.xy.div(clip.w);
    const screenUV = ndc.mul(0.5).add(0.5);
    return vec2(screenUV.x, float(1).sub(screenUV.y));
  });

  const sampleNormalDistort = Fn(() => {
    if (!normalTex) return vec2(0, 0);
    const n = texture(normalTex, roadUV).xy.mul(2).sub(1);
    return n.mul(uNormalDistort).mul(uEnhanced);
  });

  const blurredReflect = Fn(() => {
    if (!reflectTex) return vec3(0, 0, 0);
    const baseUV = getReflectUV();
    const distort = sampleNormalDistort();
    const centerUV = baseUV.add(distort);
    const blur = uMixBlur.mul(uEnhanced);
    const acc = texture(reflectTex, centerUV).rgb.toVar();
    acc.addAssign(texture(reflectTex, centerUV.add(vec2(blur, 0))).rgb);
    acc.addAssign(texture(reflectTex, centerUV.add(vec2(blur.negate(), 0))).rgb);
    acc.addAssign(texture(reflectTex, centerUV.add(vec2(0, blur))).rgb);
    acc.addAssign(texture(reflectTex, centerUV.add(vec2(0, blur.negate()))).rgb);
    acc.addAssign(texture(reflectTex, centerUV.add(vec2(blur.mul(0.7), blur.mul(0.7)))).rgb);
    acc.addAssign(texture(reflectTex, centerUV.add(vec2(blur.mul(-0.7), blur.mul(0.7)))).rgb);
    acc.addAssign(texture(reflectTex, centerUV.add(vec2(blur.mul(0.7), blur.mul(-0.7)))).rgb);
    acc.addAssign(texture(reflectTex, centerUV.add(vec2(blur.mul(-0.7), blur.mul(-0.7)))).rgb);
    const avg = acc.div(9);
    const contrasted = mix(vec3(0.5, 0.5, 0.5), avg, uMixContrast);
    return contrasted.max(vec3(0, 0, 0));
  });

  mat.colorNode = Fn(() => {
    const base = roadColor;
    if (!reflectTex) return base;
    const refl = blurredReflect();
    const blendAlpha = uReflectStrength.mul(uEnhanced).mul(reflectFade).mul(uMixStrength).clamp(float(0), float(1));
    return mix(base, refl, blendAlpha);
  })();

  if (normalTex) {
    mat.normalNode = Fn(() => {
      const n1 = texture(normalTex, roadUV).xyz.mul(2).sub(1);
      // second sample at rotated (27 deg) + smaller scale to break tiling
      const rotUV = vec2(
        roadUV.x.mul(0.891).sub(roadUV.y.mul(0.454)),
        roadUV.x.mul(0.454).add(roadUV.y.mul(0.891)),
      ).mul(0.37);
      const n2 = texture(normalTex, rotUV).xyz.mul(2).sub(1);
      const n = normalize(n1.add(n2));
      const strength = uNormalStrength.mul(float(1).sub(distLod));
      return normalize(mix(vec3(0, 0, 1), n, strength));
    })();
  }

  mat.roughnessNode = Fn(() => {
    const uvCoord = uv();
    const arcLen = uvCoord.x;
    const vCoord = uvCoord.y;
    const centerDist = abs(vCoord.sub(0.5)).mul(2).clamp(float(0), float(1));
    const edgeMask = centerDist.pow(1.6);
    const dirtBase = _fbm2(roadUV.mul(uDirtScale.mul(0.22)));
    const dirtLo = float(0.42).sub(uDirtContrast.mul(0.22));
    const dirtHi = float(0.68).add(uDirtContrast.mul(0.22));
    const dirtMask = smoothstep(dirtLo, dirtHi, dirtBase)
      .add(edgeMask.mul(uEdgeDirtBoost))
      .mul(uDirtAmount)
      .clamp(float(0), float(1));
    const wearBandL = float(1).sub(smoothstep(float(0.0), float(0.14), abs(vCoord.sub(0.33))));
    const wearBandR = float(1).sub(smoothstep(float(0.0), float(0.14), abs(vCoord.sub(0.67))));
    const wearBand = max(wearBandL, wearBandR);
    const wearStreak = _fbm2(vec2(arcLen.mul(uWearScale.mul(0.34)), vCoord.mul(uWearScale.mul(0.08))));
    const wearLo = float(0.34).sub(uWearContrast.mul(0.2));
    const wearHi = float(0.66).add(uWearContrast.mul(0.2));
    const wearMask = smoothstep(wearLo, wearHi, wearStreak).mul(wearBand).mul(uWearAmount).clamp(float(0), float(1));
    const scratchField = _fbm2(roadUV.mul(uScratchScale).add(vec2(_fbm2(roadUV.mul(1.7)), _fbm2(roadUV.mul(2.3)))));
    const scratchMask = smoothstep(uScratchThinness, float(0.995), scratchField).mul(uScratchAmount).clamp(float(0), float(1));

    const roughAging = dirtMask.mul(uRoughnessDirtBoost)
      .sub(wearMask.mul(uRoughnessWearReduce))
      .add(scratchMask.mul(0.08));

    if (armTex) {
      const roughness = texture(armTex, roadUV).g;
      return roughness.mul(uRoughnessBase).add(roughAging).clamp(float(0), float(1));
    }
    return uRoughnessBase.add(roughAging).clamp(float(0), float(1));
  })();

  mat.metalnessNode = Fn(() => {
    if (armTex) {
      return texture(armTex, roadUV).b.mul(nearFactor);
    }
    return uReflectStrength.mul(uEnhanced).mul(nearFactor).mul(float(0.15));
  })();

  mat.clearcoatNode = Fn(() => {
    return uReflectStrength.mul(uEnhanced).mul(nearFactor).mul(0.3);
  })();
  mat.clearcoatRoughnessNode = Fn(() => {
    return mix(float(0.4), float(0.1), nearFactor.mul(uEnhanced));
  })();

  // noise-based irregular edge blend
  mat.opacityNode = Fn(() => {
    const vCoord = uv().y;
    const distFromEdge = min(vCoord, float(1).sub(vCoord));
    const noise = _fbm2(positionWorld.xz.mul(uEdgeBlendNoise));
    const threshold = uEdgeBlendWidth.mul(float(0.3).add(noise.mul(0.7)));
    return smoothstep(float(0), threshold, distFromEdge);
  })();
  mat.alphaTest = 0.5;

  return mat;
}

export function syncRoadUniforms(uniforms, params) {
  uniforms.uRoadWidth.value = params.width ?? 5;
  uniforms.uTexScale.value = params.texScale ?? 1.0;
  // edge lines
  uniforms.uLineColor.value.set(params.lineColor);
  uniforms.uLineWidth.value = params.lineWidth;
  uniforms.uLineSoftness.value = params.lineSoftness;
  uniforms.uLineInset.value = params.lineInset ?? 0.04;
  // edge blend
  uniforms.uEdgeBlendWidth.value = params.edgeBlendWidth ?? 0.12;
  uniforms.uEdgeBlendNoise.value = params.edgeBlendNoise ?? 8.0;
  // center line
  uniforms.uCenterLine.value = params.centerLine ? 1 : 0;
  uniforms.uCenterLineColor.value.set(params.centerLineColor ?? "#f0c040");
  uniforms.uCenterLineWidth.value = params.centerLineWidth ?? 0.02;
  uniforms.uCenterLineSoftness.value = params.centerLineSoftness ?? 0.01;
  uniforms.uCenterLineDashed.value = params.centerLineDashed !== false ? 1 : 0;
  uniforms.uCenterLineDashScale.value = params.centerLineDashScale ?? 0.3;
  // double-lane highway
  uniforms.uDoubleCenterLine.value = params.doubleCenterLine ? 1 : 0;
  uniforms.uCenterLineGap.value = params.centerLineGap ?? 0.012;
  uniforms.uCenterLeftEnabled.value = params.centerLeftEnabled !== false ? 1 : 0;
  uniforms.uCenterLeftColor.value.set(params.centerLeftColor ?? params.centerLineColor ?? "#f0c040");
  uniforms.uCenterLeftDashed.value = params.centerLeftDashed ? 1 : 0;
  uniforms.uCenterRightEnabled.value = params.centerRightEnabled !== false ? 1 : 0;
  uniforms.uCenterRightColor.value.set(params.centerRightColor ?? params.centerLineColor ?? "#f0c040");
  uniforms.uCenterRightDashed.value = params.centerRightDashed ? 1 : 0;
  uniforms.uLaneLines.value = params.laneLines ? 1 : 0;
  uniforms.uLaneLineWidth.value = params.laneLineWidth ?? 0.004;
  uniforms.uLaneDashScale.value = params.laneDashScale ?? 0.3;
  // color adjustments
  uniforms.uColorTint.value.set(params.colorTint ?? "#ffffff");
  uniforms.uColorBrightness.value = params.colorBrightness ?? 1.0;
  // fallback procedural
  uniforms.uAsphaltDark.value.set(params.asphaltDark);
  uniforms.uAsphaltLight.value.set(params.asphaltLight);
  uniforms.uGrainScale.value = params.grainScale;
  uniforms.uGrainStrength.value = params.grainStrength;
  // PBR
  uniforms.uEnhanced.value = params.enhanced ? 1 : 0;
  uniforms.uNormalStrength.value = params.normalStrength ?? 1.0;
  uniforms.uRoughnessBase.value = params.roughnessBase ?? 0.55;
  uniforms.uReflectStrength.value = params.reflectStrength ?? 0.6;
  uniforms.uLodNear.value = params.lodNear ?? 30;
  uniforms.uLodMid.value = params.lodMid ?? 80;
  uniforms.uLodFar.value = params.lodFar ?? 200;
  uniforms.uMixBlur.value = params.mixBlur ?? 0.08;
  uniforms.uMixStrength.value = params.mixStrength ?? 1.5;
  uniforms.uMixContrast.value = params.mixContrast ?? 1.0;
  uniforms.uNormalDistort.value = params.normalDistort ?? 0.12;
  uniforms.uDirtAmount.value = params.dirtAmount ?? 0.0;
  uniforms.uDirtScale.value = params.dirtScale ?? 3.0;
  uniforms.uDirtContrast.value = params.dirtContrast ?? 0.5;
  uniforms.uDirtTint.value.set(params.dirtTint ?? "#8f8578");
  uniforms.uEdgeDirtBoost.value = params.edgeDirtBoost ?? 0.0;
  uniforms.uWearAmount.value = params.wearAmount ?? 0.0;
  uniforms.uWearScale.value = params.wearScale ?? 8.0;
  uniforms.uWearContrast.value = params.wearContrast ?? 0.5;
  uniforms.uWearDarken.value = params.wearDarken ?? 0.2;
  uniforms.uScratchAmount.value = params.scratchAmount ?? 0.0;
  uniforms.uScratchScale.value = params.scratchScale ?? 24.0;
  uniforms.uScratchThinness.value = params.scratchThinness ?? 0.8;
  uniforms.uRoughnessDirtBoost.value = params.roughnessDirtBoost ?? 0.0;
  uniforms.uRoughnessWearReduce.value = params.roughnessWearReduce ?? 0.0;
}
