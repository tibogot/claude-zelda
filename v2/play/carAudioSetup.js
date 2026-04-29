/**
 * Car driving layers — accel + idle engine, wind, nitro, wheels, drift brake.
 * Assets: `./static/sounds/vehicle/*`
 */
import * as THREE from "three";

const CAR_NITRO_MIN = 0.05;

const DEFAULT_PATHS = {
  engine: "./static/sounds/vehicle/Acceleration_sound.ogg",
  idle: "./static/sounds/vehicle/engine-idle.mp3",
  wind: "./static/sounds/vehicle/wind-speed.mp3",
  nitro: "./static/sounds/vehicle/nitro-activation.mp3",
  wheels: "./static/sounds/vehicle/wheels-surface.mp3",
  driftBrake: "./static/sounds/vehicle/brak_SOUND.ogg",
};

/**
 * Howler: `loop: true` = whole file, or sprite `[startMs, durationMs, true]` for a looping window.
 * @param {object} playMode
 * @param {"engine"|"idle"|"wind"|"wheels"|"driftBrake"} layer
 */
function howlerLoopLayerOptions(playMode, layer) {
  const s = playMode.carAudioSettings || {};
  const start = Math.max(0, Number(s[`${layer}LoopStartMs`]) || 0);
  const dur = Math.max(0, Number(s[`${layer}LoopDurationMs`]) || 0);
  if (dur > 0) {
    const spritePlayId = `_v2_${layer}`;
    return {
      loop: false,
      sprite: { [spritePlayId]: [start, dur, true] },
      spritePlayId,
    };
  }
  return { loop: true, sprite: undefined, spritePlayId: undefined };
}

/**
 * Reads `playMode.carAudioSettings` every frame so Tweakpane changes apply live.
 *
 * @param {object} playMode — `PlayMode` instance (`carAudioSettings`, `keysHeld`, `carVx`, …)
 * @param {{ register: Function, unregister: Function }} audioSystem — `createV2AudioSystem()` return
 * @param {Partial<typeof DEFAULT_PATHS>} [pathOverrides] — optional alternate asset URLs
 */
