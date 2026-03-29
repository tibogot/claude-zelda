/**
 * fx-butterflies.js
 * Butterfly & moth ambient particle effect for ambient-fx-editor.
 * - Folding-plane geometry: PlaneGeometry split at center, wing fold via TSL vertex shader
 * - Two InstancedMeshes: one for butterfly.png, one for moth.png
 * - Realistic movement: asymmetric flap, glide pauses, erratic jitter, banking, scalloped altitude
 * - TSL-driven wing flap with per-instance phase offset + glide modulation
 */

import * as THREE from "three";
import {
  abs, cos, float, instanceIndex, max, min, mix, positionLocal, pow, sin, step,
  texture, time, uniform, uv, vec3,
} from "three/tsl";

const BASE_COUNT = 50;

// ── Wing geometry: 2 x-segments so center column stays fixed during fold ──
function createWingGeo() {
  return new THREE.PlaneGeometry(1, 1, 2, 1);
}

// ── Pseudo-random from instanceIndex (fract-sin trick) ──
function iHash(offset) {
  return float(instanceIndex).add(float(offset)).mul(127.1).sin().mul(43758.5453).fract();
}

// ── TSL material with asymmetric wing-fold + glide pauses ──
function createWingMaterial(tex, uFlapSpeed, uFlapAngle, uGlideRatio) {
  // Per-instance random phase & speed variation
  const phase    = iHash(0).mul(Math.PI * 2);
  const speedVar = iHash(17).mul(0.4).add(0.8); // 0.8–1.2x base speed
  const glidePhase = iHash(33).mul(Math.PI * 2);
  const glideCycleVar = iHash(44).mul(0.5).add(0.75); // 0.75-1.25x glide cycle

  // Glide modulation: periodic windows where flap amplitude drops
  // smoothstep envelope: flapping → glide → flapping
  const glideCycle = time.mul(float(0.4)).mul(glideCycleVar).add(glidePhase);
  const glideWave  = sin(glideCycle).add(sin(glideCycle.mul(1.7))).mul(0.5);
  // glideActive: 1 = gliding, 0 = flapping
  const glideActive = step(float(1.0).sub(uGlideRatio), glideWave.mul(0.5).add(0.5));
  const flapMul = float(1.0).sub(glideActive.mul(0.85)); // keep 15% flap during glide

  // Asymmetric flap: fast upstroke (pow to sharpen), slow downstroke
  const rawPhase = time.mul(uFlapSpeed).mul(speedVar).add(phase);
  const sinWave  = sin(rawPhase);
  // Sharpen the positive half (upstroke) using pow, keep negative smooth (downstroke)
  const isUp     = step(float(0), sinWave); // 1 when positive
  const sharpUp  = pow(abs(sinWave), float(0.5)).mul(isUp);   // sqrt = sharper peak
  const slowDown = abs(sinWave).mul(float(1).sub(isUp));       // linear downstroke
  const asymFlap = sharpUp.sub(slowDown);

  const flapA = asymFlap.mul(uFlapAngle).mul(flapMul);

  // Glide rest angle: wings slightly open (V-shape) during glide
  const glideRest = glideActive.mul(float(0.15));

  // Wing fold around body axis
  const px   = positionLocal.x;
  const sgnX = step(float(0), px).mul(2).sub(1);
  const angle = flapA.mul(sgnX).add(glideRest.mul(sgnX));

  const cosA = cos(angle);
  const sinA = sin(angle);
  const newPos = vec3(px.mul(cosA), positionLocal.y, px.mul(sinA));

  // Texture sampling
  const texSample = texture(tex, uv());

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.positionNode   = newPos;
  mat.colorNode      = texSample;
  mat.opacityNode    = texSample.a;
  mat.alphaTestNode  = float(0.3);
  mat.transparent    = true;
  mat.depthWrite     = true;
  mat.side           = THREE.DoubleSide;

  return mat;
}

