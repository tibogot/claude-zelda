/**
 * Volumetric cloud LAYER — superjet-grade density, framed as a sky-wide slab.
 *
 * This marches the SAME seamless 3D Perlin-FBM volume that makes
 * `clouds_terrain_1600-superjet-optimized.html` (and v3) look good — instead of
 * a cheap stretched 2D texture. The only thing that changes vs. the superjet box
 * is the SHAPE: rather than carving one spherical blob with an SDF mask, we tile
 * the noise horizontally and cut it with a vertical height gradient, so it reads
 * as a whole-sky cloud deck you view from below but never enter.
 *
 * Why it's still cheap for a grounded game: the camera never approaches the
 * clouds, so each ray only marches the thin slab [base, base+thickness] between
 * its analytic entry/exit (near-horizon rays are distance-capped).
 *
 * Lighting matches superjet: dual-lobe Henyey-Greenstein phase, colored
 * extinction, a short light-march for self-shadowing, powder term, and ambient
 * fill. The page hands it the sun by day and the moon by night.
 */
import * as THREE from "three/webgpu";
import {
  float, vec2, vec3, vec4, Fn, If, Loop, Break, uniform, uv, texture,
  positionWorld, cameraPosition, screenUV, texture3D,
  cameraViewMatrix, cameraProjectionMatrix,
  normalize, dot, max, min, mix, smoothstep, pow, exp, sin, fract, abs,
  length, sqrt,
} from "three/tsl";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";
import { createGodRaysPass } from "./god-rays-pass.js";

const CLOUD_LAYER = 18;
const MAX_OCC_STEPS = 16;
const CLOUD_RADIUS = 8000;
const MAX_STEPS = 128;
const MAX_LIGHT_STEPS = 8;
const INV_4PI = 1.0 / (4.0 * Math.PI);
const EXTINCTION = new THREE.Vector3(0.6, 0.65, 0.7);

