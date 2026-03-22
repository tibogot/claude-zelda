/**
 * flowers.js — Instanced flower system for splatmap-painter integration.
 *
 * Architecture mirrors grass.js. Usage:
 *
 *   // 1. Create uniforms (once)
 *   const flowerCtx = createFlowerUniforms({ terrainSize: TERRAIN_SIZE, ...overrides });
 *   flowerCtx.uHeightTex  = heightTexture;        // raw THREE.Texture
 *   flowerCtx.uDensityTex = flowerDensityTexture; // raw THREE.Texture
 *
 *   // 2. Create geometry + materials (once, shared by all patches)
 *   const flowerGeos = createFlowerGeometry(FLOWER_DENSITY, FLOWER_PATCH_SIZE);
 *   const flowerMats = createFlowerMaterials(petalAlphaTex, flowerCtx);
 *
 *   // 3. Setup patch pool (once)
 *   const flowerGroup = new THREE.Group();
 *   scene.add(flowerGroup);
 *   const flowers = setupFlowerPatches(scene, camera, flowerGroup,
 *     { ...flowerGeos, ...flowerMats }, {});
 *
 *   // 4. Each frame
 *   flowerCtx.uPlayerPos.value.copy(playerPos);
 *   flowers.update(playerPos, frustum);
 */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  Fn,
  float, vec2, vec3, vec4,
  attribute, varying, uniform,
  texture, normalMap,
  mix, max, clamp, sin, cos, fract, smoothstep, length, normalize,
  positionLocal, normalWorld,
  modelWorldMatrix,
  cameraPosition,
  time, uv,
} from "three/tsl";
import { hash42 } from "./tsl-utils.js";

// ─── Constants ────────────────────────────────────────────────────────────────
export const FLOWER_PATCH_SIZE  = 10;   // World units per patch tile
export const FLOWER_DENSITY     = 64;   // Flowers per patch (keep near a perfect square)
export const FLOWER_GRID_SIZE   = 5;    // Half-extent of patch grid (5 → 11×11 patches visible)
export const FLOWER_MAX_DIST    = 60;   // Patches beyond this distance are hidden
export const FLOWER_PETAL_COUNT = 6;    // Fixed petal count per flower (variety via color/height)

