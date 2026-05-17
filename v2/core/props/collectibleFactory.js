/**
 * Procedural collectibles (coin / heart / key) as live props.
 * Each returns the same shape as flagFactory: { group, update, dispose, setParam, getParams }
 * plus `kind` and `pickupRadius` read by collectibleRuntime.
 *
 * Visuals use TSL (MeshStandardNodeMaterial) so emissive pulse + rim glow run on GPU.
 */
import * as THREE from "three";
import { MeshStandardNodeMaterial } from "three";
import {
  uniform, float, mix, abs, sin, time, normalView, oneMinus,
} from "three/tsl";

const TAU = Math.PI * 2;

/* ─────────── shared TSL emissive material ─────────── */

/**
 * Standard PBR + animated emissive pulse + Fresnel rim.
 * Returns { material, uniforms } so the factory can tweak color/intensity at runtime.
 */
function buildGlowMaterial({ color, emissive, intensity = 1.0, metalness = 0.85, roughness = 0.25 }) {
  const mat = new MeshStandardNodeMaterial({
    color: new THREE.Color(color),
    metalness,
    roughness,
  });
  const uEmissive = uniform(new THREE.Color(emissive));
  const uIntensity = uniform(intensity);

  const pulse = mix(float(0.7), float(1.3), sin(time.mul(3.0)).mul(0.5).add(0.5));

  // View-space Fresnel: normalView.z is cos(angle to camera); rim is bright at grazing angles.
  const rim = oneMinus(abs(normalView.z)).pow(2.0);

  mat.emissiveNode = uEmissive.mul(uIntensity).mul(pulse).add(uEmissive.mul(rim).mul(0.6));
  return { material: mat, uEmissive, uIntensity };
}

/* ─────────── shared animation: spin + bob ─────────── */

function applySpinBob(mesh, opts) {
  const { spinSpeed = 2.0, bobAmp = 0.15, bobSpeed = 1.6, baseY = 0 } = opts;
  let t = Math.random() * 100;
  mesh.userData._anim = (dt) => {
    t += dt;
    mesh.rotation.y += spinSpeed * dt;
    mesh.position.y = baseY + Math.sin(t * bobSpeed) * bobAmp;
  };
  return mesh;
}

/* ─────────── COIN ─────────── */

export const COIN_DEFAULTS = {
  radius: 0.4,
  thickness: 0.08,
  color: "#ffcc33",
  emissive: "#ffaa00",
  intensity: 1.0,
  spinSpeed: 2.2,
  bobAmp: 0.15,
  bobSpeed: 1.6,
  pickupRadius: 1.2,
};

export function coinBoundingBox(params) {
  const p = { ...COIN_DEFAULTS, ...params };
  const r = p.radius;
  return new THREE.Box3(
    new THREE.Vector3(-r, 0, -r),
    new THREE.Vector3(r, p.radius * 2 + p.bobAmp, r),
  );
}

export function createCoinProp(params = {}) {
  const p = { ...COIN_DEFAULTS, ...params };

  const group = new THREE.Group();

  const geo = new THREE.CylinderGeometry(p.radius, p.radius, p.thickness, 32, 1);
  geo.rotateX(Math.PI / 2); // face camera (axis along Z), spin around Y
  const glow = buildGlowMaterial({
    color: p.color,
    emissive: p.emissive,
    intensity: p.intensity,
    metalness: 0.9,
    roughness: 0.2,
  });
  const mesh = new THREE.Mesh(geo, glow.material);
  mesh.castShadow = true;
  applySpinBob(mesh, { spinSpeed: p.spinSpeed, bobAmp: p.bobAmp, bobSpeed: p.bobSpeed, baseY: p.radius + 0.2 });
  mesh.position.y = p.radius + 0.2;
  group.add(mesh);

  function update(dt) { mesh.userData._anim?.(dt); }
  function dispose() { geo.dispose(); glow.material.dispose(); }
  function setParam(key, value) {
    if (key === "color") glow.material.color.set(value);
    else if (key === "emissive") glow.uEmissive.value.set(value);
    else if (key === "intensity") glow.uIntensity.value = value;
    else if (key === "pickupRadius") api.pickupRadius = value;
    else if (key === "spinSpeed" || key === "bobAmp" || key === "bobSpeed") {
      applySpinBob(mesh, { spinSpeed: p.spinSpeed, bobAmp: p.bobAmp, bobSpeed: p.bobSpeed, baseY: p.radius + 0.2, [key]: value });
      p[key] = value;
    }
  }
  function getParams() { return { ...p }; }

  const api = {
    group, update, dispose, setParam, getParams,
    kind: "coin",
    pickupRadius: p.pickupRadius,
    burstColor: new THREE.Color(p.emissive),
  };
  return api;
}

/* ─────────── HEART ─────────── */

export const HEART_DEFAULTS = {
  size: 0.45,
  color: "#ff4d6d",
  emissive: "#ff1f4f",
  intensity: 1.2,
  spinSpeed: 1.4,
  bobAmp: 0.18,
  bobSpeed: 1.4,
  pickupRadius: 1.4,
};

export function heartBoundingBox(params) {
  const p = { ...HEART_DEFAULTS, ...params };
  const s = p.size;
  return new THREE.Box3(
    new THREE.Vector3(-s, 0, -s * 0.4),
    new THREE.Vector3(s, p.size * 2 + p.bobAmp, s * 0.4),
  );
}

