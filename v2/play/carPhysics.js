const CAR_HALF_WIDTH = 1.1;
const CAR_HALF_LENGTH = 2.5;
const CAR_BODY_HEIGHT = 0.8;
const CAR_RIDE_HEIGHT = 0.48;
const CAR_WHEEL_RADIUS = 0.42;
const CAR_WHEEL_BASE = 1.9;
const CAR_TRACK = 1.1;
const CAR_COLLISION_SKIN = 0.08;
const CAR_MAX_SLOPE_COS = 0.5;
const CAR_STEP_OVER_HEIGHT = 1.0;
const CAR_SPHERE_RADIUS = 1.4;

const CAR_GRAVITY = 28;
const CAR_MASS = 1;
const SUSP_STIFFNESS = 80;
const SUSP_DAMP_COMPRESS = 8;
const SUSP_DAMP_RELAX = 2.5;
const SUSP_MAX_TRAVEL = 0.6;
const SUSP_EQ_COMP = (CAR_MASS * CAR_GRAVITY) / (4 * SUSP_STIFFNESS);

const CAR_AIR_PITCH_SMOOTH = 4;
const CAR_JUMP_IMPULSE = 9;

export class CarPhysics {
  constructor() {
    this.inAir = false;
    this.velY = 0;
    this.onSteepSlope = false;
    this.airPitch = 0;
    this.wheelContactYs = [0, 0, 0, 0];
    this.wheelGrounded = [true, true, true, true];
    this.wheelSuspLengths = [SUSP_EQ_COMP, SUSP_EQ_COMP, SUSP_EQ_COMP, SUSP_EQ_COMP];
    this._prevGroundYs = [0, 0, 0, 0];
    this._initialized = false;
  }

  getWheelGroundHeight(wx, wz, carY, getTerrainHeight, cliffBvh) {
    let h = getTerrainHeight(wx, wz);
    if (cliffBvh?.baked) {
      const bvhH = cliffBvh.raycastHeight(wx, wz);
      if (bvhH != null && bvhH > h) {
        h = bvhH;
      }
    }
    return h;
  }

  getGroundHeight(px, pz, carY, getTerrainHeight, cliffBvh) {
    const terrainY = getTerrainHeight(px, pz);
    let groundY = terrainY;
    if (cliffBvh?.baked) {
      const bvhY = cliffBvh.raycastHeight(px, pz);
      if (bvhY != null && bvhY > terrainY && bvhY <= carY + 4.0) {
        groundY = bvhY;
      }
    }
    return groundY;
  }

