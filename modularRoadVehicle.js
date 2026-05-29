import * as THREE from "three";

/**
 * VVV-pattern raycast vehicle — recreated (not imported) from the Lotus VVV
 * physics lab so it can be tuned independently. A 6-DOF rigid body with four
 * raycast wheel probes (suspension + lateral grip + longitudinal drive),
 * chassis corner ground-contact fallback, optional wall probes, and an
 * anti-roll stabilizer.
 *
 * All tuning lives in the exported mutable objects below; build a UI against
 * them and the changes take effect live. Dimension/mass edits need
 * `vehicle.rebuildBody()`.
 */

export const GRAVITY = 9.81;

export const CHASSIS = {
  width: 1.8,
  height: 0.6,
  length: 3.6,
  mass: 1400,
  visualLift: 0,
};

/** Wheel hubs in chassis-local space. z>0 = front. */
export const WHEEL_LOCAL = [
  { name: "FL", pos: new THREE.Vector3(-1.05, -0.1, 1.4), steer: true, drive: true },
  { name: "FR", pos: new THREE.Vector3(1.05, -0.1, 1.4), steer: true, drive: true },
  { name: "RL", pos: new THREE.Vector3(-1.05, -0.1, -1.4), steer: false, drive: true },
  { name: "RR", pos: new THREE.Vector3(1.05, -0.1, -1.4), steer: false, drive: true },
];

export const TIRE = {
  rayLength: 1.0,
  rayPadAbove: 0.6,
  rayForwardBias: 0.6,
  rayLateralBias: 1.0,
  suspVisSmooth: 12,
  restLength: 0.55,
  springStrength: 65000,
  damper: 6500,
  bottomOutThresh: 0.7,
  bottomOutMult: 8,
  // Per-axle friction multipliers (× frictionCoeff). Lower the rear for
  // oversteer, lower the front for understeer. Handbrake swaps the rear out.
  gripFront: 1.0,
  gripRear: 1.0,
  gripHandbrake: 0.35,
  // Lateral slip model: force builds linearly with slip then saturates at the
  // friction circle. `tireStiffness` is the slope (≈ 1/peak-slip-angle); higher
  // = sharper, more grip before sliding. `lowSpeedRef` keeps slip well-defined
  // near standstill so the car doesn't jitter when parked.
  tireStiffness: 7.0,
  lowSpeedRef: 2.5,
  accelForce: 4000,
  topSpeed: 30,
  powerCurveExp: 2.0,
  brakeForce: 8000,
  reverseAccel: 2000,
  brakeReverseThreshold: 0.5,
  engineBrake: 800,
  maxSteerAngle: 0.55,
  steerSmooth: 8.0,
  // Speed-sensitive steering: the usable steer angle shrinks as speed rises so
  // the car isn't twitchy / spin-happy at the top end. At/above `steerSpeedRef`
  // (m/s) the angle is reduced by `steerSpeedReduce` (fraction).
  steerSpeedRef: 26,
  steerSpeedReduce: 0.55,
  frictionCoeff: 1.5,
  maxAngVel: 9.0,
  // Anti-roll / orientation. When grounded the chassis aligns its up-axis to the
  // averaged ground normal (so it leans into banks and follows loops instead of
  // fighting toward world-up); `stabilizerDamp` damps the roll/pitch rate.
  stabilizerStrength: 9000,
  stabilizerDamp: 2600,
  // Airborne control: gentle tumble damping + player torque (W/S pitch, A/D roll).
  airAngularDamp: 1400,
  airControl: 5000,
};

/** Drivetrain. `layout` picks which axle(s) get engine torque; for AWD,
 *  `powerBias` is the rear power fraction (0 = all front … 1 = all rear, 0.5 =
 *  even). Braking always acts on all four wheels regardless of layout. Total
 *  drive force is preserved across layouts, so RWD just concentrates it on the
 *  rear (more power-oversteer) rather than halving acceleration. */
export const DRIVETRAIN = {
  layout: "AWD", // 'FWD' | 'RWD' | 'AWD'
  powerBias: 0.5,
};

/** Aerodynamics. `drag` bounds top speed and tames downhill runaway (quadratic,
 *  opposing velocity). `downforce` presses the car onto whatever surface it's on
 *  (along -chassis-up) and scales with speed² — light by default, but it adds
 *  load-sensitive grip in fast corners and margin through loops. */
export const AERO = {
  drag: 0.45,
  downforce: 3.0,
};

/** Chassis shell vs the deck BVH — stops the body clipping into elevated track
 *  (ramps, loops, hard landings). Bottom corners get pushed out along the deck
 *  normal once they sink within `skin` of the surface. */
export const DECK = {
  enabled: true,
  skin: 0.05,
  searchRadius: 0.8,
  stiffness: 220000,
  damper: 9000,
};

export const WHEEL = {
  radius: 0.36,
  thickness: 0.24,
  rimRadius: 0.22,
  rimWidth: 0.26,
};

export const WALL = {
  probeRange: 0.9,
  stiffness: 300000,
  damper: 14000,
  clampPenFrac: 0.4,
};

/** Chassis-vs-solids (guardrails) collision via the solids BVH. A ring of
 *  spheres around the chassis is pushed out of the nearest surface. */
