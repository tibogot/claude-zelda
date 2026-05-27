import * as THREE from "three";
import {
  MOD,
  MODULE_BY_ID,
  MODULE_CATALOG,
  createModuleInstance,
  worldToCell,
  cellKey,
  getModuleTransform,
  isEdgeModule,
  buildParams,
  setBuildParams,
  DEMO_HUT,
} from "./modularBuildingKit.js";
import { ModularBuildGrid } from "./modularBuildingGrid.js";

const ROT_LABELS = ["0°", "90°", "180°", "270°"];

/**
 * Grid-snapped modular building placer with ghost preview.
 */
export class ModularBuildingPlacer {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {THREE.Camera} opts.camera
   * @param {HTMLElement} opts.domElement
   * @param {() => boolean} [opts.isBuildMode]
   */
  constructor({ scene, camera, domElement, isBuildMode = () => true, onChange }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.isBuildMode = isBuildMode;
    this.onChange = onChange;

    this.activeModuleId = "floor";
    this.rotation = 0;
    this.eraseMode = false;
    this.showGrid = true;

    /** @type {Map<string, { moduleId: string, gx: number, gz: number, rot: number, object: THREE.Object3D }>} */
    this.placed = new Map();

    this.root = new THREE.Group();
    this.root.name = "ModularBuildings";
    scene.add(this.root);

    this.ghost = createModuleInstance("floor");
    this._setGhostOpacity(0.42);
    this.ghost.visible = false;
    scene.add(this.ghost);

    this.buildGrid = new ModularBuildGrid(scene, { extent: 24, mod: MOD });

    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
    this._hoverCell = { gx: 0, gz: 0 };
    this._pointerDown = false;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    domElement.addEventListener("pointermove", this._onPointerMove);
    domElement.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("keydown", this._onKeyDown);

    this._refreshGhostModule();
  }

  _notify() {
    this.onChange?.();
  }

  get placedCount() {
    return this.placed.size;
  }

  get rotationLabel() {
    return ROT_LABELS[this.rotation] ?? "0°";
  }

  dispose() {
    this.domElement.removeEventListener("pointermove", this._onPointerMove);
    this.domElement.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("keydown", this._onKeyDown);
    this.clearAll();
    this.scene.remove(this.ghost);
    this.buildGrid.dispose();
    this.scene.remove(this.root);
    this._disposeObject(this.ghost);
  }

