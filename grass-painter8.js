/**
 * Grass blade geometry and TSL material — sandbox copy for experimentation.
 * Exact copy of grass.js. Same LOD system, patch placement, everything.
 */
import * as THREE from "three";
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  attribute,
  varying,
  texture,
  mix,
  step,
  smoothstep,
  clamp,
  abs,
  sin,
  cos,
  mod,
  dot,
  normalize,
  length,
  negate,
  add,
  sub,
  mul,
  div,
  max,
  min,
  pow,
  modelWorldMatrix,
  cameraPosition,
  normalLocal,
} from "three/tsl";
import {
  hash42,
  hash22,
  noise12,
  remap,
  easeOut,
  easeIn,
  rotateAxis_mat,
  rotateY_mat,
} from "./tsl-utils.js";

// ─── Constants (same as grass.js) ───
export const GRASS_PATCH_SIZE = 10;
export const GRASS_SEGMENTS_LOW = 1;
export const GRASS_SEGMENTS_MID = 3;
export const GRASS_SEGMENTS_HIGH = 7;  // 7 segs + 1 tip = 15 verts — exact GoT high LOD
// Pointed-tip blades: segments×2 pairs + 1 single tip vertex
export const GRASS_VERTS_LOW  = GRASS_SEGMENTS_LOW  * 2 + 1;  // 3
export const GRASS_VERTS_MID  = GRASS_SEGMENTS_MID  * 2 + 1;  // 7  — exact GoT low LOD
export const GRASS_VERTS_HIGH = GRASS_SEGMENTS_HIGH * 2 + 1;  // 15 — exact GoT high LOD
export const NEAR_PATCH_SIZE = 5;
export const GRASS_DENSITY = 40 * 40 * 3;
export const GRASS_DENSITY_LOW = 24 * 24 * 3;
export const GRASS_DENSITY_MID = 32 * 32 * 3;

export function createGrassGeometry(
  segments,
  numGrass,
  patchSize,
  setSeed,
  randRange,
) {
  setSeed(0);
  // segments×2 paired verts + 1 single tip vertex, duplicated for back-face copy
  const V = segments * 2 + 1,
    T = V * 2,
    indices = [];
  // All segments except the last: normal quads
  for (let i = 0; i < segments - 1; i++) {
    const v = i * 2;
    indices.push(v, v + 1, v + 2, v + 2, v + 1, v + 3);
    const f = V + v;
    indices.push(f + 2, f + 1, f, f + 3, f + 1, f + 2);
  }
  // Last segment: triangle converging to single tip vertex (pointed tip)
  const lb  = (segments - 1) * 2;  // last base pair
  const tip = segments * 2;         // single tip vertex = V - 1
  indices.push(lb, lb + 1, tip);             // front face triangle
  indices.push(V + tip, V + lb + 1, V + lb); // back face triangle (reversed winding)
  const pos = new Float32Array(T * 3),
    nrm = new Float32Array(T * 3),
    vid = new Float32Array(T),
    off = new Float32Array(numGrass * 3);
  for (let i = 0; i < T; i++) {
    nrm[i * 3 + 1] = 1;
    vid[i] = i;
  }
  let numCellsX = Math.floor(Math.sqrt(numGrass));
  while (numGrass % numCellsX !== 0) numCellsX--;
  const numCellsZ = numGrass / numCellsX;
  const cellW = patchSize / numCellsX;
  const cellH = patchSize / numCellsZ;
  for (let i = 0; i < numGrass; i++) {
    const col = i % numCellsX;
    const row = Math.floor(i / numCellsX);
    off[i * 3] = -patchSize * 0.5 + col * cellW + randRange(0, cellW);
    off[i * 3 + 1] = -patchSize * 0.5 + row * cellH + randRange(0, cellH);
    off[i * 3 + 2] = 0;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = numGrass;
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("vertIndex", new THREE.Float32BufferAttribute(vid, 1));
  geo.setAttribute("offset", new THREE.InstancedBufferAttribute(off, 3));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0, 0),
    1 + patchSize * 2,
  );
  return geo;
}

