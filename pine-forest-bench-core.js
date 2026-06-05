/**
 * Chunked card-pine forest (pine-editor32 placement + 3 LOD tiers).
 * LOD0 foliage receiveShadow only; LOD1 = same shader, no receive; LOD2 = cheap shader.
 */
import * as THREE from "three";
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  uniform,
  attribute,
  texture,
  uv,
  mix,
  step,
  smoothstep,
  clamp,
  sin,
  cos,
  max,
  pow,
  dot,
  normalize,
  length,
  sub,
  add,
  mul,
  div,
  negate,
  floor,
  hash,
  positionLocal,
  positionWorld,
  normalLocal,
  cameraPosition,
  modelWorldMatrix,
  modelWorldMatrixInverse,
  instanceIndex,
  rotateUV,
  fract,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const DEG = Math.PI / 180;
const TRUNK_RADIUS_MIN = 0.003;

export const DEFAULT_PINE_PARAMS = {
  rect: { width: 2, height: 0.95, pivotEdge: "auto" },
  grid: { segX: 4, segY: 2 },
  shape: { bendX: 0.14, bendY: -0.2, skewX: 0, skewY: 0, taperX: 0 },
  transform: { posX: 0.01, posY: 0.69, posZ: 0, rotXDeg: -20, rotYDeg: 0, rotZDeg: 90 },
  foliage: {
    layout: "pine",
    levels: 7,
    perRing: 7,
    baseY: 1.68,
    heightPower: 1,
    tipRingSlide: 0,
    scaleBottom: 0.94,
    scaleTop: 0.32,
    scalePower: 1.15,
    globalScale: 1,
    radialInset: 0.02,
    pivotAlongRadius: 0,
    azimuthOffsetDeg: 0,
    staggerDeg: 19.5,
    ringRandomDeg: 8,
    ringRandomSeed: 0,
    cardRandomDeg: 5,
    pitchCurveEnabled: true,
    pitchBottomDeg: -8,
    pitchTopDeg: 12,
    pitchCurvePower: 1,
    leafPitchRandomDeg: 6,
    leafYRandom: 0.05,
    leafScaleRandom: 0.1,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
  },
  trunk: {
    height: 5,
    radiusBottom: 0.14,
    radiusTop: 0.01,
    yOffset: 0,
    curveBend: 0.12,
    curveAngleDeg: 0,
    curveS: 0,
    pathSegs: 0,
    radialSegs: 12,
    roughness: 0.94,
    metalness: 0,
  },
  material: {
    roughness: 1,
    metalness: 0,
    alphaTest: 0.45,
    colorSource: "tsl",
    maskMode: "luminance",
    bottomColor: "#1a4520",
    topColor: "#6aab38",
    colorVar: 0.14,
    normalBias: 0.28,
    leafWarp: 0,
    radialUp: 0.35,
    veinStrength: 0.1,
    pivotAo: 0.35,
    aoStrength: 0.4,
    aoRadius: 2.2,
    sssColor: "#b8d85a",
    sssStrength: 0.38,
    sssPower: 2.2,
    rimColor: "#d8f0b0",
    rimStrength: 0,
    rimPower: 2.4,
  },
  wind: { enabled: true, speed: 1.1, strength: 0.14, micro: 0.04, directionDeg: 25 },
  /** LOD2: cheaper shader (fake card shadow + reduced SSS/rim). */
  lod2Cheap: {
    colorVarMul: 0.35,
    aoStrengthMul: 1.35,
    pivotAoMul: 1.2,
    sssMul: 0.2,
    rimMul: 0.15,
    sunDarkenStr: 0.04,
    sunDarkenPower: 1.6,
    brightnessMul: 0.92,
    cardShadowStr: 0.81,
    cardShadowFloor: 0.066,
    cardShadowReach: 0.84,
    cardShadowPower: 1.35,
  },
};

/** Per-tree variation — zeros/defaults = identical to pre-diversity bench behavior. */
export const DEFAULT_FOREST_DIVERSITY = {
  /** Overall tree size; jitter 0.12 → scale range 0.88–1.12 at treeScale 1. */
  treeScale: 1,
  treeScaleJitter: 0.12,
  scaleYJitter: 0,
  scaleXZJitter: 0,
  tintStrength: 0,
  brightnessJitter: 0,
  colorVarTreeBias: 0,
  windMulJitter: 0,
  leanMaxDeg: 0,
  placementSeed: 0,
};