  _disposeObject(obj) {
    obj.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
    });
  }

  _setGhostOpacity(opacity) {
    this.ghost.traverse((c) => {
      if (!c.isMesh) return;
      c.material = c.material.clone();
      c.material.transparent = true;
      c.material.opacity = opacity;
      c.material.depthWrite = false;
    });
  }

  _refreshGhostModule() {
    this.scene.remove(this.ghost);
    this._disposeObject(this.ghost);
    this.ghost = createModuleInstance(this.activeModuleId);
    this._setGhostOpacity(this.eraseMode ? 0.25 : 0.42);
    if (this.eraseMode) {
      this.ghost.traverse((c) => {
        if (c.isMesh) c.material.color.set(0xff4444);
      });
    }
    this.scene.add(this.ghost);
    this._updateGhostTransform();
  }

  setActiveModule(moduleId) {
    if (!MODULE_BY_ID.has(moduleId)) return;
    this.activeModuleId = moduleId;
    this.eraseMode = false;
    this._refreshGhostModule();
    this._notify();
  }

  setEraseMode(on) {
    this.eraseMode = !!on;
    this._refreshGhostModule();
    this._notify();
  }

  rotateCW() {
    this.rotation = (this.rotation + 1) % 4;
    this._updateGhostTransform();
    this._notify();
  }

  toggleGrid() {
    this.showGrid = !this.showGrid;
    this.buildGrid.setVisible(this.showGrid);
    if (!this.showGrid) this.buildGrid.hideHover();
  }

  _isOccupied(moduleId, gx, gz, rot) {
    const def = MODULE_BY_ID.get(moduleId);
    if (!def) return false;
    const key = cellKey(gx, gz, def.category, rot, moduleId);
    return this.placed.has(key);
  }

  _rayHit(clientX, clientY) {
    const rect = this.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(ndc, this.camera);
    return this._raycaster.ray.intersectPlane(this._plane, this._hit)
      ? this._hit.clone()
      : null;
  }

  _updateGhostTransform() {
    const { gx, gz } = this._hoverCell;
    const { position, rotationY } = getModuleTransform(
      this.activeModuleId,
      gx,
      gz,
      this.rotation,
    );
    this.ghost.position.copy(position);
    this.ghost.rotation.y = rotationY;
    this.ghost.visible = this.isBuildMode();

    if (this.isBuildMode() && this.showGrid) {
      this.buildGrid.updateHover(
        gx,
        gz,
        this.activeModuleId,
        this.rotation,
        this._isOccupied(this.activeModuleId, gx, gz, this.rotation),
      );
    }
  }

  _onPointerMove(e) {
    if (!this.isBuildMode()) {
      this.ghost.visible = false;
      this.buildGrid.hideHover();
      return;
    }
    const hit = this._rayHit(e.clientX, e.clientY);
    if (!hit) {
      this.ghost.visible = false;
      this.buildGrid.hideHover();
      return;
    }
    const cell = worldToCell(hit.x, hit.z);
    this._hoverCell.gx = cell.gx;
    this._hoverCell.gz = cell.gz;
    this._updateGhostTransform();
  }

  _onPointerDown(e) {
    if (!this.isBuildMode()) return;
    if (e.button !== 0) return;

    const hit = this._rayHit(e.clientX, e.clientY);
    if (!hit) return;
    const { gx, gz } = worldToCell(hit.x, hit.z);

    if (this.eraseMode) {
      e.preventDefault();
      if (this.removeAtCell(gx, gz)) this._notify();
      return;
    }

    e.preventDefault();
    if (this.place(this.activeModuleId, gx, gz, this.rotation)) this._notify();
  }

  _onKeyDown(e) {
    if (!this.isBuildMode()) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.code === "KeyR") {
      e.preventDefault();
      this.rotateCW();
      return;
    }
    if (e.code === "KeyG") {
      e.preventDefault();
      this.toggleGrid();
      return;
    }
    if (e.code === "KeyX") {
      e.preventDefault();
      this.setEraseMode(!this.eraseMode);
      return;
    }

    const idx = MODULE_CATALOG.findIndex((m) => m.id === this.activeModuleId);
    if (e.code === "BracketRight") {
      e.preventDefault();
      const next = MODULE_CATALOG[(idx + 1) % MODULE_CATALOG.length];
      this.setActiveModule(next.id);
      return;
    }
    if (e.code === "BracketLeft") {
      e.preventDefault();
      const prev = MODULE_CATALOG[(idx - 1 + MODULE_CATALOG.length) % MODULE_CATALOG.length];
      this.setActiveModule(prev.id);
      return;
    }

    const num = parseInt(e.key, 10);
    if (num >= 1 && num <= MODULE_CATALOG.length) {
      e.preventDefault();
      this.setActiveModule(MODULE_CATALOG[num - 1].id);
    }
  }

  place(moduleId, gx, gz, rot = 0) {
    const def = MODULE_BY_ID.get(moduleId);
    if (!def) return null;

    const key = cellKey(gx, gz, def.category, rot, moduleId);
    const existing = this.placed.get(key);
    if (existing) {
      this.root.remove(existing.object);
      this._disposeObject(existing.object);
      this.placed.delete(key);
    }

    const { position, rotationY } = getModuleTransform(moduleId, gx, gz, rot);
    const object = createModuleInstance(moduleId);
    object.position.copy(position);
    object.rotation.y = rotationY;
    object.userData.placement = {
      moduleId,
      gx,
      gz,
      rot,
      category: def.category,
    };
    this.root.add(object);

    const entry = { moduleId, gx, gz, rot, object };
    this.placed.set(key, entry);
    return entry;
  }

  removeAtCell(gx, gz) {
    let removed = false;
    for (const [key, entry] of [...this.placed.entries()]) {
      if (entry.gx === gx && entry.gz === gz) {
        this.root.remove(entry.object);
        this._disposeObject(entry.object);
        this.placed.delete(key);
        removed = true;
      }
    }
    return removed;
  }

  /** Remove the piece that would be placed at this cell/rotation. */
  removeTargeted(gx, gz, moduleId, rot) {
    const def = MODULE_BY_ID.get(moduleId);
    if (!def) return false;
    const key = cellKey(gx, gz, def.category, rot, moduleId);
    const entry = this.placed.get(key);
    if (!entry) {
      if (isEdgeModule(moduleId)) return this.removeAtCell(gx, gz);
      return false;
    }
    this.root.remove(entry.object);
    this._disposeObject(entry.object);
    this.placed.delete(key);
    return true;
  }

  clearAll() {
    for (const entry of this.placed.values()) {
      this.root.remove(entry.object);
      this._disposeObject(entry.object);
    }
    this.placed.clear();
  }

  clearAllAndNotify() {
    this.clearAll();
    this._notify();
  }

  loadDemo() {
    this.clearAll();
    for (const p of DEMO_HUT) {
      this.place(p.id, p.gx, p.gz, p.rot ?? 0);
    }
    this._notify();
  }

  /** Rebuild every placed piece (after wall height / pitch change). */
  rebuildAll() {
    const layout = this.exportLayout();
    this.clearAll();
    for (const p of layout) {
      this.place(p.id, p.gx, p.gz, p.rot ?? 0);
    }
    this._refreshGhostModule();
    this._updateGhostTransform();
    this._notify();
  }

  /** @returns {object[]} serializable layout */
  exportLayout() {
    return [...this.placed.values()].map(({ moduleId, gx, gz, rot }) => ({
      id: moduleId,
      gx,
      gz,
      rot,
    }));
  }
}

