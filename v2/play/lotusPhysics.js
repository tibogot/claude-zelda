export const DEFAULT_LOTUS_PHYSICS_PARAMS = {
  accel: 34,
  accelBoost: 62,
  brake: 30,
  reverseAccel: 10,
  maxSpeed: 58,
  maxSpeedBoost: 88,
  coast: 1.0,
  drag: 0.0035,
  handbrakeDecel: 4,

  baseAccelLowSpeedMul: 0.55,
  baseAccelRampToKmh: 120,

  turnRate: 1.2,
  turnRateDrift: 2.4,
  turnRateCounter: 1.6,

  gripBase: 14,
  gripSpeedDecay: 0.12,
  gripMinSpeed: 4.0,
  gripHandbrake: 0.6,
  gripCounterBonus: 3.0,
  gripBrakeTurn: 1.8,
  gripRecoveryRate: 8.0,
  gripHandbrakeApplyRate: 8.0,

  driftEntrySpeed: 10,
  driftAngleMin: 0.08,
  driftAngleExit: 0.04,

  driftBoostBuildRate: 1.0,
  driftBoostMax: 1.0,
  driftBoostAngleMin: 0.15,
  driftBoostAngleMax: 0.8,
  driftBoostAnglePenaltyEnd: 1.2,
  driftBoostSpeedAdd: 15,
  driftBoostDuration: 1.5,
  driftBoostQualifyTime: 0.5,

  bodyRollMax: 0.15,
  bodyPitchMax: 0.18,
  bodySmooth: 6,

  wheelRadius: 0.38,

  nitroAccelBonus: 24,
  nitroMaxSpeedBonus: 28,
  nitroDrainPerSec: 0.28,
  nitroRegenPerSec: 0.16,
  nitroMinToUse: 0.05,

  boostBlendSmooth: 12,
  nitroFxBlendSmooth: 16,

  gravity: 28,
  rideHeight: 0.35,
  groundSmooth: 20,
  maxSlopeCos: 0.5,
  wheelBase: 1.9,
  track: 1.1,
};

function _expSmooth(current, target, dtSec, rate) {
  return current + (target - current) * (1 - Math.exp(-rate * dtSec));
}

