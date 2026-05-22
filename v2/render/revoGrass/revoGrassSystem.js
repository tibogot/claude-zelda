/**
 * Revo-style camera/player-following fluffy grass tile (WebGPU + TSL compute + SpriteNodeMaterial).
 */
import * as THREE from "three";
import { SpriteNodeMaterial } from "three/webgpu";
import {
  Fn,
  mix,
  uniform,
  uv,
  instancedArray,
  instanceIndex,
  hash,
  float,
  floor,
  vec2,
  vec3,
  vec4,
  texture,
  smoothstep,
  sin,
  abs,
  clamp,
  remap,
  time,
  PI2,
  INFINITY,
  length,
  step,
  fract,
} from "three/tsl";
import { createWindTexture } from "../../core/foliage/windTexture.js";
import { getRevoGrassConfig } from "../../core/revoGrass/revoGrassConfig.js";
import { RevoGrassMask } from "../../core/revoGrass/revoGrassMask.js";
import { createRevoBladeGeometry } from "../../core/revoGrass/revoGrassGeometry.js";
import { wrapTileOffsetXZ } from "../../core/revoGrass/revoGrassTile.js";
import {
  computeStochasticKeep,
  computeFrustumVisibility,
  computeGrassShadowFactor,
} from "../../core/revoGrass/revoGrassSsboUtils.js";

