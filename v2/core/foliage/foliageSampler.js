/**
 * Deterministic foliage placement from cluster definitions.
 * Uses LCG PRNG seeded per cluster for reproducible results.
 * Supports 3-tier LOD: full density, 50% at 1.414× size, 25% at 2× size.
 */
import * as THREE from "three";

function createLcg(seed) {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

function sampleCluster(c, seedOffset) {
  const rng = createLcg(seedOffset);
  const positions = [];
  const maxTry = c.count * 12;
  let tries = 0;

  while (positions.length < c.count && tries++ < maxTry) {
    const rx = rng() * 2 - 1;
    const ry = rng() * 2 - 1;
    const rz = rng() * 2 - 1;
    const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
    if (d > 1.0) continue;
    const innerR = 1.0 - c.shellThick;
    if (d < innerR && rng() < c.shell) continue;

    positions.push({
      x: c.x + rx * c.rx,
      y: c.y + ry * c.ry,
      z: c.z + rz * c.rx,
      leafSize: c.leafSize,
      scaleVar: c.scaleVar,
      tiltMax: c.tiltMax,
    });
  }
  return positions;
}

export function sampleAllClusters(clusters) {
  const allPos = [];
  const allRands = [];
  const rng = createLcg(77777);
  clusters.forEach((c, ci) => {
    if (!c.enabled) return;
    sampleCluster(c, ci * 999983 + 12345).forEach(p => {
      allPos.push(p);
      allRands.push(rng(), rng());
    });
  });
  return { allPos, allRands };
}

export function computeFoliageBounds(positions) {
  let yMin = Infinity, yMax = -Infinity;
  let xMin = Infinity, xMax = -Infinity;
  let zMin = Infinity, zMax = -Infinity;
  for (const p of positions) {
    if (p.y < yMin) yMin = p.y;
    if (p.y > yMax) yMax = p.y;
    if (p.x < xMin) xMin = p.x;
    if (p.x > xMax) xMax = p.x;
    if (p.z < zMin) zMin = p.z;
    if (p.z > zMax) zMax = p.z;
  }
  const cx = (xMin + xMax) * 0.5;
  const cy = (yMin + yMax) * 0.5;
  const cz = (zMin + zMax) * 0.5;
  const ext = Math.max(xMax - xMin, yMax - yMin, zMax - zMin);
  return {
    yMin: yMin - 0.3,
    yMax: yMax + 0.5,
    canopyCenter: new THREE.Vector3(cx, cy, cz),
    aoRadius: ext * 0.62,
  };
}

/**
 * Build an InstancedMesh geometry + matrix arrays for a given LOD tier.
 * @param {Array} positions - from sampleAllClusters
 * @param {Array} rands - from sampleAllClusters
 * @param {number} lodTier - 0, 1, or 2
 * @returns {{ geometry: THREE.PlaneGeometry, matrices: Float32Array, count: number, randData: Float32Array }}
 */
export function buildFoliageLod(positions, rands, lodTier) {
  let step, scaleMul;
  if (lodTier === 0) {
    step = 1; scaleMul = 1.0;
  } else if (lodTier === 1) {
    step = 2; scaleMul = Math.SQRT2;
  } else {
    step = 4; scaleMul = 2.0;
  }

  const indices = [];
  for (let i = 0; i < positions.length; i += step) indices.push(i);
  const n = indices.length;
  if (n === 0) return null;

  const geo = new THREE.PlaneGeometry(1, 1);
  const randData = new Float32Array(n * 2);
  const matrices = new Float32Array(n * 16);
  const dummy = new THREE.Object3D();
  const DEG2RAD = Math.PI / 180;
  const rng = createLcg(lodTier * 31337 + 42);

  for (let j = 0; j < n; j++) {
    const i = indices[j];
    const p = positions[i];
    randData[j * 2] = rands[i * 2];
    randData[j * 2 + 1] = rands[i * 2 + 1];

    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.order = "YXZ";
    dummy.rotation.y = rng() * Math.PI * 2;
    dummy.rotation.x = (rng() - 0.5) * p.tiltMax * DEG2RAD * 2;
    dummy.rotation.z = (rng() - 0.5) * p.tiltMax * DEG2RAD * 2;
    const s = Math.max(0.05, p.leafSize * scaleMul * (1 + (rng() - 0.5) * 2 * p.scaleVar));
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    dummy.matrix.toArray(matrices, j * 16);
  }

  geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(randData, 2));

  return { geometry: geo, matrices, count: n, randData };
}