  resolveMovement(px, pz, stepX, stepZ, carY, heading, vx, vz, cliffBvh) {
    if (!cliffBvh?.baked) return { x: px + stepX, z: pz + stepZ, vx, vz };

    const fwdX = -Math.sin(heading);
    const fwdZ = -Math.cos(heading);
    const rightX = Math.cos(heading);
    const rightZ = -Math.sin(heading);

    const baseStepLen = Math.hypot(stepX, stepZ);
    let finalStepX = stepX;
    let finalStepZ = stepZ;
    let finalVx = vx;
    let finalVz = vz;

    if (baseStepLen > 0.01) {
      const sweepResult = cliffBvh.spherecast(
        px, carY + CAR_RIDE_HEIGHT + CAR_SPHERE_RADIUS,
        pz, CAR_SPHERE_RADIUS,
        stepX, 0, stepZ,
        baseStepLen + CAR_HALF_LENGTH,
      );
      if (sweepResult) {
        const topY = cliffBvh.raycastHeight(sweepResult.point.x, sweepResult.point.z);
        const isStepOver = topY != null && topY <= carY + CAR_STEP_OVER_HEIGHT;
        if (!isStepOver) {
          const safeDist = Math.max(0, sweepResult.distance - CAR_HALF_LENGTH - CAR_COLLISION_SKIN);
          if (safeDist < baseStepLen) {
            const ratio = safeDist / baseStepLen;
            finalStepX = stepX * ratio;
            finalStepZ = stepZ * ratio;
          }
        }
      }
    }

    let posX = px + finalStepX;
    let posZ = pz + finalStepZ;

    const probeY_low = carY + CAR_RIDE_HEIGHT + 0.15;
    const probeY_high = carY + CAR_RIDE_HEIGHT + CAR_BODY_HEIGHT;
    const stepOverY = carY + CAR_STEP_OVER_HEIGHT;

    for (let iter = 0; iter < 3; iter++) {
      let pushed = false;

      const probePoints = [
        { x: posX + fwdX * CAR_HALF_LENGTH, z: posZ + fwdZ * CAR_HALF_LENGTH },
        { x: posX - fwdX * CAR_HALF_LENGTH, z: posZ - fwdZ * CAR_HALF_LENGTH },
        { x: posX + rightX * CAR_HALF_WIDTH, z: posZ + rightZ * CAR_HALF_WIDTH },
        { x: posX - rightX * CAR_HALF_WIDTH, z: posZ - rightZ * CAR_HALF_WIDTH },
        { x: posX + fwdX * CAR_HALF_LENGTH + rightX * CAR_HALF_WIDTH, z: posZ + fwdZ * CAR_HALF_LENGTH + rightZ * CAR_HALF_WIDTH },
        { x: posX + fwdX * CAR_HALF_LENGTH - rightX * CAR_HALF_WIDTH, z: posZ + fwdZ * CAR_HALF_LENGTH - rightZ * CAR_HALF_WIDTH },
        { x: posX - fwdX * CAR_HALF_LENGTH + rightX * CAR_HALF_WIDTH, z: posZ - fwdZ * CAR_HALF_LENGTH + rightZ * CAR_HALF_WIDTH },
        { x: posX - fwdX * CAR_HALF_LENGTH - rightX * CAR_HALF_WIDTH, z: posZ - fwdZ * CAR_HALF_LENGTH - rightZ * CAR_HALF_WIDTH },
      ];

      for (const probe of probePoints) {
        for (const py of [probeY_low, probeY_high]) {
          const closest = cliffBvh.closestPointToPoint(
            probe.x, py, probe.z,
            CAR_COLLISION_SKIN + 0.5,
          );
          if (!closest) continue;

          const dx = probe.x - closest.x;
          const dy = py - closest.y;
          const dz = probe.z - closest.z;
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist >= CAR_COLLISION_SKIN + 0.3) continue;
          if (dist < 1e-6) continue;

          const topCheck = cliffBvh.raycastHeight(closest.x, closest.z);
          if (topCheck != null && topCheck <= stepOverY) continue;

          const ny = dy / dist;
          if (ny > 0.7) continue;

          const nx = dx / dist;
          const nz = dz / dist;
          const nHoriz = Math.sqrt(nx * nx + nz * nz);
          if (nHoriz < 0.01) continue;

          const nnx = nx / nHoriz;
          const nnz = nz / nHoriz;
          const pen = (CAR_COLLISION_SKIN + 0.3) - dist;
          if (pen > 0.001) {
            posX += nnx * pen * 0.6;
            posZ += nnz * pen * 0.6;
            pushed = true;

            const vDot = finalVx * nnx + finalVz * nnz;
            if (vDot < 0) {
              finalVx -= vDot * nnx;
              finalVz -= vDot * nnz;
            }
          }
        }
      }
      if (!pushed) break;
    }