// ── Spawn per-instance data ──
function makeInstanceData(count, volume) {
  const data = [];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * volume;
    data.push({
      // Position
      x:  Math.cos(a) * r,
      z:  Math.sin(a) * r,
      baseY: 1.5 + Math.random() * 5.5,
      y:  0, // current Y, set on first frame

      // Velocity / heading
      vx: 0, vy: 0, vz: 0,
      yaw:    Math.random() * Math.PI * 2,
      roll:   0,
      speed:  1.5 + Math.random() * 2.0,

      // Jitter state
      jitterTimer:    Math.random() * 1.5,
      jitterInterval: 0.4 + Math.random() * 0.8,
      jitterYaw:      0,

      // Glide state (CPU-side for movement speed coupling)
      glideTimer:    Math.random() * 5,
      glideCycle:    3 + Math.random() * 4,
      isGliding:     false,
      glideDuration: 0,

      // Bob / altitude
      bobPhase:  Math.random() * Math.PI * 2,
      bobFreq:   0.8 + Math.random() * 1.0,
      bobAmp:    0.3 + Math.random() * 0.8,
      flapLiftAccum: 0,

      // Scale
      scale: 0.4 + Math.random() * 0.5,

      // Wind drift accumulator
      driftX: 0, driftZ: 0,
    });
  }
  return data;
}

// ── Per-frame update: erratic jitter + glide pauses + scalloped climb + banking ──
function updateInstances(im, data, count, dt, elapsed, shared, params, dummy) {
  if (!im || count === 0) return;

  const windX = shared.windX * shared.windStrength * 0.3;
  const windZ = shared.windZ * shared.windStrength * 0.3;
  const vol   = shared.volume;
  const cDt   = Math.min(dt, 0.05); // clamp to avoid big jumps

  for (let i = 0; i < count; i++) {
    const d = data[i];

    // ── Glide timing (CPU side) ──
    d.glideTimer += cDt;
    if (d.glideTimer > d.glideCycle) {
      d.glideTimer = 0;
      d.glideCycle = 3 + Math.random() * 4;
      d.isGliding = !d.isGliding;
      if (d.isGliding) d.glideDuration = 0.8 + Math.random() * 1.5;
    }
    if (d.isGliding) {
      d.glideDuration -= cDt;
      if (d.glideDuration <= 0) d.isGliding = false;
    }

    // Speed: slower during glide
    const speedMul = d.isGliding ? 0.4 : 1.0;
    const curSpeed = d.speed * params.moveSpeed * speedMul;

    // ── Erratic jitter: random heading nudges ──
    d.jitterTimer -= cDt;
    if (d.jitterTimer <= 0) {
      d.jitterTimer = d.jitterInterval * (0.7 + Math.random() * 0.6);
      // Random yaw change: mostly small, occasionally large
      const bigTurn = Math.random() < 0.15;
      d.jitterYaw = (Math.random() - 0.5) * (bigTurn ? 2.5 : 0.8);
    }
    // Smoothly apply jitter yaw
    d.yaw += d.jitterYaw * cDt * 3;
    d.jitterYaw *= (1 - cDt * 4); // decay

    // ── Scalloped altitude: climb during flap, sink during glide ──
    if (d.isGliding) {
      d.flapLiftAccum -= cDt * 1.2; // gentle descent
    } else {
      // Quick climb bursts synced to flap
      d.flapLiftAccum += cDt * 0.6;
    }
    // Keep altitude bounded
    d.flapLiftAccum = Math.max(-1.5, Math.min(1.5, d.flapLiftAccum));

    // Bob (gentler during glide)
    const bobMul = d.isGliding ? 0.2 : 1.0;
    const bob = Math.sin(elapsed * d.bobFreq * params.bobSpeed + d.bobPhase)
              * d.bobAmp * params.bobAmount * bobMul;

    const targetY = d.baseY + bob + d.flapLiftAccum + shared.groundY;
    d.y += (Math.max(targetY, shared.groundY + 0.5) - d.y) * Math.min(cDt * 4, 1);

    // ── Movement ──
    d.vx = Math.sin(d.yaw) * curSpeed;
    d.vz = Math.cos(d.yaw) * curSpeed;
    d.x += (d.vx + windX) * cDt;
    d.z += (d.vz + windZ) * cDt;

    // ── Boundary: steer back toward center if too far ──
    const dist = Math.sqrt(d.x * d.x + d.z * d.z);
    if (dist > vol * 1.2) {
      const toCenter = Math.atan2(-d.x, -d.z);
      let dYaw = toCenter - d.yaw;
      if (dYaw >  Math.PI) dYaw -= Math.PI * 2;
      if (dYaw < -Math.PI) dYaw += Math.PI * 2;
      d.yaw += dYaw * cDt * 1.5;
    }

    // ── Banking: roll into turns ──
    const targetRoll = -d.jitterYaw * 0.6;
    d.roll += (targetRoll - d.roll) * Math.min(cDt * 5, 1);

    // ── Pitch: nose-down during glide, slight up during active flap ──
    const pitch = d.isGliding ? -0.25 : -0.08;

    dummy.position.set(d.x, d.y, d.z);
    dummy.rotation.set(pitch, d.yaw, d.roll);
    dummy.scale.setScalar(d.scale);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  }

  im.instanceMatrix.needsUpdate = true;
}

