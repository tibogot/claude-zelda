/**
 * Standalone port of folio MeshDefaultMaterial (no Game singleton).
 */
import * as THREE from "three/webgpu";
import { Fn, color, float, frontFacing, If, max, mix, normalWorld, uniform, vec3, vec4 } from "three/tsl";

/**
 * @param {object} lighting — uniforms used by the folio lighting pipeline
 * @param {object} [parameters]
 */
export class FolioMeshDefaultMaterial extends THREE.MeshLambertNodeMaterial {
  constructor(lighting, parameters = {}) {
    super();

    this.lighting = lighting;

    this.depthWrite = parameters.depthWrite ?? true;
    this.depthTest = parameters.depthTest ?? true;
    this.side = parameters.side ?? THREE.FrontSide;
    this.wireframe = parameters.wireframe ?? false;
    this.transparent = parameters.transparent ?? false;
    this.shadowSide = parameters.shadowSide ?? THREE.FrontSide;

    this.hasCoreShadows = parameters.hasCoreShadows ?? true;
    this.hasDropShadows = parameters.hasDropShadows ?? true;
    this.hasLightBounce = parameters.hasLightBounce ?? true;
    this.hasFog = parameters.hasFog ?? true;
    this.hasWater = parameters.hasWater ?? true;

    this._colorNode = parameters.colorNode ?? color(0xffffff);
    this._normalNode = parameters.normalNode ?? normalWorld;
    this._alphaNode = parameters.alphaNode ?? float(1);
    this._shadowNode = parameters.shadowNode ?? float(0);
    this.alphaTest = parameters.alphaTest ?? 0.1;

    this.normalNode = this._normalNode;

    const catchedShadow = float(1).toVar();

    if (this.hasDropShadows) {
      this.receivedShadowNode = Fn(([shadow]) => {
        catchedShadow.mulAssign(shadow.r);
        return float(1);
      });
    }

    this.outputNode = Fn(() => {
      const baseColor = this._colorNode.toVar();
      const outputColor = this._colorNode.toVar();

      const reorientedNormal = this._normalNode.toVar();
      if (this.side === THREE.DoubleSide || this.side === THREE.BackSide) {
        If(frontFacing.not(), () => {
          reorientedNormal.mulAssign(-1);
        });
      }

      outputColor.mulAssign(
        this.lighting.colorUniform.mul(this.lighting.intensityUniform)
      );

      let coreShadowMix = float(0);
      if (this.hasCoreShadows) {
        coreShadowMix = reorientedNormal
          .dot(this.lighting.directionUniform)
          .smoothstep(
            this.lighting.coreShadowEdgeHigh,
            this.lighting.coreShadowEdgeLow
          );
      }

      let dropShadowMix = float(0);
      if (this.hasDropShadows) {
        dropShadowMix = catchedShadow.oneMinus();
      }

      if (this.hasCoreShadows || this.hasDropShadows) {
        const combinedShadowMix = max(
          coreShadowMix,
          dropShadowMix,
          this._shadowNode
        ).clamp(0, 1);
        const shadowColor = baseColor.rgb.mul(this.lighting.shadowColor).rgb;
        outputColor.assign(mix(outputColor, shadowColor, combinedShadowMix));
      }

      this._alphaNode.lessThan(this.alphaTest).discard();

      return vec4(outputColor, this._alphaNode);
    })();
  }
}

/** Folio default lighting uniforms for rain / wind lines. */
export function createFolioLighting() {
  const direction = new THREE.Vector3(0.5, 0.8, 0.3).normalize();
  return {
    direction,
    directionUniform: uniform(direction.clone()),
    colorUniform: uniform(color("#ffffff")),
    intensityUniform: uniform(1),
    shadowColor: uniform(color("#3e2918")),
    coreShadowEdgeLow: uniform(float(-0.25)),
    coreShadowEdgeHigh: uniform(float(1)),
  };
}

/**
 * Sync lighting uniforms from the ambient FX editor scene.
 */
export function updateFolioLightingFromScene(lighting, scene) {
  const dirLight = scene.userData.dirLight;
  const ambLight = scene.userData.ambLight;
  if (!dirLight) return;

  lighting.direction.copy(dirLight.position).normalize();
  lighting.directionUniform.value.copy(lighting.direction);

  const amb = ambLight ? ambLight.intensity : 0.5;
  const dir = dirLight.intensity;
  lighting.intensityUniform.value = amb * 0.35 + dir * 0.12;
  lighting.colorUniform.value.setRGB(1, 1, 1);
}