    return { x: posX, z: posZ, vx: finalVx, vz: finalVz };
  }

  updateSuspension(bodyYInput, wheelWorldXZs, scaleFactor, heading, dtSec, getTerrainHeight, cliffBvh, vx, vz, jumpRequested) {
    const sf = scaleFactor;
    const rideOffset = CAR_RIDE_HEIGHT * sf;
    const restLen = rideOffset + SUSP_EQ_COMP;
    const maxTravel = SUSP_MAX_TRAVEL;

    const bodyY = bodyYInput + rideOffset;

    for (let i = 0; i < 4; i++) {
      const wx = wheelWorldXZs[i * 2];
      const wz = wheelWorldXZs[i * 2 + 1];
      let groundH = getTerrainHeight(wx, wz);
      if (cliffBvh?.baked) {
        const bvhH = cliffBvh.raycastHeight(wx, wz);
        if (bvhH != null && bvhH > groundH && bvhH <= bodyY + 4.0) groundH = bvhH;
      }
      this.wheelContactYs[i] = groundH;
    }

    if (!this._initialized) {
      for (let i = 0; i < 4; i++) this._prevGroundYs[i] = this.wheelContactYs[i];
      this._initialized = true;
    }

    let totalForce = 0;
    let groundedCount = 0;

    for (let i = 0; i < 4; i++) {
      const groundY = this.wheelContactYs[i];
      const distToGround = bodyY - groundY;
      const compression = restLen - distToGround;

      if (compression > 0) {
        this.wheelGrounded[i] = true;
        groundedCount++;

        const clampedComp = Math.min(compression, maxTravel);
        const groundVelY = (groundY - this._prevGroundYs[i]) / Math.max(dtSec, 0.001);
        const compVel = -(this.velY - groundVelY);
        const dampRate = compVel > 0 ? SUSP_DAMP_COMPRESS : SUSP_DAMP_RELAX;
        const force = SUSP_STIFFNESS * clampedComp + dampRate * compVel;
        totalForce += Math.max(0, force);
        this.wheelSuspLengths[i] = distToGround;
      } else {
        this.wheelGrounded[i] = false;
        this.wheelSuspLengths[i] = restLen;
      }
    }

    for (let i = 0; i < 4; i++) this._prevGroundYs[i] = this.wheelContactYs[i];

    if (jumpRequested && groundedCount > 0 && !this.inAir) {
      this.velY = CAR_JUMP_IMPULSE;
    }

    const weight = CAR_MASS * CAR_GRAVITY;
    const netForce = totalForce - weight;
    this.velY += (netForce / CAR_MASS) * dtSec;

    let newBodyY = bodyY + this.velY * dtSec;

    let maxGroundY = -Infinity;
    for (let i = 0; i < 4; i++) {
      if (this.wheelContactYs[i] > maxGroundY) maxGroundY = this.wheelContactYs[i];
    }
    if (newBodyY < maxGroundY) {
      newBodyY = maxGroundY;
      if (this.velY < 0) this.velY = 0;
    }

    this.inAir = groundedCount === 0;

    if (this.inAir) {
      const hSpeed = Math.sqrt(vx * vx + vz * vz);
      const targetPitch = hSpeed > 1 ? Math.atan2(this.velY, hSpeed) : 0;
      this.airPitch += (targetPitch - this.airPitch) * (1 - Math.exp(-CAR_AIR_PITCH_SMOOTH * dtSec));
    } else {
      this.airPitch *= (1 - Math.min(1, 8 * dtSec));
    }

    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const wheelBaseDist = CAR_WHEEL_BASE * sf;
    const trackDist = CAR_TRACK * sf;

    const frontAvgY = (this.wheelContactYs[0] + this.wheelContactYs[1]) * 0.5;
    const rearAvgY = (this.wheelContactYs[2] + this.wheelContactYs[3]) * 0.5;
    const leftAvgY = (this.wheelContactYs[0] + this.wheelContactYs[2]) * 0.5;
    const rightAvgY = (this.wheelContactYs[1] + this.wheelContactYs[3]) * 0.5;

    const dHdFwd = (frontAvgY - rearAvgY) / wheelBaseDist;
    const dHdRight = (rightAvgY - leftAvgY) / trackDist;
    const terrainPitch = Math.atan2(dHdFwd, 1);
    const terrainRoll = Math.atan2(dHdRight, 1);

    const nLenSq = dHdFwd * dHdFwd + dHdRight * dHdRight + 1;
    const nLen = Math.sqrt(nLenSq);
    const normalY = 1 / nLen;
    const tooSteep = normalY < CAR_MAX_SLOPE_COS;
    this.onSteepSlope = tooSteep && !this.inAir;

    const nx = dHdFwd * sinH - dHdRight * cosH;
    const nz = dHdFwd * cosH + dHdRight * sinH;

    let slideVx = 0, slideVz = 0;
    if (tooSteep && !this.inAir) {
      slideVx = (nx / nLen) * CAR_GRAVITY * 0.5 * dtSec;
      slideVz = (nz / nLen) * CAR_GRAVITY * 0.5 * dtSec;
    }

    const outputY = newBodyY - rideOffset;

    return {
      y: outputY,
      terrainPitch,
      terrainRoll,
      slideVx,
      slideVz,
      tooSteep,
      slopeX: nx / nLen,
      slopeZ: nz / nLen,
    };
  }
}
