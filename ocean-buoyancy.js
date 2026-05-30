/**
 * Custom rigid-body boat buoyancy — VVV pattern (no Rapier).
 *
 * Multi-point hull probes sample the FFT ocean surface (ocean-fft.js) and apply
 * spring/damper forces at each probe, like wheel suspension in vvvCarPhysics.js.
 *
 * Callers provide:
 *   - surfaceQuery(x, z) → { x, y, z, nx, ny, nz }  (world surface + normal)
 *   - landQuery(x, z) → terrain Y (optional beach collision)
 */
import * as THREE from "three";
import { RigidBody } from "./v2/play/vvvCarPhysics.js";

export const BOAT_GRAVITY = 9.81;

export const DEFAULT_BOAT_HULL = {
  width: 2.6,
  height: 0.9,
  length: 7.0,
  mass: 900,
  /** Visual mesh lift above physics origin (m). */
  visualLift: 0.12,
};

export const DEFAULT_BOAT_BUOY = {
  gravity: BOAT_GRAVITY,
  /** Target submergence below the sampled surface per probe (m). */
  restDepth: 0.28,
  springStrength: 22000,
  damper: 3200,
  bottomOutThresh: 0.65,
  bottomOutMult: 6,
  /** Horizontal drag when any probe is wet (1/s). */
  linearDrag: 2.2,
  /** Angular velocity damping when wet (N·m·s/rad). */
  angularDrag: 1800,
  /** Pull hull-up toward world-up (N·m per rad tilt). */
  stabilizerStrength: 14000,
  stabilizerRollDamp: 500,
  maxAngVel: 5.5,
  /** Propulsion along hull +Z. */
  thrustForce: 14000,
  reverseForce: 5000,
  brakeForce: 9000,
  topSpeed: 14,
  powerCurveExp: 1.8,
  /** Yaw torque from steer input (N·m). */
  steerTorque: 12000,
  steerDamp: 2400,
  /** Throttle multiplier while boost input held. */
  boostMul: 1.45,
  /** Extra horizontal decel rate when handbrake held (1/s). */
  handbrakeDrag: 5.0,
  /** Land push when terrain rises above probe (N/m penetration). */
  landStiffness: 120000,
  landDamper: 8000,
  landFriction: 0.85,
};

/** Default 5 hull-bottom probes (corners + centre). */
export function createDefaultBoatProbes(hull = DEFAULT_BOAT_HULL) {
  const hw = hull.width * 0.42;
  const hl = hull.length * 0.4;
  const y = -hull.height * 0.42;
  return [
    { name: "FL", localPos: new THREE.Vector3(-hw, y, hl) },
    { name: "FR", localPos: new THREE.Vector3(hw, y, hl) },
    { name: "RL", localPos: new THREE.Vector3(-hw, y, -hl) },
    { name: "RR", localPos: new THREE.Vector3(hw, y, -hl) },
    { name: "C", localPos: new THREE.Vector3(0, y, 0) },
  ];
}

class BuoyancyProbe {
  constructor({ name, localPos, pos }) {
    this.name = name;
    this.localPos = (localPos ?? pos).clone();
    this.wet = false;
    this.compression = 0;
    this.worldPos = new THREE.Vector3();
    this.surfacePoint = new THREE.Vector3();
    this.surfaceNormal = new THREE.Vector3(0, 1, 0);
    this._probeVel = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._F = new THREE.Vector3();
  }

