/**
 * Post-processing: fog, bloom, lensflare, DoF, god rays, GTAO. Builds the overworld output node.
 */
import * as THREE from "three";
import {
  pass,
  float,
  uniform,
  mul,
  div,
  sub,
  add,
  clamp,
  mix,
  vec4,
  step,
  abs,
  smoothstep,
  uv,
  Loop,
  Fn,
  int,
  convertToTexture,
  nodeObject,
  mrt,
  output,
  normalView,
  directionToColor,
  colorToDirection,
  sample,
  screenUV,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { lensflare } from "three/addons/tsl/display/LensflareNode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";
import { boxBlur } from "three/addons/tsl/display/boxBlur.js";
import { ao } from "three/addons/tsl/display/GTAONode.js";
import { denoise } from "three/addons/tsl/display/DenoiseNode.js";

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{ uFogNear: any, uFogFar: any, uFogCameraFar: any, uFogIntensity: any, uFogColor: any, uFogEnabled: any, uSunScreenPos: any }} fogUniforms
 * @param {object} PARAMS
 * @returns {{ outputNode: any, bloomPass: any, aoPass: any, uGtaoEnabled: any, uGtaoIntensity: any, ... }}
 */
export function createPostProcessOutput(scene, camera, fogUniforms, PARAMS) {
  const {
    uFogNear,
    uFogFar,
    uFogCameraFar,
    uFogIntensity,
    uFogColor,
    uFogEnabled,
    uSunScreenPos,
  } = fogUniforms;

  const uGtaoEnabled = uniform(
    PARAMS.postProcessingEnabled && PARAMS.gtaoEnabled ? 1 : 0,
  );
  const uGtaoIntensity = uniform(PARAMS.gtaoIntensity);

  let scenePass;
  let sceneColor;
  let linearDepth;
  let aoPass;

  // Always build MRT+GTAO so it works when user enables both at runtime (no refresh).
  // uGtaoEnabled gates the effect to only apply when postProcessingEnabled && gtaoEnabled.
  scenePass = pass(scene, camera);
  scenePass.setMRT(
    mrt({
      output: output,
      normal: directionToColor(normalView),
    }),
  );
  const scenePassColor = scenePass.getTextureNode("output");
  const scenePassDepth = scenePass.getTextureNode("depth");
  const scenePassNormalEncoded = scenePass.getTextureNode("normal");
  const scenePassNormal = sample((uvCoord) =>
    colorToDirection(scenePassNormalEncoded.sample(uvCoord)),
  );
  const normalTexture = scenePass.getTexture("normal");
  if (normalTexture) normalTexture.type = THREE.UnsignedByteType;
  aoPass = ao(scenePassDepth, scenePassNormal, camera);
  aoPass.resolutionScale = PARAMS.gtaoResolutionScale;
  aoPass.radius.value = PARAMS.gtaoRadius;
  aoPass.samples.value = PARAMS.gtaoSamples;
  aoPass.scale.value = PARAMS.gtaoScale;
  aoPass.distanceFallOff.value = PARAMS.gtaoDistanceFallOff;
  aoPass.distanceExponent.value = PARAMS.gtaoDistanceExponent;
  aoPass.thickness.value = PARAMS.gtaoThickness;
  const aoTex = aoPass.getTextureNode();
  const denoisePass = denoise(aoTex, scenePassDepth, scenePassNormal, camera);
  // DenoiseNode.updateBefore expects texture.image; render-target textures don't have it.
  // We set _resolution in syncUniforms instead.
  denoisePass.updateBefore = () => {};
  denoisePass.radius.value = PARAMS.gtaoDenoiseRadius;
  denoisePass.lumaPhi.value = PARAMS.gtaoDenoiseLumaPhi;
  denoisePass.depthPhi.value = PARAMS.gtaoDenoiseDepthPhi;
  denoisePass.normalPhi.value = PARAMS.gtaoDenoiseNormalPhi;
  const uGtaoDenoiseEnabled = uniform(PARAMS.gtaoDenoiseEnabled ? 1 : 0);
  const rawAoVal = aoTex.sample(screenUV).r;
  const denoisedAoVal = denoisePass.r;
  const aoVal = mix(rawAoVal, denoisedAoVal, uGtaoDenoiseEnabled);
  sceneColor = vec4(
    scenePassColor.rgb.mul(sub(1, mul(mul(aoVal, uGtaoIntensity), uGtaoEnabled))),
    scenePassColor.a,
  );
  linearDepth = scenePass.getLinearDepthNode
    ? scenePass.getLinearDepthNode()
    : float(0.5);
  const worldDepth = mul(linearDepth, uFogCameraFar);
  const fogF = mul(
    clamp(
      mul(
        div(sub(worldDepth, uFogNear), sub(uFogFar, uFogNear)),
        uFogIntensity,
      ),
      0,
      1,
    ),
    uFogEnabled,
  );
  const skyMask = step(float(0.999), linearDepth);
  // DoF: blur based on world depth distance from focus
  const uDofEnabled = uniform(0);
  const uDofFocusDistance = uniform(PARAMS.dofFocusDistance);
  const uDofBlurStart = uniform(PARAMS.dofBlurStart);
  const uDofBlurEnd = uniform(PARAMS.dofBlurEnd);
  const uDofBlurSize = uniform(PARAMS.dofBlurSize);
  const uDofBlurSpread = uniform(PARAMS.dofBlurSpread);
  const sceneBlurred = boxBlur(sceneColor, {
    size: uDofBlurSize,
    separation: uDofBlurSpread,
  });
  const dofBlurAmount = smoothstep(
    uDofBlurStart,
    uDofBlurEnd,
    abs(sub(worldDepth, uDofFocusDistance)),
  );
  const sceneColorForFog = mix(
    sceneColor,
    sceneBlurred,
    mul(dofBlurAmount, uDofEnabled),
  );
  const foggedOutput = mix(
    sceneColorForFog,
    vec4(uFogColor, 1),
    mul(fogF, sub(1, skyMask)),
  );
  // Only bloom the sky (far depth) — excludes character, grass, terrain regardless of color
  const skyOnlyColor = mix(vec4(0, 0, 0, 0), sceneColor, skyMask);
  const bloomPass = bloom(skyOnlyColor, 1, 0.5, PARAMS.lensflareBloomThreshold);
  const flareThreshold = uniform(0.6);
  const flareGhostAttenuation = uniform(25);
  const flareGhostSpacing = uniform(0.25);
  const flarePass = lensflare(bloomPass, {
    threshold: flareThreshold,
    ghostAttenuationFactor: flareGhostAttenuation,
    ghostSpacing: flareGhostSpacing,
  });
  const flareBlurPass = gaussianBlur(flarePass, null, 8);
  const uFlareAmount = uniform(1);
  // God rays: screen-space radial blur from sun position
  const uGodRaysEnabled = uniform(0);
  const uGodRaysStrength = uniform(PARAMS.godRaysStrength);
  const uGodRaysDecay = uniform(PARAMS.godRaysDecay);
  const uGodRaysDensity = uniform(PARAMS.godRaysDensity);
  const uGodRaysSamples = uniform(PARAMS.godRaysSamples);
  const sceneTex = convertToTexture(sceneColor);
  const godRaysFn = Fn(() => {
    const uvNode = uv();
    const stepUV = sub(nodeObject(uSunScreenPos), uvNode)
      .mul(uGodRaysDensity)
      .div(uGodRaysSamples);
    const illumination = float(0).toVar();
    const decayVar = float(1).toVar();
    Loop(
      { start: int(0), end: int(uGodRaysSamples), type: "int", condition: "<" },
      ({ i }) => {
        const sampleUV = add(uvNode, stepUV.mul(float(i)));
        const s = sceneTex.sample(sampleUV);
        const lum = add(
          add(mul(s.r, 0.299), mul(s.g, 0.587)),
          mul(s.b, 0.114),
        );
        illumination.addAssign(mul(lum, decayVar));
        decayVar.mulAssign(uGodRaysDecay);
      },
    );
    const normalized = illumination.div(uGodRaysSamples);
    return vec4(normalized, normalized, normalized, 1)
      .mul(uGodRaysStrength)
      .mul(uGodRaysEnabled);
  });
  const godRaysNode = godRaysFn();
  const outputNode = foggedOutput
    .add(flareBlurPass.mul(uFlareAmount))
    .add(godRaysNode);

  return {
    outputNode,
    bloomPass,
    aoPass,
    denoisePass,
    uGtaoEnabled,
    uGtaoIntensity,
    uGtaoDenoiseEnabled,
    uDofEnabled,
    uDofFocusDistance,
    uDofBlurStart,
    uDofBlurEnd,
    uDofBlurSize,
    uDofBlurSpread,
    flareThreshold,
    flareGhostAttenuation,
    flareGhostSpacing,
    uFlareAmount,
    uGodRaysEnabled,
    uGodRaysStrength,
    uGodRaysDecay,
    uGodRaysDensity,
    uGodRaysSamples,
  };
}