export function setupPlayModeCarAudio(playMode, audioSystem, pathOverrides = {}) {
  if (!audioSystem) return () => {};

  const paths = { ...DEFAULT_PATHS, ...pathOverrides };

  function settings() {
    const s = playMode.carAudioSettings || {};
    return {
      enabled: s.enabled !== false,
      engineMul: s.engineMul ?? 0.85,
      engineRefTopSpeed: s.engineRefTopSpeed ?? 52,
      engineVolAtTop: s.engineVolAtTop ?? 0.78,
      enginePitchMin: s.enginePitchMin ?? 0.88,
      enginePitchMax: s.enginePitchMax ?? 1.32,
      engineAccelThrottleFloor: s.engineAccelThrottleFloor ?? 0.24,
      engineAccelEaseUp: s.engineAccelEaseUp ?? 22,
      engineCoastFadeEaseLo: s.engineCoastFadeEaseLo ?? 2.6,
      engineCoastFadeEaseHi: s.engineCoastFadeEaseHi ?? 0.4,
      idleMul: s.idleMul ?? 1,
      idleVolRest: s.idleVolRest ?? 0.32,
      idleVolRoll: s.idleVolRoll ?? 0.38,
      idleRefSpeed: s.idleRefSpeed ?? 45,
      idlePitchMin: s.idlePitchMin ?? 0.88,
      idlePitchMax: s.idlePitchMax ?? 1.06,
      windMul: s.windMul ?? 0,
      nitroMul: s.nitroMul ?? 0.3,
      wheelsMul: s.wheelsMul ?? 0,
      driftBrakeMul: s.driftBrakeMul ?? 0.45,
    };
  }

  const registered = [];

  function carContextOk() {
    return (
      settings().enabled &&
      playMode.active &&
      playMode.moveMode === "car" &&
      playMode.carLoaded
    );
  }

  function whenCar(fn) {
    return (item, dt) => {
      if (!carContextOk()) {
        const k = 1 - Math.exp(-6 * dt);
        item.volume += (0 - item.volume) * k;
        return;
      }
      fn(item, dt);
    };
  }

  function smoothVolume(item, target, dt, easeUp = 10, easeDown = 2.5) {
    const delta = target - item.volume;
    const easing = delta > 0 ? easeUp : easeDown;
    item.volume += delta * Math.min(1, dt * easing);
  }

  function smoothScalar(cur, target, dt, lambda = 8) {
    return cur + (target - cur) * Math.min(1, dt * lambda);
  }

  // ── Accel engine: W + speed (throttle floor so it starts immediately; coast fade ∝ speed)
  const engLoop = howlerLoopLayerOptions(playMode, "engine");
  registered.push(
    audioSystem.register({
      bus: "vehicle",
      src: paths.engine,
      loop: engLoop.loop,
      ...(engLoop.sprite ? { sprite: engLoop.sprite, spritePlayId: engLoop.spritePlayId } : {}),
      autoplay: true,
      volume: 0,
      onPlaying: whenCar((item, dt) => {
        const st = settings();
        const keys = playMode.keysHeld;
        const forward = keys.KeyW || keys.ArrowUp;
        const drifting = playMode.carDrifting === true;
        const curSpeed = Math.sqrt(playMode.carVx * playMode.carVx + playMode.carVz * playMode.carVz);
        const ref = Math.max(8, st.engineRefTopSpeed);
        const speedT = THREE.MathUtils.smoothstep(curSpeed, 0, ref);
        if (drifting) {
          item.volume = 0;
          item.rate = st.enginePitchMin;
          return;
        }
        if (!forward) {
          const coastEase = THREE.MathUtils.lerp(
            st.engineCoastFadeEaseLo,
            st.engineCoastFadeEaseHi,
            THREE.MathUtils.smoothstep(curSpeed, 1, ref),
          );
          smoothVolume(item, 0, dt, 10, coastEase);
          item.rate = smoothScalar(item.rate, st.enginePitchMin, dt, 5);
          return;
        }
        const floor = THREE.MathUtils.clamp(st.engineAccelThrottleFloor, 0.04, 0.95);
        const accelDrive = Math.max(speedT, floor);
        const targetVol = Math.min(1.15, accelDrive * st.engineVolAtTop * st.engineMul);
        smoothVolume(item, targetVol, dt, st.engineAccelEaseUp, 2.5);
        const rateTarget = THREE.MathUtils.lerp(st.enginePitchMin, st.enginePitchMax, speedT);
        item.rate = smoothScalar(item.rate, rateTarget, dt, 10);
      }),
    }),
  );

  // ── Idle engine: off-throttle / coast bed (ducks while accelerating)
  const idleLoop = howlerLoopLayerOptions(playMode, "idle");
  registered.push(
    audioSystem.register({
      bus: "vehicle",
      src: paths.idle,
      loop: idleLoop.loop,
      ...(idleLoop.sprite ? { sprite: idleLoop.sprite, spritePlayId: idleLoop.spritePlayId } : {}),
      autoplay: true,
      volume: 0,
      onPlaying: whenCar((item, dt) => {
        const st = settings();
        const keys = playMode.keysHeld;
        const forward = keys.KeyW || keys.ArrowUp;
        const drifting = playMode.carDrifting === true;
        const curSpeed = Math.sqrt(playMode.carVx * playMode.carVx + playMode.carVz * playMode.carVz);
        const refIdle = Math.max(6, st.idleRefSpeed);
        const speedT = THREE.MathUtils.smoothstep(curSpeed, 0, refIdle);
        if (drifting) {
          item.volume = 0;
          return;
        }
        const roll = st.idleVolRest + speedT * st.idleVolRoll;
        const accelBlend = forward
          ? THREE.MathUtils.smoothstep(
            Math.max(speedT, st.engineAccelThrottleFloor),
            0.08,
            0.72,
          )
          : 0;
        const duck = forward ? 1 - accelBlend * 0.78 : 1;
        const targetVol = Math.min(1.2, roll * duck * st.idleMul);
        smoothVolume(item, targetVol, dt, 8, 5);
        const rateTarget = THREE.MathUtils.lerp(st.idlePitchMin, st.idlePitchMax, speedT);
        item.rate = smoothScalar(item.rate, rateTarget, dt, 6);
      }),
    }),
  );

  // ── Speed / air rush ──
  const windLoop = howlerLoopLayerOptions(playMode, "wind");
  registered.push(
    audioSystem.register({
      bus: "vehicle",
      src: paths.wind,
      loop: windLoop.loop,
      ...(windLoop.sprite ? { sprite: windLoop.sprite, spritePlayId: windLoop.spritePlayId } : {}),
      autoplay: true,
      volume: 0,
      onPlaying: whenCar((item, dt) => {
        const curSpeed = Math.sqrt(playMode.carVx * playMode.carVx + playMode.carVz * playMode.carVz);
        const speedEffect = THREE.MathUtils.clamp(curSpeed * 0.1, 0, 1);
        const air = playMode.carInAir ? 0.35 : 1;
        const targetVol = speedEffect * air * settings().windMul;
        smoothVolume(item, targetVol, dt);
        const rateTarget = THREE.MathUtils.clamp(
          THREE.MathUtils.mapLinear(speedEffect, 0, 1, 1, 1.85),
          0.9,
          2,
        );
        item.rate += (rateTarget - item.rate) * Math.min(1, dt * 5);
      }),
    }),
  );

  // ── Nitro: one-shot activation clip (fires once per “nitro active” burst)
  const nitroItem = audioSystem.register({
    bus: "vehicle",
    src: paths.nitro,
    loop: false,
    autoplay: false,
    volume: 0,
    rate: 1,
    pool: 4,
    onPlaying: whenCar((item) => {
      const keys = playMode.keysHeld;
      const forward = keys.KeyW || keys.ArrowUp;
      const backward = keys.KeyS || keys.ArrowDown;
      const keyN = !!keys.KeyN;
      const curSpeed = Math.sqrt(playMode.carVx * playMode.carVx + playMode.carVz * playMode.carVz);
      const active =
        keyN &&
        forward &&
        !backward &&
        curSpeed > 1 &&
        playMode.carNitro > CAR_NITRO_MIN;
      const prevActive = item._nitroPrevActive === true;
      const rising = active && !prevActive;
      if (rising) {
        item.volume = settings().nitroMul;
        try {
          item.howl.stop();
        } catch (_) {
          /* ignore */
        }
        item.howl.play();
      }
      item._nitroPrevActive = active;
    }),
  });
  nitroItem.howl.on("end", () => {
    nitroItem.volume = 0;
  });
  registered.push(nitroItem);

  // ── Handbrake / drift brake loop (Space) ──
  const driftLoop = howlerLoopLayerOptions(playMode, "driftBrake");
  registered.push(
    audioSystem.register({
      bus: "vehicle",
      src: paths.driftBrake,
      loop: driftLoop.loop,
      ...(driftLoop.sprite ? { sprite: driftLoop.sprite, spritePlayId: driftLoop.spritePlayId } : {}),
      autoplay: true,
      volume: 0,
      onPlaying: whenCar((item) => {
        const keys = playMode.keysHeld;
        const handbrake = !!keys.Space;
        const drifting = playMode.carDrifting === true;
        const curSpeed = Math.sqrt(playMode.carVx * playMode.carVx + playMode.carVz * playMode.carVz);
        const speedGate = THREE.MathUtils.smoothstep(curSpeed, 2, 16);
        if (!handbrake && !drifting) {
          item.volume = 0;
          item.rate = 1;
          return;
        }
        const st = settings();
        let drive;
        if (drifting) {
          drive = 0.78 + speedGate * 0.24;
        } else {
          drive = speedGate * 0.85;
        }
        const targetVol = Math.min(1.05, drive * st.driftBrakeMul);
        item.volume = targetVol;
        item.rate = THREE.MathUtils.lerp(
          0.94,
          1.14,
          THREE.MathUtils.smoothstep(curSpeed, 4, 26),
        );
      }),
    }),
  );

  // ── Wheels on surface ──
  const wheelsLoop = howlerLoopLayerOptions(playMode, "wheels");
  registered.push(
    audioSystem.register({
      bus: "vehicle",
      src: paths.wheels,
      loop: wheelsLoop.loop,
      ...(wheelsLoop.sprite ? { sprite: wheelsLoop.sprite, spritePlayId: wheelsLoop.spritePlayId } : {}),
      autoplay: true,
      volume: 0,
      onPlaying: whenCar((item, dt) => {
        const curSpeed = Math.sqrt(playMode.carVx * playMode.carVx + playMode.carVz * playMode.carVz);
        const grounded = playMode.carInAir ? 0 : 1;
        const targetVol =
          THREE.MathUtils.clamp(curSpeed * 0.1, 0, 1) * grounded * settings().wheelsMul;
        smoothVolume(item, targetVol, dt);
      }),
    }),
  );

  return () => {
    for (const r of registered) {
      audioSystem.unregister(r);
    }
    registered.length = 0;
  };
}
