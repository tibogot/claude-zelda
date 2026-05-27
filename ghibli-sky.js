/**
 * ghibli-sky.js — Ghibli-style procedural sky dome (WebGPU / TSL)
 *
 * Cloud model: seam-free triplanar 3D FBM on view direction, macro clusters,
 * merged billowy lobes, ridged edge detail. No atan/equirect mapping.
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
  max,
  sin,
  length,
  normalize,
  floor,
  fract,
  step,
  time,
  positionLocal,
  mx_noise_float,
} from "three/tsl";

export function createGhibliSky() {
  const uZenithColor = uniform(
    new THREE.Color().setHex(0x1e5cb8).convertSRGBToLinear(),
  );
  const uSkyColor = uniform(
    new THREE.Color().setHex(0x52c4f0).convertSRGBToLinear(),
  );
  const uHorizonColor = uniform(
    new THREE.Color().setHex(0xd8eeff).convertSRGBToLinear(),
  );
  const uSunsetLow = uniform(
    new THREE.Color().setHex(0xc83818).convertSRGBToLinear(),
  );
  const uSunsetColor = uniform(
    new THREE.Color().setHex(0xff8848).convertSRGBToLinear(),
  );
  const uSunsetHigh = uniform(
    new THREE.Color().setHex(0xf0b8d8).convertSRGBToLinear(),
  );
  const uGroundColor = uniform(
    new THREE.Color().setHex(0x2a4018).convertSRGBToLinear(),
  );
  const uNightZenith = uniform(
    new THREE.Color().setHex(0x040818).convertSRGBToLinear(),
  );

  const uSunDir = uniform(new THREE.Vector3(0.4, 0.75, 0.2).normalize());
  const uSunColor = uniform(
    new THREE.Color().setHex(0xfff8e8).convertSRGBToLinear(),
  );
  const uSunSize = uniform(0.022);
  const uSunGlowPower = uniform(6.0);
  const uSunGlowStrength = uniform(1.15);

  const uMoonColor = uniform(
    new THREE.Color().setHex(0xd0e4ff).convertSRGBToLinear(),
  );
  const uMoonGlowStr = uniform(0.22);
  const uMoonGlowPower = uniform(12.0);

  const uHorizonRingStr = uniform(0.28);
  const uHorizonRingWidth = uniform(0.12);
  const uHorizonRingColor = uniform(
    new THREE.Color().setHex(0xfff4dc).convertSRGBToLinear(),
  );

  // Hero cumulus — macro clusters + billowy lobes
  const uC1Density = uniform(0.74);
  const uC1Softness = uniform(0.28);
  const uC1Scale = uniform(2.8);
  const uC1MacroScale = uniform(0.78);
  const uC1BodyScale = uniform(1.85);
  const uC1FluffScale = uniform(4.2);
  const uC1ClusterLo = uniform(0.34);
  const uC1ClusterHi = uniform(0.72);
  const uC1WarpStr = uniform(0.38);
  const uC1StretchX = uniform(1.25);
  const uC1StretchY = uniform(0.88);
  const uC1Height = uniform(0.72);
  const uC1Wind = uniform(new THREE.Vector3(0.0022, 0.0, 0.001));

  // Distant soft haze layer
  const uC2Density = uniform(0.62);
  const uC2Softness = uniform(0.42);
  const uC2Scale = uniform(0.22);
  const uC2Height = uniform(2.4);
  const uC2Strength = uniform(0.08);
  const uC2Wind = uniform(new THREE.Vector2(-0.0018, 0.0006));

  const uCloudLit = uniform(
    new THREE.Color().setHex(0xffffff).convertSRGBToLinear(),
  );
  const uCloudShadow = uniform(
    new THREE.Color().setHex(0x5a78b8).convertSRGBToLinear(),
  );
  const uCloudUnderside = uniform(
    new THREE.Color().setHex(0x6a90c8).convertSRGBToLinear(),
  );
  const uCloudSunset = uniform(
    new THREE.Color().setHex(0xffb888).convertSRGBToLinear(),
  );
  const uShadowStr = uniform(0.82);
  const uUndersideStr = uniform(0.78);
  const uRimStr = uniform(0.58);
  const uNightCloudStr = uniform(0.2);

  const uStarsDensity = uniform(55.0);
  const uStarsSize = uniform(0.07);
  const uStarsBrightness = uniform(0.95);

  const fbm3d = Fn(([p]) => {
    const n0 = mx_noise_float(vec3(p));
    const n1 = mx_noise_float(vec3(p.mul(2.03)).add(vec3(1.3, 2.7, 4.1))).mul(0.5);
    const n2 = mx_noise_float(vec3(p.mul(4.07)).add(vec3(2.7, 1.1, 5.3))).mul(0.25);
    return clamp(n0.add(n1).add(n2).mul(0.533).add(0.5), 0, 1);
  });

  const fbm2d = Fn(([p]) => {
    const n0 = mx_noise_float(vec3(p));
    const n1 = mx_noise_float(vec3(p.mul(2.04)).add(vec3(1.3, 2.7, 4.1))).mul(0.5);
    return clamp(n0.add(n1).mul(0.667).add(0.5), 0, 1);
  });

  const samplePos = Fn(([dir, scale, anim, warpStr, stretchX, stretchY]) => {
    const base = vec3(
      dir.x.mul(stretchX),
      dir.y.mul(stretchY),
      dir.z.mul(stretchX),
    )
      .mul(scale)
      .add(anim);
    const warp = vec3(
      mx_noise_float(vec3(base.mul(0.55).add(vec3(2.1, 5.4, 9.2)))),
      mx_noise_float(vec3(base.mul(0.55).add(vec3(11.8, 2.6, 3.7)))),
      mx_noise_float(vec3(base.mul(0.55).add(vec3(7.4, 13.1, 1.9)))),
    )
      .sub(0.5)
      .mul(warpStr);
    return base.add(warp);
  });

  /** Large billowy cumulus — FBM clusters, not round Voronoi cells. */
  const cumulusLayer = Fn(
    ([
      sphereDir,
      windOffset,
      density,
      softness,
      macroScale,
      bodyScale,
      fluffScale,
      clusterLo,
      clusterHi,
      warpStr,
      stretchX,
      stretchY,
      scale,
      sunHoriz,
      litColor,
      horizMask,
      upDot,
      viewDir,
      sunsetBlend,
      dayAmount,
    ]) => {
      const anim = vec3(windOffset.x, float(0.0), windOffset.y);
      const pos = samplePos(sphereDir, scale, anim, warpStr, stretchX, stretchY);
      const pos2 = samplePos(sphereDir, scale, anim, warpStr.mul(0.42), stretchX, stretchY);

      const placement = smoothstep(
        clusterLo,
        clusterHi,
        fbm3d(pos.mul(macroScale)),
      );

      const massA = fbm3d(pos.mul(bodyScale).add(vec3(4.0, 2.0, 0.0)));
      const massB = fbm3d(pos2.mul(bodyScale.mul(0.76)).add(vec3(19.0, 11.0, 5.0)));
      const massC = fbm3d(pos.mul(bodyScale.mul(1.14)).add(vec3(33.0, 27.0, 8.0)));
      const lobeA = smoothstep(float(0.4), float(0.52), massA);
      const lobeB = smoothstep(float(0.41), float(0.53), massB).mul(0.93);
      const lobeC = smoothstep(float(0.39), float(0.51), massC).mul(0.84);
      const bigMass = max(lobeA, max(lobeB, lobeC));

      const detail = fbm2d(pos.mul(fluffScale).add(vec3(4.2, 9.1, 1.5)));
      const surface = mix(float(0.5), float(1.0), smoothstep(float(0.2), float(0.66), detail));

      const ridged = float(1.0).sub(
        abs(fbm2d(pos.mul(fluffScale.mul(1.55))).mul(2.0).sub(1.0)),
      );
      const billow = mix(float(0.55), float(1.0), smoothstep(float(0.15), float(0.62), ridged));

      let shape = bigMass.mul(placement).mul(surface).mul(billow);
      shape = pow(clamp(shape, float(0.0), float(1.0)), float(0.48));

      const cutoff = float(1.0).sub(density).mul(0.4);
      const alpha = smoothstep(cutoff, cutoff.add(softness), shape).mul(horizMask);

      const shadowOff = vec3(sunHoriz.x, float(0.0), sunHoriz.y).mul(0.13);
      const inShadow = smoothstep(
        float(0.39),
        float(0.55),
        fbm3d(pos.mul(bodyScale).add(shadowOff)),
      ).mul(uShadowStr);

      const sunSide = dot(
        normalize(vec3(viewDir.x, float(0.18), viewDir.z)),
        normalize(vec3(uSunDir.x, float(0.42), uSunDir.z)),
      )
        .mul(0.5)
        .add(0.5);

      const underside = smoothstep(float(0.34), float(0.07), upDot).mul(
        uUndersideStr,
      );

      const depth = pow(clamp(shape, float(0.0), float(1.0)), float(0.52));
      const litSide = mix(vec3(litColor), vec3(uCloudSunset), sunsetBlend.mul(0.5));
      let cloudCol = mix(vec3(uCloudUnderside), litSide, depth);
      cloudCol = mix(cloudCol, vec3(uCloudShadow), inShadow.mul(float(1.0).sub(depth).mul(0.85)));
      cloudCol = mix(cloudCol, vec3(uCloudUnderside), underside.mul(float(1.0).sub(depth).mul(0.7)));
      cloudCol = cloudCol.mul(sunSide.mul(0.68).add(0.32));

      // Bright rim on sun-facing puff edges
      const rimSample = fbm2d(
        pos.mul(fluffScale).sub(vec3(sunHoriz.x, float(0.0), sunHoriz.y).mul(0.04)),
      );
      const rimBand = smoothstep(float(0.55), float(0.72), rimSample)
        .mul(float(1.0).sub(alpha))
        .mul(uRimStr)
        .mul(sunSide);
      cloudCol = cloudCol.add(
        vec3(float(1.0), float(0.98), float(0.92)).mul(rimBand),
      );

      const nightTint = mix(
        vec3(float(0.1), float(0.14), float(0.26)),
        cloudCol,
        dayAmount,
      );
      const nightAlpha = mix(uNightCloudStr, float(1.0), dayAmount);

      return vec4(nightTint, alpha.mul(nightAlpha));
    },
  );

  /** Soft distant haze — no Voronoi line artifacts. */
  const hazeLayer = Fn(
    ([
      sphereDir,
      windOffset,
      density,
      softness,
      strength,
      litColor,
      horizMask,
      sunsetBlend,
      dayAmount,
    ]) => {
      const anim = vec3(windOffset.x, float(0.0), windOffset.y);
      const haze = fbm3d(
        sphereDir.mul(1.15).add(anim).add(vec3(22.0, 11.0, 4.0)),
      );
      const alpha = smoothstep(
        float(1.0).sub(density),
        float(1.0).sub(density).add(softness),
        smoothstep(float(0.48), float(0.72), haze),
      )
        .mul(horizMask)
        .mul(strength);

      let col = mix(vec3(litColor), vec3(uCloudSunset), sunsetBlend.mul(0.3));
      col = mix(vec3(float(0.08), float(0.12), float(0.22)), col, dayAmount);

      return vec4(col, alpha.mul(mix(uNightCloudStr.mul(0.5), float(1.0), dayAmount)));
    },
  );

  const skyColorNode = Fn(() => {
    const dir = normalize(positionLocal);
    const upDot = dir.y;

    const sunEl = uSunDir.y;
    const sunsetBlend = smoothstep(float(0.26), float(-0.04), sunEl);
    const nightBlend = smoothstep(float(0.04), float(-0.1), sunEl);
    const dayAmount = float(1.0).sub(nightBlend);

    const aboveHoriz = smoothstep(float(-0.02), float(0.18), upDot);
    const toZenith = smoothstep(float(0.12), float(0.88), upDot);
    const dayGrad = mix(
      uHorizonColor,
      mix(uSkyColor, uZenithColor, toZenith),
      aboveHoriz,
    );

    const sT1 = smoothstep(float(0.0), float(0.12), upDot);
    const sT2 = smoothstep(float(0.1), float(0.32), upDot);
    const sT3 = smoothstep(float(0.25), float(0.7), upDot);
    let sunsetGrad = vec3(uSunsetLow);
    sunsetGrad = mix(sunsetGrad, vec3(uSunsetColor), sT1);
    sunsetGrad = mix(sunsetGrad, vec3(uSunsetHigh), sT2);
    sunsetGrad = mix(sunsetGrad, vec3(uZenithColor), sT3);

    let col = mix(dayGrad, sunsetGrad, sunsetBlend);
    col = mix(col, vec3(uNightZenith), nightBlend.mul(toZenith.mul(0.85).add(0.15)));
    col = mix(col, uGroundColor, smoothstep(float(0.0), float(-0.12), upDot));

    const dirH = normalize(vec3(dir.x, float(0.0), dir.z));
    const sunH = normalize(vec3(uSunDir.x, float(0.0), uSunDir.z));
    const hGlow = pow(clamp(dot(dirH, sunH), 0, 1), float(5.0))
      .mul(smoothstep(float(0.08), float(-0.05), upDot))
      .mul(sunsetBlend)
      .mul(0.65);
    col = col.add(vec3(uSunsetColor).mul(hGlow));

    const horizBand = smoothstep(uHorizonRingWidth, float(0.0), abs(upDot)).mul(
      smoothstep(float(0.0), float(0.02), upDot),
    );
    const sunSideBoost = dot(dirH, sunH).mul(0.3).add(0.7);
    const horizDayCol = mix(uHorizonRingColor, uSunsetColor, sunsetBlend.mul(0.55));
    const horizNightCol = vec3(float(0.06), float(0.1), float(0.2));
    col = col.add(
      vec3(mix(horizDayCol, horizNightCol, nightBlend))
        .mul(horizBand)
        .mul(uHorizonRingStr)
        .mul(sunSideBoost),
    );

    const sunDot = clamp(dot(dir, uSunDir), 0, 1);
    const sunGlow = pow(sunDot, uSunGlowPower).mul(uSunGlowStrength);
    const sunDisc = smoothstep(
      float(1.0).sub(uSunSize),
      float(1.0).sub(uSunSize.mul(0.12)),
      sunDot,
    );
    const sunCore = smoothstep(
      float(1.0).sub(uSunSize.mul(0.4)),
      float(1.0).sub(uSunSize.mul(0.05)),
      sunDot,
    );
    const sunFinal = vec3(uSunColor)
      .mul(sunGlow.add(sunDisc))
      .add(vec3(uSunColor).add(float(0.25)).mul(sunCore));
    col = col.add(sunFinal.mul(dayAmount));

    const moonDir = uSunDir.negate();
    const moonDot = clamp(dot(dir, moonDir), 0, 1);
    const moonDisc = smoothstep(float(0.997), float(0.9992), moonDot);
    const moonGlow = pow(moonDot, uMoonGlowPower).mul(uMoonGlowStr);
    col = col.add(vec3(uMoonColor).mul(moonDisc.add(moonGlow)).mul(nightBlend));

    const sunHoriz = normalize(vec2(uSunDir.x, uSunDir.z));

    const hMask1 = smoothstep(float(0.0), float(0.42), upDot);
    const windT = vec2(time.mul(uC1Wind.x), time.mul(uC1Wind.z));
    const c1 = cumulusLayer(
      dir,
      windT,
      uC1Density,
      uC1Softness,
      uC1MacroScale,
      uC1BodyScale,
      uC1FluffScale,
      uC1ClusterLo,
      uC1ClusterHi,
      uC1WarpStr,
      uC1StretchX,
      uC1StretchY,
      uC1Scale,
      sunHoriz,
      uCloudLit,
      hMask1,
      upDot,
      dir,
      sunsetBlend,
      dayAmount,
    );
    col = mix(col, c1.xyz, c1.w);

    const hMask2 = smoothstep(float(0.08), float(0.28), upDot);
    const windT2 = vec2(time.mul(uC2Wind.x), time.mul(uC2Wind.y));
    const c2 = hazeLayer(
      dir,
      windT2,
      uC2Density,
      uC2Softness,
      uC2Strength,
      uCloudLit,
      hMask2,
      sunsetBlend,
      dayAmount,
    );
    col = mix(col, c2.xyz, c2.w);

    const starUV = dir.xz.div(dir.y.max(float(0.012))).mul(uStarsDensity);
    const starCell = floor(starUV);
    const starFrac = fract(starUV);
    const starHash = fract(
      sin(dot(starCell, vec2(float(12.9898), float(78.233)))).mul(
        float(43758.5453),
      ),
    );
    const starDist = length(starFrac.sub(0.5));
    const starPt = smoothstep(uStarsSize, float(0.0), starDist).mul(
      step(float(0.86), starHash),
    );
    col = col.add(
      vec3(starPt)
        .mul(nightBlend)
        .mul(smoothstep(float(0.0), float(0.05), upDot))
        .mul(uStarsBrightness),
    );

    const ditherSeed = dot(
      dir,
      vec3(float(12.9898), float(78.233), float(45.5432)),
    );
    const ditherHash = fract(sin(ditherSeed).mul(float(43758.5453)));
    col = col.add(vec3(ditherHash.sub(0.5).mul(float(0.0035))));

    return vec3(col);
  })();

  const mat = new MeshBasicNodeMaterial({
    colorNode: skyColorNode,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 64), mat);
  mesh.scale.setScalar(6000);
  mesh.frustumCulled = false;

  const windState = {
    c1Angle: 25,
    c1Speed: 0.0028,
    c2Angle: 200,
    c2Speed: 0.0018,
  };

  const _updateWind = () => {
    const r1 = (windState.c1Angle * Math.PI) / 180;
    uC1Wind.value.set(
      Math.cos(r1) * windState.c1Speed,
      0,
      Math.sin(r1) * windState.c1Speed,
    );
    const r2 = (windState.c2Angle * Math.PI) / 180;
    uC2Wind.value.set(
      Math.cos(r2) * windState.c2Speed,
      Math.sin(r2) * windState.c2Speed,
    );
  };
  _updateWind();

  const update = (sunDir, cameraPos) => {
    uSunDir.value.copy(sunDir);
    if (cameraPos) mesh.position.copy(cameraPos);
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
      sunsetLow: uSunsetLow,
      sunsetColor: uSunsetColor,
      sunsetHigh: uSunsetHigh,
      groundColor: uGroundColor,
      nightZenith: uNightZenith,
      sunColor: uSunColor,
      sunSize: uSunSize,
      sunGlowPower: uSunGlowPower,
      sunGlowStrength: uSunGlowStrength,
      horizonRingStr: uHorizonRingStr,
      horizonRingWidth: uHorizonRingWidth,
      horizonRingColor: uHorizonRingColor,
      c1Density: uC1Density,
      c1Softness: uC1Softness,
      c1Scale: uC1Scale,
      c1Height: uC1Height,
      c1MacroScale: uC1MacroScale,
      c1BodyScale: uC1BodyScale,
      c1FluffScale: uC1FluffScale,
      c1ClusterLo: uC1ClusterLo,
      c1ClusterHi: uC1ClusterHi,
      c1WarpStr: uC1WarpStr,
      c1StretchX: uC1StretchX,
      c1StretchY: uC1StretchY,
      c2Density: uC2Density,
      c2Softness: uC2Softness,
      c2Scale: uC2Scale,
      c2Height: uC2Height,
      c2Strength: uC2Strength,
      cloudLit: uCloudLit,
      cloudShadow: uCloudShadow,
      cloudUnderside: uCloudUnderside,
      cloudSunset: uCloudSunset,
      shadowStr: uShadowStr,
      undersideStr: uUndersideStr,
      rimStr: uRimStr,
      nightCloudStr: uNightCloudStr,
      moonColor: uMoonColor,
      moonGlowStr: uMoonGlowStr,
      moonGlowPower: uMoonGlowPower,
      starsDensity: uStarsDensity,
      starsSize: uStarsSize,
      starsBrightness: uStarsBrightness,
    },
  };
}