export const SOLID = {
  enabled: true,
  radius: 0.55,
  stiffness: 260000,
  damper: 12000,
  clampPenFrac: 0.5,
};

/* ----------------------------------------------------------------------- */
/* Rigid body — 6-DOF, force/torque accumulators                            */
/* ----------------------------------------------------------------------- */

class RigidBody {
  constructor({ mass, size }) {
    this.mass = mass;
    this.invMass = 1 / mass;
    this.localInvInertia = new THREE.Matrix3();
    this._setInertia(mass, size);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.angVel = new THREE.Vector3();
    this.forceAccum = new THREE.Vector3();
    this.torqueAccum = new THREE.Vector3();

    this._r = new THREE.Vector3();
    this._tau = new THREE.Vector3();
    this._rotVel = new THREE.Vector3();
    this._R3 = new THREE.Matrix3();
    this._R3t = new THREE.Matrix3();
    this._mat = new THREE.Matrix4();
    this._worldInvI = new THREE.Matrix3();
  }

  _setInertia(mass, { width: w, height: h, length: l }) {
    const Ixx = (mass / 12) * (h * h + l * l);
    const Iyy = (mass / 12) * (w * w + l * l);
    const Izz = (mass / 12) * (w * w + h * h);
    this.localInvInertia.set(1 / Ixx, 0, 0, 0, 1 / Iyy, 0, 0, 0, 1 / Izz);
  }

  addForce(F) {
    this.forceAccum.add(F);
  }

  addForceAtPoint(F, worldPoint) {
    this.forceAccum.add(F);
    this._r.subVectors(worldPoint, this.pos);
    this._tau.crossVectors(this._r, F);
    this.torqueAccum.add(this._tau);
  }

  getVelocityAtPoint(worldPoint, out) {
    this._r.subVectors(worldPoint, this.pos);
    this._rotVel.crossVectors(this.angVel, this._r);
    return out.addVectors(this.vel, this._rotVel);
  }

  integrate(dt) {
    this.vel.x += this.forceAccum.x * this.invMass * dt;
    this.vel.y += this.forceAccum.y * this.invMass * dt;
    this.vel.z += this.forceAccum.z * this.invMass * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    this._mat.makeRotationFromQuaternion(this.quat);
    this._R3.setFromMatrix4(this._mat);
    this._R3t.copy(this._R3).transpose();
    this._worldInvI.copy(this._R3).multiply(this.localInvInertia).multiply(this._R3t);

    this._tau.copy(this.torqueAccum).applyMatrix3(this._worldInvI);
    this.angVel.x += this._tau.x * dt;
    this.angVel.y += this._tau.y * dt;
    this.angVel.z += this._tau.z * dt;

    const wx = this.angVel.x, wy = this.angVel.y, wz = this.angVel.z;
    const qx = this.quat.x, qy = this.quat.y, qz = this.quat.z, qw = this.quat.w;
    const dqx = 0.5 * (wx * qw + wy * qz - wz * qy);
    const dqy = 0.5 * (-wx * qz + wy * qw + wz * qx);
    const dqz = 0.5 * (wx * qy - wy * qx + wz * qw);
    const dqw = 0.5 * (-wx * qx - wy * qy - wz * qz);
    this.quat.set(qx + dqx * dt, qy + dqy * dt, qz + dqz * dt, qw + dqw * dt);
    this.quat.normalize();

    this.forceAccum.set(0, 0, 0);
    this.torqueAccum.set(0, 0, 0);
  }
}

/* ----------------------------------------------------------------------- */
/* Tire — raycast probe + suspension/steering/longitudinal forces           */
/* ----------------------------------------------------------------------- */

class Tire {
  constructor({ name, localPos, steer, drive }) {
    this.name = name;
    this.localPos = localPos.clone();
    this.canSteer = steer;
    this.canDrive = drive;
    this.isFront = localPos.z > 0;

    this.grounded = false;
    this.compression = 0;
    this.hitDistance = TIRE.rayLength;
    this.hitPoint = new THREE.Vector3();
    this.hitNormal = new THREE.Vector3(0, 1, 0);
    this.worldPos = new THREE.Vector3();
    this.lastSuspension = new THREE.Vector3();
    this.lastSteering = new THREE.Vector3();
    this.lastAccel = new THREE.Vector3();
    this._smoothDist = undefined;

    this._tireVel = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wheelFwd = new THREE.Vector3();
    this._wheelRight = new THREE.Vector3();
    this._steerQuat = new THREE.Quaternion();
    this._F = new THREE.Vector3();
    this._down = new THREE.Vector3();
    this._rayO = new THREE.Vector3();
    this._bestP = new THREE.Vector3();
    this._bestN = new THREE.Vector3(0, 1, 0);
  }