// ─── Procedural petal dome normal map (shared, created once) ─────────────────
function _makePetalNormalTex(size = 64, dome = 0.2) {
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x - half) / half, v = (y - half) / half;
      const nx = -u * dome, ny = -v * dome;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const i  = (y * size + x) * 4;
      data[i]   = Math.round((nx * 0.5 + 0.5) * 255);
      data[i+1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i+2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i+3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
export const PETAL_NORMAL_TEX = _makePetalNormalTex();

// ─── JS-side hash (for geometry generation) ───────────────────────────────────
function hash(i) {
  const h = (i * 2654435761) >>> 0;
  return (h % 10000) / 10000;
}

// ─── TSL varyings (module-level — one set shared across all flower materials) ─
const vPetalHeightNorm = varying(float(0), 'v_f_phn');
const vPetalRadialNorm = varying(float(0), 'v_f_prn');
const vStemHeightNorm  = varying(float(0), 'v_f_shn');
const vColorVar        = varying(float(0), 'v_f_cv');

// ─── Uniforms ─────────────────────────────────────────────────────────────────
/**
 * Create all uniforms for the flower system.
 * After creation, assign the height and density textures as raw THREE.Texture:
 *   ctx.uHeightTex  = heightTexture;
 *   ctx.uDensityTex = flowerDensityTexture;
 *
 * @param {object} params  Override any default value
 * @returns {object}       Uniforms ctx — pass to createFlowerMaterials
 */
export function createFlowerUniforms(params = {}) {
  const p = {
    windDir:          0.7,
    windSpeed:        1.2,
    windStr:          0.1,
    flowerHeight:     0.7,
    subsurfaceStr:    0.35,
    groundOccStr:     0.4,
    groundBleed:      0.15,
    groundColor:      '#3d5a3d',
    petalColorBase:   '#ff0000',
    petalColorTip:    '#0000ff',
    petalColorAlt:    '#ff8800',
    colorVariation:   0.5,
    gradientBlend:    1.0,
    petalNoiseStr:    0.08,
    normalMapStr:     0.3,
    centerColor:      '#ffdd44',
    stemColor:        '#4a7c3e',
    stemColorTop:     '#5a9c4e',
    stemBaseBend:     0.08,
    interactionRange: 2.5,
    interactionStr:   0.6,
    terrainSize:      512,
    ...params,
  };

  return {
    uWindDir:          uniform(p.windDir),
    uWindSpeed:        uniform(p.windSpeed),
    uWindStr:          uniform(p.windStr),
    uMaxHeight:        uniform(p.flowerHeight * 1.5),
    uSubsurfaceStr:    uniform(p.subsurfaceStr),
    uGroundOccStr:     uniform(p.groundOccStr),
    uGroundBleed:      uniform(p.groundBleed),
    uGroundColor:      uniform(new THREE.Color(p.groundColor)),
    uPetalColorBase:   uniform(new THREE.Color(p.petalColorBase)),
    uPetalColorTip:    uniform(new THREE.Color(p.petalColorTip)),
    uPetalColorAlt:    uniform(new THREE.Color(p.petalColorAlt)),
    uColorVarStr:      uniform(p.colorVariation),
    uGradientBlend:    uniform(p.gradientBlend),
    uPetalNoiseStr:    uniform(p.petalNoiseStr),
    uNormalMapStr:     uniform(p.normalMapStr),
    uCenterColor:      uniform(new THREE.Color(p.centerColor)),
    uStemColorBase:    uniform(new THREE.Color(p.stemColor)),
    uStemColorTop:     uniform(new THREE.Color(p.stemColorTop)),
    uStemBaseBend:     uniform(p.stemBaseBend),
    uPlayerPos:        uniform(new THREE.Vector3(0, 100, 0)), // y=100 = no interaction until set
    uInteractionRange: uniform(p.interactionRange),
    uInteractionStr:   uniform(p.interactionStr),
    uTerrainSize:      uniform(p.terrainSize),
    uHeightTex:        null,   // caller: ctx.uHeightTex  = yourTex  (raw THREE.Texture)
    uDensityTex:       null,   // caller: ctx.uDensityTex = yourTex  (raw THREE.Texture)
  };
}

// ─── Petal head geometry builder ─────────────────────────────────────────────
function _buildPetalHeadGeo(pc, petalScale, petalTilt, petalVariation, normalBend) {
  const base = new THREE.PlaneGeometry(1, 1, 1, 1);
  const group = new THREE.Group();
  const geos = [];
  for (let i = 0; i < pc; i++) {
    const vary  = ((i * 7) % 100) / 100;
    const angle = (i / pc) * Math.PI * 2 + (vary - 0.5) * 2 * petalVariation;
    const sM    = 1 + (vary - 0.5) * 2 * petalVariation;
    const pg = new THREE.Group();
    pg.rotation.y = angle;
    const m = new THREE.Mesh(base.clone(), new THREE.MeshBasicMaterial());
    m.scale.set(petalScale * sM, petalScale * sM, 1);
    m.rotation.x = -Math.PI / 2 - petalTilt;
    m.position.set(0, 0.001, 0.5 * petalScale);
    pg.add(m);
    group.add(pg);
  }
  group.updateMatrixWorld(true);
  const inv = group.matrixWorld.clone().invert();
  group.traverse(child => {
    if (child.isMesh)
      geos.push(child.geometry.clone().applyMatrix4(inv.clone().multiply(child.matrixWorld)));
  });
  const merged = mergeGeometries(geos);
  geos.forEach(g => g.dispose());
  base.dispose();

  // Per-vertex radial distance (0 = center, 1 = tip) for gradient
  const pos = merged.attributes.position;
  const maxR = petalScale * 1.2;
  const radial = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++)
    radial[i] = Math.min(1, Math.sqrt(pos.getX(i) ** 2 + pos.getZ(i) ** 2) / maxR);
  merged.setAttribute('aRadialNorm', new THREE.BufferAttribute(radial, 1));

  // Bend normals outward for rounder petal look
  const norm = merged.attributes.normal;
  const up = new THREE.Vector3(0, 1, 0);
  const v  = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (v.length() > 0.01) {
      n.fromBufferAttribute(norm, i);
      n.lerpVectors(up, v.clone().normalize(), normalBend).normalize();
      norm.setXYZ(i, n.x, n.y, n.z);
    }
  }
  norm.needsUpdate = true;
  return merged;
}