function makeForestRng(seed) {
  if (!seed) return () => Math.random();
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleTreeTraits(rng, scaleMin, scaleMax, div) {
  const rotY = rng() * Math.PI * 2;
  const scale = scaleMin + rng() * Math.max(0.01, scaleMax - scaleMin);
  const sy = 1 + (rng() * 2 - 1) * (div.scaleYJitter ?? 0);
  const sxz = 1 + (rng() * 2 - 1) * (div.scaleXZJitter ?? 0);
  const leanMax = (div.leanMaxDeg ?? 0) * DEG;
  const leanX = (rng() * 2 - 1) * leanMax;
  const leanZ = (rng() * 2 - 1) * leanMax;
  const treeSeed = rng();
  const windMul = 1 + (rng() * 2 - 1) * (div.windMulJitter ?? 0);
  const ts = div.tintStrength ?? 0;
  const tintR = 1 + (rng() * 2 - 1) * ts;
  const tintG = 1 + (rng() * 2 - 1) * ts;
  const tintB = 1 + (rng() * 2 - 1) * ts;
  const brightMul = 1 + (rng() * 2 - 1) * (div.brightnessJitter ?? 0);
  return {
    rotY,
    scale,
    scaleY: sy,
    scaleXZ: sxz,
    leanX,
    leanZ,
    treeSeed,
    windMul,
    tintR,
    tintG,
    tintB,
    brightMul,
  };
}

const _v3 = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _trunkTan = new THREE.Vector3();
const _trunkRight = new THREE.Vector3();
const _trunkFwd = new THREE.Vector3();
const _trunkOut = new THREE.Vector3();
const _trunkCenter = new THREE.Vector3();
const _trunkP0 = new THREE.Vector3();
const _trunkP2 = new THREE.Vector3();
const _qSeg = new THREE.Quaternion();
const _mSeg = new THREE.Matrix4();
const _dummy = new THREE.Object3D();
const _qCard = new THREE.Quaternion();
const _qAz = new THREE.Quaternion();
const _qOut = new THREE.Quaternion();
const _treeMat = new THREE.Matrix4();
const _leafMat = new THREE.Matrix4();
const _tmpMat = new THREE.Matrix4();
const _tmpCenter = new THREE.Vector3();
const _tmpTreeCenter = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scl = new THREE.Vector3();

function _composeTreeMatrix(t, outMat) {
  _pos.set(t.x, t.y ?? 0, t.z);
  const leanX = t.leanX ?? 0;
  const leanZ = t.leanZ ?? 0;
  const rotY = t.rotY ?? 0;
  const sy = t.scaleY ?? 1;
  const sxz = t.scaleXZ ?? 1;
  const sc = t.scale ?? 1;
  if (leanX !== 0 || leanZ !== 0) {
    _euler.set(leanX, rotY, leanZ, "YXZ");
    _quat.setFromEuler(_euler);
  } else {
    _quat.setFromAxisAngle(_yAxis, rotY);
  }
  _scl.set(sc * sxz, sc * sy, sc * sxz);
  outMat.compose(_pos, _quat, _scl);
}

export function applyDiversityToFoliageUniforms(uniforms, diversity = {}) {
  const d = { ...DEFAULT_FOREST_DIVERSITY, ...diversity };
  if (!uniforms) return;
  uniforms.treeTintStr.value = d.tintStrength;
  uniforms.treeBrightStr.value = d.brightnessJitter;
  uniforms.treeColorBias.value = d.colorVarTreeBias;
  uniforms.windTreeJitter.value = d.windMulJitter;
}
const _hideMat = new THREE.Matrix4().makeScale(0, 0, 0);

function snapshotFoliageSource(im, count) {
  const geo = im.geometry;
  return {
    matrices: new Float32Array(im.instanceMatrix.array.subarray(0, count * 16)),
    rand: new Float32Array(geo.getAttribute("aRand").array.subarray(0, count * 2)),
    leafCenter: new Float32Array(
      geo.getAttribute("aLeafCenter").array.subarray(0, count * 3),
    ),
    treeCenter: new Float32Array(
      geo.getAttribute("aTreeCenter").array.subarray(0, count * 3),
    ),
    leafScale: new Float32Array(geo.getAttribute("aLeafScale").array.subarray(0, count)),
    treeSeed: new Float32Array(geo.getAttribute("aTreeSeed").array.subarray(0, count)),
    treeWind: new Float32Array(geo.getAttribute("aTreeWind").array.subarray(0, count)),
  };
}

function copyFoliageTreeBlock(src, dstLeaf, srcLeaf, leafCount, matArr, geo) {
  matArr.set(src.matrices.subarray(srcLeaf * 16, (srcLeaf + leafCount) * 16), dstLeaf * 16);
  const rand = geo.getAttribute("aRand").array;
  const lc = geo.getAttribute("aLeafCenter").array;
  const tc = geo.getAttribute("aTreeCenter").array;
  const sc = geo.getAttribute("aLeafScale").array;
  const ts = geo.getAttribute("aTreeSeed").array;
  const tw = geo.getAttribute("aTreeWind").array;
  const n2 = leafCount * 2;
  const n3 = leafCount * 3;
  rand.set(src.rand.subarray(srcLeaf * 2, srcLeaf * 2 + n2), dstLeaf * 2);
  lc.set(src.leafCenter.subarray(srcLeaf * 3, srcLeaf * 3 + n3), dstLeaf * 3);
  tc.set(src.treeCenter.subarray(srcLeaf * 3, srcLeaf * 3 + n3), dstLeaf * 3);
  sc.set(src.leafScale.subarray(srcLeaf, srcLeaf + leafCount), dstLeaf);
  ts.set(src.treeSeed.subarray(srcLeaf, srcLeaf + leafCount), dstLeaf);
  tw.set(src.treeWind.subarray(srcLeaf, srcLeaf + leafCount), dstLeaf);
}

function hideFoliageTreeBlock(im, leafStart, leafCount) {
  const matArr = im.instanceMatrix.array;
  for (let i = 0; i < leafCount; i++) {
    _hideMat.toArray(matArr, (leafStart + i) * 16);
  }
}

/** Hysteresis bands to stop tier popping at LOD boundaries (v2 grass-style). Returns -1 = culled. */
function resolveFoliageLodTier(dist, prevTier, lod0D, lod1D, fadeD, h) {
  if (prevTier < 0) {
    if (dist > fadeD) return -1;
    if (dist > lod1D) return 2;
    if (dist > lod0D) return 1;
    return 0;
  }
  if (dist > fadeD + h) return -1;
  if (dist > fadeD) return prevTier;

  if (prevTier === 0) {
    if (dist > lod1D + h) return 2;
    if (dist > lod0D + h) return 1;
    return 0;
  }
  if (prevTier === 1) {
    if (dist > lod1D + h) return 2;
    if (dist < lod0D - h) return 0;
    return 1;
  }
  if (dist < lod1D - h) return dist < lod0D - h ? 0 : 1;
  return 2;
}

function trunkHeightT(y, trunk) {
  const H = Math.max(0.15, trunk.height);
  return THREE.MathUtils.clamp((y - trunk.yOffset) / H, 0, 1);
}

function trunkRadiusAtT(t, trunk) {
  return THREE.MathUtils.lerp(
    trunk.radiusBottom,
    trunk.radiusTop,
    THREE.MathUtils.clamp(t, 0, 1),
  );
}

function trunkSpineParams(trunk) {
  let bend = trunk.curveBend ?? 0;
  let s = trunk.curveS ?? 0;
  let angleRad = (trunk.curveAngleDeg ?? 0) * DEG;
  const lx = trunk.curveX ?? 0;
  const lz = trunk.curveZ ?? 0;
  if (bend < 1e-6 && s < 1e-6 && (Math.abs(lx) > 1e-5 || Math.abs(lz) > 1e-5)) {
    bend = Math.hypot(lx, lz) * 0.45;
    angleRad = Math.atan2(lz, lx);
  }
  return { bend, s, angleRad };
}

function trunkHasSpineCurve(trunk) {
  const { bend, s } = trunkSpineParams(trunk);
  return bend > 1e-5 || Math.abs(s) > 1e-5;
}

function trunkCenterAtT(t, trunk, target) {
  const H = Math.max(0.15, trunk.height);
  const y0 = trunk.yOffset;
  const u = THREE.MathUtils.clamp(t, 0, 1);
  const { bend, s, angleRad } = trunkSpineParams(trunk);
  const wC = Math.sin(Math.PI * u);
  const wS = s * Math.sin(2 * Math.PI * u);
  const lateral = bend * (wC + wS);
  const cx = Math.cos(angleRad);
  const cz = Math.sin(angleRad);
  return target.set(cx * lateral, y0 + H * u, cz * lateral);
}

function trunkTangentAtT(t, trunk, target) {
  const H = Math.max(0.15, trunk.height);
  const u = THREE.MathUtils.clamp(t, 0, 1);
  const { bend, s, angleRad } = trunkSpineParams(trunk);
  const dLateral =
    bend *
    (Math.PI * Math.cos(Math.PI * u) +
      s * 2 * Math.PI * Math.cos(2 * Math.PI * u));
  const cx = Math.cos(angleRad);
  const cz = Math.sin(angleRad);
  target.set(cx * dLateral, H, cz * dLateral);
  const len = target.length();
  if (len > 1e-6) target.multiplyScalar(1 / len);
  else target.set(0, 1, 0);
  return target;
}

function trunkOutwardAtT(t, thetaRad, trunk, target) {
  trunkTangentAtT(t, trunk, _trunkTan);
  _trunkRight.crossVectors(_yAxis, _trunkTan);
  if (_trunkRight.lengthSq() < 1e-8) _trunkRight.set(1, 0, 0);
  _trunkRight.normalize();
  _trunkFwd.crossVectors(_trunkTan, _trunkRight).normalize();
  return target
    .copy(_trunkRight)
    .multiplyScalar(Math.cos(thetaRad))
    .addScaledVector(_trunkFwd, Math.sin(thetaRad));
}

function trunkPathSegmentCount(trunk) {
  const manual = Math.round(trunk.pathSegs ?? 0);
  if (manual >= 4) return Math.min(64, manual);
  const H = Math.max(0.15, trunk.height);
  const { bend, s } = trunkSpineParams(trunk);
  const curve = bend + Math.abs(s) * 0.5;
  return THREE.MathUtils.clamp(Math.ceil(H * 4) + Math.ceil(curve * 12), 4, 48);
}

function rotateGeometryUV(geo, quarterTurns) {
  const uvs = geo.attributes.uv;
  if (!uvs) return;
  const n = ((Math.round(quarterTurns) % 4) + 4) % 4;
  if (n === 0) return;
  for (let i = 0; i < uvs.count; i++) {
    let u = uvs.getX(i);
    let v = uvs.getY(i);
    for (let t = 0; t < n; t++) {
      const nu = v;
      const nv = 1 - u;
      u = nu;
      v = nv;
    }
    uvs.setXY(i, u, v);
  }
  uvs.needsUpdate = true;
}

function createRectangleGeometry(w, h, segX, segY, shape, pivotEdge) {
  const { bendX, bendY, skewX, skewY, taperX } = shape;
  const geo = new THREE.PlaneGeometry(w, h, segX, segY);
  const pos = geo.attributes.position;
  const hw = w * 0.5;
  const hh = h * 0.5;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    const nx = hw > 1e-6 ? x / hw : 0;
    const ny = hh > 1e-6 ? y / hh : 0;
    x *= 1 + taperX * ny;
    x += skewX * ny * hh;
    y += skewY * nx * hw;
    let z = pos.getZ(i);
    z += bendX * nx * nx;
    z += bendY * ny * ny;
    pos.setXYZ(i, x, y, z);
  }
  let edge = pivotEdge;
  if (edge === "auto") edge = w >= h ? "left" : "bottom";
  let px = 0;
  let py = 0;
  if (edge === "bottom") py = hh;
  else if (edge === "top") py = -hh;
  else if (edge === "right") px = -hw;
  else px = hw;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, pos.getX(i) + px, pos.getY(i) + py, pos.getZ(i));
  }
  geo.rotateY(Math.PI / 2);
  rotateGeometryUV(geo, 1);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function buildTrunkGeometry(trunk) {
  const radialSegs = Math.max(6, Math.round(trunk.radialSegs ?? 12));
  if (!trunkHasSpineCurve(trunk)) {
    const H = Math.max(0.15, trunk.height);
    const r0 = Math.max(TRUNK_RADIUS_MIN, trunk.radiusBottom);
    const r1 = Math.max(TRUNK_RADIUS_MIN, trunk.radiusTop);
    const geo = new THREE.CylinderGeometry(r1, r0, H, radialSegs);
    geo.translate(0, trunk.yOffset + H * 0.5, 0);
    return geo;
  }
  const segs = trunkPathSegmentCount(trunk);
  const parts = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const t1 = (i + 1) / segs;
    trunkCenterAtT(t0, trunk, _trunkP0);
    trunkCenterAtT(t1, trunk, _trunkP2);
    const r0 = Math.max(TRUNK_RADIUS_MIN, trunkRadiusAtT(t0, trunk));
    const r1 = Math.max(TRUNK_RADIUS_MIN, trunkRadiusAtT(t1, trunk));
    _v3.subVectors(_trunkP2, _trunkP0);
    const len = _v3.length();
    if (len < 1e-5) continue;
    _v3.normalize();
    _trunkCenter.addVectors(_trunkP0, _trunkP2).multiplyScalar(0.5);
    const cyl = new THREE.CylinderGeometry(r1, r0, len, radialSegs, 1);
    _qSeg.setFromUnitVectors(_yAxis, _v3);
    _mSeg.compose(_trunkCenter, _qSeg, new THREE.Vector3(1, 1, 1));
    cyl.applyMatrix4(_mSeg);
    parts.push(cyl);
  }
  if (parts.length === 0) {
    const H = Math.max(0.15, trunk.height);
    const geo = new THREE.CylinderGeometry(
      Math.max(TRUNK_RADIUS_MIN, trunk.radiusTop),
      Math.max(TRUNK_RADIUS_MIN, trunk.radiusBottom),
      H,
      radialSegs,
    );
    geo.translate(0, trunk.yOffset + H * 0.5, 0);
    return geo;
  }
  const merged = parts.length === 1 ? parts[0] : mergeGeometries(parts);
  for (const g of parts) {
    if (g !== merged) g.dispose();
  }
  merged.computeVertexNormals();
  return merged;
}