  apply(body, dt, steerAngle, throttle, handbrake, castGround, driveScale = 1) {
    this.worldPos.copy(this.localPos).applyQuaternion(body.quat).add(body.pos);
    this._up.set(0, 1, 0).applyQuaternion(body.quat);
    this._fwd.set(0, 0, 1).applyQuaternion(body.quat);
    this._right.set(1, 0, 0).applyQuaternion(body.quat);

    this._wheelFwd.copy(this._fwd);
    this._wheelRight.copy(this._right);
    if (this.canSteer && steerAngle !== 0) {
      this._steerQuat.setFromAxisAngle(this._up, steerAngle);
      this._wheelFwd.applyQuaternion(this._steerQuat);
      this._wheelRight.applyQuaternion(this._steerQuat);
    }

    const pad = TIRE.rayPadAbove;
    const fwdBias = TIRE.rayForwardBias * WHEEL.radius;
    const far = TIRE.rayLength + pad;
    this._down.copy(this._up).multiplyScalar(-1);

    let bestDist = Infinity;
    let bestPoint = null;
    const sample = (dirVec, off) => {
      this._rayO.copy(this.worldPos).addScaledVector(this._up, pad);
      if (dirVec) this._rayO.addScaledVector(dirVec, off);
      const hit = castGround(this._rayO, this._down, far);
      if (hit && hit.distance < bestDist) {
        bestDist = hit.distance;
        bestPoint = this._bestP.copy(hit.point);
        if (hit.face && hit.face.normal) this._bestN.copy(hit.face.normal);
        else this._bestN.set(0, 1, 0);
      }
    };

    sample(null, 0);
    if (fwdBias > 1e-4) {
      sample(this._wheelFwd, fwdBias);
      sample(this._wheelFwd, -fwdBias);
    }
    const latBias = TIRE.rayLateralBias * WHEEL.thickness * 0.5;
    if (latBias > 1e-4) {
      sample(this._wheelRight, latBias);
      sample(this._wheelRight, -latBias);
    }

    this.lastSuspension.set(0, 0, 0);
    this.lastSteering.set(0, 0, 0);
    this.lastAccel.set(0, 0, 0);

    if (bestDist === Infinity) {
      this.grounded = false;
      this.compression = 0;
      this.hitDistance = TIRE.rayLength;
      return;
    }

    this.grounded = true;
    this.hitPoint.copy(bestPoint);
    this.hitNormal.copy(this._bestN);
    if (this.hitNormal.dot(this._up) < 0) this.hitNormal.negate();
    if (this.hitNormal.lengthSq() < 1e-8) this.hitNormal.copy(this._up);
    this.hitNormal.normalize();
    const distFromHub = bestDist - pad;
    this.hitDistance = distFromHub;
    this.compression = TIRE.restLength - distFromHub;

    body.getVelocityAtPoint(this.worldPos, this._tireVel);

    // 1) Suspension (vertical) with quadratic bottom-out.
    const upVel = this._tireVel.dot(this._up);
    let springMag = this.compression * TIRE.springStrength;
    const ovr = this.compression - TIRE.restLength * TIRE.bottomOutThresh;
    if (ovr > 0) springMag += ovr * ovr * TIRE.springStrength * TIRE.bottomOutMult;
    const dampMag = upVel * TIRE.damper;
    const suspMag = Math.max(0, springMag - dampMag);
    this._F.copy(this._up).multiplyScalar(suspMag);
    body.addForceAtPoint(this._F, this.worldPos);
    this.lastSuspension.copy(this._F);

    // Friction circle radius — load-sensitive: `suspMag` is the dynamic normal
    // load, so weight transfer (outer wheels compress more) feeds straight into
    // available grip. Per-axle μ multiplier sets the handling balance.
    const axleGrip = this.canSteer
      ? TIRE.gripFront
      : handbrake
      ? TIRE.gripHandbrake
      : TIRE.gripRear;
    const Fmax = TIRE.frictionCoeff * axleGrip * suspMag;

    // 2) Lateral grip — slip-based brush model. Force rises linearly with the
    // lateral slip ratio (≈ tan slip angle) up to the friction limit, then the
    // tire SLIDES (force saturates) instead of perfectly cancelling velocity.
    const vLat = this._tireVel.dot(this._wheelRight);
    const vLong = this._tireVel.dot(this._wheelFwd);
    const vRef = Math.max(Math.abs(vLong), TIRE.lowSpeedRef);
    let latNorm = -(vLat / vRef) * TIRE.tireStiffness;
    if (latNorm > 1) latNorm = 1;
    else if (latNorm < -1) latNorm = -1;
    let Fy = latNorm * Fmax;

    // 3) Longitudinal. Braking acts on every wheel; engine torque (accel /
    // reverse / engine-brake) is scaled by this wheel's drivetrain share, so
    // FWD/RWD/AWD just changes *where* the drive force is applied.
    let Fx = 0;
    const carSpeed = body.vel.dot(this._fwd);
    const thr = TIRE.brakeReverseThreshold;
    if (throttle > 0) {
      if (carSpeed < -thr) {
        Fx = TIRE.brakeForce;
      } else {
        const normSpeed = Math.min(1, Math.abs(carSpeed) / TIRE.topSpeed);
        Fx = driveScale * TIRE.accelForce * Math.max(0, 1 - Math.pow(normSpeed, TIRE.powerCurveExp));
      }
    } else if (throttle < 0) {
      if (carSpeed > thr) {
        Fx = -TIRE.brakeForce;
      } else {
        const normSpeed = Math.min(1, Math.abs(carSpeed) / TIRE.topSpeed);
        Fx = -driveScale * TIRE.reverseAccel * Math.max(0, 1 - Math.pow(normSpeed, TIRE.powerCurveExp));
      }
    } else if (driveScale > 0) {
      const fwdVel = this._tireVel.dot(this._wheelFwd);
      Fx = -Math.sign(fwdVel) * Math.min(Math.abs(fwdVel) * 200, TIRE.engineBrake);
    }
    if (Fx > Fmax) Fx = Fmax;
    else if (Fx < -Fmax) Fx = -Fmax;

    // 4) Combined-slip friction circle — lateral and longitudinal share one
    // budget. Hard braking eats cornering grip (trail-braking / lockup feel);
    // power-on at a low-grip rear axle eats lateral grip (power oversteer).
    const demand = Math.hypot(Fx, Fy);
    if (demand > Fmax && demand > 1e-6) {
      const s = Fmax / demand;
      Fx *= s;
      Fy *= s;
    }

    this._F.copy(this._wheelRight).multiplyScalar(Fy);
    body.addForceAtPoint(this._F, this.worldPos);
    this.lastSteering.copy(this._F);

    this._F.copy(this._wheelFwd).multiplyScalar(Fx);
    body.addForceAtPoint(this._F, this.worldPos);
    this.lastAccel.copy(this._F);
  }
}

