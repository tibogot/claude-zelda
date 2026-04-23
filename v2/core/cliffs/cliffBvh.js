import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

const _ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
const _latRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3());
const _latHit = { point: new THREE.Vector3(), normal: new THREE.Vector3() };

export class CliffBvh {
  constructor(cliffStore) {
    this.store = cliffStore;
    this.baked = false;
    this._bvh = null;
    this._gridRes = 0;
    this._heightGrid = null;
    this._worldSize = 0;
    this._worldHalf = 0;
  }

  invalidate() {
    this.baked = false;
  }

  bake(terrainStore, config, extraStores) {
    const positions = [];
    const indices = [];
    let vertexOffset = 0;

    const collectStore = (store) => {
      store.forEachMeshInstance((geo, worldMatrix) => {
        const posAttr = geo.getAttribute("position");
        if (!posAttr) return;
        const idx = geo.getIndex();
        const v = new THREE.Vector3();

        for (let i = 0; i < posAttr.count; i++) {
          v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          v.applyMatrix4(worldMatrix);
          positions.push(v.x, v.y, v.z);
        }

        if (idx) {
          for (let i = 0; i < idx.count; i++) {
            indices.push(idx.getX(i) + vertexOffset);
          }
        } else {
          for (let i = 0; i < posAttr.count; i++) {
            indices.push(i + vertexOffset);
          }
        }
        vertexOffset += posAttr.count;
      });
    };

    collectStore(this.store);
    if (extraStores) {
      for (const es of extraStores) collectStore(es);
    }

    if (positions.length === 0) {
      this.baked = false;
      this._bvh = null;
      this._heightGrid = null;
      return;
    }

    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    mergedGeo.setIndex(indices);
    this._bvh = new MeshBVH(mergedGeo);

    const worldSize = config.world.size;
    const worldHalf = worldSize * 0.5;
    const gridRes = Math.min(512, Math.ceil(worldSize / 2));
    const grid = new Float32Array(gridRes * gridRes);
    grid.fill(-9999);

    const cellSize = worldSize / gridRes;

    for (let iz = 0; iz < gridRes; iz++) {
      for (let ix = 0; ix < gridRes; ix++) {
        const wx = -worldHalf + (ix + 0.5) * cellSize;
        const wz = -worldHalf + (iz + 0.5) * cellSize;

        const terrainY = terrainStore.getWorldHeight(wx, wz);
        _ray.origin.set(wx, 99999, wz);
        _ray.direction.set(0, -1, 0);

        const hit = this._bvh.raycastFirst(_ray);
        grid[iz * gridRes + ix] = (hit && hit.point.y > terrainY)
          ? hit.point.y
          : terrainY;
      }
    }

    this._heightGrid = grid;
    this._gridRes = gridRes;
    this._worldSize = worldSize;
    this._worldHalf = worldHalf;
    this.baked = true;
  }

  raycastHeight(wx, wz) {
    if (!this.baked || !this._bvh) return null;
    _ray.origin.set(wx, 99999, wz);
    _ray.direction.set(0, -1, 0);
    const hit = this._bvh.raycastFirst(_ray);
    return hit ? hit.point.y : null;
  }

  raycastHeightFrom(wx, wy, wz) {
    if (!this.baked || !this._bvh) return null;
    _ray.origin.set(wx, wy, wz);
    _ray.direction.set(0, -1, 0);
    const hit = this._bvh.raycastFirst(_ray);
    return hit ? hit.point.y : null;
  }

  raycast3D(ox, oy, oz, dx, dy, dz, maxDist) {
    if (!this.baked || !this._bvh) return null;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-8) return null;
    _latRay.origin.set(ox, oy, oz);
    _latRay.direction.set(dx / len, dy / len, dz / len);
    const hit = this._bvh.raycastFirst(_latRay);
    if (hit && hit.distance <= maxDist) {
      _latHit.point.copy(hit.point);
      _latHit.normal.copy(hit.face.normal);
      _latHit.distance = hit.distance;
      return _latHit;
    }
    return null;
  }

  raycastLateral(ox, oy, oz, dirX, dirZ, maxDist) {
    if (!this.baked || !this._bvh) return null;
    const len = Math.hypot(dirX, dirZ);
    if (len < 1e-8) return null;
    _latRay.origin.set(ox, oy, oz);
    _latRay.direction.set(dirX / len, 0, dirZ / len);
    const hit = this._bvh.raycastFirst(_latRay);
    if (hit && hit.distance <= maxDist) {
      _latHit.point.copy(hit.point);
      _latHit.normal.copy(hit.face.normal);
      _latHit.distance = hit.distance;
      return _latHit;
    }
    return null;
  }

  raycastUp(ox, oy, oz, maxDist) {
    if (!this.baked || !this._bvh) return null;
    _latRay.origin.set(ox, oy, oz);
    _latRay.direction.set(0, 1, 0);
    const hit = this._bvh.raycastFirst(_latRay);
    if (hit && hit.distance <= maxDist) {
      return hit.point.y;
    }
    return null;
  }

  sampleHeight(wx, wz) {
    if (!this.baked || !this._heightGrid) return null;

    const cellSize = this._worldSize / this._gridRes;
    const fx = (wx + this._worldHalf) / cellSize - 0.5;
    const fz = (wz + this._worldHalf) / cellSize - 0.5;

    const ix0 = Math.max(0, Math.min(this._gridRes - 2, Math.floor(fx)));
    const iz0 = Math.max(0, Math.min(this._gridRes - 2, Math.floor(fz)));
    const tx = fx - ix0;
    const tz = fz - iz0;

    const res = this._gridRes;
    const h00 = this._heightGrid[iz0 * res + ix0];
    const h10 = this._heightGrid[iz0 * res + ix0 + 1];
    const h01 = this._heightGrid[(iz0 + 1) * res + ix0];
    const h11 = this._heightGrid[(iz0 + 1) * res + ix0 + 1];

    return h00 + (h10 - h00) * tx + (h01 - h00) * tz + (h00 - h10 - h01 + h11) * tx * tz;
  }
}
