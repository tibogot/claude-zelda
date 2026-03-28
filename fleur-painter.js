/**
 * fleur-painter.js
 * Brush-paint low-poly procedural flowers with no stem (Genshin-style ground blooms).
 * - Two color slots (A / B): each slot gets its own InstancedMesh per chunk with a
 *   dedicated TSL procedural material — no geometry modification needed.
 * - Positions store yOffset (randomized hover above terrain) baked at placement time.
 * - Chunk-based InstancedMesh + frustumCulled = true matches tree/foliage painters.
 */

import * as THREE from "three";
import {
  and, float, mix, normalWorld, smoothstep, step, texture, uniform, uv, vec2,
} from "three/tsl";

const MAX_FLEURS = 15000;
const CHUNK_SIZE  = 64; // world-units per chunk side

// ── Color presets (from genshin-flowers2.html) ─────────────────────────────
export const FLEUR_PRESETS = {
  main:      { inner: "#fff4b8", outer: "#fb8da0", glow: 0.28 },
  sakura:    { inner: "#ffd9ea", outer: "#ff7ab2", glow: 0.32 },
  zeldaBlue: { inner: "#e8fbff", outer: "#7db8ff", glow: 0.24 },
  sunflower: { inner: "#ffe78c", outer: "#ff9f40", glow: 0.26 },
};

