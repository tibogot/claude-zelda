/**
 * Grass uniforms for sandbox — imports from grass-sandbox.js.
 * Minimal createUniforms + createSyncUniforms for grass-sandbox.html.
 */
import * as THREE from "three";
import { uniform } from "three/tsl";
import { NEAR_PATCH_SIZE } from "./grass-sandbox.js";

function srgbToLinear(hex) {
  const c = new THREE.Color(hex);
  c.convertSRGBToLinear();
  return c;
}

export function createUniforms(PARAMS, TERRAIN_SIZE, NPC_COUNT) {
  const uTime = uniform(0);
  const uPlayerPos = uniform(new THREE.Vector3(0, 0, 0));
  const uNpcPos = Array.from({ length: NPC_COUNT }, () =>
    uniform(new THREE.Vector3(9999, 0, 9999)),
  );
  const uGrassWidth = uniform(PARAMS.grassWidth);
  const uGrassHeight = uniform(PARAMS.grassHeight);
  const uLodDist = uniform(PARAMS.lodDistance);
  const uMaxDist = uniform(PARAMS.maxDistance);
  const uLodBlendStart = uniform(PARAMS.lodBlendStart);
  const uBladeDensityRegular = uniform(PARAMS.grassBladesRegular);
  const uBladeDensityNear = uniform(PARAMS.grassBladesNear);
  const uNearFadeEnd = uniform(PARAMS.nearRingExtent * NEAR_PATCH_SIZE);
  const uNearFadeRange = uniform(PARAMS.nearFadeRange);
  const uBaseColor1 = uniform(srgbToLinear(PARAMS.baseColor1));
  const uBaseColor2 = uniform(srgbToLinear(PARAMS.baseColor2));
  const uTipColor1 = uniform(srgbToLinear(PARAMS.tipColor1));
  const uTipColor2 = uniform(srgbToLinear(PARAMS.tipColor2));
  const uGradientCurve = uniform(PARAMS.gradientCurve);
  const uColorVariation = uniform(PARAMS.colorVariation);
  const uLushColor = uniform(srgbToLinear(PARAMS.lushColor));
  const uBleachedColor = uniform(srgbToLinear(PARAMS.bleachedColor));
  const uWindSpeed = uniform(PARAMS.windSpeed);
  const uWindStr = uniform(PARAMS.windStrength);
  const uWindWaveScale = uniform(PARAMS.windWaveScale);
  const uWindDirX = uniform(Math.cos(PARAMS.windDir));
  const uWindDirZ = uniform(Math.sin(PARAMS.windDir));
  const uWindAxis = uniform(
    new THREE.Vector3(
      Math.sin(PARAMS.windDir),
      0,
      -Math.cos(PARAMS.windDir),
    ),
  );
  const uCrossAxis = uniform(
    new THREE.Vector3(
      Math.cos(PARAMS.windDir),
      0,
      Math.sin(PARAMS.windDir),
    ),
  );
  const uWindGust = uniform(PARAMS.windGust);
  const uWindMicro = uniform(PARAMS.windMicroSway);
  const uInteractionRange = uniform(PARAMS.interactionRange);
  const uInteractionStrength = uniform(PARAMS.interactionStrength);
  const uInteractionHThresh = uniform(PARAMS.interactionHeightThreshold);
  const uInteractionRepel = uniform(1.0);
  const uMinSkyBlend = uniform(PARAMS.minSkyBlend);
  const uMaxSkyBlend = uniform(PARAMS.maxSkyBlend);
  const uAoIntensity = uniform(PARAMS.aoEnabled ? PARAMS.aoIntensity : 0);
  const uBsIntensity = uniform(PARAMS.bsIntensity);
  const uBsColor = uniform(srgbToLinear(PARAMS.bsColor));
  const uBsPower = uniform(PARAMS.bsPower);
  const uFrontScatter = uniform(PARAMS.frontScatter);
  const uRimSSS = uniform(PARAMS.rimSSS);
  const uSpecV1Intensity = uniform(PARAMS.specV1Enabled ? PARAMS.specV1Intensity : 0);
  const uSpecV1Color = uniform(srgbToLinear(PARAMS.specV1Color));
  const uSpecV1Dir = uniform(
    new THREE.Vector3(PARAMS.specV1DirX, PARAMS.specV1DirY, PARAMS.specV1DirZ).normalize(),
  );
  const uSpecV2Intensity = uniform(PARAMS.specV2Enabled ? PARAMS.specV2Intensity : 0);
  const uSpecV2Color = uniform(srgbToLinear(PARAMS.specV2Color));
  const uSpecV2Dir = uniform(
    new THREE.Vector3(PARAMS.specV2DirX, PARAMS.specV2DirY, PARAMS.specV2DirZ).normalize(),
  );
  const uSpecV2NoiseScale = uniform(PARAMS.specV2NoiseScale);
  const uSpecV2NoiseStr = uniform(PARAMS.specV2NoiseStr);
  const uSpecV2Power = uniform(PARAMS.specV2Power);
  const uSpecV2TipBias = uniform(PARAMS.specV2TipBias);
  const uSeasonalStr = uniform(0);
  const uSeasonalScale = uniform(PARAMS.seasonalScale);
  const uSeasonalDryColor = uniform(srgbToLinear(PARAMS.seasonalDryColor));
  const uSunDir = uniform(
    new THREE.Vector3(
      PARAMS.sunDirX,
      PARAMS.sunDirY,
      PARAMS.sunDirZ,
    ).normalize(),
  );
  const uTerrainSize = uniform(TERRAIN_SIZE);
  const uTrailCenter = uniform(new THREE.Vector2());
  const uTrailSize = uniform(60);

  return {
    uTime,
    uPlayerPos,
    uNpcPos,
    uGrassWidth,
    uGrassHeight,
    uLodDist,
    uMaxDist,
    uLodBlendStart,
    uBladeDensityRegular,
    uBladeDensityNear,
    uNearFadeEnd,
    uNearFadeRange,
    uBaseColor1,
    uBaseColor2,
    uTipColor1,
    uTipColor2,
    uGradientCurve,
    uColorVariation,
    uLushColor,
    uBleachedColor,
    uWindSpeed,
    uWindStr,
    uWindWaveScale,
    uWindDirX,
    uWindDirZ,
    uWindAxis,
    uCrossAxis,
    uWindGust,
    uWindMicro,
    uInteractionRange,
    uInteractionStrength,
    uInteractionHThresh,
    uInteractionRepel,
    uMinSkyBlend,
    uMaxSkyBlend,
    uAoIntensity,
    uBsIntensity,
    uBsColor,
    uBsPower,
    uFrontScatter,
    uRimSSS,
    uSpecV1Intensity,
    uSpecV1Color,
    uSpecV1Dir,
    uSpecV2Intensity,
    uSpecV2Color,
    uSpecV2Dir,
    uSpecV2NoiseScale,
    uSpecV2NoiseStr,
    uSpecV2Power,
    uSpecV2TipBias,
    uSeasonalStr,
    uSeasonalScale,
    uSeasonalDryColor,
    uSunDir,
    uTerrainSize,
    uTrailCenter,
    uTrailSize,
  };
}