function seededRandom(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fbm(perlin, x, y, z, octaves, persistence, lacunarity) {
  let total = 0, frequency = 1, amplitude = 1, maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += perlin.noise(x * frequency, y * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / Math.max(1e-6, maxValue);
}

/**
 * Seamless (tileable) 3D Perlin-FBM volume — same corner-blend trick as superjet
 * /v3: blends the 8 shifted copies so opposite faces match. Stores the raw 0..1
 * noise (NOT a thresholded mask) so coverage stays a live shader uniform.
 */
function bakeNoiseVolume(size, opt) {
  const { noiseScale, octaves, persistence, lacunarity, intensity, seed } = opt;
  const data = new Uint8Array(size * size * size);
  const perlin = new ImprovedNoise(seededRandom(seed >>> 0));
  const s = noiseScale;
  const args = [octaves, persistence, lacunarity];
  let idx = 0;
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x / (size - 1), ny = y / (size - 1), nz = z / (size - 1);
        const bx = nx * s + seed, by = ny * s + seed, bz = nz * s + seed;
        const n1 = fbm(perlin, bx, by, bz, ...args);
        const n2 = fbm(perlin, bx - s, by, bz, ...args);
        const n3 = fbm(perlin, bx, by - s, bz, ...args);
        const n4 = fbm(perlin, bx, by, bz - s, ...args);
        const n5 = fbm(perlin, bx - s, by - s, bz, ...args);
        const n6 = fbm(perlin, bx - s, by, bz - s, ...args);
        const n7 = fbm(perlin, bx, by - s, bz - s, ...args);
        const n8 = fbm(perlin, bx - s, by - s, bz - s, ...args);
        const wx = 1 - nx, wy = 1 - ny, wz = 1 - nz;
        let v =
          n1 * wx * wy * wz + n2 * nx * wy * wz + n3 * wx * ny * wz +
          n4 * wx * wy * nz + n5 * nx * ny * wz + n6 * nx * wy * nz +
          n7 * wx * ny * nz + n8 * nx * ny * nz;
        v = (v + 1) / 2;
        data[idx++] = Math.pow(Math.max(0, v), intensity) * 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export function createCloudLayer({ camera }) {
  const volumeTexture = bakeNoiseVolume(96, {
    noiseScale: 3.5, octaves: 5, persistence: 0.5,
    lacunarity: 3.0, intensity: 1.0, seed: 137,
  });
  const volTex = texture3D(volumeTexture, null, 0);

  // ── Uniforms ─────────────────────────────────────────────────────────────
  const uBase = uniform(1800);
  const uThickness = uniform(1100);
  const uScale = uniform(0.0009);
  const uDetailMul = uniform(4.0);
  const uCovLow = uniform(0.35);
  const uCovHigh = uniform(0.62);
  const uErode = uniform(0.35);
  const uDensityMul = uniform(6.0);
  const uTopSoft = uniform(0.55);
  const uBaseSoft = uniform(0.2);
  const uSteps = uniform(64);
  const uLightSteps = uniform(6);
  const uOccMaxSteps = uniform(14);
  const uMaxDist = uniform(24000);
  // Empty-space skipping: advance faster through air, fine steps only inside
  // clouds. Same in-cloud sampling, far fewer wasted samples in clear sky.
  const uEmptyStepMul = uniform(2.0);    // 1 = uniform march (off)
  const uEmptyThreshold = uniform(0.01); // density below this counts as empty
  const uPlanetRadius = uniform(60000); // smaller = more horizon curvature

  const uOpacity = uniform(1.0);     // extinction strength along the view ray
  const uLightAbsorb = uniform(1.1); // extinction toward the light
  const uPhaseG = uniform(0.3);
  const uPhaseW = uniform(0.8);      // dual-lobe forward weight
  const uPowder = uniform(0.5);

  const uWind = uniform(new THREE.Vector3());
  const uLightDir = uniform(new THREE.Vector3(0, 1, 0));
  const uLightColor = uniform(new THREE.Color(0xfff3d8));
  const uLightIntensity = uniform(3.0);
  const uAmbientColor = uniform(new THREE.Color(0x8fb6e0));
  const uAmbientIntensity = uniform(0.5);

  // ── Offscreen buffers ─────────────────────────────────────────────────────
  // Full-res scene (color + depth) so the cloud march can be occluded by world
  // geometry; half-res cloud buffer for the cheap raymarch.
  const sceneRT = new THREE.RenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  });
  sceneRT.depthTexture = new THREE.DepthTexture(1, 1);
  const depthSampler = texture(sceneRT.depthTexture);
  // +1 for conventional depth (far = 1), -1 for reversed depth (far = 0).
  const uDepthSign = uniform(1);
  // Env-bake mode: render the cloud dome into a reflection cubemap. Skips the
  // screen-depth occlusion (no scene geometry in the bake) and marches cheaper.
  const uEnvMode = uniform(0);
  const uEnvSteps = uniform(40);

  // ── Density (samples the seamless 3D volume) ───────────────────────────────
  // Planet center sits directly under the camera at depth R (ground ≈ y 0).
  const planetCenter = () => vec3(cameraPosition.x, uPlanetRadius.negate(), cameraPosition.z);

  const sampleDensity = Fn(([p]) => {
    // Height within the curved shell = radial distance from the planet center.
    const radial = length(p.sub(planetCenter()));
    const h = radial.sub(uPlanetRadius.add(uBase)).div(uThickness).clamp(0.0, 1.0);
    // Rounded vertical profile: thin base, full middle, eroded top.
    const grad = smoothstep(0.0, uBaseSoft, h).mul(smoothstep(1.0, uTopSoft, h));

    const coord = p.mul(uScale).add(uWind);
    const baseN = volTex.sample(coord).r;
    const shaped = smoothstep(uCovLow, uCovHigh, baseN).mul(grad).toVar();

    // Higher-frequency detail erodes the edges into wisps.
    const detailN = volTex.sample(coord.mul(uDetailMul).add(uWind.mul(2.0))).r;
    shaped.subAssign(detailN.oneMinus().mul(uErode).mul(shaped));
    return shaped.max(0.0).mul(uDensityMul);
  });

  const HG = Fn(([g, mu]) => {
    const g2 = g.mul(g);
    return float(1.0).sub(g2)
      .div(pow(float(1.0).add(g2).sub(g.mul(mu).mul(2.0)), 1.5))
      .mul(INV_4PI);
  });
  const phaseFn = Fn(([mu]) =>
    HG(uPhaseG.negate(), mu).mul(uPhaseW.oneMinus())
      .add(HG(uPhaseG, mu).mul(uPhaseW)),
  );

  const lightMarch = Fn(([p]) => {
    const stepLen = uThickness.div(uLightSteps.max(1)).mul(0.85);
    const tau = float(0.0).toVar();
    Loop(MAX_LIGHT_STEPS, ({ i }) => {
      If(float(i).greaterThanEqual(uLightSteps), () => Break());
      const lp = p.add(uLightDir.mul(stepLen.mul(float(i).add(1.0))));
      tau.addAssign(sampleDensity(lp));
    });
    return exp(tau.mul(stepLen).mul(uLightAbsorb).negate());
  });

  const cloudColorNode = Fn(() => {
    const rayDir = normalize(positionWorld.sub(cameraPosition)).toVar();

    // Curved cloud shell: the region between two concentric spheres (radii
    // R+base and R+base+thickness) around a planet of radius R sitting under the
    // camera. General intersection — picks the nearest shell segment in front of
    // the camera, so it's correct whether the camera is BELOW, INSIDE, or ABOVE
    // the deck (fly-through). A ground-sphere (radius R) clips the far end so
    // nothing renders below the horizon, and grazing rays exit (no slab pinch).
    const oc = cameraPosition.sub(planetCenter());
    const b = dot(oc, rayDir);
    const ococ = dot(oc, oc);
    const rIn = uPlanetRadius.add(uBase);
    const rOut = uPlanetRadius.add(uBase).add(uThickness);
    const discIn = b.mul(b).sub(ococ.sub(rIn.mul(rIn)));
    const discOut = b.mul(b).sub(ococ.sub(rOut.mul(rOut)));
    const discG = b.mul(b).sub(ococ.sub(uPlanetRadius.mul(uPlanetRadius)));

    const sqOut = sqrt(discOut.max(0.0));
    const outerT1 = b.negate().sub(sqOut);
    const outerT2 = b.negate().add(sqOut);

    // Default: the whole outer-sphere span (no inner hole carved yet).
    const tNear = outerT1.max(0.0).toVar();
    const tFar = outerT2.toVar();
    // The inner sphere carves a hole; keep the nearest shell segment in front.
    If(discIn.greaterThan(0.0), () => {
      const sqIn = sqrt(discIn);
      const innerT1 = b.negate().sub(sqIn);
      const innerT2 = b.negate().add(sqIn);
      If(innerT1.greaterThan(0.0), () => {
        // Near segment [outerT1, innerT1] — ends where the ray enters the hole.
        tNear.assign(outerT1.max(0.0));
        tFar.assign(innerT1);
      }).Else(() => {
        // We're past/inside the inner sphere → far segment [innerT2, outerT2].
        tNear.assign(innerT2.max(0.0));
        tFar.assign(outerT2);
      });
    });

    // Ground-sphere clip (horizon): clip the far end to the ground hit.
    const tGround = b.negate().sub(sqrt(discG.max(0.0)));
    If(discG.greaterThan(0.0).and(tGround.greaterThan(0.0)), () => {
      tFar.assign(min(tFar, tGround));
    });
    tFar.assign(min(tFar, uMaxDist));
    const valid = discOut.greaterThan(0.0).and(tFar.greaterThan(tNear));

    const mu = dot(rayDir, normalize(uLightDir));
    const phase = phaseFn(mu);
    const jitter = fract(sin(dot(screenUV, vec2(12.9898, 78.233))).mul(43758.5453));

    // Scene depth for occlusion (NDC-space compare, reversed-depth agnostic).
    const sceneDepth = depthSampler.sample(screenUV).r;

    const transmittance = vec3(1.0).toVar();
    const scattered = vec3(0.0).toVar();

    If(valid, () => {
      const isEnv = uEnvMode.greaterThan(0.5);
      const effSteps = isEnv.select(uEnvSteps, uSteps).toVar();
      // baseStep = the fine in-cloud step; empty regions advance by a multiple of
      // it. Integration always uses baseStep, so in-cloud quality is unchanged.
      const baseStep = tFar.sub(tNear).div(effSteps.max(1)).toVar();
      const travel = tNear.add(jitter.mul(baseStep)).toVar();
      Loop(MAX_STEPS, ({ i }) => {
        If(travel.greaterThanEqual(tFar), () => Break());
        If(transmittance.r.lessThan(0.01), () => Break());
        const p = cameraPosition.add(rayDir.mul(travel));
        // Stop where world geometry is in front of this sample (skip in env bake).
        const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1.0)));
        const sampleDepth = clip.z.div(clip.w);
        If(isEnv.not().and(sampleDepth.sub(sceneDepth).mul(uDepthSign).greaterThan(0.0)), () => Break());
        const density = sampleDensity(p).toVar();
        const isEmpty = density.lessThan(uEmptyThreshold);
        const advance = isEmpty.select(baseStep.mul(uEmptyStepMul), baseStep);
        If(isEmpty.not(), () => {
          const light = lightMarch(p);
          const powder = exp(density.mul(2.0).negate()).oneMinus()
            .mul(uPowder).add(uPowder.oneMinus());
          const h = length(p.sub(planetCenter())).sub(uPlanetRadius.add(uBase))
            .div(uThickness).clamp(0.0, 1.0);
          const sun = uLightColor.mul(uLightIntensity).mul(light).mul(phase).mul(powder);
          const amb = uAmbientColor.mul(uAmbientIntensity).mul(mix(float(0.4), float(1.0), h));
          const lum = sun.add(amb).mul(density).mul(baseStep);
          const stepT = exp(density.mul(baseStep).mul(uOpacity).mul(EXTINCTION).negate());
          scattered.addAssign(transmittance.mul(lum));
          transmittance.mulAssign(stepT);
        });
        travel.addAssign(advance);
      });
    });

    const alpha = transmittance.r.oneMinus();
    return vec4(scattered, alpha);
  });

  // Cheap silhouette for god-rays occlusion (no lighting).
  const cloudOccColorNode = Fn(() => {
    const rayDir = normalize(positionWorld.sub(cameraPosition)).toVar();
    const oc = cameraPosition.sub(planetCenter());
    const b = dot(oc, rayDir);
    const ococ = dot(oc, oc);
    const rIn = uPlanetRadius.add(uBase);
    const rOut = uPlanetRadius.add(uBase).add(uThickness);
    const discIn = b.mul(b).sub(ococ.sub(rIn.mul(rIn)));
    const discOut = b.mul(b).sub(ococ.sub(rOut.mul(rOut)));
    const discG = b.mul(b).sub(ococ.sub(uPlanetRadius.mul(uPlanetRadius)));

    const sqOut = sqrt(discOut.max(0.0));
    const tNear = b.negate().sub(sqOut).max(0.0).toVar();
    const tFar = b.negate().add(sqOut).toVar();
    If(discIn.greaterThan(0.0), () => {
      const sqIn = sqrt(discIn);
      const innerT1 = b.negate().sub(sqIn);
      const innerT2 = b.negate().add(sqIn);
      If(innerT1.greaterThan(0.0), () => {
        tNear.assign(b.negate().sub(sqOut).max(0.0));
        tFar.assign(innerT1);
      }).Else(() => {
        tNear.assign(innerT2.max(0.0));
        tFar.assign(b.negate().add(sqOut));
      });
    });
    const tGround = b.negate().sub(sqrt(discG.max(0.0)));
    If(discG.greaterThan(0.0).and(tGround.greaterThan(0.0)), () => {
      tFar.assign(min(tFar, tGround));
    });
    tFar.assign(min(tFar, uMaxDist));
    const valid = discOut.greaterThan(0.0).and(tFar.greaterThan(tNear));
    const transmittance = float(1.0).toVar();
    const jitter = fract(sin(dot(screenUV, vec2(12.9898, 78.233))).mul(43758.5453));

    If(valid, () => {
      const stepLen = tFar.sub(tNear).div(uOccMaxSteps.max(1));
      Loop(MAX_OCC_STEPS, ({ i }) => {
        If(float(i).greaterThanEqual(uOccMaxSteps), () => Break());
        If(transmittance.lessThan(0.02), () => Break());
        const t = tNear.add(float(i).add(jitter).add(0.5).mul(stepLen));
        const p = cameraPosition.add(rayDir.mul(t));
        const density = sampleDensity(p);
        If(density.greaterThan(0.01), () => {
          transmittance.mulAssign(exp(density.mul(stepLen).mul(uOpacity).negate()));
        });
      });
    });
    return vec4(vec3(0.0), float(1.0).sub(transmittance));
  });

  const cloudOccMaterial = new THREE.MeshBasicNodeMaterial();
  cloudOccMaterial.colorNode = cloudOccColorNode();
  cloudOccMaterial.side = THREE.BackSide;
  cloudOccMaterial.transparent = true;
  cloudOccMaterial.depthWrite = false;
  cloudOccMaterial.depthTest = false;
  cloudOccMaterial.fog = false;

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = cloudColorNode();
  material.side = THREE.BackSide;
  material.transparent = true;
  material.premultipliedAlpha = true; // scattered is already transmittance-weighted
  material.depthWrite = false;
  material.depthTest = false; // rendered alone into its own buffer
  material.fog = false;
  // Tone-mapped once here (into the linear HalfFloat buffer); the composite blit
  // does NOT tone-map again, and the canvas applies the sRGB encode — so clouds
  // and the main scene get exactly one ACES pass each.

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 32, 16), material);
  mesh.frustumCulled = false;
  mesh.name = "VolumetricCloudLayer";
  // Isolated on its own layer so the main scene render skips it; we raymarch it
  // separately at quarter resolution and composite the result back over the frame.
  mesh.layers.set(CLOUD_LAYER);

  // ── Half-res cloud buffer + final composite ───────────────────────────────
  const cloudRT = new THREE.RenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });
  let fullW = 0, fullH = 0, rtW = 0, rtH = 0;

  // HDR-ish composite before god rays / future bloom (HalfFloat, linear from tone-mapped passes).
  const compositeRT = new THREE.RenderTarget(1, 1, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
  });

  const godRays = createGodRaysPass();

  const postScene = new THREE.Scene();
  const postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  postScene.add(postQuad);

  const sceneColorNode = texture(sceneRT.texture);
  const cloudTexNode = texture(cloudRT.texture);
  const compositeTexNode = texture(compositeRT.texture);
  const godraysTexNode = godRays.godraysTex;
  const uCloudTexel = uniform(new THREE.Vector2());
  const uGodRaysMix = uniform(0);

  // Single opaque pass: scene color + a 5-tap blur of the (premultiplied) low-res
  // cloud buffer, composited as `scene*(1-a) + cloud`. The blur softens the
  // raymarch grain; linear combos of premultiplied colors stay valid.
  const compositeColor = Fn(() => {
    const o = uCloudTexel;
    // Render-target sampling is Y-flipped vs. the canvas in WebGPU.
    const fuv = vec2(uv().x, uv().y.oneMinus());
    const c0 = cloudTexNode.sample(fuv);
    const c1 = cloudTexNode.sample(fuv.add(vec2(o.x, o.y)));
    const c2 = cloudTexNode.sample(fuv.add(vec2(o.x.negate(), o.y)));
    const c3 = cloudTexNode.sample(fuv.add(vec2(o.x, o.y.negate())));
    const c4 = cloudTexNode.sample(fuv.add(vec2(o.x.negate(), o.y.negate())));
    const cloud = c0.mul(0.4).add(c1.add(c2).add(c3).add(c4).mul(0.15));
    const sceneCol = sceneColorNode.sample(fuv).rgb;
    const raysCol = godraysTexNode.sample(fuv).rgb;
    const base = sceneCol.add(raysCol.mul(uGodRaysMix));
    return vec4(base.mul(cloud.a.oneMinus()).add(cloud.rgb), 1.0);
  });

  const compositeMat = new THREE.MeshBasicNodeMaterial();
  compositeMat.colorNode = compositeColor();
  compositeMat.toneMapped = false;
  compositeMat.depthTest = false;
  compositeMat.depthWrite = false;

  const presentColor = Fn(() => {
    const fuv = vec2(uv().x, uv().y.oneMinus());
    return vec4(compositeTexNode.sample(fuv).rgb, 1);
  });
  const presentMat = new THREE.MeshBasicNodeMaterial();
  presentMat.colorNode = presentColor();
  presentMat.toneMapped = false;
  presentMat.depthTest = false;
  presentMat.depthWrite = false;
  postQuad.material = presentMat;

  const _bufSize = new THREE.Vector2();
  function ensureSize(renderer) {
    renderer.getDrawingBufferSize(_bufSize);
    const fw = Math.max(1, Math.floor(_bufSize.x));
    const fh = Math.max(1, Math.floor(_bufSize.y));
    if (fw !== fullW || fh !== fullH) {
      fullW = fw; fullH = fh;
      sceneRT.setSize(fw, fh);
      compositeRT.setSize(fw, fh);
    }
    const w = Math.max(1, Math.floor(fw * 0.5));
    const h = Math.max(1, Math.floor(fh * 0.5));
    if (w !== rtW || h !== rtH) {
      rtW = w; rtH = h;
      cloudRT.setSize(w, h);
      uCloudTexel.value.set(1 / w, 1 / h);
    }
  }

  /**
   * @param {object} P     — PARAMS slice (clouds.*)
   * @param {object} frame — { dt, lightDir, lightColor, lightIntensity,
   *                           ambientColor, ambientIntensity, camera }
   */
  function update(P, frame) {
    mesh.visible = P.enabled;
    if (!P.enabled) return;
    mesh.position.copy(frame.camera.position);

    uBase.value = P.base;
    uThickness.value = P.thickness;
    uScale.value = P.scale;
    uDetailMul.value = P.detailMul;
    uErode.value = P.erode;
    uDensityMul.value = P.densityMul;
    uSteps.value = P.steps;
    uLightSteps.value = P.lightSteps;
    uEmptyStepMul.value = P.emptySkip ?? 2.0;
    uMaxDist.value = P.maxDist;
    uPlanetRadius.value = P.planetRadius;
    uOpacity.value = P.opacity;
    uLightAbsorb.value = P.lightAbsorb;
    uPhaseG.value = P.phaseG;
    uPowder.value = P.powder;

    // coverage slider → smoothstep thresholds (more coverage = lower threshold).
    const thresh = 1.0 - P.coverage;
    uCovLow.value = thresh - P.softness;
    uCovHigh.value = thresh + P.softness;

    const a = THREE.MathUtils.degToRad(P.windDeg);
    uWind.value.x += Math.cos(a) * P.windSpeed * frame.dt;
    uWind.value.z += Math.sin(a) * P.windSpeed * frame.dt;

    uLightDir.value.copy(frame.lightDir);
    uLightColor.value.copy(frame.lightColor);
    uLightIntensity.value = frame.lightIntensity;
    uAmbientColor.value.copy(frame.ambientColor);
    uAmbientIntensity.value = frame.ambientIntensity;
  }

  /**
   * Full frame: render the scene (with depth) to an offscreen buffer, raymarch
   * the clouds at half-res with depth occlusion, then composite to the canvas.
   * Replaces the page's `renderer.render(scene, camera)`. The cloud dome is on
   * its own layer, so the scene pass (default camera layers) skips it.
   */
  function render(renderer, scene, camera, renderOpts = {}) {
    ensureSize(renderer);
    uDepthSign.value = camera.reversedDepth ? -1 : 1;

    const prevMask = camera.layers.mask;
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevClearA = renderer.getClearAlpha();

    // 1) Scene (+ depth) → sceneRT. Cloud layer is excluded automatically.
    renderer.setRenderTarget(sceneRT);
    renderer.render(scene, camera);

    // 2) Clouds → half-res cloudRT (cleared transparent; depth-occluded inside).
    camera.layers.set(CLOUD_LAYER);
    renderer.setRenderTarget(cloudRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    if (mesh.visible) renderer.render(scene, camera);
    camera.layers.mask = prevMask;
    renderer.setClearColor(prevClear, prevClearA);

    // 3) God rays (scene only; clouds composite on top — matches superjet).
    const godP = renderOpts.godRays;
    const frame = renderOpts.frame;
    let raysOk = false;
    if (godP?.enabled && frame) {
      uOccMaxSteps.value = godP.occCloudSteps ?? 12;
      raysOk = godRays.render(renderer, {
        scene,
        camera,
        cloudMesh: mesh,
        cloudOccMaterial,
        cloudLayer: CLOUD_LAYER,
        skyMesh: renderOpts.skyMesh,
        occluders: renderOpts.occluders ?? [],
        P: godP,
        frame,
        fullWidth: fullW,
        fullHeight: fullH,
      });
    }
    uGodRaysMix.value = raysOk ? 1 : 0;

    // 4) scene + rays + clouds → compositeRT (bloom hook).
    postQuad.material = compositeMat;
    renderer.setRenderTarget(compositeRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(postScene, postCam);

    // 5) Present → canvas (later: bloom reads compositeRT before this step).
    postQuad.material = presentMat;
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCam);
  }

  function dispose() {
    mesh.geometry.dispose();
    material.dispose();
    volumeTexture.dispose();
    sceneRT.dispose();
    cloudRT.dispose();
    compositeRT.dispose();
    cloudOccMaterial.dispose();
    postQuad.geometry.dispose();
    compositeMat.dispose();
    presentMat.dispose();
    godRays.dispose();
  }

  return {
    mesh,
    sunMesh: godRays.sunMesh,
    update,
    render,
    layer: CLOUD_LAYER,
    compositeRT,
    /** Toggle env-bake mode (skip depth occlusion, cheaper march) for PMREM. */
    setEnvMode: (on) => { uEnvMode.value = on ? 1 : 0; },
    dispose,
  };
}

export { GOD_RAYS_DEFAULTS } from "./god-rays-pass.js";

export const CLOUD_DEFAULTS = {
  enabled: true,
  base: 1900,
  thickness: 1400,
  scale: 0.00015,
  detailMul: 4.0,
  coverage: 0.4,
  softness: 0.12,
  erode: 0.15,
  densityMul: 12.0,
  steps: 64,
  lightSteps: 6,
  emptySkip: 2.0,
  maxDist: 24000,
  planetRadius: 60000,
  opacity: 1.0,
  lightAbsorb: 1.1,
  phaseG: 0.3,
  powder: 0.5,
  windDeg: 35,
  windSpeed: 0.02,
};
