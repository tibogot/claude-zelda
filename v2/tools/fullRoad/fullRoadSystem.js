import * as THREE from "three";
import { generateRoadGeometry } from "../../core/road/roadMesh.js";
import { createRoadUniforms, createRoadMaterial, syncRoadUniforms } from "../../core/road/roadMaterial.js";

const DIFFUSE_TEX_PATH = "../textures/asphalt_track/asphalt_track_diff_2k.jpg";
const ARM_TEX_PATH = "../textures/asphalt_track/asphalt_track_arm_2k.jpg";
const NORMAL_TEX_PATH = "../textures/asphalt_track/asphalt_track_nor_gl_2k.jpg";

const STYLE_KEYS = [
  "lineColor", "lineWidth", "lineSoftness", "lineInset",
  "edgeBlendWidth", "edgeBlendNoise",
  "centerLine", "centerLineColor", "centerLineWidth", "centerLineSoftness",
  "centerLineDashed", "centerLineDashScale",
  "doubleCenterLine", "centerLineGap",
  "centerLeftEnabled", "centerLeftColor", "centerLeftDashed",
  "centerRightEnabled", "centerRightColor", "centerRightDashed",
  "laneLines", "laneLineWidth", "laneDashScale",
  "colorTint", "colorBrightness",
  "asphaltDark", "asphaltLight", "grainScale", "grainStrength",
  "enhanced", "normalStrength", "roughnessBase", "reflectStrength",
  "mixBlur", "mixStrength", "mixContrast", "normalDistort",
  "lodNear", "lodMid", "lodFar", "texScale",
];

function extractStyle(params) {
  const style = {};
  for (const key of STYLE_KEYS) style[key] = params[key];
  return style;
}

function cloneVec3Like(p) {
  return new THREE.Vector3(p.x, p.y, p.z);
}

