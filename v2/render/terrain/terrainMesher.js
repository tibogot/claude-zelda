import * as THREE from "three";
import { chunkKey, chunkMinWorldX, chunkMinWorldZ } from "../../core/terrain/chunkMath.js";
import { getChunkPerimeterRingIndices, TerrainGeometryPool } from "./terrainGeometryPool.js";

const _terrainHfN = new THREE.Vector3();

export class TerrainMesher {
  constructor(config) {
    this.config = config;
    this.pool = new TerrainGeometryPool(config);
  }

  createChunkMesh(cx, cz, segments, terrainStore, material, neighborSegments) {
    const geometry = this.pool.acquire(segments);
    this.applyChunkHeightsToGeometry(
      geometry,
      cx,
      cz,
      segments,
      terrainStore,
      neighborSegments,
      null,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    mesh.userData.chunk = { cx, cz, segments };
    installTerrainSkirtSafeRaycast(mesh);
    mesh.position.set(
      chunkMinWorldX(cx, this.config) + this.config.world.chunkSize * 0.5,
      0,
      chunkMinWorldZ(cz, this.config) + this.config.world.chunkSize * 0.5,
    );
    return mesh;
  }

  remesh(mesh, cx, cz, segments, terrainStore, neighborSegments, dirtyRect = null) {
    const oldSegments = mesh.userData.chunk?.segments ?? segments;
    if (oldSegments !== segments) {
      // LOD change — can't use incremental path, geometry has different topology.
      this.pool.release(oldSegments, mesh.geometry);
      mesh.geometry = this.pool.acquire(segments);
      mesh.userData.chunk = { cx, cz, segments };
      this.applyChunkHeightsToGeometry(
        mesh.geometry,
        cx,
        cz,
        segments,
        terrainStore,
        neighborSegments,
        null,
      );
      return;
    }

    if (dirtyRect) {
      this.applyIncrementalUpdate(
        mesh.geometry,
        cx,
        cz,
        segments,
        terrainStore,
        neighborSegments,
        dirtyRect,
      );
      return;
    }

    this.applyChunkHeightsToGeometry(
      mesh.geometry,
      cx,
      cz,
      segments,
      terrainStore,
      neighborSegments,
      null,
    );
  }

  disposeChunkMesh(mesh) {
    const segments = mesh.userData.chunk?.segments ?? this.config.lod.levels[0].segments;
    this.pool.release(segments, mesh.geometry);
  }

  /**
   * Full rebuild. Only Y values + normals are written — XZ/UV come from the
   * template and never change after acquire().
   */
  applyChunkHeightsToGeometry(geometry, cx, cz, segments, terrainStore, neighborSegments) {
    const pos = geometry.attributes.position;
    const baseVertCount = geometry.userData.baseVertCount ?? (segments + 1) * (segments + 1);
    const posArr = pos.array;
    const res = this.config.world.dataResolution;
    const cs = this.config.world.chunkSize;
    const chunkMinX = chunkMinWorldX(cx, this.config);
    const chunkMinZ = chunkMinWorldZ(cz, this.config);

    const heights = terrainStore.ensureChunkData(cx, cz);
    const stride = res + 1;

    // Write Y for every mesh vertex by sampling this chunk's heightfield only.
    // Inline bilinear — no Map lookups in the hot loop.
    const w = segments + 1;
    for (let iz = 0; iz <= segments; iz++) {
      const v = (iz / segments) * res;
      const z0 = Math.floor(v);
      const z1 = z0 >= res ? res : z0 + 1;
      const tz = v - z0;
      for (let ix = 0; ix <= segments; ix++) {
        const u = (ix / segments) * res;
        const x0 = Math.floor(u);
        const x1 = x0 >= res ? res : x0 + 1;
        const tx = u - x0;
        const h00 = heights[z0 * stride + x0];
        const h10 = heights[z0 * stride + x1];
        const h01 = heights[z1 * stride + x0];
        const h11 = heights[z1 * stride + x1];
        const hy =
          h00 * (1 - tx) * (1 - tz) +
          h10 * tx * (1 - tz) +
          h01 * (1 - tx) * tz +
          h11 * tx * tz;
        posArr[(iz * w + ix) * 3 + 1] = hy;
      }
    }

    /** @type {Uint8Array | null} */
    let snappedMask = null;
    if (neighborSegments) {
      snappedMask = snapLodBoundaries({
        pos,
        segments,
        cx,
        cz,
        chunkMinX,
        chunkMinZ,
        terrainStore,
        neighborSegments,
      });
    }

    let normal = geometry.attributes.normal;
    if (!normal || normal.count !== pos.count) {
      normal = new THREE.BufferAttribute(new Float32Array(pos.count * 3), 3);
      geometry.setAttribute("normal", normal);
    }
    const nArr = normal.array;
    const eps = cs / res;

    // FD normals per mesh vertex. Interior verts can read heights directly from
    // the cached array; edge verts need neighbor-chunk heights and fall back to
    // the Map-based heightfield helper.
    const cachedNeighbors = gatherNeighborHeights(terrainStore, cx, cz);

    for (let iz = 0; iz <= segments; iz++) {
      const wz = chunkMinZ + (iz / segments) * cs;
      for (let ix = 0; ix <= segments; ix++) {
        const wx = chunkMinX + (ix / segments) * cs;
        sampleHeightfieldNormal(
          wx,
          wz,
          eps,
          terrainStore,
          cx,
          cz,
          heights,
          cachedNeighbors,
          _terrainHfN,
        );
        const i3 = (iz * w + ix) * 3;
        nArr[i3] = _terrainHfN.x;
        nArr[i3 + 1] = _terrainHfN.y;
        nArr[i3 + 2] = _terrainHfN.z;
      }
    }

    if (snappedMask) {
      fixLodSnappedBoundaryNormals({
        normal,
        snappedMask,
        segments,
        cx,
        cz,
        chunkMinX,
        chunkMinZ,
        terrainStore,
        neighborSegments,
      });
    }

    if (pos.count > baseVertCount) {
      syncSkirtRing({
        pos,
        normal,
        segments,
        skirtDepth: this.config.render.terrainSkirtDepth,
      });
    }

    pos.needsUpdate = true;
    normal.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  /**
   * Incremental update: only rewrite mesh vertices within the mesh-vertex rect
   * implied by `dirtyRect` (heightfield grid coords). Normals recomputed in the
   * same region, expanded by 1 for central-difference continuity.
   */
  applyIncrementalUpdate(geometry, cx, cz, segments, terrainStore, neighborSegments, dirtyRect) {
    const pos = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    const posArr = pos.array;
    const nArr = normal.array;
    const baseVertCount = geometry.userData.baseVertCount ?? (segments + 1) * (segments + 1);
    const res = this.config.world.dataResolution;
    const cs = this.config.world.chunkSize;
    const chunkMinX = chunkMinWorldX(cx, this.config);
    const chunkMinZ = chunkMinWorldZ(cz, this.config);

    const heights = terrainStore.ensureChunkData(cx, cz);
    const stride = res + 1;
    const w = segments + 1;

    // Map heightfield dirty rect → mesh vertex rect. A heightfield vertex at
    // index ix affects mesh vertices whose u = mx*res/segs lies in [ix-1, ix+1]
    // (bilinear support). So mesh rect = dirty ± 1 in heightfield space, then
    // scale by segments/res, clamped to [0, segments].
    const sR = segments / res;
    const mMinX = Math.max(0, Math.floor((dirtyRect.minIx - 1) * sR));
    const mMaxX = Math.min(segments, Math.ceil((dirtyRect.maxIx + 1) * sR));
    const mMinZ = Math.max(0, Math.floor((dirtyRect.minIz - 1) * sR));
    const mMaxZ = Math.min(segments, Math.ceil((dirtyRect.maxIz + 1) * sR));
    if (mMinX > mMaxX || mMinZ > mMaxZ) return;

    // Rewrite Y only in the mesh rect.
    for (let iz = mMinZ; iz <= mMaxZ; iz++) {
      const v = (iz / segments) * res;
      const z0 = Math.floor(v);
      const z1 = z0 >= res ? res : z0 + 1;
      const tz = v - z0;
      for (let ix = mMinX; ix <= mMaxX; ix++) {
        const u = (ix / segments) * res;
        const x0 = Math.floor(u);
        const x1 = x0 >= res ? res : x0 + 1;
        const tx = u - x0;
        const h00 = heights[z0 * stride + x0];
        const h10 = heights[z0 * stride + x1];
        const h01 = heights[z1 * stride + x0];
        const h11 = heights[z1 * stride + x1];
        const hy =
          h00 * (1 - tx) * (1 - tz) +
          h10 * tx * (1 - tz) +
          h01 * (1 - tx) * tz +
          h11 * tx * tz;
        posArr[(iz * w + ix) * 3 + 1] = hy;
      }
    }

    // Re-snap any LOD-seam edge that falls inside the dirty mesh rect.
    // Sculpt on seam verts should still follow the coarse neighbor boundary.
    let snappedMask = null;
    if (neighborSegments) {
      snappedMask = snapLodBoundariesPartial({
        pos,
        segments,
        cx,
        cz,
        chunkMinX,
        chunkMinZ,
        terrainStore,
        neighborSegments,
        mMinX,
        mMaxX,
        mMinZ,
        mMaxZ,
      });
    }

    // Expand the rect by 1 for normal-pass margin so normals at the boundary
    // of the sculpted region blend into the surrounding surface smoothly.
    const nMinX = Math.max(0, mMinX - 1);
    const nMaxX = Math.min(segments, mMaxX + 1);
    const nMinZ = Math.max(0, mMinZ - 1);
    const nMaxZ = Math.min(segments, mMaxZ + 1);

    const eps = cs / res;
    const cachedNeighbors = gatherNeighborHeights(terrainStore, cx, cz);

    for (let iz = nMinZ; iz <= nMaxZ; iz++) {
      const wz = chunkMinZ + (iz / segments) * cs;
      for (let ix = nMinX; ix <= nMaxX; ix++) {
        const wx = chunkMinX + (ix / segments) * cs;
        sampleHeightfieldNormal(
          wx,
          wz,
          eps,
          terrainStore,
          cx,
          cz,
          heights,
          cachedNeighbors,
          _terrainHfN,
        );
        const i3 = (iz * w + ix) * 3;
        nArr[i3] = _terrainHfN.x;
        nArr[i3 + 1] = _terrainHfN.y;
        nArr[i3 + 2] = _terrainHfN.z;
      }
    }

    if (snappedMask) {
      fixLodSnappedBoundaryNormals({
        normal,
        snappedMask,
        segments,
        cx,
        cz,
        chunkMinX,
        chunkMinZ,
        terrainStore,
        neighborSegments,
      });
    }

    // If the rect touches the chunk perimeter, skirt ring follows.
    if (
      pos.count > baseVertCount &&
      (mMinX === 0 || mMaxX === segments || mMinZ === 0 || mMaxZ === segments)
    ) {
      syncSkirtRing({
        pos,
        normal,
        segments,
        skirtDepth: this.config.render.terrainSkirtDepth,
      });
    }

    pos.needsUpdate = true;
    normal.needsUpdate = true;
    // Bounding sphere may have grown — recompute. Cheap compared to the
    // full-rebuild path we skipped.
    geometry.computeBoundingSphere();
  }
}

function gatherNeighborHeights(terrainStore, cx, cz) {
  return {
    W: terrainStore.chunkDataMap.get(chunkKey(cx - 1, cz)) || null,
    E: terrainStore.chunkDataMap.get(chunkKey(cx + 1, cz)) || null,
    N: terrainStore.chunkDataMap.get(chunkKey(cx, cz - 1)) || null,
    S: terrainStore.chunkDataMap.get(chunkKey(cx, cz + 1)) || null,
  };
}

/**
 * FD normal sampler that reads directly from the provided heights buffer when
 * the sample stays inside the chunk, and from cached neighbor buffers (or the
 * store helper as a last resort) when it crosses a chunk edge.
 */
function sampleHeightfieldNormal(
  worldX,
  worldZ,
  eps,
  terrainStore,
  cx,
  cz,
  heights,
  cachedNeighbors,
  out,
) {
  const inv2eps = 1 / (2 * eps);
  const hL = sampleHeightFast(
    worldX - eps,
    worldZ,
    terrainStore,
    cx,
    cz,
    heights,
    cachedNeighbors,
  );
  const hR = sampleHeightFast(
    worldX + eps,
    worldZ,
    terrainStore,
    cx,
    cz,
    heights,
    cachedNeighbors,
  );
  const hD = sampleHeightFast(
    worldX,
    worldZ - eps,
    terrainStore,
    cx,
    cz,
    heights,
    cachedNeighbors,
  );
  const hU = sampleHeightFast(
    worldX,
    worldZ + eps,
    terrainStore,
    cx,
    cz,
    heights,
    cachedNeighbors,
  );
  out.set((hL - hR) * inv2eps, 1, (hD - hU) * inv2eps).normalize();
}

function sampleHeightFast(worldX, worldZ, terrainStore, cx, cz, heights, cachedNeighbors) {
  const config = terrainStore.config;
  const cs = config.world.chunkSize;
  const res = config.world.dataResolution;
  const stride = res + 1;
  const minX = chunkMinWorldX(cx, config);
  const minZ = chunkMinWorldZ(cz, config);
  const u = ((worldX - minX) / cs) * res;
  const v = ((worldZ - minZ) / cs) * res;

  // Fast path: sample is inside this chunk's heightfield.
  if (u >= 0 && u <= res && v >= 0 && v <= res) {
    return bilinearSample(heights, stride, u, v, res);
  }

  // One-step crossing into cached neighbor.
  if (u < 0 && v >= 0 && v <= res && cachedNeighbors.W) {
    return bilinearSample(cachedNeighbors.W, stride, u + res, v, res);
  }
  if (u > res && v >= 0 && v <= res && cachedNeighbors.E) {
    return bilinearSample(cachedNeighbors.E, stride, u - res, v, res);
  }
  if (v < 0 && u >= 0 && u <= res && cachedNeighbors.N) {
    return bilinearSample(cachedNeighbors.N, stride, u, v + res, res);
  }
  if (v > res && u >= 0 && u <= res && cachedNeighbors.S) {
    return bilinearSample(cachedNeighbors.S, stride, u, v - res, res);
  }

  // Fallback (corner / out-of-world) — authoritative but slower.
  return terrainStore.getChunkHeightfieldHeight(worldX, worldZ);
}

function bilinearSample(heights, stride, u, v, res) {
  const x = u < 0 ? 0 : u > res ? res : u;
  const z = v < 0 ? 0 : v > res ? res : v;
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = x0 >= res ? res : x0 + 1;
  const z1 = z0 >= res ? res : z0 + 1;
  const tx = x - x0;
  const tz = z - z0;
  const h00 = heights[z0 * stride + x0];
  const h10 = heights[z0 * stride + x1];
  const h01 = heights[z1 * stride + x0];
  const h11 = heights[z1 * stride + x1];
  return (
    h00 * (1 - tx) * (1 - tz) +
    h10 * tx * (1 - tz) +
    h01 * (1 - tx) * tz +
    h11 * tx * tz
  );
}

function snapLodBoundaries({
  pos,
  segments,
  cx,
  cz,
  chunkMinX,
  chunkMinZ,
  terrainStore,
  neighborSegments,
}) {
  const cs = terrainStore.config.world.chunkSize;
  const dataScale =
    terrainStore.config.world.dataResolution / terrainStore.config.world.chunkSize;
  const snapped = new Uint8Array(pos.count);
  let any = false;

  const runEdge = (edge, neighborSeg, ncx, ncz, axis, neighborBoundary) => {
    if (neighborSeg == null || neighborSeg >= segments) return;
    for (let k = 0; k <= segments; k++) {
      const t = segments > 0 ? k / segments : 0;
      const wz = axis === "z" ? chunkMinZ + t * cs : 0;
      const wx = axis === "z" ? 0 : chunkMinX + t * cs;
      const wxFinal =
        axis === "z"
          ? edge === "east"
            ? chunkMinX + cs
            : chunkMinX
          : wx;
      const wzFinal =
        axis === "z"
          ? wz
          : edge === "south"
            ? chunkMinZ + cs
            : chunkMinZ;
      const y = sampleCoarseNeighborEdgeY({
        terrainStore,
        ncx,
        ncz,
        neighborSeg,
        wx: wxFinal,
        wz: wzFinal,
        axis,
        neighborBoundary,
        dataScale,
      });
      const vi = vertexIndexOnEdge(segments, edge, k);
      pos.setY(vi, y);
      snapped[vi] = 1;
      any = true;
    }
  };

  runEdge("east", neighborSegments.east, cx + 1, cz, "z", "west");
  runEdge("west", neighborSegments.west, cx - 1, cz, "z", "east");
  runEdge("south", neighborSegments.south, cx, cz + 1, "x", "north");
  runEdge("north", neighborSegments.north, cx, cz - 1, "x", "south");

  return any ? snapped : null;
}

function snapLodBoundariesPartial({
  pos,
  segments,
  cx,
  cz,
  chunkMinX,
  chunkMinZ,
  terrainStore,
  neighborSegments,
  mMinX,
  mMaxX,
  mMinZ,
  mMaxZ,
}) {
  // Only re-snap the portion of each LOD seam that intersects the dirty rect.
  const cs = terrainStore.config.world.chunkSize;
  const dataScale =
    terrainStore.config.world.dataResolution / terrainStore.config.world.chunkSize;
  const snapped = new Uint8Array(pos.count);
  let any = false;

  const touchEast = mMaxX === segments && neighborSegments.east != null && neighborSegments.east < segments;
  const touchWest = mMinX === 0 && neighborSegments.west != null && neighborSegments.west < segments;
  const touchSouth = mMaxZ === segments && neighborSegments.south != null && neighborSegments.south < segments;
  const touchNorth = mMinZ === 0 && neighborSegments.north != null && neighborSegments.north < segments;

  if (touchEast) {
    const neighborSeg = neighborSegments.east;
    for (let k = mMinZ; k <= mMaxZ; k++) {
      const t = k / segments;
      const y = sampleCoarseNeighborEdgeY({
        terrainStore,
        ncx: cx + 1,
        ncz: cz,
        neighborSeg,
        wx: chunkMinX + cs,
        wz: chunkMinZ + t * cs,
        axis: "z",
        neighborBoundary: "west",
        dataScale,
      });
      const vi = vertexIndexOnEdge(segments, "east", k);
      pos.setY(vi, y);
      snapped[vi] = 1;
      any = true;
    }
  }
  if (touchWest) {
    const neighborSeg = neighborSegments.west;
    for (let k = mMinZ; k <= mMaxZ; k++) {
      const t = k / segments;
      const y = sampleCoarseNeighborEdgeY({
        terrainStore,
        ncx: cx - 1,
        ncz: cz,
        neighborSeg,
        wx: chunkMinX,
        wz: chunkMinZ + t * cs,
        axis: "z",
        neighborBoundary: "east",
        dataScale,
      });
      const vi = vertexIndexOnEdge(segments, "west", k);
      pos.setY(vi, y);
      snapped[vi] = 1;
      any = true;
    }
  }
  if (touchSouth) {
    const neighborSeg = neighborSegments.south;
    for (let k = mMinX; k <= mMaxX; k++) {
      const t = k / segments;
      const y = sampleCoarseNeighborEdgeY({
        terrainStore,
        ncx: cx,
        ncz: cz + 1,
        neighborSeg,
        wx: chunkMinX + t * cs,
        wz: chunkMinZ + cs,
        axis: "x",
        neighborBoundary: "north",
        dataScale,
      });
      const vi = vertexIndexOnEdge(segments, "south", k);
      pos.setY(vi, y);
      snapped[vi] = 1;
      any = true;
    }
  }
  if (touchNorth) {
    const neighborSeg = neighborSegments.north;
    for (let k = mMinX; k <= mMaxX; k++) {
      const t = k / segments;
      const y = sampleCoarseNeighborEdgeY({
        terrainStore,
        ncx: cx,
        ncz: cz - 1,
        neighborSeg,
        wx: chunkMinX + t * cs,
        wz: chunkMinZ,
        axis: "x",
        neighborBoundary: "south",
        dataScale,
      });
      const vi = vertexIndexOnEdge(segments, "north", k);
      pos.setY(vi, y);
      snapped[vi] = 1;
      any = true;
    }
  }

  return any ? snapped : null;
}

function vertexIndexOnEdge(segments, edge, k) {
  if (edge === "west") return k * (segments + 1) + 0;
  if (edge === "east") return k * (segments + 1) + segments;
  if (edge === "north") return 0 * (segments + 1) + k;
  if (edge === "south") return segments * (segments + 1) + k;
  return 0;
}

function sampleCoarseNeighborEdgeY({
  terrainStore,
  ncx,
  ncz,
  neighborSeg,
  wx,
  wz,
  axis,
  neighborBoundary,
  dataScale,
}) {
  const nMinX = chunkMinWorldX(ncx, terrainStore.config);
  const nMinZ = chunkMinWorldZ(ncz, terrainStore.config);
  const cs = terrainStore.config.world.chunkSize;

  const t =
    axis === "z"
      ? THREE.MathUtils.clamp((wz - nMinZ) / cs, 0, 1)
      : THREE.MathUtils.clamp((wx - nMinX) / cs, 0, 1);

  const u = t * neighborSeg;
  const i0 = Math.floor(u);
  const i1 = Math.min(neighborSeg, i0 + 1);
  const f = u - i0;

  const nHalf = cs * 0.5;
  const lxEdgeLocal =
    neighborBoundary === "west"
      ? -nHalf
      : neighborBoundary === "east"
        ? nHalf
        : null;
  const lzEdgeLocal =
    neighborBoundary === "north"
      ? -nHalf
      : neighborBoundary === "south"
        ? nHalf
        : null;

  const z0 = -nHalf + (i0 / neighborSeg) * cs;
  const z1 = -nHalf + (i1 / neighborSeg) * cs;
  const x0 = -nHalf + (i0 / neighborSeg) * cs;
  const x1 = -nHalf + (i1 / neighborSeg) * cs;

  if (axis === "z") {
    const y0 = terrainStore.sampleChunkHeight(
      ncx,
      ncz,
      (lxEdgeLocal + nHalf) * dataScale,
      (z0 + nHalf) * dataScale,
    );
    const y1 = terrainStore.sampleChunkHeight(
      ncx,
      ncz,
      (lxEdgeLocal + nHalf) * dataScale,
      (z1 + nHalf) * dataScale,
    );
    return THREE.MathUtils.lerp(y0, y1, f);
  }

  const y0 = terrainStore.sampleChunkHeight(
    ncx,
    ncz,
    (x0 + nHalf) * dataScale,
    (lzEdgeLocal + nHalf) * dataScale,
  );
  const y1 = terrainStore.sampleChunkHeight(
    ncx,
    ncz,
    (x1 + nHalf) * dataScale,
    (lzEdgeLocal + nHalf) * dataScale,
  );
  return THREE.MathUtils.lerp(y0, y1, f);
}

function fixLodSnappedBoundaryNormals({
  normal,
  snappedMask,
  segments,
  cx,
  cz,
  chunkMinX,
  chunkMinZ,
  terrainStore,
  neighborSegments,
}) {
  const cs = terrainStore.config.world.chunkSize;
  const dataScale =
    terrainStore.config.world.dataResolution / terrainStore.config.world.chunkSize;

  const east = neighborSegments.east;
  if (east != null && east < segments) {
    const ncx = cx + 1;
    const ncz = cz;
    for (let k = 0; k <= segments; k++) {
      const vi = vertexIndexOnEdge(segments, "east", k);
      if (!snappedMask[vi]) continue;
      const t = segments > 0 ? k / segments : 0;
      const wz = chunkMinZ + t * cs;
      const wx = chunkMinX + cs;
      setNormalFromCoarseEdge({
        normal,
        vi,
        wx,
        wz,
        outwardWorld: new THREE.Vector3(1, 0, 0),
        terrainStore,
        ncx,
        ncz,
        neighborSeg: east,
        axis: "z",
        neighborBoundary: "west",
        dataScale,
      });
    }
  }

  const west = neighborSegments.west;
  if (west != null && west < segments) {
    const ncx = cx - 1;
    const ncz = cz;
    for (let k = 0; k <= segments; k++) {
      const vi = vertexIndexOnEdge(segments, "west", k);
      if (!snappedMask[vi]) continue;
      const t = segments > 0 ? k / segments : 0;
      const wz = chunkMinZ + t * cs;
      const wx = chunkMinX;
      setNormalFromCoarseEdge({
        normal,
        vi,
        wx,
        wz,
        outwardWorld: new THREE.Vector3(-1, 0, 0),
        terrainStore,
        ncx,
        ncz,
        neighborSeg: west,
        axis: "z",
        neighborBoundary: "east",
        dataScale,
      });
    }
  }

  const south = neighborSegments.south;
  if (south != null && south < segments) {
    const ncx = cx;
    const ncz = cz + 1;
    for (let k = 0; k <= segments; k++) {
      const vi = vertexIndexOnEdge(segments, "south", k);
      if (!snappedMask[vi]) continue;
      const t = segments > 0 ? k / segments : 0;
      const wx = chunkMinX + t * cs;
      const wz = chunkMinZ + cs;
      setNormalFromCoarseEdge({
        normal,
        vi,
        wx,
        wz,
        outwardWorld: new THREE.Vector3(0, 0, 1),
        terrainStore,
        ncx,
        ncz,
        neighborSeg: south,
        axis: "x",
        neighborBoundary: "north",
        dataScale,
      });
    }
  }

  const north = neighborSegments.north;
  if (north != null && north < segments) {
    const ncx = cx;
    const ncz = cz - 1;
    for (let k = 0; k <= segments; k++) {
      const vi = vertexIndexOnEdge(segments, "north", k);
      if (!snappedMask[vi]) continue;
      const t = segments > 0 ? k / segments : 0;
      const wx = chunkMinX + t * cs;
      const wz = chunkMinZ;
      setNormalFromCoarseEdge({
        normal,
        vi,
        wx,
        wz,
        outwardWorld: new THREE.Vector3(0, 0, -1),
        terrainStore,
        ncx,
        ncz,
        neighborSeg: north,
        axis: "x",
        neighborBoundary: "south",
        dataScale,
      });
    }
  }
}

const _tmpEdgeTan = new THREE.Vector3();
const _tmpOut = new THREE.Vector3();
const _tmpN = new THREE.Vector3();

function setNormalFromCoarseEdge({
  normal,
  vi,
  wx,
  wz,
  outwardWorld,
  terrainStore,
  ncx,
  ncz,
  neighborSeg,
  axis,
  neighborBoundary,
  dataScale,
}) {
  const cs = terrainStore.config.world.chunkSize;
  const dt = 1 / Math.max(1, neighborSeg);
  const hWorld = dt * cs;
  const y0 = sampleCoarseNeighborEdgeY({
    terrainStore,
    ncx,
    ncz,
    neighborSeg,
    wx: axis === "z" ? wx : wx - hWorld,
    wz: axis === "z" ? wz - hWorld : wz,
    axis,
    neighborBoundary,
    dataScale,
  });
  const y1 = sampleCoarseNeighborEdgeY({
    terrainStore,
    ncx,
    ncz,
    neighborSeg,
    wx: axis === "z" ? wx : wx + hWorld,
    wz: axis === "z" ? wz + hWorld : wz,
    axis,
    neighborBoundary,
    dataScale,
  });

  if (axis === "z") {
    _tmpEdgeTan.set(0, y1 - y0, 2 * hWorld);
  } else {
    _tmpEdgeTan.set(2 * hWorld, y1 - y0, 0);
  }
  _tmpEdgeTan.normalize();

  _tmpOut.copy(outwardWorld).normalize();
  _tmpN.copy(_tmpOut).cross(_tmpEdgeTan);
  _tmpN.normalize();

  if (_tmpN.y < 0) _tmpN.multiplyScalar(-1);

  normal.setXYZ(vi, _tmpN.x, _tmpN.y, _tmpN.z);
}

function syncSkirtRing({ pos, normal, segments, skirtDepth }) {
  const baseCount = (segments + 1) * (segments + 1);
  if (pos.count <= baseCount) return;
  const ring = getChunkPerimeterRingIndices(segments);
  const posArr = pos.array;
  const nArr = normal.array;
  for (let r = 0; r < ring.length; r++) {
    const ti = ring[r];
    const bi = baseCount + r;
    posArr[bi * 3] = posArr[ti * 3];
    posArr[bi * 3 + 1] = posArr[ti * 3 + 1] - skirtDepth;
    posArr[bi * 3 + 2] = posArr[ti * 3 + 2];
    nArr[bi * 3] = nArr[ti * 3];
    nArr[bi * 3 + 1] = nArr[ti * 3 + 1];
    nArr[bi * 3 + 2] = nArr[ti * 3 + 2];
  }
}

function installTerrainSkirtSafeRaycast(mesh) {
  if (mesh.userData._terrainRaycastPatched) return;
  mesh.userData._terrainRaycastPatched = true;
  const baseRaycast = mesh.raycast.bind(mesh);
  mesh.raycast = (raycaster, intersects) => {
    const prevLen = intersects.length;
    baseRaycast(raycaster, intersects);
    const triCap = mesh.geometry?.userData?.terrainTriCount;
    if (triCap == null) return;
    for (let i = intersects.length - 1; i >= prevLen; i--) {
      const hit = intersects[i];
      const fi = hit.faceIndex;
      if (fi != null && fi >= triCap) intersects.splice(i, 1);
    }
  };
}
