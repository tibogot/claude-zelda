/**
 * PaintSystem — brush stamps into SplatStore chunks with undo/redo.
 *
 * Mirrors `SculptSystem`: `beginStroke → applyAt(*) → endStroke` with spacing
 * throttling and a 64-step undo stack. Strokes accumulate per-chunk before/after
 * buffers so painting across multiple chunks is a single undo step.
 */
import * as THREE from "three";
import { shouldApplyStroke } from "../sculpt/brushModel.js";
import { chunkKey } from "../../core/terrain/chunkMath.js";

export class PaintSystem {
  constructor({ toolState, splatStore, config, brushMask }) {
    this.toolState = toolState;
    this.splatStore = splatStore;
    this.config = config;
    /** @type {import('../../core/paint/brushMask.js').BrushMask|null} */
    this.brushMask = brushMask ?? null;
    this.isPainting = false;
    this.lastStrokePoint = null;
    this._strokeDirection = 0;
    /** @type {Map<string, Uint8Array>} */
    this.beforeMap = new Map();
    /** @type {Map<string, Uint8Array>} */
    this.afterMap = new Map();
    /** @type {{ before: Map<string, Uint8Array>, after: Map<string, Uint8Array> }[]} */
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Snapshot splat data of chunks the brush footprint overlaps (pre-paint). */
  _snapshotAffectedChunks(worldX, worldZ, radius) {
    const affected = this.splatStore.getChunkIndicesInBounds(
      worldX - radius,
      worldZ - radius,
      worldX + radius,
      worldZ + radius,
    );
    for (const { cx, cz } of affected) {
      const entry = this.splatStore.ensureChunkSplat(cx, cz);
      const key = chunkKey(cx, cz);
      if (!this.beforeMap.has(key)) {
        this.beforeMap.set(key, new Uint8Array(entry.data));
      }
    }
  }

  beginStroke(hitPoint, event = {}) {
    this.isPainting = true;
    this.lastStrokePoint = null;
    this.beforeMap.clear();
    this.afterMap.clear();
    this.applyAt(hitPoint, event);
  }

  applyAt(hitPoint, event = {}) {
    if (!this.isPainting) return;
    const brush = this.toolState.brush;
    if (
      !shouldApplyStroke(this.lastStrokePoint, hitPoint, brush.radius, brush.spacingFactor)
    ) {
      return;
    }
    if (this.lastStrokePoint) {
      const dx = hitPoint.x - this.lastStrokePoint.x;
      const dz = hitPoint.z - this.lastStrokePoint.z;
      if (dx * dx + dz * dz > 0.01) {
        this._strokeDirection = Math.atan2(dz, dx);
      }
    }

    this.lastStrokePoint = this.lastStrokePoint ?? new THREE.Vector3();
    this.lastStrokePoint.copy(hitPoint);

    this._snapshotAffectedChunks(hitPoint.x, hitPoint.z, brush.radius);

    /** Alt → eraser (shortcut), else the selected active layer. */
    const requestedLayer = this.toolState.paint.activeLayer;
    const activeLayer = event.altKey ? 0 : requestedLayer;

    const strength = THREE.MathUtils.clamp(
      brush.strength * this.config.paint.brushOpacity,
      0,
      1,
    );

    const paint = this.toolState.paint;

    let maskData = null;
    let maskSize = 0;
    let maskRotation = 0;
    const bm = this.brushMask;
    if (bm && bm.active && bm.data) {
      maskData = bm.data;
      maskSize = bm.size;
      const baseDeg = paint.maskRotation ?? 0;
      const baseRad = (baseDeg * Math.PI) / 180;
      if (paint.maskRandomRotation) {
        maskRotation = Math.random() * Math.PI * 2;
      } else if (paint.maskFollowStroke) {
        maskRotation = this._strokeDirection + baseRad;
      } else {
        maskRotation = baseRad;
      }
    }

    this.splatStore.applySplatStroke({
      cx: hitPoint.x,
      cz: hitPoint.z,
      radius: brush.radius,
      strength,
      falloff: brush.falloff,
      activeLayer,
      noiseMask: paint.noiseMask,
      noiseScale: paint.noiseScale,
      noiseOctaves: paint.noiseOctaves,
      noiseEdgeOnly: paint.noiseEdgeOnly,
      maskData,
      maskSize,
      maskRotation,
    });
  }

  endStroke() {
    if (!this.isPainting) return;
    this.isPainting = false;
    const touched = [...this.beforeMap.keys()];
    if (touched.length === 0) return;

    for (const key of touched) {
      const entry = this.splatStore.getChunkSplatByKey(key);
      if (!entry) continue;
      this.afterMap.set(key, new Uint8Array(entry.data));
    }
    if (this.afterMap.size === 0) {
      this.beforeMap.clear();
      return;
    }
    this.undoStack.push({
      before: new Map(this.beforeMap),
      after: new Map(this.afterMap),
    });
    this.redoStack.length = 0;
    if (this.undoStack.length > 64) this.undoStack.shift();
    this.beforeMap.clear();
    this.afterMap.clear();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    this.splatStore.restoreFromSnapshot(cmd.before);
    this.redoStack.push(cmd);
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    this.splatStore.restoreFromSnapshot(cmd.after);
    this.undoStack.push(cmd);
  }

  /**
   * "Fill world with active layer" — Unity-style Fill button. Snapshots every
   * currently allocated chunk + all chunks in the world, so undo restores
   * pre-fill state across everything.
   */
  fillWithActiveLayer() {
    const activeLayer = this.toolState.paint.activeLayer;
    const before = new Map();
    for (const [key, entry] of this.splatStore.chunks) {
      before.set(key, new Uint8Array(entry.data));
    }
    this.splatStore.fillAllWithLayer(activeLayer);
    const after = new Map();
    for (const [key, entry] of this.splatStore.chunks) {
      after.set(key, new Uint8Array(entry.data));
    }
    if (before.size === 0 && after.size === 0) return;
    this.undoStack.push({ before, after });
    this.redoStack.length = 0;
    if (this.undoStack.length > 64) this.undoStack.shift();
  }

  clearAll() {
    const before = new Map();
    for (const [key, entry] of this.splatStore.chunks) {
      before.set(key, new Uint8Array(entry.data));
    }
    this.splatStore.clearAll();
    const after = new Map();
    for (const [key, entry] of this.splatStore.chunks) {
      after.set(key, new Uint8Array(entry.data));
    }
    if (before.size === 0) return;
    this.undoStack.push({ before, after });
    this.redoStack.length = 0;
    if (this.undoStack.length > 64) this.undoStack.shift();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
}