function _smoothstep(x, edge0, edge1) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class LotusPhysics {
  constructor() {
    this.params = { ...DEFAULT_LOTUS_PHYSICS_PARAMS };
    this.velY = 0;
    this.inAir = false;
    this.onSteepSlope = false;
    this._smoothGroundY = null;

    this._handbrakeBlend = 0;
    this._driftTime = 0;
    this.driftBoostMeter = 0;
    this._driftBoostActive = false;
    this._driftBoostRemaining = 0;
    this._driftBoostPower = 0;
    this._wasDrifting = false;
  }

  getGroundHeight(px, pz, carY, getTerrainHeight, cliffBvh) {
    let h = getTerrainHeight(px, pz);
    if (cliffBvh?.baked) {
      const bvhY = cliffBvh.raycastHeight(px, pz);
      if (bvhY != null && bvhY > h && bvhY <= carY + 4.0) {
        h = bvhY;
      }
    }
    return h;
  }

  updateGroundFollow(px, pz, bodyY, heading, scaleFactor, dtSec, getTerrainHeight, cliffBvh, vx, vz) {
    const p = this.params;
    const sf = scaleFactor;
    const rideOffset = p.rideHeight * sf;

    const centerGroundH = this.getGroundHeight(px, pz, bodyY, getTerrainHeight, cliffBvh);

    if (this._smoothGroundY === null) {
      this._smoothGroundY = centerGroundH;
    }

    this._smoothGroundY = _expSmooth(this._smoothGroundY, centerGroundH, dtSec, p.groundSmooth);
    if (this._smoothGroundY < centerGroundH) {
      this._smoothGroundY = centerGroundH;
    }

    this.velY -= p.gravity * dtSec;
    let newY = bodyY + this.velY * dtSec;

    if (newY < centerGroundH) {
      newY = centerGroundH;
      if (this.velY < 0) this.velY = 0;
      this.inAir = false;
    } else if (newY > centerGroundH + rideOffset + 0.3) {
      this.inAir = true;
    } else {
      this.inAir = false;
    }

    const sinH = Math.sin(heading);
    const cosH = Math.cos(heading);
    const halfWB = p.wheelBase * sf * 0.5;
    const halfTr = p.track * sf * 0.5;

    const fwdX = -sinH * halfWB;
    const fwdZ = -cosH * halfWB;
    const rightX = cosH * halfTr;
    const rightZ = -sinH * halfTr;

    const sampleFrontH = this.getGroundHeight(px + fwdX, pz + fwdZ, bodyY, getTerrainHeight, cliffBvh);
    const sampleRearH = this.getGroundHeight(px - fwdX, pz - fwdZ, bodyY, getTerrainHeight, cliffBvh);
    const sampleLeftH = this.getGroundHeight(px - rightX, pz - rightZ, bodyY, getTerrainHeight, cliffBvh);
    const sampleRightH = this.getGroundHeight(px + rightX, pz + rightZ, bodyY, getTerrainHeight, cliffBvh);

    const terrainPitch = Math.atan2((sampleFrontH - sampleRearH), (2 * halfWB));
    const terrainRoll = Math.atan2((sampleRightH - sampleLeftH), (2 * halfTr));

    const dHdFwd = (sampleFrontH - sampleRearH) / (2 * halfWB);
    const dHdRight = (sampleRightH - sampleLeftH) / (2 * halfTr);
    const nLenSq = dHdFwd * dHdFwd + dHdRight * dHdRight + 1;
    const nLen = Math.sqrt(nLenSq);
    const normalY = 1 / nLen;
    const tooSteep = normalY < p.maxSlopeCos;
    this.onSteepSlope = tooSteep && !this.inAir;

    const nx = dHdFwd * sinH - dHdRight * cosH;
    const nz = dHdFwd * cosH + dHdRight * sinH;

    let slideVx = 0, slideVz = 0;
    if (tooSteep && !this.inAir) {
      slideVx = (nx / nLen) * p.gravity * 0.5 * dtSec;
      slideVz = (nz / nLen) * p.gravity * 0.5 * dtSec;
    }

    return {
      y: newY,
      terrainPitch,
      terrainRoll,
      slideVx,
      slideVz,
      tooSteep,
      slopeX: nx / nLen,
      slopeZ: nz / nLen,
    };
  }

  updateDriving(state, input, dtSec) {
    const p = this.params;
    let { vx, vz, heading, nitro, drifting, driftAngle,
          boostBlend, nitroFxBlend, wheelSpin, onSteepSlope } = state;
    const { forward, backward, leftKey, rightKey,
            handbrake, nitroHeld, boostKeys } = input;

    const curSpeed = Math.sqrt(vx * vx + vz * vz);
    const hx = -Math.sin(heading);
    const hz = -Math.cos(heading);

    const nitroActive = nitroHeld && nitro > p.nitroMinToUse && !backward;

    boostBlend = _expSmooth(boostBlend, boostKeys ? 1 : 0, dtSec, p.boostBlendSmooth);
    nitroFxBlend = _expSmooth(nitroFxBlend, nitroActive ? 1 : 0, dtSec, p.nitroFxBlendSmooth);

    const accelBase = p.accel + (p.accelBoost - p.accel) * boostBlend;
    let accel = accelBase + nitroFxBlend * p.nitroAccelBonus;
    if (!boostKeys && !nitroActive) {
      const speedKmh = curSpeed * 3.6;
      const rampT = _smoothstep(speedKmh, 0, p.baseAccelRampToKmh);
      accel *= p.baseAccelLowSpeedMul + (1 - p.baseAccelLowSpeedMul) * rampT;
    }
    if (onSteepSlope) accel *= 0.1;

    if (forward) {
      vx += hx * accel * dtSec;
      vz += hz * accel * dtSec;
    } else if (backward) {
      if (curSpeed > 1) {
        vx -= hx * p.brake * dtSec;
        vz -= hz * p.brake * dtSec;
      } else {
        vx -= hx * p.reverseAccel * dtSec;
        vz -= hz * p.reverseAccel * dtSec;
      }
    } else if (curSpeed > 0.05) {
      const decel = p.coast / curSpeed;
      vx -= vx * decel * dtSec;
      vz -= vz * decel * dtSec;
    } else {
      vx = 0;
      vz = 0;
    }

    if (handbrake && curSpeed > 0.1) {
      const decel = p.handbrakeDecel / curSpeed;
      vx -= vx * decel * dtSec;
      vz -= vz * decel * dtSec;
    }

    const speed2 = vx * vx + vz * vz;
    if (speed2 > 0.01) {
      const spd = Math.sqrt(speed2);
      const dragForce = p.drag * spd;
      const factor = Math.max(0, 1 - dragForce * dtSec);
      vx *= factor;
      vz *= factor;
    }

    const maxBase = p.maxSpeed + (p.maxSpeedBoost - p.maxSpeed) * boostBlend;
    const maxSpd = maxBase + nitroFxBlend * p.nitroMaxSpeedBonus;
    const newSpeed = Math.sqrt(vx * vx + vz * vz);
    if (newSpeed > maxSpd) {
      const s = maxSpd / newSpeed;
      vx *= s;
      vz *= s;
    }

    if (nitroActive && curSpeed > 1) {
      nitro = Math.max(0, nitro - p.nitroDrainPerSec * dtSec);
    } else {
      nitro = Math.min(1, nitro + p.nitroRegenPerSec * dtSec);
    }

    let steerInput = 0;
    if (leftKey) steerInput = 1;
    if (rightKey) steerInput = -1;

    const fwdDot = vx * hx + vz * hz;
    const rx = Math.cos(heading);
    const rz = -Math.sin(heading);
    const latDot = vx * rx + vz * rz;

    let speedGrip = p.gripBase - curSpeed * p.gripSpeedDecay;
    speedGrip = Math.max(speedGrip, p.gripMinSpeed);

    if (handbrake && curSpeed > p.driftEntrySpeed && steerInput !== 0) {
      this._handbrakeBlend = _expSmooth(this._handbrakeBlend, 1.0, dtSec, p.gripHandbrakeApplyRate);
    } else {
      this._handbrakeBlend = _expSmooth(this._handbrakeBlend, 0.0, dtSec, p.gripRecoveryRate);
    }

    let grip = speedGrip + (p.gripHandbrake - speedGrip) * this._handbrakeBlend;

    const driftDir = Math.sign(latDot);
    const isCounterSteering = drifting && driftDir !== 0 && steerInput !== 0 && Math.sign(steerInput) !== Math.sign(driftDir);
    if (isCounterSteering) {
      const counterStrength = Math.min(1, Math.abs(driftAngle) / 0.5);
      grip += p.gripCounterBonus * counterStrength;
    }

    if (backward && steerInput !== 0 && curSpeed > 3) {
      grip = Math.min(grip, p.gripBrakeTurn);
    }

    const lateralKill = 1 - Math.exp(-grip * dtSec);
    vx -= rx * latDot * lateralKill;
    vz -= rz * latDot * lateralKill;

    if (steerInput !== 0 && curSpeed > 0.5) {
      let turnRate;
      if (drifting) {
        turnRate = isCounterSteering ? p.turnRateCounter : p.turnRateDrift;
      } else {
        turnRate = p.turnRate;
      }
      heading += steerInput * turnRate * dtSec;
    }

    const updatedLatDot = vx * rx + vz * rz;
    driftAngle = curSpeed > 1 ? Math.abs(Math.atan2(updatedLatDot, Math.abs(fwdDot))) : 0;

    if (!drifting) {
      drifting = driftAngle > p.driftAngleMin && curSpeed > p.driftEntrySpeed;
    } else {
      drifting = driftAngle > p.driftAngleExit && curSpeed > p.driftEntrySpeed * 0.5;
    }

    if (drifting && curSpeed > p.driftEntrySpeed) {
      this._driftTime += dtSec;
      if (this._driftTime > p.driftBoostQualifyTime) {
        const angleQuality = _smoothstep(
          driftAngle,
          p.driftBoostAngleMin,
          p.driftBoostAngleMax,
        );
        const anglePenalty = driftAngle > p.driftBoostAngleMax
          ? 1.0 - _smoothstep(driftAngle, p.driftBoostAngleMax, p.driftBoostAnglePenaltyEnd)
          : 1.0;
        this.driftBoostMeter = Math.min(
          p.driftBoostMax,
          this.driftBoostMeter + p.driftBoostBuildRate * angleQuality * anglePenalty * dtSec,
        );
      }
    } else {
      if (this._wasDrifting && this._driftTime > p.driftBoostQualifyTime && this.driftBoostMeter > 0.1) {
        this._driftBoostActive = true;
        this._driftBoostRemaining = p.driftBoostDuration * this.driftBoostMeter;
        this._driftBoostPower = this.driftBoostMeter;
      }
      this._driftTime = 0;
      this.driftBoostMeter = 0;
    }
    this._wasDrifting = drifting;

    if (this._driftBoostActive) {
      this._driftBoostRemaining -= dtSec;
      if (this._driftBoostRemaining <= 0) {
        this._driftBoostActive = false;
        this._driftBoostPower = 0;
      } else {
        const boostFrac = this._driftBoostRemaining / (p.driftBoostDuration * this._driftBoostPower);
        const speedBonus = p.driftBoostSpeedAdd * Math.min(1, boostFrac);
        const curHx = -Math.sin(heading);
        const curHz = -Math.cos(heading);
        vx += curHx * speedBonus * dtSec * 2;
        vz += curHz * speedBonus * dtSec * 2;
      }
    }

    const latSign = Math.sign(updatedLatDot);
    const speedForRoll = Math.sqrt(vx * vx + vz * vz);
    const driftRollSpeedGain = _smoothstep(speedForRoll, 8, 24);
    const driftRoll = -latSign * Math.min(p.bodyRollMax, driftAngle * 0.85) * driftRollSpeedGain;
    const throttlePitch = forward ? 0.045 : backward ? -0.06 : 0;
    const speedNorm = Math.min(1, curSpeed / Math.max(1, p.maxSpeed));
    const dynamicPitch = -speedNorm * 0.04;
    const _pitch = dynamicPitch + throttlePitch;
    const targetDynPitch = Math.max(-p.bodyPitchMax, Math.min(p.bodyPitchMax, _pitch));
    const targetDynRoll = drifting ? driftRoll : 0;
    const smooth = 1 - Math.exp(-p.bodySmooth * dtSec);

    wheelSpin -= (fwdDot / p.wheelRadius) * dtSec;

    return {
      vx, vz, heading, nitro, drifting, driftAngle,
      boostBlend, nitroFxBlend, wheelSpin,
      bodyRollTarget: targetDynRoll,
      bodyPitchTarget: targetDynPitch,
      bodySmooth: smooth,
      driftBoostMeter: this.driftBoostMeter,
      driftBoostActive: this._driftBoostActive,
    };
  }
}
