/**
 * Day ↔ night sky dome — a single cheap gradient shader (no raymarch).
 *
 * Replaces SkyMesh's daytime-only Preetham model with one that has BOTH a day
 * and a night term, crossfaded by sun elevation:
 *   - horizon→zenith gradient (separate day + night palettes)
 *   - warm sunset/sunrise band near the horizon
 *   - sun disc + Mie-style glow
 *   - moon disc + soft glow (cool white)
 *   - hash-based twinkling star field that fades in as the sun sets
 *
 * Renders on a big inverted sphere that follows the camera. Costs one gradient
 * pass — as cheap as SkyMesh. The page drives it each frame via `update()`.
 *
 * Self-contained: creates its own mesh + uniforms, touches no other module.
 */
import * as THREE from "three/webgpu";
import {
  float, vec3, vec4, Fn, uniform,
  positionWorld, cameraPosition,
  normalize, dot, max, mix, smoothstep, clamp, step,
  pow, sin, floor, fract, length, abs,
} from "three/tsl";

const SKY_RADIUS = 9000;

export function createDayNightSky() {
  // ── Uniforms (driven from PARAMS each frame) ─────────────────────────────
  const uSunDir = uniform(new THREE.Vector3(0, 1, 0));
  const uMoonDir = uniform(new THREE.Vector3(0, -1, 0));
  const uTime = uniform(0);

  const uZenithDay = uniform(new THREE.Color(0x2a6bd8));
  const uHorizonDay = uniform(new THREE.Color(0xbfe0ff));
  const uZenithNight = uniform(new THREE.Color(0x05080f));
  const uHorizonNight = uniform(new THREE.Color(0x1a2740));
  const uSunsetColor = uniform(new THREE.Color(0xff7a33));
  const uGroundColor = uniform(new THREE.Color(0x4a4a52));

  const uSunColor = uniform(new THREE.Color(0xfff3d8));
  const uSunCos = uniform(Math.cos(THREE.MathUtils.degToRad(1.2)));
  const uSunGlowPow = uniform(280);
  const uSunGlowStrength = uniform(0.55);
  const uSunDiscBright = uniform(8.0);

  const uMoonColor = uniform(new THREE.Color(0xcdd9ff));
  const uMoonCos = uniform(Math.cos(THREE.MathUtils.degToRad(1.6)));
  const uMoonGlowPow = uniform(900);
  const uMoonGlowStrength = uniform(0.25);
  const uMoonDiscBright = uniform(3.0);

  const uStarDensity = uniform(220);
  const uStarThreshold = uniform(0.92);
  const uStarSize = uniform(0.08);
  const uStarBrightness = uniform(1.0);
  const uStarTwinkle = uniform(3.0);

  // ── Hash + star field ────────────────────────────────────────────────────
  const hash33 = Fn(([p]) => {
    const q = vec3(
      dot(p, vec3(127.1, 311.7, 74.7)),
      dot(p, vec3(269.5, 183.3, 246.1)),
      dot(p, vec3(113.5, 271.9, 124.6)),
    );
    return fract(sin(q).mul(43758.5453123));
  });

  const starField = Fn(([dir]) => {
    const sp = dir.mul(uStarDensity);
    const cell = floor(sp);
    const f = fract(sp).sub(0.5);
    const rnd = hash33(cell);
    // Sparse: only cells whose hash clears the threshold hold a star.
    const present = step(uStarThreshold, rnd.x);
    const off = hash33(cell.add(vec3(1.7, 9.2, 3.3))).sub(0.5).mul(0.7);
    const d = length(f.sub(off));
    const bright = smoothstep(uStarSize, float(0.0), d);
    const tw = sin(uTime.mul(uStarTwinkle).add(rnd.y.mul(6.2831)))
      .mul(0.4).add(0.6);
    return present.mul(bright).mul(tw).mul(uStarBrightness);
  });

  // ── Sky color node ───────────────────────────────────────────────────────
  const skyColorNode = Fn(() => {
    const dir = normalize(positionWorld.sub(cameraPosition)).toVar();
    const up = dir.y.toVar();

    const sunEl = uSunDir.y;
    const dayF = smoothstep(-0.15, 0.25, sunEl).toVar();      // 0 night → 1 day
    const nightF = dayF.oneMinus();
    // Twilight band peaks while the sun grazes the horizon.
    const twilightF = smoothstep(-0.3, 0.0, sunEl)
      .mul(smoothstep(0.4, 0.04, sunEl));

    // Vertical gradient (day + night palettes), crossfaded.
    const tGrad = pow(max(up, float(0.0)), float(0.45));
    const dayCol = mix(uHorizonDay, uZenithDay, tGrad);
    const nightCol = mix(uHorizonNight, uZenithNight, tGrad);
    const skyCol = mix(nightCol, dayCol, dayF).toVar();

    // Warm sunset/sunrise wash, strongest near the horizon and toward the sun.
    const sunAmt = max(dot(dir, uSunDir), float(0.0));
    const horizonBand = smoothstep(0.4, 0.0, abs(up));
    const sunset = twilightF.mul(horizonBand)
      .mul(mix(float(0.25), float(1.0), sunAmt));
    skyCol.assign(mix(skyCol, uSunsetColor, clamp(sunset.mul(0.8), 0.0, 1.0)));

    // Ground hemisphere (below the horizon line).
    const groundMix = smoothstep(0.0, -0.04, up);
    skyCol.assign(
      mix(skyCol, uGroundColor.mul(mix(float(0.12), float(1.0), dayF)), groundMix),
    );

    // Stars (above the horizon, night only).
    const stars = starField(dir)
      .mul(nightF)
      .mul(smoothstep(-0.02, 0.1, up));
    skyCol.addAssign(vec3(stars));

    // Sun disc + glow (fades out below the horizon).
    const sunDot = dot(dir, uSunDir);
    const sunUpFade = smoothstep(-0.06, 0.05, uSunDir.y);
    const sunDisc = smoothstep(uSunCos, float(1.0), sunDot).mul(uSunDiscBright);
    const sunGlow = pow(max(sunDot, float(0.0)), uSunGlowPow).mul(uSunGlowStrength);
    skyCol.addAssign(uSunColor.mul(sunDisc.add(sunGlow)).mul(sunUpFade));

    // Moon disc + glow (mostly at night, fades below horizon).
    const moonDot = dot(dir, uMoonDir);
    const moonUpFade = smoothstep(-0.06, 0.05, uMoonDir.y)
      .mul(mix(float(0.25), float(1.0), nightF));
    const moonDisc = smoothstep(uMoonCos, float(1.0), moonDot).mul(uMoonDiscBright);
    const moonGlow = pow(max(moonDot, float(0.0)), uMoonGlowPow).mul(uMoonGlowStrength);
    skyCol.addAssign(uMoonColor.mul(moonDisc.add(moonGlow)).mul(moonUpFade));

    return vec4(max(skyCol, vec3(0.0)), 1.0);
  });

  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = skyColorNode();
  material.side = THREE.BackSide;
  material.depthWrite = false;
  material.depthTest = false;
  material.fog = false;

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material);
  mesh.renderOrder = -2;
  mesh.frustumCulled = false;
  mesh.name = "DayNightSkyDome";

  /**
   * @param {object} P    — PARAMS slice (sky.*)
   * @param {object} frame — { time, sunDir, moonDir, camera }
   */
  function update(P, frame) {
    mesh.position.copy(frame.camera.position);

    uTime.value = frame.time;
    uSunDir.value.copy(frame.sunDir);
    uMoonDir.value.copy(frame.moonDir);

    uZenithDay.value.set(P.zenithDay);
    uHorizonDay.value.set(P.horizonDay);
    uZenithNight.value.set(P.zenithNight);
    uHorizonNight.value.set(P.horizonNight);
    uSunsetColor.value.set(P.sunsetColor);
    uGroundColor.value.set(P.groundColor);

    uSunColor.value.set(P.sunColor);
    uSunCos.value = Math.cos(THREE.MathUtils.degToRad(P.sunSizeDeg));
    uSunGlowPow.value = P.sunGlowPow;
    uSunGlowStrength.value = P.sunGlowStrength;
    uSunDiscBright.value = P.sunDiscBright;

    uMoonColor.value.set(P.moonColor);
    uMoonCos.value = Math.cos(THREE.MathUtils.degToRad(P.moonSizeDeg));
    uMoonGlowStrength.value = P.moonGlowStrength;
    uMoonDiscBright.value = P.moonDiscBright;

    uStarDensity.value = P.starDensity;
    uStarThreshold.value = P.starThreshold;
    uStarSize.value = P.starSize;
    uStarBrightness.value = P.starBrightness;
    uStarTwinkle.value = P.starTwinkle;
  }

  function dispose() {
    mesh.geometry.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}

export const SKY_DEFAULTS = {
  zenithDay: "#2a6bd8",
  horizonDay: "#bfe0ff",
  zenithNight: "#05080f",
  horizonNight: "#1a2740",
  sunsetColor: "#ff7a33",
  groundColor: "#4a4a52",

  sunColor: "#fff3d8",
  sunSizeDeg: 1.2,
  sunGlowPow: 280,
  sunGlowStrength: 0.55,
  sunDiscBright: 8.0,

  moonColor: "#cdd9ff",
  moonSizeDeg: 1.6,
  moonGlowStrength: 0.25,
  moonDiscBright: 3.0,

  starDensity: 220,
  starThreshold: 0.92,
  starSize: 0.08,
  starBrightness: 1.0,
  starTwinkle: 3.0,
};
