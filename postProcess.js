/**
 * Post-processing: fog, bloom, lensflare. Builds the overworld output node.
 */
import {
  pass,
  float,
  uniform,
  mul,
  div,
  sub,
  clamp,
  mix,
  vec4,
  step,
} from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
import { lensflare } from "three/addons/tsl/display/LensflareNode.js";
import { gaussianBlur } from "three/addons/tsl/display/GaussianBlurNode.js";

/**
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{ uFogNear: any, uFogFar: any, uFogCameraFar: any, uFogIntensity: any, uFogColor: any, uFogEnabled: any }} fogUniforms
 * @param {object} PARAMS
 * @returns {{ outputNode: any, bloomPass: any, flareThreshold: any, flareGhostAttenuation: any, flareGhostSpacing: any, uFlareAmount: any }}
 */
export function createPostProcessOutput(scene, camera, fogUniforms, PARAMS) {
  const {
    uFogNear,
    uFogFar,
    uFogCameraFar,
    uFogIntensity,
    uFogColor,
    uFogEnabled,
  } = fogUniforms;

  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode
    ? scenePass.getTextureNode()
    : scenePass;
  const linearDepth = scenePass.getLinearDepthNode
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
  const foggedOutput = mix(
    sceneColor,
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
  const outputNode = foggedOutput.add(flareBlurPass.mul(uFlareAmount));

  return {
    outputNode,
    bloomPass,
    flareThreshold,
    flareGhostAttenuation,
    flareGhostSpacing,
    uFlareAmount,
  };
}