  /**
   * @param {RigidBody} body
   * @param {number} dt
   * @param {object} ctx
   * @param {(x:number,z:number)=>{x:number,y:number,z:number,nx:number,ny:number,nz:number}} ctx.surfaceQuery
   * @param {(x:number,z:number)=>number|null} [ctx.landQuery]
   * @param {object} ctx.buoyT
   * @param {number} ctx.seaY
   */
  apply(body, dt, ctx) {
    const { surfaceQuery, landQuery, buoyT, seaY } = ctx;

    this.worldPos.copy(this.localPos).applyQuaternion(body.quat).add(body.pos);
    body.getVelocityAtPoint(this.worldPos, this._probeVel);

    const surf = surfaceQuery(this.worldPos.x, this.worldPos.z);
    this.surfacePoint.set(surf.x, surf.y, surf.z);
    this.surfaceNormal.set(surf.nx, surf.ny, surf.nz).normalize();

    // Probe depth: positive when below the water surface along world up.
    const depth = surf.y - this.worldPos.y;
    this.compression = depth - buoyT.restDepth;
    this.wet = depth > -0.05;

    if (this.compression > 0 && this.wet) {
      this._up.copy(this.surfaceNormal);
      const normalVel = this._probeVel.dot(this._up);
      let springMag = this.compression * buoyT.springStrength;
      const ovr = this.compression - buoyT.restDepth * buoyT.bottomOutThresh;
      if (ovr > 0) {
        springMag += ovr * ovr * buoyT.springStrength * buoyT.bottomOutMult;
      }
      const buoyMag = Math.max(0, springMag - buoyT.damper * normalVel);
      this._F.copy(this._up).multiplyScalar(buoyMag);
      body.addForceAtPoint(this._F, this.worldPos);
    }

    if (landQuery) {
      const terrainY = landQuery(this.worldPos.x, this.worldPos.z);
      if (terrainY != null && terrainY > seaY - 0.5) {
        const pen = terrainY + 0.35 - this.worldPos.y;
        if (pen > 0) {
          const landVel = this._probeVel.y;
          const push = pen * buoyT.landStiffness - landVel * buoyT.landDamper;
          body.addForceAtPoint(
            this._F.set(0, Math.max(0, push), 0),
            this.worldPos,
          );
          const horiz = this._F.set(this._probeVel.x, 0, this._probeVel.z);
          if (horiz.lengthSq() > 1e-4) {
            horiz.multiplyScalar(-buoyT.landFriction * body.mass * buoyT.gravity * dt);
            body.addForce(horiz);
          }
        }
      }
    }
  }
}

const _stabUp = new THREE.Vector3();
const _stabTorque = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _dragF = new THREE.Vector3();

function applyBoatStabilizer(body, probes, buoyT) {
  if (buoyT.stabilizerStrength <= 0) return;
  let wet = 0;
  for (let i = 0; i < probes.length; i++) if (probes[i].wet) wet++;
  if (wet === 0) return;

  _stabUp.set(0, 1, 0).applyQuaternion(body.quat);
  const cosT = _stabUp.y;
  if (cosT < 0.2) return;

  const tilt = 1 - cosT;
  const k = buoyT.stabilizerStrength * tilt;
  _stabTorque.set(-_stabUp.z * k, 0, _stabUp.x * k);
  const rollDamp = buoyT.stabilizerRollDamp ?? 0;
  if (rollDamp > 0) {
    _stabTorque.x -= body.angVel.x * rollDamp;
    _stabTorque.z -= body.angVel.z * rollDamp;
  }
  body.torqueAccum.add(_stabTorque);
}

/**
 * Rigid-body boat with multi-point FFT buoyancy + optional drive input.
 */
export class OceanBoatPhysics {
  /**
   * @param {object} [opts]
   * @param {object} [opts.hull] DEFAULT_BOAT_HULL shape
   * @param {object} [opts.buoyT] DEFAULT_BOAT_BUOY shape
   * @param {Array<{name:string,pos:THREE.Vector3}>} [opts.probes]
   */
  constructor(opts = {}) {
    this.hull = { ...DEFAULT_BOAT_HULL, ...opts.hull };
    this.buoyT = { ...DEFAULT_BOAT_BUOY, ...opts.buoyT };
    this.body = new RigidBody({
      mass: this.hull.mass,
      size: this.hull,
    });
    this.probes = (opts.probes ?? createDefaultBoatProbes(this.hull)).map(
      (p) => new BuoyancyProbe(p),
    );
    this.steerAngle = 0;
    this._targetSteer = 0;
  }