// ── Low-poly octagonal bloom geometry ──────────────────────────────────────
function createBloomGeometry() {
  const sides  = 8;
  const ringR  = [0.0, 0.38, 0.78];
  const ringY  = [0.55, 0.16, 0.0];
  const rOuter = ringR[2];

  const positions = [], uvs = [], indices = [];
  positions.push(0, ringY[0], 0);
  uvs.push(0.5, 0.5);

  const ringStart = [0, 0, 0];
  let vc = 1;
  for (let r = 1; r < ringR.length; r++) {
    ringStart[r] = vc;
    for (let s = 0; s < sides; s++) {
      const a  = (s / sides) * Math.PI * 2 + Math.PI / 8;
      const px = Math.cos(a) * ringR[r];
      const pz = Math.sin(a) * ringR[r];
      positions.push(px, ringY[r], pz);
      uvs.push(px / (rOuter * 2) + 0.5, pz / (rOuter * 2) + 0.5);
      vc++;
    }
  }

  const idx = (r, s) => ringStart[r] + (s % sides);
  for (let s = 0; s < sides; s++)
    indices.push(0, idx(1, s + 1), idx(1, s));
  for (let s = 0; s < sides; s++) {
    const a = idx(1, s), b = idx(1, s + 1), c = idx(2, s), d = idx(2, s + 1);
    indices.push(a, b, c, b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv",       new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

// ── TSL procedural petal material ──────────────────────────────────────────
function createFleurMaterial(innerHex, outerHex, glow, alphaTex) {
  const uInner       = uniform(new THREE.Color(innerHex));
  const uOuter       = uniform(new THREE.Color(outerHex));
  const uGlow        = uniform(float(glow));
  const uLightDir    = uniform(new THREE.Vector3(5, 10, 5).normalize());
  const uAmbient     = uniform(float(0.45));
  const uDiffuse     = uniform(float(0.55));
  const uBacklit     = uniform(float(0.65));
  const uAlphaCutoff = uniform(float(0.35));
  const uAlphaSoft   = uniform(float(0.08));

  const uvCoord = uv();

  // ── PNG alpha mask (same logic as genshin-flowers2) ──
  const texSample   = texture(alphaTex, uvCoord);
  const inBounds    = and(
    uvCoord.x.greaterThan(0), uvCoord.x.lessThan(1),
    uvCoord.y.greaterThan(0), uvCoord.y.lessThan(1),
  );
  const rgbMax      = texSample.r.max(texSample.g).max(texSample.b);
  const alphaFromTex = texSample.a.add(
    rgbMax.mul(float(1).sub(step(float(0.001), texSample.a))),
  );
  const safeAlpha   = inBounds.select(alphaFromTex, float(0));
  const softMask    = smoothstep(
    uAlphaCutoff.sub(uAlphaSoft),
    uAlphaCutoff.add(uAlphaSoft),
    safeAlpha,
  );

  // ── Procedural color: inner→outer radial gradient + center glow ──
  const radial      = uvCoord.sub(vec2(0.5, 0.5)).length().mul(2).clamp(0, 1);
  const base        = mix(uInner, uOuter, radial);
  const centerBoost = mix(float(1.0), float(1.6), radial.oneMinus().mul(uGlow));
  const procColor   = base.mul(centerBoost);

  // ── Backlight shading (same technique as genshin-flowers2) ──
  const nDotL  = normalWorld.normalize().dot(uLightDir.normalize()).toVar();
  const front  = nDotL.max(float(0.0));
  const back   = nDotL.negate().max(float(0.0));
  const litFac = uAmbient.add(front.mul(uDiffuse)).add(back.mul(uBacklit));
  const litCol = procColor.mul(litFac);

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode     = litCol;
  mat.opacityNode   = softMask;
  mat.alphaTestNode = float(0.02);
  mat.transparent   = true;
  mat.depthWrite    = true;
  mat.side          = THREE.DoubleSide;

  mat._uInner = uInner;
  mat._uOuter = uOuter;
  mat._uGlow  = uGlow;

  return mat;
}

// ── Main painter factory ────────────────────────────────────────────────────
export function createFleurSystem(scene, sampleHeight) {
  let positions = []; // [{ x, z, rot, scale, yOffset, colorSlot }]
  const dummy   = new THREE.Object3D();

  // Shared alpha texture — loaded once, used by both materials
  const alphaTex = new THREE.Texture();
  alphaTex.colorSpace   = THREE.SRGBColorSpace;
  alphaTex.wrapS        = THREE.ClampToEdgeWrapping;
  alphaTex.wrapT        = THREE.ClampToEdgeWrapping;
  alphaTex.minFilter    = THREE.LinearMipmapLinearFilter;
  alphaTex.magFilter    = THREE.LinearFilter;
  alphaTex.generateMipmaps = true;
  const _img = new Image();
  _img.onload = () => { alphaTex.image = _img; alphaTex.needsUpdate = true; };
  _img.src = "textures/flowers/Flower32.png";

  // Geometry shared across all chunks + both slots
  const geo  = createBloomGeometry();
  const matA = createFleurMaterial(
    FLEUR_PRESETS.main.inner,   FLEUR_PRESETS.main.outer,   FLEUR_PRESETS.main.glow,   alphaTex);
  const matB = createFleurMaterial(
    FLEUR_PRESETS.sakura.inner, FLEUR_PRESETS.sakura.outer, FLEUR_PRESETS.sakura.glow, alphaTex);

  // chunks: Map<"cx,cz", { imA, imB, capA, capB }>
  const chunks = new Map();

  function chunkKey(cx, cz) { return `${cx},${cz}`; }
  function posToChunk(x, z) {
    return { cx: Math.floor(x / CHUNK_SIZE), cz: Math.floor(z / CHUNK_SIZE) };
  }

  function makeIM(mat, cap) {
    const im = new THREE.InstancedMesh(geo, mat, cap);
    im.castShadow    = false;
    im.receiveShadow = false;
    im.frustumCulled = true;
    im.count         = 0;
    scene.add(im);
    return im;
  }

  // ── Rebuild all chunk InstancedMeshes from positions array ───────────────
  function rebuild() {
    // Group position indices by chunk, then by colorSlot
    const groups = new Map(); // key -> { a: idx[], b: idx[] }
    positions.forEach((pos, idx) => {
      const { cx, cz } = posToChunk(pos.x, pos.z);
      const key = chunkKey(cx, cz);
      if (!groups.has(key)) groups.set(key, { a: [], b: [] });
      (pos.colorSlot === 0 ? groups.get(key).a : groups.get(key).b).push(idx);
    });

    // Remove chunks with no more instances
    for (const key of [...chunks.keys()]) {
      if (!groups.has(key)) {
        const c = chunks.get(key);
        scene.remove(c.imA);
        scene.remove(c.imB);
        chunks.delete(key);
      }
    }

    // Update or create each occupied chunk
    for (const [key, g] of groups) {
      const countA = g.a.length, countB = g.b.length;
      let chunk = chunks.get(key);

      if (!chunk || countA > chunk.capA || countB > chunk.capB) {
        if (chunk) { scene.remove(chunk.imA); scene.remove(chunk.imB); }
        const capA = countA + 32, capB = countB + 32;
        chunk = { imA: makeIM(matA, capA), imB: makeIM(matB, capB), capA, capB };
        chunks.set(key, chunk);
      }

      chunk.imA.count = countA;
      chunk.imB.count = countB;

      const writeIM = (im, indices) => {
        for (let i = 0; i < indices.length; i++) {
          const { x, z, rot, scale, yOffset } = positions[indices[i]];
          dummy.position.set(x, sampleHeight(x, z) + yOffset, z);
          dummy.rotation.set(Math.PI, rot, 0);
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          im.setMatrixAt(i, dummy.matrix);
        }
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
      };

      writeIM(chunk.imA, g.a);
      writeIM(chunk.imB, g.b);
    }
  }

  // ── Scatter flowers within brush radius ──────────────────────────────────
  function addInBrush(cx, cz, radius, perStroke, minSpacing, scaleMin, scaleMax,
                      hoverBase, hoverVariance, colorSlot) {
    const minSq = minSpacing * minSpacing;
    let added = 0;
    for (let attempt = 0; attempt < perStroke * 4 && added < perStroke; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r     = Math.sqrt(Math.random()) * radius;
      const x     = cx + Math.cos(angle) * r;
      const z     = cz + Math.sin(angle) * r;

      let tooClose = false;
      for (let i = 0; i < positions.length; i++) {
        const dx = positions[i].x - x, dz = positions[i].z - z;
        if (dx * dx + dz * dz < minSq) { tooClose = true; break; }
      }
      if (tooClose) continue;

      // Bake random hover offset once at placement — never recalculated
      const yOffset = hoverBase + (Math.random() - 0.5) * 2 * hoverVariance;
      positions.push({
        x, z,
        rot:       Math.random() * Math.PI * 2,
        scale:     scaleMin + Math.random() * (scaleMax - scaleMin),
        yOffset,
        colorSlot,
      });
      added++;
      if (positions.length >= MAX_FLEURS) break;
    }
    if (added > 0) rebuild();
    return added;
  }

  // ── Erase flowers within radius ──────────────────────────────────────────
  function removeInBrush(cx, cz, radius) {
    const rSq    = radius * radius;
    const before = positions.length;
    positions = positions.filter(({ x, z }) => {
      const dx = x - cx, dz = z - cz;
      return dx * dx + dz * dz > rSq;
    });
    if (positions.length !== before) rebuild();
  }

  // ── Re-snap Y after terrain sculpt ───────────────────────────────────────
  function syncHeights() { rebuild(); }

  // ── Live color update from panel ─────────────────────────────────────────
  function setColorA(innerHex, outerHex, glow) {
    matA._uInner.value.set(innerHex);
    matA._uOuter.value.set(outerHex);
    matA._uGlow.value = glow;
  }

  function setColorB(innerHex, outerHex, glow) {
    matB._uInner.value.set(innerHex);
    matB._uOuter.value.set(outerHex);
    matB._uGlow.value = glow;
  }

  // ── Save / Load ──────────────────────────────────────────────────────────
  function getPositions() { return positions.map(p => ({ ...p })); }

  function setPositions(arr) {
    positions = arr.map(p => ({
      x:         p.x,
      z:         p.z,
      rot:       p.rot,
      scale:     p.scale,
      yOffset:   p.yOffset  ?? 0.15,
      colorSlot: p.colorSlot ?? 0,
    }));
    rebuild();
  }

  function clear()    { positions = []; rebuild(); }
  function getCount() { return positions.length; }

  // ── Chunk frustum stats for debug overlay ────────────────────────────────
  const _frustum          = new THREE.Frustum();
  const _projScreenMatrix = new THREE.Matrix4();

  function getChunkStats(camera) {
    if (chunks.size === 0) return { visible: 0, total: 0 };
    _projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_projScreenMatrix);
    let visible = 0;
    for (const chunk of chunks.values()) {
      const probe = chunk.imA.count > 0 ? chunk.imA : chunk.imB;
      if (probe.count > 0 && probe.boundingSphere &&
          _frustum.intersectsSphere(probe.boundingSphere)) visible++;
    }
    return { visible, total: chunks.size };
  }

  return {
    addInBrush, removeInBrush, syncHeights,
    setColorA, setColorB,
    getPositions, setPositions,
    clear, getCount, getChunkStats,
  };
}
