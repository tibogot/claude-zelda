import * as THREE from "three";
import {
  PIECE_CATALOG,
  PIECE_BY_ID,
  roadParams,
  pieceParams,
  guardrailParams,
  buildPiece,
  initialConnector,
} from "./modularRoadKit.js";

/**
 * Auto-chain modular road builder. Pieces always snap onto the track's current
 * open exit connector — no grid. Each placed entry stores the piece id and a
 * snapshot of its geometry params so the whole chain can be rebuilt (e.g. when
 * the shared cross-section profile changes) while staying connected.
 */
export class ModularRoadBuilder {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Material} o.material shared road material
   * @param {THREE.Material} [o.railMaterial] shared guardrail material
   * @param {THREE.Material} [o.shellMaterial] shared tunnel-shell material
   * @param {() => boolean} [o.isBuildMode]
   * @param {() => void} [o.onChange]
   */
  constructor({ scene, material, railMaterial = null, shellMaterial = null, isBuildMode = () => true, onChange = null }) {
    this.scene = scene;
    this.material = material;
    this.railMaterial = railMaterial;
    this.shellMaterial = shellMaterial;
    this.isBuildMode = isBuildMode;
    this.onChange = onChange;

    this.activePieceId = PIECE_CATALOG[0].id;
    /** @type {{id:string, pp:object, mesh:THREE.Mesh, railMesh:THREE.Mesh|null, shellMesh:THREE.Mesh|null, connectorOut:THREE.Matrix4}[]} */
    this.pieces = [];
    this.currentConnector = initialConnector();

    this.root = new THREE.Group();
    this.root.name = "ModularRoad";
    scene.add(this.root);

    this.ghostMat = new THREE.MeshBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMat);
    this.ghost.name = "ModularRoadGhost";
    this.ghost.matrixAutoUpdate = false;
    scene.add(this.ghost);

    this.refreshGhost();
  }

  get count() {
    return this.pieces.length;
  }

  _snapshotParams() {
    return { ...pieceParams };
  }

  _notify() {
    this.onChange?.();
  }

  setActivePiece(id) {
    if (!PIECE_BY_ID.has(id)) return;
    this.activePieceId = id;
    this.refreshGhost();
    this._notify();
  }

  /** Flip curve direction (only meaningful for the curve piece). */
  flip() {
    pieceParams.curveDir = pieceParams.curveDir >= 0 ? -1 : 1;
    this.refreshGhost();
    this._notify();
  }

  /** Rebuild the translucent ghost at the current open connector. */
  refreshGhost() {
    const { geometry, world } = buildPiece(
      this.activePieceId,
      this.currentConnector,
      pieceParams,
      roadParams,
    );
    this.ghost.geometry.dispose();
    this.ghost.geometry = geometry;
    this.ghost.matrix.copy(world);
    this.ghost.visible = this.isBuildMode();
  }

  setGhostVisible(v) {
    this.ghost.visible = v && this.isBuildMode();
  }

  _makeMesh(geometry, material, world) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(world);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  /** Place the active piece onto the open end. */
  place() {
    const built = buildPiece(
      this.activePieceId,
      this.currentConnector,
      pieceParams,
      roadParams,
      guardrailParams,
    );
    const mesh = this._makeMesh(built.geometry, this.material, built.world);
    mesh.userData.pieceId = this.activePieceId;
    if (built.def.noMesh) {
      // Gap spacer: keep a valid geometry (so the renderer is happy) but hide it
      // and flag it so the collision bake skips it — it's just empty air.
      mesh.visible = false;
      mesh.userData.noCollision = true;
    }
    const railMesh =
      built.railGeometry && this.railMaterial
        ? this._makeMesh(built.railGeometry, this.railMaterial, built.world)
        : null;
    const shellMesh =
      built.shellGeometry && this.shellMaterial
        ? this._makeMesh(built.shellGeometry, this.shellMaterial, built.world)
        : null;

    this.pieces.push({
      id: this.activePieceId,
      pp: this._snapshotParams(),
      mesh,
      railMesh,
      shellMesh,
      connectorOut: built.connectorOut.clone(),
    });
    this.currentConnector = built.connectorOut.clone();
    this.refreshGhost();
    this._notify();
    return mesh;
  }

  _removePiece(p) {
    this.root.remove(p.mesh);
    p.mesh.geometry.dispose();
    if (p.railMesh) {
      this.root.remove(p.railMesh);
      p.railMesh.geometry.dispose();
    }
    if (p.shellMesh) {
      this.root.remove(p.shellMesh);
      p.shellMesh.geometry.dispose();
    }
  }

  undo() {
    const last = this.pieces.pop();
    if (!last) return false;
    this._removePiece(last);
    this.currentConnector = this.pieces.length
      ? this.pieces[this.pieces.length - 1].connectorOut.clone()
      : initialConnector();
    this.refreshGhost();
    this._notify();
    return true;
  }

  clear() {
    for (const p of this.pieces) this._removePiece(p);
    this.pieces = [];
    this.currentConnector = initialConnector();
    this.refreshGhost();
    this._notify();
  }

  /**
   * Rebuild the whole chain from stored per-piece param snapshots using the
   * current shared profile. Keeps connectivity; used after profile edits.
   */
  rebuildAll() {
    let connector = initialConnector();
    for (const p of this.pieces) {
      const built = buildPiece(p.id, connector, p.pp, roadParams, guardrailParams);
      p.mesh.geometry.dispose();
      p.mesh.geometry = built.geometry;
      p.mesh.matrix.copy(built.world);

      if (built.railGeometry && this.railMaterial) {
        if (p.railMesh) {
          p.railMesh.geometry.dispose();
          p.railMesh.geometry = built.railGeometry;
          p.railMesh.matrix.copy(built.world);
        } else {
          p.railMesh = this._makeMesh(built.railGeometry, this.railMaterial, built.world);
        }
      } else if (p.railMesh) {
        this.root.remove(p.railMesh);
        p.railMesh.geometry.dispose();
        p.railMesh = null;
      }

      if (built.shellGeometry && this.shellMaterial) {
        if (p.shellMesh) {
          p.shellMesh.geometry.dispose();
          p.shellMesh.geometry = built.shellGeometry;
          p.shellMesh.matrix.copy(built.world);
        } else {
          p.shellMesh = this._makeMesh(built.shellGeometry, this.shellMaterial, built.world);
        }
      } else if (p.shellMesh) {
        this.root.remove(p.shellMesh);
        p.shellMesh.geometry.dispose();
        p.shellMesh = null;
      }

      p.connectorOut = built.connectorOut.clone();
      connector = built.connectorOut.clone();
    }
    this.currentConnector = connector.clone();
    this.refreshGhost();
    this._notify();
  }

  /** Load a few pieces so the page isn't empty on first open. */
  loadDemo() {
    this.clear();
    const demo = ["straight", "curve", "slope", "straight", "curve"];
    const savedDir = pieceParams.curveDir;
    for (const id of demo) {
      this.activePieceId = id;
      this.place();
    }
    pieceParams.curveDir = savedDir;
    this.activePieceId = PIECE_CATALOG[0].id;
    this.refreshGhost();
    this._notify();
  }

  /** @returns {{id:string, pp:object}[]} serializable layout */
  exportLayout() {
    return this.pieces.map((p) => ({ id: p.id, pp: { ...p.pp } }));
  }

  dispose() {
    this.clear();
    this.scene.remove(this.ghost);
    this.ghost.geometry.dispose();
    this.ghostMat.dispose();
    this.scene.remove(this.root);
  }
}

