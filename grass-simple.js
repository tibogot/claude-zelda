/**
 * grass-simple.js — self-contained stripped-down version of grass.js.
 * Preserves the main visual style. No ctx, no terrain texture, no NPC.
 * Terrain height uses the same math formula as grass-compare.html.
 */
import * as THREE from "three";
import {
  Fn, float, vec2, vec3, vec4,
  attribute, varying,
  mix, smoothstep, clamp, sin, cos, pow,
  floor, mod, normalize, negate,
  add, sub, mul, div, max, dot,
  uniform, modelWorldMatrix, cameraPosition, normalLocal,
} from "three/tsl";
import {
  hash42, hash22, noise12, remap, easeOut, easeIn,
  rotateAxis_mat, rotateY_mat,
} from "./tsl-utils.js";

const SEGS  = 4;
const NVERTS = (SEGS + 1) * 2;
const PI = Math.PI;

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
  let s = 0;
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

export function createSimpleGrassPatch(patchSize = 20, numBlades = 3000) {
  const uTime  = uniform(0);
  const segsF  = float(SEGS);
  const nvertsF = float(NVERTS);

  // Color palette — same feel as main grass
  const BASE1  = vec3(0.10, 0.28, 0.06);
  const BASE2  = vec3(0.14, 0.36, 0.09);
  const TIP1   = vec3(0.44, 0.68, 0.12);
  const TIP2   = vec3(0.54, 0.78, 0.16);
  const LUSH   = vec3(0.08, 0.40, 0.10);
  const BLEACH = vec3(0.64, 0.72, 0.32);
  const BS_COL = vec3(0.28, 0.70, 0.14);

  // Wind (2-layer + gust + micro — same as original)
  const W_DX    = float(1.0), W_DZ = float(0.3);
  const W_SPEED = float(0.8), W_SCALE = float(0.12);
  const W_STR   = float(0.35), W_GUST = float(0.20), W_MICRO = float(0.08);

  // Blade size
  const BW = float(0.08), BH = float(0.65);

  const vGrassColor = varying(vec3(0), "v_gc");
  const vPacked     = varying(vec3(0), "v_pk");
  const vWorldPos   = varying(vec3(0), "v_wp");

  const positionNode = Fn(() => {
    const offsetAttr  = attribute("offset",    "vec3");
    const vertIdxAttr = attribute("vertIndex", "float");

    const grassOffset = vec3(offsetAttr.x, 0, offsetAttr.y);
    const bladeWorld  = modelWorldMatrix.mul(vec4(grassOffset, 1)).xyz;

    const hv  = hash42(bladeWorld.xz);
    const hv2 = hash22(bladeWorld.xz);

    const randomAngle  = mul(hv.x, 2 * PI);
    const randomShade  = remap(hv.y, -1, 1, 0.80, 1.0);
    const randomHeight = remap(hv.z, 0, 1, 0.75, 1.40);
    const randomLean   = remap(hv.w, 0, 1, 0.10, 0.28);

    const vertID    = mod(vertIdxAttr, nvertsF);
    const zSide     = negate(sub(mul(floor(div(vertIdxAttr, nvertsF)), 2), 1));
    const xSide     = mod(vertID, 2);
    const heightPct = div(sub(vertID, xSide), mul(segsF, 2));

    const totalHeight = mul(BH, randomHeight);
    const totalWidth  = mul(BW, easeOut(sub(1, heightPct), 2));
    const x = mul(sub(xSide, 0.5), totalWidth);
    const y = mul(heightPct, totalHeight);

    // Wind — 2 layers + gust + micro
    const windDir    = vec2(W_DX, W_DZ);
    const windScroll = mul(windDir, mul(uTime, W_SPEED));
    const waveUV1    = add(mul(bladeWorld.xz, W_SCALE), windScroll);
    const wave1      = sub(mul(noise12(waveUV1), 2), 1);
    const crossDir   = vec2(negate(W_DZ), W_DX);
    const waveUV2    = add(
      mul(bladeWorld.xz, mul(W_SCALE, 2.3)),
      mul(windScroll, 1.4),
      mul(crossDir, mul(uTime, 0.3)),
    );
    const wave2      = mul(sub(mul(noise12(waveUV2), 2), 1), 0.35);
    const gustUV     = add(mul(bladeWorld.xz, mul(W_SCALE, 0.25)), mul(windScroll, 0.3));
    const gustStr    = mul(smoothstep(0.5, 0.9, noise12(gustUV)), W_GUST);
    const windLean   = mul(add(wave1, wave2, gustStr), W_STR);
    const micro      = mul(sin(add(mul(hv.x, 6.28), mul(uTime, 2.5))), W_MICRO, 0.3);
    const crossSway  = mul(wave2, 0.3, W_STR, heightPct);
    const totalWindLean = mul(add(windLean, micro), heightPct);

    const windAxis  = normalize(vec3(W_DZ, 0, negate(W_DX)));
    const crossAxis = normalize(vec3(W_DX, 0, W_DZ));

    const curveAmt = mul(negate(randomLean), easeIn(heightPct, 2));
    const grassMat = rotateAxis_mat(windAxis, totalWindLean)
      .mul(rotateAxis_mat(crossAxis, crossSway))
      .mul(rotateY_mat(randomAngle));

    // Curved normal (same as original)
    const _hp01  = add(heightPct, 0.01);
    const n1p    = vec3(0, mul(_hp01, cos(curveAmt)),               mul(_hp01, sin(curveAmt)));
    const n2p    = vec3(0, mul(mul(_hp01, 0.9), cos(mul(curveAmt, 0.9))), mul(mul(_hp01, 0.9), sin(mul(curveAmt, 0.9))));
    const gvn    = vec3(0, negate(normalize(sub(n1p, n2p)).z), normalize(sub(n1p, n2p)).y);
    const gvn1   = mul(grassMat, rotateY_mat(mul(PI, 0.3,       zSide)).mul(gvn)).mul(zSide);
    const gvn2   = mul(grassMat, rotateY_mat(mul(PI, -0.3, zSide)).mul(gvn)).mul(zSide);
    normalLocal.assign(normalize(mix(normalize(mix(gvn1, gvn2, xSide)), vec3(0, 1, 0), 0.15)));

    const localVert = vec3(x, mul(y, cos(curveAmt)), mul(y, sin(curveAmt)));
    const finalVert = add(grassMat.mul(localVert), grassOffset);

    // Color (same as original minus seasonal)
    const cn1 = noise12(mul(bladeWorld.xz, 0.015));
    const cn2 = noise12(mul(bladeWorld.xz, 0.04));
    const colorMix = mul(add(cn1, mul(cn2, 0.5)), 0.67);
    const baseCol  = mix(BASE1, BASE2, hv2.x);
    const tipCol   = mix(TIP1,  TIP2,  hv2.y);
    let grassCol   = mul(mix(baseCol, tipCol, easeIn(heightPct, 2.0)), randomShade);
    grassCol = mix(grassCol, mul(LUSH,   randomShade), mul(smoothstep(0.3, 0.6, colorMix), 0.5));
    grassCol = mix(grassCol, mul(BLEACH, randomShade), mul(smoothstep(0.7, 0.9, colorMix), 0.3));
    const ao = mix(0.75, 1.0, smoothstep(0.0, 0.3, heightPct));

    vGrassColor.assign(mul(grassCol, ao));
    vPacked.assign(vec3(heightPct, xSide, 0));

    // Terrain height — same formula as grass-compare.html ground mesh
    const terrainH  = terrainHeightTSL(bladeWorld.x, bladeWorld.z);
    const worldFinal = vec3(finalVert.x, add(finalVert.y, terrainH), finalVert.z);
    vWorldPos.assign(modelWorldMatrix.mul(vec4(worldFinal, 1)).xyz);
    return worldFinal;
  })();

  const colorNode = Fn(() => {
    const heightPct = vPacked.x;
    let col = vGrassColor;
    const SUN       = normalize(vec3(0.6, 0.8, 0.2));
    const viewDir   = normalize(sub(cameraPosition, vWorldPos));
    const n         = normalLocal;
    const backScat  = max(dot(negate(SUN), n), 0);
    const rim       = sub(1, max(dot(n, viewDir), 0));
    const thickness = add(mul(sub(1, heightPct), 0.7), 0.3);
    const sss = clamp(
      add(mul(pow(backScat, 3.0), thickness), mul(pow(rim, 3.0), thickness, 0.4)),
      0, 1,
    );
    col = add(col, mul(BS_COL, 0.3, sss));
    return col;
  })();

  const mat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide, roughness: 0.85, metalness: 0.0,
  });
  mat.positionNode = positionNode;
  mat.colorNode    = colorNode;
  mat.envMapIntensity = 0;

  const mesh = new THREE.Mesh(buildGeo(numBlades, patchSize), mat);
  mesh.frustumCulled = false;
  return { mesh, update(time) { uTime.value = time; } };
}
