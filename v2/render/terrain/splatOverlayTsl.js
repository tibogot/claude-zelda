/**
 * Composable 3-layer splat overlay for TSL NodeMaterials.
 *
 * Designed to sit on top of ANY base surface (procedural TSL, image texture,
 * etc.). The base surface is "layer 0" — it shows through wherever the per-chunk
 * splat R+G+B channels are zero. Layers 1/2/3 correspond to R/G/B channels.
 *
 * Splat encoding (per-chunk 128² RGBA DataTexture — same as SplatStore):
 *   R → weight of overlay layer 1
 *   G → weight of overlay layer 2
 *   B → weight of overlay layer 3
 *   A → meadow density (0 = no meadow, 1 = full meadow proc color)
 *   Layer 0 (base surface) is implicit: w0 = max(0, 1 - R - G - B).
 *   Shader normalizes so sum = 1. Meadow blends on top independently via A.
 *
 * Usage:
 *   const overlay = createSplatOverlay(layerSlots, chunkSize, worldSize);
 *   // In material colorNode Fn:
 *   const baseColor = proceduralGround();
 *   return overlay.blendColor(baseColor);
 *   // overlay.splatTexNode.value must be swapped per-chunk in onBeforeRender.
 */
import * as THREE from "three";
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  texture,
  positionLocal,
  positionWorld,
  mix,
  max,
  clamp,
  sqrt,
  uniform,
  step,
} from "three/tsl";

function makePlaceholderSplatTex() {
  const d = new Uint8Array([0, 0, 0, 0]);
  const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * @param {object[]} layerSlots — 3 TextureLibrary slots for overlay layers 1/2/3
 * @param {number} chunkSize
 * @param {number} worldSize
 */
export function createSplatOverlay(layerSlots, chunkSize, worldSize) {
  if (layerSlots.length !== 3) {
    throw new Error(`createSplatOverlay expects 3 layer slots, got ${layerSlots.length}`);
  }

  const cs = float(chunkSize);
  const invWorldSize = float(1.0 / worldSize);

  const splatUV = positionLocal.xz.div(cs).add(vec2(0.5, 0.5));
  const splatTexNode = texture(makePlaceholderSplatTex(), splatUV);

  const layerNodes = layerSlots.map((slot) => {
    const uv = positionWorld.xz.mul(invWorldSize).mul(slot.uUVScale);
    return {
      slot,
      albedo: texture(slot.albedoTex, uv),
      orm: texture(slot.ormTex, uv),
    };
  });

  const uSoloLayer = uniform(-1.0);

  const splatWeights = Fn(() => {
    const r = splatTexNode.r;
    const g = splatTexNode.g;
    const b = splatTexNode.b;
    const w0Raw = max(float(0), float(1).sub(r).sub(g).sub(b));
    const total = max(float(1e-5), w0Raw.add(r).add(g).add(b));
    return vec4(w0Raw.div(total), r.div(total), g.div(total), b.div(total));
  });

  function blendColor(baseColor) {
    const w = splatWeights();
    const c1 = layerNodes[0].albedo.rgb.mul(
      mix(float(1), layerNodes[0].orm.g, layerSlots[0].uAOStr),
    );
    const c2 = layerNodes[1].albedo.rgb.mul(
      mix(float(1), layerNodes[1].orm.g, layerSlots[1].uAOStr),
    );
    const c3 = layerNodes[2].albedo.rgb.mul(
      mix(float(1), layerNodes[2].orm.g, layerSlots[2].uAOStr),
    );
    const blended = baseColor.mul(w.x).add(c1.mul(w.y)).add(c2.mul(w.z)).add(c3.mul(w.w));

    const isSolo = step(float(0), uSoloLayer);
    const s0 = step(float(0.5), uSoloLayer);
    const s1 = step(float(1.5), uSoloLayer);
    const s2 = step(float(2.5), uSoloLayer);
    const soloW = mix(w.x, mix(w.y, mix(w.z, w.w, s2), s1), s0);
    const soloColor = vec3(soloW, soloW, soloW);
    return mix(blended, soloColor, isSolo);
  }

  function blendRoughness(baseRough) {
    const w = splatWeights();
    const r1 = mix(float(0.88), layerNodes[0].orm.r, layerSlots[0].uRoughStr);
    const r2 = mix(float(0.88), layerNodes[1].orm.r, layerSlots[1].uRoughStr);
    const r3 = mix(float(0.88), layerNodes[2].orm.r, layerSlots[2].uRoughStr);
    return clamp(
      baseRough.mul(w.x).add(r1.mul(w.y)).add(r2.mul(w.z)).add(r3.mul(w.w)),
      float(0.04),
      float(1),
    );
  }

  function blendNormalRaw(baseNormalRaw) {
    const w = splatWeights();
    const baseNx = baseNormalRaw.x.mul(2).sub(1);
    const baseNy = baseNormalRaw.y.mul(2).sub(1);

    const nx1 = layerNodes[0].orm.b.mul(2).sub(1);
    const ny1 = layerNodes[0].orm.a.mul(2).sub(1);
    const nx2 = layerNodes[1].orm.b.mul(2).sub(1);
    const ny2 = layerNodes[1].orm.a.mul(2).sub(1);
    const nx3 = layerNodes[2].orm.b.mul(2).sub(1);
    const ny3 = layerNodes[2].orm.a.mul(2).sub(1);

    const nx = baseNx.mul(w.x).add(nx1.mul(w.y)).add(nx2.mul(w.z)).add(nx3.mul(w.w));
    const ny = baseNy.mul(w.x).add(ny1.mul(w.y)).add(ny2.mul(w.z)).add(ny3.mul(w.w));
    const nz = sqrt(max(float(0), float(1).sub(nx.mul(nx)).sub(ny.mul(ny))));
    return vec3(nx.mul(0.5).add(0.5), ny.mul(0.5).add(0.5), nz.mul(0.5).add(0.5));
  }

  function blendNormalStrength(baseNormalStr) {
    const w = splatWeights();
    return baseNormalStr
      .mul(w.x)
      .add(layerSlots[0].uNormalStr.mul(w.y))
      .add(layerSlots[1].uNormalStr.mul(w.z))
      .add(layerSlots[2].uNormalStr.mul(w.w));
  }

  /**
   * Blend meadow procedural color on top using A channel as density.
   * @param {*} col - current color (after texture overlay blend)
   * @param {*} meadowProcFn - Fn returning vec3 meadow color (from createMeadowTslBundle)
   */
  function blendMeadow(col, meadowProcFn) {
    const mW = splatTexNode.a;
    return mix(col, meadowProcFn(), mW);
  }

  return { splatTexNode, uSoloLayer, splatWeights, blendColor, blendRoughness, blendNormalRaw, blendNormalStrength, blendMeadow };
}
