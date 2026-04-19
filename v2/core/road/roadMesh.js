import * as THREE from "three";

export function generateRoadGeometry(curve, width, segments, heightOffset, getWorldHeight) {
  const pts = curve.getSpacedPoints(segments);
  const arcLen = [0];
  for (let i = 1; i <= segments; i++) {
    arcLen.push(arcLen[i - 1] + pts[i].distanceTo(pts[i - 1]));
  }
  const totalLen = arcLen[segments] || 1;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= segments; i++) {
    const u = arcLen[i] / totalLen;
    const pos = pts[i];
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(segments, i + 1)];
    const tan = next.clone().sub(prev).normalize();
    const perp = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const half = width / 2;
    const lx = pos.x - perp.x * half;
    const lz = pos.z - perp.z * half;
    const rx = pos.x + perp.x * half;
    const rz = pos.z + perp.z * half;
    positions.push(lx, getWorldHeight(lx, lz) + heightOffset, lz);
    positions.push(rx, getWorldHeight(rx, rz) + heightOffset, rz);
    uvs.push(u, 0, u, 1);
    if (i < segments) {
      const b = i * 2;
      indices.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
