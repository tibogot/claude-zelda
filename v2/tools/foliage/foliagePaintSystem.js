/**
 * FoliagePaintSystem — brush-based billboard foliage scattering and erasing with undo/redo.
 *
 * LMB: scatter foliage of the active slot within the brush radius.
 * Alt+LMB: erase foliage within the brush radius.
 * Follows the same beginStroke → applyAt → endStroke pattern as TreeSystem.
 */
import * as THREE from "three";
import { shouldApplyStroke } from "../sculpt/brushModel.js";

export class FoliagePaintSystem {
  constructor({ toolState, foliageStore, terrainStore, config }) {
    this.toolState = toolState;
    this.foliageStore = foliageStore;
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
    const keys = this.foliageStore.getChunkKeysInRadius(wx, wz, radius);
    for (const key of keys) {
      if (!this.beforeMap.has(key)) {
        const items = this.foliageStore.chunks.get(key);
        this.beforeMap.set(key, items ? items.map((f) => ({ ...f })) : []);
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

    const isErase = event.altKey || this.toolState.foliagePaint.activeSlot < 0;

    if (isErase) {
      this.foliageStore.removeFoliageInRadius(hitPoint.x, hitPoint.z, radius);
    } else {
      this._scatter(hitPoint.x, hitPoint.z, radius);
    }
  }

  _scatter(wx, wz, radius) {
    const fp = this.toolState.foliagePaint;
    const slotIdx = fp.activeSlot;
    const slot = this.toolState.foliageSlots[slotIdx];
    if (!slot || !slot.enabled) return;

    const baseScale = slot.baseScale ?? 1.0;
    const spacing = fp.minSpacing * Math.max(baseScale, 0.1);
    const area = Math.PI * radius * radius;
    const attempts = Math.ceil(area * fp.density * 0.15);

    for (let i = 0; i < attempts; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      const tx = wx + Math.cos(angle) * r;
      const tz = wz + Math.sin(angle) * r;

      const halfW = this.config.world.size * 0.5;
      if (tx < -halfW || tx > halfW || tz < -halfW || tz > halfW) continue;

      if (this.foliageStore.hasFoliageNearby(tx, tz, spacing)) continue;

      const rotY = fp.randomRotation ? Math.random() * Math.PI * 2 : 0;
      const scale =
        (fp.scaleMin + Math.random() * (fp.scaleMax - fp.scaleMin)) * baseScale;
      const y = this.terrainStore.getWorldHeight(tx, tz);
      this.foliageStore.addFoliage(tx, tz, y, rotY, scale, slotIdx);
    }
  }

  endStroke() {
    if (!this.isPlacing) return;
    this.isPlacing = false;
    const touchedKeys = [...this.beforeMap.keys()];
    if (touchedKeys.length === 0) return;

    const afterMap = new Map();
    for (const key of touchedKeys) {
      const items = this.foliageStore.chunks.get(key);
      afterMap.set(key, items ? items.map((f) => ({ ...f })) : []);
    }

    this.undoStack.push({ before: new Map(this.beforeMap), after: afterMap });
    this.redoStack.length = 0;
    if (this.undoStack.length > 64) this.undoStack.shift();
    this.beforeMap.clear();
  }

  undo() {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    this.foliageStore.restoreFromSnapshot(cmd.before);
    this.redoStack.push(cmd);
  }

  redo() {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    this.foliageStore.restoreFromSnapshot(cmd.after);
    this.undoStack.push(cmd);
  }

  clearAll() {
    const before = new Map();
    for (const [key, items] of this.foliageStore.chunks) {
      before.set(key, items.map((f) => ({ ...f })));
    }
    this.foliageStore.clear();
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
