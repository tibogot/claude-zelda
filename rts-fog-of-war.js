/**
 * RTS fog of war — vision grid → blurred strength texture → TSL scene fog.
 * Gameplay visibility stays grid-based; rendering fades into atmosphere fog.
 */
import * as THREE from "three/webgpu";
import { texture, positionWorld, float, vec2, uniform, clamp, max } from "three/tsl";

export const RTS_FOW_TEX_RES = 256;

/** Separable box blur on a square Float32 strength field. */
function boxBlur(src, size, radius) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const cx = Math.min(size - 1, Math.max(0, x + k));
        sum += src[y * size + cx];
      }
      tmp[y * size + x] = sum / span;
    }
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const cy = Math.min(size - 1, Math.max(0, y + k));
        sum += tmp[cy * size + x];
      }
      dst[y * size + x] = sum / span;
    }
  }

  return dst;
}

export function createRtsFogOfWarTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RTS_FOW_TEX_RES;
  const ctx = canvas.getContext("2d");
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;

  const minimapCanvas = document.createElement("canvas");
  minimapCanvas.width = minimapCanvas.height = RTS_FOW_TEX_RES;
  const minimapCtx = minimapCanvas.getContext("2d");

  return { canvas, ctx, tex, minimapCanvas, minimapCtx };
}

/**
 * Bake explored / visible grid into a blurred grayscale vision map (R = fog strength 0–1).
 */
export function updateRtsFogOfWarTexture(
  ctx,
  tex,
  minimapCtx,
  {
    fog,
    mapSize,
    shroudAlpha,
    fogAlpha,
    worldToFogCell,
    fogIdx,
    blurRadius = 2,
    blurPasses = 2,
  },
) {
  const res = RTS_FOW_TEX_RES;
  const half = mapSize * 0.5;
  let strengths = new Float32Array(res * res);

  for (let py = 0; py < res; py++) {
    const wz = (py / res) * mapSize - half;
    for (let px = 0; px < res; px++) {
      const wx = (px / res) * mapSize - half;
      const { c, r } = worldToFogCell(wx, wz);
      let s = fogAlpha;
      if (c >= 0 && r >= 0 && c < fog.cols && r < fog.rows) {
        const i = fogIdx(c, r);
        if (fog.visible[i]) s = 0;
        else if (fog.explored[i]) s = shroudAlpha;
      }
      strengths[py * res + px] = s;
    }
  }

  for (let pass = 0; pass < blurPasses; pass++) {
    strengths = boxBlur(strengths, res, blurRadius);
  }

  const img = ctx.createImageData(res, res);
  const data = img.data;
  for (let i = 0; i < strengths.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, strengths[i])) * 255);
    const p = i * 4;
    data[p] = v;
    data[p + 1] = v;
    data[p + 2] = v;
    data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;

  if (minimapCtx) {
    const mini = minimapCtx.createImageData(res, res);
    const md = mini.data;
    for (let i = 0; i < strengths.length; i++) {
      const s = Math.min(1, Math.max(0, strengths[i]));
      const p = i * 4;
      const tint = s < 0.05 ? 0 : s < shroudAlpha + 0.08 ? 18 : 0;
      md[p] = tint;
      md[p + 1] = tint;
      md[p + 2] = tint + 6;
      md[p + 3] = Math.round(s * 255);
    }
    minimapCtx.putImageData(mini, 0, 0);
  }
}

/**
 * TSL nodes: sample vision texture in world XZ and combine with atmospheric fog.
 */
export function createRtsFogOfWarNodes(fowTex, mapSize, atmoFogColor, atmoFogFactor) {
  const uFoWEnabled = uniform(0);
  const uMapHalf = uniform(mapSize * 0.5);
  const uMapSize = uniform(mapSize);

  const fowUv = positionWorld.xz.add(vec2(uMapHalf, uMapHalf)).div(uMapSize);
  const fowStrength = texture(fowTex, fowUv).r.mul(uFoWEnabled);
  const combinedFactor = clamp(max(atmoFogFactor, fowStrength), float(0), float(1));

  return {
    uFoWEnabled,
    uMapHalf,
    uMapSize,
    fowStrength,
    combinedFactor,
    fogColor: atmoFogColor,
  };
}
