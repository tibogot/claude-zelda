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
const CAM_DIST = 8;
const CAM_SENS_X = 0.002;
const CAM_SENS_Y = 0.002;
const ISO_PITCH = 1.0;
const ISO_DIST_DEFAULT = 26;
const ISO_DIST_MIN = 10;
const ISO_DIST_MAX = 70;
const ISO_YAW_ROT_SPEED = 1.6;

const FLY_MOUSE_SENS_X = 0.0022;
const FLY_MOUSE_SENS_Y = 0.0018;
const FLY_PITCH_MIN = -0.62;
const FLY_PITCH_MAX = 0.68;
const FLY_PITCH_CLIMB_SCALE = 14;
const FLY_ROLL_MAX = 0.78;
const FLY_ROLL_VEL_SCALE = 0.0042;
const FLY_ROLL_SMOOTH = 10;
const FLY_ROLL_TARGET_DECAY = 5;
const FLY_BARREL_DURATION = 0.88;
const ISO_FLY_YAW_RATE = 1.9;
const ISO_FLY_CLIMB_RATE = 22;
const ISO_FLY_CHASE_SMOOTH = 5.5;

const TRAIL_SEG = 90;
const TRAIL_HALF_W = 0.038;
const TRAIL_MAX_DIST = 0.6;

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
  constructor({ scene, camera, renderer, controls, getWorldHeight, getTerrainHeight, worldHalf, cliffBvh }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.controls = controls;
    this.getWorldHeight = getWorldHeight;
    this.getTerrainHeight = getTerrainHeight || getWorldHeight;
    this.worldHalf = worldHalf;
    this.cliffBvh = cliffBvh || null;
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
    this._onIsoWheel = this._onIsoWheel.bind(this);
    this._moveTarget = null;

    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

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
    this._loadCharacter();
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

        idleAction.play();
        this.charActions = {
          idle: idleAction, walk: walkAction, run: runAction,
          jumpStart: jumpStartAction, jumpLoop: jumpLoopAction, jumpLand: jumpLandAction,
          glide: glideAction, crouch: crouchAction, crouchWalk: crouchWalkAction,
          attack: attackAction, roll: rollAction,
          slideStart: slideStartAction, slideLoop: slideLoopAction, slideExit: slideExitAction,
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

    this.savedCamPos = this.camera.position.clone();
    this.savedTarget = this.controls.target.clone();
    this.playerPos.set(this.controls.target.x, 0, this.controls.target.z);
    this.playerPos.y = this.getWorldHeight(this.playerPos.x, this.playerPos.z);
    this.camYaw = 0;
    this.camPitch = 0.35;

    this.capsule.visible = true;
    if (this.planeRoot) this.planeRoot.visible = false;
    if (this.charRoot) this.charRoot.visible = false;
    this._clearTrails(); clearBullets(this._bullets.pool);
    this.controls.enabled = false;

    document.addEventListener("keydown", this._onKeyDown);
    document.addEventListener("keyup", this._onKeyUp);
    document.addEventListener("mousemove", this._onMouseMove);
    document.addEventListener("pointerlockchange", this._onPointerLockChange);
    this.renderer.domElement.addEventListener("click", this._onIsoClick);
    this.renderer.domElement.addEventListener("wheel", this._onIsoWheel, { passive: false });

    this.renderer.domElement.style.cursor = "none";
    this.renderer.domElement.requestPointerLock();
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    this._moveTarget = null;
    for (const k of Object.keys(this.keysHeld)) delete this.keysHeld[k];

    this.capsule.visible = false;
    if (this.planeRoot) this.planeRoot.visible = false;
    if (this.charRoot) this.charRoot.visible = false;
    this._clearTrails(); clearBullets(this._bullets.pool);

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
      if (keys.KeyW || keys.ArrowUp) { mx -= Math.sin(this.flyHeading); mz -= Math.cos(this.flyHeading); }
      if (keys.KeyS || keys.ArrowDown) { mx += Math.sin(this.flyHeading); mz += Math.cos(this.flyHeading); }
    } else {
      const moveYaw = iso ? this.isoYaw : this.camYaw;
      if (keys.KeyW || keys.ArrowUp)    { mx -= Math.sin(moveYaw); mz -= Math.cos(moveYaw); }
      if (keys.KeyS || keys.ArrowDown)  { mx += Math.sin(moveYaw); mz += Math.cos(moveYaw); }
      if (keys.KeyA || keys.ArrowLeft)  { mx -= Math.cos(moveYaw); mz += Math.sin(moveYaw); }
      if (keys.KeyD || keys.ArrowRight) { mx += Math.cos(moveYaw); mz -= Math.sin(moveYaw); }
    }

    // Iso click-to-move (capsule only)
    if (iso && !flying && this._moveTarget) {
      if (mx !== 0 || mz !== 0) {
        this._moveTarget = null;
      } else {
        const dx = this._moveTarget.x - this.playerPos.x;
        const dz = this._moveTarget.z - this.playerPos.z;
        if (Math.hypot(dx, dz) < 0.35) {
          this._moveTarget = null;
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
    if (charMode && this.charAttacking) { mx = 0; mz = 0; }

    const mlen = Math.hypot(mx, mz);
    const moveSpeed = charMode
      ? (this.charRolling ? _charRollSpeed
        : inSlide ? CHAR_SLIDE_SPEED
        : this.charCrouching ? CHAR_WALK_SPEED * 0.5
        : charRunning ? CHAR_RUN_SPEED
        : CHAR_WALK_SPEED)
      : MOVE_SPEED;
    if (mlen > 0) {
      let stepX = (mx / mlen) * moveSpeed * dtSec;
      let stepZ = (mz / mlen) * moveSpeed * dtSec;

      if (this.cliffBvh?.baked) {
        const capsuleBase = CAP_R + CAP_H * 0.5;
        const oy = this.playerPos.y + capsuleBase;
        const margin = CAP_R + 0.05;
        const stepLen = Math.hypot(stepX, stepZ);
        const castDist = stepLen + margin;

        const hit = this.cliffBvh.raycastLateral(
          this.playerPos.x, oy, this.playerPos.z,
          stepX, stepZ, castDist,
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
                this.playerPos.x, oy, this.playerPos.z,
                stepX, stepZ, Math.hypot(stepX, stepZ) + margin,
              );
              if (slideHit) {
                stepX = 0;
                stepZ = 0;
              }
            }
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
    this.playerPos.y = groundY;
    const capsuleBase = CAP_R + CAP_H * 0.5;

    // Fly altitude
    if (flying) {
      if (iso) {
        let climbDelta = 0;
        if (keys.Space) climbDelta += ISO_FLY_CLIMB_RATE * dtSec;
        if (keys.ShiftLeft || keys.ShiftRight) climbDelta -= ISO_FLY_CLIMB_RATE * dtSec;
        this.flyHeight = Math.max(0, this.flyHeight + climbDelta);
      } else {
        this.flyHeight = Math.max(0, this.flyHeight + this.flyPitch * FLY_PITCH_CLIMB_SCALE * dtSec);
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
        this.playerPos.y = groundY;
      }

      // Yaw
      if (mlen > 0 && !this.charRolling && !this.charAttacking && !inSlide) {
        const targetYaw = Math.atan2(mx, mz);
        let dYaw = targetYaw - this.charYaw;
        while (dYaw > PI) dYaw -= 2 * PI;
        while (dYaw < -PI) dYaw += 2 * PI;
        this.charYaw += dYaw * (1 - Math.exp(-14 * dtSec));
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
        if (this.playerPos.y <= groundY) {
          this.playerPos.y = groundY;
          this.velY = 0;
          this.inAir = false;
        }
      } else {
        this.playerPos.y = groundY;
        if (this.playerPos.y > groundY + 0.15) {
          this.inAir = true;
        }
      }
    }

    const planeY = groundY + this.flyHeight;

    // Capsule visual
    const capsuleCY = this.playerPos.y + capsuleBase;
    this.capsule.visible = this.moveMode === "capsule" || (this.moveMode === "fly" && !this.planeLoaded) || (this.moveMode === "char" && !this.charLoaded);
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
          this.charJumpPhase === "none"
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
        this.planeRoot.position.set(this.playerPos.x, planeY, this.playerPos.z);
        let barrelAdd = 0;
        if (this.flyBarrelActive) {
          const t = Math.min(1, this.flyBarrelPhase);
          barrelAdd = t * t * (3 - 2 * t) * Math.PI * 2 * this.flyBarrelDir;
        }
        if (iso) {
          this.planeRoot.rotation.set(0, this.flyHeading, barrelAdd);
        } else {
          this.planeRoot.rotation.set(this.flyPitch, this.flyHeading, this.flyRoll + barrelAdd);
        }
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
    const lookAtY = flying ? planeY + 0.45 : charMode ? charLookY : capsuleCY + 0.6;
    if (iso) {
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
    } else {
      const camOrbitYaw = flying ? this.flyHeading : this.camYaw;
      const hDist = CAM_DIST * Math.cos(this.camPitch);
      const vDist = CAM_DIST * Math.sin(this.camPitch);
      this.camera.position.set(
        this.playerPos.x + Math.sin(camOrbitYaw) * hDist,
        lookAtY + vDist,
        this.playerPos.z + Math.cos(camOrbitYaw) * hDist,
      );
    }
    this.camera.lookAt(this.playerPos.x, lookAtY, this.playerPos.z);
  }

  _toggleMoveMode() {
    const prev = this.moveMode;
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
      if (this.charKite) this.charKite.visible = false;
    } else if (prev === "char") {
      this.moveMode = "fly";
      this.flyHeading = this.charYaw;
      this.flyPitch = 0;
      this.flyRoll = 0;
      this.flyRollTarget = 0;
      this.flyBarrelActive = false;
      this.flyBarrelPhase = 0;
    } else {
      this.moveMode = "capsule";
      this.flyHeight = 0;
      this.flyPitch = 0;
      this.flyRoll = 0;
      this.flyRollTarget = 0;
      this.flyBarrelActive = false;
      this.flyBarrelPhase = 0;
      this._clearTrails(); clearBullets(this._bullets.pool);
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
      const busy = this.charRolling || this.charAttacking || inSlide;
      // Attack (R)
      if (event.code === "KeyR" && this.charActions?.attack && !busy && !this.charInAir) {
        event.preventDefault();
        this.charAttacking = true;
        const a = this.charActions.attack;
        a.reset().enabled = true;
        a.crossFadeFrom(this.charCurrentAction, 0.12, false).play();
        this.charCurrentAction = a;
        return;
      }
      // Roll (C) — works mid-air too (matches v1)
      if (event.code === "KeyC" && this.charActions?.roll && !busy) {
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
      if (event.code === "KeyX" && this.charActions?.slideStart && !busy && !this.charInAir) {
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
    }

    if (!event.repeat && event.code === "KeyV") {
      event.preventDefault();
      this.camView = this.camView === "follow" ? "iso" : "follow";
      if (this.camView === "iso") {
        if (document.pointerLockElement) document.exitPointerLock();
        this.renderer.domElement.style.cursor = "";
        this.isoYaw = this.flying ? this.flyHeading : this.camYaw;
      } else {
        this._moveTarget = null;
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
      this.flyHeading -= mx * FLY_MOUSE_SENS_X;
      this.flyPitch = THREE.MathUtils.clamp(
        this.flyPitch + my * FLY_MOUSE_SENS_Y,
        FLY_PITCH_MIN, FLY_PITCH_MAX,
      );
      this.flyRollTarget = THREE.MathUtils.clamp(
        this.flyRollTarget - mx * FLY_ROLL_VEL_SCALE,
        -FLY_ROLL_MAX, FLY_ROLL_MAX,
      );
      return;
    }

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
    if (this.flying) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this._pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._pointer, this.camera);

    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.playerPos.y);
    const target = new THREE.Vector3();
    if (this._raycaster.ray.intersectPlane(groundPlane, target)) {
      this._moveTarget = target;
    }
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
  }
}
