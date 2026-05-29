import * as THREE from "three";
import {
  PIECE_CATALOG,
  PIECE_BY_ID,
  roadParams,
  pieceParams,
  guardrailParams,
  buildPiece,
  initialConnector,
  socketMatrix,
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
   * @param {THREE.Material} [o.decorMaterial] start/finish/checkpoint decor
   * @param {() => boolean} [o.isBuildMode]
   * @param {() => void} [o.onChange]
   */
  constructor({ scene, material, railMaterial = null, shellMaterial = null, decorMaterial = null, isBuildMode = () => true, onChange = null }) {
    this.scene = scene;
    this.material = material;
    this.railMaterial = railMaterial;
    this.shellMaterial = shellMaterial;
    this.decorMaterial = decorMaterial;
    this.isBuildMode = isBuildMode;
    this.onChange = onChange;

    this.activePieceId = PIECE_CATALOG[0].id;
    /** @type {{id:string, pp:object, mesh:THREE.Mesh, railMesh:THREE.Mesh|null, shellMesh:THREE.Mesh|null, decorMesh:THREE.Mesh|null, connectorIn:THREE.Matrix4, connectorOut:THREE.Matrix4}[]} */
    this.pieces = [];
    this.currentConnector = initialConnector();

    /** When true, ghost follows pointer / orbit target instead of chain end. */
    this.freePlaceMode = false;
    this.freeYaw = 0;
    this._freePos = new THREE.Vector3(0, 0.5, 0);

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

  /** Start a disconnected chain — ghost moves with the pointer / orbit target. */
  beginNewChain(atPos = null, yaw = null) {
    this.freePlaceMode = true;
    if (yaw != null) this.freeYaw = yaw;
    if (atPos) this._freePos.copy(atPos);
    this._applyFreeConnector();
    this.refreshGhost();
    this._notify();
  }

  setFreePlacement(pos, yaw) {
    this._freePos.copy(pos);
    if (yaw !== undefined) this.freeYaw = yaw;
    this._applyFreeConnector();
    this.refreshGhost();
  }

  rotateFreeYaw(delta) {
    if (!this.freePlaceMode) return;
    this.freeYaw += delta;
    this._applyFreeConnector();
    this.refreshGhost();
  }

  _applyFreeConnector() {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.freeYaw);
    const travel = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    socketMatrix(this._freePos, travel, new THREE.Vector3(0, 1, 0), this.currentConnector);
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
    const connectorIn = this.currentConnector.clone();
    const built = buildPiece(
      this.activePieceId,
      connectorIn,
      pieceParams,
      roadParams,
      guardrailParams,
    );
    const mesh = this._makeMesh(built.geometry, this.material, built.world);
    mesh.userData.pieceId = this.activePieceId;
    if (built.def.noMesh) {
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
    const decorMesh =
      built.decorGeometry && this.decorMaterial
        ? this._makeMesh(built.decorGeometry, this.decorMaterial, built.world)
        : null;
    if (decorMesh) decorMesh.castShadow = false;

    this.pieces.push({
      id: this.activePieceId,
      pp: this._snapshotParams(),
      mesh,
      railMesh,
      shellMesh,
      decorMesh,
      connectorIn,
      connectorOut: built.connectorOut.clone(),
    });
    this.currentConnector = built.connectorOut.clone();
    this.freePlaceMode = false;
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
    if (p.decorMesh) {
      this.root.remove(p.decorMesh);
      p.decorMesh.geometry.dispose();
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
    this.freePlaceMode = false;
    this.currentConnector = initialConnector();
    this.refreshGhost();
    this._notify();
  }

  /**
   * Rebuild every placed piece from its stored entry connector + params.
   * Supports multiple disconnected chains.
   */
  rebuildAll() {
    for (const p of this.pieces) {
      const built = buildPiece(p.id, p.connectorIn, p.pp, roadParams, guardrailParams);
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

      if (built.decorGeometry && this.decorMaterial) {
        if (p.decorMesh) {
          p.decorMesh.geometry.dispose();
          p.decorMesh.geometry = built.decorGeometry;
          p.decorMesh.matrix.copy(built.world);
        } else {
          p.decorMesh = this._makeMesh(built.decorGeometry, this.decorMaterial, built.world);
          p.decorMesh.castShadow = false;
        }
      } else if (p.decorMesh) {
        this.root.remove(p.decorMesh);
        p.decorMesh.geometry.dispose();
        p.decorMesh = null;
      }

      p.connectorOut = built.connectorOut.clone();
    }
    const last = this.pieces[this.pieces.length - 1];
    this.currentConnector = last ? last.connectorOut.clone() : initialConnector();
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
 * TrackMania-style palette categories + SVG silhouette previews (no 3D thumbnails yet).
 */
const PIECE_TO_CATEGORY = {
  straight: "straight",
  tunnel: "straight",
  curve: "turns",
  scurve: "turns",
  jump: "ramps",
  gap: "ramps",
  landing: "ramps",
  slope: "slopes",
  crest: "slopes",
  spiral: "slopes",
  banked: "banked",
  bankin: "banked",
  bankout: "banked",
  twist: "tilted",
  loop: "loop",
  start: "game",
  checkpoint: "game",
  finish: "game",
};

export const PALETTE_CATEGORIES = [
  { id: "straight", label: "Straight" },
  { id: "turns", label: "Turns" },
  { id: "game", label: "Game" },
  { id: "ramps", label: "Ramps" },
  { id: "slopes", label: "Slopes" },
  { id: "banked", label: "Banked" },
  { id: "obstacles", label: "Obstacles" },
  { id: "tilted", label: "Tilted" },
  { id: "loop", label: "Loop" },
];

/** Shared road stroke for preview SVGs. */
const _RS = 'stroke="#e8eaed" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"';
const _RB = 'fill="#2a2e36" stroke="#c0392b" stroke-width="1.8"';
const _RK = 'fill="#555" stroke="#888" stroke-width="1"';

function categoryIconSvg(id) {
  const icons = {
    straight: `<svg viewBox="0 0 48 48"><rect x="6" y="20" width="36" height="10" rx="1" ${_RB}/><line x1="8" y1="25" x2="40" y2="25" ${_RS}/></svg>`,
    turns: `<svg viewBox="0 0 48 48"><path d="M8 34 L8 18 Q8 8 22 8 L34 8" ${_RS}/><rect x="6" y="16" width="28" height="8" rx="1" ${_RB} opacity="0.85"/></svg>`,
    game: `<svg viewBox="0 0 48 48"><rect x="10" y="22" width="28" height="8" rx="1" ${_RB}/><line x1="16" y1="12" x2="16" y2="22" stroke="#fff" stroke-width="2"/><polygon points="16,8 12,14 20,14" fill="#fff"/><line x1="32" y1="12" x2="32" y2="22" stroke="#fff" stroke-width="2"/><polygon points="32,8 28,14 36,14" fill="#fff"/></svg>`,
    ramps: `<svg viewBox="0 0 48 48"><polygon points="8,36 40,36 40,14" fill="#2a2e36" stroke="#c0392b" stroke-width="1.8"/><line x1="10" y1="34" x2="38" y2="16" ${_RS}/></svg>`,
    slopes: `<svg viewBox="0 0 48 48"><polygon points="6,36 42,36 42,12" fill="#2a2e36" stroke="#c0392b" stroke-width="1.8"/><line x1="8" y1="34" x2="40" y2="14" ${_RS}/></svg>`,
    banked: `<svg viewBox="0 0 48 48"><path d="M6 30 L42 18" ${_RS}/><rect x="8" y="16" width="32" height="8" rx="1" transform="rotate(-12 24 20)" ${_RB}/></svg>`,
    obstacles: `<svg viewBox="0 0 48 48"><rect x="12" y="14" width="14" height="22" rx="1" fill="#6a7580" stroke="#999" stroke-width="1.5"/><ellipse cx="34" cy="28" rx="8" ry="10" fill="none" stroke="#dce622" stroke-width="2"/></svg>`,
    tilted: `<svg viewBox="0 0 48 48"><path d="M8 24 Q24 8 40 24 Q24 40 8 24" ${_RS}/><rect x="14" y="20" width="20" height="6" rx="1" transform="rotate(25 24 23)" ${_RB}/></svg>`,
    loop: `<svg viewBox="0 0 48 48"><path d="M10 38 L10 22 Q10 6 24 6 Q38 6 38 22 L38 38" ${_RS}/><ellipse cx="24" cy="22" rx="12" ry="14" fill="none" stroke="#c0392b" stroke-width="1.5" opacity="0.6"/></svg>`,
  };
  return icons[id] ?? icons.straight;
}

function piecePreviewSvg(pieceId) {
  const p = {
    straight: `<svg viewBox="0 0 80 80"><rect x="8" y="32" width="64" height="16" rx="2" ${_RB}/><line x1="12" y1="40" x2="68" y2="40" ${_RS}/></svg>`,
    tunnel: `<svg viewBox="0 0 80 80"><rect x="8" y="32" width="64" height="16" rx="2" ${_RB}/><path d="M8 32 Q40 8 72 32" fill="none" stroke="#6a7580" stroke-width="3"/></svg>`,
    curve: `<svg viewBox="0 0 80 80"><path d="M12 68 L12 28 Q12 12 36 12 L68 12" ${_RS}/><path d="M14 66 L14 30 Q14 16 34 16 L66 16" fill="#2a2e36" stroke="#c0392b" stroke-width="1.5"/></svg>`,
    scurve: `<svg viewBox="0 0 80 80"><path d="M12 68 L12 48 Q12 28 32 28 L48 28 Q68 28 68 12" ${_RS}/></svg>`,
    slope: `<svg viewBox="0 0 80 80"><polygon points="8,64 72,64 72,20" fill="#2a2e36" stroke="#c0392b" stroke-width="1.8"/><line x1="12" y1="60" x2="68" y2="24" ${_RS}/></svg>`,
    crest: `<svg viewBox="0 0 80 80"><path d="M8 56 L24 24 L40 56 L56 24 L72 56" ${_RS}/><line x1="8" y1="56" x2="72" y2="56" stroke="#c0392b" stroke-width="1.5"/></svg>`,
    spiral: `<svg viewBox="0 0 80 80"><path d="M14 66 L14 40 Q14 20 36 16 Q58 12 62 36" ${_RS}/><line x1="14" y1="66" x2="14" y2="50" stroke="#dce622" stroke-width="1.5" opacity="0.7"/></svg>`,
    banked: `<svg viewBox="0 0 80 80"><path d="M8 52 L72 28" ${_RS}/><rect x="10" y="30" width="60" height="12" rx="2" transform="rotate(-14 40 36)" ${_RB}/></svg>`,
    bankin: `<svg viewBox="0 0 80 80"><rect x="10" y="38" width="28" height="10" rx="1" ${_RB}/><rect x="38" y="32" width="32" height="10" rx="1" transform="rotate(-16 54 37)" ${_RB}/></svg>`,
    bankout: `<svg viewBox="0 0 80 80"><rect x="10" y="32" width="32" height="10" rx="1" transform="rotate(-16 26 37)" ${_RB}/><rect x="42" y="38" width="28" height="10" rx="1" ${_RB}/></svg>`,
    jump: `<svg viewBox="0 0 80 80"><polygon points="8,60 72,60 72,28" fill="#2a2e36" stroke="#c0392b" stroke-width="1.8"/><line x1="10" y1="58" x2="70" y2="30" ${_RS}/></svg>`,
    gap: `<svg viewBox="0 0 80 80"><rect x="8" y="48" width="24" height="8" rx="1" ${_RB}/><rect x="48" y="56" width="24" height="8" rx="1" ${_RB}/><path d="M32 52 L48 58" stroke="#dce622" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`,
    landing: `<svg viewBox="0 0 80 80"><polygon points="8,36 72,36 72,60" fill="#2a2e36" stroke="#c0392b" stroke-width="1.8"/><line x1="10" y1="38" x2="70" y2="58" ${_RS}/></svg>`,
    twist: `<svg viewBox="0 0 80 80"><path d="M12 40 Q40 12 68 40 Q40 68 12 40" ${_RS}/><rect x="30" y="34" width="20" height="8" rx="1" transform="rotate(30 40 38)" ${_RB}/></svg>`,
    loop: `<svg viewBox="0 0 80 80"><path d="M16 68 L16 36 Q16 12 40 12 Q64 12 64 36 L64 68" ${_RS}/></svg>`,
    start: `<svg viewBox="0 0 80 80"><rect x="10" y="34" width="60" height="12" rx="2" ${_RB}/><rect x="14" y="20" width="8" height="24" fill="#fff"/><rect x="14" y="20" width="16" height="8" fill="#fff"/><rect x="12" y="38" width="8" height="4" fill="#111"/><rect x="20" y="38" width="8" height="4" fill="#fff"/></svg>`,
    checkpoint: `<svg viewBox="0 0 80 80"><rect x="10" y="34" width="60" height="12" rx="2" ${_RB}/><line x1="28" y1="18" x2="28" y2="34" stroke="#fff" stroke-width="3"/><polygon points="28,12 22,20 34,20" fill="#fff"/><line x1="52" y1="18" x2="52" y2="34" stroke="#fff" stroke-width="3"/><polygon points="52,12 46,20 58,20" fill="#fff"/><polygon points="40,42 34,48 46,48" fill="#ffcc00"/></svg>`,
    finish: `<svg viewBox="0 0 80 80"><rect x="10" y="34" width="60" height="12" rx="2" ${_RB}/><rect x="36" y="16" width="8" height="28" fill="#fff"/><polygon points="36,12 32,20 40,20" fill="#fff"/><rect x="12" y="38" width="8" height="4" fill="#111"/><rect x="20" y="38" width="8" height="4" fill="#fff"/><rect x="52" y="38" width="8" height="4" fill="#111"/><rect x="60" y="38" width="8" height="4" fill="#fff"/></svg>`,
    _start: `<svg viewBox="0 0 80 80"><rect x="10" y="34" width="60" height="12" rx="2" ${_RB}/><rect x="14" y="20" width="8" height="24" fill="#fff"/><rect x="14" y="20" width="16" height="8" fill="#fff"/></svg>`,
    _checkpoint: `<svg viewBox="0 0 80 80"><rect x="10" y="34" width="60" height="12" rx="2" ${_RB}/><line x1="28" y1="18" x2="28" y2="34" stroke="#fff" stroke-width="3"/><polygon points="28,12 22,20 34,20" fill="#fff"/><line x1="52" y1="18" x2="52" y2="34" stroke="#fff" stroke-width="3"/><polygon points="52,12 46,20 58,20" fill="#fff"/></svg>`,
    _finish: `<svg viewBox="0 0 80 80"><rect x="10" y="34" width="60" height="12" rx="2" ${_RB}/><rect x="36" y="16" width="8" height="28" fill="#fff"/><polygon points="36,12 32,20 40,20" fill="#fff"/></svg>`,
    box: `<svg viewBox="0 0 80 80"><rect x="22" y="28" width="36" height="28" rx="2" fill="#6a7580" stroke="#999" stroke-width="1.5"/></svg>`,
    ramp: `<svg viewBox="0 0 80 80"><polygon points="12,60 68,60 68,24" fill="#e8912d" stroke="#c0392b" stroke-width="1.5"/></svg>`,
    tube: `<svg viewBox="0 0 80 80"><ellipse cx="40" cy="40" rx="28" ry="14" fill="none" stroke="#3a7bd5" stroke-width="3"/></svg>`,
    ring: `<svg viewBox="0 0 80 80"><ellipse cx="40" cy="40" rx="26" ry="26" fill="none" stroke="#dce622" stroke-width="4"/></svg>`,
    airtunnel: `<svg viewBox="0 0 80 80"><rect x="10" y="32" width="60" height="16" rx="2" ${_RB}/><path d="M10 32 Q40 10 70 32" fill="none" stroke="#6a7580" stroke-width="3"/></svg>`,
  };
  return p[pieceId] ?? p.straight;
}

/**
 * Wire the left palette + toolbar DOM to a builder instance.
 * @param {ModularRoadBuilder} builder
 * @param {{ propCatalog?: object[], onAddProp?: (id:string)=>void, onEdgesChange?: ()=>void }} [opts]
 */
export function buildRoadPaletteUI(builder, opts = {}) {
  const { propCatalog = [], onAddProp = null, onEdgesChange = null } = opts;
  const catList = document.getElementById("category-list");
  const grid = document.getElementById("piece-grid");
  const titleEl = document.getElementById("category-title");
  const statusEl = document.getElementById("road-status");
  const edgesBtn = document.getElementById("edges-toggle");
  const collapseTab = document.getElementById("palette-collapse-tab");
  const palette = document.getElementById("palette");

  /** @type {Map<string, HTMLButtonElement>} */
  const pieceTiles = new Map();
  /** @type {Map<string, HTMLButtonElement>} */
  const catBtns = new Map();

  let activeCategory = "straight";
  let activePropId = null;

  function piecesInCategory(catId) {
    if (catId === "obstacles") {
      return propCatalog.map((p) => ({ id: p.id, label: p.label, isProp: true, hint: "" }));
    }
    return PIECE_CATALOG.filter((p) => PIECE_TO_CATEGORY[p.id] === catId);
  }

  function syncEdgesBtn() {
    if (!edgesBtn) return;
    const on = guardrailParams.enabled;
    edgesBtn.classList.toggle("on", on);
    edgesBtn.innerHTML = on ? "Edges<br>On" : "Edges<br>Off";
  }

  function renderPieces() {
    grid.innerHTML = "";
    pieceTiles.clear();
    activePropId = null;

    const items = piecesInCategory(activeCategory);
    const catLabel = PALETTE_CATEGORIES.find((c) => c.id === activeCategory)?.label ?? activeCategory;
    if (titleEl) titleEl.textContent = catLabel;

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "piece-tile";
      btn.dataset.pieceId = item.id;
      if (item.soon) {
        btn.classList.add("soon");
        btn.disabled = true;
      }
      if (item.isProp) btn.dataset.isProp = "1";

      const preview = document.createElement("div");
      preview.className = "piece-tile-preview";
      preview.innerHTML = piecePreviewSvg(item.id);

      const name = document.createElement("span");
      name.className = "piece-tile-name";
      name.textContent = item.label;

      btn.appendChild(preview);
      btn.appendChild(name);
      if (item.key && !item.soon) {
        const key = document.createElement("span");
        key.className = "piece-tile-key";
        key.textContent = item.key;
        btn.appendChild(key);
      }

      btn.addEventListener("click", () => {
        if (item.soon) return;
        if (item.isProp && onAddProp) {
          activePropId = item.id;
          builder.setActivePiece(builder.activePieceId);
          onAddProp(item.id);
          refreshStatus();
          return;
        }
        activePropId = null;
        builder.setActivePiece(item.id);
        refreshStatus();
      });

      grid.appendChild(btn);
      pieceTiles.set(item.id + (item.isProp ? ":prop" : ""), btn);
    }
    refreshStatus();
  }

  function refreshStatus() {
    if (statusEl) {
      const def = PIECE_BY_ID.get(builder.activePieceId);
      const label = def?.label ?? builder.activePieceId;
      const dir = pieceParams.curveDir >= 0 ? "R" : "L";
      const curveIds = new Set(["curve", "banked", "scurve", "spiral"]);
      statusEl.textContent = `${builder.count} placed · ${label}${
        curveIds.has(builder.activePieceId) ? " (" + dir + ")" : ""
      }${builder.freePlaceMode ? " · free place (Q/E rotate)" : ""}`;
    }
    for (const [key, btn] of pieceTiles) {
      const isProp = key.endsWith(":prop");
      const id = isProp ? key.slice(0, -5) : key;
      const active = isProp ? activePropId === id : !activePropId && id === builder.activePieceId;
      btn.classList.toggle("active", active);
    }
    for (const [id, btn] of catBtns) {
      btn.classList.toggle("active", id === activeCategory);
    }
  }

  // Category rail
  if (catList) {
    for (const cat of PALETTE_CATEGORIES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-btn";
      btn.dataset.categoryId = cat.id;
      btn.innerHTML = `
        <span class="cat-btn-icon">${categoryIconSvg(cat.id)}</span>
        <span class="cat-btn-label">${cat.label}</span>
      `;
      btn.addEventListener("click", () => {
        activeCategory = cat.id;
        renderPieces();
      });
      catList.appendChild(btn);
      catBtns.set(cat.id, btn);
    }
  }

  edgesBtn?.addEventListener("click", () => {
    guardrailParams.enabled = !guardrailParams.enabled;
    syncEdgesBtn();
    onEdgesChange?.();
  });
  syncEdgesBtn();

  collapseTab?.addEventListener("click", () => {
    palette?.classList.toggle("collapsed");
  });

  renderPieces();

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

  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    const byKey = PIECE_CATALOG.find((p) => p.key === e.key);
    if (byKey) {
      activePropId = null;
      activeCategory = PIECE_TO_CATEGORY[byKey.id] ?? activeCategory;
      renderPieces();
      builder.setActivePiece(byKey.id);
      refreshStatus();
      return;
    }
    if (e.code === "KeyR") {
      builder.flip();
      refreshStatus();
    } else if (e.code === "KeyQ" && builder.freePlaceMode && builder.isBuildMode()) {
      builder.rotateFreeYaw(Math.PI / 12);
      refreshStatus();
    } else if (e.code === "KeyE" && builder.freePlaceMode && builder.isBuildMode()) {
      builder.rotateFreeYaw(-Math.PI / 12);
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

  return { refreshStatus, renderPieces };
}
