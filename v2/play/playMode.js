import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  attribute, float, vec3, pow, sub, abs, smoothstep, mul, mix, add,
} from "three/tsl";
import { loadTreeGlbFromUrl, getSharedGltfLoader } from "../core/foliage/glbLoader.js";

const CAP_R = 0.4;
const CAP_H = 1.2;
const GRAVITY = 20.0;
const JUMP_VEL = 11.0;
const MOVE_SPEED = 12;

const CHAR_MODEL = "../models/UA1+UA2_compressed.glb";
const CHAR_KATANA = "../models/katana.glb";
const CHAR_HAT = "../models/asian_conical_hat_compressed.glb";
const CHAR_HEIGHT = 2.5;
const CHAR_WALK_SPEED = 4.0;
const CHAR_RUN_SPEED = 8.0;
const CHAR_JUMP_VEL = 11.0;
const CHAR_GRAVITY = 20.0;
const CHAR_ROLL_PEAK = 13.0;
const CHAR_GLIDE_FALL_SPEED = 3.0;
const CHAR_SLIDE_SPEED = 10.0;
const CHAR_SLIDE_MAX_TIME = 1.2;
const PI = Math.PI;

const PLANE_MAX_FWD = 56;
const PLANE_MAX_FWD_BOOST = 78;
const PLANE_SHIFT_ACCEL_MULT = 1.5;
const PLANE_MAX_REV = 18;
const PLANE_ACCEL = 10.5;
const PLANE_BRAKE = 26;
const PLANE_REV_ACCEL = 8;
const PLANE_COAST = 3.8;
const PLANE_DRAG = 0.014;
const PLANE_DECK_ALT = 1.15;
const PLANE_DECK_COAST_MULT = 2.1;
const CAM_DIST = 8;
const CAM_SENS_X = 0.002;
const CAM_SENS_Y = 0.002;
const ISO_PITCH = 1.0;
const ISO_DIST_DEFAULT = 26;
const ISO_DIST_MIN = 10;
const ISO_DIST_MAX = 70;
const ISO_YAW_ROT_SPEED = 1.6;
const ISO_MOVE_RING_Y_OFFSET = 0.08;
const ISO_HOVER_PICK_MIN_MS = 16;

const FLY_MOUSE_SENS_X = 0.0022;
const FLY_MOUSE_SENS_Y = 0.00235;
const FLY_PITCH_MIN = -1.22;
const FLY_PITCH_MAX = 0.9;
const FLY_PITCH_CLIMB_SCALE = 26;
const FLY_PITCH_DIVE_MULT = 1.82;
const FLY_ROLL_MAX = 0.78;
const FLY_ROLL_VEL_SCALE = 0.0042;
const FLY_ROLL_SMOOTH = 10;
const FLY_ROLL_TARGET_DECAY = 5;
const FLY_BARREL_DURATION = 0.88;
const FLY_SURFACE_ALT = 1.35;
const FLY_SURFACE_SPEED = 16;
const FLY_AILERON_RATE = 2.8;
const ISO_FLY_YAW_RATE = 1.9;
const ISO_FLY_CLIMB_RATE = 28;
const ISO_FLY_DESCEND_RATE = 48;
const ISO_FLY_CHASE_SMOOTH = 5.5;

// Drift car physics — arcade model
const CAR_MODEL = "../models/bruno.glb";
const CAR_MODEL_YAW = Math.PI / 2;
const CAR_MODEL_SCALE = 1.6;
const CAR_ACCEL = 26;
const CAR_ACCEL_BOOST = 52;
const CAR_BRAKE = 35;
const CAR_REVERSE_ACCEL = 12;
const CAR_MAX_SPEED = 45;
const CAR_MAX_SPEED_BOOST = 72;
const CAR_MAX_REVERSE = 10;
const CAR_COAST = 1.35;
const CAR_DRAG = 0.0042;
const CAR_TURN_RATE = 1.0;
const CAR_TURN_RATE_DRIFT = 2.0;
const CAR_GRIP_NORMAL = 12;
const CAR_GRIP_DRIFT = 0.8;
const CAR_GRIP_BRAKE_TURN = 2.0;
const CAR_DRIFT_ENTRY_SPEED = 8;
const CAR_RIDE_HEIGHT = 0.35;
const CAR_WHEEL_RADIUS = 0.42;
const CAR_DRIFT_ANGLE_MIN = 0.1;
const CAR_CAM_DIST = 10;
const CAR_CAM_HEIGHT = 3.5;
const CAR_CAM_CHASE_SPEED = 3.5;
const CAR_CAM_DRIFT_LAG = 1.8;
const CAR_HANDBRAKE_DECEL = 3;
const CAR_HALF_WIDTH = 1.1;
const CAR_HALF_LENGTH = 2.5;
const CAR_BODY_HEIGHT = 0.8;
const CAR_GRAVITY = 28;
const CAR_EDGE_DROP_THRESHOLD = 0.45;
const CAR_COLLISION_SKIN = 0.08;
const CAR_COLLISION_ITERS = 3;
const CAR_NITRO_KEY = "KeyN";
const CAR_NITRO_ACCEL_BONUS = 22;
const CAR_NITRO_MAX_SPEED_BONUS = 26;
const CAR_NITRO_DRAIN_PER_SEC = 0.32;
const CAR_NITRO_REGEN_PER_SEC = 0.14;
const CAR_NITRO_MIN_TO_USE = 0.05;
const CAR_BASE_ACCEL_LOW_SPEED_MUL = 0.52;
const CAR_BASE_ACCEL_RAMP_TO_KMH = 100;
const CAR_BODY_ROLL_MAX = 0.2;
const CAR_BODY_PITCH_MAX = 0.14;
const CAR_BODY_TERRAIN_ROLL_MAX = 0.16;
const CAR_BODY_TERRAIN_PITCH_MAX = 0.14;
const CAR_BODY_SMOOTH = 14;
const CAR_TERRAIN_BODY_SMOOTH = 9;
const CAR_WHEEL_BASE = 1.9;
const CAR_TRACK = 1.1;

const DRIFT_MARK_MAX_SEGMENTS = 4096;
const DRIFT_MARK_VERTS_PER_SEGMENT = 6;
const DRIFT_MARK_FLOATS_PER_SEGMENT = DRIFT_MARK_VERTS_PER_SEGMENT * 3;
const DRIFT_MARK_COLOR_FLOATS_PER_SEGMENT = DRIFT_MARK_VERTS_PER_SEGMENT * 4;
const DRIFT_MARK_WIDTH = 0.09;
const DRIFT_MARK_Y_OFFSET = 0.045;
const DRIFT_MARK_MIN_SEGMENT_LENGTH = 0.035;
const DRIFT_MARK_INTENSITY_MIN = 0.15;
const DRIFT_MARK_INTENSITY_MAX = 0.9;
const DRIFT_MARK_INV_INTENSITY_RANGE = 1 / (DRIFT_MARK_INTENSITY_MAX - DRIFT_MARK_INTENSITY_MIN);

const DRIFT_SMOKE_POOL_SIZE = 256;
const DRIFT_SMOKE_VERTS_PER_PARTICLE = 6;
const DRIFT_SMOKE_FLOATS_PER_PARTICLE = DRIFT_SMOKE_VERTS_PER_PARTICLE * 3;
const DRIFT_SMOKE_COLOR_FLOATS_PER_PARTICLE = DRIFT_SMOKE_VERTS_PER_PARTICLE * 4;
const DRIFT_SMOKE_UV_FLOATS_PER_PARTICLE = DRIFT_SMOKE_VERTS_PER_PARTICLE * 2;
const DRIFT_SMOKE_TEXTURE = "../Starter-Kit-Racing-master/sprites/smoke.png";
const DRIFT_SMOKE_EMIT_RATE = 48;
const DRIFT_SMOKE_LIFE_MIN = 0.65;
const DRIFT_SMOKE_LIFE_MAX = 1.45;
const DRIFT_SMOKE_SIZE_MIN = 0.55;
const DRIFT_SMOKE_SIZE_MAX = 1.05;
const DRIFT_SMOKE_SIZE_GROWTH = 2.6;
const DRIFT_SMOKE_OPACITY = 0.55;
const DRIFT_SMOKE_RISE = 0.75;
const DRIFT_SMOKE_SPREAD = 0.55;
const DRIFT_SMOKE_SPEED_DRAG = 0.12;
const DRIFT_SMOKE_COLOR = new THREE.Color(0x6a6c76);
const DRIFT_SMOKE_INTENSITY_MIN = 0.04;

const TRAIL_SEG = 90;
const TRAIL_HALF_W = 0.038;
const TRAIL_MAX_DIST = 8.0;

const GUN_FIRE_RATE = 12;
const GUN_BULLET_SPEED = 240;
const GUN_BULLET_MAX_DIST = 600;
const GUN_BULLET_SIZE = 0.7;
const GUN_BULLET_POOL = 64;
const GUN_TRACER_COLOR = 0xfff0a0;

const PLANE_MODEL = "../models/wenning_carsten_gameart_plane_compressed.glb";

/* ── Shared TSL trail material ── */
function createTrailMaterial() {
  const mat = new MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const trUV = attribute("trailUV");
  const lenT = trUV.x;
  const lenFade = pow(sub(float(1.0), lenT), float(1.6));
  const edge = abs(sub(trUV.y, float(0.5))).mul(float(2));
  const edgeFade = sub(float(1.0), smoothstep(float(0.15), float(0.95), edge));
  const alpha = mul(lenFade, edgeFade, float(0.72));
  const coreColor = mix(vec3(1.0, 1.0, 1.0), vec3(0.65, 0.85, 1.0), lenT);
  const coreBright = sub(float(1.0), smoothstep(float(0.0), float(0.55), edge));
  mat.colorNode = add(coreColor, mul(vec3(0.3, 0.25, 0.2), coreBright));
  mat.opacityNode = alpha;
  return mat;
}

const _trDir = new THREE.Vector3();
const _trSide = new THREE.Vector3();
const _trUp = new THREE.Vector3(0, 1, 0);
const _trTipWorld = new THREE.Vector3();
const _dmDir = new THREE.Vector3();
const _dmSide = new THREE.Vector3();
const _dmPL = new THREE.Vector3();
const _dmPR = new THREE.Vector3();
const _dmCL = new THREE.Vector3();
const _dmCR = new THREE.Vector3();
const _smokeRight = new THREE.Vector3();
const _smokeUp = new THREE.Vector3();
const _smokeCorner = new THREE.Vector3();
const _smokeHalfRight = new THREE.Vector3();
const _smokeHalfUp = new THREE.Vector3();
const _smokeUvs = [
  0, 0,
  1, 0,
  0, 1,
  1, 0,
  1, 1,
  0, 1,
];