  /** Place hull at world position with optional yaw (rad). */
  reset(x, y, z, yaw = 0) {
    this.body.pos.set(x, y, z);
    this.body.vel.set(0, 0, 0);
    this.body.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.body.angVel.set(0, 0, 0);
    this.body.forceAccum.set(0, 0, 0);
    this.body.torqueAccum.set(0, 0, 0);
    this.steerAngle = 0;
    this._targetSteer = 0;
  }

  /**
   * @param {number} dt
   * @param {object} ctx
   * @param {(x:number,z:number)=>object} ctx.surfaceQuery
   * @param {(x:number,z:number)=>number|null} [ctx.landQuery]
   * @param {number} [ctx.seaY=0]
   * @param {number} [ctx.throttle=-1..1]
   * @param {number} [ctx.steer=-1..1]
   */
  update(dt, ctx) {
    if (dt <= 0) return;
    const buoyT = this.buoyT;
    const body = this.body;
    const probeCtx = { ...ctx, buoyT, seaY: ctx.seaY ?? 0 };

    body.addForce(_dragF.set(0, -body.mass * buoyT.gravity, 0));

    for (let i = 0; i < this.probes.length; i++) {
      this.probes[i].apply(body, dt, probeCtx);
    }

    applyBoatStabilizer(body, this.probes, buoyT);

    let anyWet = false;
    for (let i = 0; i < this.probes.length; i++) {
      if (this.probes[i].wet) { anyWet = true; break; }
    }

    if (anyWet) {
      const horizVel = _dragF.set(body.vel.x, 0, body.vel.z);
      const spd = horizVel.length();
      if (spd > 0.01) {
        horizVel.multiplyScalar(-buoyT.linearDrag * spd * body.mass);
        body.addForce(horizVel);
      }
      body.angVel.x *= Math.max(0, 1 - buoyT.angularDrag * dt / body.mass);
      body.angVel.y *= Math.max(0, 1 - buoyT.angularDrag * 0.35 * dt / body.mass);
      body.angVel.z *= Math.max(0, 1 - buoyT.angularDrag * dt / body.mass);

      if (ctx.handbrake) {
        const hb = buoyT.handbrakeDrag * dt;
        body.vel.x *= Math.max(0, 1 - hb);
        body.vel.z *= Math.max(0, 1 - hb);
        body.angVel.y *= Math.max(0, 1 - hb * 1.5);
      }
    }

    const throttle = ctx.throttle ?? 0;
    const steerInput = ctx.steer ?? 0;
    const boost = ctx.boost ? buoyT.boostMul : 1;
    this._targetSteer = steerInput * 0.55;
    const steerSmooth = 6;
    this.steerAngle += (this._targetSteer - this.steerAngle) * (1 - Math.exp(-steerSmooth * dt));

    if (anyWet && (throttle !== 0 || steerInput !== 0)) {
      _fwd.set(0, 0, 1).applyQuaternion(body.quat);
      _right.set(1, 0, 0).applyQuaternion(body.quat);

      const fwdSpeed = body.vel.dot(_fwd);
      let thrust = 0;
      if (throttle > 0) {
        const norm = Math.min(1, Math.abs(fwdSpeed) / buoyT.topSpeed);
        const power = Math.max(0, 1 - Math.pow(norm, buoyT.powerCurveExp));
        thrust = buoyT.thrustForce * throttle * power * boost;
      } else if (throttle < 0) {
        if (fwdSpeed > 0.5) {
          thrust = -buoyT.brakeForce * (-throttle);
        } else {
          thrust = -buoyT.reverseForce * (-throttle);
        }
      }
      body.addForce(_fwd.multiplyScalar(thrust));

      const yawTorque = buoyT.steerTorque * this.steerAngle
        - buoyT.steerDamp * body.angVel.y * Math.sign(fwdSpeed + 0.01);
      body.torqueAccum.y += yawTorque;
    }

    body.capAngularVelocity(buoyT.maxAngVel);
    body.integrate(dt);
  }

  /** Copy rigid-body pose to a visual root (e.g. THREE.Group). */
  syncMesh(root) {
    root.position.copy(this.body.pos);
    root.quaternion.copy(this.body.quat);
  }
}
