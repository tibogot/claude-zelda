import * as THREE from "three";
import { generateRoadGeometry } from "../../core/road/roadMesh.js";
import { createRoadUniforms, createRoadMaterial, syncRoadUniforms } from "../../core/road/roadMaterial.js";

export class RoadSystem {
  constructor({ scene, camera, toolState, getWorldHeight }) {
    this.scene = scene;
    this.camera = camera;
    this.toolState = toolState;
    this.getWorldHeight = getWorldHeight;

    this.segments = [];
    this.selectedIdx = -1;
    this.dragging = false;

    this.handleGroup = new THREE.Group();
    this.handleGroup.name = "RoadHandles";
    scene.add(this.handleGroup);
    this.handleMeshes = [];

    this.roadUniforms = createRoadUniforms(toolState.road);
    this.roadMat = createRoadMaterial(this.roadUniforms);

    this.undoStack = [];
    this.redoStack = [];
  }

  _activeIdx() {
    if (this.segments.length === 0) return -1;
    return Math.max(0, Math.min(this.toolState.road.activeRoadIndex | 0, this.segments.length - 1));
  }

  _clampActive() {
    if (this.segments.length === 0) {
      this.toolState.road.activeRoadIndex = 0;
      return;
    }
    this.toolState.road.activeRoadIndex = Math.max(0, Math.min(this.toolState.road.activeRoadIndex | 0, this.segments.length - 1));
  }

  _pushUndo() {
    this.undoStack.push(this._snapshot());
    this.redoStack.length = 0;
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  _snapshot() {
    return {
      segments: this.segments.map(s => ({
        points: s.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
      })),
      activeRoadIndex: this.toolState.road.activeRoadIndex,
      selectedIdx: this.selectedIdx,
    };
  }

  _restore(snap) {
    this._disposeAllMeshes();
    this.segments = snap.segments.map(s => ({
      points: s.points.map(p => new THREE.Vector3(p.x, p.y, p.z)),
      mesh: null,
    }));
    this.toolState.road.activeRoadIndex = snap.activeRoadIndex;
    this.selectedIdx = snap.selectedIdx;
    this._clampActive();
    this._rebuildVisual();
  }

  undo() {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this._snapshot());
    this._restore(snap);
  }

  redo() {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this._snapshot());
    this._restore(snap);
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  addPoint(pos) {
    this._pushUndo();
    if (this.segments.length === 0) {
      this.segments.push({ points: [], mesh: null });
      this.toolState.road.activeRoadIndex = 0;
    }
    this._clampActive();
    const ai = this._activeIdx();
    const pts = this.segments[ai].points;
    pts.push(pos.clone());
    this.selectedIdx = pts.length - 1;
    this._rebuildVisual();
    this._updateSelectedY();
  }

  deleteSelected() {
    const ai = this._activeIdx();
    if (ai < 0 || this.selectedIdx < 0) return;
    const pts = this.segments[ai].points;
    if (this.selectedIdx >= pts.length) return;
    this._pushUndo();
    pts.splice(this.selectedIdx, 1);
    this.selectedIdx = Math.min(this.selectedIdx, pts.length - 1);
    this._rebuildVisual();
    this._updateSelectedY();
  }

  moveSelected(pos) {
    const ai = this._activeIdx();
    if (ai < 0 || this.selectedIdx < 0) return;
    const pts = this.segments[ai].points;
    if (this.selectedIdx >= pts.length) return;
    const currentY = pts[this.selectedIdx].y;
    pts[this.selectedIdx].copy(pos);
    pts[this.selectedIdx].y = currentY;
    this._rebuildVisual();
  }

  snapSelectedYToTerrain() {
    const ai = this._activeIdx();
    if (ai < 0 || this.selectedIdx < 0) return;
    const pts = this.segments[ai].points;
    if (this.selectedIdx >= pts.length) return;
    this._pushUndo();
    const p = pts[this.selectedIdx];
    p.y = this.getWorldHeight(p.x, p.z);
    this._rebuildVisual();
    this._updateSelectedY();
  }

  startNewRoad() {
    this._pushUndo();
    this.segments.push({ points: [], mesh: null });
    this.toolState.road.activeRoadIndex = this.segments.length - 1;
    this.selectedIdx = -1;
    this._rebuildVisual();
  }

