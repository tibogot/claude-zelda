/**
 * Procedural TSL material for billboard ground cover: alpha mask + palette + wind scroll.
 */
import * as THREE from "three";
import {
  Fn,
  uv,
  vec2,
  vec3,
  vec4,
  sin,
  uniform,
  texture,
  positionLocal,
  positionWorld,
  color,
  normalize,
  dot,
  cameraPosition,
  max,
  mix,
  float,
} from "three/tsl";
import { noise12 } from "../../core/foliage/tsl-utils.js";

/**
 * @param {object} slot — optional slot._maskNode (TSL texture node)
 * @param {THREE.Texture} windTex
 * @param {THREE.Vector3} [sunDirection]
 * @param {{ simplified?: boolean }} [opts] — cheaper shader for mid/far LOD tiers
 */
export function createBillboardGrassMaterial(slot, windTex, sunDirection, opts = {}) {
  const simplified = opts.simplified === true;
  const sun = (sunDirection ?? new THREE.Vector3(0.5, 0.8, 0.3)).clone().normalize();
  const u = {
    time: uniform(0),
    colorBottom: uniform(color(slot.colorBottom ?? "#1a4d12")),
    colorMid: uniform(color(slot.colorMid ?? "#3d8f2a")),
    colorTop: uniform(color(slot.colorTop ?? "#6bc44a")),
    noiseScale: uniform(slot.noiseScale ?? 4),
    noiseStrength: uniform(simplified ? 0.12 : (slot.noiseStrength ?? 0.35)),
    windScrollSpeed: uniform(slot.windScrollSpeed ?? 0.08),
    windScrollScale: uniform(slot.windScrollScale ?? 2),
    windShadeStrength: uniform(simplified ? 0.2 : (slot.windShadeStrength ?? 0.4)),
    swaySpeed: uniform(slot.swaySpeed ?? 1.5),
    swayStrength: uniform(slot.swayStrength ?? 0.08),
    groundOcclusion: uniform(slot.groundOcclusion ?? 0.75),
    normalUpBias: uniform(slot.normalUpBias ?? 0.92),
    sunDir: uniform(sun),
    maskInAlpha: uniform(slot.maskInAlpha ?? 0.0),
  };

  const material = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    alphaTest: slot.alphaTest ?? 0.35,
    transparent: false,
    roughness: slot.roughness ?? 0.9,
    metalness: 0,
  });

  material.normalNode = Fn(() => {
    const up = vec3(0, 1, 0);
    if (simplified) return up;
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const viewFlat = normalize(vec3(viewDir.x, float(0), viewDir.z));
    return normalize(up.mul(u.normalUpBias).add(viewFlat.mul(float(1).sub(u.normalUpBias))));
  })();

  const maskNode = slot._maskNode ?? null;
  const fallbackBlade = uv().y.pow(1.15);

  material.colorNode = Fn(() => {
    const h = uv().y;
    const lowMid = mix(u.colorBottom, u.colorMid, h.smoothstep(float(0), float(0.55)));
    let col = mix(lowMid, u.colorTop, h.smoothstep(float(0.3), float(1)));

    if (!simplified) {
      const nUv = positionWorld.xz.mul(u.noiseScale);
      const n = noise12(nUv).mul(2).sub(1);
      col = col.mul(float(1).add(n.mul(u.noiseStrength)));
    }

    const scroll = vec2(u.time.mul(u.windScrollSpeed), u.time.mul(u.windScrollSpeed.mul(0.35)));
    const windUv = positionWorld.xz.mul(u.windScrollScale).add(scroll);
    const windS = texture(windTex, windUv).g;
    const windMod = windS.mul(u.windShadeStrength).add(float(1).sub(u.windShadeStrength.mul(0.5)));
    col = col.mul(windMod);

    const ao = h.smoothstep(float(0), u.groundOcclusion).add(0.18);
    if (!simplified) {
      const lightDir = normalize(u.sunDir);
      const viewDir = normalize(cameraPosition.sub(positionWorld));
      const backlit = max(float(0), dot(viewDir, lightDir.negate()));
      const backlitBoost = backlit.pow(1.4).mul(0.25).add(1);
      col = col.mul(backlitBoost);
    }
    col = col.mul(ao);

    let alpha = fallbackBlade;
    if (maskNode) {
      const maskCh = mix(maskNode.r, maskNode.a, u.maskInAlpha);
      alpha = maskCh;
    }
    return vec4(col, alpha);
  })();

  if (!simplified) {
    material.emissiveNode = Fn(() => {
      const h = uv().y;
      const lightDir = normalize(u.sunDir);
      const viewDir = normalize(cameraPosition.sub(positionWorld));
      const translucency = max(float(0), dot(viewDir, lightDir.negate()));
      const glow = translucency.pow(1.3).mul(h.smoothstep(0.05, 0.65)).mul(0.15);
      const scroll = vec2(u.time.mul(u.windScrollSpeed), u.time.mul(u.windScrollSpeed.mul(0.35)));
      const windUv = positionWorld.xz.mul(u.windScrollScale).add(scroll);
      const windS = texture(windTex, windUv).g;
      let mask = float(1);
      if (maskNode) {
        mask = mix(maskNode.r, maskNode.a, u.maskInAlpha);
      }
      return vec3(0.35, 0.55, 0.2).mul(glow).mul(windS.mul(0.5).add(0.5)).mul(mask);
    })();

    material.positionNode = Fn(() => {
      const wind = sin(u.time.mul(u.swaySpeed))
        .mul(u.swayStrength)
        .mul(uv().y.pow(1.4));
      return vec3(positionLocal.x.add(wind), positionLocal.y, positionLocal.z.add(wind));
    })();
  }

  return { material, uniforms: u };
}

export function applyBillboardGrassUniforms(u, slot) {
  if (!u || !slot) return;
  if (slot.colorBottom != null) u.colorBottom.value.set(slot.colorBottom);
  if (slot.colorMid != null) u.colorMid.value.set(slot.colorMid);
  if (slot.colorTop != null) u.colorTop.value.set(slot.colorTop);
  if (slot.noiseScale != null) u.noiseScale.value = slot.noiseScale;
  if (slot.noiseStrength != null) u.noiseStrength.value = slot.noiseStrength;
  if (slot.windScrollSpeed != null) u.windScrollSpeed.value = slot.windScrollSpeed;
  if (slot.windScrollScale != null) u.windScrollScale.value = slot.windScrollScale;
  if (slot.windShadeStrength != null) u.windShadeStrength.value = slot.windShadeStrength;
  if (slot.swaySpeed != null) u.swaySpeed.value = slot.swaySpeed;
  if (slot.swayStrength != null) u.swayStrength.value = slot.swayStrength;
  if (slot.groundOcclusion != null) u.groundOcclusion.value = slot.groundOcclusion;
  if (slot.normalUpBias != null) u.normalUpBias.value = slot.normalUpBias;
  if (slot.maskInAlpha != null) u.maskInAlpha.value = slot.maskInAlpha;
}
