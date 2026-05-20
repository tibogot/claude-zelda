/**
 * Anderson Mancini lens flare — WebGPU + TSL (wgslFn port).
 * @see https://github.com/ektogamat/lensflare-threejs-vanilla
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import { texture, uv, uniform, wgsl, wgslFn, float, vec4, positionLocal } from "three/tsl";
import { WGSL_LENSFLARE_LIB } from "./lensflare-mancini-wgsl.mjs";

const wgslLib = wgsl(WGSL_LENSFLARE_LIB);

const flareShadeFn = wgslFn(
  `
fn tsl_mancini_lf_entry(
  uv: vec2f,
  iTime: f32,
  opacity: f32,
  starPoints: f32,
  glareSize: f32,
  flareSize: f32,
  flareSpeed: f32,
  flareShape: f32,
  haloScale: f32,
  ghostScale: f32,
  iResolution: vec2f,
  lensPosition: vec2f,
  colorGain: vec3f,
  uAnimated: f32,
  uAnamorphic: f32,
  uEnabled: f32,
  uSecondaryGhosts: f32,
  uStarBurst: f32,
  uAditionalStreaks: f32,
  lensDirtTexture: texture_2d<f32>,
  lensDirtSampler: sampler,
) -> vec4f {
  return lf_fragment_main(
    uv, iTime, opacity, starPoints, glareSize, flareSize, flareSpeed, flareShape,
    haloScale, ghostScale, iResolution, lensPosition, colorGain,
    uAnimated, uAnamorphic, uEnabled, uSecondaryGhosts, uStarBurst, uAditionalStreaks,
    lensDirtTexture, lensDirtSampler
  );
}
`,
  [wgslLib],
);

/** @param {number} v */
function boolUniform(v) {
  return float(v ? 1 : 0);
}

/**
 * @param {object} opts
 * @param {THREE.Scene} opts.scene
 * @param {THREE.Camera} opts.camera
 * @param {string} [opts.dirtTextureUrl='./textures/lensDirtTexture.png']
 * @param {object} [opts.params] — initial + live params (mutated by GUI)
 */