function foliageHash01(a, b, seed) {
  const s = Math.sin(a * 12.9898 + b * 78.233 + seed * 43.758) * 43758.5453;
  return s - Math.floor(s);
}

function foliageRandomSignedDeg(a, b, seed, amount) {
  if (!amount) return 0;
  return (foliageHash01(a, b, seed) * 2 - 1) * amount;
}

function pineLevelPitchExtraDeg(level, levels, foliage) {
  if (foliage.pitchCurveEnabled === false) return 0;
  const tLin = levels <= 1 ? 0 : level / (levels - 1);
  const pow = Math.max(0.05, foliage.pitchCurvePower ?? 1);
  const t = Math.pow(tLin, pow);
  return THREE.MathUtils.lerp(foliage.pitchBottomDeg ?? 0, foliage.pitchTopDeg ?? 0, t);
}

function pineRingTrunkT(level, levels, f, tr) {
  const n = Math.max(1, levels);
  if (n <= 1) return 1;
  const tLin = level / (n - 1);
  const yBase = f.baseY + (f.offsetY ?? 0);
  const tBottom = THREE.MathUtils.clamp(trunkHeightT(yBase, tr), 0, 1);
  const hPow = Math.max(0.05, f.heightPower ?? 1);
  return THREE.MathUtils.lerp(tBottom, 1, Math.pow(tLin, hPow));
}

function quaternionForAzimuth(params, thetaRad, pitchExtraDeg, trunkT) {
  const t = params.transform;
  _dummy.rotation.set(
    (t.rotXDeg + pitchExtraDeg) * DEG,
    t.rotYDeg * DEG,
    t.rotZDeg * DEG,
    "XYZ",
  );
  _qCard.setFromEuler(_dummy.rotation);
  trunkTangentAtT(trunkT, params.trunk, _trunkTan);
  _qAz.setFromAxisAngle(_trunkTan, thetaRad);
  return _qOut.copy(_qAz).multiply(_qCard);
}

function pineCardShouldKeep(level, k, levels, perRing, logical, options) {
  if (options.decimate === "silhouette") {
    const target = Math.max(2, Math.min(perRing, Math.round(options.cardsPerRing ?? 3)));
    const azStep = Math.max(1, Math.ceil(perRing / target));
    const rk = options.ringKeep ?? "all";
    if (rk === "every2" && level % 2 === 1) return false;
    if (rk === "ends" && level !== 0 && level !== levels - 1) return false;
    return k % azStep === 0;
  }
  const keepFraction = options.keepFraction ?? 1;
  if (keepFraction >= 1) return true;
  const step = Math.max(1, Math.round(1 / keepFraction));
  return logical % step === 0;
}

function forEachPineCardPlacement(params, options, visit) {
  const f = params.foliage;
  const tr = params.trunk;
  const levels = Math.max(1, Math.round(f.levels));
  const perRing = Math.max(1, Math.round(f.perRing));
  const scaleMul = options.scaleMul ?? 1;
  const pow = Math.max(0.05, f.scalePower);
  const gScale = Number.isFinite(f.globalScale) && f.globalScale > 0 ? f.globalScale : 1;
  let logical = 0;
  let count = 0;

  for (let level = 0; level < levels; level++) {
    const tLin = levels <= 1 ? 1 : level / (levels - 1);
    const u = Math.pow(tLin, pow);
    const sRing = (f.scaleBottom * (1 - u) + f.scaleTop * u) * gScale;
    const trunkT = pineRingTrunkT(level, levels, f, tr);
    const R = Math.max(0.001, trunkRadiusAtT(trunkT, tr) - f.radialInset);
    const along = THREE.MathUtils.clamp(
      Number.isFinite(f.pivotAlongRadius) ? f.pivotAlongRadius : 0,
      0,
      1,
    );
    const ringRand = foliageRandomSignedDeg(level, 0, f.ringRandomSeed, f.ringRandomDeg);
    for (let k = 0; k < perRing; k++) {
      if (pineCardShouldKeep(level, k, levels, perRing, logical, options)) {
        const cardRand = foliageRandomSignedDeg(level, k + 1, f.ringRandomSeed, f.cardRandomDeg);
        const theta = (f.azimuthOffsetDeg + (k * 360) / perRing + f.staggerDeg * level + ringRand + cardRand) * DEG;
        const seed = f.ringRandomSeed;
        const pitchJit = foliageRandomSignedDeg(level, k + 40, seed, f.leafPitchRandomDeg);
        const levelPitch = pineLevelPitchExtraDeg(level, levels, f);
        const yJit = foliageRandomSignedDeg(level, k + 50, seed, f.leafYRandom);
        const scaleJit = foliageRandomSignedDeg(level, k + 60, seed, f.leafScaleRandom);
        trunkCenterAtT(trunkT, tr, _dummy.position);
        if (level === levels - 1) {
          const slide = f.tipRingSlide ?? 0;
          if (Math.abs(slide) > 1e-6) {
            trunkTangentAtT(trunkT, tr, _trunkTan);
            _dummy.position.addScaledVector(_trunkTan, slide);
          }
        }
        trunkOutwardAtT(trunkT, theta, tr, _trunkOut);
        _dummy.position.addScaledVector(_trunkOut, along * R);
        _dummy.position.x += f.offsetX;
        _dummy.position.z += f.offsetZ;
        if (Math.abs(yJit) > 1e-6) {
          trunkTangentAtT(trunkT, tr, _trunkTan);
          _dummy.position.addScaledVector(_trunkTan, yJit);
        }
        const s = Math.max(0.02, sRing * (1 + scaleJit) * scaleMul);
        _dummy.quaternion.copy(
          quaternionForAzimuth(params, theta, levelPitch + pitchJit, trunkT),
        );
        _dummy.scale.setScalar(s);
        _dummy.updateMatrix();
        visit(_dummy.matrix, _dummy.position);
        count++;
      }
      logical++;
    }
  }
  return count;
}

