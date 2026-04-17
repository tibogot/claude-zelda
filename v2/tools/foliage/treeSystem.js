/**
 * TreeSystem — brush-based tree scattering and erasing with undo/redo.
 *
 * LMB: scatter trees of the active slot within the brush radius.
 * Alt+LMB: erase trees within the brush radius.
 * Follows the same beginStroke → applyAt → endStroke pattern as SculptSystem/PaintSystem.
 */
import * as THREE from "three";
import { shouldApplyStroke } from "../sculpt/brushModel.js";

export class TreeSystem {
  constructor({ toolState, treeStore, terrainStore, config }) {
    this.toolState = toolState;
    this.treeStore = treeStore;
    this.terrainStore = terrainStore;
    this.config = config;
    this.isPlacing = false;
    this.lastStrokePoint = null;
    /** @type {Map<string, Array>} */
    this.beforeMap = new Map();
    /** @type {{ before: Map, after: Map }[]} */
    this.undoStack = [];
    this.redoStack = [];
  }

  _snapshotAffected(wx, wz, radius) {
    const keys = this.treeStore.getChunkKeysInRadius(wx, wz, radius);
    for (const key of keys) {
      if (!this.beforeMap.has(key)) {
        const trees = this.treeStore.chunks.get(key);
        this.beforeMap.set(key, trees ? trees.map((t) => ({ ...t })) : []);
      }
    }
  }

  beginStroke(hitPoint, event = {}) {
    this.isPlacing = true;
    this.lastStrokePoint = null;
    this.beforeMap.clear();
    this.applyAt(hitPoint, event);
  }

  applyAt(hitPoint, event = {}) {
    if (!this.isPlacing) return;
    const brush = this.toolState.brush;
    if (
      !shouldApplyStroke(this.lastStrokePoint, hitPoint, brush.radius, brush.spacingFactor)
    ) {
      return;
    }
    this.lastStrokePoint = this.lastStrokePoint ?? new THREE.Vector3();
    this.lastStrokePoint.copy(hitPoint);

    const radius = brush.radius;
    this._snapshotAffected(hitPoint.x, hitPoint.z, radius);

    const isErase = event.altKey || this.toolState.treePaint.activeSlot < 0;

    if (isErase) {
      this.treeStore.removeTreesInRadius(hitPoint.x, hitPoint.z, radius);
    } else {
      this._scatter(hitPoint.x, hitPoint.z, radius);
    }
  }

  _scatter(wx, wz, radius) {
    const tp = this.toolState.treePaint;
    const slotIdx = tp.activeSlot;
    const spacing = tp.minSpacing;
    const area = Math.PI * radius * radius;
    const attempts = Math.ceil(area * tp.density * 0.01);

    for (let i = 0; i < attempts; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const tx = wx + Math.cos(angle) * r;
      const tz = wz + Math.sin(angle) * r;

      // Bounds check
      const halfW = this.config.world.size * 0.5;
      if (tx < -halfW || tx > halfW || tz < -halfW || tz > halfW) continue;

      if (this.treeStore.hasTreeNearby(tx, tz, spacing)) continue;

      const rotY = tp.randomRotation ? Math.random() * Math.PI * 2 : 0;
      const scale =
        tp.scaleMin + Math.random() * (tp.scaleMax - tp.scaleMin);
      const y = this.terrainStore.getWorldHeight(tx, tz);
      this.treeStore.addTree(tx, tz, y, rotY, scale, slotIdx);
    }
  }

  endStroke() {
    if (!this.isPlacing) return;
    this.isPlacing = false;
    const touchedKeys = [...this.beforeMap.keys()];
    if (touchedKeys.length === 0) return;

    const afterMap = new Map();
    for (const key of touchedKeys) {
      const trees = this.treeStore.chunks.get(key);
      afterMap.set(key, trees ? trees.map((t) => ({ ...t })) : []);
    }

    this.undoStack.push({ before: new Map(this.beforeMap), after: afterMap });
    this.redoStack.length = 0;
    if (this.undoStack.length > 64) this.undoStack.shift();
    this.beforeMap.clear();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    this.treeStore.restoreFromSnapshot(cmd.before);
    this.redoStack.push(cmd);
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    this.treeStore.restoreFromSnapshot(cmd.after);
    this.undoStack.push(cmd);
  }

  clearAll() {
    const before = new Map();
    for (const [key, trees] of this.treeStore.chunks) {
      before.set(key, trees.map((t) => ({ ...t })));
    }
    this.treeStore.clear();
    this.undoStack.push({ before, after: new Map() });
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