/* ----------------------------------------------------------------------- */
/* Vehicle — meshes + physics step + visual sync                            */
/* ----------------------------------------------------------------------- */

export class Vehicle {
  constructor({ scene, showArrows = false }) {
    this.scene = scene;
    this.collidables = [];
    this.walls = [];
    this.wallBoxes = [];
    this.groundBvh = null;
    this.solidsBvh = null;
    this.enabled = false;
    this.spawnPos = new THREE.Vector3(0, 0.7, -4);
    this.spawnQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

    this.body = new RigidBody({ mass: CHASSIS.mass, size: CHASSIS });
    this.tires = WHEEL_LOCAL.map((w) => new Tire({ name: w.name, localPos: w.pos, steer: w.steer, drive: w.drive }));
    this.input = { steer: 0, throttle: 0, handbrake: false };

    this.group = new THREE.Group();
    this.group.name = "Vehicle";
    this.group.visible = false;
    scene.add(this.group);

    this._buildMeshes(showArrows);
    this._initScratch();

    this.raycaster = new THREE.Raycaster();
    this._bvhRay = new THREE.Ray();
    this._castGround = (origin, dir, far) => {
      if (this.groundBvh && this.groundBvh.baked) {
        return this.groundBvh.raycastFirst(origin, dir, far);
      }
      this.raycaster.ray.origin.copy(origin);
      this.raycaster.ray.direction.copy(dir);
      this.raycaster.far = far;
      const hits = this.raycaster.intersectObjects(this.collidables, false);
      return hits.length ? hits[0] : null;
    };
    this.SUBSTEPS = 4;
    this.respawn();
  }

