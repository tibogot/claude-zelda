import * as THREE from "three";
import { renderOutput } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { fxaa } from "three/addons/tsl/display/FXAANode.js";
import {
  N8AONode,
  createN8AOScenePass,
  applyQualityMode,
  resolveDisplayMode,
} from "n8ao-webgpu";

/**
 * v2 Post FX pipeline (WebGPU/TSL).
 *
 * Built on `THREE.RenderPipeline` (the r183 successor to the old
 * `THREE.PostProcessing` class — same API, just renamed).
 *
 * Design goals:
 *  - Zero cost when disabled. While `enabled === false`, the caller renders
 *    via `renderer.render(scene, camera)` as usual; this object does nothing.
 *  - Lazy first build. The `RenderPipeline`, scene pass, and bloom node are
 *    constructed the first time post-FX is enabled, so users who never turn
 *    it on pay no init cost.
 *  - Composable per-effect enable. Individual effects (bloom, FXAA, SSAO)
 *    are toggled at runtime by swapping `renderPipeline.outputNode` and
 *    setting `needsUpdate = true` (one shader rebuild, then stable).
 *
 * Effects shipped:
 *  - SSAO (n8ao-webgpu — TSL port of N8AO; clean at any zoom, half-res
 *    + denoise + temporal accumulation built in).
 *  - Bloom (additive, on the scene pass color in linear HDR).
 *  - FXAA (cheap edge anti-aliasing, replaces MSAA which the renderer cannot
 *    apply once we render through a `RenderPipeline`).
 *
 * Color pipeline:
 *  Scene MRT (output / diffuseColor / normal) → optional N8AO (composites
 *  AO onto beauty in linear) → bloom (additive in linear) → renderOutput
 *  (tone map + sRGB encoding) → FXAA (sRGB; required by the FXAA node).
 *
 * Why bloom always reads from raw `scenePassColor` (not the SSAO output):
 *  - Emissive sources in dark crevices should still bloom even when AO
 *    darkens them.
 *  - Bloom keeps a stable input node, so toggling SSAO doesn't rebuild it.
 *  - Three's node framework dedupes `updateBefore` per frame, so referring
 *    to both `scenePassColor` and `n8aoNode.getTextureNode()` does not cause
 *    a double scene render.
 *
 * Caveats:
 *  - The volumetric cloud system in v2 renders directly to the backbuffer
 *    in its own pipeline. While clouds render a frame, post-FX is skipped
 *    for that frame (see `main.js` cloud branch). Routing the cloud final
 *    RT through the post pass is a future step.
 */
export class PostFxPipeline {
  constructor({ renderer, scene, camera }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.enabled = false;

    /** Lazily created on first enable. */
    this._renderPipeline = null;
    this._scenePass = null;
    this._scenePassColor = null;

    /** Bloom (lazy). */
    this._bloomPass = null;
    this._bloomEnabled = true;
    this._bloomParams = {
      strength: 0.3,
      threshold: 0.9,
      radius: 0.4,
      smoothWidth: 1.0,
    };

    /** FXAA enable flag — node is built lazily inside `_refreshOutputNode`. */
    this._fxaaEnabled = true;

    /**
     * SSAO (n8ao-webgpu). Lazy: the `N8AONode` is built on first enable
     * (one-time shader compile cost). After that, toggling on/off just
     * swaps the output node — no rebuild.
     */
    this._ssaoNode = null;
    this._ssaoEnabled = false;
    /** Cached non-color SSAO params; pushed to `n8ao.configuration` lazily. */
    this._ssaoParams = {
      quality: "Medium",
      aoRadius: 5,
      distanceFalloff: 1,
      intensity: 3,
      color: "#000000",
      halfRes: false,
      depthAwareUpsampling: true,
      screenSpaceRadius: false,
      displayMode: "Combined",
      transparencyAware: false,
    };
    /** Reused `THREE.Color` so we don't allocate per-update. */
    this._ssaoColor = new THREE.Color(0, 0, 0);
  }

  /**
   * Returns true when this frame's render should go through the post
   * pipeline. Master switch must be on AND at least one effect must be
   * enabled — when everything is off we fall back to a direct render to
   * avoid paying for an empty pipeline pass.
   */
  isActive() {
    if (!this.enabled || this._renderPipeline === null) return false;
    return this._anyEffectEnabled();
  }