const MAX_LEAVES_PER_CHUNK = 65536;
/** LOD2 = same placement as LOD1; cheaper material + no foliage shadows. */
const LOD_OPTS = [
  { keepFraction: 1, scaleMul: 1 },
  { keepFraction: 0.5, scaleMul: 1.414 },
  { keepFraction: 0.5, scaleMul: 1.414, cheap: true },
];

/** One preset bake per pine shape (v2 foliageSampler / buildAllFoliageLods shape). */
function buildPinePreset(params, leafGeo) {
  const lods = [];
  let canopyY = params.trunk.yOffset;
  for (let tier = 0; tier < 3; tier++) {
    const leaves = [];
    forEachPineCardPlacement(params, LOD_OPTS[tier], (mat, pos) => {
      leaves.push({ m: mat.clone(), pos });
      if (pos.y > canopyY) canopyY = pos.y;
    });
    const n = leaves.length;
    const matrices = new Float32Array(n * 16);
    const centerData = new Float32Array(n * 3);
    const randData = new Float32Array(n * 2);
    const scaleData = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const { m, pos } = leaves[i];
      m.toArray(matrices, i * 16);
      centerData[i * 3] = pos.x;
      centerData[i * 3 + 1] = pos.y;
      centerData[i * 3 + 2] = pos.z;
      randData[i * 2] = foliageHash01(i, 0, params.foliage.ringRandomSeed);
      randData[i * 2 + 1] = foliageHash01(i, 1, params.foliage.ringRandomSeed);
      scaleData[i] = 1;
    }
    lods.push({
      geometry: leafGeo,
      count: n,
      matrices,
      centerData,
      randData,
      scaleData,
      billboard: false,
    });
  }
  const canopyCenter = new THREE.Vector3(0, canopyY * 0.55, 0);
  const aoRadius = Math.max(1.5, params.trunk.height * 0.45);
  return { lods, bounds: { canopyCenter, aoRadius } };
}

function makeCheckerTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const n = 8;
  const s = 256 / n;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = (i + j) % 2 ? "#c8d8e8" : "#f0f4f8";
      g.fillRect(i * s, j * s, s, s);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 4);
  return t;
}

function configureMaskTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.premultiplyAlpha = false;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
}