  deleteActiveRoad() {
    const ai = this._activeIdx();
    if (ai < 0) return;
    this._pushUndo();
    this._disposeSegMesh(this.segments[ai]);
    this.segments.splice(ai, 1);
    this.selectedIdx = -1;
    this.dragging = false;
    this._clampActive();
    this._rebuildVisual();
  }

  pickPoint(raycaster) {
    const spheres = this.handleMeshes.filter(m => m.isMesh);
    if (spheres.length === 0) return -1;
    const hits = raycaster.intersectObjects(spheres, false);
    if (hits.length === 0) return -1;
    return this.handleMeshes.indexOf(hits[0].object);
  }

  syncMaterial() {
    syncRoadUniforms(this.roadUniforms, this.toolState.road);
    this.roadMat.needsUpdate = true;
  }

  rebuildAllMeshes() {
    const rp = this.toolState.road;
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      this._disposeSegMesh(seg);
      if (seg.points.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(seg.points, false, "catmullrom", 0.5);
      const geo = generateRoadGeometry(curve, rp.width, rp.segments, rp.heightOffset, this.getWorldHeight);
      seg.mesh = new THREE.Mesh(geo, this.roadMat);
      seg.mesh.renderOrder = 3;
      this.scene.add(seg.mesh);
    }
  }

  _rebuildHandles() {
    while (this.handleGroup.children.length) {
      const child = this.handleGroup.children[0];
      this.handleGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    this.handleMeshes = [];

    const ai = this._activeIdx();
    if (ai < 0) {
      this._syncHandlesVisibility();
      return;
    }
    const pts = this.segments[ai].points;

    for (let i = 0; i < pts.length; i++) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.5, 8, 8),
        new THREE.MeshBasicMaterial({ color: i === this.selectedIdx ? 0xffff00 : 0x886644 }),
      );
      sphere.position.copy(pts[i]);
      this.handleGroup.add(sphere);
      this.handleMeshes.push(sphere);
    }

    if (pts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.5);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(60));
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xaa7744 }));
      this.handleGroup.add(line);
      this.handleMeshes.push(line);
    }

    this._syncHandlesVisibility();
  }

  _syncHandlesVisibility() {
    this.handleGroup.visible = this.toolState.road.showHandles;
  }

  _rebuildVisual() {
    this.rebuildAllMeshes();
    this._rebuildHandles();
  }

  _disposeSegMesh(seg) {
    if (seg.mesh) {
      this.scene.remove(seg.mesh);
      seg.mesh.geometry.dispose();
      seg.mesh = null;
    }
  }

  _disposeAllMeshes() {
    for (const seg of this.segments) this._disposeSegMesh(seg);
  }

  _updateSelectedY() {
    const ai = this._activeIdx();
    if (ai >= 0 && this.selectedIdx >= 0 && this.selectedIdx < this.segments[ai].points.length) {
      this.toolState.road.selectedPointY = this.segments[ai].points[this.selectedIdx].y;
    }
  }

  setSelectedPointY(y) {
    const ai = this._activeIdx();
    if (ai < 0 || this.selectedIdx < 0) return;
    const pts = this.segments[ai].points;
    if (this.selectedIdx >= pts.length) return;
    pts[this.selectedIdx].y = y;
    this._rebuildVisual();
  }

  exportData() {
    return this.segments.map(s => ({
      points: s.points.map(p => ({ x: p.x, y: p.y, z: p.z })),
    }));
  }

  importData(data) {
    this._disposeAllMeshes();
    this.segments = data.map(s => ({
      points: Array.isArray(s.points) ? s.points.map(p => new THREE.Vector3(p.x, p.y, p.z)) : [],
      mesh: null,
    }));
    this.selectedIdx = -1;
    this.dragging = false;
    this._clampActive();
    this._rebuildVisual();
  }

  dispose() {
    this._disposeAllMeshes();
    while (this.handleGroup.children.length) {
      const child = this.handleGroup.children[0];
      this.handleGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    this.scene.remove(this.handleGroup);
    this.roadMat.dispose();
  }
}
