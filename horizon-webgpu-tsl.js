/**
 * horizon-webgpu-tsl.js — Two-color gradient horizon skydome (WebGPU + TSL)
 *
 * Drop-in helper for scenes that already use three.webgpu + TSL (same import map
 * as splatmap-painter / stylized-sky). Call createHorizonSky(), scene.add(api.mesh),
 * and each frame api.update(camera) if followCamera is true (default).
 *
 * The original R3F shader used normalize(worldPosition + offset).y on a huge sphere.
 * When the dome follows the camera, that world-space formula breaks (camera translation
 * dominates the normalize). This port uses direction from sphere center via
 * normalize(positionLocal), with a bias of offset/radius applied per axis — same limp
 * as offset 33 on a radius-4000 sphere at the origin.
 *
 * Optional full-360° horizon ring (strength 0 by default) adds a warm band at the limb,
 * similar to stylized-sky’s luminosity ring, without clouds or sun.
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  Fn,
  uniform,
  vec3,
  float,
  mix,
  pow,
  max,
  normalize,
  smoothstep,
  abs,
  positionLocal,
} from "three/tsl";

/**
 * @param {object} [options]
 * @param {string|number} [options.topColor="#0077ff"] — zenith / upper sky (sRGB hex or CSS)
 * @param {string|number} [options.bottomColor="#ffffff"] — horizon / lower sky
 * @param {number} [options.offset=33] — legacy-style position bias (world-ish); scaled by radius in-shader
 * @param {number} [options.exponent=0.6] — contrast of the vertical blend
 * @param {number} [options.radius=4000] — sphere scale; keep in sync if you call setRadius
 * @param {[number, number]} [options.segments=[32, 15]] — widthSegments, heightSegments
 * @param {boolean} [options.followCamera=true] — if true, update() moves the mesh with the camera
 * @param {number} [options.ringStrength=0] — additive 360° horizon band; 0 = off (pure gradient)
 * @param {number} [options.ringWidth=0.12] — angular thickness of the band (matches stylized-sky default)
 * @param {string|number} [options.ringColor="#fff0d0"] — ring tint (linear workflow via THREE.Color)
 */
export function createHorizonSky(options = {}) {
  const {
    topColor = "#0077ff",
    bottomColor = "#ffffff",
    offset = 33,
    exponent = 0.6,
    radius = 4000,
    segments = [32, 15],
    followCamera = true,
    ringStrength = 0,
    ringWidth = 0.12,
    ringColor = "#fff0d0",
  } = options;

  const uTop = uniform(new THREE.Color(topColor).convertSRGBToLinear());
  const uBottom = uniform(new THREE.Color(bottomColor).convertSRGBToLinear());
  const uOffset = uniform(offset);
  const uExponent = uniform(exponent);
  const uRadius = uniform(radius);
  const uRingStr = uniform(ringStrength);
  const uRingWidth = uniform(ringWidth);
  const uRingCol = uniform(new THREE.Color(ringColor).convertSRGBToLinear());

  const colorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const k = uOffset.div(uRadius.max(float(1e-6)));
    const biased = dir.add(vec3(k, k, k));
    const h = max(normalize(biased).y, float(0));
    const t = pow(h, uExponent);
    let col = mix(vec3(uBottom), vec3(uTop), t);

    const upDot = dir.y;
    const horizBand = smoothstep(uRingWidth, float(0), abs(upDot)).mul(
      smoothstep(float(0), float(0.015), upDot),
    );
    col = col.add(vec3(uRingCol).mul(horizBand).mul(uRingStr));

    return col;
  })();

  const material = new MeshBasicNodeMaterial({
    colorNode,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const [wSegs, hSegs] = segments;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, wSegs, hSegs), material);
  mesh.scale.setScalar(radius);
  mesh.frustumCulled = false;

  const setRadius = (r) => {
    const rr = Math.max(1e-6, r);
    mesh.scale.setScalar(rr);
    uRadius.value = rr;
  };

  const update = (camera) => {
    if (followCamera && camera) mesh.position.copy(camera.position);
  };

  return {
    mesh,
    material,
    followCamera,
    setRadius,
    update,
    uniforms: {
      topColor: uTop,
      bottomColor: uBottom,
      offset: uOffset,
      exponent: uExponent,
      radius: uRadius,
      ringStrength: uRingStr,
      ringWidth: uRingWidth,
      ringColor: uRingCol,
    },
  };
}