function detectAlphaChannel(image) {
  try {
    const w = image.width || image.naturalWidth;
    const h = image.height || image.naturalHeight;
    if (!w || !h) return false;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Same load path as pine-editor32 (Frame 56 is usually luminance mask, not alpha). */
export async function loadPineLeafTexture(url) {
  const tex = await new THREE.TextureLoader().loadAsync(url);
  configureMaskTexture(tex);
  const img = tex.image;
  const maskMode =
    img && detectAlphaChannel(img) ? "alpha" : "luminance";
  return { tex, maskMode };
}

export function createPineFoliageMaterial(params, leafTex, opts = {}) {
  const cheap = opts.cheap === true;
  const tier = cheap ? 2 : 0;
  const m = params.material;
  const w = params.wind;
  const l2 = { ...DEFAULT_PINE_PARAMS.lod2Cheap, ...(params.lod2Cheap ?? {}) };
  const aTreeCenter = attribute("aTreeCenter", "vec3");
  const aTreeSeed = attribute("aTreeSeed", "float");
  const aTreeWind = attribute("aTreeWind", "float");
  const treeCenterW = modelWorldMatrix.mul(vec4(aTreeCenter, 1)).xyz;

  const colorVar = tier === 2 ? m.colorVar * l2.colorVarMul : m.colorVar;
  const pivotAo =
    tier === 2
      ? Math.min(0.55, m.pivotAo * l2.pivotAoMul)
      : m.pivotAo;
  const aoStrength =
    tier === 2
      ? Math.min(0.75, m.aoStrength * l2.aoStrengthMul)
      : m.aoStrength;
  const sssStrength = tier === 2 ? m.sssStrength * l2.sssMul : m.sssStrength;
  const rimStrength = tier === 2 ? m.rimStrength * l2.rimMul : m.rimStrength;
  const sunDarkenStr = tier === 2 ? l2.sunDarkenStr : 0;
  const sunDarkenPower = tier === 2 ? l2.sunDarkenPower : 1;
  const brightnessMul = tier === 2 ? l2.brightnessMul : 1;
  const cardShadowStr = tier === 2 ? l2.cardShadowStr : 0;
  const cardShadowReach = tier === 2 ? l2.cardShadowReach : 1;
  const cardShadowPower = tier === 2 ? l2.cardShadowPower : 1;
  const cardShadowFloor = tier === 2 ? l2.cardShadowFloor : 1;

  const leafU = {
    bottomColor: uniform(new THREE.Color(m.bottomColor)),
    topColor: uniform(new THREE.Color(m.topColor)),
    colorVar: uniform(colorVar),
    normalBias: uniform(m.normalBias),
    leafWarp: uniform(m.leafWarp),
    radialUp: uniform(m.radialUp),
    veinStrength: uniform(m.veinStrength),
    pivotAo: uniform(pivotAo),
    aoStrength: uniform(aoStrength),
    aoRadius: uniform(params._aoRadius ?? 2.2),
    alphaCutoff: uniform(m.alphaTest),
    maskInAlpha: uniform(m.maskMode === "alpha" ? 1 : 0),
    useMaskTex: uniform(leafTex ? 1 : 0),
    useImageColor: uniform(m.colorSource === "texture" && leafTex ? 1 : 0),
    sssColor: uniform(new THREE.Color(m.sssColor)),
    sssStrength: uniform(sssStrength),
    sssPower: uniform(m.sssPower),
    rimColor: uniform(new THREE.Color(m.rimColor)),
    rimStrength: uniform(rimStrength),
    rimPower: uniform(m.rimPower),
    sunDir: uniform(new THREE.Vector3(5, 12, 4).normalize()),
    sunDarkenStr: uniform(sunDarkenStr),
    sunDarkenPower: uniform(sunDarkenPower),
    brightnessMul: uniform(brightnessMul),
    cardShadowStr: uniform(cardShadowStr),
    cardShadowFloor: uniform(cardShadowFloor),
    cardShadowReach: uniform(cardShadowReach),
    cardShadowPower: uniform(cardShadowPower),
    time: uniform(0),
    windEnabled: uniform(cheap ? 0 : w.enabled ? 1 : 0),
    windSpeed: uniform(w.speed),
    windStr: uniform(w.strength),
    windMicro: uniform(w.micro),
    windDir: uniform(w.directionDeg * DEG),
    treeTintStr: uniform(0),
    treeBrightStr: uniform(0),
    treeColorBias: uniform(0),
    windTreeJitter: uniform(0),
  };

  const mapTex = leafTex ?? makeCheckerTexture();
  const leafMapNode = texture(mapTex);

  const leafMaskUv = Fn(() => uv())();

  const leafMaskAlphaNode = Fn(() => {
    const s = leafMapNode.sample(leafMaskUv);
    const maskA = mix(s.r, s.a, leafU.maskInAlpha);
    const raw = mix(float(1), maskA, step(float(0.5), leafU.useMaskTex));
    return smoothstep(
      leafU.alphaCutoff.sub(0.05),
      leafU.alphaCutoff.add(0.05),
      raw,
    );
  })();

  const leafInstancePivotW = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz;
  const leafTrunkRadial = normalize(
    vec3(leafInstancePivotW.x, leafU.radialUp, leafInstancePivotW.z),
  );

  const leafNormalNode = Fn(() =>
    normalize(
      mix(
        normalize(add(normalLocal, mul(sin(mul(uv().x, float(10))), leafU.leafWarp))),
        leafTrunkRadial,
        leafU.normalBias,
      ),
    ),
  )();

  const leafPositionNode = Fn(() => {
    const phase = add(
      mul(leafU.time, leafU.windSpeed),
      mul(instanceIndex.toFloat(), float(1.31)),
    );
    const tip = mul(max(positionLocal.y, float(0)), max(positionLocal.y, float(0)));
    const windScale = mix(float(1), aTreeWind, leafU.windTreeJitter);
    const sway = mul(sin(phase), leafU.windStr, tip, windScale);
    const wo = vec3(mul(cos(leafU.windDir), sway), float(0), mul(sin(leafU.windDir), sway));
    const wl = modelWorldMatrixInverse.mul(vec4(wo.x, wo.y, wo.z, float(0))).xyz;
    return add(positionLocal, mul(wl, leafU.windEnabled));
  })();

  const leafColorNode = Fn(() => {
    const u = uv();
    /** LOD2 only: pivot on trunk ≈ u.y=1, tip/outward ≈ u.y=0. */
    const shadeV = tier === 2 ? sub(float(1), u.y) : u.y;
    let col = mix(leafU.bottomColor, leafU.topColor, u.y);
    const texRgb = leafMapNode.sample(leafMaskUv).rgb;
    col = mix(col, texRgb, leafU.useImageColor);
    const h = mix(hash(instanceIndex), aTreeSeed, leafU.treeColorBias);
    col = mul(
      col,
      add(mul(h, mul(leafU.colorVar, float(2))), sub(float(1), leafU.colorVar)),
    );
    const sr = fract(mul(aTreeSeed, float(1.13)));
    const sg = fract(mul(aTreeSeed, float(1.71)));
    const sb = fract(mul(aTreeSeed, float(2.17)));
    const tintVec = vec3(
      add(float(1), mul(sub(sr, float(0.5)), mul(float(2), leafU.treeTintStr))),
      add(float(1), mul(sub(sg, float(0.5)), mul(float(2), leafU.treeTintStr))),
      add(float(1), mul(sub(sb, float(0.5)), mul(float(2), leafU.treeTintStr))),
    );
    col = mul(col, tintVec);
    const brightMul = add(
      float(1),
      mul(sub(aTreeSeed, float(0.5)), mul(float(2), leafU.treeBrightStr)),
    );
    col = mul(col, brightMul);
    const hookAo = mix(
      float(1),
      sub(float(1), leafU.pivotAo),
      smoothstep(float(0), float(0.38), shadeV),
    );
    col = mul(col, hookAo);
    const cardT = clamp(
      div(shadeV, max(leafU.cardShadowReach, float(0.001))),
      float(0),
      float(1),
    );
    const trunkShade = max(
      leafU.cardShadowFloor,
      sub(float(1), leafU.cardShadowStr),
    );
    const cardGrad = mix(
      trunkShade,
      float(1),
      pow(cardT, max(leafU.cardShadowPower, float(0.001))),
    );
    col = mul(col, cardGrad);
    const distC = length(sub(positionWorld, treeCenterW));
    col = mul(
      col,
      mix(
        sub(float(1), leafU.aoStrength),
        float(1),
        clamp(div(distC, max(leafU.aoRadius, float(0.001))), float(0), float(1)),
      ),
    );
    const viewDir = normalize(sub(cameraPosition, positionWorld));
    const backDot = max(dot(negate(leafU.sunDir), leafTrunkRadial), float(0));
    col = add(col, mul(leafU.sssColor, mul(pow(backDot, leafU.sssPower), leafU.sssStrength)));
    const rimDot = sub(float(1), max(dot(leafTrunkRadial, viewDir), float(0)));
    col = add(col, mul(leafU.rimColor, mul(pow(rimDot, leafU.rimPower), leafU.rimStrength)));
    const sunSide = max(dot(leafTrunkRadial, leafU.sunDir), float(0));
    const fakeRecv = sub(
      float(1),
      mul(leafU.sunDarkenStr, pow(sunSide, max(leafU.sunDarkenPower, float(0.001)))),
    );
    col = mul(col, mul(fakeRecv, leafU.brightnessMul));
    return clamp(col, float(0), float(2));
  })();

  const mat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    roughness: m.roughness,
    metalness: m.metalness,
    forceSinglePass: true,
  });
  mat.colorNode = leafColorNode;
  mat.normalNode = leafNormalNode;
  mat.positionNode = leafPositionNode;
  mat.envMapIntensity = 0;
  mat.castShadowNode = Fn(() => {
    const a = leafMaskAlphaNode;
    a.lessThan(leafU.alphaCutoff).discard();
    return vec4(0, 0, 0, 1);
  })();

  return { material: mat, uniforms: leafU, mapTex, leafMapNode, leafMaskAlphaNode };
}

/** Wire texture + alpha cutout like pine-editor32 syncMaterial(). */
export function applyFoliageMaterialTexture(
  mat,
  uniforms,
  leafMapNode,
  leafMaskAlphaNode,
  params,
  leafTex,
) {
  const m = params.material;
  uniforms.maskInAlpha.value = m.maskMode === "alpha" ? 1 : 0;
  uniforms.alphaCutoff.value = m.alphaTest;

  if (leafTex) {
    leafMapNode.value = leafTex;
    uniforms.useMaskTex.value = 1;
    uniforms.useImageColor.value =
      m.colorSource === "texture" ? 1 : 0;
    mat.opacityNode = leafMaskAlphaNode;
    mat.transparent = false;
    mat.alphaTest = m.alphaTest;
    mat.alphaTestNode = null;
    mat.depthWrite = true;
  } else {
    uniforms.useMaskTex.value = 0;
    uniforms.useImageColor.value = 0;
    mat.opacityNode = null;
    mat.alphaTest = 0;
    mat.depthWrite = true;
  }
  mat.needsUpdate = true;
}

export class PineForestBench {
  constructor(scene, params, cfg) {
    this.scene = scene;
    this.params = params;
    this.cfg = cfg;
    /** v2-style: chunkKey -> { gen, trees[] } */
    this.treeChunks = new Map();
    /** chunkKey -> { gen, trunk, lod0, lod1, lod2 } meshes */
    this._chunkMeshes = new Map();
    this._chunkGen = 0;
    this.preset = null;
    this._frustum = new THREE.Frustum();
    this._projScreen = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this.stats = {
      treeCount: 0,
      chunkCount: 0,
      visibleChunks: 0,
      visibleTrees: 0,
      lod0Leaves: 0,
      lod1Leaves: 0,
      lod2Leaves: 0,
      trunkInstances: 0,
      drawCalls: 0,
      renderMode: "per-tree",
    };
    this.foliageUniforms = null;
    this.leavesPerLod = [0, 0, 0];
    this._enabled = true;
  }

