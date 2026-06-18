import * as THREE from "three";

/**
 * BVH on-foot character controller — LAB MIRROR of v2/editor's real physics.
 *
 * This is a faithful copy of the editor's inline on-foot "char" path in
 * playMode.js (~5077–5442). It deliberately matches that algorithm 1:1 so the
 * lab is a true isolation of the shipping controller — NOT an improved rewrite.
 * Improvements happen on top of this baseline, in the lab, and only port back
 * to v2 when explicitly green-lit.
 *
 * Feet sit at `position.y`. Capsule uses THREE.CapsuleGeometry convention:
 * total height = capHeight (cylinder) + 2*capRadius (end caps).
 *
 * Collider contract (the editor's CliffBvh surface — supply any object with):
 *   .baked
 *   raycastHeightFrom(x, fromY, z)            -> groundY | null   (down cast)
 *   raycastLateral(ox, oy, oz, dx, dz, maxD)  -> { normal } | null (wall)
 *   raycastUp(x, y, z, maxD)                   -> ceilY | null     (ceiling)
 */

/** Mirrors the editor constants: CAP_R/CAP_H + CHAR_* at playMode.js:67-87. */
export const DEFAULT_ON_FOOT_PARAMS = {
  capRadius: 0.4, // CAP_R
  capHeight: 1.2, // CAP_H (cylinder section)

  walkSpeed: 4.0, // CHAR_WALK_SPEED
  runSpeed: 8.0, // CHAR_RUN_SPEED
  crouchSpeedMult: 0.5, // crouch = walk * 0.5

  jumpVel: 11.0, // CHAR_JUMP_VEL
  gravity: 20.0, // CHAR_GRAVITY
  glideFallSpeed: 3.0, // CHAR_GLIDE_FALL_SPEED (terminal fall while gliding)

  /** Ground ray starts this far above the feet (editor stepUp = 1.0). */
  groundStepUp: 1.0,
  /** Walk-off: if ground drops more than this in one frame, go airborne. */
  ledgeFallThreshold: 0.4,
  /** Lateral cast skin added to capsule radius (editor margin = CAP_R + 0.05). */
  wallMargin: 0.05,
  /** Yaw smoothing rate toward movement direction (editor uses 14). */
  yawLerpRate: 14,
};

function mergeParams(overrides = {}) {
  return { ...DEFAULT_ON_FOOT_PARAMS, ...overrides };
}

export class OnFootController {
  /** @param {Partial<typeof DEFAULT_ON_FOOT_PARAMS>} [params] */
  constructor(params = {}) {
    this.params = mergeParams(params);
    /** Feet position — bottom of capsule. */
    this.position = new THREE.Vector3();
    this.velY = 0;
    this.yaw = 0;
    this.inAir = false;
    this.grounded = true;
    this.crouching = false;
    this.gliding = false;
    this._spacePrev = false;

    /** Read-only HUD snapshot (refreshed each step). */
    this.debug = {
      groundY: 0,
      moveSpeed: 0,
      blocked: false,
    };
  }

  setParams(patch) {
    Object.assign(this.params, patch);
  }

  getCapsuleDims() {
    return { radius: this.params.capRadius, height: this.params.capHeight };
  }

  /** World Y of capsule geometric center (for mesh placement). */
  getCapsuleCenterY() {
    const { radius, height } = this.getCapsuleDims();
    return this.position.y + radius + height * 0.5;
  }

  reset(x, y, z) {
    this.position.set(x, y, z);
    this.velY = 0;
    this.inAir = false;
    this.grounded = true;
    this.gliding = false;
    this._spacePrev = false;
  }