/**
 * Build the left-side module palette UI.
 * @param {ModularBuildingPlacer} placer
 * @param {(info: { count: number, moduleId: string, rotation: string, erase: boolean }) => void} [onStatus]
 */
export function buildModulePaletteUI(placer, onStatus) {
  const palette = document.getElementById("module-palette");
  const grid = document.getElementById("module-grid");
  const statusEl = document.getElementById("build-status");
  const rotEl = document.getElementById("build-rotation");
  const eraseBtn = document.getElementById("build-erase-toggle");

  /** @type {Map<string, HTMLButtonElement>} */
  const cards = new Map();

  function refreshStatus() {
    const info = {
      count: placer.placedCount,
      moduleId: placer.activeModuleId,
      rotation: placer.rotationLabel,
      erase: placer.eraseMode,
    };
    if (statusEl) {
      statusEl.textContent = `${info.count} placed · ${info.erase ? "Erase" : MODULE_BY_ID.get(info.moduleId)?.label ?? info.moduleId}`;
    }
    if (rotEl) rotEl.textContent = info.rotation;
    if (eraseBtn) eraseBtn.classList.toggle("active", info.erase);
    for (const [id, btn] of cards) {
      btn.classList.toggle("active", !info.erase && id === info.moduleId);
    }
    onStatus?.(info);
  }

  for (const mod of MODULE_CATALOG) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "module-card";
    btn.dataset.moduleId = mod.id;
    btn.innerHTML = `
      <span class="module-swatch" style="background:${mod.swatch}"></span>
      <span class="module-card-text">
        <span class="module-card-label">${mod.label}</span>
        <span class="module-card-hint">${mod.hint}</span>
      </span>
      <span class="module-card-key">${MODULE_CATALOG.indexOf(mod) + 1}</span>
    `;
    btn.addEventListener("click", () => {
      placer.setActiveModule(mod.id);
      refreshStatus();
    });
    grid.appendChild(btn);
    cards.set(mod.id, btn);
  }

  document.getElementById("build-rotate")?.addEventListener("click", () => {
    placer.rotateCW();
    refreshStatus();
  });

  eraseBtn?.addEventListener("click", () => {
    placer.setEraseMode(!placer.eraseMode);
    refreshStatus();
  });

  document.getElementById("build-grid-toggle")?.addEventListener("click", () => {
    placer.toggleGrid();
  });

  document.getElementById("build-clear")?.addEventListener("click", () => {
    placer.clearAllAndNotify();
    refreshStatus();
  });

  document.getElementById("build-demo")?.addEventListener("click", () => {
    placer.loadDemo();
    refreshStatus();
  });

  const dimsEl = document.getElementById("module-dims");
  if (dimsEl) {
    dimsEl.innerHTML = `
      <div class="palette-dims-title">Building scale</div>
      <label class="palette-dim-row">
        <span>Wall height</span>
        <input type="range" id="dim-wallH" min="3" max="8" step="0.25" value="${buildParams.wallH}">
        <span id="dim-wallH-val">${buildParams.wallH}m</span>
      </label>
      <label class="palette-dim-row">
        <span>Roof pitch</span>
        <input type="range" id="dim-pitch" min="0.15" max="0.85" step="0.05" value="${buildParams.roofPitch}">
        <span id="dim-pitch-val">${buildParams.roofPitch}</span>
      </label>
    `;
    const wallSl = dimsEl.querySelector("#dim-wallH");
    const wallVal = dimsEl.querySelector("#dim-wallH-val");
    const pitchSl = dimsEl.querySelector("#dim-pitch");
    const pitchVal = dimsEl.querySelector("#dim-pitch-val");
    wallSl?.addEventListener("input", () => {
      const v = parseFloat(wallSl.value);
      wallVal.textContent = `${v}m`;
      setBuildParams({ wallH: v });
    });
    pitchSl?.addEventListener("input", () => {
      const v = parseFloat(pitchSl.value);
      pitchVal.textContent = String(v);
      setBuildParams({ roofPitch: v });
    });
  }

  refreshStatus();
  return { refreshStatus };
}