  setEnabled(on) {
    this._enabled = on !== false;
    if (!this._enabled) this._hideAllChunkMeshes();
  }

  syncSunDirection(dir) {
    const d = dir;
    for (const u of [
      this.foliageUniforms,
      this.foliageUniformsLod1,
      this.foliageUniformsLod2,
    ]) {
      if (u?.sunDir) u.sunDir.value.copy(d);
    }
  }

  _getDiversity() {
    return {
      ...DEFAULT_FOREST_DIVERSITY,
      ...(this.cfg.forest?.diversity ?? {}),
    };
  }

  syncDiversityUniforms() {
    const d = this._getDiversity();
    for (const u of [
      this.foliageUniforms,
      this.foliageUniformsLod1,
      this.foliageUniformsLod2,
    ]) {
      applyDiversityToFoliageUniforms(u, d);
    }
  }

  syncLod2Uniforms() {
    const m = this.params.material;
    const l2 = { ...DEFAULT_PINE_PARAMS.lod2Cheap, ...(this.params.lod2Cheap ?? {}) };
    const u2 = this.foliageUniformsLod2;
    if (!u2) return;

    u2.colorVar.value = m.colorVar * l2.colorVarMul;
    u2.pivotAo.value = Math.min(0.55, m.pivotAo * l2.pivotAoMul);
    u2.aoStrength.value = Math.min(0.75, m.aoStrength * l2.aoStrengthMul);
    u2.sssStrength.value = m.sssStrength * l2.sssMul;
    u2.rimStrength.value = m.rimStrength * l2.rimMul;
    u2.sunDarkenStr.value = l2.sunDarkenStr;
    u2.sunDarkenPower.value = l2.sunDarkenPower;
    u2.brightnessMul.value = l2.brightnessMul;
    u2.cardShadowStr.value = l2.cardShadowStr;
    u2.cardShadowFloor.value = l2.cardShadowFloor;
    u2.cardShadowReach.value = l2.cardShadowReach;
    u2.cardShadowPower.value = l2.cardShadowPower;
  }

  _hideAllChunkMeshes() {
    for (const entry of this._chunkMeshes.values()) {
      if (entry.trunk) entry.trunk.visible = false;
      if (entry.lod0) entry.lod0.visible = false;
      if (entry.lod1) entry.lod1.visible = false;
      if (entry.lod2) entry.lod2.visible = false;
    }
    this.stats.visibleTrees = 0;
    this.stats.visibleChunks = 0;
    this.stats.lod0Leaves = 0;
    this.stats.lod1Leaves = 0;
    this.stats.lod2Leaves = 0;
    this.stats.trunkInstances = 0;
    this.stats.drawCalls = 0;
  }

  async init(leafTextureUrl) {
    const p = this.params;

    this.foliageGeo = createRectangleGeometry(
      p.rect.width,
      p.rect.height,
      p.grid.segX,
      p.grid.segY,
      p.shape,
      p.rect.pivotEdge,
    );

    let leafTex = null;
    if (leafTextureUrl) {
      const loaded = await loadPineLeafTexture(leafTextureUrl);
      leafTex = loaded.tex;
      p.material.maskMode = loaded.maskMode;
    }

    const foliage = createPineFoliageMaterial(p, leafTex);
    this.foliageMat = foliage.material;
    this.foliageUniforms = foliage.uniforms;

    this.foliageMatLod1 = this.foliageMat;
    this.foliageUniformsLod1 = this.foliageUniforms;

    const foliageLod2 = createPineFoliageMaterial(p, leafTex, { cheap: true });
    this.foliageMatLod2 = foliageLod2.material;
    this.foliageUniformsLod2 = foliageLod2.uniforms;

    this.preset = buildPinePreset(p, this.foliageGeo);
    p._aoRadius = this.preset.bounds.aoRadius;
    this.foliageUniforms.aoRadius.value = this.preset.bounds.aoRadius;
    this.foliageUniformsLod2.aoRadius.value = this.preset.bounds.aoRadius;
    applyFoliageMaterialTexture(
      this.foliageMat,
      this.foliageUniforms,
      foliage.leafMapNode,
      foliage.leafMaskAlphaNode,
      p,
      leafTex,
    );
    applyFoliageMaterialTexture(
      this.foliageMatLod2,
      this.foliageUniformsLod2,
      foliageLod2.leafMapNode,
      foliageLod2.leafMaskAlphaNode,
      p,
      leafTex,
    );
    this.leavesPerLod = this.preset.lods.map((l) => l.count);
    this.syncDiversityUniforms();

    this.trunkGeo = buildTrunkGeometry(p.trunk);
    this.trunkMat = new THREE.MeshStandardMaterial({
      color: "#4a3528",
      roughness: p.trunk.roughness,
      metalness: p.trunk.metalness,
    });

    this._populateTreeChunks();
  }

  _chunkKey(cx, cz) {
    return `${cx},${cz}`;
  }

  _isExcluded(x, z, circles) {
    if (!circles?.length) return false;
    for (const c of circles) {
      const dx = x - c.x;
      const dz = z - c.z;
      const r = c.r ?? 0;
      if (dx * dx + dz * dz < r * r) return true;
    }
    return false;
  }

  _resolveTreeScaleRange() {
    const div = this._getDiversity();
    const f = this.cfg.forest ?? {};
    const ts = div.treeScale ?? f.treeScale ?? 1;
    const tj = div.treeScaleJitter ?? f.treeScaleJitter ?? 0.12;
    if (f.scaleMin != null && f.scaleMax != null && div.treeScale == null && div.treeScaleJitter == null) {
      return { min: f.scaleMin, max: f.scaleMax };
    }
    return { min: ts * (1 - tj), max: ts * (1 + tj) };
  }

  _populateTreeChunks() {
    const {
      halfExtent,
      spacing,
      jitter,
      getTreeY,
      excludeCircles,
      density = 1,
    } = this.cfg.forest;
    const div = this._getDiversity();
    const { min: scaleMin, max: scaleMax } = this._resolveTreeScaleRange();
    const rng = makeForestRng(div.placementSeed);
    const cs = this.cfg.forest.chunkSize;
    const half = Math.floor(halfExtent / spacing);
    this.treeChunks.clear();
    let treeCount = 0;

    for (let iz = -half; iz <= half; iz++) {
      for (let ix = -half; ix <= half; ix++) {
        const x = ix * spacing + (rng() - 0.5) * jitter * 2;
        const z = iz * spacing + (rng() - 0.5) * jitter * 2;
        if (this._isExcluded(x, z, excludeCircles)) continue;
        if (density < 1 && rng() > density) continue;
        const traits = sampleTreeTraits(rng, scaleMin, scaleMax, div);
        const y = getTreeY ? getTreeY(x, z) : 0;
        const cx = Math.floor(x / cs);
        const cz = Math.floor(z / cs);
        const key = this._chunkKey(cx, cz);
        if (!this.treeChunks.has(key)) {
          this.treeChunks.set(key, { cx, cz, trees: [] });
        }
        this.treeChunks.get(key).trees.push({
          x,
          z,
          y,
          foliageTier: -1,
          ...traits,
        });
        treeCount++;
      }
    }
    this.stats.treeCount = treeCount;
    this.stats.chunkCount = this.treeChunks.size;
  }

