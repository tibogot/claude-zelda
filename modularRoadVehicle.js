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
  gripFront: 1.0,
  gripRear: 1.0,
  gripHandbrake: 0.08,
  accelForce: 4000,
  topSpeed: 30,
  powerCurveExp: 2.0,
  brakeForce: 8000,
  reverseAccel: 2000,
  brakeReverseThreshold: 0.5,
  engineBrake: 800,
  maxSteerAngle: 0.55,
  steerSmooth: 8.0,
  frictionCoeff: 5.0,
  maxAngVel: 9.0,
  stabilizerStrength: 8000,
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

    this.grounded = false;
    this.compression = 0;
    this.hitDistance = TIRE.rayLength;
    this.hitPoint = new THREE.Vector3();
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
  }

  apply(body, dt, steerAngle, throttle, handbrake, raycaster, collidables) {
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
    raycaster.ray.direction.copy(this._up).multiplyScalar(-1);
    raycaster.far = TIRE.rayLength + pad;

    let bestDist = Infinity;
    let bestPoint = null;
    const sample = (ox, dirVec, off) => {
      raycaster.ray.origin.copy(this.worldPos).addScaledVector(this._up, pad);
      if (dirVec) raycaster.ray.origin.addScaledVector(dirVec, off);
      const hits = raycaster.intersectObjects(collidables, false);
      if (hits.length > 0 && hits[0].distance < bestDist) {
        bestDist = hits[0].distance;
        bestPoint = hits[0].point;
      }
    };

    sample(0, null, 0);
    if (fwdBias > 1e-4) {
      sample(0, this._wheelFwd, fwdBias);
      sample(0, this._wheelFwd, -fwdBias);
    }
    const latBias = TIRE.rayLateralBias * WHEEL.thickness * 0.5;
    if (latBias > 1e-4) {
      sample(0, this._wheelRight, latBias);
      sample(0, this._wheelRight, -latBias);
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

    // 2) Lateral grip (cancel sideways velocity, clamped by friction circle).
    const sideVel = this._tireVel.dot(this._wheelRight);
    const grip = this.canSteer ? TIRE.gripFront : handbrake ? TIRE.gripHandbrake : TIRE.gripRear;
    const desiredVelChange = -sideVel * grip;
    const tireMass = body.mass / 4;
    let steerMag = tireMass * (desiredVelChange / dt);
    const maxLat = TIRE.frictionCoeff * suspMag;
    if (steerMag > maxLat) steerMag = maxLat;
    else if (steerMag < -maxLat) steerMag = -maxLat;
    this._F.copy(this._wheelRight).multiplyScalar(steerMag);
    body.addForceAtPoint(this._F, this.worldPos);
    this.lastSteering.copy(this._F);

    // 3) Longitudinal — accel / brake / reverse / engine brake.
    if (this.canDrive) {
      let accelMag = 0;
      const carSpeed = body.vel.dot(this._fwd);
      const thr = TIRE.brakeReverseThreshold;
      if (throttle > 0) {
        if (carSpeed < -thr) {
          accelMag = TIRE.brakeForce;
        } else {
          const normSpeed = Math.min(1, Math.abs(carSpeed) / TIRE.topSpeed);
          accelMag = TIRE.accelForce * Math.max(0, 1 - Math.pow(normSpeed, TIRE.powerCurveExp));
        }
      } else if (throttle < 0) {
        if (carSpeed > thr) {
          accelMag = -TIRE.brakeForce;
        } else {
          const normSpeed = Math.min(1, Math.abs(carSpeed) / TIRE.topSpeed);
          accelMag = -TIRE.reverseAccel * Math.max(0, 1 - Math.pow(normSpeed, TIRE.powerCurveExp));
        }
      } else {
        const fwdVel = this._tireVel.dot(this._wheelFwd);
        accelMag = -Math.sign(fwdVel) * Math.min(Math.abs(fwdVel) * 200, TIRE.engineBrake);
      }
      const maxLong = TIRE.frictionCoeff * suspMag;
      if (accelMag > maxLong) accelMag = maxLong;
      if (accelMag < -maxLong) accelMag = -maxLong;
      this._F.copy(this._wheelFwd).multiplyScalar(accelMag);
      body.addForceAtPoint(this._F, this.worldPos);
      this.lastAccel.copy(this._F);
    }
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

  _physicsStep(dt) {
    const subDt = dt / this.SUBSTEPS;
    const steerAngle = this.input.steer * TIRE.maxSteerAngle;
    const body = this.body;
    for (let s = 0; s < this.SUBSTEPS; s++) {
      this._gravityF.set(0, -GRAVITY * body.mass, 0);
      body.addForce(this._gravityF);
      for (const tire of this.tires) {
        tire.apply(body, subDt, steerAngle, this.input.throttle, this.input.handbrake, this.raycaster, this.collidables);
      }
      if (this.walls.length) this._applyWallProbes();
      this._applyChassisGroundContact();
      this._applyStabilizer();
      body.integrate(subDt);
      const wMax = TIRE.maxAngVel;
      if (body.angVel.lengthSq() > wMax * wMax) body.angVel.setLength(wMax);
    }
  }

  _applyStabilizer() {
    if (TIRE.stabilizerStrength <= 0) return;
    let grounded = 0;
    for (const t of this.tires) if (t.grounded) grounded++;
    if (grounded === 0) return;
    this._stabUp.set(0, 1, 0).applyQuaternion(this.body.quat);
    const cosT = this._stabUp.y;
    if (cosT < 0.3) return;
    const k = TIRE.stabilizerStrength * (1 - cosT);
    this._stabTorque.set(-this._stabUp.z * k, 0, this._stabUp.x * k);
    this.body.torqueAccum.add(this._stabTorque);
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

    const steerAngle = this.input.steer * TIRE.maxSteerAngle;
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