  /**
   * @param {number} dtSec
   * @param {{
   *   input: { mx:number, mz:number, jump:boolean, run:boolean, crouch:boolean },
   *   collider: object | null,
   *   getTerrainHeight: (x:number, z:number) => number,
   *   worldHalf?: number,
   * }} ctx
   */
  update(dtSec, ctx) {
    const p = this.params;
    const { input, collider, getTerrainHeight } = ctx;
    const worldHalf = ctx.worldHalf ?? Infinity;
    dtSec = Math.min(dtSec, 0.05);

    const mx = input.mx || 0;
    const mz = input.mz || 0;
    const mlen = Math.hypot(mx, mz);

    // Crouch only when grounded (editor: !charInAir && Ctrl). Visual/collision
    // capsule size is unchanged — crouch only scales speed, like the editor.
    this.crouching = !!input.crouch && !this.inAir;

    const moveSpeed = this.crouching
      ? p.walkSpeed * p.crouchSpeedMult
      : input.run
        ? p.runSpeed
        : p.walkSpeed;

    const capR = p.capRadius;
    const capH = p.capHeight;

    // ── Horizontal move + wall slide (mirror playMode.js:5094-5209) ──────────
    this.debug.blocked = false;
    if (mlen > 0) {
      let stepX = (mx / mlen) * moveSpeed * dtSec;
      let stepZ = (mz / mlen) * moveSpeed * dtSec;

      if (collider?.baked) {
        const margin = capR + p.wallMargin;
        const stepLen = Math.hypot(stepX, stepZ);
        const castDist = stepLen + margin;
        const px = this.position.x;
        const pz = this.position.z;
        const footY = this.position.y + capR;
        const waistY = this.position.y + capR + capH * 0.5;
        const headY = this.position.y + capR + capH;
        const rayHeights = [footY, waistY, headY];

        for (let ri = 0; ri < 3; ri++) {
          const hit = collider.raycastLateral(
            px,
            rayHeights[ri],
            pz,
            stepX,
            stepZ,
            castDist,
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
                const slideHit = collider.raycastLateral(
                  px,
                  rayHeights[ri],
                  pz,
                  stepX,
                  stepZ,
                  Math.hypot(stepX, stepZ) + margin,
                );
                if (slideHit) {
                  stepX = 0;
                  stepZ = 0;
                  this.debug.blocked = true;
                }
                break;
              }
            }
          }
        }
      }

      this.position.x = THREE.MathUtils.clamp(
        this.position.x + stepX,
        -worldHalf,
        worldHalf,
      );
      this.position.z = THREE.MathUtils.clamp(
        this.position.z + stepZ,
        -worldHalf,
        worldHalf,
      );
    }

    // ── Ground height (mirror playMode.js:5215-5232) ─────────────────────────
    const terrainY = getTerrainHeight(this.position.x, this.position.z);
    let groundY = terrainY;
    if (collider?.baked) {
      const fromY = this.position.y + p.groundStepUp;
      const bvhY = collider.raycastHeightFrom(
        this.position.x,
        fromY,
        this.position.z,
      );
      // Player underneath the terrain surface (cave) → BVH is the only ground.
      if (terrainY > fromY) groundY = bvhY ?? terrainY;
      else if (bvhY != null && bvhY > terrainY) groundY = bvhY;
    }
    this.debug.groundY = groundY;
    const prevY = this.position.y;

    // ── Glide toggle: rising-edge Space while airborne (BEFORE jump) ─────────
    const spaceEdge = !!input.jump && !this._spacePrev;
    if (spaceEdge && this.inAir) this.gliding = !this.gliding;

    // ── Jump (level-triggered, gated to grounded) ────────────────────────────
    if (!this.inAir && !this.crouching && input.jump) {
      this.velY = p.jumpVel;
      this.inAir = true;
    }
    this._spacePrev = !!input.jump;

    // ── Vertical (mirror playMode.js:5349-5419) ──────────────────────────────
    if (this.inAir) {
      this.velY -= p.gravity * dtSec;
      if (this.gliding) this.velY = Math.max(this.velY, -p.glideFallSpeed);
      this.position.y = prevY + this.velY * dtSec;

      if (this.velY > 0 && collider?.baked) {
        const headTop = this.position.y + capR * 2 + capH;
        const ceilY = collider.raycastUp(
          this.position.x,
          headTop,
          this.position.z,
          this.velY * dtSec + 0.1,
        );
        if (ceilY != null) {
          this.position.y = ceilY - capR * 2 - capH;
          this.velY = 0;
        }
      }

      if (this.position.y <= groundY) {
        this.position.y = groundY;
        this.velY = 0;
        this.inAir = false;
        this.gliding = false;
        this.grounded = true;
      } else {
        this.grounded = false;
      }
    } else {
      const drop = prevY - groundY;
      if (drop > p.ledgeFallThreshold) {
        this.inAir = true;
        this.velY = 0;
        this.position.y = prevY;
        this.grounded = false;
      } else {
        this.position.y = groundY;
        this.grounded = true;
      }
    }

    // ── Yaw toward movement (mirror playMode.js:5431-5442) ───────────────────
    if (mlen > 0) {
      const targetYaw = Math.atan2(mx, mz);
      let dYaw = targetYaw - this.yaw;
      while (dYaw > Math.PI) dYaw -= 2 * Math.PI;
      while (dYaw < -Math.PI) dYaw += 2 * Math.PI;
      this.yaw += dYaw * (1 - Math.exp(-p.yawLerpRate * dtSec));
    }

    this.debug.moveSpeed = mlen > 0 ? moveSpeed : 0;
  }
}