  _buildChunkFoliageLod(trees, lodIdx) {
    const preset = this.preset;
    const lodData = preset.lods[lodIdx];
    if (!lodData || lodData.count === 0) return null;

    const totalLeaves = trees.length * lodData.count;
    if (totalLeaves === 0) return null;
    const cappedTotal = Math.min(totalLeaves, MAX_LEAVES_PER_CHUNK);

    const geo = lodData.geometry.clone();
    const randSrc = lodData.randData;
    const centerSrc = lodData.centerData;
    const scaleSrc = lodData.scaleData;
    const canopyLocal = preset.bounds.canopyCenter;
    const randData = new Float32Array(cappedTotal * 2);
    const centerData = new Float32Array(cappedTotal * 3);
    const treeCenterData = new Float32Array(cappedTotal * 3);
    const scaleData = new Float32Array(cappedTotal);
    const treeSeedData = new Float32Array(cappedTotal);
    const treeWindData = new Float32Array(cappedTotal);
    const localMats = lodData.matrices;
    const leavesPerTree = lodData.count;

    const recv = this.cfg.shadow?.lod0Receive !== false;
    const cast = this.cfg.shadow?.castFoliage !== false;
    const im = new THREE.InstancedMesh(
      geo,
      lodIdx === 2
        ? this.foliageMatLod2
        : lodIdx === 1
          ? this.foliageMatLod1
          : this.foliageMat,
      cappedTotal,
    );
    im.castShadow = lodIdx < 2 && cast;
    im.receiveShadow = lodIdx === 0 && recv;
    im.frustumCulled = false;

    const treeStarts = new Uint32Array(trees.length);
    treeStarts.fill(0xffffffff);
    let idx = 0;
    let foliageTreeCount = 0;
    for (let ti = 0; ti < trees.length; ti++) {
      const t = trees[ti];
      if (idx + leavesPerTree > cappedTotal) break;
      treeStarts[ti] = idx;
      foliageTreeCount = ti + 1;
      _composeTreeMatrix(t, _treeMat);

      _tmpTreeCenter.copy(canopyLocal).applyMatrix4(_treeMat);
      const tcx = _tmpTreeCenter.x;
      const tcy = _tmpTreeCenter.y;
      const tcz = _tmpTreeCenter.z;

      for (let li = 0; li < leavesPerTree && idx < cappedTotal; li++, idx++) {
        _tmpMat.fromArray(localMats, li * 16);
        _tmpMat.premultiply(_treeMat);
        im.setMatrixAt(idx, _tmpMat);
        _tmpCenter.set(centerSrc[li * 3], centerSrc[li * 3 + 1], centerSrc[li * 3 + 2]).applyMatrix4(_treeMat);
        centerData[idx * 3] = _tmpCenter.x;
        centerData[idx * 3 + 1] = _tmpCenter.y;
        centerData[idx * 3 + 2] = _tmpCenter.z;
        scaleData[idx] = scaleSrc[li];
        randData[idx * 2] = randSrc[li * 2];
        randData[idx * 2 + 1] = randSrc[li * 2 + 1];
        treeCenterData[idx * 3] = tcx;
        treeCenterData[idx * 3 + 1] = tcy;
        treeCenterData[idx * 3 + 2] = tcz;
        treeSeedData[idx] = t.treeSeed ?? 0.5;
        treeWindData[idx] = t.windMul ?? 1;
      }
    }

    im.count = idx;
    im.instanceMatrix.needsUpdate = true;
    geo.setAttribute("aRand", new THREE.InstancedBufferAttribute(randData.slice(0, idx * 2), 2));
    geo.setAttribute("aLeafCenter", new THREE.InstancedBufferAttribute(centerData.slice(0, idx * 3), 3));
    geo.setAttribute("aTreeCenter", new THREE.InstancedBufferAttribute(treeCenterData.slice(0, idx * 3), 3));
    geo.setAttribute("aLeafScale", new THREE.InstancedBufferAttribute(scaleData.slice(0, idx), 1));
    geo.setAttribute("aTreeSeed", new THREE.InstancedBufferAttribute(treeSeedData.slice(0, idx), 1));
    geo.setAttribute("aTreeWind", new THREE.InstancedBufferAttribute(treeWindData.slice(0, idx), 1));
    return {
      mesh: im,
      treeStarts,
      src: snapshotFoliageSource(im, idx),
      bakedCount: idx,
      foliageTreeCount,
    };
  }