// ─── Patch geometry ───────────────────────────────────────────────────────────
/**
 * Create InstancedBufferGeometry for each flower component.
 * All patches SHARE these geometries — per-flower variety comes from
 * world-space hash42() in the vertex shader, so different patches
 * look different even with identical geometry.
 *
 * @param {number} numFlowers  Flowers per patch (e.g. FLOWER_DENSITY)
 * @param {number} patchSize   World units per patch (e.g. FLOWER_PATCH_SIZE)
 * @param {object} [params]    Optional shape overrides
 * @returns {{ petalGeo, centerGeo, stemGeo, leafGeo }}
 */
export function createFlowerGeometry(numFlowers, patchSize, params = {}) {
  const p = {
    petalCount:     FLOWER_PETAL_COUNT,
    petalScale:     0.22,
    petalTilt:      0.25,
    petalVariation: 0.06,
    normalBend:     0.25,
    centerRadius:   0.08,
    centerDomeH:    0.02,
    stemRadius:     0.012,
    leafScale:      0.15,
    ...params,
  };

  // Grid-jittered XZ offsets relative to patch center (same for all patches)
  const nc = Math.floor(Math.sqrt(numFlowers));
  const nr = Math.ceil(numFlowers / nc);
  const cw = patchSize / nc, ch = patchSize / nr;
  const offsets = new Float32Array(numFlowers * 2); // [x0,z0, x1,z1, ...]
  for (let i = 0; i < numFlowers; i++) {
    const col = i % nc, row = Math.floor(i / nc);
    offsets[i*2]   = -patchSize * 0.5 + col * cw + hash(i * 11) * cw;
    offsets[i*2+1] = -patchSize * 0.5 + row * ch + hash(i * 13) * ch;
  }

  function instGeo(baseGeo, n, extraAttribs = {}) {
    const g = new THREE.InstancedBufferGeometry().copy(baseGeo);
    g.instanceCount = n;
    g.setAttribute('aFlowerOffset', new THREE.InstancedBufferAttribute(offsets.slice(), 2));
    for (const [name, arr] of Object.entries(extraAttribs))
      g.setAttribute(name, new THREE.InstancedBufferAttribute(arr, 1));
    return g;
  }

  // ── Petal head ──────────────────────────────────────────────────────────────
  const headBase = _buildPetalHeadGeo(p.petalCount, p.petalScale, p.petalTilt, p.petalVariation, p.normalBend);
  const petalGeo = instGeo(headBase, numFlowers);
  headBase.dispose();

  // ── Center dome ─────────────────────────────────────────────────────────────
  const cBase = new THREE.SphereGeometry(p.centerRadius, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.5);
  cBase.scale(1, Math.max(0.1, p.centerDomeH / Math.max(p.centerRadius, 0.01)), 1);
  cBase.translate(0, 0.0005, 0);
  const centerGeo = instGeo(cBase, numFlowers);
  cBase.dispose();

  // ── Stem ────────────────────────────────────────────────────────────────────
  const sBase = new THREE.CylinderGeometry(p.stemRadius * 1.1, p.stemRadius, 1, 5, 8);
  const stemGeo = instGeo(sBase, numFlowers);
  sBase.dispose();

  // ── Leaves (2 per flower, instanced as 2*numFlowers) ────────────────────────
  // aLeafSide = 0 or 1 to distinguish the two leaves of each flower
  const leafScale   = Math.max(0.01, p.leafScale);
  const lBase       = new THREE.PlaneGeometry(1, 1, 1, 1);
  lBase.scale(leafScale * 0.4, leafScale, 1);
  lBase.translate(0, -0.5 * leafScale, 0);
  lBase.rotateX(-Math.PI / 2);

  const leafOffsets = new Float32Array(numFlowers * 2 * 2); // 2 leaves × vec2
  const leafSides   = new Float32Array(numFlowers * 2);     // 0 or 1
  for (let i = 0; i < numFlowers; i++) {
    for (let L = 0; L < 2; L++) {
      leafOffsets[(i*2+L)*2]   = offsets[i*2];
      leafOffsets[(i*2+L)*2+1] = offsets[i*2+1];
      leafSides[i*2+L]         = L;
    }
  }
  const leafGeo = new THREE.InstancedBufferGeometry().copy(lBase);
  leafGeo.instanceCount = numFlowers * 2;
  leafGeo.setAttribute('aFlowerOffset', new THREE.InstancedBufferAttribute(leafOffsets, 2));
  leafGeo.setAttribute('aLeafSide',     new THREE.InstancedBufferAttribute(leafSides,   1));
  lBase.dispose();

  return { petalGeo, centerGeo, stemGeo, leafGeo };
}