function buildHeartGeometry(size) {
  // 2D heart extruded along Z (thin slab) — classic Shape + ExtrudeGeometry.
  const shape = new THREE.Shape();
  const s = size;
  shape.moveTo(0, -s * 0.6);
  shape.bezierCurveTo(s * 1.4, s * 0.3, s * 0.4, s * 1.3, 0, s * 0.6);
  shape.bezierCurveTo(-s * 0.4, s * 1.3, -s * 1.4, s * 0.3, 0, -s * 0.6);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: s * 0.35,
    bevelEnabled: true,
    bevelThickness: s * 0.08,
    bevelSize: s * 0.08,
    bevelSegments: 3,
    curveSegments: 18,
  });
  geo.center();
  geo.computeVertexNormals();
  return geo;
}

export function createHeartProp(params = {}) {
  const p = { ...HEART_DEFAULTS, ...params };
  const group = new THREE.Group();

  const geo = buildHeartGeometry(p.size);
  const glow = buildGlowMaterial({
    color: p.color,
    emissive: p.emissive,
    intensity: p.intensity,
    metalness: 0.1,
    roughness: 0.35,
  });
  const mesh = new THREE.Mesh(geo, glow.material);
  mesh.castShadow = true;
  applySpinBob(mesh, { spinSpeed: p.spinSpeed, bobAmp: p.bobAmp, bobSpeed: p.bobSpeed, baseY: p.size + 0.2 });
  mesh.position.y = p.size + 0.2;
  group.add(mesh);

  function update(dt) { mesh.userData._anim?.(dt); }
  function dispose() { geo.dispose(); glow.material.dispose(); }
  function setParam(key, value) {
    if (key === "color") glow.material.color.set(value);
    else if (key === "emissive") glow.uEmissive.value.set(value);
    else if (key === "intensity") glow.uIntensity.value = value;
    else if (key === "pickupRadius") api.pickupRadius = value;
  }
  function getParams() { return { ...p }; }

  const api = {
    group, update, dispose, setParam, getParams,
    kind: "heart",
    pickupRadius: p.pickupRadius,
    burstColor: new THREE.Color(p.emissive),
  };
  return api;
}

/* ─────────── KEY ─────────── */

export const KEY_DEFAULTS = {
  size: 0.5,
  color: "#dfe4ff",
  emissive: "#7aa8ff",
  intensity: 0.9,
  spinSpeed: 1.8,
  bobAmp: 0.12,
  bobSpeed: 1.8,
  pickupRadius: 1.1,
};

export function keyBoundingBox(params) {
  const p = { ...KEY_DEFAULTS, ...params };
  const s = p.size;
  return new THREE.Box3(
    new THREE.Vector3(-s * 0.3, 0, -s * 0.6),
    new THREE.Vector3(s * 0.3, p.size * 2 + p.bobAmp, s * 0.6),
  );
}

export function createKeyProp(params = {}) {
  const p = { ...KEY_DEFAULTS, ...params };
  const group = new THREE.Group();

  const s = p.size;
  const glow = buildGlowMaterial({
    color: p.color,
    emissive: p.emissive,
    intensity: p.intensity,
    metalness: 0.95,
    roughness: 0.18,
  });

  // Ring (bow)
  const ringGeo = new THREE.TorusGeometry(s * 0.28, s * 0.07, 12, 24);
  const ring = new THREE.Mesh(ringGeo, glow.material);
  ring.castShadow = true;
  ring.position.set(0, s * 0.3, 0);

  // Shaft
  const shaftGeo = new THREE.CylinderGeometry(s * 0.05, s * 0.05, s * 0.7, 10);
  shaftGeo.translate(0, -s * 0.45, 0);
  const shaft = new THREE.Mesh(shaftGeo, glow.material);
  shaft.castShadow = true;
  shaft.position.set(0, s * 0.3, 0);

  // Teeth
  const tooth1Geo = new THREE.BoxGeometry(s * 0.18, s * 0.06, s * 0.08);
  tooth1Geo.translate(s * 0.09, -s * 0.62, 0);
  const tooth1 = new THREE.Mesh(tooth1Geo, glow.material);
  tooth1.castShadow = true;
  tooth1.position.set(0, s * 0.3, 0);

  const tooth2Geo = new THREE.BoxGeometry(s * 0.13, s * 0.06, s * 0.08);
  tooth2Geo.translate(s * 0.07, -s * 0.78, 0);
  const tooth2 = new THREE.Mesh(tooth2Geo, glow.material);
  tooth2.castShadow = true;
  tooth2.position.set(0, s * 0.3, 0);

  const keyRoot = new THREE.Group();
  keyRoot.add(ring, shaft, tooth1, tooth2);
  applySpinBob(keyRoot, { spinSpeed: p.spinSpeed, bobAmp: p.bobAmp, bobSpeed: p.bobSpeed, baseY: p.size + 0.3 });
  keyRoot.position.y = p.size + 0.3;
  group.add(keyRoot);

  function update(dt) { keyRoot.userData._anim?.(dt); }
  function dispose() {
    ringGeo.dispose(); shaftGeo.dispose(); tooth1Geo.dispose(); tooth2Geo.dispose();
    glow.material.dispose();
  }
  function setParam(key, value) {
    if (key === "color") glow.material.color.set(value);
    else if (key === "emissive") glow.uEmissive.value.set(value);
    else if (key === "intensity") glow.uIntensity.value = value;
    else if (key === "pickupRadius") api.pickupRadius = value;
  }
  function getParams() { return { ...p }; }

  const api = {
    group, update, dispose, setParam, getParams,
    kind: "key",
    pickupRadius: p.pickupRadius,
    burstColor: new THREE.Color(p.emissive),
  };
  return api;
}

/* ─────────── meta ─────────── */

export const COLLECTIBLE_KINDS = new Set(["coin", "heart", "key"]);