  _buildChunkTrunk(trees) {
    const im = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, trees.length);
    im.castShadow = true;
    im.receiveShadow = true;
    const div = this._getDiversity();
    const useTrunkTint =
      (div.tintStrength ?? 0) > 0 || (div.brightnessJitter ?? 0) > 0;
    if (useTrunkTint) {
      im.instanceColor = new THREE.InstancedBufferAttribute(
        new Float32Array(trees.length * 3),
        3,
      );
      this.trunkMat.vertexColors = true;
    }
    for (let i = 0; i < trees.length; i++) {
      const t = trees[i];
      _composeTreeMatrix(t, _treeMat);
      im.setMatrixAt(i, _treeMat);
      if (useTrunkTint) {
        im.setColorAt(
          i,
          new THREE.Color(
            (t.tintR ?? 1) * (t.brightMul ?? 1),
            (t.tintG ?? 1) * (t.brightMul ?? 1),
            (t.tintB ?? 1) * (t.brightMul ?? 1),
          ),
        );
      }
    }
    im.count = trees.length;
    im.instanceMatrix.needsUpdate = true;
    if (useTrunkTint) im.instanceColor.needsUpdate = true;
    return im;
  }

  _ensureChunkMeshes(key, trees) {
    const gen = this._chunkGen;
    let entry = this._chunkMeshes.get(key);
    if (entry && entry.gen === gen) return entry;

    if (entry) {
      for (const k of ["trunk", "lod0", "lod1", "lod2"]) {
        const m = entry[k];
        if (!m) continue;
        this.scene.remove(m);
        if (k !== "trunk") m.geometry?.dispose();
        m.geometry = null;
        m.dispose();
      }
    }

    entry = {
      gen,
      trunk: null,
      lod0: null,
      lod1: null,
      lod2: null,
      foliageBake: [null, null, null],
      treeStarts: [null, null, null],
      srcTrunk: null,
      treeCount: trees.length,
      foliageTreeCount: trees.length,
      bakedLeafCount: [0, 0, 0],
    };
    entry.trunk = this._buildChunkTrunk(trees);
    if (entry.trunk) {
      entry.trunk.visible = false;
      this.scene.add(entry.trunk);
      entry.srcTrunk = new Float32Array(
        entry.trunk.instanceMatrix.array.subarray(0, trees.length * 16),
      );
    }
    for (let li = 0; li < 3; li++) {
      const built = this._buildChunkFoliageLod(trees, li);
      if (built) {
        built.mesh.visible = false;
        this.scene.add(built.mesh);
        entry[`lod${li}`] = built.mesh;
        entry.foliageBake[li] = built.src;
        entry.treeStarts[li] = built.treeStarts;
        entry.bakedLeafCount[li] = built.bakedCount;
        entry.foliageTreeCount = Math.min(
          entry.foliageTreeCount,
          built.foliageTreeCount,
        );
      }
    }
    this._chunkMeshes.set(key, entry);
    this.applyShadowFlagsToEntry(entry);
    return entry;
  }

  /** Apply CFG.shadow to one chunk (lazy meshes miss init-time applyReceiveFlags). */
  applyShadowFlagsToEntry(entry) {
    if (!entry) return;
    const recv = this.cfg.shadow?.lod0Receive !== false;
    const cast = this.cfg.shadow?.castFoliage !== false;
    if (entry.lod0) {
      entry.lod0.receiveShadow = recv;
      entry.lod0.castShadow = cast;
    }
    if (entry.lod1) {
      entry.lod1.receiveShadow = false;
      entry.lod1.castShadow = cast;
    }
    if (entry.lod2) {
      entry.lod2.receiveShadow = false;
      entry.lod2.castShadow = false;
    }
  }

  applyShadowFlags() {
    for (const entry of this._chunkMeshes.values()) {
      this.applyShadowFlagsToEntry(entry);
    }
  }

  _applyTreeLodSlots(entry, ti, tier) {
    const lp = this.leavesPerLod;
    for (let li = 0; li < 3; li++) {
      const im = entry[`lod${li}`];
      const bake = entry.foliageBake[li];
      const starts = entry.treeStarts[li];
      if (!im || !bake || !starts) continue;
      if (starts[ti] === 0xffffffff) continue;
      const leafStart = starts[ti];
      const leafCount = lp[li];
      if (tier === li && tier >= 0) {
        copyFoliageTreeBlock(
          bake,
          leafStart,
          leafStart,
          leafCount,
          im.instanceMatrix.array,
          im.geometry,
        );
      } else {
        hideFoliageTreeBlock(im, leafStart, leafCount);
      }
    }
    if (entry.trunk && entry.srcTrunk) {
      const trunkArr = entry.trunk.instanceMatrix.array;
      if (tier >= 0) {
        trunkArr.set(entry.srcTrunk.subarray(ti * 16, ti * 16 + 16), ti * 16);
      } else {
        _hideMat.toArray(trunkArr, ti * 16);
      }
    }
  }

  /**
   * Per-tree LOD with fixed instance slots (no per-frame reorder).
   * Distance: 3D from camera, same thresholds as v2 treeLod / foliageLod.
   */
  _applyChunkTreeLod(entry, trees, camX, camY, camZ, lodCfg) {
    const lod0D = lodCfg.lod0Distance ?? 80;
    const lod1D = lodCfg.lod1Distance ?? 200;
    const fadeD = lodCfg.fadeOutDistance ?? 600;
    const h = lodCfg.lodHysteresis ?? 12;
    const lp = this.leavesPerLod;
    const n = Math.min(trees.length, entry.foliageTreeCount ?? 0);

    let trunkCount = 0;
    const leafCounts = [0, 0, 0];
    let layoutChanged = false;

    for (let ti = 0; ti < n; ti++) {
      const t = trees[ti];
      const dx = t.x - camX;
      const dy = (t.y ?? 0) - camY;
      const dz = t.z - camZ;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const prev = t.foliageTier ?? -1;
      const tier = resolveFoliageLodTier(dist, prev, lod0D, lod1D, fadeD, h);
      if (tier !== prev) {
        layoutChanged = true;
        this._applyTreeLodSlots(entry, ti, tier);
      }
      t.foliageTier = tier;
      if (tier < 0) continue;
      trunkCount++;
      if (tier < 3) leafCounts[tier] += lp[tier];
    }

    const chunkVisible = trunkCount > 0;
    if (entry.trunk) {
      entry.trunk.count = entry.treeCount;
      entry.trunk.visible = chunkVisible;
      if (layoutChanged) entry.trunk.instanceMatrix.needsUpdate = true;
    }

    for (let li = 0; li < 3; li++) {
      const im = entry[`lod${li}`];
      if (!im) continue;
      im.count = entry.bakedLeafCount[li] ?? im.count;
      im.visible = chunkVisible && leafCounts[li] > 0;
      if (layoutChanged && leafCounts[li] > 0) {
        im.instanceMatrix.needsUpdate = true;
      }
    }

    return { trunkCount, counts: leafCounts };
  }

  /** Frustum + lazy chunks; per-tree 3D distance LOD in fixed instance slots. */
  update(camera, lodCfg) {
    if (!this._enabled) {
      this._hideAllChunkMeshes();
      return;
    }
    this._projScreen.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    this._frustum.setFromProjectionMatrix(this._projScreen);

    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    const cs = this.cfg.forest.chunkSize;
    const lod0D = lodCfg.lod0Distance ?? 80;
    const lod1D = lodCfg.lod1Distance ?? 200;
    let visChunks = 0;
    let n0 = 0;
    let n1 = 0;
    let n2 = 0;
    let trunks = 0;
    let draws = 0;
    const activeKeys = new Set();

    for (const [key, chunk] of this.treeChunks) {
      if (chunk.trees.length === 0) continue;
      activeKeys.add(key);

      const minX = chunk.cx * cs;
      const minZ = chunk.cz * cs;
      this._box.min.set(minX, -100, minZ);
      this._box.max.set(minX + cs, 600, minZ + cs);

      if (!this._frustum.intersectsBox(this._box)) {
        const cached = this._chunkMeshes.get(key);
        if (cached) {
          if (cached.trunk) cached.trunk.visible = false;
          if (cached.lod0) cached.lod0.visible = false;
          if (cached.lod1) cached.lod1.visible = false;
          if (cached.lod2) cached.lod2.visible = false;
        }
        continue;
      }

      const entry = this._ensureChunkMeshes(key, chunk.trees);
      const applied = this._applyChunkTreeLod(
        entry,
        chunk.trees,
        camX,
        camY,
        camZ,
        lodCfg,
      );
      if (applied.trunkCount > 0) visChunks++;
      trunks += applied.trunkCount;
      n0 += applied.counts[0];
      n1 += applied.counts[1];
      n2 += applied.counts[2];
      if (applied.trunkCount > 0) draws++;
      if (applied.counts[0] > 0) draws++;
      if (applied.counts[1] > 0) draws++;
      if (applied.counts[2] > 0) draws++;
    }

    if (this._chunkMeshes.size > activeKeys.size + 16) {
      for (const [k, entry] of this._chunkMeshes) {
        if (!activeKeys.has(k)) {
          for (const name of ["trunk", "lod0", "lod1", "lod2"]) {
            if (entry[name]) {
              this.scene.remove(entry[name]);
              if (name !== "trunk") entry[name].geometry?.dispose();
              entry[name].geometry = null;
              entry[name].dispose();
            }
          }
          this._chunkMeshes.delete(k);
        }
      }
    }

    this.stats.visibleTrees = trunks;
    this.stats.visibleChunks = visChunks;
    this.stats.chunkCount = this.treeChunks.size;
    this.stats.lod0Leaves = n0;
    this.stats.lod1Leaves = n1;
    this.stats.lod2Leaves = n2;
    this.stats.trunkInstances = trunks;
    this.stats.drawCalls = draws;
  }

  updateTime(t) {
    if (this.foliageUniforms) this.foliageUniforms.time.value = t;
    if (this.foliageUniformsLod2) this.foliageUniformsLod2.time.value = t;
  }

  disposeChunkMeshes() {
    for (const [, entry] of this._chunkMeshes) {
      for (const k of ["trunk", "lod0", "lod1", "lod2"]) {
        const m = entry[k];
        if (!m) continue;
        this.scene.remove(m);
        if (k !== "trunk") m.geometry?.dispose();
        m.geometry = null;
        m.dispose();
      }
    }
    this._chunkMeshes.clear();
  }

  /** Fast: only regroup tree list; meshes built lazily when chunks enter view. */
  rebuildForest() {
    this.disposeChunkMeshes();
    this._chunkGen++;
    this._populateTreeChunks();
  }

  dispose() {
    this.disposeChunkMeshes();
    this.trunkGeo?.dispose();
    this.trunkGeo = null;
    this.foliageGeo?.dispose();
    this.foliageGeo = null;
    this.trunkMat?.dispose();
    this.trunkMat = null;
    this.foliageMat?.dispose();
    this.foliageMat = null;
    this.foliageMatLod1 = null;
    this.foliageUniformsLod1 = null;
    this.foliageMatLod2?.dispose();
    this.foliageMatLod2 = null;
    this.foliageUniformsLod2 = null;
  }
}
