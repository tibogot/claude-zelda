import * as THREE from "three";

/**
 * Lap timing + checkpoint validation for the modular road's drive mode.
 *
 * Gates are derived from the placed game-line pieces (start / checkpoint /
 * finish), in track order. The first `start` piece is the lap line; every other
 * game piece is a mandatory ordered waypoint. A lap = cross the start line, pass
 * all waypoints in order, then cross the start line again.
 *
 * Crossing is a forward plane-cross: each frame we track the car's signed
 * distance to ONLY the next expected gate's plane (cheap + naturally enforces
 * order — out-of-order crossings are simply ignored). The lateral/vertical
 * window keeps a gate on a parallel piece elsewhere from firing.
 *
 * The tracker is pure logic: it never touches the vehicle. `update()` returns an
 * event when a gate is crossed; the page reacts (move the respawn point, flash a
 * message). Respawn-to-last-gate is just the page calling vehicle.setSpawn() with
 * the gate transform this tracker hands back.
 */

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _inPos = new THREE.Vector3();
const _outPos = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);

const GAME_LABEL = { start: "START", checkpoint: "CHECKPOINT", finish: "FINISH" };

/** Format seconds as m:ss.mmm (or ss.mmm under a minute). */
export function formatLapTime(t) {
  if (!Number.isFinite(t)) return "--:--.---";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const ss = s.toFixed(3).padStart(6, "0");
  return m > 0 ? `${m}:${ss}` : ss;
}

export class LapTracker {
  /** @param {{ roadWidth?: number, fallY?: number }} [o] */
  constructor({ roadWidth = 16, fallY = -30 } = {}) {
    this.halfWidth = roadWidth / 2 + 2; // a little margin past the kerbs
    this.fallY = fallY;
    /** @type {{type:string,label:string,pos:THREE.Vector3,fwd:THREE.Vector3,quat:THREE.Quaternion,yaw:number}[]} */
    this.gates = [];
    this.startIndex = -1; // which gate is the lap line
    this.reset();
  }

  /**
   * Rebuild the ordered gate list from the builder's placed pieces. Game pieces
   * are identified by id (start / checkpoint / finish) and kept in track order.
   * @param {{id:string, connectorIn:THREE.Matrix4, connectorOut:THREE.Matrix4}[]} pieces
   */
  buildGates(pieces) {
    this.gates = [];
    this.startIndex = -1;
    for (const p of pieces) {
      if (!GAME_LABEL[p.id]) continue;
      _inPos.setFromMatrixPosition(p.connectorIn);
      _outPos.setFromMatrixPosition(p.connectorOut);
      const pos = _inPos.clone().add(_outPos).multiplyScalar(0.5);
      const fwd = _outPos.clone().sub(_inPos);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const yaw = Math.atan2(fwd.x, fwd.z); // local +Z rotated by yaw → fwd
      const quat = new THREE.Quaternion().setFromAxisAngle(_yAxis, yaw);
      this.gates.push({ type: p.id, label: GAME_LABEL[p.id], pos, fwd, quat, yaw });
    }
    // Lap line = first start, else first finish, else first gate.
    this.startIndex = this.gates.findIndex((g) => g.type === "start");
    if (this.startIndex < 0) this.startIndex = this.gates.findIndex((g) => g.type === "finish");
    if (this.startIndex < 0 && this.gates.length) this.startIndex = 0;
    this.reset();
  }

  /** Clear all timing state (gates are kept). */
  reset() {
    this.running = false;
    this.currentTime = 0;
    this.lastLap = NaN;
    this.bestLap = NaN;
    this.lapCount = 0;
    this.passedThisLap = 0; // waypoints hit since the last start cross
    this.nextIndex = this.startIndex; // gate the car must cross next
    this._prevSide = 0;
    this._hasPrev = false;
    this.message = "";
    this.messageTimer = 0;
  }

  get hasCourse() {
    return this.gates.length > 0 && this.startIndex >= 0;
  }