  _buildMeshes(showArrows) {
    this.chassisMesh = new THREE.Mesh(
      new THREE.BoxGeometry(CHASSIS.width, CHASSIS.height, CHASSIS.length),
      new THREE.MeshStandardMaterial({ color: 0x5b6cd6, roughness: 0.55, metalness: 0.3 }),
    );
    this.chassisMesh.castShadow = true;
    this.chassisMesh.receiveShadow = true;
    this.group.add(this.chassisMesh);

    const tireGeo = new THREE.CylinderGeometry(WHEEL.radius, WHEEL.radius, WHEEL.thickness, 28);
    tireGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 });
    const rimGeo = new THREE.CylinderGeometry(WHEEL.rimRadius, WHEEL.rimRadius, WHEEL.rimWidth, 18);
    rimGeo.rotateZ(Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xb0b8c0, roughness: 0.35, metalness: 0.85 });
    const spokeGeo = new THREE.CircleGeometry(WHEEL.rimRadius * 0.92, 6);
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });

    this.tireGroups = this.tires.map(() => {
      const g = new THREE.Group();
      const tire = new THREE.Mesh(tireGeo, tireMat);
      const rim = new THREE.Mesh(rimGeo, rimMat);
      tire.castShadow = true;
      rim.castShadow = true;
      const spokeL = new THREE.Mesh(spokeGeo, spokeMat);
      const spokeR = new THREE.Mesh(spokeGeo, spokeMat);
      spokeL.position.x = -WHEEL.rimWidth / 2 - 0.001;
      spokeR.position.x = WHEEL.rimWidth / 2 + 0.001;
      spokeL.rotation.y = Math.PI / 2;
      spokeR.rotation.y = -Math.PI / 2;
      g.add(tire, rim, spokeL, spokeR);
      this.group.add(g);
      return g;
    });

    this.arrowGroup = new THREE.Group();
    this.arrowGroup.visible = showArrows;
    this.group.add(this.arrowGroup);
    this.arrows = this.tires.map(() => {
      const up = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 0.1, 0x60ff80, 0.18, 0.1);
      const side = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.1, 0x4090ff, 0.18, 0.1);
      const fwd = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 0.1, 0xff5060, 0.18, 0.1);
      this.arrowGroup.add(up, side, fwd);
      return { up, side, fwd };
    });
    this.wheelSpin = [0, 0, 0, 0];
  }

  _initScratch() {
    this._gravityF = new THREE.Vector3();
    this._hw = CHASSIS.width / 2;
    this._hh = CHASSIS.height / 2;
    this._hl = CHASSIS.length / 2;
    this.CHASSIS_CORNERS = [];
    this.PROBE_LOCALS = [
      { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, 1) },
      { pos: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1) },
      { pos: new THREE.Vector3(), dir: new THREE.Vector3(1, 0, 0) },
      { pos: new THREE.Vector3(), dir: new THREE.Vector3(-1, 0, 0) },
    ];
    for (let i = 0; i < 8; i++) this.CHASSIS_CORNERS.push(new THREE.Vector3());
    this.SOLID_SAMPLES = [];
    for (let i = 0; i < 6; i++) this.SOLID_SAMPLES.push(new THREE.Vector3());
    this._sphC = new THREE.Vector3();
    this._sphN = new THREE.Vector3();
    this._sphV = new THREE.Vector3();
    this._sphF = new THREE.Vector3();
    this._refreshLocalFrames();

    this.CORNER_SPRING = 180000;
    this.CORNER_DAMPER = 6000;
    this.CORNER_FRICTION = 0.6;

    this._cWorld = new THREE.Vector3();
    this._cVel = new THREE.Vector3();
    this._cF = new THREE.Vector3();
    this._cVelHoriz = new THREE.Vector3();
    this._stabUp = new THREE.Vector3();
    this._stabTorque = new THREE.Vector3();
    this._stabN = new THREE.Vector3();
    this._stabCross = new THREE.Vector3();
    this._stabWTilt = new THREE.Vector3();
    this._airRight = new THREE.Vector3();
    this._airFwd = new THREE.Vector3();
    this._deckN = new THREE.Vector3();
    this.BOTTOM_CORNERS = [0, 1, 4, 5];
    this._aeroF = new THREE.Vector3();
    this._aeroUp = new THREE.Vector3();
    this._probeOrigin = new THREE.Vector3();
    this._probeDirW = new THREE.Vector3();
    this._probeVel = new THREE.Vector3();
    this._probeF = new THREE.Vector3();
    this._depenDir = new THREE.Vector3();

    this._wheelUp = new THREE.Vector3();
    this._wheelOffset = new THREE.Vector3();
    this._steerLocalQ = new THREE.Quaternion();
    this._spinLocalQ = new THREE.Quaternion();
    this._wheelFwdWorld = new THREE.Vector3();
    this._wheelTireVel = new THREE.Vector3();
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this._xAxis = new THREE.Vector3(1, 0, 0);
    this._zAxis = new THREE.Vector3(0, 0, 1);
    this._arrowDir = new THREE.Vector3();
  }

  _refreshLocalFrames() {
    const hw = (this._hw = CHASSIS.width / 2);
    const hh = (this._hh = CHASSIS.height / 2);
    const hl = (this._hl = CHASSIS.length / 2);
    const c = this.CHASSIS_CORNERS;
    c[0].set(-hw, -hh, -hl); c[1].set(hw, -hh, -hl);
    c[2].set(-hw, hh, -hl); c[3].set(hw, hh, -hl);
    c[4].set(-hw, -hh, hl); c[5].set(hw, -hh, hl);
    c[6].set(-hw, hh, hl); c[7].set(hw, hh, hl);
    this.PROBE_LOCALS[0].pos.set(0, 0, hl);
    this.PROBE_LOCALS[1].pos.set(0, 0, -hl);
    this.PROBE_LOCALS[2].pos.set(hw, 0, 0);
    this.PROBE_LOCALS[3].pos.set(-hw, 0, 0);
    // Ring of side spheres (mid-height) used for solids/guardrail collision.
    const s = this.SOLID_SAMPLES;
    s[0].set(hw, 0, hl * 0.6); s[1].set(hw, 0, 0); s[2].set(hw, 0, -hl * 0.6);
    s[3].set(-hw, 0, hl * 0.6); s[4].set(-hw, 0, 0); s[5].set(-hw, 0, -hl * 0.6);
  }

  /** Re-derive inertia + local frames + visual box after mass/size edits. */
  rebuildBody() {
    this.body.mass = CHASSIS.mass;
    this.body.invMass = 1 / CHASSIS.mass;
    this.body._setInertia(CHASSIS.mass, CHASSIS);
    this._refreshLocalFrames();
    this.chassisMesh.geometry.dispose();
    this.chassisMesh.geometry = new THREE.BoxGeometry(CHASSIS.width, CHASSIS.height, CHASSIS.length);
  }

  setColliders(collidables, walls = []) {
    this.collidables = collidables.slice();
    for (const c of this.collidables) c.updateMatrixWorld(true);
    this.walls = walls.slice();
    for (const w of this.walls) w.updateMatrixWorld(true);
    this.wallBoxes = this.walls.map((w) => new THREE.Box3().setFromObject(w));
  }

  /** Attach baked BVHs. `ground` drives wheel probes; `solids` blocks the chassis. */
  setBvh(ground, solids) {
    this.groundBvh = ground || null;
    this.solidsBvh = solids || null;
  }

  setSpawn(pos, quat) {
    this.spawnPos.copy(pos);
    if (quat) this.spawnQuat.copy(quat);
  }

  respawn() {
    this.body.pos.copy(this.spawnPos);
    this.body.vel.set(0, 0, 0);
    this.body.quat.copy(this.spawnQuat);
    this.body.angVel.set(0, 0, 0);
  }

  /** Recover in place: keep position + heading, zero the roll/pitch and spin,
   *  drop vertical speed, and lift slightly so the wheels clear the surface. */
  flipUpright() {
    const q = this.body.quat;
    const yaw = Math.atan2(2 * (q.w * q.y + q.z * q.x), 1 - 2 * (q.y * q.y + q.x * q.x));
    this.body.quat.setFromAxisAngle(this._yAxis, yaw);
    this.body.angVel.set(0, 0, 0);
    this.body.vel.y = 0;
    this.body.pos.y += 0.6;
  }

  setEnabled(on) {
    this.enabled = on;
    this.group.visible = on;
    if (on) this.respawn();
  }

  setArrowsVisible(v) {
    this.arrowGroup.visible = v;
  }

  /** @param {{steerTarget:number, throttle:number, handbrake:boolean}} controls */
  update(dt, controls) {
    if (!this.enabled) return;
    const k = 1 - Math.exp(-TIRE.steerSmooth * dt);
    this.input.steer += ((controls.steerTarget ?? 0) - this.input.steer) * k;
    this.input.throttle = controls.throttle ?? 0;
    this.input.handbrake = !!controls.handbrake;

    this._physicsStep(dt);
    this._depenetrateFromWalls();
    this._syncVisuals(dt);
  }

  /** Steer angle after speed-sensitive reduction (shared by physics + visuals). */
  _steerAngle() {
    const speed = this.body.vel.length();
    let t = speed / Math.max(0.1, TIRE.steerSpeedRef);
    if (t > 1) t = 1;
    const factor = 1 - TIRE.steerSpeedReduce * t;
    return this.input.steer * TIRE.maxSteerAngle * factor;
  }

  /** Rear power fraction from the drivetrain layout (FWD=0, RWD=1, AWD=bias). */
  _driveBias() {
    if (DRIVETRAIN.layout === "FWD") return 0;
    if (DRIVETRAIN.layout === "RWD") return 1;
    return Math.min(1, Math.max(0, DRIVETRAIN.powerBias));
  }

  _physicsStep(dt) {
    const subDt = dt / this.SUBSTEPS;
    const steerAngle = this._steerAngle();
    const body = this.body;
    // Per-axle drive scale: total drive is preserved (front+rear share = 2 wheels
    // × 2 axles' worth), so each axle's two wheels carry their power fraction.
    const bias = this._driveBias();
    const fScale = 2 * (1 - bias);
    const rScale = 2 * bias;
    for (let s = 0; s < this.SUBSTEPS; s++) {
      this._gravityF.set(0, -GRAVITY * body.mass, 0);
      body.addForce(this._gravityF);
      this._applyAero();
      for (const tire of this.tires) {
        const driveScale = tire.isFront ? fScale : rScale;
        tire.apply(body, subDt, steerAngle, this.input.throttle, this.input.handbrake, this._castGround, driveScale);
      }
      if (this.walls.length) this._applyWallProbes();
      if (SOLID.enabled && this.solidsBvh && this.solidsBvh.baked) this._resolveSolids();
      if (DECK.enabled && this.groundBvh && this.groundBvh.baked) this._applyDeckContact();
      this._applyChassisGroundContact();
      this._applyStabilizer();
      body.integrate(subDt);
      const wMax = TIRE.maxAngVel;
      if (body.angVel.lengthSq() > wMax * wMax) body.angVel.setLength(wMax);
    }
  }

  _applyStabilizer() {
    const body = this.body;
    let grounded = 0;
    this._stabN.set(0, 0, 0);
    for (const t of this.tires) {
      if (t.grounded) {
        grounded++;
        this._stabN.add(t.hitNormal);
      }
    }
    this._stabUp.set(0, 1, 0).applyQuaternion(body.quat);

    if (grounded > 0) {
      if (TIRE.stabilizerStrength <= 0 || this._stabN.lengthSq() < 1e-8) return;
      // Align chassis-up to the averaged ground normal (banks/loops follow the
      // surface), with damping on the roll/pitch rate but not on yaw (steering).
      this._stabN.normalize();
      this._stabCross.crossVectors(this._stabUp, this._stabN);
      this._stabTorque.copy(this._stabCross).multiplyScalar(TIRE.stabilizerStrength);
      const wYaw = body.angVel.dot(this._stabUp);
      this._stabWTilt.copy(body.angVel).addScaledVector(this._stabUp, -wYaw);
      this._stabTorque.addScaledVector(this._stabWTilt, -TIRE.stabilizerDamp);
      body.torqueAccum.add(this._stabTorque);
    } else {
      // Airborne: gentle tumble damping + player air control.
      this._stabTorque.copy(body.angVel).multiplyScalar(-TIRE.airAngularDamp);
      if (TIRE.airControl > 0) {
        this._airRight.set(1, 0, 0).applyQuaternion(body.quat);
        this._airFwd.set(0, 0, 1).applyQuaternion(body.quat);
        this._stabTorque.addScaledVector(this._airRight, -this.input.throttle * TIRE.airControl);
        this._stabTorque.addScaledVector(this._airFwd, this.input.steer * TIRE.airControl);
      }
      body.torqueAccum.add(this._stabTorque);
    }
  }

  _applyChassisGroundContact() {
    const body = this.body;
    for (const corner of this.CHASSIS_CORNERS) {
      this._cWorld.copy(corner).applyQuaternion(body.quat).add(body.pos);
      if (this._cWorld.y >= 0) continue;
      const pen = -this._cWorld.y;
      body.getVelocityAtPoint(this._cWorld, this._cVel);
      const dampMag = Math.max(0, -this._cVel.y) * this.CORNER_DAMPER;
      const upMag = pen * this.CORNER_SPRING + dampMag;
      this._cF.set(0, upMag, 0);
      body.addForceAtPoint(this._cF, this._cWorld);
      this._cVelHoriz.set(this._cVel.x, 0, this._cVel.z);
      const horizSpeed = this._cVelHoriz.length();
      if (horizSpeed > 0.01) {
        this._cVelHoriz.multiplyScalar(1 / horizSpeed);
        const fricMag = -this.CORNER_FRICTION * upMag;
        this._cF.set(this._cVelHoriz.x * fricMag, 0, this._cVelHoriz.z * fricMag);
        body.addForceAtPoint(this._cF, this._cWorld);
      }
    }
  }

  _applyWallProbes() {
    const body = this.body;
    for (const p of this.PROBE_LOCALS) {
      this._probeOrigin.copy(p.pos).applyQuaternion(body.quat).add(body.pos);
      this._probeDirW.copy(p.dir).applyQuaternion(body.quat);
      this.raycaster.ray.origin.copy(this._probeOrigin);
      this.raycaster.ray.direction.copy(this._probeDirW);
      this.raycaster.far = WALL.probeRange;
      const hits = this.raycaster.intersectObjects(this.walls, false);
      if (hits.length === 0) continue;
      const hit = hits[0];
      const pen = WALL.probeRange - hit.distance;
      if (pen <= 0) continue;
      body.getVelocityAtPoint(hit.point, this._probeVel);
      const inwardVel = this._probeVel.dot(this._probeDirW);
      const dampMag = Math.max(0, inwardVel) * WALL.damper;
      const forceMag = pen * WALL.stiffness + dampMag;
      this._probeF.copy(this._probeDirW).multiplyScalar(-forceMag);
      body.addForceAtPoint(this._probeF, hit.point);
      if (pen > WALL.probeRange * WALL.clampPenFrac) {
        const vInto = body.vel.dot(this._probeDirW);
        if (vInto > 0) body.vel.addScaledVector(this._probeDirW, -vInto);
      }
    }
  }

  _applyAero() {
    const v = this.body.vel;
    const sp = v.length();
    if (sp < 1e-3) return;
    if (AERO.drag > 0) {
      this._aeroF.copy(v).multiplyScalar(-AERO.drag * sp); // -drag·sp·v  (∝ sp²)
      this.body.addForce(this._aeroF);
    }
    if (AERO.downforce > 0) {
      this._aeroUp.set(0, 1, 0).applyQuaternion(this.body.quat);
      this._aeroF.copy(this._aeroUp).multiplyScalar(-AERO.downforce * sp * sp);
      this.body.addForce(this._aeroF); // along -chassis-up → presses onto track
    }
  }

  _applyDeckContact() {
    const body = this.body;
    const skin = DECK.skin;
    for (const ci of this.BOTTOM_CORNERS) {
      this._cWorld.copy(this.CHASSIS_CORNERS[ci]).applyQuaternion(body.quat).add(body.pos);
      const res = this.groundBvh.closestPointWithNormal(
        this._cWorld.x, this._cWorld.y, this._cWorld.z, DECK.searchRadius, this._deckN,
      );
      if (!res) continue;
      // Signed distance from surface to corner along the (outward) normal.
      const sd =
        (this._cWorld.x - res.x) * this._deckN.x +
        (this._cWorld.y - res.y) * this._deckN.y +
        (this._cWorld.z - res.z) * this._deckN.z;
      if (sd >= skin) continue; // corner safely above the deck → wheels handle it
      const pen = skin - sd;
      body.getVelocityAtPoint(this._cWorld, this._cVel);
      const inward = -this._cVel.dot(this._deckN);
      const dampMag = Math.max(0, inward) * DECK.damper;
      const forceMag = pen * DECK.stiffness + dampMag;
      this._cF.copy(this._deckN).multiplyScalar(forceMag);
      body.addForceAtPoint(this._cF, this._cWorld);
    }
  }

  _resolveSolids() {
    const body = this.body;
    const r = SOLID.radius;
    for (const sp of this.SOLID_SAMPLES) {
      this._sphC.copy(sp).applyQuaternion(body.quat).add(body.pos);
      const res = this.solidsBvh.closestPointToPoint(this._sphC.x, this._sphC.y, this._sphC.z, r);
      if (!res) continue;
      const pen = r - res.distance;
      if (pen <= 0) continue;
      this._sphN.set(this._sphC.x - res.x, this._sphC.y - res.y, this._sphC.z - res.z);
      const d = this._sphN.length();
      if (d < 1e-6) continue;
      this._sphN.multiplyScalar(1 / d); // outward (away from surface)
      body.getVelocityAtPoint(this._sphC, this._sphV);
      const inward = -this._sphV.dot(this._sphN); // >0 → moving into the surface
      const dampMag = Math.max(0, inward) * SOLID.damper;
      const forceMag = pen * SOLID.stiffness + dampMag;
      this._sphF.copy(this._sphN).multiplyScalar(forceMag);
      body.addForceAtPoint(this._sphF, this._sphC);
      // Kill remaining inward velocity on deep penetration to stop tunneling.
      if (pen > r * SOLID.clampPenFrac) {
        const vInto = body.vel.dot(this._sphN);
        if (vInto < 0) body.vel.addScaledVector(this._sphN, -vInto);
      }
    }
  }

  _depenetrateFromWalls() {
    const c = this.body.pos;
    for (const box of this.wallBoxes) {
      if (c.x < box.min.x || c.x > box.max.x) continue;
      if (c.y < box.min.y || c.y > box.max.y) continue;
      if (c.z < box.min.z || c.z > box.max.z) continue;
      const dxMin = c.x - box.min.x, dxMax = box.max.x - c.x;
      const dzMin = c.z - box.min.z, dzMax = box.max.z - c.z;
      let minD = dxMin;
      this._depenDir.set(-1, 0, 0);
      if (dxMax < minD) { minD = dxMax; this._depenDir.set(1, 0, 0); }
      if (dzMin < minD) { minD = dzMin; this._depenDir.set(0, 0, -1); }
      if (dzMax < minD) { minD = dzMax; this._depenDir.set(0, 0, 1); }
      c.addScaledVector(this._depenDir, minD + 0.05);
      const vDot = this.body.vel.dot(this._depenDir);
      if (vDot < 0) this.body.vel.addScaledVector(this._depenDir, -vDot);
    }
  }

  _syncVisuals(dt) {
    const body = this.body;
    this.chassisMesh.position.copy(body.pos);
    if (CHASSIS.visualLift !== 0) {
      this._wheelUp.set(0, 1, 0).applyQuaternion(body.quat);
      this.chassisMesh.position.addScaledVector(this._wheelUp, CHASSIS.visualLift);
    }
    this.chassisMesh.quaternion.copy(body.quat);

    const steerAngle = this._steerAngle();
    for (let i = 0; i < this.tires.length; i++) {
      const t = this.tires[i];
      const cfg = WHEEL_LOCAL[i];
      this._wheelUp.copy(this._yAxis).applyQuaternion(body.quat);
      const targetDist = t.grounded ? t.hitDistance : TIRE.rayLength;
      if (t._smoothDist === undefined) t._smoothDist = targetDist;
      const k = 1 - Math.exp(-TIRE.suspVisSmooth * dt);
      t._smoothDist += (targetDist - t._smoothDist) * k;
      const suspExt = Math.max(0, t._smoothDist - WHEEL.radius);
      this._wheelOffset.copy(this._wheelUp).multiplyScalar(-suspExt);
      this.tireGroups[i].position.copy(t.worldPos).add(this._wheelOffset);

      this._wheelFwdWorld.copy(this._zAxis).applyQuaternion(body.quat);
      if (cfg.steer && steerAngle !== 0) {
        this._steerLocalQ.setFromAxisAngle(this._wheelUp, steerAngle);
        this._wheelFwdWorld.applyQuaternion(this._steerLocalQ);
      }
      body.getVelocityAtPoint(t.worldPos, this._wheelTireVel);
      const omega = this._wheelTireVel.dot(this._wheelFwdWorld) / WHEEL.radius;
      this.wheelSpin[i] += omega * dt;
      if (this.wheelSpin[i] > Math.PI * 2) this.wheelSpin[i] -= Math.PI * 2;
      else if (this.wheelSpin[i] < -Math.PI * 2) this.wheelSpin[i] += Math.PI * 2;

      this._spinLocalQ.setFromAxisAngle(this._xAxis, this.wheelSpin[i]);
      if (cfg.steer) {
        this._steerLocalQ.setFromAxisAngle(this._yAxis, steerAngle);
        this.tireGroups[i].quaternion.multiplyQuaternions(body.quat, this._steerLocalQ).multiply(this._spinLocalQ);
      } else {
        this.tireGroups[i].quaternion.multiplyQuaternions(body.quat, this._spinLocalQ);
      }

      if (this.arrowGroup.visible) {
        const a = this.arrows[i];
        this._placeArrow(a.up, t.worldPos, t.lastSuspension);
        this._placeArrow(a.side, t.worldPos, t.lastSteering);
        this._placeArrow(a.fwd, t.worldPos, t.lastAccel);
      }
    }
  }

  _placeArrow(arrow, origin, force) {
    const mag = force.length();
    if (mag < 1e-3) {
      arrow.setLength(0.001, 0.001, 0.001);
      return;
    }
    this._arrowDir.copy(force).normalize();
    arrow.position.copy(origin);
    arrow.setDirection(this._arrowDir);
    const visLen = Math.min(3.5, mag * 0.0008);
    arrow.setLength(visLen, Math.min(0.25, visLen * 0.18), Math.min(0.16, visLen * 0.12));
  }

  /** Signed km/h forward speed for a HUD. */
  get speedKmh() {
    return this.body.vel.length() * 3.6;
  }

  get groundedCount() {
    return this.tires.reduce((n, t) => n + (t.grounded ? 1 : 0), 0);
  }
}