class DriftMarks {
  constructor(scene) {
    const positions = new Float32Array(DRIFT_MARK_MAX_SEGMENTS * DRIFT_MARK_FLOATS_PER_SEGMENT);
    const colors = new Float32Array(DRIFT_MARK_MAX_SEGMENTS * DRIFT_MARK_COLOR_FLOATS_PER_SEGMENT);
    for (let i = 0; i < DRIFT_MARK_MAX_SEGMENTS * DRIFT_MARK_VERTS_PER_SEGMENT; i++) {
      const o = i * 4;
      colors[o] = 1;
      colors[o + 1] = 1;
      colors[o + 2] = 1;
    }

    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", posAttr);

    const colorAttr = new THREE.BufferAttribute(colors, 4);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("color", colorAttr);
    geometry.setDrawRange(0, 0);

    const material = new THREE.MeshBasicMaterial({
      color: 0x111111,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.positions = positions;
    this.colors = colors;
    this.geometry = geometry;
    this.segmentIndex = 0;
    this.drawCount = 0;
    this.states = [
      { prev: new THREE.Vector3(), active: false },
      { prev: new THREE.Vector3(), active: false },
    ];
  }

  reset() {
    this.segmentIndex = 0;
    this.drawCount = 0;
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
    this.states[0].active = false;
    this.states[1].active = false;
  }

  update(rearPoints, emit, intensity) {
    this._track(rearPoints[0], emit, intensity, this.states[0]);
    this._track(rearPoints[1], emit, intensity, this.states[1]);
  }

  _track(point, emit, intensity, state) {
    if (!point) {
      state.active = false;
      return;
    }
    if (emit && state.active) this._addSegment(state.prev, point, intensity);
    state.prev.copy(point);
    state.active = emit;
  }

  _addSegment(prev, curr, intensity) {
    _dmDir.subVectors(curr, prev);
    _dmDir.y = 0;
    const len = _dmDir.length();
    if (len < DRIFT_MARK_MIN_SEGMENT_LENGTH) return;
    _dmDir.divideScalar(len);

    _dmSide.set(_dmDir.z, 0, -_dmDir.x).multiplyScalar(DRIFT_MARK_WIDTH);
    _dmPL.copy(prev).add(_dmSide);
    _dmPR.copy(prev).sub(_dmSide);
    _dmCL.copy(curr).add(_dmSide);
    _dmCR.copy(curr).sub(_dmSide);

    const offset = this.segmentIndex * DRIFT_MARK_FLOATS_PER_SEGMENT;
    const p = this.positions;
    p[offset + 0] = _dmPL.x; p[offset + 1] = _dmPL.y; p[offset + 2] = _dmPL.z;
    p[offset + 3] = _dmPR.x; p[offset + 4] = _dmPR.y; p[offset + 5] = _dmPR.z;
    p[offset + 6] = _dmCL.x; p[offset + 7] = _dmCL.y; p[offset + 8] = _dmCL.z;
    p[offset + 9] = _dmPR.x; p[offset + 10] = _dmPR.y; p[offset + 11] = _dmPR.z;
    p[offset + 12] = _dmCR.x; p[offset + 13] = _dmCR.y; p[offset + 14] = _dmCR.z;
    p[offset + 15] = _dmCL.x; p[offset + 16] = _dmCL.y; p[offset + 17] = _dmCL.z;

    const alpha = THREE.MathUtils.clamp(
      (intensity - DRIFT_MARK_INTENSITY_MIN) * DRIFT_MARK_INV_INTENSITY_RANGE,
      0,
      1,
    );
    const colorOffset = this.segmentIndex * DRIFT_MARK_COLOR_FLOATS_PER_SEGMENT;
    for (let i = 0; i < DRIFT_MARK_VERTS_PER_SEGMENT; i++) {
      this.colors[colorOffset + i * 4 + 3] = alpha;
    }

    const posAttr = this.geometry.attributes.position;
    posAttr.addUpdateRange(offset, DRIFT_MARK_FLOATS_PER_SEGMENT);
    posAttr.needsUpdate = true;
    const colorAttr = this.geometry.attributes.color;
    colorAttr.addUpdateRange(colorOffset, DRIFT_MARK_COLOR_FLOATS_PER_SEGMENT);
    colorAttr.needsUpdate = true;

    this.segmentIndex = (this.segmentIndex + 1) % DRIFT_MARK_MAX_SEGMENTS;
    if (this.drawCount < DRIFT_MARK_MAX_SEGMENTS * DRIFT_MARK_VERTS_PER_SEGMENT) {
      this.drawCount += DRIFT_MARK_VERTS_PER_SEGMENT;
      this.geometry.setDrawRange(0, this.drawCount);
    }
    this.mesh.visible = this.drawCount > 0;
  }
}

class DriftSmoke {
  constructor(scene, settings) {
    this.settings = settings || {};
    const positions = new Float32Array(DRIFT_SMOKE_POOL_SIZE * DRIFT_SMOKE_FLOATS_PER_PARTICLE);
    const colors = new Float32Array(DRIFT_SMOKE_POOL_SIZE * DRIFT_SMOKE_COLOR_FLOATS_PER_PARTICLE);
    const uvs = new Float32Array(DRIFT_SMOKE_POOL_SIZE * DRIFT_SMOKE_UV_FLOATS_PER_PARTICLE);
    for (let i = 0; i < DRIFT_SMOKE_POOL_SIZE; i++) {
      uvs.set(_smokeUvs, i * DRIFT_SMOKE_UV_FLOATS_PER_PARTICLE);
    }

    const geometry = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(positions, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", posAttr);
    const colorAttr = new THREE.BufferAttribute(colors, 4);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("color", colorAttr);
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geometry.setDrawRange(0, 0);

    const map = new THREE.TextureLoader().load(
      DRIFT_SMOKE_TEXTURE,
      undefined,
      undefined,
      (err) => console.warn("[V2] Failed to load drift smoke texture:", DRIFT_SMOKE_TEXTURE, err),
    );
    map.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map,
      color: 0xffffff,
      transparent: true,
      vertexColors: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.positions = positions;
    this.colors = colors;
    this.geometry = geometry;
    this.material = material;
    this.map = map;
    this.particles = Array.from({ length: DRIFT_SMOKE_POOL_SIZE }, () => ({
      life: 0,
      maxLife: 1,
      position: new THREE.Vector3(),
      velocity: new THREE.Vector3(),
      size: 1,
      rotation: 0,
      spin: 0,
    }));
    this.emitIndex = 0;
    this.emitAccum = [0, 0];
  }

  reset() {
    for (const p of this.particles) p.life = 0;
    this.emitAccum[0] = 0;
    this.emitAccum[1] = 0;
    this.geometry.setDrawRange(0, 0);
    this.mesh.visible = false;
  }

  update(dt, rearPoints, emit, intensity, velocityX, velocityZ, camera) {
    const s = this.settings;
    if (s.enabled === false) emit = false;
    if (emit) {
      const emitRate = (s.emitRate ?? DRIFT_SMOKE_EMIT_RATE) * THREE.MathUtils.clamp(intensity, 0, 1);
      for (let i = 0; i < rearPoints.length; i++) {
        const point = rearPoints[i];
        if (!point) continue;
        this.emitAccum[i] += emitRate * dt;
        while (this.emitAccum[i] >= 1) {
          this.emitAt(point, intensity, velocityX, velocityZ);
          this.emitAccum[i] -= 1;
        }
      }
    } else {
      this.emitAccum[0] = 0;
      this.emitAccum[1] = 0;
    }

    camera.updateMatrixWorld();
    _smokeRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    _smokeUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();

    let alive = 0;
    for (const p of this.particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) continue;

      const age = 1 - p.life / p.maxLife;
      p.velocity.multiplyScalar(Math.max(0, 1 - dt * 0.85));
      p.position.addScaledVector(p.velocity, dt);
      p.rotation += p.spin * dt;

      const size = p.size * (1 + age * (s.sizeGrowth ?? DRIFT_SMOKE_SIZE_GROWTH));
      const alpha = (s.opacity ?? DRIFT_SMOKE_OPACITY) * (1 - age) * (1 - age);
      this._writeParticle(alive++, p.position, size, p.rotation, alpha);
    }

    const vertCount = alive * DRIFT_SMOKE_VERTS_PER_PARTICLE;
    this.geometry.setDrawRange(0, vertCount);
    this.mesh.visible = vertCount > 0;
    if (vertCount > 0) {
      const posAttr = this.geometry.attributes.position;
      posAttr.addUpdateRange(0, alive * DRIFT_SMOKE_FLOATS_PER_PARTICLE);
      posAttr.needsUpdate = true;
      const colorAttr = this.geometry.attributes.color;
      colorAttr.addUpdateRange(0, alive * DRIFT_SMOKE_COLOR_FLOATS_PER_PARTICLE);
      colorAttr.needsUpdate = true;
    }
  }

  emitAt(point, intensity, velocityX, velocityZ) {
    const s = this.settings;
    const p = this.particles[this.emitIndex];
    this.emitIndex = (this.emitIndex + 1) % DRIFT_SMOKE_POOL_SIZE;

    const speed = Math.hypot(velocityX, velocityZ);
    const dirX = speed > 1e-4 ? velocityX / speed : 0;
    const dirZ = speed > 1e-4 ? velocityZ / speed : 0;
    const sideJitter = (Math.random() - 0.5) * (s.spread ?? DRIFT_SMOKE_SPREAD);
    p.position.set(
      point.x - dirX * (0.12 + Math.random() * 0.25) + sideJitter * dirZ,
      point.y + 0.02 + Math.random() * 0.1,
      point.z - dirZ * (0.12 + Math.random() * 0.25) - sideJitter * dirX,
    );
    p.velocity.set(
      -dirX * speed * (s.drag ?? DRIFT_SMOKE_SPEED_DRAG) + (Math.random() - 0.5) * 0.45,
      (s.rise ?? DRIFT_SMOKE_RISE) * (0.65 + Math.random() * 0.7),
      -dirZ * speed * (s.drag ?? DRIFT_SMOKE_SPEED_DRAG) + (Math.random() - 0.5) * 0.45,
    );
    const lifeMin = Math.max(0.05, s.lifeMin ?? DRIFT_SMOKE_LIFE_MIN);
    const lifeMax = Math.max(lifeMin, s.lifeMax ?? DRIFT_SMOKE_LIFE_MAX);
    p.maxLife = THREE.MathUtils.lerp(lifeMin, lifeMax, Math.random());
    p.life = p.maxLife;
    const sizeMin = Math.max(0.01, s.sizeMin ?? DRIFT_SMOKE_SIZE_MIN);
    const sizeMax = Math.max(sizeMin, s.sizeMax ?? DRIFT_SMOKE_SIZE_MAX);
    p.size = THREE.MathUtils.lerp(sizeMin, sizeMax, Math.random()) *
      THREE.MathUtils.lerp(0.75, 1.25, THREE.MathUtils.clamp(intensity, 0, 1));
    p.rotation = Math.random() * Math.PI * 2;
    p.spin = (Math.random() - 0.5) * 1.7;
  }

  _writeParticle(index, center, size, rotation, alpha) {
    const smokeColor = DRIFT_SMOKE_COLOR;
    if (this.settings.color) smokeColor.set(this.settings.color);
    const half = size * 0.5;
    const cosR = Math.cos(rotation);
    const sinR = Math.sin(rotation);
    const posOffset = index * DRIFT_SMOKE_FLOATS_PER_PARTICLE;
    const colorOffset = index * DRIFT_SMOKE_COLOR_FLOATS_PER_PARTICLE;
    const corners = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];
    for (let i = 0; i < DRIFT_SMOKE_VERTS_PER_PARTICLE; i++) {
      const x = corners[i][0];
      const y = corners[i][1];
      const rx = (x * cosR - y * sinR) * half;
      const ry = (x * sinR + y * cosR) * half;
      _smokeHalfRight.copy(_smokeRight).multiplyScalar(rx);
      _smokeHalfUp.copy(_smokeUp).multiplyScalar(ry);
      _smokeCorner.copy(center).add(_smokeHalfRight).add(_smokeHalfUp);

      const po = posOffset + i * 3;
      this.positions[po] = _smokeCorner.x;
      this.positions[po + 1] = _smokeCorner.y;
      this.positions[po + 2] = _smokeCorner.z;

      const co = colorOffset + i * 4;
      this.colors[co] = smokeColor.r;
      this.colors[co + 1] = smokeColor.g;
      this.colors[co + 2] = smokeColor.b;
      this.colors[co + 3] = alpha;
    }
  }
}

function createWingTrailMesh(scene, trailMat) {
  const vertCount = (TRAIL_SEG + 1) * 2;
  const positions = new Float32Array(vertCount * 3);
  const trailUVs = new Float32Array(vertCount * 2);
  const indices = [];
  for (let i = 0; i < TRAIL_SEG; i++) {
    const v = i * 2;
    indices.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
  }
  for (let i = 0; i <= TRAIL_SEG; i++) {
    const u = i / TRAIL_SEG;
    trailUVs[i * 2 * 2] = u;
    trailUVs[i * 2 * 2 + 1] = 0;
    trailUVs[(i * 2 + 1) * 2] = u;
    trailUVs[(i * 2 + 1) * 2 + 1] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("trailUV", new THREE.BufferAttribute(trailUVs, 2));
  geo.setIndex(indices);
  const mesh = new THREE.Mesh(geo, trailMat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 12;
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, history: [] };
}

function sampleTrail(trail, planeInner, localOffset) {
  _trTipWorld.copy(localOffset);
  planeInner.localToWorld(_trTipWorld);
  const hist = trail.history;
  if (hist.length > 0) {
    const d = _trTipWorld.distanceTo(hist[0]);
    if (d < 0.002) return;
    if (d > TRAIL_MAX_DIST && hist.length > 1) hist.length = 0;
  }
  hist.unshift(_trTipWorld.clone());
  if (hist.length > TRAIL_SEG + 1) hist.length = TRAIL_SEG + 1;
}

function rebuildTrail(trail) {
  const pos = trail.mesh.geometry.attributes.position;
  const hist = trail.history;
  const n = Math.min(hist.length, TRAIL_SEG + 1);
  for (let i = 0; i < n; i++) {
    const p = hist[i];
    if (i < n - 1) _trDir.subVectors(hist[i], hist[i + 1]).normalize();
    else if (n > 1) _trDir.subVectors(hist[n - 2], hist[n - 1]).normalize();
    else _trDir.set(0, 0, 1);
    _trSide.crossVectors(_trDir, _trUp);
    if (_trSide.lengthSq() < 1e-6) _trSide.set(1, 0, 0);
    else _trSide.normalize();
    const t = i / TRAIL_SEG;
    const w = TRAIL_HALF_W * (1 - t * 0.4);
    const vi = i * 2;
    pos.setXYZ(vi, p.x - _trSide.x * w, p.y - _trSide.y * w, p.z - _trSide.z * w);
    pos.setXYZ(vi + 1, p.x + _trSide.x * w, p.y + _trSide.y * w, p.z + _trSide.z * w);
  }
  for (let i = n; i <= TRAIL_SEG; i++) {
    const vi = i * 2;
    const lp = n > 0 ? hist[n - 1] : { x: 0, y: 0, z: 0 };
    pos.setXYZ(vi, lp.x, lp.y, lp.z);
    pos.setXYZ(vi + 1, lp.x, lp.y, lp.z);
  }
  pos.needsUpdate = true;
}

/* ── Bullet pool helpers ── */
const _bFwd = new THREE.Vector3();
const _bMuz = new THREE.Vector3();
const _bToCam = new THREE.Vector3();
const _bRight = new THREE.Vector3();
const _bPerp = new THREE.Vector3();
const _bMat4 = new THREE.Matrix4();
const _bStep = new THREE.Vector3();

function createBulletPool(scene) {
  const geo = new THREE.PlaneGeometry(0.18, 1.4);
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(GUN_TRACER_COLOR),
    transparent: true, opacity: 1, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  const group = new THREE.Group();
  group.frustumCulled = false;
  scene.add(group);
  const pool = [];
  for (let i = 0; i < GUN_BULLET_POOL; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.matrixAutoUpdate = false;
    m.visible = false;
    m.renderOrder = 11;
    group.add(m);
    pool.push({ mesh: m, pos: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, alive: false });
  }
  return { group, pool, geo, mat };
}

function fireBullet(pool, origin, dir) {
  for (const b of pool) {
    if (!b.alive) {
      b.alive = true;
      b.pos.copy(origin);
      b.dir.copy(dir).normalize();
      b.dist = 0;
      b.mesh.visible = true;
      return;
    }
  }
}

function updateBullets(pool, camera, dtSec) {
  for (const b of pool) {
    if (!b.alive) continue;
    _bStep.copy(b.dir).multiplyScalar(GUN_BULLET_SPEED * dtSec);
    b.pos.add(_bStep);
    b.dist += GUN_BULLET_SPEED * dtSec;
    if (b.dist > GUN_BULLET_MAX_DIST) { b.alive = false; b.mesh.visible = false; continue; }
    _bToCam.subVectors(camera.position, b.pos);
    _bRight.crossVectors(b.dir, _bToCam);
    if (_bRight.lengthSq() < 1e-6) _bRight.set(1, 0, 0); else _bRight.normalize();
    _bPerp.crossVectors(_bRight, b.dir).normalize();
    const sz = GUN_BULLET_SIZE;
    _bRight.multiplyScalar(sz);
    const dScaled = _bStep.copy(b.dir).multiplyScalar(sz);
    _bPerp.multiplyScalar(sz);
    _bMat4.makeBasis(_bRight, dScaled, _bPerp);
    _bMat4.setPosition(b.pos);
    b.mesh.matrix.copy(_bMat4);
  }
}

function clearBullets(pool) {
  for (const b of pool) { b.alive = false; b.mesh.visible = false; }
}

export class PlayMode {
  constructor({ scene, camera, renderer, controls, getWorldHeight, getTerrainHeight, worldHalf, cliffBvh, isBarrierBlocked, smokeSettings, carSettings }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.getWorldHeight = getWorldHeight;
    this.getTerrainHeight = getTerrainHeight || getWorldHeight;
    this.worldHalf = worldHalf;
    this.cliffBvh = cliffBvh || null;
    this.isBarrierBlocked = isBarrierBlocked || null;
    this.carSettings = carSettings || {};
    this._playerGroundY = 0;

    this.active = false;
    this.camView = "follow";
    this.moveMode = "capsule";
    this.playerPos = new THREE.Vector3();
    this.velY = 0;
    this.inAir = false;
    this.camYaw = 0;
    this.camPitch = 0.35;
    this.isoYaw = Math.PI / 4;
    this.isoDist = ISO_DIST_DEFAULT;
    this.savedCamPos = null;
    this.savedTarget = null;
    this.keysHeld = {};
    this._lastMx = 0;
    this._lastMz = 0;

    // Fly state
    this.flyHeading = 0;
    this.flyPitch = 0;
    this.flyRoll = 0;
    this.flyRollTarget = 0;
    this.flyHeight = 0;
    this.flyBarrelActive = false;
    this.flyBarrelPhase = 0;
    this.flyBarrelDir = 1;
    this.flyGroundCamYawOff = 0;
    this.flyAileronAngle = 0;

    // Capsule mesh
    const geo = new THREE.CapsuleGeometry(CAP_R, CAP_H, 4, 8);
    const mat = new THREE.MeshStandardMaterial({ color: 0xff6633, roughness: 0.7 });
    this.capsule = new THREE.Mesh(geo, mat);
    this.capsule.castShadow = true;
    this.capsule.visible = false;
    scene.add(this.capsule);

    // Plane mesh + contrails
    this.planeRoot = null;
    this._planeInner = null;
    this.planeLoaded = false;
    this._trailMat = createTrailMaterial();
    this._wingTrails = [];
    this._wingOffsets = [];
    this._bullets = createBulletPool(scene);
    this._muzzleOffsets = [];
    this._muzzleIdx = 0;
    this._gunCooldown = 0;
    this._loadPlane();

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onPointerLockChange = this._onPointerLockChange.bind(this);
    this._onIsoClick = this._onIsoClick.bind(this);
    this._onIsoPointerMove = this._onIsoPointerMove.bind(this);
    this._onIsoWheel = this._onIsoWheel.bind(this);
    this._moveTarget = null;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();
    this._isoPickHit = new THREE.Vector3();
    this._lastIsoHoverPickMs = 0;
    const isoRingGeo = new THREE.RingGeometry(1.05, 1.35, 48);
    const isoRingMat = new THREE.MeshBasicMaterial({
      color: 0x66ddff,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.isoHoverRing = new THREE.Mesh(isoRingGeo, isoRingMat);
    this.isoHoverRing.rotation.x = -Math.PI / 2;
    this.isoHoverRing.renderOrder = 1;
    this.isoHoverRing.visible = false;
    scene.add(this.isoHoverRing);
    this.isoTargetRing = new THREE.Mesh(isoRingGeo, isoRingMat.clone());
    this.isoTargetRing.material.opacity = 0.9;
    this.isoTargetRing.rotation.x = -Math.PI / 2;
    this.isoTargetRing.renderOrder = 1;
    this.isoTargetRing.visible = false;
    scene.add(this.isoTargetRing);
    this.planeSpeed = 0;
    this._flyHud = null;
    this._flyHudSpd = null;
    this._flyHudAlt = null;
    this._createFlyHud();

    // Character state
    this.charRoot = null;
    this.charInner = null;
    this.charMixer = null;
    this.charActions = null;
    this.charCurrentAction = null;
    this.charLoaded = false;
    this.charYaw = 0;
    this.charVelY = 0;
    this.charInAir = false;
    this.charCrouching = false;
    this.charAttacking = false;
    this.charRolling = false;
    this.charRollYaw = 0;
    this.charRollStart = 0;
    this.charRollDuration = 0.8;
    this.charJumpPhase = "none";
    this.charGliding = false;
    this.charGliderPoseActive = false;
    this.charSpacePrev = false;
    this.charKite = null;
    this.charSlidePhase = "none";
    this.charSlideYaw = 0;
    this.charSlideStart = 0;
    this.charSpellPhase = "none";
    this.charSpellExitRequested = false;
    this._loadCharacter();

    // Car drift state
    this.carRoot = null;
    this.carChassis = null;
    this.carWheels = [];
    this.carLoaded = false;
    this.carHeading = 0;
    this.carVx = 0;
    this.carVz = 0;
    this.carDrifting = false;
    this.carDriftAngle = 0;
    this.carWheelSpin = 0;
    this.carCamYaw = 0;
    this.carVelY = 0;
    this.carInAir = false;
    this.carNitro = 1.0;
    this.carBodyRoll = 0;
    this.carBodyPitch = 0;
    this.carTerrainRoll = 0;
    this.carTerrainPitch = 0;
    this.driftMarks = new DriftMarks(scene);
    this.smokeSettings = smokeSettings || {};
    this.driftSmoke = new DriftSmoke(scene, this.smokeSettings);
    this._carRearContactPoints = [new THREE.Vector3(), new THREE.Vector3()];
    this._carHud = null;
    this._carHudSpd = null;
    this._carHudAngle = null;
    this._carHudNitro = null;
    this._loadCar();
    this._createCarHud();
  }

  _createFlyHud() {
    const el = document.createElement("div");
    el.id = "fly-hud";
    el.style.cssText = "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);" +
      "background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.2);border-radius:8px;" +
      "padding:8px 18px;font-family:monospace;font-size:14px;color:#d7e4ef;z-index:5;" +
      "display:none;pointer-events:none;white-space:nowrap;";
    el.innerHTML = 'SPD <span id="fly-hud-spd">0</span> m/s &nbsp; ALT <span id="fly-hud-alt">0</span> m';
    document.body.appendChild(el);
    this._flyHud = el;
    this._flyHudSpd = el.querySelector("#fly-hud-spd");
    this._flyHudAlt = el.querySelector("#fly-hud-alt");
  }

  _createCarHud() {
    const el = document.createElement("div");
    el.id = "car-hud";
    el.style.cssText = "position:fixed;bottom:18px;left:50%;transform:translateX(-50%);" +
      "background:linear-gradient(180deg,rgba(15,19,28,0.9),rgba(8,10,16,0.86));" +
      "border:1px solid rgba(120,160,220,0.35);border-radius:12px;" +
      "padding:10px 16px 12px;min-width:330px;z-index:5;display:none;pointer-events:none;" +
      "box-shadow:0 10px 30px rgba(0,0,0,0.45),inset 0 1px 0 rgba(255,255,255,0.06);" +
      "font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,sans-serif;";
    el.innerHTML = `
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:14px;">
        <div style="display:flex;flex-direction:column;gap:2px;">
          <div style="font-size:11px;letter-spacing:1.5px;color:#9db2d3;">SPEED</div>
          <div style="display:flex;align-items:flex-end;gap:8px;">
            <span id="car-hud-spd" style="font-size:44px;line-height:1;font-weight:800;color:#eaf2ff;text-shadow:0 0 16px rgba(116,176,255,0.3);">0</span>
            <span style="font-size:13px;color:#9db2d3;padding-bottom:5px;letter-spacing:1px;">KM/H</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:5px;min-width:110px;">
          <div style="font-size:11px;letter-spacing:1.2px;color:#9db2d3;">DRIFT ANGLE</div>
          <div><span id="car-hud-angle" style="font-size:24px;font-weight:700;color:#ff8a5c;">0</span><span style="font-size:14px;color:#ffb293;">°</span></div>
        </div>
      </div>
      <div style="margin-top:9px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:11px;letter-spacing:1.2px;color:#8ed8ff;min-width:42px;">NITRO</span>
        <div style="flex:1;height:8px;background:rgba(120,150,190,0.22);border-radius:999px;overflow:hidden;">
          <div id="car-hud-nitro-bar" style="width:100%;height:100%;background:linear-gradient(90deg,#36c2ff,#7de8ff);box-shadow:0 0 12px rgba(94,220,255,0.55);"></div>
        </div>
        <span id="car-hud-nitro" style="font-size:12px;color:#9ee8ff;min-width:40px;text-align:right;">100%</span>
      </div>
    `;
    document.body.appendChild(el);
    this._carHud = el;
    this._carHudSpd = el.querySelector("#car-hud-spd");
    this._carHudAngle = el.querySelector("#car-hud-angle");
    this._carHudNitro = el.querySelector("#car-hud-nitro");
    this._carHudNitroBar = el.querySelector("#car-hud-nitro-bar");
  }

  async _loadCar() {
    try {
      const gltf = await new Promise((resolve, reject) => {
        getSharedGltfLoader().load(`${CAR_MODEL}?v=bruno-v2`, resolve, undefined, reject);
      });
      const src = gltf.scene;
      let chassisSrc = null;
      let wheelSrc = null;
      src.traverse((o) => {
        if (!chassisSrc && /^chassis(\.|\d|$)/.test(o.name)) chassisSrc = o;
        if (!wheelSrc && /^wheelContainer(\.|\d|$)/.test(o.name)) wheelSrc = o;
      });
      if (!chassisSrc || !wheelSrc) {
        console.warn("[V2] bruno.glb missing chassis/wheelContainer nodes; falling back to raw scene.");
        if (!chassisSrc) chassisSrc = src;
        if (!wheelSrc) wheelSrc = src.clone(true);
      }

      const chassisVisual = chassisSrc.clone(true);
      chassisVisual.position.set(0, 0, 0);
      chassisVisual.rotation.set(0, CAR_MODEL_YAW, 0);
      chassisVisual.scale.setScalar(1);
      const strays = [];
      chassisVisual.traverse((o) => {
        if (/^wheelContainer(\.|\d|$)/.test(o.name)) strays.push(o);
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      strays.forEach((s) => s.parent?.remove(s));

      this.carChassis = new THREE.Group();
      this.carChassis.rotation.order = "YXZ";
      this.carChassis.add(chassisVisual);

      this.carRoot = new THREE.Group();
      this.carRoot.rotation.order = "YXZ";
      this.carRoot.scale.setScalar(CAR_MODEL_SCALE);
      this.carRoot.add(this.carChassis);
      this.carRoot.visible = false;
      this.scene.add(this.carRoot);

      const hw = CAR_WHEEL_BASE * 0.5;
      const ht = CAR_TRACK * 0.5;
      const wheelOffsets = [
        { x: -ht, z: -hw, steer: true, name: "FL" },
        { x: ht, z: -hw, steer: true, name: "FR" },
        { x: -ht, z: hw, steer: false, name: "RL" },
        { x: ht, z: hw, steer: false, name: "RR" },
      ];
      this.carWheels = wheelOffsets.map((w) => {
        const container = wheelSrc.clone(true);
        container.position.set(w.x, -CAR_RIDE_HEIGHT, w.z);
        const isLeft = w.x < 0;
        container.rotation.set(0, CAR_MODEL_YAW + (isLeft ? Math.PI : 0), 0);
        let suspension = null;
        let cylinder = null;
        container.traverse((c) => {
          if (!suspension && /^wheelSuspension(\.|\d|$)/.test(c.name)) suspension = c;
          if (!cylinder && /^wheelCylinder(\.|\d|$)/.test(c.name)) cylinder = c;
          if (c.isMesh || c.isSkinnedMesh) {
            c.castShadow = true;
            c.receiveShadow = true;
          }
        });
        this.carChassis.add(container);
        return {
          container,
          suspension: suspension || container,
          cylinder: cylinder || container,
          offset: new THREE.Vector3(w.x, 0, w.z),
          steer: w.steer,
          isLeft,
          name: w.name,
          contactWorld: new THREE.Vector3(),
        };
      });

      this.carLoaded = true;
      if (this.active && this.moveMode === "car") {
        this.carRoot.visible = true;
        this.capsule.visible = false;
      }
      console.log("[V2] Bruno car loaded, wheels:", this.carWheels.map((w) => w.name).join(", "));
    } catch (err) {
      console.warn("[V2] Failed to load car model:", err);
    }
  }

  _loadCharacter() {
    const loader = getSharedGltfLoader();

    loader.load(CHAR_MODEL, (gltf) => {
      const model = gltf.scene;
      model.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
      });
      const box = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      box.getSize(size);
      const scale = CHAR_HEIGHT / (size.y || 1);
      model.scale.setScalar(scale);
      box.setFromObject(model);
      model.position.y -= box.min.y;

      this.charInner = model;
      this.charRoot = new THREE.Group();
      this.charRoot.add(model);
      this.charRoot.visible = false;
      this.scene.add(this.charRoot);

      // Kite (paraglider)
      {
        const kg = new THREE.Group();
        const shape = new THREE.Shape();
        shape.moveTo(0, -0.7);
        shape.lineTo(-1.6, 0.6);
        shape.lineTo(1.6, 0.6);
        shape.closePath();
        const canopy = new THREE.Mesh(
          new THREE.ShapeGeometry(shape),
          new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide }),
        );
        canopy.castShadow = true;
        canopy.rotation.x = -0.5;
        canopy.position.set(0, 0.15, 0);
        kg.add(canopy);
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.04, 0.04),
          new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.4, metalness: 0.3 }),
        );
        bar.castShadow = true;
        bar.position.set(0, -0.6, 0.35);
        bar.rotation.x = 0.25;
        kg.add(bar);
        kg.position.set(0, CHAR_HEIGHT * 0.95, -0.35);
        kg.rotation.set(0.12, PI / 2, 0);
        kg.visible = false;
        this.charRoot.add(kg);
        this.charKite = kg;
      }

      // Bone lookup
      const findBone = (names) => {
        for (const n of names) {
          const b = model.getObjectByName(n);
          if (b) return b;
        }
        let hit = null;
        model.traverse((o) => {
          if (hit) return;
          const nm = (o.name || "").toLowerCase();
          if (/hand[_.-]?r|righthand|handright/.test(nm) && names[0].toLowerCase().includes("hand")) hit = o;
          if (/head/.test(nm) && names[0].toLowerCase().includes("head")) hit = o;
        });
        return hit;
      };
      const rightHand = findBone(["DEF-handR", "hand.R", "mixamorigRightHand", "RightHand"]);
      const headBone = findBone(["DEF-head", "head", "Head", "mixamorigHead"]);

      // Katana
      if (rightHand) {
        const sg = new THREE.Group();
        sg.position.set(-0.07, 0.115, -0.2);
        sg.rotation.set(-1.37, 1.8, -2.21);
        rightHand.add(sg);
        loader.load(CHAR_KATANA, (kg) => {
          const ks = kg.scene;
          ks.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          const kb = new THREE.Box3().setFromObject(ks);
          const ksz = new THREE.Vector3();
          kb.getSize(ksz);
          const kscale = 1.0 / (Math.max(ksz.x, ksz.y, ksz.z) || 1);
          ks.scale.setScalar(kscale);
          kb.setFromObject(ks);
          ks.position.set(-kb.min.x, -kb.min.y, -kb.min.z);
          sg.add(ks);
        }, undefined, (e) => console.warn("[char] katana load failed:", e));
      }

      // Hat
      if (headBone) {
        loader.load(CHAR_HAT, (hg) => {
          const hs = hg.scene;
          hs.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          const hatScale = CHAR_HEIGHT / 1.8;
          hs.scale.setScalar(0.65 * hatScale);
          hs.position.set(0, 0.2, 0);
          headBone.add(hs);
        }, undefined, (e) => console.warn("[char] hat load failed:", e));
      }

      // Animations
      if (gltf.animations?.length) {
        this.charMixer = new THREE.AnimationMixer(model);
        const pick = (baseNames) => {
          for (const base of baseNames) {
            const hit = gltf.animations.find((a) => a.name === base + "_Armature" || a.name === base);
            if (hit) return hit;
          }
          return null;
        };
        const idleClip = pick(["Idle_Loop"]) || gltf.animations[0];
        const walkClip = pick(["Walk_Loop"]) || idleClip;
        const runClip = pick(["Sprint_Loop", "Jog_Fwd_Loop"]) || walkClip;
        const jumpStartClip = pick(["Jump_Start"]);
        const jumpLoopClip = pick(["Jump_Loop", "NinjaJump_Idle_Loop"]) || jumpStartClip || idleClip;
        const jumpLandClip = pick(["Jump_Land"]) || idleClip;
        const glideClip = pick(["NinjaJump_Idle_Loop"]) || jumpLoopClip;
        const attackClip = pick(["Sword_Attack", "Sword_Attack_RM"]);
        const crouchClip = pick(["Crouch_Idle_Loop"]) || idleClip;
        const crouchWalkClip = pick(["Crouch_Fwd_Loop"]) || crouchClip;
        const rollClip = pick(["Roll", "Roll_RM"]) || idleClip;
        const slideStartClip = pick(["Slide_Start"]);
        const slideLoopClip = pick(["Slide_Loop"]) || slideStartClip;
        const slideExitClip = pick(["Slide_Exit"]) || slideLoopClip;
        const spellEnterClip = pick(["Spell_Simple_Enter"]);
        const spellIdleClip = pick(["Spell_Simple_Idle_Loop"]);
        const spellShootClip = pick(["Spell_Simple_Shoot"]);
        const spellExitClip = pick(["Spell_Simple_Exit"]);

        const mk = (clip, loopOnce) => {
          if (!clip) return null;
          const a = this.charMixer.clipAction(clip).setLoop(loopOnce ? THREE.LoopOnce : THREE.LoopRepeat);
          if (loopOnce) a.clampWhenFinished = true;
          return a;
        };

        const idleAction = mk(idleClip, false);
        const walkAction = mk(walkClip, false);
        const runAction = mk(runClip, false);
        const jumpStartAction = mk(jumpStartClip, true);
        const jumpLoopAction = mk(jumpLoopClip, false);
        const jumpLandAction = mk(jumpLandClip, true);
        const glideAction = mk(glideClip, false);
        if (jumpStartAction) jumpStartAction.timeScale = 1.4;
        if (jumpLandAction) jumpLandAction.timeScale = 1.8;
        const crouchAction = mk(crouchClip, false);
        const crouchWalkAction = mk(crouchWalkClip, false);
        const attackAction = mk(attackClip, true);
        const rollAction = mk(rollClip, true);
        if (rollAction) {
          const d = rollAction.getClip()?.duration;
          if (d && d > 0) this.charRollDuration = d;
        }
        const slideStartAction = mk(slideStartClip, true);
        const slideLoopAction = mk(slideLoopClip, false);
        const slideExitAction = mk(slideExitClip, true);
        const spellEnterAction = mk(spellEnterClip, true);
        const spellIdleAction = mk(spellIdleClip, false);
        const spellShootAction = mk(spellShootClip, true);
        const spellExitAction = mk(spellExitClip, true);

        idleAction.play();
        this.charActions = {
          idle: idleAction, walk: walkAction, run: runAction,
          jumpStart: jumpStartAction, jumpLoop: jumpLoopAction, jumpLand: jumpLandAction,
          glide: glideAction, crouch: crouchAction, crouchWalk: crouchWalkAction,
          attack: attackAction, roll: rollAction,
          slideStart: slideStartAction, slideLoop: slideLoopAction, slideExit: slideExitAction,
          spellEnter: spellEnterAction, spellIdle: spellIdleAction,
          spellShoot: spellShootAction, spellExit: spellExitAction,
        };
        this.charCurrentAction = idleAction;

        this.charMixer.addEventListener("finished", (e) => {
          if (attackAction && e.action === attackAction) { this.charAttacking = false; return; }
          if (rollAction && e.action === rollAction) { this.charRolling = false; return; }
          if (jumpStartAction && e.action === jumpStartAction) {
            if (this.charInAir && jumpLoopAction) {
              this.charJumpPhase = "loop";
              jumpLoopAction.reset().enabled = true;
              jumpLoopAction.crossFadeFrom(jumpStartAction, 0.08, false).play();
              this.charCurrentAction = jumpLoopAction;
            }
            return;
          }
          if (jumpLandAction && e.action === jumpLandAction) { this.charJumpPhase = "none"; return; }
          if (slideStartAction && e.action === slideStartAction) {
            if (this.charSlidePhase === "start" && slideLoopAction) {
              this.charSlidePhase = "loop";
              slideLoopAction.reset().enabled = true;
              slideLoopAction.crossFadeFrom(slideStartAction, 0.1, false).play();
              this.charCurrentAction = slideLoopAction;
            }
            return;
          }
          if (slideExitAction && e.action === slideExitAction) { this.charSlidePhase = "none"; return; }
          if (spellEnterAction && e.action === spellEnterAction) {
            if (this.charSpellPhase !== "enter") return;
            if (this.charSpellExitRequested && spellExitAction) {
              this.charSpellPhase = "exit";
              spellExitAction.reset().enabled = true;
              spellExitAction.crossFadeFrom(spellEnterAction, 0.12, false).play();
              this.charCurrentAction = spellExitAction;
            } else if (spellIdleAction) {
              this.charSpellPhase = "idle";
              spellIdleAction.reset().enabled = true;
              spellIdleAction.crossFadeFrom(spellEnterAction, 0.12, false).play();
              this.charCurrentAction = spellIdleAction;
            }
            return;
          }
          if (spellShootAction && e.action === spellShootAction) {
            if (this.charSpellPhase !== "shoot") return;
            if (this.charSpellExitRequested && spellExitAction) {
              this.charSpellPhase = "exit";
              spellExitAction.reset().enabled = true;
              spellExitAction.crossFadeFrom(spellShootAction, 0.12, false).play();
              this.charCurrentAction = spellExitAction;
            } else if (spellIdleAction) {
              this.charSpellPhase = "idle";
              spellIdleAction.reset().enabled = true;
              spellIdleAction.crossFadeFrom(spellShootAction, 0.12, false).play();
              this.charCurrentAction = spellIdleAction;
            }
            return;
          }
          if (spellExitAction && e.action === spellExitAction) {
            this.charSpellPhase = "none";
            this.charSpellExitRequested = false;
            if (idleAction) {
              idleAction.reset().enabled = true;
              idleAction.crossFadeFrom(spellExitAction, 0.2, false).play();
              this.charCurrentAction = idleAction;
            }
            return;
          }
        });
      }
      this.charLoaded = true;
      if (this.active && this.moveMode === "char") {
        this.charRoot.visible = true;
        this.capsule.visible = false;
      }
      console.log("[V2] Character loaded");
    }, undefined, (err) => console.warn("[V2] Character load failed:", err));
  }

  _charSetAction(next, fade = 0.18) {
    if (!this.charActions || !next || next === this.charCurrentAction) return;
    next.enabled = true;
    next.reset();
    next.crossFadeFrom(this.charCurrentAction, fade, false).play();
    this.charCurrentAction = next;
  }

  async _loadPlane() {
    try {
      const { submeshes } = await loadTreeGlbFromUrl(PLANE_MODEL);
      const inner = new THREE.Group();
      for (const sm of submeshes) {
        const mesh = new THREE.Mesh(sm.geometry, sm.material);
        mesh.applyMatrix4(sm.localMatrix);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        inner.add(mesh);
      }
      inner.rotation.y = Math.PI;
      inner.updateMatrixWorld(true);
      const box0 = new THREE.Box3().setFromObject(inner);
      if (!box0.isEmpty()) {
        const size0 = box0.getSize(new THREE.Vector3());
        const max0 = Math.max(size0.x, size0.y, size0.z);
        const targetSpan = 2.8 * (CAP_H + 2 * CAP_R);
        inner.scale.setScalar(targetSpan / max0);
        inner.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(inner);
        inner.position.set(
          -((box.min.x + box.max.x) * 0.5),
          -box.min.y,
          -((box.min.z + box.max.z) * 0.5),
        );
      }
      this.planeRoot = new THREE.Group();
      this.planeRoot.rotation.order = "YXZ";
      this.planeRoot.add(inner);
      this.planeRoot.visible = false;
      this.scene.add(this.planeRoot);
      this._planeInner = inner;

      // Create wingtip contrails
      inner.updateMatrixWorld(true);
      const wingBox = new THREE.Box3().setFromObject(inner);
      const wbSz = new THREE.Vector3();
      wingBox.getSize(wbSz);
      const tipXL = wingBox.min.x;
      const tipXR = wingBox.max.x;
      const zBack = wingBox.max.z - wbSz.z * 0.08;
      const yMid = (wingBox.min.y + wingBox.max.y) * 0.5;
      const tmpW = new THREE.Vector3();

      tmpW.set(tipXL, yMid, zBack);
      inner.worldToLocal(tmpW);
      this._wingOffsets.push(tmpW.clone());
      this._wingTrails.push(createWingTrailMesh(this.scene, this._trailMat));

      tmpW.set(tipXR, yMid, zBack);
      inner.worldToLocal(tmpW);
      this._wingOffsets.push(tmpW.clone());
      this._wingTrails.push(createWingTrailMesh(this.scene, this._trailMat));

      // Gun muzzle offsets (inboard from wingtips, near nose)
      const zFront = wingBox.min.z + wbSz.z * 0.05;
      const wingHalfX = wbSz.x * 0.5;
      const muzzleHalfSpan = wingHalfX * 0.42;
      const cxW = (wingBox.min.x + wingBox.max.x) * 0.5;
      tmpW.set(cxW - muzzleHalfSpan, yMid, zFront);
      inner.worldToLocal(tmpW);
      this._muzzleOffsets.push(tmpW.clone());
      tmpW.set(cxW + muzzleHalfSpan, yMid, zFront);
      inner.worldToLocal(tmpW);
      this._muzzleOffsets.push(tmpW.clone());

      this.planeLoaded = true;
      if (this.active && this.moveMode === "fly") {
        this.planeRoot.visible = true;
        this.capsule.visible = false;
      }
    } catch (err) {
      console.warn("[V2] Failed to load plane model:", err);
    }
  }

  get flying() { return this.moveMode === "fly" && this.planeLoaded; }
  get carMode() { return this.moveMode === "car"; }

  _clearTrails() {
    for (const trail of this._wingTrails) {
      trail.history.length = 0;
      trail.mesh.visible = false;
    }
  }

  _updateTrails() {
    if (!this._planeInner || this._wingTrails.length === 0) return;
    if (this.planeRoot?.visible) {
      this._planeInner.updateMatrixWorld(true);
      for (let i = 0; i < this._wingTrails.length; i++) {
        sampleTrail(this._wingTrails[i], this._planeInner, this._wingOffsets[i]);
        rebuildTrail(this._wingTrails[i]);
        this._wingTrails[i].mesh.visible = true;
      }
    } else {
      this._clearTrails(); clearBullets(this._bullets.pool);
    }
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.camView = "follow";
    this.moveMode = "capsule";
    this.velY = 0;
    this.inAir = false;
    this.isoYaw = Math.PI / 4;
    this.isoDist = ISO_DIST_DEFAULT;
    this._moveTarget = null;
    this.flyHeight = 0;
    this.flyPitch = 0;
    this.flyRoll = 0;
    this.flyRollTarget = 0;
    this.flyBarrelActive = false;
    this.flyBarrelPhase = 0;
    this.flyAileronAngle = 0;

    this.savedCamPos = this.camera.position.clone();
    this.savedTarget = this.controls.target.clone();
    this.playerPos.set(this.controls.target.x, 0, this.controls.target.z);
    this.playerPos.y = this.getWorldHeight(this.playerPos.x, this.playerPos.z);
    this.camYaw = 0;
    this.camPitch = 0.35;

    this.capsule.visible = true;
    if (this.planeRoot) this.planeRoot.visible = false;
    if (this.charRoot) this.charRoot.visible = false;
    if (this.carRoot) this.carRoot.visible = false;
    this.driftMarks.reset();
    this.driftSmoke.reset();
    this._clearTrails(); clearBullets(this._bullets.pool);
    this.controls.enabled = false;

    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    this.renderer.domElement.addEventListener("click", this._onIsoClick);
    this.renderer.domElement.addEventListener("pointermove", this._onIsoPointerMove);
    this.renderer.domElement.addEventListener("wheel", this._onIsoWheel, { passive: false });

    this.renderer.domElement.style.cursor = "none";
    this.renderer.domElement.requestPointerLock();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this._moveTarget = null;
    this.isoHoverRing.visible = false;
    this.isoTargetRing.visible = false;
    for (const k of Object.keys(this.keysHeld)) delete this.keysHeld[k];

    this.capsule.visible = false;
    if (this.planeRoot) this.planeRoot.visible = false;
    if (this.charRoot) this.charRoot.visible = false;
    if (this.carRoot) this.carRoot.visible = false;
    if (this._flyHud) this._flyHud.style.display = "none";
    if (this._carHud) this._carHud.style.display = "none";
    this.planeSpeed = 0;
    this.carVx = 0; this.carVz = 0;
    this.carNitro = 1.0;
    this.carBodyRoll = 0;
    this.carBodyPitch = 0;
    this.carTerrainRoll = 0;
    this.carTerrainPitch = 0;
    this.driftMarks.reset();
    this.driftSmoke.reset();
    this._clearTrails(); clearBullets(this._bullets.pool);

    this.camera.up.set(0, 1, 0);
    if (this.savedCamPos) this.camera.position.copy(this.savedCamPos);
    if (this.savedTarget) {
      this.controls.target.copy(this.savedTarget);
      this.camera.lookAt(this.savedTarget);
    }
    this.controls.enabled = true;

    document.removeEventListener("keydown", this._onKeyDown);
    document.removeEventListener("keyup", this._onKeyUp);
    document.removeEventListener("mousemove", this._onMouseMove);
    document.removeEventListener("pointerlockchange", this._onPointerLockChange);
    this.renderer.domElement.removeEventListener("click", this._onIsoClick);
    this.renderer.domElement.removeEventListener("pointermove", this._onIsoPointerMove);
    this.renderer.domElement.removeEventListener("wheel", this._onIsoWheel);

    if (document.pointerLockElement) document.exitPointerLock();
    this.renderer.domElement.style.cursor = "";
  }

  update(dtSec) {
    if (!this.active) return;
    dtSec = Math.min(dtSec, 0.05);

    const iso = this.camView === "iso";
    const keys = this.keysHeld;
    const flying = this.flying;

    // Iso yaw rotation (capsule only, fly chases heading)
    if (iso && !flying) {
      if (keys.BracketLeft) this.isoYaw += ISO_YAW_ROT_SPEED * dtSec;
      if (keys.BracketRight) this.isoYaw -= ISO_YAW_ROT_SPEED * dtSec;
    }

    // Iso fly: A/D yaw the plane
    if (flying && iso) {
      if (keys.KeyA || keys.ArrowLeft) this.flyHeading += ISO_FLY_YAW_RATE * dtSec;
      if (keys.KeyD || keys.ArrowRight) this.flyHeading -= ISO_FLY_YAW_RATE * dtSec;
    }

    // Movement direction
    let mx = 0, mz = 0;
    if (flying) {
      // Throttle-style airspeed
      const thr = (keys.KeyW || keys.ArrowUp) ? 1 : (keys.KeyS || keys.ArrowDown) ? -1 : 0;
      const drag = PLANE_DRAG * this.planeSpeed * Math.abs(this.planeSpeed);
      let coast = PLANE_COAST;
      const deckAgl = this.flyHeight - this.getWorldHeight(this.playerPos.x, this.playerPos.z);
      if (deckAgl < PLANE_DECK_ALT) coast *= PLANE_DECK_COAST_MULT;
      if (thr === 1) {
        let a = PLANE_ACCEL;
        if (keys.ShiftLeft || keys.ShiftRight) a *= PLANE_SHIFT_ACCEL_MULT;
        this.planeSpeed += a * dtSec;
      } else if (thr === -1) {
        if (this.planeSpeed > 0.55) this.planeSpeed -= PLANE_BRAKE * dtSec;
        else this.planeSpeed -= PLANE_REV_ACCEL * dtSec;
      } else {
        if (this.planeSpeed > 0) this.planeSpeed = Math.max(0, this.planeSpeed - (coast + drag) * dtSec);
        else if (this.planeSpeed < 0) this.planeSpeed = Math.min(0, this.planeSpeed + (coast + drag) * dtSec);
      }
      const maxFwd = (keys.ShiftLeft || keys.ShiftRight) ? PLANE_MAX_FWD_BOOST : PLANE_MAX_FWD;
      this.planeSpeed = THREE.MathUtils.clamp(this.planeSpeed, -PLANE_MAX_REV, maxFwd);
      if (Math.abs(this.planeSpeed) < 0.04 && thr === 0) this.planeSpeed = 0;
      const spdAbs = Math.abs(this.planeSpeed);
      if (spdAbs > 1e-4) {
        const sg = Math.sign(this.planeSpeed);
        mx = -Math.sin(this.flyHeading) * sg;
        mz = -Math.cos(this.flyHeading) * sg;
      }
    } else if (this.carMode) {
      // ── Arcade drift: heading + world velocity model ──
      const carFeel = this.carSettings;
      const accelScale = carFeel.accelScale ?? 1;
      const maxSpeedScale = carFeel.maxSpeedScale ?? 1;
      const forward = keys.KeyW || keys.ArrowUp;
      const backward = keys.KeyS || keys.ArrowDown;
      const leftKey = keys.KeyA || keys.ArrowLeft;
      const rightKey = keys.KeyD || keys.ArrowRight;
      const handbrake = keys.Space;
      const nitroHeld = !!keys[CAR_NITRO_KEY];

      // Current speed from velocity vector
      const curSpeed = Math.sqrt(this.carVx * this.carVx + this.carVz * this.carVz);

      // Heading direction
      const hx = -Math.sin(this.carHeading);
      const hz = -Math.cos(this.carHeading);

      // Throttle / brake applied along heading
      const boost = keys.ShiftLeft || keys.ShiftRight;
      const nitroActive = nitroHeld && this.carNitro > CAR_NITRO_MIN_TO_USE && !backward;
      let accel = ((boost ? CAR_ACCEL_BOOST : CAR_ACCEL) + (nitroActive ? CAR_NITRO_ACCEL_BONUS : 0)) * accelScale;
      if (!boost && !nitroActive) {
        const speedKmh = curSpeed * 3.6;
        const rampT = THREE.MathUtils.smoothstep(speedKmh, 0, CAR_BASE_ACCEL_RAMP_TO_KMH);
        const accelMul = THREE.MathUtils.lerp(CAR_BASE_ACCEL_LOW_SPEED_MUL, 1.0, rampT);
        accel *= accelMul;
      }
      if (forward) {
        this.carVx += hx * accel * dtSec;
        this.carVz += hz * accel * dtSec;
      } else if (backward) {
        if (curSpeed > 1) {
          this.carVx -= hx * CAR_BRAKE * accelScale * dtSec;
          this.carVz -= hz * CAR_BRAKE * accelScale * dtSec;
        } else {
          this.carVx -= hx * CAR_REVERSE_ACCEL * accelScale * dtSec;
          this.carVz -= hz * CAR_REVERSE_ACCEL * accelScale * dtSec;
        }
      } else if (curSpeed > 0.05) {
        const decel = CAR_COAST / curSpeed;
        this.carVx -= this.carVx * decel * dtSec;
        this.carVz -= this.carVz * decel * dtSec;
      } else {
        this.carVx = 0; this.carVz = 0;
      }

      // Handbrake: slight decel
      if (handbrake && curSpeed > 0.1) {
        const decel = CAR_HANDBRAKE_DECEL / curSpeed;
        this.carVx -= this.carVx * decel * dtSec;
        this.carVz -= this.carVz * decel * dtSec;
      }

      // Drag
      const speed2 = this.carVx * this.carVx + this.carVz * this.carVz;
      if (speed2 > 0.01) {
        const spd = Math.sqrt(speed2);
        const dragForce = CAR_DRAG * spd;
        const factor = Math.max(0, 1 - dragForce * dtSec);
        this.carVx *= factor;
        this.carVz *= factor;
      }

      // Clamp speed
      const maxSpd = ((boost ? CAR_MAX_SPEED_BOOST : CAR_MAX_SPEED) + (nitroActive ? CAR_NITRO_MAX_SPEED_BONUS : 0)) * maxSpeedScale;
      const newSpeed = Math.sqrt(this.carVx * this.carVx + this.carVz * this.carVz);
      if (newSpeed > maxSpd) {
        const s = maxSpd / newSpeed;
        this.carVx *= s; this.carVz *= s;
      }

      // Nitro tank
      if (nitroActive && curSpeed > 1) {
        this.carNitro = Math.max(0, this.carNitro - CAR_NITRO_DRAIN_PER_SEC * dtSec);
      } else {
        this.carNitro = Math.min(1, this.carNitro + CAR_NITRO_REGEN_PER_SEC * dtSec);
      }

      // Steering — rotate heading
      let steerInput = 0;
      if (leftKey) steerInput = 1;
      if (rightKey) steerInput = -1;

      if (steerInput !== 0 && curSpeed > 0.5) {
        const turnRate = this.carDrifting ? CAR_TURN_RATE_DRIFT : CAR_TURN_RATE;
        this.carHeading += steerInput * turnRate * dtSec;
      }

      // Grip: project velocity onto heading, get forward and lateral components
      const fwdDot = this.carVx * hx + this.carVz * hz;
      const rx = Math.cos(this.carHeading);
      const rz = -Math.sin(this.carHeading);
      const latDot = this.carVx * rx + this.carVz * rz;

      // Choose grip strength
      let grip;
      if (handbrake && curSpeed > CAR_DRIFT_ENTRY_SPEED && steerInput !== 0) {
        grip = CAR_GRIP_DRIFT;
      } else if (backward && steerInput !== 0 && curSpeed > 3) {
        grip = CAR_GRIP_BRAKE_TURN;
      } else {
        grip = CAR_GRIP_NORMAL;
      }

      // Kill lateral velocity based on grip (high grip = car follows heading)
      const lateralKill = 1 - Math.exp(-grip * dtSec);
      this.carVx -= rx * latDot * lateralKill;
      this.carVz -= rz * latDot * lateralKill;

      // Drift detection
      this.carDriftAngle = curSpeed > 1 ? Math.abs(Math.atan2(latDot, Math.abs(fwdDot))) : 0;
      this.carDrifting = this.carDriftAngle > CAR_DRIFT_ANGLE_MIN && curSpeed > CAR_DRIFT_ENTRY_SPEED;

      const latSign = Math.sign(latDot);
      const speedForRoll = Math.sqrt(this.carVx * this.carVx + this.carVz * this.carVz);
      const driftRollSpeedGain = THREE.MathUtils.smoothstep(speedForRoll, 8, 24);
      const driftRoll = -latSign * Math.min(CAR_BODY_ROLL_MAX, this.carDriftAngle * 0.85) * driftRollSpeedGain;
      const throttlePitch = forward ? 0.055 : backward ? -0.08 : 0;
      const speedNorm = Math.min(1, curSpeed / Math.max(1, CAR_MAX_SPEED));
      const dynamicPitch = -speedNorm * 0.05;
      const targetDynRoll = this.carDrifting ? driftRoll : 0;
      const targetDynPitch = dynamicPitch + throttlePitch;
      const smooth = 1 - Math.exp(-CAR_BODY_SMOOTH * dtSec);
      this.carBodyRoll = THREE.MathUtils.lerp(this.carBodyRoll, targetDynRoll, smooth);
      this.carBodyPitch = THREE.MathUtils.lerp(this.carBodyPitch, targetDynPitch, smooth);

      // Wheel spin
      this.carWheelSpin -= (fwdDot / CAR_WHEEL_RADIUS) * dtSec;

      // Movement output
      mx = this.carVx;
      mz = this.carVz;
    } else {
      const moveYaw = iso ? this.isoYaw : this.camYaw;
      if (keys.KeyW || keys.ArrowUp)    { mx -= Math.sin(moveYaw); mz -= Math.cos(moveYaw); }
      if (keys.KeyS || keys.ArrowDown)  { mx += Math.sin(moveYaw); mz += Math.cos(moveYaw); }
      if (keys.KeyA || keys.ArrowLeft)  { mx -= Math.cos(moveYaw); mz += Math.sin(moveYaw); }
      if (keys.KeyD || keys.ArrowRight) { mx += Math.cos(moveYaw); mz -= Math.sin(moveYaw); }
    }

    // Iso click-to-move is for on-foot modes; vehicles keep their own controls.
    if (iso && !flying && !this.carMode && this._moveTarget) {
      if (mx !== 0 || mz !== 0) {
        this._moveTarget = null;
        this.isoTargetRing.visible = false;
      } else {
        const dx = this._moveTarget.x - this.playerPos.x;
        const dz = this._moveTarget.z - this.playerPos.z;
        if (Math.hypot(dx, dz) < 0.35) {
          this._moveTarget = null;
          this.isoTargetRing.visible = false;
        } else {
          mx = dx; mz = dz;
        }
      }
    }

    const charMode = this.moveMode === "char" && this.charLoaded;
    const charRunning = charMode && (keys.ShiftLeft || keys.ShiftRight);
    const inRoll = charMode && this.charRolling;
    const inSlide = charMode && this.charSlidePhase !== "none";

    // Crouch (hold Ctrl, matches v1)
    if (charMode) {
      this.charCrouching = !this.charInAir && !this.charRolling && !inSlide &&
        !this.charAttacking && (keys.ControlLeft || keys.ControlRight);
    }

    // Roll early exit at 75% when input held (matches v1)
    if (inRoll) {
      const _inputHeld = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD ||
        keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight;
      if (_inputHeld) {
        const rollT = (performance.now() - this.charRollStart) / 1000 / this.charRollDuration;
        if (rollT >= 0.75) {
          this.charRolling = false;
          const tgt = this.charCrouching
            ? this.charActions?.crouchWalk
            : charRunning ? this.charActions?.run : this.charActions?.walk;
          if (tgt && this.charActions?.roll) {
            tgt.enabled = true;
            tgt.reset();
            tgt.crossFadeFrom(this.charActions.roll, 0.15, false).play();
            this.charCurrentAction = tgt;
          }
        }
      }
    }

    // Roll direction override (v1 uses sin/cos without negation, speed via _moveSpeed)
    let _charRollSpeed = 0;
    if (charMode && this.charRolling) {
      const elapsed = (performance.now() - this.charRollStart) / 1000;
      const t = Math.min(1, elapsed / this.charRollDuration);
      _charRollSpeed = CHAR_ROLL_PEAK * Math.cos(t * PI * 0.5);
      mx = Math.sin(this.charRollYaw);
      mz = Math.cos(this.charRollYaw);
    }

    // Slide direction override
    if (charMode && this.charSlidePhase !== "none") {
      mx = Math.sin(this.charSlideYaw);
      mz = Math.cos(this.charSlideYaw);
      if (this.charSlidePhase === "loop") {
        const elapsed = (performance.now() - this.charSlideStart) / 1000;
        if ((elapsed >= CHAR_SLIDE_MAX_TIME || !keys.KeyX) && this.charActions?.slideExit) {
          this.charSlidePhase = "exit";
          const se = this.charActions.slideExit;
          se.reset().enabled = true;
          se.crossFadeFrom(this.charCurrentAction, 0.12, false).play();
          this.charCurrentAction = se;
        }
      }
    }

    // Attack/spell freeze movement
    const inSpell = this.charSpellPhase !== "none";
    if (charMode && (this.charAttacking || inSpell)) { mx = 0; mz = 0; }

    const mlen = Math.hypot(mx, mz);
    const carDriving = this.carMode;
    const moveSpeed = flying
      ? Math.abs(this.planeSpeed)
      : carDriving ? 1
      : charMode
        ? (this.charRolling ? _charRollSpeed
          : inSlide ? CHAR_SLIDE_SPEED
          : this.charCrouching ? CHAR_WALK_SPEED * 0.5
          : charRunning ? CHAR_RUN_SPEED
          : CHAR_WALK_SPEED)
        : MOVE_SPEED;
    const prevPosX = this.playerPos.x;
    const prevPosZ = this.playerPos.z;
    if (mlen > 0) {
      let stepX, stepZ;
      if (carDriving) {
        stepX = mx * dtSec;
        stepZ = mz * dtSec;
      } else {
        stepX = (mx / mlen) * moveSpeed * dtSec;
        stepZ = (mz / mlen) * moveSpeed * dtSec;
      }

      if (this.cliffBvh?.baked && !flying) {
        if (carDriving) {
          const px = this.playerPos.x;
          const pz = this.playerPos.z;
          const lowY = this.playerPos.y + CAR_RIDE_HEIGHT + 0.15;
          const highY = this.playerPos.y + CAR_RIDE_HEIGHT + CAR_BODY_HEIGHT;
          const fwdX = -Math.sin(this.carHeading);
          const fwdZ = -Math.cos(this.carHeading);
          const rightX = Math.cos(this.carHeading);
          const rightZ = -Math.sin(this.carHeading);

          const baseStepLen = Math.hypot(stepX, stepZ);
          if (baseStepLen > 1e-6) {
            const sweepDist = baseStepLen + CAR_HALF_LENGTH + CAR_COLLISION_SKIN;
            const sweepSamples = [
              { ox: 0, oz: 0, y: lowY },
              { ox: 0, oz: 0, y: highY },
              { ox: rightX * CAR_HALF_WIDTH, oz: rightZ * CAR_HALF_WIDTH, y: lowY },
              { ox: -rightX * CAR_HALF_WIDTH, oz: -rightZ * CAR_HALF_WIDTH, y: lowY },
            ];
            let minSafe = baseStepLen;
            const dirX = stepX / baseStepLen;
            const dirZ = stepZ / baseStepLen;
            for (const s of sweepSamples) {
              const hit = this.cliffBvh.raycast3D(
                px + s.ox,
                s.y,
                pz + s.oz,
                stepX,
                0,
                stepZ,
                sweepDist,
              );
              if (!hit) continue;
              const safe = Math.max(0, hit.distance - (CAR_HALF_LENGTH + CAR_COLLISION_SKIN));
              if (safe < minSafe) minSafe = safe;
            }
            if (minSafe < baseStepLen) {
              stepX = dirX * minSafe;
              stepZ = dirZ * minSafe;
            }
          }

          let posX = px + stepX;
          let posZ = pz + stepZ;
          for (let iter = 0; iter < CAR_COLLISION_ITERS; iter++) {
            let changed = false;
            const carRays = [
              { dx: fwdX, dz: fwdZ, dist: CAR_HALF_LENGTH + CAR_COLLISION_SKIN },
              { dx: -fwdX, dz: -fwdZ, dist: CAR_HALF_LENGTH + CAR_COLLISION_SKIN },
              { dx: fwdX + rightX, dz: fwdZ + rightZ, dist: CAR_HALF_LENGTH + CAR_COLLISION_SKIN },
              { dx: fwdX - rightX, dz: fwdZ - rightZ, dist: CAR_HALF_LENGTH + CAR_COLLISION_SKIN },
              { dx: -fwdX + rightX, dz: -fwdZ + rightZ, dist: CAR_HALF_LENGTH + CAR_COLLISION_SKIN },
              { dx: -fwdX - rightX, dz: -fwdZ - rightZ, dist: CAR_HALF_LENGTH + CAR_COLLISION_SKIN },
              { dx: rightX, dz: rightZ, dist: CAR_HALF_WIDTH + CAR_COLLISION_SKIN },
              { dx: -rightX, dz: -rightZ, dist: CAR_HALF_WIDTH + CAR_COLLISION_SKIN },
            ];

            for (const r of carRays) {
              const rLen = Math.hypot(r.dx, r.dz);
              const ndx = r.dx / Math.max(1e-6, rLen);
              const ndz = r.dz / Math.max(1e-6, rLen);
              for (const ry of [lowY, highY]) {
                const hit = this.cliffBvh.raycastLateral(posX, ry, posZ, ndx, ndz, r.dist);
                if (!hit) continue;
                const nx = hit.normal.x;
                const nz = hit.normal.z;
                const nLen = Math.hypot(nx, nz);
                if (nLen <= 0.01) continue;
                const nnx = nx / nLen;
                const nnz = nz / nLen;
                const pen = r.dist - hit.distance;
                if (pen > 1e-4) {
                  posX += nnx * pen;
                  posZ += nnz * pen;
                  changed = true;
                  const vDot = this.carVx * nnx + this.carVz * nnz;
                  if (vDot < 0) {
                    this.carVx -= vDot * nnx;
                    this.carVz -= vDot * nnz;
                  }
                }
              }
            }
            if (!changed) break;
          }
          stepX = posX - px;
          stepZ = posZ - pz;
        } else {
          const margin = CAP_R + 0.05;
          const stepLen = Math.hypot(stepX, stepZ);
          const castDist = stepLen + margin;
          const px = this.playerPos.x;
          const pz = this.playerPos.z;
          const footY  = this.playerPos.y + CAP_R;
          const waistY = this.playerPos.y + CAP_R + CAP_H * 0.5;
          const headY  = this.playerPos.y + CAP_R + CAP_H;

          let blocked = false;
          const rayHeights = [footY, waistY, headY];
          for (let ri = 0; ri < 3; ri++) {
            const hit = this.cliffBvh.raycastLateral(
              px, rayHeights[ri], pz, stepX, stepZ, castDist,
            );
            if (hit) {
              const nx = hit.normal.x;
              const nz = hit.normal.z;
              const nLen = Math.hypot(nx, nz);
              if (nLen > 0.01) {
                const nnx = nx / nLen;
                const nnz = nz / nLen;
                const dot = stepX * nnx + stepZ * nnz;
                if (dot < 0) {
                  stepX -= dot * nnx;
                  stepZ -= dot * nnz;

                  const slideHit = this.cliffBvh.raycastLateral(
                    px, rayHeights[ri], pz,
                    stepX, stepZ, Math.hypot(stepX, stepZ) + margin,
                  );
                  if (slideHit) {
                    stepX = 0;
                    stepZ = 0;
                    blocked = true;
                  }
                  break;
                }
              }
            }
          }
        }
      }

      if (this.isBarrierBlocked) {
        const nx = this.playerPos.x + stepX;
        const nz = this.playerPos.z + stepZ;
        if (this.isBarrierBlocked(nx, nz)) {
          const canSlideX = !this.isBarrierBlocked(nx, this.playerPos.z);
          const canSlideZ = !this.isBarrierBlocked(this.playerPos.x, nz);
          if (canSlideX) {
            stepZ = 0;
            if (carDriving) this.carVz *= 0.25;
          } else if (canSlideZ) {
            stepX = 0;
            if (carDriving) this.carVx *= 0.25;
          } else {
            stepX = 0;
            stepZ = 0;
            if (carDriving) { this.carVx *= 0.1; this.carVz *= 0.1; }
          }
        }
      }

      const wh = this.worldHalf;
      this.playerPos.x = THREE.MathUtils.clamp(this.playerPos.x + stepX, -wh, wh);
      this.playerPos.z = THREE.MathUtils.clamp(this.playerPos.z + stepZ, -wh, wh);
    }

    // Ground height — cast downward from player's current Y + step-up margin,
    // not from infinity. This prevents teleporting to wall tops when walking
    // through doorways/holes — the ray only sees surfaces at or below the player.
    const terrainY = this.getTerrainHeight(this.playerPos.x, this.playerPos.z);
    let groundY = terrainY;
    if (this.cliffBvh?.baked) {
      const stepUp = 1.0;
      const fromY = this.playerPos.y + stepUp;
      const bvhY = this.cliffBvh.raycastHeightFrom(this.playerPos.x, fromY, this.playerPos.z);
      if (bvhY != null && bvhY > terrainY) groundY = bvhY;
    }
    const prevY = this.playerPos.y;
    const capsuleBase = CAP_R + CAP_H * 0.5;

    // Fly altitude — flyHeight is absolute world Y
    if (flying) {
      const agl = this.flyHeight - groundY;
      const spd = Math.abs(this.planeSpeed);
      const onDeck = agl < FLY_SURFACE_ALT && spd < FLY_SURFACE_SPEED;

      if (iso) {
        let climbDelta = 0;
        if (keys.Space) climbDelta += ISO_FLY_CLIMB_RATE * dtSec;
        if (keys.ShiftLeft || keys.ShiftRight) climbDelta -= ISO_FLY_DESCEND_RATE * dtSec;
        this.flyHeight = Math.max(groundY, this.flyHeight + climbDelta);
        const pitchTarget = climbDelta > 0.01 ? 0.3 : climbDelta < -0.01 ? -0.3 : 0;
        this.flyPitch = THREE.MathUtils.lerp(this.flyPitch, pitchTarget, 1 - Math.exp(-9 * dtSec));
      } else {
        const diveMult = this.flyPitch < 0 ? FLY_PITCH_DIVE_MULT : 1;
        this.flyHeight = Math.max(groundY, this.flyHeight + this.flyPitch * FLY_PITCH_CLIMB_SCALE * diveMult * dtSec);
      }

      // Surface lock — taxi mode: decay pitch/roll/altitude toward ground when near surface at low speed
      if (onDeck) {
        const deckRate = 1 - Math.exp(-4 * dtSec);
        this.flyPitch = THREE.MathUtils.lerp(this.flyPitch, 0, deckRate);
        this.flyRollTarget = THREE.MathUtils.lerp(this.flyRollTarget, 0, deckRate);
        this.flyHeight = THREE.MathUtils.lerp(this.flyHeight, groundY, deckRate);
      }

      // Barrel roll
      if (this.flyBarrelActive) {
        this.flyBarrelPhase += dtSec / FLY_BARREL_DURATION;
        if (this.flyBarrelPhase >= 1) {
          this.flyBarrelActive = false;
          this.flyBarrelPhase = 0;
        }
      }

      // Roll smoothing
      const dtRoll = Math.min(dtSec, 0.08);
      this.flyRollTarget = THREE.MathUtils.lerp(this.flyRollTarget, 0, 1 - Math.exp(-FLY_ROLL_TARGET_DECAY * dtRoll));
      this.flyRoll = THREE.MathUtils.lerp(this.flyRoll, this.flyRollTarget, 1 - Math.exp(-FLY_ROLL_SMOOTH * dtRoll));

      // Aileron roll (Z / C) — persistent, camera follows
      if (!onDeck) {
        if (keys.KeyZ) this.flyAileronAngle += FLY_AILERON_RATE * dtSec;
        if (keys.KeyC) this.flyAileronAngle -= FLY_AILERON_RATE * dtSec;
      } else {
        const lvl = 1 - Math.exp(-3 * dtSec);
        this.flyAileronAngle *= 1 - lvl;
        if (Math.abs(this.flyAileronAngle) < 0.01) this.flyAileronAngle = 0;
      }
    } else if (charMode) {
      this.flyHeight = 0;

      // Glider toggle: rising-edge Space while airborne (checked BEFORE jump
      // so holding Space from the jump press doesn't immediately open it)
      const _charSpaceEdge = keys.Space && !this.charSpacePrev;
      if (_charSpaceEdge && this.charInAir) {
        this.charGliding = !this.charGliding;
      }

      // Character jump
      if (
        !this.charInAir && !this.charCrouching && !this.charRolling &&
        !this.charAttacking && !inSlide && this.charJumpPhase !== "land" &&
        keys.Space
      ) {
        this.charVelY = CHAR_JUMP_VEL;
        this.charInAir = true;
        if (this.charActions?.jumpStart) {
          this.charJumpPhase = "start";
          const js = this.charActions.jumpStart;
          js.reset().enabled = true;
          js.crossFadeFrom(this.charCurrentAction, 0.08, false).play();
          this.charCurrentAction = js;
        } else if (this.charActions?.jumpLoop) {
          this.charJumpPhase = "loop";
          const jl = this.charActions.jumpLoop;
          jl.reset().enabled = true;
          jl.crossFadeFrom(this.charCurrentAction, 0.08, false).play();
          this.charCurrentAction = jl;
        }
      }
      this.charSpacePrev = !!keys.Space;

      if (this.charInAir) {
        this.charVelY -= CHAR_GRAVITY * dtSec;
        if (this.charGliding) {
          this.charVelY = Math.max(this.charVelY, -CHAR_GLIDE_FALL_SPEED);
        }
        const prevY = this.charRoot ? this.charRoot.position.y : groundY;
        this.playerPos.y = prevY + this.charVelY * dtSec;
        if (this.charVelY > 0 && this.cliffBvh?.baked) {
          const headTop = this.playerPos.y + CAP_R * 2 + CAP_H;
          const ceilY = this.cliffBvh.raycastUp(this.playerPos.x, headTop, this.playerPos.z, this.charVelY * dtSec + 0.1);
          if (ceilY != null) {
            this.playerPos.y = ceilY - CAP_R * 2 - CAP_H;
            this.charVelY = 0;
          }
        }
        if (this.playerPos.y <= groundY) {
          this.playerPos.y = groundY;
          this.charVelY = 0;
          this.charInAir = false;
          this.charGliding = false;
          const landInputHeld = keys.KeyW || keys.KeyA || keys.KeyS || keys.KeyD ||
            keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight;
          if (landInputHeld && this.charActions) {
            this.charJumpPhase = "none";
            const tgt = charRunning ? this.charActions.run : this.charActions.walk;
            if (tgt) { tgt.enabled = true; tgt.reset(); tgt.crossFadeFrom(this.charCurrentAction, 0.12, false).play(); this.charCurrentAction = tgt; }
          } else if (this.charActions?.jumpLand) {
            this.charJumpPhase = "land";
            const jl = this.charActions.jumpLand;
            jl.reset().enabled = true;
            jl.crossFadeFrom(this.charCurrentAction, 0.1, false).play();
            this.charCurrentAction = jl;
          } else {
            this.charJumpPhase = "none";
          }
        }
      } else {
        const drop = prevY - groundY;
        if (drop > 0.4) {
          this.charInAir = true;
          this.charVelY = 0;
          this.playerPos.y = prevY;
          if (this.charActions?.jumpLoop && this.charJumpPhase !== "loop") {
            this.charJumpPhase = "loop";
            const jl = this.charActions.jumpLoop;
            jl.reset().enabled = true;
            jl.crossFadeFrom(this.charCurrentAction, 0.15, false).play();
            this.charCurrentAction = jl;
          }
        } else {
          this.playerPos.y = groundY;
        }
      }

      // Yaw
      if (inSpell) {
        let targetYaw = this.camYaw + PI;
        while (targetYaw > PI) targetYaw -= 2 * PI;
        while (targetYaw < -PI) targetYaw += 2 * PI;
        let dYaw = targetYaw - this.charYaw;
        while (dYaw > PI) dYaw -= 2 * PI;
        while (dYaw < -PI) dYaw += 2 * PI;
        this.charYaw += dYaw * (1 - Math.exp(-14 * dtSec));
      } else if (mlen > 0 && !this.charRolling && !this.charAttacking && !inSlide) {
        const targetYaw = Math.atan2(mx, mz);
        let dYaw = targetYaw - this.charYaw;
        while (dYaw > PI) dYaw -= 2 * PI;
        while (dYaw < -PI) dYaw += 2 * PI;
        this.charYaw += dYaw * (1 - Math.exp(-14 * dtSec));
      }
    } else if (carDriving) {
      this.flyHeight = 0;
      if (this.carInAir) {
        this.carVelY -= CAR_GRAVITY * dtSec;
        this.playerPos.y += this.carVelY * dtSec;
        if (this.playerPos.y <= groundY) {
          this.playerPos.y = groundY;
          this.carVelY = 0;
          this.carInAir = false;
        }
      } else {
        const drop = prevY - groundY;
        if (drop > CAR_EDGE_DROP_THRESHOLD) {
          this.carInAir = true;
          this.carVelY = 0;
          this.playerPos.y = prevY;
        } else {
          this.playerPos.y = groundY;
        }
      }
    } else {
      this.flyHeight = 0;

      // Capsule jump / gravity
      if (keys.Space && !this.inAir) {
        this.velY = JUMP_VEL;
        this.inAir = true;
      }
      if (this.inAir) {
        this.velY -= GRAVITY * dtSec;
        this.playerPos.y += this.velY * dtSec;
        if (this.velY > 0 && this.cliffBvh?.baked) {
          const headTop = this.playerPos.y + CAP_R * 2 + CAP_H;
          const ceilY = this.cliffBvh.raycastUp(this.playerPos.x, headTop, this.playerPos.z, this.velY * dtSec + 0.1);
          if (ceilY != null) {
            this.playerPos.y = ceilY - CAP_R * 2 - CAP_H;
            this.velY = 0;
          }
        }
        if (this.playerPos.y <= groundY) {
          this.playerPos.y = groundY;
          this.velY = 0;
          this.inAir = false;
        }
      } else {
        const drop = prevY - groundY;
        if (drop > 0.4) {
          this.inAir = true;
          this.velY = 0;
          this.playerPos.y = prevY;
        } else {
          this.playerPos.y = groundY;
        }
      }
    }

    // Plane BVH collision — multi-ray: forward, left wing, right wing, up, down
    if (flying && this.cliffBvh?.baked) {
      const px = this.playerPos.x;
      const py = this.flyHeight;
      const pz = this.playerPos.z;
      const cosP = Math.cos(this.flyPitch);
      const sinP = Math.sin(this.flyPitch);
      const sinH = Math.sin(this.flyHeading);
      const cosH = Math.cos(this.flyHeading);
      const fwdX = -sinH * cosP;
      const fwdY = sinP;
      const fwdZ = -cosH * cosP;
      const rightX = cosH;
      const rightZ = -sinH;
      const planeRadius = 2.5;
      const wingSpan = 3.0;

      const moveDx = px - prevPosX;
      const moveDz = pz - prevPosZ;
      const moveLen = Math.hypot(moveDx, moveDz);
      // Swept collision stops high-speed tunneling through thin geometry.
      if (moveLen > 1e-5) {
        const sweep = this.cliffBvh.raycast3D(
          prevPosX,
          py,
          prevPosZ,
          moveDx,
          0,
          moveDz,
          moveLen + planeRadius,
        );
        if (sweep) {
          const nx = moveDx / moveLen;
          const nz = moveDz / moveLen;
          const safeDist = Math.max(0, sweep.distance - planeRadius * 0.9);
          this.playerPos.x = prevPosX + nx * safeDist;
          this.playerPos.z = prevPosZ + nz * safeDist;
          this.planeSpeed *= 0.75;
        }
      }

      const probeDist = Math.max(planeRadius, planeRadius + moveLen);
      const rays = [
        { dx: fwdX, dy: fwdY, dz: fwdZ, dist: probeDist },
        { dx: rightX, dy: 0, dz: rightZ, dist: wingSpan },
        { dx: -rightX, dy: 0, dz: -rightZ, dist: wingSpan },
        { dx: 0, dy: 1, dz: 0, dist: 1.5 },
        { dx: 0, dy: -1, dz: 0, dist: 1.5 },
      ];

      for (const r of rays) {
        const hit = this.cliffBvh.raycast3D(px, py, pz, r.dx, r.dy, r.dz, r.dist);
        if (hit) {
          const pushDist = r.dist - hit.distance;
          if (pushDist > 0) {
            this.playerPos.x -= r.dx * pushDist;
            this.flyHeight -= r.dy * pushDist;
            this.playerPos.z -= r.dz * pushDist;
            if (this.flyHeight < groundY) this.flyHeight = groundY;
          }
        }
      }
    }

    // Capsule visual
    const capsuleCY = this.playerPos.y + capsuleBase;
    this.capsule.visible = this.moveMode === "capsule" || (this.moveMode === "fly" && !this.planeLoaded) || (this.moveMode === "char" && !this.charLoaded) || (this.moveMode === "car" && !this.carLoaded);
    this.capsule.position.set(this.playerPos.x, capsuleCY, this.playerPos.z);
    if (mlen > 0) {
      this._lastMx = mx / mlen;
      this._lastMz = mz / mlen;
    }
    if (this._lastMx !== 0 || this._lastMz !== 0) {
      this.capsule.rotation.y = Math.atan2(this._lastMx, this._lastMz) + Math.PI;
    }

    // Character visual + animation
    if (this.charRoot) {
      this.charRoot.visible = charMode;
      if (charMode) {
        this.charRoot.position.set(this.playerPos.x, this.playerPos.y, this.playerPos.z);
        this.charRoot.rotation.y = this.charYaw;
        if (this.charKite) this.charKite.visible = this.charGliding;
        // Glider pose
        if (this.charActions) {
          const wantGlide = this.charGliding && this.charActions.glide;
          if (wantGlide && !this.charGliderPoseActive) {
            this.charGliderPoseActive = true;
            const ga = this.charActions.glide;
            ga.reset().enabled = true;
            ga.crossFadeFrom(this.charCurrentAction, 0.15, false).play();
            this.charCurrentAction = ga;
          } else if (!wantGlide && this.charGliderPoseActive) {
            this.charGliderPoseActive = false;
            if (this.charInAir && this.charActions.jumpLoop) {
              const jl = this.charActions.jumpLoop;
              jl.reset().enabled = true;
              jl.crossFadeFrom(this.charCurrentAction, 0.15, false).play();
              this.charCurrentAction = jl;
              this.charJumpPhase = "loop";
            }
          }
        }
        // Locomotion picker
        if (
          this.charActions && !this.charAttacking && !this.charRolling &&
          !this.charGliderPoseActive && this.charSlidePhase === "none" &&
          this.charJumpPhase === "none" && this.charSpellPhase === "none"
        ) {
          let target = null;
          if (this.charCrouching)
            target = mlen > 0 ? this.charActions.crouchWalk : this.charActions.crouch;
          else if (mlen > 0)
            target = charRunning ? this.charActions.run : this.charActions.walk;
          else target = this.charActions.idle;
          if (target) this._charSetAction(target);
        }
        if (this.charMixer) this.charMixer.update(dtSec);
      }
    }

    // Plane visual
    if (this.planeRoot) {
      this.planeRoot.visible = flying;
      if (flying) {
        this.planeRoot.position.set(this.playerPos.x, this.flyHeight, this.playerPos.z);
        let barrelAdd = 0;
        if (this.flyBarrelActive) {
          const t = Math.min(1, this.flyBarrelPhase);
          barrelAdd = t * t * (3 - 2 * t) * Math.PI * 2 * this.flyBarrelDir;
        }
        if (iso) {
          this.planeRoot.rotation.set(0, this.flyHeading, barrelAdd + this.flyAileronAngle);
        } else {
          this.planeRoot.rotation.set(this.flyPitch, this.flyHeading, this.flyRoll + barrelAdd + this.flyAileronAngle);
        }
      }
    }

    // Car visual
    if (this.carRoot) {
      this.carRoot.visible = carDriving && this.carLoaded;
      if (carDriving && this.carLoaded) {
        const scaleFactor = this.carRoot.scale.x || CAR_MODEL_SCALE;
        const rootY = this.playerPos.y + (CAR_RIDE_HEIGHT + CAR_WHEEL_RADIUS) * scaleFactor;
        this.carRoot.position.set(this.playerPos.x, rootY, this.playerPos.z);
        this.carRoot.rotation.y = this.carHeading;

        let frontY = 0;
        let rearY = 0;
        let leftY = 0;
        let rightY = 0;
        let rearIdx = 0;
        for (const w of this.carWheels) {
          const lx = w.offset.x * scaleFactor;
          const lz = w.offset.z * scaleFactor;
          const wx =
            this.playerPos.x +
            lx * Math.cos(this.carHeading) +
            lz * Math.sin(this.carHeading);
          const wz =
            this.playerPos.z -
            lx * Math.sin(this.carHeading) +
            lz * Math.cos(this.carHeading);
          const h = this.getWorldHeight(wx, wz);
          w.contactWorld.set(wx, h + DRIFT_MARK_Y_OFFSET, wz);
          if (w.offset.z < 0) frontY += h;
          else {
            rearY += h;
            if (rearIdx < this._carRearContactPoints.length) {
              this._carRearContactPoints[rearIdx++].copy(w.contactWorld);
            }
          }
          if (w.offset.x < 0) leftY += h;
          else rightY += h;
        }

        const leftAvg = leftY * 0.5;
        const rightAvg = rightY * 0.5;
        const frontAvg = frontY * 0.5;
        const rearAvg = rearY * 0.5;
        const terrainRollRaw = Math.atan2(rightAvg - leftAvg, CAR_TRACK * scaleFactor);
        const terrainPitchRaw = Math.atan2(frontAvg - rearAvg, CAR_WHEEL_BASE * scaleFactor);
        const terrainRollTarget = THREE.MathUtils.clamp(terrainRollRaw, -CAR_BODY_TERRAIN_ROLL_MAX, CAR_BODY_TERRAIN_ROLL_MAX);
        const terrainPitchTarget = THREE.MathUtils.clamp(terrainPitchRaw, -CAR_BODY_TERRAIN_PITCH_MAX, CAR_BODY_TERRAIN_PITCH_MAX);
        const terrainSmooth = 1 - Math.exp(-CAR_TERRAIN_BODY_SMOOTH * dtSec);
        this.carTerrainRoll = THREE.MathUtils.lerp(this.carTerrainRoll, terrainRollTarget, terrainSmooth);
        this.carTerrainPitch = THREE.MathUtils.lerp(this.carTerrainPitch, terrainPitchTarget, terrainSmooth);
        const finalPitch = THREE.MathUtils.clamp(this.carTerrainPitch + this.carBodyPitch, -CAR_BODY_PITCH_MAX, CAR_BODY_PITCH_MAX);
        const finalRoll = THREE.MathUtils.clamp(this.carTerrainRoll + this.carBodyRoll, -CAR_BODY_ROLL_MAX, CAR_BODY_ROLL_MAX);
        this.carChassis.rotation.set(finalPitch, 0, finalRoll);

        const _steerVis = ((keys.KeyA || keys.ArrowLeft) ? 0.4 : 0) + ((keys.KeyD || keys.ArrowRight) ? -0.4 : 0);
        for (const w of this.carWheels) {
          const baseYaw = CAR_MODEL_YAW + (w.isLeft ? Math.PI : 0);
          w.container.rotation.y = baseYaw + (w.steer ? _steerVis : 0);
          if (w.cylinder) {
            w.cylinder.rotation.z = (w.isLeft ? -1 : 1) * this.carWheelSpin;
          }
        }

        const speed = Math.sqrt(this.carVx * this.carVx + this.carVz * this.carVz);
        const handbrake = keys.Space;
        const driftAmount = THREE.MathUtils.clamp((this.carDriftAngle - CAR_DRIFT_ANGLE_MIN) / 0.5, 0, 1);
        const handbrakeAmount = handbrake ? THREE.MathUtils.smoothstep(speed, CAR_DRIFT_ENTRY_SPEED, CAR_DRIFT_ENTRY_SPEED * 2.2) : 0;
        const driftIntensity = Math.max(driftAmount, handbrakeAmount);
        const emitMarks = !this.carInAir && speed > CAR_DRIFT_ENTRY_SPEED && driftIntensity > DRIFT_MARK_INTENSITY_MIN;
        const emitSmoke =
          !this.carInAir &&
          speed > CAR_DRIFT_ENTRY_SPEED * 0.55 &&
          (driftIntensity > (this.smokeSettings.trigger ?? DRIFT_SMOKE_INTENSITY_MIN) ||
            (handbrake && speed > CAR_DRIFT_ENTRY_SPEED * 0.55));
        this.driftMarks.update(this._carRearContactPoints, emitMarks, driftIntensity);
        this.driftSmoke.update(dtSec, this._carRearContactPoints, emitSmoke, Math.max(driftIntensity, handbrake ? 0.45 : 0), this.carVx, this.carVz, this.camera);
      } else {
        this.driftMarks.update(this._carRearContactPoints, false, 0);
        this.driftSmoke.update(dtSec, this._carRearContactPoints, false, 0, 0, 0, this.camera);
      }
    } else {
      this.driftMarks.update(this._carRearContactPoints, false, 0);
      this.driftSmoke.update(dtSec, this._carRearContactPoints, false, 0, 0, 0, this.camera);
    }

    // Flight HUD
    if (this._flyHud) {
      if (flying) {
        this._flyHud.style.display = "";
        this._flyHudSpd.textContent = Math.round(Math.abs(this.planeSpeed));
        this._flyHudAlt.textContent = Math.round(this.flyHeight - groundY);
      } else {
        this._flyHud.style.display = "none";
      }
    }

    // Car HUD
    if (this._carHud) {
      if (carDriving) {
        this._carHud.style.display = "";
        const kmh = Math.round(
          Math.sqrt(this.carVx * this.carVx + this.carVz * this.carVz) *
          3.6 *
          (this.carSettings.speedometerScale ?? 1),
        );
        this._carHudSpd.textContent = kmh;
        this._carHudAngle.textContent = Math.round(this.carDriftAngle * 180 / Math.PI);
        this._carHudAngle.style.color = this.carDrifting ? "#ff3300" : "#ff6633";
        if (this._carHudNitro) {
          const nitroPct = Math.round(this.carNitro * 100);
          this._carHudNitro.textContent = `${nitroPct}%`;
          this._carHudNitro.style.color = this.carNitro > 0.2 ? "#9ee8ff" : "#ff8c8c";
          if (this._carHudNitroBar) {
            this._carHudNitroBar.style.width = `${nitroPct}%`;
            this._carHudNitroBar.style.background = this.carNitro > 0.2
              ? "linear-gradient(90deg,#36c2ff,#7de8ff)"
              : "linear-gradient(90deg,#ff7a7a,#ffb36b)";
          }
        }
      } else {
        this._carHud.style.display = "none";
      }
    }

    // Wingtip contrails
    this._updateTrails();

    // Plane gun
    if (this._gunCooldown > 0) this._gunCooldown -= dtSec;
    if (flying && this._muzzleOffsets.length > 0 && keys.KeyE && this._gunCooldown <= 0) {
      this._planeInner.updateMatrixWorld(true);
      _bFwd.set(0, 0, -1).applyQuaternion(this.planeRoot.quaternion);
      const muz = this._muzzleOffsets[this._muzzleIdx];
      this._muzzleIdx = (this._muzzleIdx + 1) % this._muzzleOffsets.length;
      _bMuz.copy(muz);
      this._planeInner.localToWorld(_bMuz);
      fireBullet(this._bullets.pool, _bMuz, _bFwd);
      this._gunCooldown = 1 / GUN_FIRE_RATE;
    }
    updateBullets(this._bullets.pool, this.camera, dtSec);

    // Camera
    const charLookY = this.playerPos.y + CHAR_HEIGHT * 0.75;
    const carLookY = carDriving ? (this.carRoot ? this.carRoot.position.y + 1.2 : this.playerPos.y + 1.2) : 0;
    const lookAtY = flying ? this.flyHeight + 0.45 : carDriving ? carLookY : charMode ? charLookY : capsuleCY + 0.6;

    if (carDriving && !iso) {
      let chaseTarget = this.carHeading;
      if (this.carDrifting) {
        const rx = Math.cos(this.carHeading);
        const rz = -Math.sin(this.carHeading);
        const latSign = Math.sign(this.carVx * rx + this.carVz * rz);
        const driftOff = latSign * this.carDriftAngle * (this.carSettings.cameraDriftLag ?? CAR_CAM_DRIFT_LAG);
        chaseTarget += driftOff;
      }
      let camDelta = chaseTarget - this.carCamYaw;
      while (camDelta > Math.PI) camDelta -= 2 * Math.PI;
      while (camDelta < -Math.PI) camDelta += 2 * Math.PI;
      this.carCamYaw += camDelta * (1 - Math.exp(-(this.carSettings.cameraChaseSpeed ?? CAR_CAM_CHASE_SPEED) * dtSec));

      const camBehindX = this.playerPos.x + Math.sin(this.carCamYaw) * (this.carSettings.cameraDistance ?? CAR_CAM_DIST);
      const camBehindZ = this.playerPos.z + Math.cos(this.carCamYaw) * (this.carSettings.cameraDistance ?? CAR_CAM_DIST);
      const camY = lookAtY + (this.carSettings.cameraHeight ?? CAR_CAM_HEIGHT);
      this.camera.position.set(camBehindX, camY, camBehindZ);
      this.camera.lookAt(this.playerPos.x, lookAtY, this.playerPos.z);
    } else if (iso) {
      if (flying) {
        let yawDelta = this.flyHeading - this.isoYaw;
        while (yawDelta > Math.PI) yawDelta -= 2 * Math.PI;
        while (yawDelta < -Math.PI) yawDelta += 2 * Math.PI;
        this.isoYaw += yawDelta * (1 - Math.exp(-ISO_FLY_CHASE_SMOOTH * Math.min(dtSec, 0.1)));
      }
      const hDist = this.isoDist * Math.cos(ISO_PITCH);
      const vDist = this.isoDist * Math.sin(ISO_PITCH);
      this.camera.position.set(
        this.playerPos.x + Math.sin(this.isoYaw) * hDist,
        lookAtY + vDist,
        this.playerPos.z + Math.cos(this.isoYaw) * hDist,
      );
      this.camera.lookAt(this.playerPos.x, lookAtY, this.playerPos.z);
    } else {
      const camOrbitYaw = flying ? this.flyHeading + this.flyGroundCamYawOff : this.camYaw;
      const hDist = CAM_DIST * Math.cos(this.camPitch);
      const vDist = CAM_DIST * Math.sin(this.camPitch);
      const sinH = Math.sin(camOrbitYaw);
      const cosH = Math.cos(camOrbitYaw);
      const a = flying ? this.flyAileronAngle : 0;
      const sinA = Math.sin(a);
      const cosA = Math.cos(a);
      this.camera.position.set(
        this.playerPos.x + sinH * hDist - cosH * sinA * vDist,
        lookAtY + cosA * vDist,
        this.playerPos.z + cosH * hDist + sinH * sinA * vDist,
      );
      this.camera.up.set(-cosH * sinA, cosA, sinH * sinA);
      this.camera.lookAt(this.playerPos.x, lookAtY, this.playerPos.z);
    }
  }

  _toggleMoveMode() {
    const prev = this.moveMode;
    this._moveTarget = null;
    this.isoHoverRing.visible = false;
    this.isoTargetRing.visible = false;
    if (prev === "capsule") {
      this.moveMode = "char";
      this.charYaw = this.capsule.rotation.y;
      this.charVelY = 0;
      this.charInAir = false;
      this.charGliding = false;
      this.charGliderPoseActive = false;
      this.charSpacePrev = false;
      this.charCrouching = false;
      this.charAttacking = false;
      this.charRolling = false;
      this.charSlidePhase = "none";
      this.charJumpPhase = "none";
      this.charSpellPhase = "none";
      this.charSpellExitRequested = false;
      if (this.charKite) this.charKite.visible = false;
    } else if (prev === "char") {
      this.moveMode = "fly";
      this.flyHeading = this.charYaw;
      this.flyHeight = this.playerPos.y;
      this.flyPitch = 0;
      this.flyRoll = 0;
      this.flyRollTarget = 0;
      this.flyBarrelActive = false;
      this.flyBarrelPhase = 0;
      this.flyGroundCamYawOff = 0;
      this.flyAileronAngle = 0;
      this.planeSpeed = 0;
    } else if (prev === "fly") {
      this.moveMode = "car";
      this.carHeading = this.flyHeading;
      this.carVx = 0;
      this.carVz = 0;
      this.carDrifting = false;
      this.carDriftAngle = 0;
      this.carCamYaw = this.flyHeading;
      this.playerPos.y = this.getWorldHeight(this.playerPos.x, this.playerPos.z);
      this.flyHeight = 0;
      this.flyAileronAngle = 0;
      this.carVelY = 0;
      this.carInAir = false;
      this.driftMarks.reset();
      this.driftSmoke.reset();
      this._clearTrails(); clearBullets(this._bullets.pool);
    } else {
      this.moveMode = "capsule";
      this.carVx = 0;
      this.carVz = 0;
      this.playerPos.y = this.getWorldHeight(this.playerPos.x, this.playerPos.z);
      this.flyHeight = 0;
      this.flyPitch = 0;
      this.flyRoll = 0;
      this.flyRollTarget = 0;
      this.flyBarrelActive = false;
      this.flyBarrelPhase = 0;
      this.flyAileronAngle = 0;
      this.planeSpeed = 0;
      this.driftMarks.reset();
      this.driftSmoke.reset();
    }
  }

  _onKeyDown(event) {
    if (!this.active) return;
    this.keysHeld[event.code] = true;

    if (!event.repeat && event.code === "KeyG") {
      event.preventDefault();
      this._toggleMoveMode();
      return;
    }

    if (!event.repeat && event.code === "KeyQ" && this.flying && !this.flyBarrelActive) {
      event.preventDefault();
      this.flyBarrelActive = true;
      this.flyBarrelPhase = 0;
      this.flyBarrelDir = this.flyRoll >= 0 ? 1 : -1;
      return;
    }

    // Character actions (matches v1 keybindings: R=attack, C=roll, X=slide)
    const _charMode = this.moveMode === "char" && this.charLoaded;
    if (_charMode && !event.repeat) {
      const inSlide = this.charSlidePhase !== "none";
      const _inSpell = this.charSpellPhase !== "none";
      const busy = this.charRolling || this.charAttacking || inSlide;
      // Attack (R)
      if (event.code === "KeyR" && this.charActions?.attack && !busy && !_inSpell && !this.charInAir) {
        event.preventDefault();
        this.charAttacking = true;
        const a = this.charActions.attack;
        a.reset().enabled = true;
        a.crossFadeFrom(this.charCurrentAction, 0.12, false).play();
        this.charCurrentAction = a;
        return;
      }
      // Roll (C) — works mid-air too (matches v1)
      if (event.code === "KeyC" && this.charActions?.roll && !busy && !_inSpell) {
        event.preventDefault();
        this.charRolling = true;
        this.charRollYaw = this.charYaw;
        this.charRollStart = performance.now();
        const r = this.charActions.roll;
        r.reset().enabled = true;
        r.crossFadeFrom(this.charCurrentAction, 0.1, false).play();
        this.charCurrentAction = r;
        return;
      }
      // Slide (X) — requires movement keys held, ground only
      if (event.code === "KeyX" && this.charActions?.slideStart && !busy && !_inSpell && !this.charInAir) {
        const movingKeys = this.keysHeld.KeyW || this.keysHeld.KeyA ||
          this.keysHeld.KeyS || this.keysHeld.KeyD ||
          this.keysHeld.ArrowUp || this.keysHeld.ArrowDown ||
          this.keysHeld.ArrowLeft || this.keysHeld.ArrowRight;
        if (movingKeys) {
          event.preventDefault();
          this.charSlidePhase = "start";
          this.charSlideYaw = this.charYaw;
          this.charSlideStart = performance.now();
          const ss = this.charActions.slideStart;
          ss.reset().enabled = true;
          ss.crossFadeFrom(this.charCurrentAction, 0.1, false).play();
          this.charCurrentAction = ss;
          return;
        }
      }
      // Spell toggle (Q)
      if (event.code === "KeyQ") {
        event.preventDefault();
        if (this.charSpellPhase === "none" && !busy && this.charActions?.spellEnter) {
          this.charSpellPhase = "enter";
          this.charSpellExitRequested = false;
          const se = this.charActions.spellEnter;
          se.reset().enabled = true;
          se.crossFadeFrom(this.charCurrentAction, 0.15, false).play();
          this.charCurrentAction = se;
        } else if (
          (this.charSpellPhase === "idle" || this.charSpellPhase === "enter" || this.charSpellPhase === "shoot") &&
          this.charActions?.spellExit
        ) {
          this.charSpellExitRequested = true;
          if (this.charSpellPhase === "idle") {
            this.charSpellPhase = "exit";
            const sx = this.charActions.spellExit;
            sx.reset().enabled = true;
            sx.crossFadeFrom(this.charCurrentAction, 0.12, false).play();
            this.charCurrentAction = sx;
          }
        }
        return;
      }
      // Spell shoot (J)
      if (
        event.code === "KeyJ" &&
        this.charSpellPhase === "idle" &&
        !this.charSpellExitRequested &&
        this.charActions?.spellShoot
      ) {
        event.preventDefault();
        this.charSpellPhase = "shoot";
        const ss = this.charActions.spellShoot;
        ss.reset().enabled = true;
        ss.crossFadeFrom(this.charCurrentAction, 0.12, false).play();
        this.charCurrentAction = ss;
        return;
      }
    }

    if (!event.repeat && event.code === "KeyV") {
      event.preventDefault();
      this.camView = this.camView === "follow" ? "iso" : "follow";
      if (this.camView === "iso") {
        if (document.pointerLockElement) document.exitPointerLock();
        this.renderer.domElement.style.cursor = "";
        this.isoYaw = this.carMode ? this.carHeading : this.flying ? this.flyHeading : this.camYaw;
      } else {
        this._moveTarget = null;
        this.isoHoverRing.visible = false;
        this.isoTargetRing.visible = false;
        this.renderer.domElement.style.cursor = "none";
        this.renderer.domElement.requestPointerLock();
      }
    }

    if (event.code.startsWith("Arrow")) event.preventDefault();
    if (event.code === "Space") event.preventDefault();
  }

  _onKeyUp(event) {
    if (!this.active) return;
    delete this.keysHeld[event.code];
  }

  _onMouseMove(event) {
    if (!this.active || !document.pointerLockElement) return;

    if (this.flying) {
      const mx = event.movementX;
      const my = event.movementY;
      const agl = this.flyHeight - this.getWorldHeight(this.playerPos.x, this.playerPos.z);
      const spd = Math.abs(this.planeSpeed);
      const onDeck = agl < FLY_SURFACE_ALT && spd < FLY_SURFACE_SPEED;
      if (onDeck) {
        this.flyGroundCamYawOff -= mx * FLY_MOUSE_SENS_X;
      } else {
        this.flyGroundCamYawOff = 0;
        this.flyHeading -= mx * FLY_MOUSE_SENS_X;
        this.flyPitch = THREE.MathUtils.clamp(
          this.flyPitch + my * FLY_MOUSE_SENS_Y,
          FLY_PITCH_MIN, FLY_PITCH_MAX,
        );
        this.flyRollTarget = THREE.MathUtils.clamp(
          this.flyRollTarget - mx * FLY_ROLL_VEL_SCALE,
          -FLY_ROLL_MAX, FLY_ROLL_MAX,
        );
      }
      return;
    }

    if (this.carMode) return;

    this.camYaw -= event.movementX * CAM_SENS_X;
    this.camPitch += event.movementY * CAM_SENS_Y;
    this.camPitch = Math.max(0.05, Math.min(Math.PI * 0.45, this.camPitch));
  }

  _onPointerLockChange() {
    if (!document.pointerLockElement && this.active && this.camView !== "iso") {
      this._exitCallback?.();
    }
  }

  _onIsoClick(event) {
    if (!this.active || this.camView !== "iso" || event.button !== 0) return;
    if (this.flying || this.carMode) return;
    event.preventDefault();
    const hit = this._pickIsoTerrain(event);
    if (!hit) return;
    if (!this._moveTarget) this._moveTarget = new THREE.Vector3();
    this._moveTarget.copy(hit);
    this.isoTargetRing.visible = true;
    this.isoTargetRing.position.set(hit.x, hit.y + ISO_MOVE_RING_Y_OFFSET, hit.z);
  }

  _onIsoPointerMove(event) {
    if (!this.active || this.camView !== "iso" || this.flying || this.carMode) {
      this.isoHoverRing.visible = false;
      return;
    }
    if (event.timeStamp - this._lastIsoHoverPickMs < ISO_HOVER_PICK_MIN_MS) return;
    this._lastIsoHoverPickMs = event.timeStamp;
    const hit = this._pickIsoTerrainApprox(event);
    if (!hit) {
      this.isoHoverRing.visible = false;
      return;
    }
    this.isoHoverRing.visible = true;
    this.isoHoverRing.position.set(hit.x, hit.y + ISO_MOVE_RING_Y_OFFSET, hit.z);
  }

  _pickIsoTerrainApprox(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const origin = this._raycaster.ray.origin;
    const dir = this._raycaster.ray.direction;
    if (dir.y > -1e-4) return null;

    const t = (this.playerPos.y - origin.y) / dir.y;
    if (t < 0) return null;
    const x = origin.x + dir.x * t;
    const z = origin.z + dir.z * t;
    return this._isoPickHit.set(x, this.getTerrainHeight(x, z), z);
  }

  _pickIsoTerrain(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const origin = this._raycaster.ray.origin;
    const dir = this._raycaster.ray.direction;
    if (dir.y > -1e-4) return null;

    let t = 0.4;
    let step = 0.4;
    let prevT = 0;
    let prevAbove = origin.y - this.getTerrainHeight(origin.x, origin.z) > 0;
    for (let i = 0; i < 240; i++) {
      const px = origin.x + dir.x * t;
      const py = origin.y + dir.y * t;
      const pz = origin.z + dir.z * t;
      const groundY = this.getTerrainHeight(px, pz);
      const above = py - groundY > 0;
      if (!above && prevAbove) {
        let lo = prevT;
        let hi = t;
        for (let j = 0; j < 12; j++) {
          const mid = (lo + hi) * 0.5;
          const mx = origin.x + dir.x * mid;
          const my = origin.y + dir.y * mid;
          const mz = origin.z + dir.z * mid;
          if (my - this.getTerrainHeight(mx, mz) > 0) lo = mid;
          else hi = mid;
        }
        const ft = (lo + hi) * 0.5;
        return this._isoPickHit.set(
          origin.x + dir.x * ft,
          origin.y + dir.y * ft,
          origin.z + dir.z * ft,
        );
      }
      prevAbove = above;
      prevT = t;
      t += step;
      if (t > 1200) break;
      if (step < 18) step *= 1.025;
    }
    return null;
  }

  _onIsoWheel(event) {
    if (!this.active || this.camView !== "iso") return;
    event.preventDefault();
    const dir = event.deltaY < 0 ? -1 : 1;
    this.isoDist = THREE.MathUtils.clamp(
      this.isoDist + dir * 2,
      ISO_DIST_MIN,
      ISO_DIST_MAX,
    );
  }

  set onExit(fn) { this._exitCallback = fn; }

  dispose() {
    this.exit();
    this.scene.remove(this.capsule);
    this.capsule.geometry.dispose();
    this.capsule.material.dispose();
    this.scene.remove(this.isoHoverRing);
    this.scene.remove(this.isoTargetRing);
    this.isoHoverRing.geometry.dispose();
    this.isoHoverRing.material.dispose();
    this.isoTargetRing.material.dispose();
    for (const trail of this._wingTrails) {
      this.scene.remove(trail.mesh);
      trail.mesh.geometry.dispose();
    }
    this._trailMat.dispose();
    this.scene.remove(this._bullets.group);
    this._bullets.geo.dispose();
    this._bullets.mat.dispose();
    if (this.planeRoot) {
      this.scene.remove(this.planeRoot);
      this.planeRoot.traverse((o) => {
        if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); }
      });
    }
    if (this.charRoot) {
      this.scene.remove(this.charRoot);
      this.charRoot.traverse((o) => {
        if (o.isMesh || o.isSkinnedMesh) { o.geometry?.dispose(); o.material?.dispose(); }
      });
    }
    if (this.carRoot) {
      this.scene.remove(this.carRoot);
      this.carRoot.traverse((o) => {
        if (o.isMesh) { o.geometry?.dispose(); o.material?.dispose(); }
      });
    }
    if (this._carHud) this._carHud.remove();
  }
}
