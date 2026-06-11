/**
 * RTS fog of war — vision grid → RG texture (strength + shroud flag) → post overlay.
 * Atmospheric fog stays on scene.fogNode; tactical shroud is composited in post.
 */
import * as THREE from "three/webgpu";
import {
  texture,
  screenUV,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  mix,
  dot,
  step,
  Fn,
  getViewPosition,
} from "three/tsl";

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
 * Bake explored / visible grid into RG map: R = blurred overlay strength, G = shroud flag.
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
    blurRadius = 1,
    blurPasses = 1,
  },
) {
  const res = RTS_FOW_TEX_RES;
  const half = mapSize * 0.5;
  let strengths = new Float32Array(res * res);
  const states = new Float32Array(res * res);

  for (let py = 0; py < res; py++) {
    const wz = (py / res) * mapSize - half;
    for (let px = 0; px < res; px++) {
      const wx = (px / res) * mapSize - half;
      const { c, r } = worldToFogCell(wx, wz);
      let s = fogAlpha;
      let st = 0;
      if (c >= 0 && r >= 0 && c < fog.cols && r < fog.rows) {
        const i = fogIdx(c, r);
        if (fog.visible[i]) {
          s = 0;
          st = 1;
        } else if (fog.explored[i]) {
          s = shroudAlpha;
          st = 1;
        }
      }
      const idx = py * res + px;
      strengths[idx] = s;
      states[idx] = st;
    }
  }

  for (let pass = 0; pass < blurPasses; pass++) {
    strengths = boxBlur(strengths, res, blurRadius);
  }

  const img = ctx.createImageData(res, res);
  const data = img.data;
  for (let i = 0; i < strengths.length; i++) {
    const p = i * 4;
    data[p] = Math.round(Math.min(1, Math.max(0, strengths[i])) * 255);
    data[p + 1] = Math.round(states[i] * 255);
    data[p + 2] = 0;
    data[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  tex.needsUpdate = true;

  if (minimapCtx) {
    const mini = minimapCtx.createImageData(res, res);
    const md = mini.data;
    for (let i = 0; i < strengths.length; i++) {
      const s = Math.min(1, Math.max(0, strengths[i]));
      const st = states[i];
      const p = i * 4;
      if (s < 0.04) {
        md[p] = 255;
        md[p + 1] = 255;
        md[p + 2] = 255;
        md[p + 3] = 0;
      } else if (st > 0.5) {
        md[p] = 70;
        md[p + 1] = 78;
        md[p + 2] = 88;
        md[p + 3] = Math.round(s * 200);
      } else {
        md[p] = 12;
        md[p + 1] = 16;
        md[p + 2] = 24;
        md[p + 3] = Math.round(s * 255);
      }
    }
    minimapCtx.putImageData(mini, 0, 0);
  }
}

/**
 * Post-process FoW overlay: reconstruct world XZ from depth, sample RG vision map.
 */
export function createRtsFogOfWarPostOverlay({ scenePass, camera, fowTex, mapSize }) {
  const uFoWEnabled = uniform(0);
  const uMapHalf = uniform(mapSize * 0.5);
  const uMapSize = uniform(mapSize);
  const uInvProj = uniform(new THREE.Matrix4());
  const uCameraWorld = uniform(new THREE.Matrix4());
  const uShroudTint = uniform(new THREE.Color(0x454c55).convertSRGBToLinear());
  const uUnexploredTint = uniform(new THREE.Color(0x080a0f).convertSRGBToLinear());
  const uShroudDesat = uniform(0.58);

  const scenePassDepth = scenePass.getTextureNode("depth");
  const linearDepth = scenePass.getLinearDepthNode
    ? scenePass.getLinearDepthNode()
    : scenePassDepth.sample(screenUV).r;
  const skyMask = step(float(0.999), linearDepth);

  const applyFoW = Fn(([color]) => {
    const depth = scenePassDepth.sample(screenUV).r;
    const viewPos = getViewPosition(screenUV, depth, uInvProj);
    const worldPos = uCameraWorld.mul(vec4(viewPos, float(1))).xyz;

    const fowUv = worldPos.xz.add(vec2(uMapHalf, uMapHalf)).div(uMapSize);
    const fowSample = texture(fowTex, fowUv);
    const strength = fowSample.r.mul(uFoWEnabled);
    const isShroud = step(float(0.5), fowSample.g);

    const lum = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
    const desatRgb = mix(vec3(lum), color.rgb, float(1).sub(uShroudDesat));
    const shroudRgb = mix(desatRgb, uShroudTint, strength.mul(float(0.72)));
    const unexploredRgb = mix(color.rgb, uUnexploredTint, strength);
    const fowRgb = mix(unexploredRgb, shroudRgb, isShroud);
    const shaded = vec4(mix(color.rgb, fowRgb, strength), color.a);
    return mix(color, shaded, float(1).sub(skyMask));
  });

  function syncCamera(cam) {
    uInvProj.value.copy(cam.projectionMatrixInverse);
    uCameraWorld.value.copy(cam.matrixWorld);
  }

  syncCamera(camera);

  return {
    uFoWEnabled,
    uMapHalf,
    uMapSize,
    uShroudTint,
    uUnexploredTint,
    uShroudDesat,
    syncCamera,
    apply: (colorNode) => applyFoW(colorNode),
  };
}

export function syncRtsFogOfWarOverlayUniforms(overlay, fogParams, camera) {
  if (!overlay) return;
  overlay.uFoWEnabled.value = fogParams.enabled ? 1 : 0;
  overlay.uShroudDesat.value = fogParams.shroudDesat ?? 0.58;
  overlay.uShroudTint.value
    .set(fogParams.shroudColor ?? "#454c55")
    .convertSRGBToLinear();
  overlay.uUnexploredTint.value
    .set(fogParams.unexploredColor ?? "#080a0f")
    .convertSRGBToLinear();
  if (camera) overlay.syncCamera(camera);
}
