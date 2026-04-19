import * as THREE from "three";
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial } from "three";
import {
  Fn, float, vec2, vec3, uv, mix, max, min, step, smoothstep,
  fract, floor, dot, texture, positionWorld, cameraPosition, length,
  normalize, sub,
} from "three/tsl";
import { uniform } from "three/tsl";

const _nHash = Fn(([p]) => {
  const pp = fract(p.mul(vec2(127.1, 311.7)));
  const d = dot(pp, pp.add(45.32));
  return fract(pp.x.add(d).mul(pp.y.add(d)));
});
const _vNoise = Fn(([p]) => {
  const i = floor(p);
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

const _buildAsphaltColor = (uAsphaltDark, uAsphaltLight, uLineColor, uGrainScale, uGrainStrength, uLineWidth, uLineSoftness) => {
  return Fn(() => {
    const uvCoord = uv();
    const grainUV = uvCoord.mul(uGrainScale);
    const g1 = _fbm2(grainUV);
    const g2 = _fbm2(grainUV.mul(2.35).add(vec2(0.61, 1.93)));
    const grain = g1.mul(0.62).add(g2.mul(0.38));
    const tone = grain.mul(uGrainStrength).add(0.5).clamp(float(0), float(1));
    const base = mix(uAsphaltDark, uAsphaltLight, tone);
    const w = max(uLineWidth, float(0.0001));
    const s = uLineSoftness;
    const yL = uvCoord.y;
    const yR = float(1).sub(uvCoord.y);
    const hardL = float(1).sub(step(w, yL));
    const hardR = float(1).sub(step(w, yR));
    const softEps = max(s, float(1e-6));
    const softL = float(1).sub(smoothstep(w, w.add(softEps), yL));
    const softR = float(1).sub(smoothstep(w, w.add(softEps), yR));
    const useSoft = step(float(1e-6), s);
    const leftLine = mix(hardL, softL, useSoft);
    const rightLine = mix(hardR, softR, useSoft);
    const edgeBlend = max(leftLine, rightLine).clamp(float(0), float(1));
    return mix(base, uLineColor, edgeBlend).saturate();
  })();
};

export function createRoadUniforms(params) {
  return {
    uAsphaltDark: uniform(new THREE.Color(params.asphaltDark)),
    uAsphaltLight: uniform(new THREE.Color(params.asphaltLight)),
    uLineColor: uniform(new THREE.Color(params.lineColor)),
    uGrainScale: uniform(params.grainScale),
    uGrainStrength: uniform(params.grainStrength),
    uLineWidth: uniform(params.lineWidth),
    uLineSoftness: uniform(params.lineSoftness),
    uEnhanced: uniform(0),
    uNormalStrength: uniform(params.normalStrength ?? 1.0),
    uRoughnessBase: uniform(params.roughnessBase ?? 0.55),
    uReflectStrength: uniform(params.reflectStrength ?? 0.6),
    uLodNear: uniform(params.lodNear ?? 30),
    uLodMid: uniform(params.lodMid ?? 80),
    uLodFar: uniform(params.lodFar ?? 200),
    uTexScale: uniform(params.texScale ?? 4.0),
  };
}

export function createRoadMaterial(uniforms, normalTex, roughnessTex) {
  const {
    uAsphaltDark, uAsphaltLight, uLineColor,
    uGrainScale, uGrainStrength, uLineWidth, uLineSoftness,
    uEnhanced, uNormalStrength, uRoughnessBase, uReflectStrength,
    uLodNear, uLodMid, uLodFar, uTexScale,
  } = uniforms;

  const asphaltColor = _buildAsphaltColor(
    uAsphaltDark, uAsphaltLight, uLineColor,
    uGrainScale, uGrainStrength, uLineWidth, uLineSoftness,
  );

  const distLod = Fn(() => {
    const worldPos = positionWorld;
    const camPos = cameraPosition;
    const dist = length(sub(worldPos.xz, camPos.xz));
    return smoothstep(uLodNear, uLodFar, dist);
  })();

  const nearFactor = Fn(() => {
    const worldPos = positionWorld;
    const camPos = cameraPosition;
    const dist = length(sub(worldPos.xz, camPos.xz));
    return float(1).sub(smoothstep(uLodNear, uLodMid, dist));
  })();

  const mat = new MeshPhysicalNodeMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  mat.colorNode = asphaltColor;

  const tiledUV = Fn(() => uv().mul(uTexScale))();

  if (normalTex) {
    mat.normalNode = Fn(() => {
      const sampled = texture(normalTex, tiledUV);
      const n = sampled.xyz.mul(2).sub(1);
      const strength = uNormalStrength.mul(uEnhanced).mul(float(1).sub(distLod));
      return normalize(mix(vec3(0, 0, 1), n, strength));
    })();
  }

  mat.roughnessNode = Fn(() => {
    if (roughnessTex) {
      const sampled = texture(roughnessTex, tiledUV).x;
      const texRough = mix(uRoughnessBase, sampled, uEnhanced.mul(float(1).sub(distLod)));
      return texRough;
    }
    return mix(float(0.95), uRoughnessBase, uEnhanced);
  })();

  mat.metalnessNode = Fn(() => {
    return uReflectStrength.mul(uEnhanced).mul(nearFactor).mul(float(0.15));
  })();

  mat.clearcoatNode = Fn(() => {
    return uReflectStrength.mul(uEnhanced).mul(nearFactor);
  })();
  mat.clearcoatRoughnessNode = Fn(() => {
    return mix(float(0.4), float(0.1), nearFactor.mul(uEnhanced));
  })();

  return mat;
}

export function syncRoadUniforms(uniforms, params) {
  uniforms.uAsphaltDark.value.set(params.asphaltDark);
  uniforms.uAsphaltLight.value.set(params.asphaltLight);
  uniforms.uLineColor.value.set(params.lineColor);
  uniforms.uGrainScale.value = params.grainScale;
  uniforms.uGrainStrength.value = params.grainStrength;
  uniforms.uLineWidth.value = params.lineWidth;
  uniforms.uLineSoftness.value = params.lineSoftness;
  uniforms.uEnhanced.value = params.enhanced ? 1 : 0;
  uniforms.uNormalStrength.value = params.normalStrength ?? 1.0;
  uniforms.uRoughnessBase.value = params.roughnessBase ?? 0.55;
  uniforms.uReflectStrength.value = params.reflectStrength ?? 0.6;
  uniforms.uLodNear.value = params.lodNear ?? 30;
  uniforms.uLodMid.value = params.lodMid ?? 80;
  uniforms.uLodFar.value = params.lodFar ?? 200;
  uniforms.uTexScale.value = params.texScale ?? 4.0;
}
