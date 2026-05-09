const CAR_HALF_WIDTH = 1.1;
const CAR_HALF_LENGTH = 2.5;
const CAR_BODY_HEIGHT = 0.8;
const CAR_RIDE_HEIGHT = 0.35;
const CAR_WHEEL_RADIUS = 0.42;
const CAR_GRAVITY = 28;
const CAR_EDGE_DROP_THRESHOLD = 0.25;
const CAR_COLLISION_SKIN = 0.08;
const CAR_MAX_SLOPE_COS = 0.5;
const CAR_SLOPE_SAMPLE_EPS = 0.5;
const CAR_STEP_OVER_HEIGHT = 1.0;
const CAR_SPHERE_RADIUS = 1.4;
const CAR_AIR_PITCH_SMOOTH = 4;

export class CarPhysics {
  constructor() {
    this.inAir = false;
    this.velY = 0;
    this.onSteepSlope = false;
    this.launchPitch = 0;
    this.airPitch = 0;
    this._prevX = 0;
    this._prevZ = 0;
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

    // Phase 1: Anti-tunneling sphere sweep along movement direction
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

    // Phase 2: Position pushout using closest-point queries
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

          // Check if this is a step-over surface (bridge/ramp)
          const topCheck = cliffBvh.raycastHeight(closest.x, closest.z);
          if (topCheck != null && topCheck <= stepOverY) continue;

          // Check if surface is mostly horizontal (floor, not wall)
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

  updateVertical(carY, groundY, prevY, dtSec, getTerrainHeight, px, pz, vx, vz, cliffBvh) {
    // Sample slope at PREVIOUS position (behind the car) for launch detection
    // When car drives off a ramp edge, current pos is past the ramp — previous pos is still on it
    const speed = Math.sqrt(vx * vx + vz * vz);
    const backDist = Math.min(CAR_HALF_LENGTH, speed * dtSec + 0.5);
    const sampleX = speed > 0.5 ? px - (vx / speed) * backDist : px;
    const sampleZ = speed > 0.5 ? pz - (vz / speed) * backDist : pz;

    const eps = CAR_SLOPE_SAMPLE_EPS;
    const hL = getTerrainHeight(sampleX - eps, sampleZ);
    const hR = getTerrainHeight(sampleX + eps, sampleZ);
    const hD = getTerrainHeight(sampleX, sampleZ - eps);
    const hU = getTerrainHeight(sampleX, sampleZ + eps);
    const inv2eps = 1 / (2 * eps);
    let nx = (hL - hR) * inv2eps;
    let nz = (hD - hU) * inv2eps;
    let nLen = Math.sqrt(nx * nx + 1 + nz * nz);
    let normalY = 1 / nLen;

    // Also sample BVH slope for ramp launch detection
    if (cliffBvh?.baked) {
      const bvhC = cliffBvh.raycastHeight(sampleX, sampleZ);
      if (bvhC != null && bvhC > hL - 2) {
        const bvhL = cliffBvh.raycastHeight(sampleX - eps, sampleZ);
        const bvhR = cliffBvh.raycastHeight(sampleX + eps, sampleZ);
        const bvhD = cliffBvh.raycastHeight(sampleX, sampleZ - eps);
        const bvhU = cliffBvh.raycastHeight(sampleX, sampleZ + eps);
        if (bvhL != null && bvhR != null && bvhD != null && bvhU != null) {
          const bnx = (bvhL - bvhR) * inv2eps;
          const bnz = (bvhD - bvhU) * inv2eps;
          const bnLen = Math.sqrt(bnx * bnx + 1 + bnz * bnz);
          const bNormalY = 1 / bnLen;
          if (bNormalY < normalY) {
            nx = bnx;
            nz = bnz;
            nLen = bnLen;
            normalY = bNormalY;
          }
        }
      }
    }

    const tooSteep = normalY < CAR_MAX_SLOPE_COS;
    this.onSteepSlope = tooSteep && !this.inAir;

    let newY = carY;
    let slideVx = 0, slideVz = 0;
    let launchVxScale = 0, launchVzScale = 0;

    if (this.inAir) {
      this.velY -= CAR_GRAVITY * dtSec;
      newY = carY + this.velY * dtSec;

      // Airborne pitch follows velocity arc: atan2(velY, horizontalSpeed)
      const hSpeed = Math.sqrt(vx * vx + vz * vz);
      const targetAirPitch = hSpeed > 1 ? Math.atan2(this.velY, hSpeed) : 0;
      this.airPitch += (targetAirPitch - this.airPitch) * (1 - Math.exp(-CAR_AIR_PITCH_SMOOTH * dtSec));

      if (newY <= groundY) {
        newY = groundY;
        this.velY = 0;
        this.inAir = false;
        this.airPitch = 0;
        this.launchPitch = 0;
      }
    } else {
      this.airPitch = 0;
      const drop = prevY - groundY;
      if (drop > CAR_EDGE_DROP_THRESHOLD) {
        this.inAir = true;
        const speed = Math.sqrt(vx * vx + vz * vz);
        if (speed > 1 && nLen > 1.01) {
          // Slope surface tangent in the car's movement direction
          // Normal is (nx/nLen, 1/nLen, nz/nLen). The slope "up" direction
          // is the tangent along the steepest ascent projected from the velocity.
          const slopeGradX = nx / nLen;
          const slopeGradZ = nz / nLen;

          // How much the car's velocity aligns with the uphill direction
          const alignment = (vx * slopeGradX + vz * slopeGradZ) / speed;
          const clampedAlign = Math.max(0, alignment);

          // Slope angle
          const slopeAngle = Math.acos(Math.min(1, normalY));

          // Launch: decompose speed into slope-parallel components
          // velY = upward component from slope
          // Horizontal speed is reduced (cos) because energy goes into vertical
          this.velY = speed * Math.sin(slopeAngle) * clampedAlign;
          const horizScale = 1 - (1 - Math.cos(slopeAngle)) * clampedAlign * 0.5;
          launchVxScale = horizScale;
          launchVzScale = horizScale;

          // Store launch pitch for the visual (nose up at launch)
          this.launchPitch = -slopeAngle * clampedAlign;
          this.airPitch = this.launchPitch;
        } else {
          this.velY = 0;
          this.launchPitch = 0;
        }
        newY = prevY;
      } else if (tooSteep) {
        slideVx = (nx / nLen) * CAR_GRAVITY * 0.5 * dtSec;
        slideVz = (nz / nLen) * CAR_GRAVITY * 0.5 * dtSec;
        newY = groundY;
      } else {
        newY = groundY;
      }
    }

    return { y: newY, slideVx, slideVz, tooSteep, launchVxScale, launchVzScale, slopeX: nx / nLen, slopeZ: nz / nLen };
  }
}