function srgbColor(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

function buildUniforms(rp) {
  const windRad = (rp.windAngle ?? 0) * Math.PI / 180;
  return {
    uAnchorDeltaXZ: uniform(new THREE.Vector2()),
    uAnchorPosition: uniform(new THREE.Vector3()),
    uTerrainSize: uniform(0),
    uSunDir: uniform(new THREE.Vector3(0.5, 0.8, 0.3)),
    uCameraForward: uniform(new THREE.Vector3(0, 0, -1)),
    uCameraMatrix: uniform(new THREE.Matrix4()),
    uFx: uniform(1),
    uFy: uniform(1),
    uCullPadNdcX: uniform(rp.cullPadNdcX ?? 0.075),
    uCullPadNdcYNear: uniform(rp.cullPadNdcYNear ?? 0.75),
    uCullPadNdcYFar: uniform(rp.cullPadNdcYFar ?? 0.2),
    uFrustumCullEnabled: uniform(rp.frustumCullEnabled !== false ? 1 : 0),
    uBladeBoundsRadius: uniform(rp.bladeHeight ?? 1.75),
    uBladeMinScale: uniform(rp.bladeMinScale ?? 0.75),
    uBladeMaxScale: uniform(rp.bladeMaxScale ?? 2),
    uTrailGrowthRate: uniform(rp.trailGrowthRate ?? 0.04),
    uTrailMinScale: uniform(rp.trailMinScale ?? 0.25),
    uTrailRadius: uniform(rp.trailRadius ?? 1),
    uTrailRadiusSq: uniform((rp.trailRadius ?? 1) ** 2),
    uKDown: uniform(rp.trailCrushSpeed ?? 0.4),
    uWindStrength: uniform(rp.windStrength ?? 0.4),
    uWindSpeed: uniform(rp.windSpeed ?? 0.25),
    uWindIntensity: uniform(rp.windIntensity ?? 1),
    uWindDir: uniform(new THREE.Vector2(Math.cos(windRad), Math.sin(windRad))),
    uUvWindScale: uniform(rp.uvWindScale ?? 1.75),
    uBaseColor: uniform(srgbColor(rp.baseColor ?? "#8c6b30")),
    uTipColor: uniform(srgbColor(rp.tipColor ?? "#4a780a")),
    uColorMixFactor: uniform(rp.colorMixFactor ?? 0.125),
    uColorVariationStrength: uniform(rp.colorVariationStrength ?? 2.75),
    uWindColorStrength: uniform(rp.windColorStrength ?? 0.6),
    uColorBrightness: uniform(rp.colorBrightness ?? 1),
    uAoScale: uniform(rp.aoScale ?? 0.5),
    uAoRimSmoothness: uniform(rp.aoRimSmoothness ?? 5),
    uAoRadiusSq: uniform((rp.aoRadius ?? 25) ** 2),
    uBaseWindShade: uniform(rp.baseWindShade ?? 0.75),
    uBaseShadeHeight: uniform(rp.baseShadeHeight ?? 1),
    uBaseBending: uniform(rp.baseBending ?? 2),
    uStochasticR0: uniform(rp.stochasticR0 ?? 10),
    uStochasticR1: uniform(rp.stochasticR1 ?? 60),
    uStochasticPMin: uniform(rp.stochasticPMin ?? 0.1),
    uPlayerRadius: uniform(rp.playerRadius ?? 0.5),
    uTileSize: uniform(0),
    uBakedShadowWeight: uniform(rp.bakedShadowWeight ?? 1),
    uPlayerShadowEnabled: uniform(rp.playerShadowEnabled !== false ? 1 : 0),
    uExclusionEnabled: uniform(rp.exclusionEnabled ? 1 : 0),
    uExclusionThreshold: uniform(rp.exclusionThreshold ?? 0.25),
  };
}

function createSsbo(config, uniforms, { heightTex, windTex, exclusionTex }) {
  const buffer1 = instancedArray(config.count, "vec4");
  const buffer2 = instancedArray(config.count, "vec4");
  const bufferVis = instancedArray(config.count, "float");
  const bufferShadow = instancedArray(config.count, "float");
  const bufferWindNoise = instancedArray(config.count, "float");

  const fBladesPerSide = float(config.bladesPerSide);
  const fSpacing = float(config.spacing);
  const fTileHalf = float(config.tileHalfSize);
  const fTileSize = float(config.tileSize);
  const fSpacingJitter = fSpacing.mul(0.5);

  const computeInit = Fn(() => {
    const data1 = buffer1.element(instanceIndex);
    const data2 = buffer2.element(instanceIndex);
    const row = floor(float(instanceIndex).div(fBladesPerSide));
    const col = float(instanceIndex).mod(fBladesPerSide);
    const randX = hash(instanceIndex.add(4321));
    const randZ = hash(instanceIndex.add(1234));
    const offsetX = col.mul(fSpacing).sub(fTileHalf).add(randX.mul(fSpacingJitter));
    const offsetZ = row.mul(fSpacing).sub(fTileHalf).add(randZ.mul(fSpacingJitter));
    const noiseUv = vec2(offsetX, offsetZ).add(fTileHalf).div(fTileSize).abs().fract();
    const noise = texture(windTex, noiseUv);
    const wrapNoise = noise.b.sub(0.5);
    data1.x.assign(offsetX.add(wrapNoise.mul(17).fract()));
    data1.y.assign(offsetZ.add(wrapNoise.mul(13).fract()));
    data1.z.assign(float(0));
    data1.w.assign(float(0));
    const posNoise = noise.g;
    data2.x.assign(float(0));
    const n = noise.b;
    const shaped = n.mul(n);
    const randomScale = remap(shaped, 0, 1, uniforms.uBladeMinScale, uniforms.uBladeMaxScale);
    data2.y.assign(randomScale);
    data2.z.assign(randomScale);
    data2.w.assign(posNoise);
    bufferVis.element(instanceIndex).assign(float(1));
    bufferShadow.element(instanceIndex).assign(float(1));
    bufferWindNoise.element(instanceIndex).assign(float(0));
  })().compute(config.count, [config.workgroupSize]);

  const computeWind = Fn(([prevWind, worldPos, posNoise]) => {
    const dir = uniforms.uWindDir.negate();
    const speed = uniforms.uWindSpeed.mul(posNoise.remap(0, 1, 0.95, 2.05));
    const uvBase = worldPos.xz.mul(0.01).mul(uniforms.uUvWindScale);
    const scroll = dir.mul(speed).mul(time);
    const uvA = uvBase.add(scroll);
    const nA = texture(windTex, uvA).mul(2).sub(1);
    const uvB = uvBase.mul(1.37).add(scroll.mul(1.11));
    const nB = texture(windTex, uvB).mul(2).sub(1);
    const mixRand = fract(sin(posNoise.mul(12.9898)).mul(78.233));
    const mixTime = sin(time.mul(0.4).add(posNoise.mul(0.1))).mul(0.25);
    const w = clamp(mixRand.add(mixTime), 0.2, 0.8);
    const n = mix(nA, nB, w);
    const windFactor = n.r.mul(uniforms.uWindStrength).add(n.g.mul(uniforms.uWindStrength).mul(0.35));
    const target = dir.mul(windFactor);
    const k = mix(0.08, 0.25, abs(n.b));
    const newWind = prevWind.add(target.sub(prevWind).mul(k));
    return vec3(newWind.x, newWind.y, windFactor);
  });

  const computeTrailScale = Fn(([originalScale, currentScale, stepped]) => {
    const up = currentScale.add(originalScale.sub(currentScale).mul(uniforms.uTrailGrowthRate));
    const down = currentScale.add(uniforms.uTrailMinScale.sub(currentScale).mul(uniforms.uKDown));
    return mix(up, down, stepped);
  });

  const computeUpdate = Fn(() => {
    const data1 = buffer1.element(instanceIndex);
    const data2 = buffer2.element(instanceIndex);

    const wrapped = wrapTileOffsetXZ(vec2(data1.x, data1.y), uniforms.uAnchorDeltaXZ, uniforms.uTileSize);
    data1.x.assign(wrapped.x);
    data1.y.assign(wrapped.y);

    const worldPos = vec3(
      wrapped.x.add(uniforms.uAnchorPosition.x),
      float(0),
      wrapped.y.add(uniforms.uAnchorPosition.z),
    );

    const stochasticKeep = computeStochasticKeep(
      worldPos,
      uniforms.uAnchorPosition,
      uniforms.uStochasticR0,
      uniforms.uStochasticR1,
      uniforms.uStochasticPMin,
    );

    const frustumVis = mix(
      float(1),
      computeFrustumVisibility(
        worldPos,
        uniforms.uCameraMatrix,
        uniforms.uFx,
        uniforms.uFy,
        uniforms.uBladeBoundsRadius,
        uniforms.uCullPadNdcX,
        uniforms.uCullPadNdcYNear,
        uniforms.uCullPadNdcYFar,
      ),
      uniforms.uFrustumCullEnabled,
    );

    const terrainUV = worldPos.xz.div(uniforms.uTerrainSize).add(0.5);
    const exclAlpha = mix(
      float(1),
      step(uniforms.uExclusionThreshold, texture(exclusionTex, terrainUV).g),
      uniforms.uExclusionEnabled,
    );
    const yOffset = texture(heightTex, terrainUV).x;
    data2.x.assign(yOffset);
    const isVisible = stochasticKeep
      .mul(frustumVis)
      .mul(exclAlpha)
      .mul(step(float(-500), yOffset));

    const diff = worldPos.xz.sub(uniforms.uAnchorPosition.xz);
    const distSq = diff.dot(diff);
    const inner = uniforms.uTrailRadiusSq.mul(0.35);
    const outer = uniforms.uTrailRadiusSq;
    const grounded = step(float(0.1), float(1).sub(uniforms.uAnchorPosition.y.sub(yOffset)));
    const contact = float(1).sub(smoothstep(inner, outer, distSq)).mul(grounded);

    const currentScale = data2.y;
    const originalScale = data2.z;
    data2.y.assign(computeTrailScale(originalScale, currentScale, contact));

    const posNoise = data2.w;
    const prevWind = vec2(data1.z, data1.w);
    const newWind = computeWind(prevWind, worldPos, posNoise);
    data1.z.assign(newWind.x);
    data1.w.assign(newWind.y);
    bufferWindNoise.element(instanceIndex).assign(newWind.z);

    const grassWorldPos = vec3(worldPos.x, yOffset, worldPos.z);
    const shadowFactor = mix(
      float(1),
      computeGrassShadowFactor(
        grassWorldPos,
        uniforms.uAnchorPosition,
        uniforms.uPlayerRadius,
        uniforms.uBakedShadowWeight,
      ),
      uniforms.uPlayerShadowEnabled,
    );
    bufferShadow.element(instanceIndex).assign(shadowFactor);
    bufferVis.element(instanceIndex).assign(isVisible);
  })().compute(config.count, [config.workgroupSize]);

  return {
    buffer1,
    buffer2,
    bufferVis,
    bufferShadow,
    bufferWindNoise,
    computeInit,
    computeUpdate,
  };
}

function createMaterial(ssbo, uniforms) {
  class RevoGrassMaterial extends SpriteNodeMaterial {
    constructor() {
      super();
      this.precision = "lowp";
      this.transparent = false;
      this.stencilWrite = false;
      this.forceSinglePass = true;

      const data1 = ssbo.buffer1.element(instanceIndex);
      const data2 = ssbo.buffer2.element(instanceIndex);
      const isVisible = ssbo.bufferVis.element(instanceIndex);
      const shadowFactor = ssbo.bufferShadow.element(instanceIndex);
      const windNoiseFactor = ssbo.bufferWindNoise.element(instanceIndex);
      const offsetX = data1.x;
      const offsetY = data2.x;
      const offsetZ = data1.y;
      const windXZ = vec2(data1.z, data1.w);
      const scaleY = data2.y;
      const positionNoise = data2.w;

      this.opacityNode = isVisible;
      const scaleX = positionNoise.remap(0, 1, 0.5, 1.5);
      const bladeScale = vec3(scaleX, scaleY, 1);
      this.scaleNode = mix(vec3(0), bladeScale, isVisible);

      const instanceNoise = hash(instanceIndex.add(196.4356)).sub(0.5).mul(0.25);
      const h = uv().y;
      const bendProfile = h.mul(h).mul(uniforms.uBaseBending);
      const baseBending = positionNoise.sub(0.5).mul(0.25).add(instanceNoise).mul(bendProfile);
      this.rotationNode = vec3(baseBending, 0, 0);

      const offscreenOffset = uniforms.uCameraForward.mul(INFINITY).mul(float(1).sub(isVisible));
      const bladePosition = vec3(offsetX, offsetY, offsetZ);
      const randomPhase = positionNoise.mul(PI2);
      const swayAmount = sin(time.mul(5).add(randomPhase)).mul(0.15);
      const swayFactor = h.mul(windNoiseFactor);
      const swayOffset = swayAmount.mul(swayFactor);
      const dirXZ = uniforms.uWindDir;
      const perp = vec2(dirXZ.y.negate(), dirXZ.x);
      const phase = hash(instanceIndex).mul(PI2);
      const flutter = sin(time.mul(uniforms.uWindSpeed.mul(1.7)).add(phase.mul(1.3))).mul(0.06).mul(bendProfile);
      const flutterOffset = vec3(perp.x, 0, perp.y).mul(flutter);
      const windY = float(1).sub(h.mul(h)).mul(uniforms.uWindIntensity).mul(0.25);
      const windOffset = vec3(windXZ.x, windY, windXZ.y).mul(bendProfile);

      this.positionNode = bladePosition
        .add(offscreenOffset)
        .add(swayOffset)
        .add(flutterOffset)
        .add(windOffset);

      const r2 = offsetX.mul(offsetX).add(offsetZ.mul(offsetZ));
      const near = float(1).sub(smoothstep(0, uniforms.uAoRadiusSq, r2));
      const edge = uv().x.mul(2).sub(1).abs();
      const rim = smoothstep(uniforms.uAoRimSmoothness.negate(), uniforms.uAoRimSmoothness, edge);
      const hWeight = float(1).sub(smoothstep(0.1, 0.85, h));
      const aoStrength = uniforms.uAoScale.mul(0.25);
      const ao = float(1).sub(aoStrength.mul(near.mul(rim).mul(hWeight)));

      const colorProfile = h.mul(uniforms.uColorMixFactor);
      const jitter = smoothstep(0, uniforms.uColorVariationStrength, positionNoise);
      const baseColorJittered = uniforms.uBaseColor.mul(jitter);
      const baseToTip = mix(baseColorJittered, uniforms.uTipColor, colorProfile);
      const baseMask = float(1).sub(smoothstep(0, uniforms.uBaseShadeHeight, h));
      const windAo = mix(
        1,
        float(1).sub(uniforms.uBaseWindShade),
        baseMask.mul(smoothstep(0, 1, swayFactor)),
      );
      const windTint = mix(float(1), float(1).add(uniforms.uWindColorStrength.mul(0.15)), swayFactor.mul(0.35));
      const withShadow = mix(baseToTip.mul(0.5), baseToTip, shadowFactor);
      this.colorNode = withShadow.mul(windAo).mul(windTint).mul(ao).mul(uniforms.uColorBrightness);
    }
  }
  return new RevoGrassMaterial();
}

export class RevoGrassSystem {
  constructor({ scene, config }) {
    this.scene = scene;
    this.config = config;
    this.group = new THREE.Group();
    this.group.name = "RevoGrass";
    scene.add(this.group);

    this._mesh = null;
    this._ssbo = null;
    this._uniforms = null;
    this._revoConfig = null;
    this._windTex = createWindTexture();
    this.mask = new RevoGrassMask(512);
    this._exclusionTex = this.mask.texture;
    this._exclusionSource = "mask";
    this._initialized = false;
    this._enabled = false;
    this._computeBusy = false;
    this._lastAnchor = new THREE.Vector3();
    this._anchorDelta = new THREE.Vector2();
    this._cameraMatrix = new THREE.Matrix4();
    this._lastComputeMs = 0;
    this._playWindIntensity = 1;
    this._playWindAngleDeg = null;
  }

  resolveExclusionTexture(rp, geminiDensityTex) {
    const src = rp.exclusionSource ?? "mask";
    this._exclusionSource = src;
    if (src === "gemini" && geminiDensityTex) return geminiDensityTex;
    return this.mask.texture;
  }

  async init(renderer, heightTex, sunDir, toolState, opts = {}) {
    if (this._initialized) return;
    this._renderer = renderer;
    this._heightTex = heightTex;
    this._geminiDensityTex = opts.geminiDensityTex ?? null;
    this._exclusionTex = this.resolveExclusionTexture(toolState.revoGrass, this._geminiDensityTex);
    this._initialized = true;
    await this.rebuild(toolState.revoGrass, sunDir);
  }

  async rebuild(rp, sunDir) {
    this.disposeMesh();
    if (!this._heightTex || !this._windTex) {
      console.warn("[RevoGrass] rebuild skipped — height/wind texture not ready");
      return;
    }
    this._exclusionTex = this.resolveExclusionTexture(rp, this._geminiDensityTex);
    this._revoConfig = getRevoGrassConfig(rp);
    const cfg = this._revoConfig;
    this._uniforms = buildUniforms(rp);
    const u = this._uniforms;
    u.uTerrainSize.value = this.config.world.size;
    u.uTileSize.value = cfg.tileSize;
    u.uBladeBoundsRadius.value = cfg.bladeHeight;
    if (sunDir) u.uSunDir.value.copy(sunDir);

    this._ssbo = createSsbo(cfg, u, {
      heightTex: this._heightTex,
      windTex: this._windTex,
      exclusionTex: this._exclusionTex,
    });
    const geom = createRevoBladeGeometry(cfg);
    const mat = createMaterial(this._ssbo, u);
    this._mesh = new THREE.InstancedMesh(geom, mat, cfg.count);
    this._mesh.frustumCulled = false;
    this._mesh.receiveShadow = true;
    this._mesh.castShadow = false;
    this.group.add(this._mesh);

    await this._renderer.computeAsync(this._ssbo.computeInit);
    this.setEnabled(rp.enabled);
  }

  disposeMesh() {
    if (this._mesh) {
      this.group.remove(this._mesh);
      this._mesh.geometry?.dispose();
      this._mesh.material?.dispose();
      this._mesh = null;
    }
    this._ssbo = null;
  }

  dispose() {
    this.disposeMesh();
    this.mask?.dispose();
    this.scene.remove(this.group);
    this._initialized = false;
  }

  setEnabled(on) {
    this._enabled = !!on;
    this.group.visible = this._enabled;
  }

  syncFromState(rp, sunDir) {
    if (!this._uniforms) return;
    const u = this._uniforms;
    u.uBladeMinScale.value = rp.bladeMinScale ?? 0.75;
    u.uBladeMaxScale.value = rp.bladeMaxScale ?? 2;
    u.uBladeBoundsRadius.value = rp.bladeHeight ?? 1.75;
    u.uTrailGrowthRate.value = rp.trailGrowthRate ?? 0.04;
    u.uTrailMinScale.value = rp.trailMinScale ?? 0.25;
    const tr = rp.trailRadius ?? 1;
    u.uTrailRadius.value = tr;
    u.uTrailRadiusSq.value = tr * tr;
    u.uKDown.value = rp.trailCrushSpeed ?? 0.4;
    u.uWindStrength.value = rp.windStrength ?? 0.4;
    u.uWindSpeed.value = rp.windSpeed ?? 0.25;
    u.uWindIntensity.value = rp.windIntensity ?? 1;
    const wr = (rp.windAngle ?? 0) * Math.PI / 180;
    u.uWindDir.value.set(Math.cos(wr), Math.sin(wr));
    u.uUvWindScale.value = rp.uvWindScale ?? 1.75;
    u.uBaseColor.value.copy(srgbColor(rp.baseColor ?? "#8c6b30"));
    u.uTipColor.value.copy(srgbColor(rp.tipColor ?? "#4a780a"));
    u.uColorMixFactor.value = rp.colorMixFactor ?? 0.125;
    u.uColorVariationStrength.value = rp.colorVariationStrength ?? 2.75;
    u.uWindColorStrength.value = rp.windColorStrength ?? 0.6;
    u.uColorBrightness.value = rp.colorBrightness ?? 1;
    u.uAoScale.value = rp.aoScale ?? 0.5;
    u.uAoRimSmoothness.value = rp.aoRimSmoothness ?? 5;
    const aoR = rp.aoRadius ?? 25;
    u.uAoRadiusSq.value = aoR * aoR;
    u.uBaseWindShade.value = rp.baseWindShade ?? 0.75;
    u.uBaseShadeHeight.value = rp.baseShadeHeight ?? 1;
    u.uBaseBending.value = rp.baseBending ?? 2;
    u.uStochasticR0.value = rp.stochasticR0 ?? 10;
    u.uStochasticR1.value = rp.stochasticR1 ?? 60;
    u.uStochasticPMin.value = rp.stochasticPMin ?? 0.1;
    u.uPlayerRadius.value = rp.playerRadius ?? 0.5;
    u.uCullPadNdcX.value = rp.cullPadNdcX ?? 0.075;
    u.uCullPadNdcYNear.value = rp.cullPadNdcYNear ?? 0.75;
    u.uCullPadNdcYFar.value = rp.cullPadNdcYFar ?? 0.2;
    u.uFrustumCullEnabled.value = rp.frustumCullEnabled !== false ? 1 : 0;
    u.uBakedShadowWeight.value = rp.bakedShadowWeight ?? 1;
    u.uPlayerShadowEnabled.value = rp.playerShadowEnabled !== false ? 1 : 0;
    u.uExclusionEnabled.value = rp.exclusionEnabled ? 1 : 0;
    u.uExclusionThreshold.value = rp.exclusionThreshold ?? 0.25;
    if (sunDir) u.uSunDir.value.copy(sunDir);
    this.setEnabled(rp.enabled);
  }

  setPlayWind({ intensityMul, angleDeg } = {}) {
    if (intensityMul != null) this._playWindIntensity = intensityMul;
    if (angleDeg != null) this._playWindAngleDeg = angleDeg;
  }

  update(rp, anchorPos, camera, opts = {}) {
    if (!this._initialized || !this._enabled || !this._mesh || !this._ssbo) return;

    const minInterval = rp.computeMinIntervalMs ?? 0;
    if (minInterval > 0) {
      const now = performance.now();
      if (now - this._lastComputeMs < minInterval) return;
      this._lastComputeMs = now;
    }

    const u = this._uniforms;
    if (opts.playMode && rp.useGlobalWindInPlay !== false) {
      u.uWindIntensity.value = (rp.windIntensity ?? 1) * this._playWindIntensity;
      if (this._playWindAngleDeg != null) {
        const wr = this._playWindAngleDeg * Math.PI / 180;
        u.uWindDir.value.set(Math.cos(wr), Math.sin(wr));
      }
    }
    const dx = anchorPos.x - this._lastAnchor.x;
    const dz = anchorPos.z - this._lastAnchor.z;
    this._anchorDelta.set(dx, dz);
    u.uAnchorDeltaXZ.value.copy(this._anchorDelta);
    u.uAnchorPosition.value.copy(anchorPos);
    this._mesh.position.set(anchorPos.x, 0, anchorPos.z);

    if (camera) {
      camera.getWorldDirection(u.uCameraForward.value);
      this._cameraMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      u.uCameraMatrix.value.copy(this._cameraMatrix);
      const e = camera.projectionMatrix.elements;
      u.uFx.value = e[0];
      u.uFy.value = e[5];
    }

    this._lastAnchor.copy(anchorPos);

    if (this._computeBusy) return;
    this._computeBusy = true;
    this._renderer
      .computeAsync(this._ssbo.computeUpdate)
      .catch((err) => console.error("[RevoGrass] compute failed:", err))
      .finally(() => {
        this._computeBusy = false;
      });
  }

  precompile(renderer, camera) {
    if (!this._mesh) return Promise.resolve();
    return renderer.compileAsync(this._mesh, camera);
  }
}
