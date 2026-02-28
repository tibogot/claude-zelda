/**
 * toon-grass.js — Zelda-like stylized grass for grass-compare.html.
 * 2 segments, wider blades, bold 3-band color, single wind layer, no SSS.
 * Terrain height uses the same math formula as grass-compare.html JS version.
 */
import * as THREE from "three";
import {
  Fn, float, vec2, vec3, vec4,
  attribute, varying,
  mix, smoothstep, sin, cos,
  floor, mod, normalize, negate,
  add, sub, mul, div,
  uniform, modelWorldMatrix, normalLocal,
} from "three/tsl";
import {
  hash42, noise12, remap, rotateAxis_mat, rotateY_mat,
} from "./tsl-utils.js";

const SEGS   = 2;
const NVERTS = (SEGS + 1) * 2;
const PI     = Math.PI;

// Shared terrain height formula (must match grass-compare.html JS version)
const terrainHeightTSL = (tx, tz) =>
  add(
    mul(sin(mul(tx, 0.25)), cos(mul(tz, 0.20)), 0.5),
    mul(sin(add(mul(tx, 0.15), mul(tz, 0.10))), 0.3),
    mul(cos(add(mul(tz, 0.30), mul(tx, 0.05))), 0.2),
  );

function buildGeo(numGrass, patchSize) {
  const V = NVERTS, T = V * 2, indices = [];
  for (let i = 0; i < SEGS; i++) {
    const v = i * 2;
    indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    const f = V + v;
    indices.push(f + 2, f + 1, f, f + 3, f + 1, f + 2);
  }
  const pos = new Float32Array(T * 3);
  const nrm = new Float32Array(T * 3);
  const vid = new Float32Array(T);
  for (let i = 0; i < T; i++) { nrm[i * 3 + 1] = 1; vid[i] = i; }
  let s = 42; // different seed from grass-simple
  const rng = () => { const x = Math.sin(s++) * 10000; return x - Math.floor(x); };
  const nC = Math.floor(Math.sqrt(numGrass));
  const nR = Math.ceil(numGrass / nC);
  const cw = patchSize / nC, ch = patchSize / nR;
  const off = new Float32Array(numGrass * 3);
  for (let i = 0; i < numGrass; i++) {
    const col = i % nC, row = Math.floor(i / nC);
    off[i * 3]     = -patchSize * 0.5 + col * cw + rng() * cw;
    off[i * 3 + 1] = -patchSize * 0.5 + row * ch + rng() * ch;
    off[i * 3 + 2] = 0;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = numGrass;
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal",   new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("vertIndex", new THREE.Float32BufferAttribute(vid, 1));
  geo.setAttribute("offset", new THREE.InstancedBufferAttribute(off, 3));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), patchSize * 2 + 4);
  return geo;
}

export function createToonGrassPatch(patchSize = 20, numBlades = 2000) {
  const uTime  = uniform(0);
  const segsF  = float(SEGS);
  const nvertsF = float(NVERTS);

  // Bold Zelda palette: dark base → saturated mid → bright lime tip
  const BASE = vec3(0.07, 0.20, 0.03);
  const MID  = vec3(0.22, 0.58, 0.07);
  const TIP  = vec3(0.60, 0.86, 0.16);

  // Blade: wider and taller than simple grass for a bold silhouette
  const BW = float(0.16);
  const BH = float(0.80);

  // Wind: single smooth layer, slightly more dramatic swing
  const W_SPEED = float(0.6);
  const W_SCALE = float(0.09);
  const W_STR   = float(0.50);

  const vColor  = varying(vec3(0), "v_tc");
  const vPacked = varying(vec3(0), "v_pk");

  const positionNode = Fn(() => {
    const offsetAttr  = attribute("offset",    "vec3");
    const vertIdxAttr = attribute("vertIndex", "float");

    const grassOffset = vec3(offsetAttr.x, 0, offsetAttr.y);
    const bladeWorld  = modelWorldMatrix.mul(vec4(grassOffset, 1)).xyz;

    const hv = hash42(bladeWorld.xz);

    const randomAngle  = mul(hv.x, 2 * PI);
    const randomHeight = remap(hv.z, 0, 1, 0.65, 1.45);
    const randomShade  = remap(hv.y, 0, 1, 0.90, 1.08);

    const vertID    = mod(vertIdxAttr, nvertsF);
    const zSide     = negate(sub(mul(floor(div(vertIdxAttr, nvertsF)), 2), 1));
    const xSide     = mod(vertID, 2);
    const heightPct = div(sub(vertID, xSide), mul(segsF, 2));

    // Linear taper → clean triangle/leaf silhouette (no easeOut)
    const totalWidth  = mul(BW, sub(1, heightPct));
    const totalHeight = mul(BH, randomHeight);
    const x = mul(sub(xSide, 0.5), totalWidth);
    const y = mul(heightPct, totalHeight);

    // Single smooth wind wave with directional scroll
    const windDir    = vec2(0.8, 0.35);
    const windScroll = mul(windDir, mul(uTime, W_SPEED));
    const windUV     = add(mul(bladeWorld.xz, W_SCALE), windScroll);
    const wave       = sub(mul(noise12(windUV), 2), 1);
    const windLean   = mul(wave, W_STR, heightPct);
    const windAxis   = normalize(vec3(0.35, 0, negate(0.8)));

    const grassMat = rotateAxis_mat(windAxis, windLean).mul(rotateY_mat(randomAngle));

    // Simple outward-facing normal for each cross-blade face
    const faceNorm = grassMat.mul(vec3(0, 0.15, 1));
    normalLocal.assign(normalize(mix(faceNorm.mul(zSide), vec3(0, 1, 0), 0.20)));

    const localVert = vec3(x, y, 0);
    const finalVert = add(grassMat.mul(localVert), grassOffset);

    // 3-band toon color gradient with crisper transitions
    const t1  = smoothstep(0.0, 0.28, heightPct);   // base → mid
    const t2  = smoothstep(0.50, 0.70, heightPct);  // mid → tip
    const col = mix(mix(BASE, MID, t1), TIP, t2);
    const ao  = mix(0.50, 1.0, smoothstep(0.0, 0.22, heightPct));

    vColor.assign(mul(col, randomShade, ao));
    vPacked.assign(vec3(heightPct, 0, 0));

    // Terrain height — same formula as grass-compare.html ground mesh
    const terrainH   = terrainHeightTSL(bladeWorld.x, bladeWorld.z);
    const worldFinal = vec3(finalVert.x, add(finalVert.y, terrainH), finalVert.z);
    return worldFinal;
  })();

  const colorNode = Fn(() => {
    let col = vColor;
    // Subtle sun-catch highlight near the tip — adds the "painted" Zelda feel
    const highlight = mul(smoothstep(0.60, 0.95, vPacked.x), 0.12);
    col = add(col, vec3(highlight, highlight, mul(highlight, 0.4)));
    return col;
  })();

  const mat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide, roughness: 1.0, metalness: 0.0,
  });
  mat.positionNode = positionNode;
  mat.colorNode    = colorNode;
  mat.envMapIntensity = 0;

  const mesh = new THREE.Mesh(buildGeo(numBlades, patchSize), mat);
  mesh.frustumCulled = false;
  return { mesh, update(time) { uTime.value = time; } };
}
