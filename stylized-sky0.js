/**
 * stylized-sky.js — Procedural Ghibli/Zelda TSL sky dome
 *
 * Features:
 *  - Multi-stop gradient (zenith → mid → horizon) driven by sun elevation
 *  - Zelda-style sun: large disc + overexposed core + halo ring + radial rays
 *  - Atmospheric horizon scatter (golden/orange ring around sun at sunset)
 *  - Full 360° horizon luminosity band (warm glow all around the horizon)
 *  - Two cloud layers: 2D perspective-projected fBm, directional self-shadow, sunset tint
 *  - Stars (hash grid) + moon disc at night
 */

import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  Fn,
  uniform,
  vec2,
  vec3,
  vec4,
  float,
  mix,
  smoothstep,
  clamp,
  pow,
  dot,
  abs,
  cos,
  atan,
  normalize,
  floor,
  fract,
  step,
  time,
  positionLocal,
  length,
  mx_noise_float,
} from "three/tsl";

export function createStylizedSky() {
  // ── Sky gradient ──
  const uZenithColor = uniform(
    new THREE.Color().setHex(0x0c3fbf).convertSRGBToLinear(),
  );
  const uSkyColor = uniform(
    new THREE.Color().setHex(0x3ea8f5).convertSRGBToLinear(),
  );
  const uHorizonColor = uniform(
    new THREE.Color().setHex(0xb8deff).convertSRGBToLinear(),
  );
  const uSunsetColor = uniform(
    new THREE.Color().setHex(0xff6820).convertSRGBToLinear(),
  );
  const uGroundColor = uniform(
    new THREE.Color().setHex(0x2e4418).convertSRGBToLinear(),
  );

  // ── Sun ──
  const uSunDir = uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uSunRight = uniform(new THREE.Vector3(1, 0, 0)); // perpendicular axis — updated CPU-side
  const uSunUp = uniform(new THREE.Vector3(0, 1, 0)); // perpendicular axis — updated CPU-side
  const uSunColor = uniform(
    new THREE.Color().setHex(0xfffde0).convertSRGBToLinear(),
  );
  const uSunSize = uniform(0.015); // larger than before
  const uSunGlowPower = uniform(8.0); // lower = wider glow
  const uSunGlowStrength = uniform(1.5); // stronger corona
  // Halo ring just outside the disc
  const uSunHaloStr = uniform(0.35);
  const uSunHaloRadius = uniform(2.2); // ring at sunSize * this
  // Radial rays
  const uSunRayCount = uniform(8.0); // number of ray pairs
  const uSunRayStr = uniform(0.45);
  const uSunRaySharp = uniform(6.0); // higher = thinner rays
  const uSunRayLen = uniform(0.22); // how far rays extend from disc

  // ── Horizon luminosity ring ──
  const uHorizonRingStr = uniform(0.22);
  const uHorizonRingWidth = uniform(0.12); // angular thickness of the band
  const uHorizonRingColor = uniform(
    new THREE.Color().setHex(0xfff0d0).convertSRGBToLinear(),
  );

  // ── Cloud layer 1 (low, large, slow) ──
  const uC1Coverage = uniform(0.48);
  const uC1Softness = uniform(0.18);
  const uC1Scale = uniform(1.0);
  const uC1Speed = uniform(0.006);
  const uC1Height = uniform(1.0);

  // ── Cloud layer 2 (high, small, faster) ──
  const uC2Coverage = uniform(0.32);
  const uC2Softness = uniform(0.22);
  const uC2Scale = uniform(0.42);
  const uC2Speed = uniform(0.003);
  const uC2Height = uniform(2.6);

  // ── Cloud colors ──
  const uCloudLit = uniform(
    new THREE.Color().setHex(0xffffff).convertSRGBToLinear(),
  );
  const uCloudShadow = uniform(
    new THREE.Color().setHex(0x7aafc8).convertSRGBToLinear(),
  );
  const uCloudShadowStr = uniform(0.55);
  const uCloudSunset = uniform(
    new THREE.Color().setHex(0xff9060).convertSRGBToLinear(),
  );

  // ── Stars ──
  const uStarsDensity = uniform(60.0);
  const uStarsSize = uniform(0.08);
  const uStarsBrightness = uniform(1.0);

  // ── 4-octave fBm ──
  const fbmCloud = Fn(([p]) => {
    const n1 = mx_noise_float(vec3(p, float(0.0)));
    const n2 = mx_noise_float(vec3(p.mul(2.07), float(1.3))).mul(0.5);
    const n3 = mx_noise_float(vec3(p.mul(4.31), float(2.7))).mul(0.25);
    const n4 = mx_noise_float(vec3(p.mul(8.73), float(4.1))).mul(0.125);
    return clamp(n1.add(n2).add(n3).add(n4).mul(0.533).add(0.5), 0, 1);
  });

  // ── Cloud layer: returns vec4(rgb, alpha) ──
  const cloudLayer = Fn(
    ([uvBase, coverage, softness, sunHoriz, litColor, horizMask]) => {
      const threshold = float(1.0).sub(coverage);
      const noise = fbmCloud(uvBase);
      const shadowUV = uvBase.add(sunHoriz.mul(0.2));
      const shadowNoise = fbmCloud(shadowUV);
      const density = smoothstep(threshold, threshold.add(softness), noise).mul(
        horizMask,
      );
      const inShadow = smoothstep(
        threshold.sub(0.05),
        threshold.add(softness),
        shadowNoise,
      );
      const cloudCol = mix(
        vec3(litColor),
        vec3(uCloudShadow),
        inShadow.mul(uCloudShadowStr),
      );
      return vec4(cloudCol, density);
    },
  );

  // ── Main sky color node ──
  const skyColorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const upDot = dir.y;

    const sunEl = uSunDir.y;
    const sunsetBlend = smoothstep(float(0.28), float(-0.05), sunEl);
    const nightBlend = smoothstep(float(0.05), float(-0.08), sunEl);

    // ── Sky gradient ──
    const horizCol = mix(uHorizonColor, uSunsetColor, sunsetBlend.mul(0.85));
    const midCol = mix(
      uSkyColor,
      mix(uSkyColor, uSunsetColor, float(0.5)),
      sunsetBlend.mul(0.4),
    );
    const aboveHoriz = smoothstep(float(-0.02), float(0.2), upDot);
    const toZenith = smoothstep(float(0.15), float(0.9), upDot);
    let col = mix(horizCol, mix(midCol, uZenithColor, toZenith), aboveHoriz);
    col = mix(col, uGroundColor, smoothstep(float(0.0), float(-0.14), upDot));

    // ── Atmospheric horizon scatter (orange ring around sun) ──
    const dirH = normalize(vec3(dir.x, float(0.0), dir.z));
    const sunH = normalize(vec3(uSunDir.x, float(0.0), uSunDir.z));
    const hGlow = pow(clamp(dot(dirH, sunH), 0, 1), float(6.0))
      .mul(smoothstep(float(0.1), float(-0.06), upDot))
      .mul(sunsetBlend)
      .mul(0.75);
    col = col.add(vec3(uSunsetColor).mul(hGlow));

    // ── Full 360° horizon luminosity ring ──
    // Peaks at upDot = 0, only above horizon, with slight sun-side warmth
    const horizBand = smoothstep(uHorizonRingWidth, float(0.0), abs(upDot)).mul(
      smoothstep(float(0.0), float(0.015), upDot),
    );
    const sunSideBoost = dot(dirH, sunH).mul(0.25).add(0.75); // 0.75..1.0
    const horizDayCol = mix(
      uHorizonRingColor,
      uSunsetColor,
      sunsetBlend.mul(0.6),
    );
    const horizNightCol = vec3(float(0.08), float(0.12), float(0.22));
    const horizFinalCol = mix(horizDayCol, horizNightCol, nightBlend);
    col = col.add(
      vec3(horizFinalCol).mul(horizBand).mul(uHorizonRingStr).mul(sunSideBoost),
    );

    // ── Sun: core + disc + wide corona + halo ring + radial rays ──
    const sunDot = clamp(dot(dir, uSunDir), 0, 1);

    // Wide soft corona glow
    const sunGlow = pow(sunDot, uSunGlowPower).mul(uSunGlowStrength);

    // Main disc
    const sunDisc = smoothstep(
      float(1.0).sub(uSunSize),
      float(1.0).sub(uSunSize.mul(0.15)),
      sunDot,
    );

    // Overexposed bright core (smaller, pure white)
    const sunCore = smoothstep(
      float(1.0).sub(uSunSize.mul(0.35)),
      float(1.0).sub(uSunSize.mul(0.04)),
      sunDot,
    );

    // Halo ring just outside the disc
    const haloCenter = float(1.0).sub(uSunSize.mul(uSunHaloRadius));
    const haloDist = abs(sunDot.sub(haloCenter));
    const sunHalo = smoothstep(uSunSize.mul(0.7), float(0.0), haloDist).mul(
      uSunHaloStr,
    );

    // Radial rays — project dir onto the plane perpendicular to sunDir
    const dx = dot(dir, uSunRight);
    const dy = dot(dir, uSunUp);
    const rayAngle = atan(dy, dx);
    const rayPat = pow(abs(cos(rayAngle.mul(uSunRayCount))), uSunRaySharp);
    const radDist = length(vec2(dx, dy));
    const rayFalloff = smoothstep(uSunRayLen, uSunSize.mul(2.0), radDist).mul(
      smoothstep(uSunSize.mul(0.9), uSunSize.mul(1.4), radDist),
    );
    // Multiply by sunDot so rays only appear on the sun-facing hemisphere (not anti-sun)
    const sunRays = rayPat.mul(rayFalloff).mul(uSunRayStr).mul(sunDot);

    // Combine — core is slightly brighter/whiter than disc color
    const sunBaseCol = vec3(uSunColor);
    const sunCoreCol = sunBaseCol.add(float(0.4)); // slightly overexposed white
    const sunFinal = sunBaseCol
      .mul(sunGlow.add(sunDisc).add(sunHalo).add(sunRays))
      .add(sunCoreCol.mul(sunCore));
    col = col.add(sunFinal.mul(nightBlend.oneMinus()));

    // ── Moon ──
    const moonDir = uSunDir.negate();
    const moonDot = clamp(dot(dir, moonDir), 0, 1);
    const moonDisc = smoothstep(float(0.9975), float(0.9992), moonDot);
    col = col.add(
      vec3(float(0.92), float(0.96), float(1.0)).mul(moonDisc.mul(nightBlend)),
    );

    // ── Horizontal sun direction (for cloud shadow offset) ──
    const sunHoriz = normalize(vec2(uSunDir.x, uSunDir.z));

    // ── Cloud layer 1 ──
    const hMask1 = smoothstep(float(0.0), float(0.13), upDot);
    const cloudUV1 = dir.xz
      .div(upDot.max(float(0.05)).mul(uC1Height))
      .mul(uC1Scale)
      .add(time.mul(uC1Speed));
    const litCol1 = mix(
      vec3(uCloudLit),
      vec3(uCloudSunset),
      sunsetBlend.mul(0.55),
    );
    const c1 = cloudLayer(
      cloudUV1,
      uC1Coverage,
      uC1Softness,
      sunHoriz,
      litCol1,
      hMask1,
    );
    col = mix(col, c1.xyz, c1.w.mul(nightBlend.oneMinus()));

    // ── Cloud layer 2 ──
    const hMask2 = smoothstep(float(0.04), float(0.22), upDot);
    const cloudUV2 = dir.xz
      .div(upDot.max(float(0.08)).mul(uC2Height))
      .mul(uC2Scale)
      .add(time.mul(uC2Speed))
      .add(vec2(float(17.3), float(31.7)));
    const litCol2 = mix(
      vec3(uCloudLit),
      vec3(uCloudSunset),
      sunsetBlend.mul(0.35),
    );
    const c2 = cloudLayer(
      cloudUV2,
      uC2Coverage,
      uC2Softness,
      sunHoriz,
      litCol2,
      hMask2,
    );
    col = mix(col, c2.xyz, c2.w.mul(0.7).mul(nightBlend.oneMinus()));

    // ── Stars ──
    const starUV = dir.xz.div(dir.y.max(float(0.01))).mul(uStarsDensity);
    const starCell = floor(starUV);
    const starFrac = fract(starUV);
    const starHash = mx_noise_float(vec3(starCell, float(7.13)))
      .mul(0.5)
      .add(0.5);
    const starDist = length(starFrac.sub(0.5));
    const starPt = smoothstep(uStarsSize, float(0.0), starDist).mul(
      step(float(0.85), starHash),
    );
    const starVis = nightBlend
      .mul(smoothstep(float(0.0), float(0.06), upDot))
      .mul(uStarsBrightness);
    col = col.add(vec3(starPt.mul(starVis)));

    return vec3(col);
  })();

  const mat = new MeshBasicNodeMaterial({
    colorNode: skyColorNode,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.scale.setScalar(6000);
  mesh.frustumCulled = false;
  mesh.visible = false;

  // Compute perpendicular axes for sun ray calculation — updated each frame
  const _worldUp = new THREE.Vector3(0, 1, 0);
  const _sunRight = new THREE.Vector3();
  const _sunUp = new THREE.Vector3();

  const update = (sunDir, cameraPos) => {
    uSunDir.value.copy(sunDir);
    if (cameraPos) mesh.position.copy(cameraPos);
    // Build two axes perpendicular to sunDir for the ray angle calculation
    if (Math.abs(sunDir.y) > 0.95) {
      _sunRight.set(1, 0, 0);
    } else {
      _sunRight.crossVectors(_worldUp, sunDir).normalize();
    }
    _sunUp.crossVectors(sunDir, _sunRight).normalize();
    uSunRight.value.copy(_sunRight);
    uSunUp.value.copy(_sunUp);
  };

  return {
    mesh,
    update,
    uniforms: {
      // Gradient
      zenithColor: uZenithColor,
      skyColor: uSkyColor,
      horizonColor: uHorizonColor,
      sunsetColor: uSunsetColor,
      groundColor: uGroundColor,
      // Sun
      sunColor: uSunColor,
      sunSize: uSunSize,
      sunGlowPower: uSunGlowPower,
      sunGlowStrength: uSunGlowStrength,
      sunHaloStr: uSunHaloStr,
      sunHaloRadius: uSunHaloRadius,
      sunRayCount: uSunRayCount,
      sunRayStr: uSunRayStr,
      sunRaySharp: uSunRaySharp,
      sunRayLen: uSunRayLen,
      // Horizon ring
      horizonRingStr: uHorizonRingStr,
      horizonRingWidth: uHorizonRingWidth,
      horizonRingColor: uHorizonRingColor,
      // Cloud layer 1
      c1Coverage: uC1Coverage,
      c1Softness: uC1Softness,
      c1Scale: uC1Scale,
      c1Speed: uC1Speed,
      c1Height: uC1Height,
      // Cloud layer 2
      c2Coverage: uC2Coverage,
      c2Softness: uC2Softness,
      c2Scale: uC2Scale,
      c2Speed: uC2Speed,
      c2Height: uC2Height,
      // Cloud colors
      cloudLit: uCloudLit,
      cloudShadow: uCloudShadow,
      cloudShadowStr: uCloudShadowStr,
      cloudSunset: uCloudSunset,
      // Stars
      starsDensity: uStarsDensity,
      starsSize: uStarsSize,
      starsBrightness: uStarsBrightness,
    },
  };
}
