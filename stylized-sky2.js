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
  Loop,
  Var,
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
  ); // mid orange
  const uSunsetLow = uniform(
    new THREE.Color().setHex(0xaa1500).convertSRGBToLinear(),
  ); // deep crimson at horizon
  const uSunsetHigh = uniform(
    new THREE.Color().setHex(0xffd580).convertSRGBToLinear(),
  ); // pale amber upper band
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

  // ── Moon ──
  const uMoonColor = uniform(
    new THREE.Color().setHex(0xc8deff).convertSRGBToLinear(),
  );
  const uMoonGlowStr = uniform(0.18); // soft halo brightness
  const uMoonGlowPower = uniform(14.0); // lower = wider halo

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
  const uC1WindDir = uniform(new THREE.Vector2(0.005, 0.002)); // x/z wind speed
  const uC1Height = uniform(1.0);
  const uC1WarpStr = uniform(0.35); // domain warp strength
  const uC1WarpScale = uniform(0.4); // warp noise scale (lower = bigger blobs)

  // ── Cloud layer 2 (high, small, faster) ──
  const uC2Coverage = uniform(0.32);
  const uC2Softness = uniform(0.22);
  const uC2Scale = uniform(0.42);
  const uC2WindDir = uniform(new THREE.Vector2(-0.003, 0.001)); // opposite direction
  const uC2Height = uniform(2.6);
  const uC2WarpStr = uniform(0.2);
  const uC2WarpScale = uniform(0.6);

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

  // ── Cloud contrast + silver lining + internal gradient ──
  const uC1Contrast = uniform(1.0); // 1 = unchanged, >1 = punchier edges
  const uC2Contrast = uniform(1.0);
  const uCloudRimStr = uniform(0.3); // silver lining brightness
  const uCloudRimWidth = uniform(0.15); // how far to look toward sun for the rim
  const uCloudGradientStr = uniform(0.0); // internal bump detail strength
  const uCloudDetailScale = uniform(3.5); // fineness of internal bump noise
  const uCloudVertStr = uniform(0.0); // vertical top-to-bottom gradient strength
  const uCloudGradientDark = uniform(
    new THREE.Color().setHex(0x8aaabb).convertSRGBToLinear(),
  ); // dark color for gradient/bumps (independent of directional shadow)

  // ── God rays ──
  const uGodRayStr = uniform(0.0); // overall brightness (0 = off)
  const uGodRayDecay = uniform(0.94); // how fast each step fades (higher = longer rays)

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

  // ── 2-octave fBm (cheaper, used for god ray march) ──
  const fbmCloudFast = Fn(([p]) => {
    const n1 = mx_noise_float(vec3(p, float(0.0)));
    const n2 = mx_noise_float(vec3(p.mul(2.07), float(1.3))).mul(0.5);
    return clamp(n1.add(n2).mul(0.667).add(0.5), 0, 1);
  });

  // ── Cloud layer: returns vec4(rgb, alpha) ──
  const cloudLayer = Fn(
    ([
      uvBase,
      coverage,
      softness,
      sunHoriz,
      litColor,
      horizMask,
      contrast,
      upDotParam,
    ]) => {
      const threshold = float(1.0).sub(coverage);
      const noise = fbmCloud(uvBase);
      const shadowUV = uvBase.add(sunHoriz.mul(0.2));
      const shadowNoise = fbmCloud(shadowUV);
      const rawDensity = smoothstep(threshold, threshold.add(softness), noise);
      // Contrast: pushes cloud density toward 0/1 — punchier edges above 1.0
      const density = clamp(
        rawDensity.sub(float(0.5)).mul(contrast).add(float(0.5)),
        float(0),
        float(1),
      ).mul(horizMask);
      const inShadow = smoothstep(
        threshold.sub(0.05),
        threshold.add(softness),
        shadowNoise,
      );
      const shadowBlend = clamp(
        inShadow.mul(uCloudShadowStr),
        float(0),
        float(1),
      );
      const directionalCol = mix(
        vec3(litColor),
        vec3(uCloudShadow),
        shadowBlend,
      );

      // ── Vertical macro gradient: top of cloud = bright, base = shadow ──
      const vertGrad = smoothstep(float(0.05), float(0.4), upDotParam);
      const vertCol = mix(vec3(uCloudGradientDark), vec3(litColor), vertGrad);

      // ── Internal bump detail: separate finer FBm as bump height field ──
      const detailUV = uvBase
        .mul(uCloudDetailScale)
        .add(vec2(float(5.73), float(3.17)));
      const bumpHeight = fbmCloud(detailUV); // 0=valley, 1=peak
      // Multiply macro gradient × bump height → top-lit round puffs
      // Peak at top = very bright highlight; valley at bottom = deep shadow
      const bumpLit = vertGrad.mul(float(0.5).add(bumpHeight.mul(float(0.5))));
      const bumpCol = mix(
        vec3(uCloudGradientDark),
        vec3(litColor),
        clamp(bumpLit, float(0), float(1)),
      );

      // Blend layers: directional → add vert gradient → add bump detail
      let cloudCol = directionalCol;
      cloudCol = mix(cloudCol, vertCol, uCloudVertStr);
      cloudCol = mix(cloudCol, bumpCol, uCloudGradientStr);
      // Silver lining: bright rim on sun-facing cloud edges
      const rimUV = uvBase.sub(sunHoriz.mul(uCloudRimWidth));
      const rimNoise = fbmCloud(rimUV);
      const rimSolid = smoothstep(
        threshold.sub(float(0.02)),
        threshold.add(softness),
        rimNoise,
      );
      // Rim appears where sun-side is solid but current pixel is outside the cloud
      const rimFactor = rimSolid
        .mul(rawDensity.oneMinus())
        .mul(uCloudRimStr)
        .mul(horizMask);
      const cloudColRim = cloudCol.add(
        vec3(float(1.0), float(0.98), float(0.92)).mul(rimFactor),
      );
      return vec4(cloudColRim, density);
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
    // Daytime 3-stop gradient
    const aboveHoriz = smoothstep(float(-0.02), float(0.2), upDot);
    const toZenith = smoothstep(float(0.15), float(0.9), upDot);
    const dayGrad = mix(
      uHorizonColor,
      mix(uSkyColor, uZenithColor, toZenith),
      aboveHoriz,
    );

    // Multi-stop sunset gradient: crimson → orange → amber → deep blue zenith
    const sT1 = smoothstep(float(0.0), float(0.1), upDot);
    const sT2 = smoothstep(float(0.08), float(0.28), upDot);
    const sT3 = smoothstep(float(0.22), float(0.65), upDot);
    let sunsetGrad = vec3(uSunsetLow);
    sunsetGrad = mix(sunsetGrad, vec3(uSunsetColor), sT1);
    sunsetGrad = mix(sunsetGrad, vec3(uSunsetHigh), sT2);
    sunsetGrad = mix(sunsetGrad, vec3(uZenithColor), sT3);

    let col = mix(dayGrad, sunsetGrad, sunsetBlend);
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
    const moonDisc = smoothstep(float(0.9972), float(0.999), moonDot);
    const moonGlow = pow(moonDot, uMoonGlowPower).mul(uMoonGlowStr);
    // Halo ring just outside the disc
    const moonHaloDist = abs(moonDot.sub(float(0.996)));
    const moonHalo = smoothstep(float(0.0012), float(0.0), moonHaloDist).mul(
      0.12,
    );
    col = col.add(
      vec3(uMoonColor)
        .mul(moonDisc.add(moonGlow).add(moonHalo))
        .mul(nightBlend),
    );

    // ── Horizontal sun direction (for cloud shadow offset) ──
    const sunHoriz = normalize(vec2(uSunDir.x, uSunDir.z));

    // ── Cloud layer 1 ──
    const hMask1 = smoothstep(float(0.05), float(0.22), upDot);
    const cloudUV1 = dir.xz
      .div(upDot.max(float(0.06)).mul(uC1Height))
      .mul(uC1Scale)
      .add(time.mul(uC1WindDir));
    // Domain warp: distort UV with low-freq noise before sampling cloud shape
    const w1a = mx_noise_float(vec3(cloudUV1.mul(uC1WarpScale), float(0.0)));
    const w1b = mx_noise_float(vec3(cloudUV1.mul(uC1WarpScale), float(3.7)));
    const warpedUV1 = cloudUV1.add(vec2(w1a, w1b).mul(uC1WarpStr));
    const litCol1 = mix(
      vec3(uCloudLit),
      vec3(uCloudSunset),
      sunsetBlend.mul(0.55),
    );
    const c1 = cloudLayer(
      warpedUV1,
      uC1Coverage,
      uC1Softness,
      sunHoriz,
      litCol1,
      hMask1,
      uC1Contrast,
      upDot,
    );
    col = mix(col, c1.xyz, c1.w.mul(nightBlend.oneMinus()));

    // ── Cloud layer 2 ──
    const hMask2 = smoothstep(float(0.07), float(0.26), upDot);
    const cloudUV2 = dir.xz
      .div(upDot.max(float(0.06)).mul(uC2Height))
      .mul(uC2Scale)
      .add(time.mul(uC2WindDir))
      .add(vec2(float(17.3), float(31.7)));
    // Domain warp for layer 2
    const w2a = mx_noise_float(vec3(cloudUV2.mul(uC2WarpScale), float(1.5)));
    const w2b = mx_noise_float(vec3(cloudUV2.mul(uC2WarpScale), float(5.2)));
    const warpedUV2 = cloudUV2.add(vec2(w2a, w2b).mul(uC2WarpStr));
    const litCol2 = mix(
      vec3(uCloudLit),
      vec3(uCloudSunset),
      sunsetBlend.mul(0.35),
    );
    const c2 = cloudLayer(
      warpedUV2,
      uC2Coverage,
      uC2Softness,
      sunHoriz,
      litCol2,
      hMask2,
      uC2Contrast,
      upDot,
    );
    col = mix(col, c2.xyz, c2.w.mul(0.7).mul(nightBlend.oneMinus()));

    // ── God rays: march from current cloud UV toward sun's cloud UV ──
    const grSunUV = uSunDir.xz
      .div(uSunDir.y.max(float(0.08)).mul(uC1Height))
      .mul(uC1Scale)
      .add(time.mul(uC1WindDir));
    const grBaseUV = cloudUV1; // already computed above (no warp, just projection)
    const grStep = grSunUV.sub(grBaseUV).mul(float(1.0 / 8.0));
    const c1Thresh = float(1.0).sub(uC1Coverage);
    const grUVPos = Var(grBaseUV.toVar());
    const grAcc = Var(float(0.0));
    const grDecay = Var(float(1.0));
    Loop(8, () => {
      grUVPos.addAssign(grStep);
      const s = fbmCloudFast(grUVPos);
      const occluded = smoothstep(c1Thresh, c1Thresh.add(uC1Softness), s);
      grAcc.addAssign(float(1.0).sub(occluded).mul(grDecay));
      grDecay.mulAssign(uGodRayDecay);
    });
    const grVis = smoothstep(float(0.05), float(0.22), upDot); // fade matches cloud hMask1 — prevents horizon stretch artifacts
    const grFinal = grAcc
      .div(float(8.0))
      .mul(uGodRayStr)
      .mul(nightBlend.oneMinus())
      .mul(grVis);
    col = col.add(vec3(uSunColor).mul(grFinal));

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

  // ── Wind direction helpers (angle in degrees + speed → vec2) ──
  const windState = {
    c1Angle: 20,
    c1Speed: 0.008,
    c2Angle: 160,
    c2Speed: 0.004,
  };
  const _updateWind = () => {
    const r1 = (windState.c1Angle * Math.PI) / 180;
    uC1WindDir.value.set(
      Math.cos(r1) * windState.c1Speed,
      Math.sin(r1) * windState.c1Speed,
    );
    const r2 = (windState.c2Angle * Math.PI) / 180;
    uC2WindDir.value.set(
      Math.cos(r2) * windState.c2Speed,
      Math.sin(r2) * windState.c2Speed,
    );
  };
  _updateWind();

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
    windState,
    updateWind: _updateWind,
    uniforms: {
      // Gradient
      zenithColor: uZenithColor,
      skyColor: uSkyColor,
      horizonColor: uHorizonColor,
      sunsetColor: uSunsetColor,
      sunsetLow: uSunsetLow,
      sunsetHigh: uSunsetHigh,
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
      c1Height: uC1Height,
      c1WarpStr: uC1WarpStr,
      c1WarpScale: uC1WarpScale,
      c1Contrast: uC1Contrast,
      // Cloud layer 2
      c2Coverage: uC2Coverage,
      c2Softness: uC2Softness,
      c2Scale: uC2Scale,
      c2Height: uC2Height,
      c2WarpStr: uC2WarpStr,
      c2WarpScale: uC2WarpScale,
      c2Contrast: uC2Contrast,
      // Cloud colors
      cloudLit: uCloudLit,
      cloudShadow: uCloudShadow,
      cloudShadowStr: uCloudShadowStr,
      cloudSunset: uCloudSunset,
      cloudRimStr: uCloudRimStr,
      cloudRimWidth: uCloudRimWidth,
      cloudVertStr: uCloudVertStr,
      cloudGradientDark: uCloudGradientDark,
      // God rays
      godRayStr: uGodRayStr,
      godRayDecay: uGodRayDecay,
      cloudGradientStr: uCloudGradientStr,
      cloudDetailScale: uCloudDetailScale,
      // Moon
      moonColor: uMoonColor,
      moonGlowStr: uMoonGlowStr,
      moonGlowPower: uMoonGlowPower,
      // Stars
      starsDensity: uStarsDensity,
      starsSize: uStarsSize,
      starsBrightness: uStarsBrightness,
    },
  };
}