export function createManciniLensFlare({
  scene,
  camera,
  dirtTextureUrl = "./textures/lensDirtTexture.png",
  params: initialParams,
}) {
  const params = {
    enabled: true,
    lensPosition: new THREE.Vector3(25, 2, -40),
    opacity: 0.8,
    // Original uses raw (95, 12, 10) — NOT normalized. Shader multiplies by 20/256 internally.
    colorGain: new THREE.Color(95, 12, 10),
    starPoints: 5,
    glareSize: 0.55,
    flareSize: 0.004,
    flareSpeed: 0.4,
    flareShape: 1.2,
    haloScale: 0.5,
    animated: true,
    anamorphic: false,
    secondaryGhosts: true,
    starBurst: true,
    ghostScale: 0.3,
    aditionalStreaks: true,
    followMouse: false,
    followSun: false,
    ...initialParams,
  };

  const timer = new THREE.Timer();
  const renderSize = new THREE.Vector2();
  const screenPosition = params.lensPosition.clone();
  const flarePosition = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  let targetOpacity = params.opacity;
  let internalOpacity = params.opacity;

  const uTime = uniform(0);
  const uOpacity = uniform(internalOpacity);
  const uStarPoints = uniform(params.starPoints);
  const uGlareSize = uniform(params.glareSize);
  const uFlareSize = uniform(params.flareSize);
  const uFlareSpeed = uniform(params.flareSpeed);
  const uFlareShape = uniform(params.flareShape);
  const uHaloScale = uniform(params.haloScale);
  const uGhostScale = uniform(params.ghostScale);
  const uResolution = uniform(new THREE.Vector2(window.innerWidth, window.innerHeight));
  const uLensPos = uniform(new THREE.Vector2(0, 0));
  const uColorGain = uniform(
    new THREE.Vector3(params.colorGain.r, params.colorGain.g, params.colorGain.b),
  );
  const uAnimated = uniform(boolUniform(params.animated));
  const uAnamorphic = uniform(boolUniform(params.anamorphic));
  const uEnabled = uniform(boolUniform(params.enabled));
  const uSecondaryGhosts = uniform(boolUniform(params.secondaryGhosts));
  const uStarBurst = uniform(boolUniform(params.starBurst));
  const uAditionalStreaks = uniform(boolUniform(params.aditionalStreaks));

  const dirtTex = new THREE.TextureLoader().load(dirtTextureUrl);
  dirtTex.colorSpace = THREE.SRGBColorSpace;
  const dirtNode = texture(dirtTex);

  const flareColor = flareShadeFn({
    uv: uv(),
    iTime: uTime,
    opacity: uOpacity,
    starPoints: uStarPoints,
    glareSize: uGlareSize,
    flareSize: uFlareSize,
    flareSpeed: uFlareSpeed,
    flareShape: uFlareShape,
    haloScale: uHaloScale,
    ghostScale: uGhostScale,
    iResolution: uResolution,
    lensPosition: uLensPos,
    colorGain: uColorGain,
    uAnimated,
    uAnamorphic,
    uEnabled,
    uSecondaryGhosts,
    uStarBurst,
    uAditionalStreaks,
    lensDirtTexture: dirtNode,
    lensDirtSampler: dirtNode,
  });

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  material.name = "ManciniLensFlare";
  material.colorNode = flareColor.rgb;
  material.opacityNode = flareColor.a;
  // Fullscreen NDC pass — match original Mancini vertex shader (gl_Position = vec4(position, 1.0)).
  // Plane verts are (-1..1, -1..1, 0), so this becomes a fullscreen quad in clip space.
  material.vertexNode = vec4(positionLocal, 1.0);

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 1, 1), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10000;
  mesh.raycast = () => {};
  scene.add(mesh);

  function checkTransparency(intersects) {
    if (intersects[0]?.object?.visible) {
      const obj = intersects[0].object;
      const mat = obj.material;
      if (mat?.transmission !== undefined && mat.transmission > 0.2) {
        targetOpacity = params.opacity * (mat.transmission * 0.5);
        return;
      }
      if (mat?.transmission === 0) {
        targetOpacity = 0;
        return;
      }
      if (mat?.transmission === undefined) {
        if (mat?.transparent && mat.opacity < 0.98) {
          targetOpacity = params.opacity / (mat.opacity * 10);
          return;
        }
        if (obj.userData === "no-occlusion" || obj.userData?.lensflare === "no-occlusion") {
          targetOpacity = params.opacity;
          return;
        }
        targetOpacity = 0;
        return;
      }
    } else {
      targetOpacity = params.opacity;
    }
  }

  function syncUniforms() {
    uEnabled.value = params.enabled ? 1 : 0;
    uStarPoints.value = params.starPoints;
    uGlareSize.value = params.glareSize;
    uFlareSize.value = params.flareSize;
    uFlareSpeed.value = params.flareSpeed;
    uFlareShape.value = params.flareShape;
    uHaloScale.value = params.haloScale;
    uGhostScale.value = params.ghostScale;
    uAnimated.value = params.animated ? 1 : 0;
    uAnamorphic.value = params.anamorphic ? 1 : 0;
    uSecondaryGhosts.value = params.secondaryGhosts ? 1 : 0;
    uStarBurst.value = params.starBurst ? 1 : 0;
    uAditionalStreaks.value = params.aditionalStreaks ? 1 : 0;
    uColorGain.value.set(params.colorGain.r, params.colorGain.g, params.colorGain.b);
  }

  /**
   * @param {THREE.WebGPURenderer} renderer
   * @param {THREE.Vector3} [sunWorldPos] — when followSun, project this point
   */
  function update(renderer, sunWorldPos) {
    timer.update();
    const dt = timer.getDelta();
    const elapsed = timer.getElapsed();
    uTime.value = elapsed;

    renderer.getSize(renderSize);
    uResolution.value.set(renderSize.x, renderSize.y);
    // vertexNode bypasses MVP, so mesh transform is irrelevant — no lookAt needed.

    syncUniforms();

    if (params.followMouse) {
      uLensPos.value.set(mouse.x, mouse.y);
      targetOpacity = params.opacity;
    } else {
      const src = params.followSun && sunWorldPos ? sunWorldPos : screenPosition;
      const projected = src.clone().project(camera);
      flarePosition.copy(projected);
      if (flarePosition.z < 1) {
        uLensPos.value.set(flarePosition.x, flarePosition.y);
      }
      raycaster.setFromCamera(
        new THREE.Vector2(flarePosition.x, flarePosition.y),
        camera,
      );
      const hits = raycaster.intersectObjects(scene.children, true);
      checkTransparency(hits);
    }

    internalOpacity += (targetOpacity - internalOpacity) * Math.min(1, dt * 60 * 0.007);
    uOpacity.value = internalOpacity;
  }

  function onMouseMove(clientX, clientY) {
    mouse.x = (clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(clientY / window.innerHeight) * 2 + 1;
  }

  function dispose() {
    scene.remove(mesh);
    material.dispose();
    mesh.geometry.dispose();
    dirtTex.dispose();
  }

  return {
    mesh,
    params,
    screenPosition,
    update,
    onMouseMove,
    dispose,
  };
}