  _anyEffectEnabled() {
    return this._bloomEnabled || this._fxaaEnabled || this._ssaoEnabled;
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) this._ensureBuilt();
    // When toggled off we keep the pipeline allocated for cheap re-enable;
    // the caller falls back to `renderer.render(scene, camera)` for free.
  }

  setBloomEnabled(enabled) {
    if (this._bloomEnabled === enabled) return;
    this._bloomEnabled = enabled;
    if (this._renderPipeline) this._refreshOutputNode();
  }

  setFxaaEnabled(enabled) {
    if (this._fxaaEnabled === enabled) return;
    this._fxaaEnabled = enabled;
    if (this._renderPipeline) this._refreshOutputNode();
  }

  setSsaoEnabled(enabled) {
    if (this._ssaoEnabled === enabled) return;
    this._ssaoEnabled = enabled;
    if (enabled && this._renderPipeline) this._ensureSsaoBuilt();
    if (this._renderPipeline) this._refreshOutputNode();
  }

  setBloomParams({ strength, threshold, radius, smoothWidth } = {}) {
    if (strength != null) this._bloomParams.strength = strength;
    if (threshold != null) this._bloomParams.threshold = threshold;
    if (radius != null) this._bloomParams.radius = radius;
    if (smoothWidth != null) this._bloomParams.smoothWidth = smoothWidth;
    if (this._bloomPass) this._applyBloomUniforms();
  }

  /**
   * Update SSAO parameters. Cheap params (radius, intensity, distance
   * falloff, color, screenSpaceRadius, displayMode) are uniform updates.
   * Expensive ones (quality, halfRes, depthAwareUpsampling, transparencyAware)
   * trigger an internal shader rebuild inside the n8ao node — fine to do
   * occasionally but avoid every frame.
   */
  setSsaoParams(partial = {}) {
    Object.assign(this._ssaoParams, partial);
    if (this._ssaoNode) this._applySsaoConfig();
  }

  /**
   * `THREE.RenderPipeline` tracks renderer drawing buffer size internally —
   * we don't need to forward `setSize`. Method kept for API symmetry / future
   * effects that might need an explicit resize hook.
   */
  setSize(/* w, h */) {}

  /** Render the post-processed frame. Caller must check `isActive()` first. */
  render() {
    if (!this._renderPipeline) return;
    this._renderPipeline.render();
  }

  dispose() {
    if (this._ssaoNode?.dispose) this._ssaoNode.dispose();
    if (this._bloomPass?.dispose) this._bloomPass.dispose();
    this._renderPipeline = null;
    this._scenePass = null;
    this._scenePassColor = null;
    this._bloomPass = null;
    this._ssaoNode = null;
  }

  _ensureBuilt() {
    if (this._renderPipeline) return;

    const { renderer, scene, camera } = this;

    this._renderPipeline = new THREE.RenderPipeline(renderer);
    // We apply tone mapping + sRGB conversion manually via `renderOutput()`
    // so FXAA (which requires sRGB input) can sit at the very end of the
    // chain. Disabling the auto color transform avoids double-encoding.
    this._renderPipeline.outputColorTransform = false;

    // Always use the n8ao-style MRT scene pass once post-FX is on. The
    // additional fill rate for diffuse + normal RTs is small (~0.3 ms at
    // 1080p) and lets us drop in SSAO later with no graph rebuild.
    this._scenePass = createN8AOScenePass(scene, camera);
    this._scenePassColor = this._scenePass.getTextureNode("output");

    this._bloomPass = bloom(
      this._scenePassColor,
      this._bloomParams.strength,
      this._bloomParams.radius,
      this._bloomParams.threshold,
    );
    this._applyBloomUniforms();

    if (this._ssaoEnabled) this._ensureSsaoBuilt();

    this._refreshOutputNode();
  }

  _ensureSsaoBuilt() {
    if (this._ssaoNode) return;
    if (!this._scenePass) return;

    const { scene, camera } = this;
    const sp = this._scenePass;

    this._ssaoNode = new N8AONode({
      beautyNode: sp.getTextureNode("output"),
      beautyTexture: sp.getTexture("output"),
      depthNode: sp.getTextureNode("depth"),
      depthTexture: sp.getTexture("depth"),
      normalNode: sp.getTextureNode("normal"),
      normalTexture: sp.getTexture("normal"),
      scenePassNode: sp,
      scene,
      camera,
    });

    // n8ao defaults to walking the entire scene every frame to auto-detect
    // transparent materials. We manage `transparencyAware` ourselves, so
    // suppress that traversal directly. (The Proxy setter would only flip
    // this internal flag if the public value actually CHANGED, and our
    // default already matches n8ao's, so we set it manually.)
    this._ssaoNode.autoDetectTransparency = false;

    // n8ao defaults to `gammaCorrection: true`, which sRGB-encodes its
    // composite output. Our pipeline runs the result through `renderOutput()`
    // (tonemap + sRGB) afterwards, so leaving it on causes double-encoding —
    // ACES then squashes the already-encoded values into a flat grey range
    // and the intensity slider's effect becomes invisible. Pin it off here.
    this._ssaoNode.configuration.gammaCorrection = false;

    this._applySsaoConfig();
  }

  _applyBloomUniforms() {
    const p = this._bloomPass;
    if (!p) return;
    p.strength.value = this._bloomParams.strength;
    p.threshold.value = this._bloomParams.threshold;
    p.radius.value = this._bloomParams.radius;
    if (p.smoothWidth) p.smoothWidth.value = this._bloomParams.smoothWidth;
  }

  _applySsaoConfig() {
    const n = this._ssaoNode;
    if (!n) return;
    const c = n.configuration;
    const p = this._ssaoParams;

    // Pin transparencyAware first so the n8ao node's internal
    // `autoDetectTransparency` flag flips to false — otherwise it would
    // walk the entire scene every frame looking for transparent materials.
    if (c.transparencyAware !== p.transparencyAware) {
      c.transparencyAware = p.transparencyAware;
    }

    // Quality preset rebuilds samplers; only re-apply when changed.
    // `applyQualityMode` mutates the configuration in place, which trips
    // the n8ao Proxy setters and rebuilds the AO + denoise passes once.
    applyQualityMode(c, p.quality);

    // Cheap uniform updates.
    c.aoRadius = p.aoRadius;
    c.distanceFalloff = p.distanceFalloff;
    c.intensity = p.intensity;
    c.screenSpaceRadius = p.screenSpaceRadius;
    c.renderMode = resolveDisplayMode(p.displayMode);

    // Slightly more expensive (RT resize / shader rebuild on change), but
    // still fine to set every time the user touches a slider.
    if (c.halfRes !== p.halfRes) c.halfRes = p.halfRes;
    if (c.depthAwareUpsampling !== p.depthAwareUpsampling) {
      c.depthAwareUpsampling = p.depthAwareUpsampling;
    }

    // Color via reused THREE.Color so we don't allocate per change.
    this._ssaoColor.set(p.color);
    if (!c.color.equals(this._ssaoColor)) {
      // Assign a fresh Color so the Proxy setter sees a different reference
      // and the equality check inside it triggers a uniform update.
      c.color = this._ssaoColor.clone();
    }
  }

  _refreshOutputNode() {
    if (!this._renderPipeline) return;

    // SSAO branch: when on, the n8ao node outputs a fully composited
    // beauty + AO texture node — it replaces `scenePassColor` for
    // downstream stages. Bloom still reads from raw `scenePassColor`
    // (see class JSDoc for the rationale).
    const sceneInput =
      this._ssaoEnabled && this._ssaoNode
        ? this._ssaoNode.getTextureNode()
        : this._scenePassColor;

    // Linear-HDR composition (bloom adds in linear).
    const linearComposite = this._bloomEnabled
      ? sceneInput.add(this._bloomPass)
      : sceneInput;

    // Convert to display-referred sRGB before FXAA (FXAA requires sRGB).
    const transformed = renderOutput(linearComposite);

    // FXAA is the last hop when enabled.
    this._renderPipeline.outputNode = this._fxaaEnabled
      ? fxaa(transformed)
      : transformed;
    this._renderPipeline.needsUpdate = true;
  }
}