// ─── Materials ────────────────────────────────────────────────────────────────
/**
 * Build all 4 flower materials using TSL node materials.
 * Vertex shaders use hash42(worldXZ) for per-flower variety so all patches
 * look unique with identical geometry.
 *
 * @param {THREE.Texture|null} petalTex  Alpha texture (petal shape mask, R channel)
 * @param {object} ctx                   Uniforms from createFlowerUniforms()
 * @returns {{ petalMat, centerMat, stemMat, leafMat }}
 */
export function createFlowerMaterials(petalTex, ctx) {
  const {
    uWindDir, uWindSpeed, uWindStr,
    uMaxHeight, uSubsurfaceStr,
    uGroundOccStr, uGroundBleed, uGroundColor,
    uPetalColorBase, uPetalColorTip, uPetalColorAlt,
    uColorVarStr, uGradientBlend, uPetalNoiseStr,
    uNormalMapStr, uCenterColor,
    uStemColorBase, uStemColorTop, uStemBaseBend,
    uPlayerPos, uInteractionRange, uInteractionStr,
    uTerrainSize, uHeightTex, uDensityTex,
  } = ctx;

  // ── Shared inline helpers ──────────────────────────────────────────────────
  // Both evaluated at shader-build time — null checks are JS, not GPU

  function sampleTerrainH(worldXZ) {
    if (!uHeightTex) return float(0);
    const uv2 = clamp(worldXZ.div(uTerrainSize).add(vec2(0.5)), 0.01, 0.99);
    return texture(uHeightTex, uv2).r;
  }

  function sampleVisible(worldXZ) {
    if (!uDensityTex) return float(1);
    const uv2 = clamp(worldXZ.div(uTerrainSize).add(vec2(0.5)), 0.01, 0.99);
    return smoothstep(float(0.05), float(0.15), texture(uDensityTex, uv2).r);
  }

  // Shared wind + interaction kernel — used by petals and center
  // Returns the XZ lean amount given flower world XZ and height
  function windAndInteraction(worldXZ, flowerH, flowerIdx) {
    const phase    = time.mul(uWindSpeed).add(flowerIdx.mul(0.5)).add(uWindDir);
    const bend     = phase.sin().mul(uWindStr).mul(flowerH);
    const micro    = phase.mul(2.3).add(flowerIdx).sin().mul(0.2).mul(uWindStr).mul(flowerH);
    const windAmt  = bend.add(micro);

    // Player interaction: compute using world position approximation
    const worldPos = vec3(worldXZ.x, flowerH, worldXZ.y);
    const toPlayer = vec3(uPlayerPos.x.sub(worldPos.x), float(0), uPlayerPos.z.sub(worldPos.z));
    const pDist    = length(toPlayer);
    const pFall    = smoothstep(uInteractionRange, float(0.3), pDist);
    const pDir     = normalize(toPlayer.mul(-1));
    const pLean    = pFall.mul(uInteractionStr).mul(flowerH);

    return {
      leanX: uWindDir.cos().mul(windAmt).add(pDir.x.mul(pLean)),
      leanZ: uWindDir.sin().mul(windAmt).add(pDir.z.mul(pLean)),
    };
  }

  // ── PETAL MATERIAL ─────────────────────────────────────────────────────────
  const petalPosFn = Fn(() => {
    const offset  = attribute('aFlowerOffset', 'vec2');
    const radialN = attribute('aRadialNorm',   'float');

    // World XZ of this flower's base
    const worldXZ  = modelWorldMatrix.mul(vec4(offset.x, float(0), offset.y, float(1))).xz;
    const hv       = hash42(worldXZ);

    // Per-flower variety from world hash
    const flowerH   = uMaxHeight.mul(float(0.6).add(hv.x.mul(0.5)));
    const flowerIdx = hv.y.mul(1000.0);
    const colorV    = hv.z;
    const rotY      = hv.w.mul(Math.PI * 2);

    // Pass to fragment stage
    vPetalHeightNorm.assign(flowerH.div(uMaxHeight).clamp(0, 1));
    vPetalRadialNorm.assign(radialN);
    vColorVar.assign(colorV);

    // Y-rotate petal head geometry
    const cosR = cos(rotY), sinR = sin(rotY);
    const pos  = positionLocal.toVar();
    const rx   = pos.x.mul(cosR).sub(pos.z.mul(sinR));
    const rz   = pos.x.mul(sinR).add(pos.z.mul(cosR));
    pos.x.assign(rx);
    pos.z.assign(rz);

    // Wind + player interaction lean
    const { leanX, leanZ } = windAndInteraction(worldXZ, flowerH, flowerIdx);
    pos.x.addAssign(leanX);
    pos.z.addAssign(leanZ);

    // Lift to flower head height + terrain
    const terrainH = sampleTerrainH(worldXZ);
    pos.y.addAssign(flowerH.add(terrainH));

    // Translate to flower's XZ position within patch
    pos.x.addAssign(offset.x);
    pos.z.addAssign(offset.y);

    // Density: collapse to underground when not painted
    const visible = sampleVisible(worldXZ);
    return mix(vec3(offset.x, terrainH.sub(5.0), offset.y), pos, visible);
  });

  const petalColorFn = Fn(() => {
    const variedBase = mix(uPetalColorBase, uPetalColorAlt, vColorVar.mul(uColorVarStr));
    const gradColor  = mix(variedBase, uPetalColorTip, vPetalRadialNorm);
    const baseCol    = mix(variedBase, gradColor, uGradientBlend);
    const occ        = float(1).sub(uGroundOccStr.mul(float(1).sub(vPetalHeightNorm)));
    const bleedT     = uGroundBleed.mul(float(1).sub(vPetalHeightNorm)).clamp(0, 1);
    const noiseUV    = uv().mul(8.0);
    const noiseVal   = noiseUV.x.mul(12.9898).add(noiseUV.y.mul(78.233)).sin().mul(43758.5453).fract();
    const noiseScale = float(1).add(noiseVal.sub(0.5).mul(2.0).mul(uPetalNoiseStr));
    return mix(baseCol.mul(occ), uGroundColor, bleedT).mul(noiseScale);
  });

  const petalSssFn = Fn(() => {
    const backlight  = normalWorld.y.negate().max(0.0);
    const variedBase = mix(uPetalColorBase, uPetalColorAlt, vColorVar.mul(uColorVarStr));
    const gradColor  = mix(variedBase, uPetalColorTip, vPetalRadialNorm);
    const baseCol    = mix(variedBase, gradColor, uGradientBlend);
    return baseCol.mul(backlight).mul(uSubsurfaceStr);
  });

  const petalMat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide, transparent: true, depthWrite: true,
    roughness: 0.85, metalness: 0,
  });
  petalMat.positionNode = petalPosFn();
  petalMat.colorNode    = petalColorFn();
  petalMat.emissiveNode = petalSssFn();
  petalMat.normalNode   = normalMap(texture(PETAL_NORMAL_TEX), vec2(uNormalMapStr, uNormalMapStr));
  if (petalTex) {
    petalMat.opacityNode     = texture(petalTex).r;
    petalMat.alphaTestNode   = float(0.02);
    petalMat.alphaToCoverage = true;
  }

  // ── CENTER DOME MATERIAL ───────────────────────────────────────────────────
  const centerPosFn = Fn(() => {
    const offset   = attribute('aFlowerOffset', 'vec2');
    const worldXZ  = modelWorldMatrix.mul(vec4(offset.x, float(0), offset.y, float(1))).xz;
    const hv       = hash42(worldXZ);
    const flowerH  = uMaxHeight.mul(float(0.6).add(hv.x.mul(0.5)));
    const flowerIdx = hv.y.mul(1000.0);
    const rotY     = hv.w.mul(Math.PI * 2);

    const cosR = cos(rotY), sinR = sin(rotY);
    const pos  = positionLocal.toVar();
    const rx   = pos.x.mul(cosR).sub(pos.z.mul(sinR));
    const rz   = pos.x.mul(sinR).add(pos.z.mul(cosR));
    pos.x.assign(rx);
    pos.z.assign(rz);

    const { leanX, leanZ } = windAndInteraction(worldXZ, flowerH, flowerIdx);
    pos.x.addAssign(leanX);
    pos.z.addAssign(leanZ);

    const terrainH = sampleTerrainH(worldXZ);
    pos.y.addAssign(flowerH.add(terrainH));
    pos.x.addAssign(offset.x);
    pos.z.addAssign(offset.y);

    const visible = sampleVisible(worldXZ);
    return mix(vec3(offset.x, terrainH.sub(5.0), offset.y), pos, visible);
  });

  const centerMat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide, roughness: 0.9, metalness: 0,
  });
  centerMat.positionNode = centerPosFn();
  centerMat.colorNode    = uCenterColor;
  centerMat.normalNode   = normalMap(
    texture(PETAL_NORMAL_TEX),
    vec2(uNormalMapStr.mul(0.5), uNormalMapStr.mul(0.5))
  );

  // ── STEM MATERIAL ─────────────────────────────────────────────────────────
  const stemPosFn = Fn(() => {
    const offset   = attribute('aFlowerOffset', 'vec2');
    const worldXZ  = modelWorldMatrix.mul(vec4(offset.x, float(0), offset.y, float(1))).xz;
    const hv       = hash42(worldXZ);
    const flowerH  = uMaxHeight.mul(float(0.6).add(hv.x.mul(0.5)));
    const flowerIdx = hv.y.mul(1000.0);
    const rotY     = hv.w.mul(Math.PI * 2);

    // Remap cylinder local Y (-0.5..0.5) → height fraction (0..1)
    const heightPct = positionLocal.y.add(0.5).clamp(0, 1);
    vStemHeightNorm.assign(heightPct);

    const cosR = cos(rotY), sinR = sin(rotY);
    const pos  = positionLocal.toVar();

    // Scale Y to actual stem height
    pos.y.assign(heightPct.mul(flowerH));

    // Y-rotate stem cross-section
    const rx = pos.x.mul(cosR).sub(pos.z.mul(sinR));
    const rz = pos.x.mul(sinR).add(pos.z.mul(cosR));
    pos.x.assign(rx);
    pos.z.assign(rz);

    // Wind sway (stronger toward top) + base lean
    const baseBend = float(1).sub(heightPct).pow(2).mul(uStemBaseBend).mul(flowerH);
    const phase    = time.mul(uWindSpeed).add(flowerIdx.mul(0.5)).add(uWindDir);
    const bend     = phase.sin().mul(uWindStr).mul(flowerH).mul(heightPct.pow(2));
    const micro    = phase.mul(2.3).add(flowerIdx).sin().mul(0.15).mul(uWindStr).mul(flowerH).mul(heightPct);
    pos.x.addAssign(uWindDir.add(0.5).cos().mul(baseBend).add(uWindDir.cos().mul(bend.add(micro))));
    pos.z.addAssign(uWindDir.add(0.5).sin().mul(baseBend).add(uWindDir.sin().mul(bend.add(micro))));

    // Terrain + XZ offset
    const terrainH = sampleTerrainH(worldXZ);
    pos.y.addAssign(terrainH);
    pos.x.addAssign(offset.x);
    pos.z.addAssign(offset.y);

    const visible = sampleVisible(worldXZ);
    return mix(vec3(offset.x, terrainH.sub(5.0), offset.y), pos, visible);
  });

  const stemColorFn = Fn(() => mix(uStemColorBase, uStemColorTop, vStemHeightNorm));

  const stemMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  stemMat.positionNode = stemPosFn();
  stemMat.colorNode    = stemColorFn();

  // ── LEAF MATERIAL ─────────────────────────────────────────────────────────
  const leafPosFn = Fn(() => {
    const offset   = attribute('aFlowerOffset', 'vec2');
    const leafSide = attribute('aLeafSide',     'float'); // 0 or 1
    const worldXZ  = modelWorldMatrix.mul(vec4(offset.x, float(0), offset.y, float(1))).xz;
    const hv       = hash42(worldXZ);
    const flowerH  = uMaxHeight.mul(float(0.6).add(hv.x.mul(0.5)));
    const flowerIdx = hv.y.mul(1000.0);

    // Leaf placement: height along stem (25-50% up) + angular offset per leaf side
    const stemFrac  = float(0.25).add(hv.z.mul(0.25)); // 25-50% up the stem
    const leafY     = flowerH.mul(stemFrac);
    const baseAngle = hv.w.mul(Math.PI * 2);
    const leafAngle = baseAngle.add(leafSide.mul(Math.PI)); // 180° apart

    const cosA = cos(leafAngle), sinA = sin(leafAngle);
    const pos  = positionLocal.toVar();

    // Orient leaf: rotate so it points outward from stem at leafAngle
    const rx = pos.x.mul(cosA).sub(pos.z.mul(sinA));
    const rz = pos.x.mul(sinA).add(pos.z.mul(cosA));
    pos.x.assign(rx);
    pos.z.assign(rz);

    // Wind sway (same phase as stem)
    const phase = time.mul(uWindSpeed).add(flowerIdx.mul(0.5)).add(uWindDir);
    const sway  = phase.sin().mul(uWindStr).mul(flowerH).mul(stemFrac);
    pos.x.addAssign(uWindDir.cos().mul(sway));
    pos.z.addAssign(uWindDir.sin().mul(sway));

    // Position at height on stem + terrain + XZ offset
    const terrainH = sampleTerrainH(worldXZ);
    pos.y.addAssign(leafY.add(terrainH));
    pos.x.addAssign(offset.x);
    pos.z.addAssign(offset.y);

    const visible = sampleVisible(worldXZ);
    return mix(vec3(offset.x, terrainH.sub(5.0), offset.y), pos, visible);
  });

  const leafMat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide, transparent: true, roughness: 0.95, metalness: 0,
  });
  leafMat.positionNode = leafPosFn();
  leafMat.colorNode    = uStemColorBase;
  if (petalTex) {
    leafMat.opacityNode   = texture(petalTex).r;
    leafMat.alphaTestNode = float(0.01);
  }

  return { petalMat, centerMat, stemMat, leafMat };
}

