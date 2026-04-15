import * as THREE from "three";
import { createBrushStrokeFromHit, shouldApplyStroke, worldBrushBounds } from "./brushModel.js";
import { parseChunkKey } from "../../core/terrain/chunkMath.js";

export class SculptSystem {
  constructor({ toolState, terrainStore, chunkStream }) {
    this.toolState = toolState;
    this.terrainStore = terrainStore;
    this.chunkStream = chunkStream;
    this.isSculpting = false;
    this.sign = 1;
    this.flattenTargetY = 0;
    this.lastStrokePoint = null;
    this.beforeMap = new Map();
    this.afterMap = new Map();
    this.undoStack = [];
    this.redoStack = [];
    /** Matches splatmap-chunks `sculptBrushNoiseSeed` — stable for whole LMB drag. */
    this.sessionBrushSeed = 0;
  }

  /**
   * @param {PointerEvent} event — modifiers: Shift locks raise/lower sign for the stroke (v1 `sculptSign`);
   *   Alt samples flatten height at stroke start; live Alt/Ctrl during drag handled in `applyAt`.
   */
  beginStroke(hitPoint, event = {}) {
    this.isSculpting = true;
    this.sign = event.shiftKey ? -1 : 1;
    this.lastStrokePoint = null;
    this.beforeMap.clear();
    this.afterMap.clear();
    this.sessionBrushSeed = Math.random() * 1000;
    const wantFlatten = this.toolState.sculptMode === "flatten" || !!event.altKey;
    this.flattenTargetY = wantFlatten
      ? this.terrainStore.getWorldHeight(hitPoint.x, hitPoint.z)
      : 0;
    this.applyAt(hitPoint, event);
  }

  applyAt(hitPoint, event = {}) {
    if (!this.isSculpting) return;
    if (
      !shouldApplyStroke(
        this.lastStrokePoint,
        hitPoint,
        this.toolState.brush.radius,
        this.toolState.brush.spacingFactor,
      )
    ) {
      return;
    }
    this.lastStrokePoint = this.lastStrokePoint ?? new THREE.Vector3();
    this.lastStrokePoint.copy(hitPoint);

    const stroke = createBrushStrokeFromHit({
      hitPoint,
      toolState: this.toolState,
      sign: this.sign,
      flattenTargetY: this.flattenTargetY,
      sessionBrushSeed: this.sessionBrushSeed,
      pointerEvent: event,
    });
    const touchedKeys = this.chunkStream.getChunkKeysInBrushBounds(
      stroke.minX,
      stroke.minZ,
      stroke.maxX,
      stroke.maxZ,
    );
    for (const key of touchedKeys) {
      if (!this.beforeMap.has(key)) {
        let current = this.terrainStore.getChunkHeightsByKey(key);
        if (!current) {
          const { cx, cz } = parseChunkKey(key);
          current = this.terrainStore.ensureChunkData(cx, cz);
        }
        this.beforeMap.set(key, new Float32Array(current));
      }
    }

    const dirtyRects = new Map();
    this.terrainStore.applySculptStroke(stroke, dirtyRects);
    this.chunkStream.markDirtyRects(dirtyRects);
  }

  endStroke() {
    if (!this.isSculpting) return;
    this.isSculpting = false;
    const touched = [...this.beforeMap.keys()];
    if (touched.length === 0) return;
    for (const key of touched) {
      const current = this.terrainStore.getChunkHeightsByKey(key);
      if (!current) continue;
      this.afterMap.set(key, new Float32Array(current));
    }
    if (this.afterMap.size > 0) {
      this.undoStack.push({
        before: new Map(this.beforeMap),
        after: new Map(this.afterMap),
      });
      this.redoStack.length = 0;
      if (this.undoStack.length > 64) this.undoStack.shift();
    }
    this.beforeMap.clear();
    this.afterMap.clear();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    this.terrainStore.restoreChunkHeightsFromMap(cmd.before);
    const dirty = new Set(cmd.before.keys());
    this.terrainStore.syncChunkEdgesAround(dirty);
    this.chunkStream.markDirtyFull(dirty);
    this.redoStack.push(cmd);
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    this.terrainStore.restoreChunkHeightsFromMap(cmd.after);
    const dirty = new Set(cmd.after.keys());
    this.terrainStore.syncChunkEdgesAround(dirty);
    this.chunkStream.markDirtyFull(dirty);
    this.undoStack.push(cmd);
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  getStrokeBoundsPreview(hitPoint) {
    return worldBrushBounds(hitPoint, this.toolState.brush.radius);
  }
}

