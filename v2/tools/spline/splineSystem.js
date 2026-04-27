import * as THREE from "three";
import {
  chunkKey,
  chunkMinWorldX,
  chunkMinWorldZ,
  getChunkCountPerAxis,
  getChunkDataIndex,
  worldToChunkIndex,
} from "../../core/terrain/chunkMath.js";

export class SplineSystem {
  constructor({
    scene,
    toolState,
    config,
    terrainStore,
    chunkStream,
    treeStore,
    propStore,
    getWorldHeight,
  }) {
    this.scene = scene;
    this.toolState = toolState;
    this.config = config;
    this.terrainStore = terrainStore;
    this.chunkStream = chunkStream;
    this.treeStore = treeStore;
    this.propStore = propStore;
    this.getWorldHeight = getWorldHeight;

    this.points = [];
    this.selectedIdx = -1;
    this.dragging = false;
    this.pointMeshes = [];
    this._curve = null;
    this._curveLength = 0;
    this._trainT = 0;
    this.tunnels = [];

    this.handleGroup = new THREE.Group();
    this.handleGroup.name = "SplineHandles";
    scene.add(this.handleGroup);

    this.previewGroup = new THREE.Group();
    this.previewGroup.name = "SplinePreview";
    scene.add(this.previewGroup);

    this.trainMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.8, 3.2),
      new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.9 }),
    );
    this.trainMesh.visible = false;
    scene.add(this.trainMesh);

    this.undoStack = [];
    this.redoStack = [];
  }

  _snapshot() {
    return {
      points: this.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      selectedIdx: this.selectedIdx,
    };
  }

  _pushUndo() {
    this.undoStack.push(this._snapshot());
    this.redoStack.length = 0;
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  _restore(snap) {
    this.points = snap.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    this.selectedIdx = snap.selectedIdx;
    this.dragging = false;
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

  _makeCurve() {
    if (this.points.length < 2) return null;
    return new THREE.CatmullRomCurve3(
      this.points,
      !!this.toolState.spline.closed,
      "catmullrom",
      0.5,
    );
  }

  _disposeGroup(group) {
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
  }

  _syncVisibility() {
    const inMode = this.toolState.mode === "spline";
    this.handleGroup.visible = inMode && this.toolState.spline.showHandles;
    if (!inMode) this.dragging = false;
  }

  _rebuildVisual() {
    this._disposeGroup(this.handleGroup);
    this.pointMeshes = [];
    this._curve = null;
    this._curveLength = 0;

    if (this.points.length >= 2) {
      this._curve = this._makeCurve();
      this._curveLength = this._curve?.getLength() ?? 0;
      if (this._curve) {
        const pts = this._curve.getPoints(Math.max(60, this.points.length * 20));
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: 0x00ccff }),
        );
        this.handleGroup.add(line);
      }
    }

    for (let i = 0; i < this.points.length; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 10, 8),
        new THREE.MeshBasicMaterial({ color: i === this.selectedIdx ? 0xffff00 : 0xff4400 }),
      );
      mesh.position.copy(this.points[i]);
      this.handleGroup.add(mesh);
      this.pointMeshes.push(mesh);
    }

    this._syncVisibility();
  }

  _updateSelectedY() {
    if (this.selectedIdx >= 0 && this.selectedIdx < this.points.length) {
      this.toolState.spline.selectedPointY = this.points[this.selectedIdx].y;
    }
  }

  setClosed(closed) {
    this.toolState.spline.closed = !!closed;
    this._rebuildVisual();
  }

  setSelectedPointY(y) {
    if (this.selectedIdx < 0 || this.selectedIdx >= this.points.length) return;
    this.points[this.selectedIdx].y = y;
    this._rebuildVisual();
  }

  addPoint(pos) {
    this._pushUndo();
    this.points.push(pos.clone());
    this.selectedIdx = this.points.length - 1;
    this._rebuildVisual();
    this._updateSelectedY();
  }

  moveSelected(pos) {
    if (this.selectedIdx < 0 || this.selectedIdx >= this.points.length) return;
    const y = this.points[this.selectedIdx].y;
    this.points[this.selectedIdx].copy(pos);
    this.points[this.selectedIdx].y = y;
    this._rebuildVisual();
  }

  deleteSelected() {
    if (this.selectedIdx < 0 || this.selectedIdx >= this.points.length) return;
    this._pushUndo();
    this.points.splice(this.selectedIdx, 1);
    this.selectedIdx = Math.min(this.selectedIdx, this.points.length - 1);
    this._rebuildVisual();
    this._updateSelectedY();
  }

  clearAll() {
    if (this.points.length === 0) return;
    this._pushUndo();
    this.points = [];
    this.selectedIdx = -1;
    this.dragging = false;
    this.clearPreview();
    this._rebuildVisual();
  }

  pickPoint(raycaster) {
    const hits = raycaster.intersectObjects(this.pointMeshes, false);
    if (hits.length === 0) return -1;
    return this.pointMeshes.indexOf(hits[0].object);
  }

  _samples() {
    const curve = this._makeCurve();
    if (!curve) return [];
    const spacing = Math.max(0.25, this.toolState.spline.spacing);
    const total = curve.getLength();
    const count = Math.max(1, Math.floor(total / spacing));
    const out = [];
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      const pos = curve.getPoint(t);
      const tan = curve.getTangent(t);
      out.push({ pos, angleY: Math.atan2(tan.x, tan.z) });
    }
    return out;
  }

  preview() {
    this.clearPreview();
    const samples = this._samples();
    if (samples.length === 0) return;
    const geo = new THREE.SphereGeometry(0.32, 8, 6);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff88, depthTest: false });
    for (const { pos } of samples) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(pos.x, pos.y + 0.45, pos.z);
      this.previewGroup.add(mesh);
    }
  }

  clearPreview() {
    this._disposeGroup(this.previewGroup);
  }

  _buildTunnelGeometry(curve, pathSegs, radialSegs, radius, closed) {
    const segs = Math.max(8, pathSegs | 0);
    const rSegs = Math.max(6, radialSegs | 0);
    const frames = curve.computeFrenetFrames(segs, closed);
    const ringVerts = rSegs + 1;
    const rings = segs + 1;
    const positions = new Float32Array(rings * ringVerts * 3);
    const normals = new Float32Array(rings * ringVerts * 3);
    const uvs = new Float32Array(rings * ringVerts * 2);
    const indexCount = segs * rSegs * 6;
    const indices = (rings * ringVerts > 65535)
      ? new Uint32Array(indexCount)
      : new Uint16Array(indexCount);

    let vi3 = 0;
    let vi2 = 0;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const center = curve.getPointAt(t);
      const n = frames.normals[i];
      const b = frames.binormals[i];
      for (let j = 0; j <= rSegs; j++) {
        const a = (j / rSegs) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const rx = n.x * c + b.x * s;
        const ry = n.y * c + b.y * s;
        const rz = n.z * c + b.z * s;
        positions[vi3] = center.x + rx * radius;
        positions[vi3 + 1] = center.y + ry * radius;
        positions[vi3 + 2] = center.z + rz * radius;
        normals[vi3] = rx;
        normals[vi3 + 1] = ry;
        normals[vi3 + 2] = rz;
        uvs[vi2] = t * Math.max(1, segs * radius * 0.08);
        uvs[vi2 + 1] = j / rSegs;
        vi3 += 3;
        vi2 += 2;
      }
    }

    let ii = 0;
    for (let i = 0; i < segs; i++) {
      const r0 = i * ringVerts;
      const r1 = (i + 1) * ringVerts;
      for (let j = 0; j < rSegs; j++) {
        const a = r0 + j;
        const b = r1 + j;
        const c = r0 + j + 1;
        const d = r1 + j + 1;
        indices[ii++] = a;
        indices[ii++] = b;
        indices[ii++] = c;
        indices[ii++] = c;
        indices[ii++] = b;
        indices[ii++] = d;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeBoundingSphere();
    return geo;
  }

  _createTunnelFromCurrentSpline() {
    const curve = this._makeCurve();
    if (!curve) return false;
    const s = this.toolState.spline;
    const scaleMid = Math.max(0.05, (Math.max(0.05, s.scaleMin) + Math.max(0.05, s.scaleMax)) * 0.5);
    const radius = Math.max(0.5, s.tunnelRadius * scaleMid);
    const radialSegs = Math.max(6, s.tunnelRadialSegments | 0);
    const pathSegs = Math.max(40, s.tunnelPathSegments | 0);
    const closed = !!s.closed;
    const points = this.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    const tunnel = {
      points,
      closed,
      radius,
      radialSegs,
      pathSegs,
      color: s.tunnelColor,
      mesh: null,
    };
    this._buildTunnelMesh(tunnel);
    this.tunnels.push(tunnel);
    return true;
  }

  _buildTunnelMesh(tunnel) {
    if (tunnel.mesh) {
      this.scene.remove(tunnel.mesh);
      tunnel.mesh.geometry.dispose();
      tunnel.mesh.material.dispose();
      tunnel.mesh = null;
    }
    const curve = new THREE.CatmullRomCurve3(
      tunnel.points.map((p) => new THREE.Vector3(p.x, p.y, p.z)),
      tunnel.closed,
      "catmullrom",
      0.5,
    );
    const geo = this._buildTunnelGeometry(
      curve,
      tunnel.pathSegs,
      tunnel.radialSegs,
      tunnel.radius,
      tunnel.closed,
    );
    const mat = new THREE.MeshStandardMaterial({
      color: tunnel.color ?? "#6c727a",
      roughness: 0.88,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    tunnel.mesh = mesh;
    this.scene.add(mesh);
  }

  bakePlacement() {
    const samples = this._samples();
    if (samples.length === 0) return { placed: 0 };

    this._pushUndo();
    const worldHalf = this.config.world.size * 0.5;
    const s = this.toolState.spline;
    const scaleRange = Math.max(0, s.scaleMax - s.scaleMin);
    let placed = 0;

    if (s.objectType === "trees") {
      const slotIdx = this.toolState.treePaint.activeSlot | 0;
      const minSpacing = Math.max(0, this.toolState.treePaint.minSpacing || 0);
      for (const { pos, angleY } of samples) {
        const x = THREE.MathUtils.clamp(pos.x, -worldHalf, worldHalf);
        const z = THREE.MathUtils.clamp(pos.z, -worldHalf, worldHalf);
        if (minSpacing > 0 && this.treeStore.hasTreeNearby(x, z, minSpacing)) continue;
        const y = this.getWorldHeight(x, z);
        const scale = s.scaleMin + Math.random() * scaleRange;
        const rotY = s.alignToPath ? angleY : Math.random() * Math.PI * 2;
        this.treeStore.addTree(x, z, y, rotY, scale, slotIdx);
        placed++;
      }
    } else if (s.objectType === "props") {
      const slot = this.toolState.propSlots[this.toolState.props.activeSlot];
      const typeIdx = slot?.typeIdx;
      if (typeIdx == null) return { placed: 0 };
      const minSpacing = Math.max(0, this.toolState.props.minSpacing || 0);
      const sinkOffset = this.toolState.props.sinkOffset || 0;
      for (const { pos, angleY } of samples) {
        const x = THREE.MathUtils.clamp(pos.x, -worldHalf, worldHalf);
        const z = THREE.MathUtils.clamp(pos.z, -worldHalf, worldHalf);
        if (minSpacing > 0 && this.propStore.hasNearby(x, z, minSpacing)) continue;
        const scale = s.scaleMin + Math.random() * scaleRange;
        const rotY = s.alignToPath ? THREE.MathUtils.radToDeg(angleY) : Math.random() * 360;
        const y = this.getWorldHeight(x, z) - sinkOffset;
        this.propStore.instances.push({
          typeIdx,
          px: x, py: y, pz: z,
          rx: 0, ry: rotY, rz: 0,
          sx: scale, sy: scale, sz: scale,
        });
        placed++;
      }
      if (placed > 0) this.propStore._bump();
    } else if (s.objectType === "tunnel") {
      const ok = this._createTunnelFromCurrentSpline();
      if (ok) placed = 1;
    }

    this.clearPreview();
    this.clearAll();
    return { placed };
  }

  applyPlateau() {
    const closed = !!this.toolState.spline.closed;
    if (closed && this.points.length < 3) return false;
    if (!closed && this.points.length < 2) return false;

    const curve = this._makeCurve();
    if (!curve) return false;

    const samples = curve.getPoints(Math.max(96, this.points.length * 32));
    const px = [];
    const pz = [];
    for (const p of samples) {
      px.push(p.x);
      pz.push(p.z);
    }
    if (closed && px.length >= 2) {
      const li = px.length - 1;
      const dx = px[li] - px[0];
      const dz = pz[li] - pz[0];
      if (dx * dx + dz * dz < 1e-6) {
        px.pop();
        pz.pop();
      }
    }

    const n = px.length;
    if (closed && n < 3) return false;
    if (!closed && n < 2) return false;

    let minX = px[0], maxX = px[0], minZ = pz[0], maxZ = pz[0];
    for (let i = 1; i < n; i++) {
      minX = Math.min(minX, px[i]);
      maxX = Math.max(maxX, px[i]);
      minZ = Math.min(minZ, pz[i]);
      maxZ = Math.max(maxZ, pz[i]);
    }

    const halfW = Math.max(0.25, this.toolState.spline.plateauHalfWidth);
    const falloff = Math.max(0, this.toolState.spline.plateauFalloff);
    const targetY = this.toolState.spline.plateauHeight;
    const step = this.config.world.chunkSize / this.config.world.dataResolution;
    const pad = (closed ? falloff : halfW + falloff) + step * 2;
    const worldHalf = this.config.world.size * 0.5;
    minX = THREE.MathUtils.clamp(minX - pad, -worldHalf, worldHalf);
    maxX = THREE.MathUtils.clamp(maxX + pad, -worldHalf, worldHalf);
    minZ = THREE.MathUtils.clamp(minZ - pad, -worldHalf, worldHalf);
    maxZ = THREE.MathUtils.clamp(maxZ + pad, -worldHalf, worldHalf);

    const pointInPolygon = (x, z) => {
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = px[i], zi = pz[i];
        const xj = px[j], zj = pz[j];
        const cross = (zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
        if (cross) inside = !inside;
      }
      return inside;
    };

    const distPointSegment2D = (x, z, ax, az, bx, bz) => {
      const abx = bx - ax;
      const abz = bz - az;
      const apx = x - ax;
      const apz = z - az;
      const ab2 = abx * abx + abz * abz;
      let t = ab2 > 1e-20 ? (apx * abx + apz * abz) / ab2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + t * abx;
      const qz = az + t * abz;
      return Math.hypot(x - qx, z - qz);
    };

    const distToClosedRing = (x, z) => {
      let d = Infinity;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        d = Math.min(d, distPointSegment2D(x, z, px[i], pz[i], px[j], pz[j]));
      }
      return d;
    };

    const distToOpenPolyline = (x, z) => {
      let d = Infinity;
      for (let i = 0; i < n - 1; i++) {
        d = Math.min(d, distPointSegment2D(x, z, px[i], pz[i], px[i + 1], pz[i + 1]));
      }
      return d;
    };

    const weightAt = (x, z) => {
      if (closed) {
        if (!pointInPolygon(x, z)) return 0;
        if (falloff <= 1e-6) return 1;
        const d = distToClosedRing(x, z);
        return THREE.MathUtils.smoothstep(d, 0, falloff);
      }
      const d = distToOpenPolyline(x, z);
      const outer = halfW + falloff;
      if (d > outer) return 0;
      if (falloff <= 1e-6) return d <= halfW ? 1 : 0;
      if (d <= halfW) return 1;
      return 1 - THREE.MathUtils.smoothstep(halfW, outer, d);
    };

    const minCi = worldToChunkIndex(minX, minZ, this.config);
    const maxCi = worldToChunkIndex(maxX, maxZ, this.config);
    const maxChunk = getChunkCountPerAxis(this.config) - 1;
    const minCx = THREE.MathUtils.clamp(minCi.cx, 0, maxChunk);
    const minCz = THREE.MathUtils.clamp(minCi.cz, 0, maxChunk);
    const maxCx = THREE.MathUtils.clamp(maxCi.cx, 0, maxChunk);
    const maxCz = THREE.MathUtils.clamp(maxCi.cz, 0, maxChunk);
    const res = this.config.world.dataResolution;
    const stride = res + 1;
    const clampMin = this.config.sculpt.sculptClampMin;
    const clampMax = this.config.sculpt.sculptClampMax;
    const dirtyChunks = new Map();

    this._pushUndo();
    let changedAny = false;

    const markDirty = (cx, cz, ix, iz) => {
      const k = chunkKey(cx, cz);
      const ex = dirtyChunks.get(k);
      if (!ex) {
        dirtyChunks.set(k, { minIx: ix, maxIx: ix, minIz: iz, maxIz: iz });
        return;
      }
      if (ix < ex.minIx) ex.minIx = ix;
      if (ix > ex.maxIx) ex.maxIx = ix;
      if (iz < ex.minIz) ex.minIz = iz;
      if (iz > ex.maxIz) ex.maxIz = iz;
    };

    for (let cz = minCz; cz <= maxCz; cz++) {
      for (let cx = minCx; cx <= maxCx; cx++) {
        const heights = this.terrainStore.ensureChunkData(cx, cz);
        const cminXw = chunkMinWorldX(cx, this.config);
        const cminZw = chunkMinWorldZ(cz, this.config);

        for (let iz = 0; iz <= res; iz++) {
          const wz = cminZw + iz * step;
          if (wz < minZ || wz > maxZ) continue;
          for (let ix = 0; ix <= res; ix++) {
            const wx = cminXw + ix * step;
            if (wx < minX || wx > maxX) continue;
            const w = weightAt(wx, wz);
            if (w < 1e-7) continue;
            const idx = getChunkDataIndex(ix, iz, this.config);
            const oldH = heights[idx];
            const mixed = THREE.MathUtils.lerp(oldH, targetY, w);
            const next = THREE.MathUtils.clamp(mixed, clampMin, clampMax);
            if (Math.abs(next - oldH) < 1e-9) continue;
            changedAny = true;
            heights[idx] = next;
            markDirty(cx, cz, ix, iz);

            const onL = ix === 0;
            const onR = ix === res;
            const onT = iz === 0;
            const onB = iz === res;
            if (onL && cx > 0) {
              const h = this.terrainStore.ensureChunkData(cx - 1, cz);
              h[iz * stride + res] = next;
              markDirty(cx - 1, cz, res, iz);
            }
            if (onR && cx < maxChunk) {
              const h = this.terrainStore.ensureChunkData(cx + 1, cz);
              h[iz * stride + 0] = next;
              markDirty(cx + 1, cz, 0, iz);
            }
            if (onT && cz > 0) {
              const h = this.terrainStore.ensureChunkData(cx, cz - 1);
              h[res * stride + ix] = next;
              markDirty(cx, cz - 1, ix, res);
            }
            if (onB && cz < maxChunk) {
              const h = this.terrainStore.ensureChunkData(cx, cz + 1);
              h[ix] = next;
              markDirty(cx, cz + 1, ix, 0);
            }
          }
        }
      }
    }

    if (!changedAny) return false;
    this.chunkStream.markDirtyRects(dirtyChunks);
    return true;
  }

  update(dtSec) {
    this._syncVisibility();
    const s = this.toolState.spline;
    if (!s.showTrain || !this._curve || this._curveLength <= 1e-6) {
      this.trainMesh.visible = false;
      return;
    }
    this.trainMesh.visible = true;
    this._trainT = (this._trainT + dtSec * Math.max(0.1, s.trainSpeed) / this._curveLength) % 1;
    const pos = this._curve.getPointAt(this._trainT);
    const tan = this._curve.getTangentAt(this._trainT).normalize();
    this.trainMesh.position.copy(pos).addScaledVector(new THREE.Vector3(0, 1, 0), 0.7);
    this.trainMesh.scale.setScalar(Math.max(0.1, s.trainScale));
    this.trainMesh.rotation.y = Math.atan2(tan.x, tan.z);
  }

  exportData() {
    return {
      points: this.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      tunnels: this.tunnels.map((t) => ({
        points: t.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        closed: !!t.closed,
        radius: t.radius,
        radialSegs: t.radialSegs,
        pathSegs: t.pathSegs,
        color: t.color ?? "#6c727a",
      })),
    };
  }

  importData(data) {
    const pts = Array.isArray(data?.points) ? data.points : [];
    this.clearTunnels();
    this.points = pts.map((p) => new THREE.Vector3(p.x, p.y, p.z));
    const tunnels = Array.isArray(data?.tunnels) ? data.tunnels : [];
    for (const t of tunnels) {
      if (!Array.isArray(t.points) || t.points.length < 2) continue;
      const tunnel = {
        points: t.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        closed: !!t.closed,
        radius: Math.max(0.5, t.radius ?? 6),
        radialSegs: Math.max(6, t.radialSegs ?? 20),
        pathSegs: Math.max(40, t.pathSegs ?? 220),
        color: t.color ?? "#6c727a",
        mesh: null,
      };
      this._buildTunnelMesh(tunnel);
      this.tunnels.push(tunnel);
    }
    this.selectedIdx = -1;
    this.dragging = false;
    this.clearPreview();
    this._rebuildVisual();
  }

  clearTunnels() {
    for (const t of this.tunnels) {
      if (!t.mesh) continue;
      this.scene.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh.material.dispose();
      t.mesh = null;
    }
    this.tunnels.length = 0;
  }

  /**
   * BVH integration hook — same shape used by CliffStore/PropStore.
   * Feeds baked tunnel triangle meshes into CliffBvh.bake(..., extraStores).
   */
  forEachMeshInstance(cb) {
    for (const t of this.tunnels) {
      const mesh = t.mesh;
      if (!mesh || !mesh.geometry) continue;
      mesh.updateMatrixWorld(true);
      cb(mesh.geometry, mesh.matrixWorld);
    }
  }

  dispose() {
    this.clearTunnels();
    this._disposeGroup(this.handleGroup);
    this._disposeGroup(this.previewGroup);
    this.scene.remove(this.handleGroup);
    this.scene.remove(this.previewGroup);
    this.scene.remove(this.trainMesh);
    this.trainMesh.geometry.dispose();
    this.trainMesh.material.dispose();
  }
}