// ─── Patch pool system ────────────────────────────────────────────────────────
/**
 * Create a pool of flower patches with frustum culling + distance culling.
 * Call update(charPos, frustum) every frame.
 *
 * Each "patch" is 4 Mesh objects (petals, center, stems, leaves) sharing
 * the geometries and materials passed in. Patches are repositioned to cover
 * a GRID_SIZE×GRID_SIZE grid around the camera each frame.
 *
 * @param {THREE.Scene}    scene
 * @param {THREE.Camera}   camera
 * @param {THREE.Group}    flowerGroup   Add this group to the scene before calling
 * @param {{ petalGeo, centerGeo, stemGeo, leafGeo,
 *           petalMat, centerMat, stemMat, leafMat }} geosMats
 * @param {{ PATCH_SIZE?: number, GRID_SIZE?: number, MAX_DIST?: number }} options
 * @returns {{ update(charPos: THREE.Vector3, frustum: THREE.Frustum): void }}
 */
export function setupFlowerPatches(scene, camera, flowerGroup, geosMats, options = {}) {
  const {
    petalGeo, centerGeo, stemGeo, leafGeo,
    petalMat, centerMat, stemMat, leafMat,
  } = geosMats;

  const PATCH_SIZE = options.PATCH_SIZE ?? FLOWER_PATCH_SIZE;
  const GRID_SIZE  = options.GRID_SIZE  ?? FLOWER_GRID_SIZE;
  const MAX_DIST   = options.MAX_DIST   ?? FLOWER_MAX_DIST;

  // Pool of patch objects — each has 4 Mesh children added to flowerGroup
  const pool = [];

  function acquirePatch() {
    for (const p of pool) {
      if (!p.active) { p.active = true; return p; }
    }
    // Allocate new patch
    const petalMesh  = new THREE.Mesh(petalGeo,  petalMat);
    const centerMesh = new THREE.Mesh(centerGeo, centerMat);
    const stemMesh   = new THREE.Mesh(stemGeo,   stemMat);
    const leafMesh   = new THREE.Mesh(leafGeo,   leafMat);
    for (const m of [petalMesh, centerMesh, stemMesh, leafMesh]) {
      m.frustumCulled = false;
      m.castShadow    = false;
      m.receiveShadow = false;
      flowerGroup.add(m);
    }
    const p = { petalMesh, centerMesh, stemMesh, leafMesh, active: true };
    pool.push(p);
    return p;
  }

  function setPosition(patch, px, pz) {
    patch.petalMesh.position.set(px, 0, pz);
    patch.centerMesh.position.set(px, 0, pz);
    patch.stemMesh.position.set(px, 0, pz);
    patch.leafMesh.position.set(px, 0, pz);
  }

  function setVisible(patch, v) {
    patch.petalMesh.visible  = v;
    patch.centerMesh.visible = v;
    patch.stemMesh.visible   = v;
    patch.leafMesh.visible   = v;
  }

  // Reusable objects to avoid GC pressure
  const baseCellPos = new THREE.Vector3();
  const camXZ       = new THREE.Vector3();
  const cellPos     = new THREE.Vector3();
  const aabb        = new THREE.Box3();
  const aabbSize    = new THREE.Vector3(PATCH_SIZE, 1000, PATCH_SIZE);

  function update(charPos, frustum) {
    // Deactivate all patches
    for (const p of pool) {
      p.active = false;
      setVisible(p, false);
    }

    // Snap camera to patch grid
    baseCellPos
      .copy(camera.position)
      .divideScalar(PATCH_SIZE)
      .floor()
      .multiplyScalar(PATCH_SIZE);
    camXZ.set(camera.position.x, 0, camera.position.z);

    for (let x = -GRID_SIZE; x <= GRID_SIZE; x++) {
      for (let z = -GRID_SIZE; z <= GRID_SIZE; z++) {
        cellPos.set(
          baseCellPos.x + x * PATCH_SIZE,
          0,
          baseCellPos.z + z * PATCH_SIZE,
        );
        aabb.setFromCenterAndSize(cellPos, aabbSize);

        const dist = aabb.distanceToPoint(camXZ);
        if (dist > MAX_DIST) continue;
        if (!frustum.intersectsBox(aabb)) continue;

        const patch = acquirePatch();
        setPosition(patch, cellPos.x, cellPos.z);
        setVisible(patch, true);
      }
    }
  }

  return { update };
}