function distSqXZ(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function pointSegDistanceSqXZ(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lenSq = dx * dx + dz * dz;
  let t = 0;
  if (lenSq > 1e-8) {
    t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const x = a.x + dx * t;
  const z = a.z + dz * t;
  const ex = p.x - x;
  const ez = p.z - z;
  return { dSq: ex * ex + ez * ez, t, x, z };
}

function normalizeXZ(v) {
  const len = Math.hypot(v.x, v.z);
  if (len < 1e-6) return new THREE.Vector3(1, 0, 0);
  return new THREE.Vector3(v.x / len, 0, v.z / len);
}

function perpXZ(dir) {
  return new THREE.Vector3(-dir.z, 0, dir.x);
}

function angleXZ(v) {
  return Math.atan2(v.z, v.x);
}

function makeRoadParams(params, style, markingsEnabled) {
  const merged = { ...params, ...style };
  if (!markingsEnabled) {
    merged.lineWidth = 0;
    merged.centerLine = false;
    merged.laneLines = false;
    merged.edgeBlendWidth = 0;
  }
  return merged;
}

export class FullRoadSystem {
  constructor({ scene, toolState, getWorldHeight, reflectTex, terrainStore, chunkStream }) {
    this.scene = scene;
    this.toolState = toolState;
    this.getWorldHeight = getWorldHeight;
    this._reflectTex = reflectTex ?? null;
    this.terrainStore = terrainStore ?? null;
    this.chunkStream = chunkStream ?? null;

    this.nodes = [];
    this.edges = [];
    this.selectedNodeId = null;
    this.dragging = false;
    this._nextNodeId = 1;
    this._nextEdgeId = 1;

    this.meshGroup = new THREE.Group();
    this.meshGroup.name = "FullRoadMeshes";
    scene.add(this.meshGroup);
    this.handleGroup = new THREE.Group();
    this.handleGroup.name = "FullRoadHandles";
    scene.add(this.handleGroup);
    this.handleMeshes = [];

    this._diffuseTex = null;
    this._armTex = null;
    this._normalTex = null;
    this._roadUniforms = null;
    this._roadMat = null;
    this._junctionUniforms = null;
    this._junctionMat = null;
    this._lineMat = new THREE.LineBasicMaterial({ color: 0x62c4ff, transparent: true, opacity: 0.7 });
    this._junctionLineMat = new THREE.MeshBasicMaterial({
      color: 0xf2f2f2,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -12,
      polygonOffsetUnits: -12,
    });
    this._junctionCenterLineMat = new THREE.MeshBasicMaterial({
      color: 0xf0c040,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -13,
      polygonOffsetUnits: -13,
    });
    this._loadTextures();

    this.undoStack = [];
    this.redoStack = [];
  }

  _loadTextures() {
    const loader = new THREE.TextureLoader();
    let done = 0;
    const total = 3;
    const onDone = () => {
      done++;
      if (done >= total) {
        this._rebuildMaterials();
        this._rebuildVisual();
      }
    };
    loader.load(DIFFUSE_TEX_PATH, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      this._diffuseTex = tex;
      onDone();
    }, undefined, onDone);
    loader.load(ARM_TEX_PATH, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      this._armTex = tex;
      onDone();
    }, undefined, onDone);
    loader.load(NORMAL_TEX_PATH, (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      this._normalTex = tex;
      onDone();
    }, undefined, onDone);
  }

  _rebuildMaterials() {
    if (this._roadMat) this._roadMat.dispose();
    if (this._junctionMat) this._junctionMat.dispose();
    const p = this.toolState.fullRoad;
    const style = extractStyle(p);
    this._roadUniforms = createRoadUniforms(makeRoadParams(p, style, true));
    this._roadMat = createRoadMaterial(this._roadUniforms, this._diffuseTex, this._armTex, this._normalTex, this._reflectTex);
    this._junctionUniforms = createRoadUniforms(makeRoadParams(p, style, false));
    this._junctionMat = createRoadMaterial(this._junctionUniforms, this._diffuseTex, this._armTex, this._normalTex, this._reflectTex);
  }

  syncMaterial() {
    if (!this._roadMat || !this._junctionMat) this._rebuildMaterials();
    const p = this.toolState.fullRoad;
    const style = extractStyle(p);
    syncRoadUniforms(this._roadUniforms, makeRoadParams(p, style, true));
    syncRoadUniforms(this._junctionUniforms, makeRoadParams(p, style, false));
    this._junctionLineMat.color.set(p.lineColor ?? "#f2f2f2");
    this._junctionCenterLineMat.color.set(p.centerLineColor ?? "#f0c040");
    this._roadMat.needsUpdate = true;
    this._junctionMat.needsUpdate = true;
  }

  _pushUndo() {
    this.undoStack.push(this._snapshot());
    this.redoStack.length = 0;
    if (this.undoStack.length > 50) this.undoStack.shift();
  }

  _snapshot() {
    return {
      nodes: this.nodes.map(n => ({ id: n.id, x: n.position.x, y: n.position.y, z: n.position.z, forceJunction: !!n.forceJunction })),
      edges: this.edges.map(e => ({ id: e.id, a: e.a, b: e.b })),
      selectedNodeId: this.selectedNodeId,
      nextNodeId: this._nextNodeId,
      nextEdgeId: this._nextEdgeId,
    };
  }

  _restore(snap) {
    this.nodes = snap.nodes.map(n => ({
      id: n.id,
      position: new THREE.Vector3(n.x, n.y, n.z),
      forceJunction: !!n.forceJunction,
    }));
    this.edges = snap.edges.map(e => ({ id: e.id, a: e.a, b: e.b }));
    this.selectedNodeId = snap.selectedNodeId ?? null;
    this._nextNodeId = snap.nextNodeId ?? (Math.max(0, ...this.nodes.map(n => n.id)) + 1);
    this._nextEdgeId = snap.nextEdgeId ?? (Math.max(0, ...this.edges.map(e => e.id)) + 1);
    this._rebuildVisual();
    this._updateSelectedY();
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

  _nodeById(id) {
    return this.nodes.find(n => n.id === id) ?? null;
  }

  _degreeMap() {
    const degree = new Map(this.nodes.map(n => [n.id, 0]));
    for (const edge of this.edges) {
      degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
    }
    return degree;
  }

  _adjacencyMap() {
    const adj = new Map(this.nodes.map(n => [n.id, []]));
    for (const edge of this.edges) {
      adj.get(edge.a)?.push({ edge, otherId: edge.b });
      adj.get(edge.b)?.push({ edge, otherId: edge.a });
    }
    return adj;
  }

  _isJunctionNode(nodeId, degree = null) {
    const node = this._nodeById(nodeId);
    if (!node) return false;
    const deg = degree?.get(nodeId) ?? this.edges.filter(e => e.a === nodeId || e.b === nodeId).length;
    return node.forceJunction || deg >= 3;
  }

  _buildRoadPaths(degree = this._degreeMap()) {
    const adj = this._adjacencyMap();
    const visitedEdges = new Set();
    const paths = [];
    
    // At junctions, find "through" pairs (most opposite edges) so we can continue through them
    const throughPairs = new Map(); // nodeId -> Map<edgeId, oppositeEdgeId>
    for (const node of this.nodes) {
      if (!this._isJunctionNode(node.id, degree)) continue;
      const links = adj.get(node.id) ?? [];
      if (links.length < 2) continue;
      
      // Find the most opposite pair
      let bestPair = null;
      let bestDot = 0;
      for (let i = 0; i < links.length; i++) {
        for (let j = i + 1; j < links.length; j++) {
          const otherA = this._nodeById(links[i].otherId);
          const otherB = this._nodeById(links[j].otherId);
          if (!otherA || !otherB) continue;
          const dirA = normalizeXZ(otherA.position.clone().sub(node.position));
          const dirB = normalizeXZ(otherB.position.clone().sub(node.position));
          const dot = dirA.dot(dirB);
          if (dot < bestDot) {
            bestDot = dot;
            bestPair = [links[i].edge.id, links[j].edge.id];
          }
        }
      }
      if (bestPair && bestDot < -0.5) {
        const pairMap = new Map();
        pairMap.set(bestPair[0], bestPair[1]);
        pairMap.set(bestPair[1], bestPair[0]);
        throughPairs.set(node.id, pairMap);
      }
    }
    
    const isTerminal = (nodeId) => {
      const deg = degree.get(nodeId) ?? 0;
      if (deg === 1) return true; // Dead end
      if (deg === 2 && !this._nodeById(nodeId)?.forceJunction) return false; // Continue through
      return true; // Junction or forced junction
    };
    
    const canContinueThrough = (nodeId, fromEdgeId) => {
      const pairMap = throughPairs.get(nodeId);
      if (!pairMap) return null;
      const oppositeEdgeId = pairMap.get(fromEdgeId);
      if (oppositeEdgeId && !visitedEdges.has(oppositeEdgeId)) {
        return this.edges.find(e => e.id === oppositeEdgeId) ?? null;
      }
      return null;
    };

    const walk = (startId, firstLink, closed = false) => {
      const nodeIds = [startId];
      const edgeIds = [];
      let prevId = startId;
      let link = firstLink;
      let guard = 0;
      while (link && guard++ < this.edges.length + 2) {
        visitedEdges.add(link.edge.id);
        edgeIds.push(link.edge.id);
        const nextId = link.otherId;
        nodeIds.push(nextId);
        if (closed && nextId === startId) break;
        
        // Check if we can continue through a junction
        const throughEdge = canContinueThrough(nextId, link.edge.id);
        if (throughEdge) {
          link = { edge: throughEdge, otherId: throughEdge.a === nextId ? throughEdge.b : throughEdge.a };
          prevId = nextId;
          continue;
        }
        
        if (!closed && isTerminal(nextId)) break;
        
        const links = adj.get(nextId) ?? [];
        link = links.find(l => l.otherId !== prevId && !visitedEdges.has(l.edge.id));
        prevId = nextId;
      }
      if (nodeIds.length >= 2) paths.push({ nodeIds, edgeIds, closed });
    };

    // Start from terminals and dead ends
    for (const node of this.nodes) {
      const deg = degree.get(node.id) ?? 0;
      if (deg !== 1 && deg !== 0) continue; // Only start from dead ends
      for (const link of adj.get(node.id) ?? []) {
        if (!visitedEdges.has(link.edge.id)) walk(node.id, link, false);
      }
    }
    
    // Start from junctions for branches that weren't part of through-roads
    for (const node of this.nodes) {
      if (!this._isJunctionNode(node.id, degree)) continue;
      for (const link of adj.get(node.id) ?? []) {
        if (!visitedEdges.has(link.edge.id)) walk(node.id, link, false);
      }
    }

    // Handle closed loops
    for (const edge of this.edges) {
      if (visitedEdges.has(edge.id)) continue;
      walk(edge.a, { edge, otherId: edge.b }, true);
    }

    return paths;
  }

  _createNode(pos) {
    const node = {
      id: this._nextNodeId++,
      position: pos.clone(),
      forceJunction: false,
    };
    this.nodes.push(node);
    return node;
  }

  _createEdge(a, b) {
    if (a === b || this._edgeBetween(a, b)) return null;
    const edge = { id: this._nextEdgeId++, a, b };
    this.edges.push(edge);
    return edge;
  }

  _edgeBetween(a, b) {
    return this.edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a)) ?? null;
  }

  _findNearestNode(pos, radius) {
    const maxSq = radius * radius;
    let best = null;
    let bestSq = maxSq;
    for (const node of this.nodes) {
      const dSq = distSqXZ(pos, node.position);
      if (dSq <= bestSq) {
        best = node;
        bestSq = dSq;
      }
    }
    return best;
  }

  _findNearestEdge(pos, radius) {
    const maxSq = radius * radius;
    let best = null;
    let bestSq = maxSq;
    for (const edge of this.edges) {
      const hit = this._nearestPointOnEdgeCurve(pos, edge, 32);
      if (hit.dSq < bestSq && hit.t > 0.06 && hit.t < 0.94) {
        bestSq = hit.dSq;
        best = { edge, hit };
      }
    }
    return best;
  }

  _splitEdge(edge, pos) {
    const idx = this.edges.indexOf(edge);
    if (idx < 0) return null;
    const a = this._nodeById(edge.a);
    const b = this._nodeById(edge.b);
    if (!a || !b) return null;
    const hit = this._nearestPointOnEdgeCurve(pos, edge, 48);
    const y = hit.y;
    const node = this._createNode(new THREE.Vector3(hit.x, y, hit.z));
    node.forceJunction = true;
    this.edges.splice(idx, 1);
    this._createEdge(a.id, node.id);
    this._createEdge(node.id, b.id);
    return node;
  }

  _resolveAnchor(pos) {
    const p = this.toolState.fullRoad;
    const snapNode = this._findNearestNode(pos, Math.max(0.1, p.nodeSnapRadius));
    if (snapNode) return snapNode;
    
    // Use path curve (CatmullRom) for snapping, not edge curve (bezier)
    // This ensures the split point lies exactly on the rendered road
    const pathHit = this._findNearestPathPoint(pos, Math.max(0.1, p.branchSnapRadius));
    if (pathHit) {
      return this._splitEdgeAtPosition(pathHit.edge, pathHit);
    }
    
    return this._createNode(pos);
  }
  
  _splitEdgeAtPosition(edge, hit) {
    const idx = this.edges.indexOf(edge);
    if (idx < 0) return null;
    const a = this._nodeById(edge.a);
    const b = this._nodeById(edge.b);
    if (!a || !b) return null;
    
    // Use the exact position from the path curve hit
    const node = this._createNode(new THREE.Vector3(hit.x, hit.y, hit.z));
    node.forceJunction = true;
    this.edges.splice(idx, 1);
    this._createEdge(a.id, node.id);
    this._createEdge(node.id, b.id);
    return node;
  }

  _edgeCurveInfo(edge) {
    const a = this._nodeById(edge.a);
    const b = this._nodeById(edge.b);
    if (!a || !b) return null;
    const adj = this._adjacencyMap();
    const degree = this._degreeMap();
    const len = Math.max(1e-6, a.position.distanceTo(b.position));

    const prev = this._smoothNeighbor(a.id, b.id, adj, degree);
    const next = this._smoothNeighbor(b.id, a.id, adj, degree);
    const dirA = prev
      ? normalizeXZ(b.position.clone().sub(prev.position))
      : normalizeXZ(b.position.clone().sub(a.position));
    const dirB = next
      ? normalizeXZ(next.position.clone().sub(a.position))
      : normalizeXZ(b.position.clone().sub(a.position));
    const handle = Math.min(len * 0.38, Math.max(2, this.toolState.fullRoad.width * 0.8));
    const c1 = a.position.clone().add(dirA.clone().multiplyScalar(handle));
    const c2 = b.position.clone().sub(dirB.clone().multiplyScalar(handle));
    const curve = new THREE.CubicBezierCurve3(a.position, c1, c2, b.position);
    return { curve, a, b, dirA, dirB };
  }

  _smoothNeighbor(nodeId, excludeId, adj, degree) {
    if (this._isJunctionNode(nodeId, degree)) return null;
    const links = adj.get(nodeId) ?? [];
    if (links.length !== 2) return null;
    const link = links.find(l => l.otherId !== excludeId);
    return link ? this._nodeById(link.otherId) : null;
  }

  _nearestPointOnEdgeCurve(pos, edge, samples) {
    const info = this._edgeCurveInfo(edge);
    if (!info) return { dSq: Infinity, t: 0, x: pos.x, y: pos.y, z: pos.z };
    const pts = info.curve.getSpacedPoints(samples);
    let best = { dSq: Infinity, t: 0, x: pts[0].x, y: pts[0].y, z: pts[0].z };
    for (let i = 0; i < pts.length - 1; i++) {
      const hit = pointSegDistanceSqXZ(pos, pts[i], pts[i + 1]);
      if (hit.dSq >= best.dSq) continue;
      const globalT = (i + hit.t) / Math.max(1, pts.length - 1);
      const y = pts[i].y * (1 - hit.t) + pts[i + 1].y * hit.t;
      best = { ...hit, t: globalT, y };
    }
    return best;
  }
  
  // Find nearest point on any PATH curve (CatmullRom), not edge curve (bezier)
  // This ensures split points lie exactly on the rendered road
  _findNearestPathPoint(pos, radius) {
    const maxSq = radius * radius;
    const paths = this._buildRoadPaths();
    let best = null;
    
    for (const path of paths) {
      const curve = this._curveForPath(path);
      if (!curve) continue;
      
      const pts = curve.getSpacedPoints(Math.max(32, path.nodeIds.length * 16));
      for (let i = 0; i < pts.length - 1; i++) {
        const hit = pointSegDistanceSqXZ(pos, pts[i], pts[i + 1]);
        if (hit.dSq >= maxSq || (best && hit.dSq >= best.dSq)) continue;
        
        const globalT = (i + hit.t) / Math.max(1, pts.length - 1);
        // Don't allow splits too close to path endpoints
        if (globalT < 0.05 || globalT > 0.95) continue;
        
        const y = pts[i].y * (1 - hit.t) + pts[i + 1].y * hit.t;
        
        // Find which edge in the path this t value corresponds to
        const edgeCount = path.edgeIds.length;
        const edgeIndex = Math.min(edgeCount - 1, Math.floor(globalT * edgeCount));
        const edgeId = path.edgeIds[edgeIndex];
        const edge = this.edges.find(e => e.id === edgeId);
        
        // Check t is not too close to nodes within the edge
        const localT = (globalT * edgeCount) - edgeIndex;
        if (localT < 0.06 || localT > 0.94) continue;
        
        if (edge) {
          best = {
            dSq: hit.dSq,
            x: hit.x,
            y,
            z: hit.z,
            edge,
            path,
            globalT,
          };
        }
      }
    }
    return best;
  }

  addOrConnect(pos) {
    this._pushUndo();
    if (!this.nodes.length) {
      const first = this._createNode(pos);
      this.selectedNodeId = first.id;
      this._rebuildVisual();
      this._updateSelectedY();
      return;
    }
    const anchor = this._resolveAnchor(pos);
    if (!anchor) return;
    if (this.selectedNodeId != null && this.selectedNodeId !== anchor.id) {
      this._createEdge(this.selectedNodeId, anchor.id);
    }
    this.selectedNodeId = anchor.id;
    this._rebuildVisual();
    this._updateSelectedY();
  }

  startBranch() {
    this.selectedNodeId = null;
    this._rebuildHandles();
    this._updateSelectedY();
  }

  toggleSelectedJunction() {
    const node = this._nodeById(this.selectedNodeId);
    if (!node) return;
    this._pushUndo();
    node.forceJunction = !node.forceJunction;
    this._rebuildVisual();
  }

  pickNode(raycaster) {
    const hits = raycaster.intersectObjects(this.handleMeshes, false);
    if (hits.length === 0) return null;
    return hits[0].object.userData.nodeId ?? null;
  }

  moveSelected(pos) {
    const node = this._nodeById(this.selectedNodeId);
    if (!node) return;
    const y = node.position.y;
    node.position.copy(pos);
    node.position.y = y;
    this._rebuildVisual();
  }

  setSelectedPointY(y) {
    const node = this._nodeById(this.selectedNodeId);
    if (!node) return;
    node.position.y = y;
    this._rebuildVisual();
    this._updateSelectedY();
  }

  snapSelectedYToTerrain() {
    const node = this._nodeById(this.selectedNodeId);
    if (!node) return;
    this._pushUndo();
    node.position.y = this.getWorldHeight(node.position.x, node.position.z);
    this._rebuildVisual();
    this._updateSelectedY();
  }

  deleteSelected() {
    if (this.selectedNodeId == null) return;
    this._pushUndo();
    this.edges = this.edges.filter(e => e.a !== this.selectedNodeId && e.b !== this.selectedNodeId);
    this.nodes = this.nodes.filter(n => n.id !== this.selectedNodeId);
    this.selectedNodeId = this.nodes.at(-1)?.id ?? null;
    this._rebuildVisual();
    this._updateSelectedY();
  }

  clearAll() {
    if (!this.nodes.length && !this.edges.length) return;
    this._pushUndo();
    this.nodes = [];
    this.edges = [];
    this.selectedNodeId = null;
    this._rebuildVisual();
  }

  flattenTerrainUnderRoads() {
    if (!this.terrainStore || !this.chunkStream) return;
    const p = this.toolState.fullRoad;
    const dirtyChunks = new Map();
    for (const path of this._buildRoadPaths()) {
      const curve = this._curveForPath(path);
      if (!curve) continue;
      this.terrainStore.flattenUnderRoad(curve, p.width, p.segments, p.heightOffset, dirtyChunks);
    }
    if (dirtyChunks.size > 0) this.chunkStream.markDirtyRects(dirtyChunks);
  }

  _curveForEdge(edge) {
    return this._edgeCurveInfo(edge)?.curve ?? null;
  }

  _curveForPath(path) {
    const pts = path.nodeIds
      .map(id => this._nodeById(id)?.position)
      .filter(Boolean);
    if (pts.length < 2) return null;
    return new THREE.CatmullRomCurve3(pts, !!path.closed, "catmullrom", 0.5);
  }

  rebuildAllMeshes() {
    this._clearGroup(this.meshGroup);
    if (!this._roadMat) this._rebuildMaterials();
    const p = this.toolState.fullRoad;
    const degree = this._degreeMap();

    // Collect all road geometries and merge into ONE mesh
    // This completely eliminates z-fighting since it's one unified surface
    
    const roadPaths = this._buildRoadPaths(degree);
    const geometries = [];
    
    for (const path of roadPaths) {
      const curve = this._curveForPath(path);
      if (!curve) continue;
      
      const geo = generateRoadGeometry(
        curve,
        p.width,
        Math.max(6, p.segments | 0),
        p.heightOffset,
        this.getWorldHeight,
        null,
        {
          adaptiveLift: p.adaptiveLift,
          slopeLift: p.slopeLift,
          liftMax: p.liftMax,
          startT: 0,
          endT: 1,
          arcOffset: 0,
        },
      );
      geometries.push(geo);
    }
    
    if (geometries.length === 0) return;
    
    // Merge all geometries into one
    const mergedGeo = this._mergeGeometries(geometries);
    if (!mergedGeo) return;
    
    // Mark vertices near junction nodes with aJunction = 1.0 to hide lines
    this._markJunctionVertices(mergedGeo, degree, p.width);
    
    const mesh = new THREE.Mesh(mergedGeo, this._roadMat);
    mesh.name = "FullRoadMerged";
    mesh.receiveShadow = true;
    mesh.renderOrder = 3;
    this.meshGroup.add(mesh);
    
    // Dispose individual geometries
    for (const geo of geometries) geo.dispose();
  }
  
  _markJunctionVertices(geo, degree, roadWidth) {
    const junctionAttr = geo.getAttribute("aJunction");
    const posAttr = geo.getAttribute("position");
    if (!junctionAttr || !posAttr) return;
    
    // Collect junction node positions
    const junctionPositions = [];
    for (const node of this.nodes) {
      if (this._isJunctionNode(node.id, degree)) {
        junctionPositions.push(node.position);
      }
    }
    if (junctionPositions.length === 0) return;
    
    const junctionRadiusSq = (roadWidth * 0.8) ** 2;
    const fadeRadiusSq = (roadWidth * 1.5) ** 2;
    const juncArr = junctionAttr.array;
    const posArr = posAttr.array;
    
    // Track which vertices are near junctions and by how much
    const liftAmounts = new Float32Array(posAttr.count);
    
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posArr[i * 3];
      const vz = posArr[i * 3 + 2];
      
      for (const jp of junctionPositions) {
        const dx = vx - jp.x;
        const dz = vz - jp.z;
        const distSq = dx * dx + dz * dz;
        
        if (distSq < junctionRadiusSq) {
          juncArr[i] = 1.0;
          // Slight lift to prevent z-fighting (smooth falloff from center)
          const dist = Math.sqrt(distSq);
          const juncRadius = roadWidth * 0.8;
          const lift = 0.02 * (1 - dist / juncRadius);
          liftAmounts[i] = Math.max(liftAmounts[i], lift);
          break;
        } else if (distSq < fadeRadiusSq) {
          const t = (distSq - junctionRadiusSq) / (fadeRadiusSq - junctionRadiusSq);
          juncArr[i] = Math.max(juncArr[i], 1.0 - t);
          // Small lift in fade zone too
          const lift = 0.01 * (1 - t);
          liftAmounts[i] = Math.max(liftAmounts[i], lift);
        }
      }
    }
    
    // Apply lifts
    for (let i = 0; i < posAttr.count; i++) {
      if (liftAmounts[i] > 0) {
        posArr[i * 3 + 1] += liftAmounts[i];
      }
    }
    
    junctionAttr.needsUpdate = true;
    posAttr.needsUpdate = true;
  }
  
  _mergeGeometries(geometries) {
    if (geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0].clone();
    
    // Collect all attributes
    let totalVerts = 0;
    let totalIndices = 0;
    for (const geo of geometries) {
      totalVerts += geo.getAttribute("position").count;
      totalIndices += geo.index ? geo.index.count : 0;
    }
    
    const positions = new Float32Array(totalVerts * 3);
    const uvs = new Float32Array(totalVerts * 2);
    const junctions = new Float32Array(totalVerts);
    const indices = [];
    
    let vertOffset = 0;
    let idxOffset = 0;
    
    for (const geo of geometries) {
      const pos = geo.getAttribute("position");
      const uv = geo.getAttribute("uv");
      const junc = geo.getAttribute("aJunction");
      const idx = geo.index;
      
      // Copy positions
      for (let i = 0; i < pos.count; i++) {
        positions[(vertOffset + i) * 3] = pos.getX(i);
        positions[(vertOffset + i) * 3 + 1] = pos.getY(i);
        positions[(vertOffset + i) * 3 + 2] = pos.getZ(i);
      }
      
      // Copy UVs
      if (uv) {
        for (let i = 0; i < uv.count; i++) {
          uvs[(vertOffset + i) * 2] = uv.getX(i);
          uvs[(vertOffset + i) * 2 + 1] = uv.getY(i);
        }
      }
      
      // Copy junction attribute
      if (junc) {
        for (let i = 0; i < junc.count; i++) {
          junctions[vertOffset + i] = junc.getX(i);
        }
      }
      
      // Copy indices with offset
      if (idx) {
        for (let i = 0; i < idx.count; i++) {
          indices.push(idx.getX(i) + vertOffset);
        }
      }
      
      vertOffset += pos.count;
    }
    
    const merged = new THREE.BufferGeometry();
    merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    merged.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    merged.setAttribute("aJunction", new THREE.Float32BufferAttribute(junctions, 1));
    merged.setIndex(indices);
    merged.computeVertexNormals();
    
    return merged;
  }

  _junctionLinks(node) {
    const p = this.toolState.fullRoad;
    return this.edges
      .filter(edge => edge.a === node.id || edge.b === node.id)
      .map((edge) => {
        const atStart = edge.a === node.id;
        const other = this._nodeById(atStart ? edge.b : edge.a);
        if (!other) return null;
        const outward = normalizeXZ(other.position.clone().sub(node.position));
        const side = perpXZ(outward);
        const trim = Math.max(p.junctionRadius, p.width * 0.65);
        const center = node.position.clone().add(outward.clone().multiplyScalar(trim));
        return {
          angle: angleXZ(outward),
          outward,
          center,
          left: center.clone().add(side.clone().multiplyScalar(p.width * 0.5)),
          right: center.clone().add(side.clone().multiplyScalar(-p.width * 0.5)),
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.angle - b.angle);
  }

  _makeJunctionGeometry(node, links, _segments) {
    const p = this.toolState.fullRoad;
    if (links.length < 2) return null;

    const boundary = this._junctionBoundary(node, links);
    if (boundary.length < 3) return null;

    const center = this._polygonCentroid(boundary, node.position);
    const positions = [center.x, this.getWorldHeight(center.x, center.z) + p.heightOffset, center.z];
    const uvs = [0.5, 0.5];
    const junction = [1];
    const indices = [];
    const maxRadius = Math.max(p.width, p.junctionRadius) * 1.5;
    for (const bp of boundary) {
      const dx = bp.x - center.x;
      const dz = bp.z - center.z;
      const x = bp.x;
      const z = bp.z;
      positions.push(x, this.getWorldHeight(x, z) + p.heightOffset, z);
      uvs.push(0.5 + dx / maxRadius * 0.5, 0.5 + dz / maxRadius * 0.5);
      junction.push(1);
    }
    for (let i = 0; i < boundary.length; i++) {
      const next = i === boundary.length - 1 ? 1 : i + 2;
      indices.push(0, i + 1, next);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute("aJunction", new THREE.Float32BufferAttribute(junction, 1));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  _junctionBoundary(node, links) {
    if (links.length === 4 && this._isGridLikeJunction(links)) {
      return this._gridJunctionRect(node, links);
    }
    const pts = [];
    for (const link of links) pts.push(link.right, link.left);
    return this._convexHullXZ(pts);
  }

  _isGridLikeJunction(links) {
    let oppositePairs = 0;
    for (let i = 0; i < links.length; i++) {
      for (let j = i + 1; j < links.length; j++) {
        if (links[i].outward.dot(links[j].outward) < -0.82) oppositePairs++;
      }
    }
    return oppositePairs >= 2;
  }

  _gridJunctionRect(node, links) {
    const axisU = links[0].outward.clone();
    let axisV = links[1].outward.clone();
    let bestAbsDot = Math.abs(axisU.dot(axisV));
    for (let i = 1; i < links.length; i++) {
      const absDot = Math.abs(axisU.dot(links[i].outward));
      if (absDot < bestAbsDot) {
        axisV = links[i].outward.clone();
        bestAbsDot = absDot;
      }
    }
    const u = normalizeXZ(axisU);
    const v = normalizeXZ(axisV.sub(u.clone().multiplyScalar(axisV.dot(u))));
    const pts = links.flatMap(link => [link.left, link.right]);
    let extentU = 0;
    let extentV = 0;
    for (const pt of pts) {
      const rel = pt.clone().sub(node.position);
      extentU = Math.max(extentU, Math.abs(rel.dot(u)));
      extentV = Math.max(extentV, Math.abs(rel.dot(v)));
    }
    extentU += 0.2;
    extentV += 0.2;
    return [
      node.position.clone().add(u.clone().multiplyScalar(extentU)).add(v.clone().multiplyScalar(extentV)),
      node.position.clone().add(u.clone().multiplyScalar(-extentU)).add(v.clone().multiplyScalar(extentV)),
      node.position.clone().add(u.clone().multiplyScalar(-extentU)).add(v.clone().multiplyScalar(-extentV)),
      node.position.clone().add(u.clone().multiplyScalar(extentU)).add(v.clone().multiplyScalar(-extentV)),
    ];
  }

  _convexHullXZ(points) {
    if (points.length <= 3) return [...points];
    const sorted = [...points].sort((a, b) => a.x === b.x ? a.z - b.z : a.x - b.x);
    const cross = (o, a, b) => (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x);
    const lower = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  _polygonCentroid(points, fallback) {
    if (!points.length) return fallback.clone();
    const c = new THREE.Vector3();
    for (const p of points) c.add(p);
    return c.multiplyScalar(1 / points.length);
  }

  _makeJunctionMarkings(_node, links) {
    const p = this.toolState.fullRoad;
    const meshes = [];
    const used = new Set();
    const lineWidth = Math.max(0.08, p.lineWidth * p.width);
    const centerWidth = Math.max(0.08, p.centerLineWidth * p.width);
    for (let i = 0; i < links.length; i++) {
      if (used.has(i)) continue;
      let bestJ = -1;
      let bestDot = -0.72;
      for (let j = i + 1; j < links.length; j++) {
        if (used.has(j)) continue;
        const dot = links[i].outward.dot(links[j].outward);
        if (dot < bestDot) {
          bestDot = dot;
          bestJ = j;
        }
      }
      if (bestJ < 0) continue;
      used.add(i);
      used.add(bestJ);
      const a = links[i];
      const b = links[bestJ];
      if (p.lineWidth > 0) {
        meshes.push(this._makeLineStrip(a.left, b.right, lineWidth, this._junctionLineMat));
        meshes.push(this._makeLineStrip(a.right, b.left, lineWidth, this._junctionLineMat));
      }
      if (p.centerLine) {
        meshes.push(this._makeLineStrip(a.center, b.center, centerWidth, this._junctionCenterLineMat));
      }
    }
    return meshes.filter(Boolean);
  }

  _makeLineStrip(a, b, width, material) {
    const dir = normalizeXZ(b.clone().sub(a));
    const side = perpXZ(dir).multiplyScalar(width * 0.5);
    const yLift = this.toolState.fullRoad.heightOffset + 0.035;
    const p0 = a.clone().add(side);
    const p1 = a.clone().sub(side);
    const p2 = b.clone().add(side);
    const p3 = b.clone().sub(side);
    const positions = [
      p0.x, this.getWorldHeight(p0.x, p0.z) + yLift, p0.z,
      p2.x, this.getWorldHeight(p2.x, p2.z) + yLift, p2.z,
      p1.x, this.getWorldHeight(p1.x, p1.z) + yLift, p1.z,
      p1.x, this.getWorldHeight(p1.x, p1.z) + yLift, p1.z,
      p2.x, this.getWorldHeight(p2.x, p2.z) + yLift, p2.z,
      p3.x, this.getWorldHeight(p3.x, p3.z) + yLift, p3.z,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = "FullRoadJunctionMarking";
    mesh.renderOrder = 6;
    return mesh;
  }

  _rebuildHandles() {
    this._clearGroup(this.handleGroup);
    this.handleMeshes = [];
    const degree = this._degreeMap();
    const selected = this.selectedNodeId;
    for (const path of this._buildRoadPaths(degree)) {
      const curve = this._curveForPath(path);
      if (!curve) continue;
      const geo = new THREE.BufferGeometry().setFromPoints(curve.getSpacedPoints(32));
      const line = new THREE.Line(geo, this._lineMat);
      line.raycast = () => {};
      this.handleGroup.add(line);
    }
    for (const node of this.nodes) {
      const deg = degree.get(node.id) ?? 0;
      const isJunction = node.forceJunction || deg >= 3;
      const color = node.id === selected ? 0xffff00 : isJunction ? 0xbd6cff : 0x44b8ff;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(isJunction ? 0.78 : 0.58, 12, 8),
        new THREE.MeshBasicMaterial({ color }),
      );
      sphere.position.copy(node.position);
      sphere.userData.nodeId = node.id;
      this.handleGroup.add(sphere);
      this.handleMeshes.push(sphere);
    }
    this._syncHandlesVisibility();
  }

  _syncHandlesVisibility() {
    this.handleGroup.visible = this.toolState.mode === "fullRoad" && this.toolState.fullRoad.showHandles;
  }

  _rebuildVisual() {
    this.rebuildAllMeshes();
    this._rebuildHandles();
  }

  _clearGroup(group) {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (
        child.material &&
        child.material !== this._roadMat &&
        child.material !== this._junctionMat &&
        child.material !== this._lineMat &&
        child.material !== this._junctionLineMat &&
        child.material !== this._junctionCenterLineMat
      ) {
        child.material.dispose();
      }
    }
  }

  _updateSelectedY() {
    const node = this._nodeById(this.selectedNodeId);
    if (node) this.toolState.fullRoad.selectedPointY = node.position.y;
  }

  getRoadMeshes() {
    return this.meshGroup.children.filter(child => child.isMesh);
  }

  getAverageY() {
    if (!this.nodes.length) return 0;
    return this.nodes.reduce((sum, n) => sum + n.position.y, 0) / this.nodes.length;
  }

  hasReflectiveRoads() {
    const p = this.toolState.fullRoad;
    return !!p.enhanced && (p.reflectStrength ?? 0) > 0 && this.edges.length > 0;
  }

  updateReflectVP(matrix) {
    if (this._roadUniforms) this._roadUniforms.uReflectVP.value.copy(matrix);
    if (this._junctionUniforms) this._junctionUniforms.uReflectVP.value.copy(matrix);
  }

  exportData() {
    return {
      nodes: this.nodes.map(n => ({
        id: n.id,
        x: n.position.x,
        y: n.position.y,
        z: n.position.z,
        forceJunction: !!n.forceJunction,
      })),
      edges: this.edges.map(e => ({ id: e.id, a: e.a, b: e.b })),
      selectedNodeId: this.selectedNodeId,
      nextNodeId: this._nextNodeId,
      nextEdgeId: this._nextEdgeId,
    };
  }

  importData(data) {
    this.nodes = Array.isArray(data?.nodes)
      ? data.nodes.map(n => ({
        id: Number(n.id),
        position: cloneVec3Like(n),
        forceJunction: !!n.forceJunction,
      })).filter(n => Number.isFinite(n.id))
      : [];
    const nodeIds = new Set(this.nodes.map(n => n.id));
    this.edges = Array.isArray(data?.edges)
      ? data.edges
        .map(e => ({ id: Number(e.id), a: Number(e.a), b: Number(e.b) }))
        .filter(e => Number.isFinite(e.id) && nodeIds.has(e.a) && nodeIds.has(e.b) && e.a !== e.b)
      : [];
    this.selectedNodeId = nodeIds.has(data?.selectedNodeId) ? data.selectedNodeId : null;
    this._nextNodeId = Math.max(data?.nextNodeId ?? 1, Math.max(0, ...this.nodes.map(n => n.id)) + 1);
    this._nextEdgeId = Math.max(data?.nextEdgeId ?? 1, Math.max(0, ...this.edges.map(e => e.id)) + 1);
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this._rebuildVisual();
    this._updateSelectedY();
  }

  dispose() {
    this._clearGroup(this.meshGroup);
    this._clearGroup(this.handleGroup);
    this.scene.remove(this.meshGroup);
    this.scene.remove(this.handleGroup);
    if (this._roadMat) this._roadMat.dispose();
    if (this._junctionMat) this._junctionMat.dispose();
    this._lineMat.dispose();
    this._junctionLineMat.dispose();
    this._junctionCenterLineMat.dispose();
  }
}