// ══════════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════════

export function createButterflyFX(scene, shared) {
  const params = {
    flapSpeed:  8.0,
    flapAngle:  0.8,
    glideRatio: 0.45,
    moveSpeed:  0.8,
    bobAmount:  0.8,
    bobSpeed:   1.5,
    mothRatio:  0.3,
  };

  const uFlapSpeed  = uniform(float(params.flapSpeed));
  const uFlapAngle  = uniform(float(params.flapAngle));
  const uGlideRatio = uniform(float(params.glideRatio));

  // Textures
  const loader = new THREE.TextureLoader();
  const texB = loader.load("textures/butterfly.png");
  const texM = loader.load("textures/moth.png");
  [texB, texM].forEach(t => { t.colorSpace = THREE.SRGBColorSpace; });

  // Geometry + materials
  const geo  = createWingGeo();
  const matB = createWingMaterial(texB, uFlapSpeed, uFlapAngle, uGlideRatio);
  const matM = createWingMaterial(texM, uFlapSpeed, uFlapAngle, uGlideRatio);

  let imB = null, imM = null;
  let dataB = [], dataM = [];
  let countB = 0, countM = 0;
  const dummy = new THREE.Object3D();

  function spawn() {
    if (imB) { scene.remove(imB); imB.dispose(); imB = null; }
    if (imM) { scene.remove(imM); imM.dispose(); imM = null; }

    const total = Math.round(BASE_COUNT * shared.density);
    countM = Math.round(total * params.mothRatio);
    countB = total - countM;

    dataB = makeInstanceData(countB, shared.volume);
    dataM = makeInstanceData(countM, shared.volume);

    if (countB > 0) {
      imB = new THREE.InstancedMesh(geo, matB, countB);
      imB.count = countB;
      imB.frustumCulled = false;
      scene.add(imB);
    }
    if (countM > 0) {
      imM = new THREE.InstancedMesh(geo, matM, countM);
      imM.count = countM;
      imM.frustumCulled = false;
      scene.add(imM);
    }
  }

  spawn();

  function update(dt, elapsed) {
    updateInstances(imB, dataB, countB, dt, elapsed, shared, params, dummy);
    updateInstances(imM, dataM, countM, dt, elapsed, shared, params, dummy);
  }

  function dispose(sc) {
    if (imB) { sc.remove(imB); imB.dispose(); imB = null; }
    if (imM) { sc.remove(imM); imM.dispose(); imM = null; }
    dataB = []; dataM = [];
    countB = 0; countM = 0;
  }

  return { update, dispose, spawn, params, uFlapSpeed, uFlapAngle, uGlideRatio };
}

export function buildButterflyUI(folder, state) {
  folder.addBinding(state.params, "flapSpeed", {
    label: "Flap Speed", min: 2, max: 20, step: 0.5,
  }).on("change", () => { state.uFlapSpeed.value = state.params.flapSpeed; });

  folder.addBinding(state.params, "flapAngle", {
    label: "Flap Angle", min: 0.1, max: 1.5, step: 0.05,
  }).on("change", () => { state.uFlapAngle.value = state.params.flapAngle; });

  folder.addBinding(state.params, "glideRatio", {
    label: "Glide Ratio", min: 0, max: 0.8, step: 0.05,
  }).on("change", () => { state.uGlideRatio.value = state.params.glideRatio; });

  folder.addBlade({ view: "separator" });

  folder.addBinding(state.params, "moveSpeed",  { label: "Move Speed",  min: 0.1, max: 3,   step: 0.1 });
  folder.addBinding(state.params, "bobAmount",  { label: "Bob Amount",  min: 0,   max: 2,   step: 0.1 });
  folder.addBinding(state.params, "bobSpeed",   { label: "Bob Speed",   min: 0.2, max: 3,   step: 0.1 });

  folder.addBlade({ view: "separator" });

  folder.addBinding(state.params, "mothRatio", { label: "Moth Ratio", min: 0, max: 1, step: 0.05 });

  folder.addButton({ title: "Respawn" }).on("click", () => state.spawn());
}