/**
 * Wire the left palette + toolbar DOM to a builder instance.
 * Expects #piece-grid, #road-status, and toolbar buttons in the page.
 * @param {ModularRoadBuilder} builder
 */
export function buildRoadPaletteUI(builder) {
  const grid = document.getElementById("piece-grid");
  const statusEl = document.getElementById("road-status");
  /** @type {Map<string, HTMLButtonElement>} */
  const cards = new Map();

  function refreshStatus() {
    if (statusEl) {
      const label = PIECE_BY_ID.get(builder.activePieceId)?.label ?? builder.activePieceId;
      const dir = pieceParams.curveDir >= 0 ? "Right" : "Left";
      statusEl.textContent = `${builder.count} placed · ${label}${
        builder.activePieceId === "curve" ? " (" + dir + ")" : ""
      }`;
    }
    for (const [id, btn] of cards) {
      btn.classList.toggle("active", id === builder.activePieceId);
    }
  }

  for (const def of PIECE_CATALOG) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "module-card";
    btn.dataset.pieceId = def.id;
    btn.innerHTML = `
      <span class="module-swatch" style="background:${def.swatch}"></span>
      <span class="module-card-text">
        <span class="module-card-label">${def.label}</span>
        <span class="module-card-hint">${def.hint}</span>
      </span>
      <span class="module-card-key">${def.key}</span>
    `;
    btn.addEventListener("click", () => {
      builder.setActivePiece(def.id);
      refreshStatus();
    });
    grid.appendChild(btn);
    cards.set(def.id, btn);
  }

  document.getElementById("road-place")?.addEventListener("click", () => {
    builder.place();
    refreshStatus();
  });
  document.getElementById("road-flip")?.addEventListener("click", () => {
    builder.flip();
    refreshStatus();
  });
  document.getElementById("road-undo")?.addEventListener("click", () => {
    builder.undo();
    refreshStatus();
  });
  document.getElementById("road-demo")?.addEventListener("click", () => {
    builder.loadDemo();
    refreshStatus();
  });
  document.getElementById("road-clear")?.addEventListener("click", () => {
    builder.clear();
    refreshStatus();
  });

  // Keyboard: 1/2/3 pick, R flip, Enter/Space place, Backspace undo.
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const byKey = PIECE_CATALOG.find((p) => p.key === e.key);
    if (byKey) {
      builder.setActivePiece(byKey.id);
      refreshStatus();
      return;
    }
    if (e.code === "KeyR") {
      builder.flip();
      refreshStatus();
    } else if (e.code === "Enter" || e.code === "Space") {
      if (builder.isBuildMode()) {
        e.preventDefault();
        builder.place();
        refreshStatus();
      }
    } else if (e.code === "Backspace") {
      e.preventDefault();
      builder.undo();
      refreshStatus();
    }
  });

  refreshStatus();
  return { refreshStatus };
}