export function createSyncUniforms(u, deps) {
  const { PARAMS, camera, dirLight, hemiLight, renderer, charPos, syncTerrainUniforms, updateSkyParams } = deps;

  return function syncUniforms() {
    u.uGrassWidth.value = PARAMS.grassWidth;
    u.uGrassHeight.value = PARAMS.grassHeight;
    u.uGradientCurve.value = PARAMS.gradientCurve;
    u.uLodDist.value = PARAMS.lodDistance;
    u.uMaxDist.value = PARAMS.maxDistance;
    u.uLodBlendStart.value = PARAMS.lodBlendStart;
    u.uBladeDensityRegular.value = PARAMS.grassBladesRegular;
    u.uBladeDensityNear.value = PARAMS.grassBladesNear;
    u.uNearFadeEnd.value = PARAMS.nearRingExtent * NEAR_PATCH_SIZE;
    u.uNearFadeRange.value = PARAMS.nearFadeRange;
    u.uBaseColor1.value.copy(srgbToLinear(PARAMS.baseColor1));
    u.uBaseColor2.value.copy(srgbToLinear(PARAMS.baseColor2));
    u.uTipColor1.value.copy(srgbToLinear(PARAMS.tipColor1));
    u.uTipColor2.value.copy(srgbToLinear(PARAMS.tipColor2));
    u.uColorVariation.value = PARAMS.colorVariation;
    u.uLushColor.value.copy(srgbToLinear(PARAMS.lushColor));
    u.uBleachedColor.value.copy(srgbToLinear(PARAMS.bleachedColor));
    u.uWindSpeed.value = PARAMS.windSpeed;
    u.uWindStr.value = PARAMS.windStrength;
    u.uWindWaveScale.value = PARAMS.windWaveScale;
    u.uWindDirX.value = Math.cos(PARAMS.windDir);
    u.uWindDirZ.value = Math.sin(PARAMS.windDir);
    u.uWindAxis.value.set(
      Math.sin(PARAMS.windDir),
      0,
      -Math.cos(PARAMS.windDir),
    );
    u.uCrossAxis.value.set(
      Math.cos(PARAMS.windDir),
      0,
      Math.sin(PARAMS.windDir),
    );
    u.uWindGust.value = PARAMS.windGust;
    u.uWindMicro.value = PARAMS.windMicroSway;
    u.uInteractionRange.value = PARAMS.interactionEnabled
      ? PARAMS.interactionRange
      : 999;
    u.uInteractionStrength.value = PARAMS.interactionEnabled
      ? PARAMS.interactionStrength
      : 0;
    u.uInteractionHThresh.value = PARAMS.interactionHeightThreshold;
    u.uInteractionRepel.value = PARAMS.interactionRepel ? 1 : -1;
    u.uMinSkyBlend.value = PARAMS.minSkyBlend;
    u.uMaxSkyBlend.value = PARAMS.maxSkyBlend;
    u.uAoIntensity.value = PARAMS.aoEnabled ? PARAMS.aoIntensity : 0;
    u.uBsIntensity.value = PARAMS.bsEnabled ? PARAMS.bsIntensity : 0;
    u.uBsColor.value.copy(srgbToLinear(PARAMS.bsColor));
    u.uBsPower.value = PARAMS.bsPower;
    u.uFrontScatter.value = PARAMS.frontScatter;
    u.uRimSSS.value = PARAMS.rimSSS;
    u.uSpecV1Intensity.value = PARAMS.specV1Enabled ? PARAMS.specV1Intensity : 0;
    u.uSpecV1Color.value.copy(srgbToLinear(PARAMS.specV1Color));
    u.uSpecV1Dir.value.set(PARAMS.specV1DirX, PARAMS.specV1DirY, PARAMS.specV1DirZ).normalize();
    u.uSpecV2Intensity.value = PARAMS.specV2Enabled ? PARAMS.specV2Intensity : 0;
    u.uSpecV2Color.value.copy(srgbToLinear(PARAMS.specV2Color));
    u.uSpecV2Dir.value.set(PARAMS.specV2DirX, PARAMS.specV2DirY, PARAMS.specV2DirZ).normalize();
    u.uSpecV2NoiseScale.value = PARAMS.specV2NoiseScale;
    u.uSpecV2NoiseStr.value = PARAMS.specV2NoiseStr;
    u.uSpecV2Power.value = PARAMS.specV2Power;
    u.uSpecV2TipBias.value = PARAMS.specV2TipBias;
    u.uSeasonalStr.value = PARAMS.seasonalEnabled ? PARAMS.seasonalStrength : 0;
    u.uSeasonalScale.value = PARAMS.seasonalScale;
    u.uSeasonalDryColor.value.copy(srgbToLinear(PARAMS.seasonalDryColor));
    if (syncTerrainUniforms) syncTerrainUniforms(PARAMS);
    const sd = new THREE.Vector3(
      PARAMS.sunDirX,
      PARAMS.sunDirY,
      PARAMS.sunDirZ,
    ).normalize();
    u.uSunDir.value.copy(sd);
    dirLight.position.copy(sd.clone().multiplyScalar(50));
    dirLight.intensity = PARAMS.sunIntensity;
    hemiLight.intensity = PARAMS.sceneAmbient;
    renderer.toneMappingExposure = PARAMS.exposure;
    if (updateSkyParams) updateSkyParams();
    u.uTrailCenter.value.set(charPos.x, charPos.z);
  };
}