export function createGrassMaterial(
  segments,
  verts,
  useNpcInteraction,
  densityKey,
  ctx,
) {
  const {
    heightTex,
    grassDensityTex,
    trailTex,
    uTerrainSize,
    uTrailCenter,
    uTrailSize,
    uTime,
    uPlayerPos,
    uNpcPos,
    uLodDist,
    uLodBlendStart,
    uMaxDist,
    uBladeDensityRegular,
    uBladeDensityNear,
    uNearFadeEnd,
    uNearFadeRange,
    uGrassWidth,
    uGrassHeight,
    uWindDirX,
    uWindDirZ,
    uWindWaveScale,
    uWindSpeed,
    uWindAxis,
    uCrossAxis,
    uWindGust,
    uWindStr,
    uWindMicro,
    uInteractionRange,
    uInteractionStrength,
    uInteractionHThresh,
    uInteractionRepel,
    uMinSkyBlend,
    uMaxSkyBlend,
    uAoIntensity,
    uSeasonalScale,
    uSeasonalStr,
    uBaseColor1,
    uBaseColor2,
    uTipColor1,
    uTipColor2,
    uGradientCurve,
    uColorVariation,
    uLushColor,
    uBleachedColor,
    uSeasonalDryColor,
    uSunDir,
    uBsColor,
    uBsPower,
    uFrontScatter,
    uRimSSS,
    uBsIntensity,
    uSpecV1Intensity,
    uSpecV1Color,
    uSpecV1Dir,
    uSpecV2Intensity,
    uSpecV2Color,
    uSpecV2Dir,
    uSpecV2NoiseScale,
    uSpecV2NoiseStr,
    uSpecV2Power,
    uSpecV2TipBias,
    PI,
  } = ctx;

  const SEGS = float(segments),
    NVERTS = float(verts);
  const uBladeDensity =
    densityKey === "near" ? uBladeDensityNear : uBladeDensityRegular;
  const vGrassColor = varying(vec3(0), "v_gc");
  const vPacked = varying(vec3(0), "v_pk");
  const vWorldPos = varying(vec3(0), "v_wp");

  const positionNode = Fn(() => {
    const offsetAttr = attribute("offset", "vec3"),
      vertIdxAttr = attribute("vertIndex", "float");
    const grassOffset = vec3(offsetAttr.x, 0, offsetAttr.y);
    const bladeWorld = modelWorldMatrix.mul(vec4(grassOffset, 1)).xyz;

    const terrainUV = add(div(bladeWorld.xz, uTerrainSize), vec2(0.5));
    const terrainH = texture(heightTex, terrainUV).r;

    const trailScale = float(1);

    const hv = hash42(bladeWorld.xz),
      hv2 = hash22(bladeWorld.xz),
      hv3 = hash22(add(bladeWorld.xz, vec2(5.7, 11.2)));
    const distXZ = length(sub(cameraPosition.xz, bladeWorld.xz));
    const highLODOut = smoothstep(
      mul(uLodDist, uLodBlendStart),
      uLodDist,
      distXZ,
    );
    const lodFadeIn = smoothstep(uLodDist, uMaxDist, distXZ);
    const randomAngle = mul(hv.x, 2 * PI),
      randomShade = remap(hv.y, -1, 1, 0.75, 1);

    // ── GoT-style clumping: low-freq world noise groups nearby blades ─────────
    // Same UV for all three samples so height + lean are spatially coherent.
    const clumpUV     = mul(bladeWorld.xz, 0.18);
    const clumpN      = noise12(clumpUV);                                          // 0..1
    const clumpLx     = sub(mul(noise12(add(clumpUV, vec2(3.7, 1.2))), 2), 1);    // −1..1
    const clumpLz     = sub(mul(noise12(add(clumpUV, vec2(8.1, 5.3))), 2), 1);    // −1..1
    // Height: clump areas vary 85%–115% on top of per-blade randomHeight
    const clumpHeight = remap(clumpN, 0, 1, 0.85, 1.15);
    // Lean: strength of shared-direction pull within a clump (~0.35 units of tip offset)
    const clumpLeanStr = float(0.35);

    const randomHeight = mul(
      remap(hv.z, 0, 1, 0.75, 1.5),
      clumpHeight,
      mix(1, 0, lodFadeIn),
    );
    const randomLean      = remap(hv.w, 0, 1, 0.15, 0.45);
    // GoT per-blade cubic Bezier shape properties
    const randomBend      = remap(hv3.x, 0, 1, 0.5, 1.0);    // all blades have visible arc, no stick-straights
    const randomSideCurve = remap(hv3.y, 0, 1, -0.28, 0.28); // lateral twist, ± perpendicular to lean

    const vertID = mod(vertIdxAttr, NVERTS);
    const xSide = mod(vertID, 2);
    const heightPct = div(sub(vertID, xSide), mul(SEGS, 2));
    const totalHeight = mul(uGrassHeight, randomHeight, trailScale);
    const widthHigh = easeOut(sub(1, heightPct), 2),
      widthLow = sub(1, heightPct);
    const totalWidth = mul(
      uGrassWidth,
      mix(widthHigh, widthLow, highLODOut),
    );
    const paintedDensity = texture(grassDensityTex, terrainUV).r;
    const hasDensity = step(float(0.005), paintedDensity);
    let bladeVisible;
    if (densityKey === "near") {
      const distToPlayer = length(sub(bladeWorld.xz, uPlayerPos.xz));
      const fadedDensity = mix(
        uBladeDensityNear,
        float(0),
        smoothstep(sub(uNearFadeEnd, uNearFadeRange), uNearFadeEnd, distToPlayer),
      );
      bladeVisible = step(hv.x, fadedDensity.mul(paintedDensity)).mul(hasDensity);
    } else {
      bladeVisible = step(hv.x, uBladeDensity.mul(paintedDensity)).mul(hasDensity);
    }

    // View thickening: widen blades up to 2× when viewed edge-on so they don't disappear.
    // Blade width direction in XZ = (cos(randomAngle), -sin(randomAngle))
    const bwdX = cos(randomAngle);
    const bwdZ = negate(sin(randomAngle));
    const ctbLen = add(length(sub(bladeWorld.xz, cameraPosition.xz)), float(0.0001));
    const ctbX = div(sub(bladeWorld.x, cameraPosition.x), ctbLen);
    const ctbZ = div(sub(bladeWorld.z, cameraPosition.z), ctbLen);
    // edgeDot ≈ 1 when face-on, ≈ 0 when edge-on → widen when edge-on
    const edgeDot = abs(add(mul(bwdX, ctbX), mul(bwdZ, ctbZ)));
    const viewThicken = mix(float(2.0), float(1.0), edgeDot);

    const totalWidthVis = mul(totalWidth, bladeVisible, viewThicken);
    const totalHeightVis = mul(totalHeight, bladeVisible);
    const x = mul(sub(xSide, 0.5), totalWidthVis),
      y = mul(heightPct, totalHeightVis);

    const windDirVec = vec2(uWindDirX, uWindDirZ);
    const windScroll = mul(windDirVec, mul(uTime, uWindSpeed));
    const waveUV1 = add(mul(bladeWorld.xz, uWindWaveScale), windScroll);
    const wave1 = sub(mul(noise12(waveUV1), 2), 1);
    const crossDir = vec2(negate(uWindDirZ), uWindDirX);
    const waveUV2 = add(
      mul(bladeWorld.xz, mul(uWindWaveScale, 2.3)),
      mul(windScroll, 1.4),
      mul(crossDir, mul(uTime, 0.3)),
    );
    const wave2 = mul(sub(mul(noise12(waveUV2), 2), 1), 0.35);
    const gustUV = add(
      mul(bladeWorld.xz, mul(uWindWaveScale, 0.25)),
      mul(windScroll, 0.3),
    );
    const gustRaw = noise12(gustUV);
    const gustStr = mul(smoothstep(0.5, 0.9, gustRaw), uWindGust);
    const windLeanFull = mul(add(wave1, wave2, gustStr), uWindStr);
    const windLeanSimple = mul(wave1, uWindStr);
    const windLean = mix(windLeanSimple, windLeanFull, highLODOut);
    // GoT-style: bobbing is a separate high-frequency tip flutter, not baked into lean angle.
    // Use a decorrelated per-blade random so blades with the same yaw don't flutter in sync.
    // Scale flutter amplitude by current wind lean — high wind = violent tip shaking, not more tilt.
    const bobbingRand  = hash22(add(bladeWorld.xz, vec2(17.3, 4.1))).x;
    const bobbingPhase = add(mul(bobbingRand, 6.28318), mul(uTime, 5.5));
    const windFlutterScale = add(float(1), mul(abs(windLean), 2.0));
    const bobbingAmt   = mul(sin(bobbingPhase), uWindMicro, windFlutterScale);

    // Raw cross-wind noise for lateral Bezier tip displacement
    const crossDisplace = mul(wave2, 0.3);

    const bladeY = add(bladeWorld.y, terrainH);
    const repulseCenterXZ = uTrailCenter;
    const pDist = length(sub(bladeWorld.xz, repulseCenterXZ)),
      pHD = abs(sub(bladeY, uPlayerPos.y));
    const distFalloff = mix(
      float(1),
      float(0),
      smoothstep(float(0.5), uInteractionRange, pDist),
    );
    const heightFalloff = smoothstep(uInteractionHThresh, 0, pHD);
    const pFall = mul(distFalloff, heightFalloff);
    const pAng = mul(
      negate(mix(0, uInteractionStrength, pFall)),
      uInteractionRepel,
    );
    const pTo = normalize(
      sub(
        vec3(repulseCenterXZ.x, 0, repulseCenterXZ.y),
        vec3(bladeWorld.x, 0, bladeWorld.z),
      ),
    );
    const pAx = vec3(pTo.z, 0, negate(pTo.x));
    let totalFall, sumAxis, sumAngle;
    if (useNpcInteraction) {
      const n0D = length(sub(bladeWorld.xz, uNpcPos[0].xz)),
        n0H = abs(sub(bladeY, uNpcPos[0].y));
      const n0Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n0D)),
        smoothstep(uInteractionHThresh, 0, n0H),
      );
      const n0To = normalize(
        sub(
          vec3(uNpcPos[0].x, 0, uNpcPos[0].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n0Ax = vec3(n0To.z, 0, negate(n0To.x));
      const n1D = length(sub(bladeWorld.xz, uNpcPos[1].xz)),
        n1H = abs(sub(bladeY, uNpcPos[1].y));
      const n1Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n1D)),
        smoothstep(uInteractionHThresh, 0, n1H),
      );
      const n1To = normalize(
        sub(
          vec3(uNpcPos[1].x, 0, uNpcPos[1].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n1Ax = vec3(n1To.z, 0, negate(n1To.x));
      const n2D = length(sub(bladeWorld.xz, uNpcPos[2].xz)),
        n2H = abs(sub(bladeY, uNpcPos[2].y));
      const n2Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n2D)),
        smoothstep(uInteractionHThresh, 0, n2H),
      );
      const n2To = normalize(
        sub(
          vec3(uNpcPos[2].x, 0, uNpcPos[2].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n2Ax = vec3(n2To.z, 0, negate(n2To.x));
      const n3D = length(sub(bladeWorld.xz, uNpcPos[3].xz)),
        n3H = abs(sub(bladeY, uNpcPos[3].y));
      const n3Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n3D)),
        smoothstep(uInteractionHThresh, 0, n3H),
      );
      const n3To = normalize(
        sub(
          vec3(uNpcPos[3].x, 0, uNpcPos[3].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n3Ax = vec3(n3To.z, 0, negate(n3To.x));
      const n4D = length(sub(bladeWorld.xz, uNpcPos[4].xz)),
        n4H = abs(sub(bladeY, uNpcPos[4].y));
      const n4Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n4D)),
        smoothstep(uInteractionHThresh, 0, n4H),
      );
      const n4To = normalize(
        sub(
          vec3(uNpcPos[4].x, 0, uNpcPos[4].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n4Ax = vec3(n4To.z, 0, negate(n4To.x));
      const n5D = length(sub(bladeWorld.xz, uNpcPos[5].xz)),
        n5H = abs(sub(bladeY, uNpcPos[5].y));
      const n5Fall = mul(
        mix(float(1), float(0), smoothstep(float(0.5), uInteractionRange, n5D)),
        smoothstep(uInteractionHThresh, 0, n5H),
      );
      const n5To = normalize(
        sub(
          vec3(uNpcPos[5].x, 0, uNpcPos[5].z),
          vec3(bladeWorld.x, 0, bladeWorld.z),
        ),
      );
      const n5Ax = vec3(n5To.z, 0, negate(n5To.x));
      totalFall = add(
        pFall,
        add(
          n0Fall,
          add(n1Fall, add(n2Fall, add(n3Fall, add(n4Fall, n5Fall)))),
        ),
      );
      sumAxis = add(
        mul(pAx, pFall),
        add(
          mul(n0Ax, n0Fall),
          add(
            mul(n1Ax, n1Fall),
            add(
              mul(n2Ax, n2Fall),
              add(
                mul(n3Ax, n3Fall),
                add(mul(n4Ax, n4Fall), mul(n5Ax, n5Fall)),
              ),
            ),
          ),
        ),
      );
      sumAngle = add(
        mul(pAng, pFall),
        add(
          mul(
            mix(0, uInteractionStrength, n0Fall),
            uInteractionRepel,
            n0Fall,
          ),
          add(
            mul(
              mix(0, uInteractionStrength, n1Fall),
              uInteractionRepel,
              n1Fall,
            ),
            add(
              mul(
                mix(0, uInteractionStrength, n2Fall),
                uInteractionRepel,
                n2Fall,
              ),
              add(
                mul(
                  mix(0, uInteractionStrength, n3Fall),
                  uInteractionRepel,
                  n3Fall,
                ),
                add(
                  mul(
                    mix(0, uInteractionStrength, n4Fall),
                    uInteractionRepel,
                    n4Fall,
                  ),
                  mul(
                    mix(0, uInteractionStrength, n5Fall),
                    uInteractionRepel,
                    n5Fall,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    } else {
      totalFall = pFall;
      sumAxis = mul(pAx, pFall);
      sumAngle = mul(pAng, pFall);
    }
    const invTotal = div(1, max(totalFall, 0.001));
    const hasInteraction = smoothstep(0.001, 0.002, totalFall);
    const pAxis = normalize(mix(vec3(1, 0, 0), sumAxis, hasInteraction));
    const pAngle = mul(mul(sumAngle, invTotal), hasInteraction);

    // ── GoT-style Bezier blade spine ─────────────────────────────────────────
    // All displacements are world-space tip offsets (units), not rotation angles.
    // This eliminates the "crooked hook" artifact that occurs when stacking
    // rotation matrices at high wind angles.

    // Soft-saturate wind lean so blades never go horizontal at high wind.
    // x / (1 + |x|) is an algebraic sigmoid: reaches ±1 asymptotically.
    // At windLean=1.0 → 0.5 lean; at windLean=2.0 → 0.67 lean (never fully flat).
    const windLeanSat = div(windLean, add(float(1), abs(windLean)));
    const windTip     = mul(windLeanSat, totalHeightVis, 1.1);
    // Cross-wind tip displacement (perpendicular to wind)
    const crossTip   = mul(crossDisplace, totalHeightVis);
    // Bobbing: independent high-freq flutter added to wind tip
    const bobbingTip = mul(bobbingAmt, totalHeightVis, 0.2);
    // Natural per-blade lean: random tilt in blade's own width direction (×1.8 for visible droop)
    const naturalTip = mul(randomLean, totalHeightVis, 1.8);
    // Player/NPC interaction: tip displacement in pTo direction (negative pAngle = repel)
    const interactionTip = mul(pAngle, totalHeightVis, hasInteraction);

    // Bezier tip control point P2 — compute horizontal displacement first
    const clumpLeanX = mul(clumpLx, mul(totalHeightVis, clumpLeanStr));
    const clumpLeanZ = mul(clumpLz, mul(totalHeightVis, clumpLeanStr));
    const p2xRaw = add(
      add(
        mul(uWindDirX,         add(windTip, bobbingTip)),
        mul(negate(uWindDirZ), crossTip),
      ),
      add(
        mul(cos(randomAngle),  naturalTip),
        mul(pTo.x,             interactionTip),
      ),
      clumpLeanX,
    );
    const p2zRaw = add(
      add(
        mul(uWindDirZ,               add(windTip, bobbingTip)),
        mul(uWindDirX,               crossTip),
      ),
      add(
        mul(negate(sin(randomAngle)), naturalTip),
        mul(pTo.z,                   interactionTip),
      ),
      clumpLeanZ,
    );
    // Chord-length conservation: keep root→tip distance = totalHeightVis.
    // As blade leans, p2y drops so the tip "falls" instead of stretching upward.
    const p2rawLen = add(length(vec3(p2xRaw, totalHeightVis, p2zRaw)), float(0.0001));
    const p2scale  = div(totalHeightVis, p2rawLen);
    const p2x = mul(p2xRaw, p2scale);
    const p2y = mul(totalHeightVis, p2scale);
    const p2z = mul(p2zRaw, p2scale);

    // ── GoT cubic Bezier (4 control points: P0=root, P1, P2, P3=tip) ───────────
    // P3 = tip (chord-conserved, already computed above as p2x/p2y/p2z)
    const p3x = p2x, p3y = p2y, p3z = p2z;

    // P1 = lower control — nearly vertical at base, XZ scaled by randomBend
    // Low randomBend = stiff (blade shoots straight up before arcing)
    // High randomBend = floppy (blade curves from the root)
    const p1x = mul(p3x, mul(randomBend, 0.08));
    const p1y = mul(p3y, 0.3);
    const p1z = mul(p3z, mul(randomBend, 0.08));

    // P2 = mid control — 55% toward tip XZ + per-blade side curve (lateral drift)
    // Side curve direction = perpendicular to lean direction in XZ
    // Lean dir: (cos θ, -sin θ)  →  Perp: (sin θ, cos θ)
    const sideAmt = mul(randomSideCurve, totalHeightVis);
    const p2cx = add(mul(p3x, 0.55), mul(sin(randomAngle), sideAmt));
    const p2cy = mul(p3y, 0.65);
    const p2cz = add(mul(p3z, 0.55), mul(cos(randomAngle), sideAmt));

    // Cubic Bezier: B(t) = 3(1-t)²t·P1 + 3(1-t)t²·P2 + t³·P3   (P0 = origin)
    const bt   = heightPct;
    const bt2  = mul(bt, bt);
    const bt3  = mul(bt2, bt);
    const omt  = sub(1, bt);
    const omt2 = mul(omt, omt);
    const c1   = mul(3, omt2, bt);   // 3(1-t)²t
    const c2   = mul(3, omt,  bt2);  // 3(1-t)t²

    const spineX = add(mul(c1, p1x), mul(c2, p2cx), mul(bt3, p3x));
    const spineY = add(mul(c1, p1y), mul(c2, p2cy), mul(bt3, p3y));
    const spineZ = add(mul(c1, p1z), mul(c2, p2cz), mul(bt3, p3z));

    // Cubic tangent: B'(t) = 3(1-t)²·P1 + 6(1-t)t·(P2-P1) + 3t²·(P3-P2)
    const d1 = mul(3, omt2);
    const d2 = mul(6, omt, bt);
    const d3 = mul(3, bt2);
    const dtX = add(mul(d1, p1x), mul(d2, sub(p2cx, p1x)), mul(d3, sub(p3x, p2cx)));
    const dtY = add(mul(d1, p1y), mul(d2, sub(p2cy, p1y)), mul(d3, sub(p3y, p2cy)));
    const dtZ = add(mul(d1, p1z), mul(d2, sub(p2cz, p1z)), mul(d3, sub(p3z, p2cz)));

    // Normalise tangent (guard zero-length for invisible blades)
    const dtLen = add(length(vec3(dtX, dtY, dtZ)), float(0.0001));
    const tanX  = div(dtX, dtLen);
    const tanY  = div(dtY, dtLen);
    const tanZ  = div(dtZ, dtLen);

    // Blade width direction in world XZ (random yaw)
    const wdx = cos(randomAngle);
    const wdz = negate(sin(randomAngle));

    // Vertex position = spine + width step  (GoT: "step vertex in width direction")
    const widthStep = mul(sub(xSide, 0.5), totalWidthVis);
    // V-crease: both edge verts dip below the implied spine center.
    // Both xSide values are 0.5 from center, so dip is equal on each side.
    // Combined with rounded normals (left/right halves angled differently)
    // this produces a V-shaped cross-section catch-light.
    const vCreaseY = mul(negate(float(0.25)), totalWidthVis, sub(1, mul(heightPct, 0.7)));
    const finalVert = add(
      vec3(add(spineX, mul(wdx, widthStep)), add(spineY, vCreaseY), add(spineZ, mul(wdz, widthStep))),
      grassOffset,
    );

    // ── GoT rounded normals ───────────────────────────────────────────────────
    // Flat blade normal = cross(widthDir, tangent), computed manually:
    //   cross((wdx, 0, wdz), (tanX, tanY, tanZ))
    //     x = 0·tanZ  − wdz·tanY  = −wdz·tanY
    //     y = wdz·tanX − wdx·tanZ
    //     z = wdx·tanY − 0·tanX   =  wdx·tanY
    const fnx  = negate(mul(wdz, tanY));
    const fny  = sub(mul(wdz, tanX), mul(wdx, tanZ));
    const fnz  = mul(wdx, tanY);
    const fnLen = add(length(vec3(fnx, fny, fnz)), float(0.0001));
    const fnxN  = div(fnx, fnLen);
    const fnyN  = div(fny, fnLen);
    const fnzN  = div(fnz, fnLen);

    // GoT exact normal technique (from GDC talk):
    //   rotatedNormal1 = rotateY(+PI*0.3) * grassVertexNormal
    //   rotatedNormal2 = rotateY(-PI*0.3) * grassVertexNormal
    //   normal = mix(rotatedNormal1, rotatedNormal2, widthPercent)
    // Rotations are around world Y. Three.js convention:
    //   x' = nx*cos + nz*sin,  z' = -nx*sin + nz*cos
    const c03 = Math.cos(0.3 * Math.PI);  // ≈ 0.5878
    const s03 = Math.sin(0.3 * Math.PI);  // ≈ 0.8090
    // rotateY(+PI*0.3)
    const r1x = add(mul(fnxN, c03), mul(fnzN, s03));
    const r1z = add(mul(negate(fnxN), s03), mul(fnzN, c03));
    // rotateY(-PI*0.3)
    const r2x = sub(mul(fnxN, c03), mul(fnzN, s03));
    const r2z = add(mul(fnxN, s03), mul(fnzN, c03));
    // mix by xSide (widthPercent): left edge → r1, right edge → r2.
    // No zSide flip — grass blades are thin/translucent. DoubleSide material handles
    // back-face winding in the fragment shader; flipping the normal here would make
    // back-face blades lose sky contribution and appear dark.
    const bladeNormal = normalize(mix(vec3(r1x, fnyN, r1z), vec3(r2x, fnyN, r2z), xSide));

    const skyFade = mix(uMinSkyBlend, uMaxSkyBlend, highLODOut);
    const mixed = mix(bladeNormal, vec3(0, 1, 0), skyFade);
    // Clamp Y so no blade normal points into the ground
    const finalNormal = normalize(vec3(mixed.x, max(mixed.y, float(0)), mixed.z));
    normalLocal.assign(finalNormal);

    // All vertices use the blade root's terrain height (terrainH).
    // Per-vertex sampling caused blades near cliff edges to stretch up to cliff-top
    // height when a vertex XZ landed above the cliff interior. Using root height
    // for all vertices eliminates this — the tiny slope-following trade-off is
    // imperceptible for grass blades (< 2m wide).
    const vertTerrainH = terrainH;

    const cn1 = noise12(mul(bladeWorld.xz, 0.015)),
      cn2 = noise12(mul(bladeWorld.xz, 0.04)),
      cn3 = noise12(mul(bladeWorld.xz, 0.1));
    const colorMix = mul(add(cn1, mul(cn2, 0.5), mul(cn3, 0.25)), 0.57);
    const seasonNoise = noise12(mul(bladeWorld.xz, uSeasonalScale));
    const seasonFactor = mul(
      smoothstep(0.4, 0.7, seasonNoise),
      uSeasonalStr,
      highLODOut,
    );
    const baseCol = mix(uBaseColor1, uBaseColor2, hv2.x),
      tipCol = mix(uTipColor1, uTipColor2, hv2.y);
    const hiCol = mul(
      mix(baseCol, tipCol, easeIn(heightPct, uGradientCurve)),
      randomShade,
    );
    const loCol = mul(
      mix(uBaseColor1, uTipColor1, heightPct),
      randomShade,
    );
    let grassCol = mix(hiCol, loCol, highLODOut);
    const colorVarLod = mul(highLODOut, uColorVariation);
    grassCol = mix(
      grassCol,
      mul(uLushColor, randomShade),
      mul(smoothstep(0.3, 0.6, colorMix), colorVarLod, 0.5),
    );
    grassCol = mix(
      grassCol,
      mul(uBleachedColor, randomShade),
      mul(smoothstep(0.7, 0.9, colorMix), colorVarLod, 0.3),
    );
    // Clump-scale color: lush-green patches vs slightly warm/dry — matches GoT large color clusters
    grassCol = mix(
      grassCol,
      mul(uLushColor, randomShade),
      mul(smoothstep(0.62, 0.82, clumpN), colorVarLod, 0.45),
    );
    grassCol = mix(grassCol, uSeasonalDryColor, seasonFactor);
    grassCol = mix(
      grassCol,
      mul(grassCol, vec3(1.1, 1.05, 0.85)),
      mul(sub(1, trailScale), 0.4),
    );
    const aoBase = max(sub(1.0, mul(uAoIntensity, 0.65)), 0.2);
    const aoLod = mul(aoBase, mix(0.5, 1.0, highLODOut));
    const ao = mix(aoLod, 1.0, smoothstep(0.0, 0.22, heightPct));
    const fadeFactor = sub(1, smoothstep(0.4, 1, lodFadeIn));
    // Gust wave: blades in strong-gust zones lean away from sun → darken.
    // gustStr travels with the wind, creating GoT's rolling shadow sweep.
    const gustShadow = sub(1, mul(gustStr, 0.45));
    vGrassColor.assign(
      mul(grassCol, ao, gustShadow, mul(fadeFactor, fadeFactor), bladeVisible),
    );
    vPacked.assign(vec3(heightPct, xSide, highLODOut));

    const worldFinal = vec3(
      finalVert.x,
      add(finalVert.y, vertTerrainH),
      finalVert.z,
    );
    vWorldPos.assign(modelWorldMatrix.mul(vec4(worldFinal, 1)).xyz);
    return worldFinal;
  })();

  const colorNode = Fn(() => {
    const heightPct = vPacked.x;
    let col = vGrassColor;
    const viewDir = normalize(sub(cameraPosition, vWorldPos));
    const n = normalLocal;
    const backScat = max(dot(negate(uSunDir), n), 0),
      frontScat = max(dot(uSunDir, n), 0);
    const rim = sub(1, max(dot(n, viewDir), 0));
    const thickness = add(mul(sub(1, heightPct), 0.7), 0.3);
    const transmitCol = mix(
      uBsColor,
      mul(uBsColor, vec3(1.3, 1.1, 0.7)),
      sub(1, thickness),
    );
    const totalSSS = clamp(
      add(
        mul(pow(backScat, uBsPower), thickness),
        mul(pow(frontScat, 1.5), thickness, uFrontScatter),
        mul(pow(pow(rim, 1.5), 2), thickness, uRimSSS),
      ),
      0,
      1,
    );
    // SSS always active — no LOD gate (GoT lights all blades from all angles)
    col = add(col, mul(transmitCol, 0.35, totalSSS, uBsIntensity));

    const sceneDepth = length(sub(cameraPosition, vWorldPos));
    const specNormal = normalize(n);
    const specReflect = sub(
      uSpecV1Dir,
      mul(specNormal, mul(2.0, dot(uSpecV1Dir, specNormal))),
    );
    const specDot = pow(max(dot(viewDir, specReflect), 0.0), 25.6);
    const specDistFade = smoothstep(2.0, 10.0, sceneDepth);
    const specTipFade = smoothstep(0.5, 1.0, heightPct);
    const specLod = smoothstep(0.0, 0.3, vPacked.z);
    const specV1 = mul(
      uSpecV1Color,
      specDot,
      uSpecV1Intensity,
      specDistFade,
      specTipFade,
      specLod,
      3.0,
    );
    col = add(col, specV1);

    const noiseUV = mul(vWorldPos.xz, uSpecV2NoiseScale);
    const n1v2 = sub(mul(noise12(noiseUV), 2.0), 1.0);
    const n2v2 = sub(mul(noise12(add(noiseUV, vec2(73.7, 157.3))), 2.0), 1.0);
    const n3v2 = sub(
      mul(noise12(add(mul(noiseUV, 2.7), vec2(31.1, 97.5))), 2.0),
      1.0,
    );
    const perturbedN = normalize(
      add(n, mul(vec3(n1v2, mul(n3v2, 0.3), n2v2), uSpecV2NoiseStr)),
    );
    const v2Reflect = sub(
      uSpecV2Dir,
      mul(perturbedN, mul(2.0, dot(uSpecV2Dir, perturbedN))),
    );
    const v2Spec = pow(max(dot(viewDir, v2Reflect), 0.0), uSpecV2Power);
    const v2DistFade = smoothstep(2.0, 10.0, sceneDepth);
    const v2TipFade = smoothstep(sub(1.0, uSpecV2TipBias), 1.0, heightPct);
    const specV2 = mul(
      uSpecV2Color,
      v2Spec,
      uSpecV2Intensity,
      v2DistFade,
      v2TipFade,
      specLod,
    );
    col = add(col, specV2);

    return col;
  })();

  const mat = new THREE.MeshStandardNodeMaterial({
    side: THREE.DoubleSide,
    roughness: 0.85,
    metalness: 0.0,
  });
  mat.positionNode = positionNode;
  mat.colorNode = colorNode;
  mat.envMapIntensity = 0;
  return mat;
}

export function setupGrassPatches(
  scene,
  camera,
  grassGroup,
  geosAndMats,
  options,
) {
  const {
    geoLow,
    geoMid,
    geoHigh,
    geoNear,
    matLowSimple,
    matMidSimple,
    matHighSimple,
    matHighSimpleNear,
  } = geosAndMats;
  const {
    PATCH_SPACING,
    GRID_SIZE,
    NEAR_PATCH_SIZE,
    nearRingExtent,
    lodDistance,
    lodDistanceMid,
    maxDistance,
    lodHysteresis = 2,
  } = options;
  const lodMid = lodDistanceMid ?? lodDistance * 1.4;
  const hyst = lodHysteresis;

  const patchLodCache = new Map();

  const poolLow = { meshes: [], idx: 0 };
  const poolMid = { meshes: [], idx: 0 };
  const poolHigh = { meshes: [], idx: 0 };
  const poolNear = { meshes: [], idx: 0 };

  function getMesh(pool, geo, mat) {
    if (pool.idx < pool.meshes.length) return pool.meshes[pool.idx++];
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    grassGroup.add(m);
    pool.meshes.push(m);
    pool.idx++;
    return m;
  }

  const baseCellPos = new THREE.Vector3();
  const cameraPosXZ = new THREE.Vector3();
  const aabb = new THREE.Box3();
  const cellPos = new THREE.Vector3();
  const aabbSize = new THREE.Vector3(PATCH_SPACING, 1000, PATCH_SPACING);
  const nearBaseCellPos = new THREE.Vector3();
  const nearAabbSize = new THREE.Vector3(NEAR_PATCH_SIZE, 1000, NEAR_PATCH_SIZE);

  function update(charPos, frustum) {
    for (let i = 0; i < grassGroup.children.length; i++)
      grassGroup.children[i].visible = false;
    poolLow.idx = 0;
    poolMid.idx = 0;
    poolHigh.idx = 0;
    poolNear.idx = 0;

    baseCellPos
      .copy(camera.position)
      .divideScalar(PATCH_SPACING)
      .floor()
      .multiplyScalar(PATCH_SPACING);
    cameraPosXZ.set(camera.position.x, 0, camera.position.z);
    let patchCount = 0;

    for (let x = -GRID_SIZE; x < GRID_SIZE; x++) {
      for (let z = -GRID_SIZE; z < GRID_SIZE; z++) {
        cellPos.set(
          baseCellPos.x + x * PATCH_SPACING,
          0,
          baseCellPos.z + z * PATCH_SPACING,
        );
        aabb.setFromCenterAndSize(cellPos, aabbSize);
        const dist = aabb.distanceToPoint(cameraPosXZ);
        if (dist > maxDistance) continue;
        if (!frustum.intersectsBox(aabb)) continue;
        const cellKey = `${cellPos.x},${cellPos.z}`;
        const lastLod = patchLodCache.get(cellKey);
        let useLow, useMid, useHigh;
        if (lastLod === "high") {
          useHigh = dist <= lodDistance + hyst;
          useMid = !useHigh && dist <= lodMid;
          useLow = !useHigh && !useMid;
        } else if (lastLod === "mid") {
          useHigh = dist <= lodDistance - hyst;
          useLow = dist > lodMid + hyst;
          useMid = !useHigh && !useLow;
        } else if (lastLod === "low") {
          useLow = dist > lodMid - hyst;
          useMid = !useLow && dist <= lodMid;
          useHigh = !useLow && !useMid;
        } else {
          useLow = dist > lodMid;
          useMid = dist > lodDistance && dist <= lodMid;
          useHigh = dist <= lodDistance;
        }
        patchLodCache.set(cellKey, useHigh ? "high" : useMid ? "mid" : "low");
        const mat = useLow ? matLowSimple : useMid ? matMidSimple : matHighSimple;
        const pool = useLow ? poolLow : useMid ? poolMid : poolHigh;
        const geo = useLow ? geoLow : useMid ? geoMid : geoHigh;
        const mesh = getMesh(pool, geo, mat);
        mesh.material = mat;
        mesh.receiveShadow = useHigh || useMid;
        mesh.position.set(cellPos.x, 0, cellPos.z);
        mesh.visible = true;
        patchCount++;
      }
    }

    if (patchLodCache.size > 1200) {
      patchLodCache.clear();
    }

    const nearExtent = Math.max(1, Math.min(4, Math.round(nearRingExtent)));
    nearBaseCellPos
      .copy(charPos)
      .divideScalar(NEAR_PATCH_SIZE)
      .floor()
      .multiplyScalar(NEAR_PATCH_SIZE);
    for (let x = -nearExtent; x <= nearExtent; x++) {
      for (let z = -nearExtent; z <= nearExtent; z++) {
        cellPos.set(
          nearBaseCellPos.x + x * NEAR_PATCH_SIZE,
          0,
          nearBaseCellPos.z + z * NEAR_PATCH_SIZE,
        );
        aabb.setFromCenterAndSize(cellPos, nearAabbSize);
        if (!frustum.intersectsBox(aabb)) continue;
        const nearMesh = getMesh(poolNear, geoNear, matHighSimpleNear);
        nearMesh.material = matHighSimpleNear;
        nearMesh.position.copy(cellPos);
        nearMesh.visible = true;
        patchCount++;
      }
    }

    return { patchCount };
  }

  return { update };
}
