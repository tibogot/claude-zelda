/**
 * stylized-sky-unreal.js — Procedural Ghibli/Zelda TSL sky dome
 *
 * Features:
 *  - Multi-stop gradient (zenith → mid → horizon) driven by sun elevation
 *  - Zelda-style sun: large disc + overexposed core + halo ring + radial rays
 *  - Atmospheric horizon scatter (golden/orange ring around sun at sunset)
 *  - Full 360° horizon luminosity band (warm glow all around the horizon)
 *  - Two cloud layers: 2D perspective-projected fBm, directional self-shadow, sunset tint
 *  - Stars (hash grid) + moon disc at night
 *  - Pink-lavender sunset band for Ghibli feel
 *  - Vertical gradient cloud shading (bright tops, blue undersides)
 *  - Anti-banding dither
 */

import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial } from "three/webgpu";
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
  If,
} from "three/tsl";

export function createStylizedSky() {
  // ── Sky gradient (Ghibli palette) ──
  const uZenithColor = uniform(
    new THREE.Color().setHex(0x1535b0).convertSRGBToLinear(),
  );
  const uSkyColor = uniform(
    new THREE.Color().setHex(0x4ab8ee).convertSRGBToLinear(),
  );
  const uHorizonColor = uniform(
    new THREE.Color().setHex(0xcce4f4).convertSRGBToLinear(),
  );
  const uSunsetColor = uniform(
    new THREE.Color().setHex(0xff7838).convertSRGBToLinear(),
  );
  const uSunsetLow = uniform(
    new THREE.Color().setHex(0xb82000).convertSRGBToLinear(),
  );
  const uSunsetHigh = uniform(
    new THREE.Color().setHex(0xe8b0c8).convertSRGBToLinear(),
  );
  const uGroundColor = uniform(
    new THREE.Color().setHex(0x2e4418).convertSRGBToLinear(),
  );

  // ── Sun ──
  const uSunDir = uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize());
  const uSunRight = uniform(new THREE.Vector3(1, 0, 0));
  const uSunUp = uniform(new THREE.Vector3(0, 1, 0));
  const uSunColor = uniform(
    new THREE.Color().setHex(0xfffde0).convertSRGBToLinear(),
  );
  const uSunSize = uniform(0.018);
  const uSunGlowPower = uniform(5.0);
  const uSunGlowStrength = uniform(2.0);
  const uSunHaloStr = uniform(0.2);
  const uSunHaloRadius = uniform(2.2);
  const uSunRayCount = uniform(8.0);
  const uSunRayStr = uniform(0.0);
  const uSunRaySharp = uniform(6.0);
  const uSunRayLen = uniform(0.22);

  // ── Moon ──
  const uMoonColor = uniform(
    new THREE.Color().setHex(0xc8deff).convertSRGBToLinear(),
  );
  const uMoonGlowStr = uniform(0.18);
  const uMoonGlowPower = uniform(14.0);

  // ── Horizon luminosity ring ──
  const uHorizonRingStr = uniform(0.22);
  const uHorizonRingWidth = uniform(0.14);
  const uHorizonRingColor = uniform(
    new THREE.Color().setHex(0xfff0d0).convertSRGBToLinear(),
  );

  // ── Cloud layer 1 (low, large, slow) ──
  const uC1Coverage = uniform(0.50);
  const uC1Softness = uniform(0.16);
  const uC1Scale = uniform(0.85);
  const uC1WindDir = uniform(new THREE.Vector2(0.005, 0.002));
  const uC1Height = uniform(1.0);
  const uC1WarpStr = uniform(0.42);
  const uC1WarpScale = uniform(0.35);

  // ── Cloud layer 2 (high, small, faster) ──
  const uC2Coverage = uniform(0.34);
  const uC2Softness = uniform(0.22);
  const uC2Scale = uniform(0.38);
  const uC2WindDir = uniform(new THREE.Vector2(-0.003, 0.001));
  const uC2Height = uniform(2.6);
  const uC2WarpStr = uniform(0.25);
  const uC2WarpScale = uniform(0.55);

  // ── Cloud colors ──
  const uCloudLit = uniform(
    new THREE.Color().setHex(0xffffff).convertSRGBToLinear(),
  );
  const uCloudShadow = uniform(
    new THREE.Color().setHex(0x6878b0).convertSRGBToLinear(),
  );
  const uCloudShadowStr = uniform(0.55);
  const uCloudSunset = uniform(
    new THREE.Color().setHex(0xffa068).convertSRGBToLinear(),
  );

  // ── Cloud contrast + silver lining + internal gradient ──
  const uC1Contrast = uniform(1.0);
  const uC2Contrast = uniform(1.0);
  const uCloudRimStr = uniform(0.3);
  const uCloudRimWidth = uniform(0.15);
  const uCloudGradientStr = uniform(0.0);
  const uCloudDetailScale = uniform(3.5);
  const uCloudVertStr = uniform(0.55);
  const uCloudGradientDark = uniform(
    new THREE.Color().setHex(0x7088b0).convertSRGBToLinear(),
  );

  // ── God rays ──
  const uGodRayStr = uniform(0.0);
  const uGodRayDecay = uniform(0.94);

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

      const cloudColVar = mix(directionalCol, vertCol, uCloudVertStr).toVar();

      // ── Internal bump detail (skipped when strength = 0) ──
      If(uCloudGradientStr.greaterThan(float(0.001)), () => {
        const detailUV = uvBase
          .mul(uCloudDetailScale)
          .add(vec2(float(5.73), float(3.17)));
        const bumpHeight = fbmCloud(detailUV);
        const bumpLit = vertGrad.mul(
          float(0.5).add(bumpHeight.mul(float(0.5))),
        );
        const bumpCol = mix(
          vec3(uCloudGradientDark),
          vec3(litColor),
          clamp(bumpLit, float(0), float(1)),
        );
        cloudColVar.assign(mix(cloudColVar, bumpCol, uCloudGradientStr));
      });
      let cloudCol = cloudColVar;

      // Silver lining: bright rim on sun-facing cloud edges
      const rimUV = uvBase.sub(sunHoriz.mul(uCloudRimWidth));
      const rimNoise = fbmCloud(rimUV);
      const rimSolid = smoothstep(
        threshold.sub(float(0.02)),
        threshold.add(softness),
        rimNoise,
      );
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
    const aboveHoriz = smoothstep(float(-0.02), float(0.2), upDot);
    const toZenith = smoothstep(float(0.15), float(0.9), upDot);
    const dayGrad = mix(
      uHorizonColor,
      mix(uSkyColor, uZenithColor, toZenith),
      aboveHoriz,
    );

    // Multi-stop sunset: crimson → orange → pink-lavender → deep blue zenith
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
    const horizBand = smoothstep(uHorizonRingWidth, float(0.0), abs(upDot)).mul(
      smoothstep(float(0.0), float(0.015), upDot),
    );
    const sunSideBoost = dot(dirH, sunH).mul(0.25).add(0.75);
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

    const sunGlow = pow(sunDot, uSunGlowPower).mul(uSunGlowStrength);
    const sunDisc = smoothstep(
      float(1.0).sub(uSunSize),
      float(1.0).sub(uSunSize.mul(0.15)),
      sunDot,
    );
    const sunCore = smoothstep(
      float(1.0).sub(uSunSize.mul(0.35)),
      float(1.0).sub(uSunSize.mul(0.04)),
      sunDot,
    );

    const haloCenter = float(1.0).sub(uSunSize.mul(uSunHaloRadius));
    const haloDist = abs(sunDot.sub(haloCenter));
    const sunHalo = smoothstep(uSunSize.mul(0.7), float(0.0), haloDist).mul(
      uSunHaloStr,
    );

    const dx = dot(dir, uSunRight);
    const dy = dot(dir, uSunUp);
    const rayAngle = atan(dy, dx);
    const rayPat = pow(abs(cos(rayAngle.mul(uSunRayCount))), uSunRaySharp);
    const radDist = length(vec2(dx, dy));
    const rayFalloff = smoothstep(uSunRayLen, uSunSize.mul(2.0), radDist).mul(
      smoothstep(uSunSize.mul(0.9), uSunSize.mul(1.4), radDist),
    );
    const sunRays = rayPat.mul(rayFalloff).mul(uSunRayStr).mul(sunDot);

    const sunBaseCol = vec3(uSunColor);
    const sunCoreCol = sunBaseCol.add(float(0.4));
    const sunFinal = sunBaseCol
      .mul(sunGlow.add(sunDisc).add(sunHalo).add(sunRays))
      .add(sunCoreCol.mul(sunCore));
    col = col.add(sunFinal.mul(nightBlend.oneMinus()));

    // ── Moon ──
    const moonDir = uSunDir.negate();
    const moonDot = clamp(dot(dir, moonDir), 0, 1);
    const moonDisc = smoothstep(float(0.9972), float(0.999), moonDot);
    const moonGlow = pow(moonDot, uMoonGlowPower).mul(uMoonGlowStr);
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

    // ── God rays (skipped entirely when strength = 0) ──
    const grContrib = vec3(0.0, 0.0, 0.0).toVar();
    If(uGodRayStr.greaterThan(float(0.001)), () => {
      const grSunUV = uSunDir.xz
        .div(uSunDir.y.max(float(0.08)).mul(uC1Height))
        .mul(uC1Scale)
        .add(time.mul(uC1WindDir));
      const grBaseUV = cloudUV1;
      const grStep = grSunUV.sub(grBaseUV).mul(float(1.0 / 8.0));
      const c1Thresh = float(1.0).sub(uC1Coverage);
      const grUVPos = grBaseUV.toVar();
      const grAcc = float(0.0).toVar();
      const grDecay = float(1.0).toVar();
      Loop(8, () => {
        grUVPos.addAssign(grStep);
        const s = fbmCloudFast(grUVPos);
        const occluded = smoothstep(c1Thresh, c1Thresh.add(uC1Softness), s);
        grAcc.addAssign(float(1.0).sub(occluded).mul(grDecay));
        grDecay.mulAssign(uGodRayDecay);
      });
      const grVis = smoothstep(float(0.05), float(0.22), upDot);
      grContrib.assign(
        vec3(uSunColor).mul(
          grAcc
            .div(float(8.0))
            .mul(uGodRayStr)
            .mul(nightBlend.oneMinus())
            .mul(grVis),
        ),
      );
    });
    col = col.add(grContrib);

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

    // ── Anti-banding dither ──
    const ditherSeed = dot(
      dir,
      vec3(float(12.9898), float(78.233), float(45.5432)),
    );
    const ditherHash = fract(cos(ditherSeed).mul(43758.5453));
    col = col.add(vec3(ditherHash.sub(0.5).mul(float(0.004))));

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

  const _worldUp = new THREE.Vector3(0, 1, 0);
  const _sunRight = new THREE.Vector3();
  const _sunUp = new THREE.Vector3();

  const update = (sunDir, cameraPos) => {
    uSunDir.value.copy(sunDir);
    if (cameraPos) mesh.position.copy(cameraPos);
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
      zenithColor: uZenithColor,
      skyColor: uSkyColor,
      horizonColor: uHorizonColor,
      sunsetColor: uSunsetColor,
      sunsetLow: uSunsetLow,
      sunsetHigh: uSunsetHigh,
      groundColor: uGroundColor,
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
      horizonRingStr: uHorizonRingStr,
      horizonRingWidth: uHorizonRingWidth,
      horizonRingColor: uHorizonRingColor,
      c1Coverage: uC1Coverage,
      c1Softness: uC1Softness,
      c1Scale: uC1Scale,
      c1Height: uC1Height,
      c1WarpStr: uC1WarpStr,
      c1WarpScale: uC1WarpScale,
      c1Contrast: uC1Contrast,
      c2Coverage: uC2Coverage,
      c2Softness: uC2Softness,
      c2Scale: uC2Scale,
      c2Height: uC2Height,
      c2WarpStr: uC2WarpStr,
      c2WarpScale: uC2WarpScale,
      c2Contrast: uC2Contrast,
      cloudLit: uCloudLit,
      cloudShadow: uCloudShadow,
      cloudShadowStr: uCloudShadowStr,
      cloudSunset: uCloudSunset,
      cloudRimStr: uCloudRimStr,
      cloudRimWidth: uCloudRimWidth,
      cloudVertStr: uCloudVertStr,
      cloudGradientDark: uCloudGradientDark,
      godRayStr: uGodRayStr,
      godRayDecay: uGodRayDecay,
      cloudGradientStr: uCloudGradientStr,
      cloudDetailScale: uCloudDetailScale,
      moonColor: uMoonColor,
      moonGlowStr: uMoonGlowStr,
      moonGlowPower: uMoonGlowPower,
      starsDensity: uStarsDensity,
      starsSize: uStarsSize,
      starsBrightness: uStarsBrightness,
    },
  };
}