  /** Total mandatory waypoints in one lap (everything that isn't the lap line). */
  get waypointCount() {
    return Math.max(0, this.gates.length - 1);
  }

  /** Human label for the gate the car should head to next. */
  get nextLabel() {
    if (!this.hasCourse) return "";
    const g = this.gates[this.nextIndex];
    if (!g) return "";
    if (!this.running && this.nextIndex === this.startIndex) return "Cross the START line";
    if (this.nextIndex === this.startIndex) return "Back to the LINE";
    return `${g.label} ${this.passedThisLap + 1}/${this.waypointCount}`;
  }

  /**
   * Advance one frame. Call only while driving.
   * @returns {null | {kind:"start"|"checkpoint"|"lap", gate:object, lapTime:number}}
   */
  update(dt, carPos, carVel) {
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0) this.message = "";
    }
    if (!this.hasCourse) return null;
    if (this.running) this.currentTime += dt;

    const gate = this.gates[this.nextIndex];
    // Signed distance to the gate plane along its forward normal.
    _v.copy(carPos).sub(gate.pos);
    const side = _v.dot(gate.fwd);
    const lateral = Math.abs(_v.dot(_rightOf(gate)));
    const vertical = Math.abs(_v.y);

    let event = null;
    if (this._hasPrev && this._prevSide < 0 && side >= 0) {
      // Crossed the plane front-to-back this frame. Validate the window + that we
      // actually drove through it forward (not drifting sideways across the line).
      const forwardMotion = carVel.dot(gate.fwd) > 0;
      if (lateral <= this.halfWidth && vertical <= 6 && forwardMotion) {
        event = this._cross(gate);
      }
    }
    this._prevSide = side;
    this._hasPrev = true;
    return event;
  }

  _cross(gate) {
    const isLapLine = this.nextIndex === this.startIndex;
    if (isLapLine) {
      if (!this.running) {
        // First time over the line → start the clock.
        this.running = true;
        this.currentTime = 0;
        this.passedThisLap = 0;
        this._flash("GO!");
        this._advance();
        return { kind: "start", gate, lapTime: 0 };
      }
      // Returned to the line → lap complete.
      const lapTime = this.currentTime;
      this.lastLap = lapTime;
      if (!Number.isFinite(this.bestLap) || lapTime < this.bestLap) {
        this.bestLap = lapTime;
        this._flash(`LAP ${this.lapCount + 1} — ${formatLapTime(lapTime)}  ★ BEST`);
      } else {
        this._flash(`LAP ${this.lapCount + 1} — ${formatLapTime(lapTime)}`);
      }
      this.lapCount++;
      this.currentTime = 0;
      this.passedThisLap = 0;
      this._advance();
      return { kind: "lap", gate, lapTime };
    }
    // A mandatory waypoint.
    this.passedThisLap++;
    this._advance();
    return { kind: "checkpoint", gate, lapTime: this.currentTime };
  }

  /** Move nextIndex to the following gate, wrapping back to the lap line. */
  _advance() {
    this.nextIndex = (this.nextIndex + 1) % this.gates.length;
    this._hasPrev = false; // reset the crossing baseline for the new gate
  }

  _flash(msg, secs = 2.6) {
    this.message = msg;
    this.messageTimer = secs;
  }

  /** Transform the page should respawn the car to (the last gate it cleared). */
  respawnTransform() {
    if (!this.hasCourse) return null;
    // The car is heading to nextIndex, so the last cleared gate is the one before it.
    const idx = (this.nextIndex - 1 + this.gates.length) % this.gates.length;
    const g = this.gates[idx];
    return { pos: g.pos, quat: g.quat, yaw: g.yaw };
  }
}

const _right = new THREE.Vector3();
function _rightOf(gate) {
  // Lateral axis = up × forward (gates are flat, so world-up is fine).
  return _right.crossVectors(_yAxis, gate.fwd).normalize();
}
