import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

const _ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

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

  bake(terrainStore, config) {
    const positions = [];
    const indices = [];
    let vertexOffset = 0;

    this.store.forEachMeshInstance((geo, worldMatrix) => {
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

        _ray.origin.set(wx, 99999, wz);
        _ray.direction.set(0, -1, 0);

        const hit = this._bvh.raycastFirst(_ray);
        if (hit) {
          const terrainY = terrainStore.getWorldHeight(wx, wz);
          if (hit.point.y > terrainY + 0.08) {
            grid[iz * gridRes + ix] = hit.point.y;
          }
        }
      }
    }

    this._heightGrid = grid;
    this._gridRes = gridRes;
    this._worldSize = worldSize;
    this._worldHalf = worldHalf;
    this.baked = true;
  }

  sampleHeight(wx, wz) {
    if (!this.baked || !this._heightGrid) return null;

    const cellSize = this._worldSize / this._gridRes;
    const fx = (wx + this._worldHalf) / cellSize - 0.5;
    const fz = (wz + this._worldHalf) / cellSize - 0.5;

    const ix0 = Math.max(0, Math.min(this._gridRes - 2, Math.floor(fx)));
    const iz0 = Math.max(0, Math.min(this._gridRes - 2, Math.floor(fz)));
    const ix1 = ix0 + 1;
    const iz1 = iz0 + 1;
    const tx = fx - ix0;
    const tz = fz - iz0;

    const res = this._gridRes;
    const h00 = this._heightGrid[iz0 * res + ix0];
    const h10 = this._heightGrid[iz0 * res + ix1];
    const h01 = this._heightGrid[iz1 * res + ix0];
    const h11 = this._heightGrid[iz1 * res + ix1];

    const valid00 = h00 > -9000;
    const valid10 = h10 > -9000;
    const valid01 = h01 > -9000;
    const valid11 = h11 > -9000;
    const validCount = (valid00 ? 1 : 0) + (valid10 ? 1 : 0) + (valid01 ? 1 : 0) + (valid11 ? 1 : 0);
    if (validCount === 0) return null;

    const s00 = valid00 ? h00 : 0;
    const s10 = valid10 ? h10 : 0;
    const s01 = valid01 ? h01 : 0;
    const s11 = valid11 ? h11 : 0;
    const w00 = valid00 ? (1 - tx) * (1 - tz) : 0;
    const w10 = valid10 ? tx * (1 - tz) : 0;
    const w01 = valid01 ? (1 - tx) * tz : 0;
    const w11 = valid11 ? tx * tz : 0;
    const wSum = w00 + w10 + w01 + w11;
    if (wSum < 0.001) return null;

    return (s00 * w00 + s10 * w10 + s01 * w01 + s11 * w11) / wSum;
  }
}
