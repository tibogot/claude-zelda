import * as THREE from "three";

const _flatBox = new THREE.Box3();
const _flatSz = new THREE.Vector3();

export function hemiOctaGridToDir(gx, gy, out) {
  out.set(gx - gy, 0, -1 + gx + gy);
  out.y = 1 - Math.abs(out.x) - Math.abs(out.z);
  return out.normalize();
}

export function isFlatGeometry(g) {
  const pos = g.attributes.position;
  if (!pos) return false;
  if (pos.count <= 16) return true;
  _flatBox.setFromBufferAttribute(pos);
  _flatBox.getSize(_flatSz);
  const maxDim = Math.max(_flatSz.x, _flatSz.y, _flatSz.z);
  const minDim = Math.min(_flatSz.x, _flatSz.y, _flatSz.z);
  return maxDim > 0 && minDim / maxDim < 0.02;
}

export function computeBoundingSphere(obj, out, force = false, skipFlat = false) {
  out.makeEmpty();
  const s = new THREE.Sphere();
  function walk(o) {
    if (o.isMesh && o.geometry) {
      const g = o.geometry;
      if (force || !g.boundingSphere) g.computeBoundingSphere();
      if (skipFlat) {
        const gc = g.clone();
        gc.applyMatrix4(o.matrixWorld);
        if (isFlatGeometry(gc)) return;
      }
      s.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
      out.union(s);
    }
    for (const c of o.children) walk(c);
  }
  walk(obj);
  return out;
}
