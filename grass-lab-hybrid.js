/**
 * Grass Lab — HYBRID v0
 * Revo skeleton (camera-following wrap tile + compute SSBO, tiny vertex shader)
 * wearing the Gemini skin (arc bend, world-space Voronoi clumps, hue/sat/dry
 * color variation, AO gradient, SSS backscatter — manual lighting, no PBR).
 *
 * Per-blade work happens ONCE per blade in the compute pass (height, density,
 * clump, wind, culls); the vertex shader only places the vertex on the arc.
 * Baseline Gemini recomputes all of that per VERTEX (15× per blade).
 */
import * as THREE from "three";
import {
  Fn,
  If,
  abs,
  atomicAdd,
  atomicStore,
  attribute,
  clamp,
  cos,
  float,
  floor,
  fract,
  hash,
  instanceIndex,
  instancedArray,
  storage,
  uint,
  length,
  max,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  sqrt,
  step,
  texture,
  time,
  uniform,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
  dot,
  negate,
  positionLocal,
  cameraPosition,
  PI2,
} from "three/tsl";
import { hash42 } from "./v2/core/foliage/tsl-utils.js";
import { createBladeGeometry } from "./v2/core/foliage/grassGemini.js";
import { wrapTileOffsetXZ } from "./v2/core/revoGrass/revoGrassTile.js";
import { computeFrustumVisibility } from "./v2/core/revoGrass/revoGrassSsboUtils.js";

function srgb(hex) {
  return new THREE.Color(hex).convertSRGBToLinear();
}

/**
 * Gemini-style crossed blade: the ribbon duplicated with aCross = 1; the VS
 * rotates the second copy +90° around the spine. With FrontSide culling this
 * is exactly Gemini's look (their aIsCross instance flag, folded into the
 * geometry so instance count stays 1× per blade).
 */
function createCrossedBladeGeometry(height, width, segs, taper) {
  const base = createBladeGeometry(height, width, segs, taper);
  const srcPos = base.attributes.position.array;
  const srcUv = base.attributes.uv.array;
  const srcIdx = base.index.array;
  const n = base.attributes.position.count;

  const positions = new Float32Array(n * 2 * 3);
  positions.set(srcPos, 0);
  positions.set(srcPos, n * 3);
  const uvs = new Float32Array(n * 2 * 2);
  uvs.set(srcUv, 0);
  uvs.set(srcUv, n * 2);
  const aCross = new Float32Array(n * 2);
  aCross.fill(1, n);
  const indices = new Uint16Array(srcIdx.length * 2);
  indices.set(srcIdx, 0);
  for (let i = 0; i < srcIdx.length; i++) {
    indices[srcIdx.length + i] = srcIdx[i] + n;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("aCross", new THREE.BufferAttribute(aCross, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  base.dispose();
  return geo;
}

export class HybridGrassSystem {
  /**
   * @param {object} opts
   *   scene, renderer       — three
   *   heightTex             — RGBA float, .x = terrain height (v2 uv convention)
   *   terrainNormalTex      — RGBA float, .xyz = terrain normal
   *   densityTex            — painted grass density (.x)
   *   windTex               — v2 createWindTexture() output
   *   worldSize             — terrain world size
   *   gp                    — grassState (v2 toolState.grass shape)
   *   tileSize, bladesPerSide — tile config (default 130 / 512 ≈ 262k)
   *   Ring options (lets one class serve as near tile / mid shell / far shell):
   *   bladeWidth, segments, bladeHeightMul — geometry overrides
   *   innerR0..innerR1      — density ramps IN over this radial band (shells)
   *   outerR0..outerR1      — density ramps OUT to pMin over this band
   *   pMin                  — residual keep probability past outerR1
   */
  constructor({
    scene,
    renderer,
    heightTex,
    terrainNormalTex,
    densityTex,
    windTex,
    worldSize,
    gp,
    tileSize = 130,
    bladesPerSide = 512,
    bladeWidth = null,
    segments = null,
    bladeHeightMul = 1,
    innerR0 = 0,
    innerR1 = 0,
    outerR0 = null,
    outerR1 = null,
    pMin = 0,
    name = "HybridGrass",
  }) {
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = name;
    scene.add(this.group);

    this.count = bladesPerSide * bladesPerSide;
    this.tileSize = tileSize;
    this.bladesPerSide = bladesPerSide;

    const windRad = ((gp.windAngle ?? 0) * Math.PI) / 180;
    const u = (this.u = {
      uAnchorPos: uniform(new THREE.Vector3()),
      uAnchorDeltaXZ: uniform(new THREE.Vector2()),
      uTileSize: uniform(tileSize),
      uTerrainSize: uniform(worldSize),
      uCameraMatrix: uniform(new THREE.Matrix4()),
      uFx: uniform(1),
      uFy: uniform(1),
      uSunDir: uniform(new THREE.Vector3(0.5, 0.8, 0.3).normalize()),
      // blade / bend
      uBladeHeight: uniform((gp.bladeHeight ?? 1) * bladeHeightMul),
      uBendFocus: uniform(gp.bendFocus ?? 0.5),
      uMaxAngle: uniform(gp.maxAngle ?? 1.4),
      uNaturalLean: uniform(gp.naturalLean ?? 0.9),
      // wind
      uWindSpeed: uniform(gp.windSpeed ?? 0.2),
      uWindStrength: uniform(gp.windStrength ?? 1.4),
      uWindGust: uniform(gp.windGust ?? 0.3),
      uWindWaveScale: uniform(gp.windWaveScale ?? 0.12),
      uWindDir: uniform(
        new THREE.Vector2(Math.cos(windRad), Math.sin(windRad)),
      ),
      // clump
      uClumpScale: uniform(gp.clumpScale ?? 1.5),
      uClumpStrength: uniform(gp.clumpStrength ?? 0.7),
      // density / culls — radial ring window [innerR0..innerR1 ramp in,
      // outerR0..outerR1 ramp out to pMin]
      uGrassDensity: uniform(gp.grassDensity ?? 1),
      uInnerR0: uniform(innerR0),
      uInnerR1: uniform(Math.max(innerR1, innerR0 + 0.001)),
      uOuterR0: uniform(outerR0 ?? tileSize * 0.28),
      uOuterR1: uniform(outerR1 ?? tileSize * 0.5),
      uPMin: uniform(pMin),
      uCullPadNdcX: uniform(0.1),
      uCullPadNdcYNear: uniform(0.75),
      uCullPadNdcYFar: uniform(0.2),
      // color
      uBladeCol: uniform(srgb(gp.bladeColor ?? "#0e300e")),
      uTipCol: uniform(srgb(gp.tipColor ?? "#004d05")),
      uAoBase: uniform(gp.aoBase ?? 0.25),
      uAoPower: uniform(gp.aoPower ?? 2),
      uColorVar: uniform(gp.colorVariation ? 1 : 0),
      uCvHueSpread: uniform(gp.cvHueSpread ?? 0.08),
      uCvSatSpread: uniform(gp.cvSatSpread ?? 0.3),
      uCvDryAmount: uniform(gp.cvDryAmount ?? 0.15),
      uCvDryCol: uniform(srgb(gp.cvDryColor ?? "#8a7a3a")),
      uSkyBlend: uniform(gp.skyBlend ?? 0.8),
      uCylindrical: uniform(gp.cylindrical ?? 0.3),
      // SSS (manual lighting)
      uBssCol: uniform(srgb(gp.bssColor ?? "#2d7a2d")),
      uBssIntensity: uniform(gp.bssIntensity ?? 1.2),
      uBssPower: uniform(gp.bssPower ?? 2),
      uRimSSS: uniform(gp.rimSSS ?? 0.25),
      // lighting rig (lab-side approximations of sun + hemisphere)
      uSunCol: uniform(srgb("#fff4e0").multiplyScalar(2.1)),
      uSkyAmb: uniform(srgb("#bcd8f0").multiplyScalar(0.85)),
      uGroundAmb: uniform(srgb("#56683f").multiplyScalar(0.55)),
      // interaction
      uPlayerPos: uniform(new THREE.Vector3()),
      uInteractionRadius: uniform(gp.interactionRadius ?? 1.5),
      uInteractionStrength: uniform(gp.interactionStrength ?? 0.7),
    });

    // ── Geometry (needed before compaction buffers for indexCount) ──
    const segs = Math.max(1, Math.round(segments ?? gp.bladeYSegments ?? 7));
    const geom = createCrossedBladeGeometry(
      1.0, // unit height — bladeH from SSBO scales it
      bladeWidth ?? gp.bladeWidth ?? 0.15,
      segs,
      gp.tipTaperStart ?? 0.5,
    );

    // ── SSBOs ──
    // bufPos: x,y = tile-local offset (wraps with anchor), z = bendAng, w free
    // bufA:   x = visibility, y = bend force (lean+wind), z = zRoll, w = terrainY
    // bufB:   x = bladeH, y = yaw, z = clumpShade, w = shadeRand
    // bufC:   x = h4 hue, y = h5 sat/dry, z = terrainNx, w = terrainNz
    const bufPos = instancedArray(this.count, "vec4");
    const bufA = instancedArray(this.count, "vec4");
    const bufB = instancedArray(this.count, "vec4");
    const bufC = instancedArray(this.count, "vec4");

    // ── Compaction: visible blade ids + GPU-written indirect draw args ──
    // Layout: [indexCount, instanceCount, firstIndex, baseVertex, firstInstance]
    // Compute atomically appends visible blade ids; the GPU decides its own
    // instance count — culled blades cost ZERO vertex work.
    const compactBuf = instancedArray(this.count, "uint");
    const indirectData = new Uint32Array(5);
    indirectData[0] = geom.index.count;
    this._indirectAttr = new THREE.IndirectStorageBufferAttribute(
      indirectData,
      5,
    );
    if (typeof geom.setIndirect === "function") {
      geom.setIndirect(this._indirectAttr);
    } else {
      geom.indirect = this._indirectAttr;
    }
    const indirectStorage = storage(this._indirectAttr, "uint", 5).toAtomic();

    this._buffers = { bufPos, bufA, bufB, bufC, compactBuf };

    // Reset visible-instance counter (runs right before each cull pass)
    this.computeReset = Fn(() => {
      atomicStore(indirectStorage.element(1), uint(0));
    })().compute(1, [1]);

    const fSide = float(bladesPerSide);
    const fSpacing = float(tileSize / bladesPerSide);
    const fHalf = float(tileSize * 0.5);

    // ── INIT: jittered grid, everything else derived per-frame ──
    this.computeInit = Fn(() => {
      const p = bufPos.element(instanceIndex);
      const row = floor(float(instanceIndex).div(fSide));
      const col = float(instanceIndex).mod(fSide);
      const jx = hash(instanceIndex.add(4321));
      const jz = hash(instanceIndex.add(1234));
      p.x.assign(col.mul(fSpacing).sub(fHalf).add(jx.mul(fSpacing)));
      p.y.assign(row.mul(fSpacing).sub(fHalf).add(jz.mul(fSpacing)));
      p.z.assign(float(0));
      p.w.assign(float(0));
      const a = bufA.element(instanceIndex);
      a.x.assign(float(0));
    })().compute(this.count, [64]);

    // ── UPDATE: once per blade — height, density, clump, wind, culls ──
    this.computeUpdate = Fn(() => {
      const p = bufPos.element(instanceIndex);
      const a = bufA.element(instanceIndex);
      const b = bufB.element(instanceIndex);
      const c = bufC.element(instanceIndex);

      const wrapped = wrapTileOffsetXZ(
        vec2(p.x, p.y),
        u.uAnchorDeltaXZ,
        u.uTileSize,
      );
      p.x.assign(wrapped.x);
      p.y.assign(wrapped.y);

      const worldX = wrapped.x.add(u.uAnchorPos.x);
      const worldZ = wrapped.y.add(u.uAnchorPos.z);
      const worldXZ = vec2(worldX, worldZ);
      const terrainUV = worldXZ.div(u.uTerrainSize).add(0.5);

      const terrainY = texture(heightTex, terrainUV).x;
      const tN = texture(terrainNormalTex, terrainUV).xyz;
      const worldPos = vec3(worldX, terrainY, worldZ);

      // ── Culls (cheap first) ──
      const painted = texture(densityTex, terrainUV).x;
      const hasDensity = smoothstep(float(0.0), float(0.005), painted);
      const densityHash = hash(instanceIndex.add(7919));
      const densityKeep = step(densityHash, u.uGrassDensity.mul(painted)).mul(
        hasDensity,
      );

      // playable-map edge fade
      const mapHalf = u.uTerrainSize.mul(0.5);
      const outMax = max(abs(worldX), abs(worldZ));
      const mapStay = float(1).sub(
        smoothstep(mapHalf.sub(2), mapHalf.add(0.35), outMax),
      );

      // Ring-window stochastic keep (dist² like Revo): density ramps in over
      // [innerR0..innerR1] (shells) and out to pMin over [outerR0..outerR1].
      const dxA = worldX.sub(u.uAnchorPos.x);
      const dzA = worldZ.sub(u.uAnchorPos.z);
      const distSqA = dxA.mul(dxA).add(dzA.mul(dzA));
      const pIn = smoothstep(
        u.uInnerR0.mul(u.uInnerR0),
        u.uInnerR1.mul(u.uInnerR1),
        distSqA,
      );
      const tOut = smoothstep(
        u.uOuterR0.mul(u.uOuterR0),
        u.uOuterR1.mul(u.uOuterR1),
        distSqA,
      );
      const pKeep = pIn.mul(mix(float(1), u.uPMin, tOut));
      const stochasticKeep = step(hash(instanceIndex.add(31337)), pKeep);
      const frustumVis = computeFrustumVisibility(
        worldPos,
        u.uCameraMatrix,
        u.uFx,
        u.uFy,
        u.uBladeHeight.mul(1.6),
        u.uCullPadNdcX,
        u.uCullPadNdcYNear,
        u.uCullPadNdcYFar,
      );
      const vis = densityKeep
        .mul(mapStay)
        .mul(stochasticKeep)
        .mul(frustumVis);

      If(vis.greaterThan(0.5), () => {
        // Compaction append: this blade earns a slot in the draw list
        const slot = atomicAdd(indirectStorage.element(1), uint(1));
        compactBuf.element(slot).assign(instanceIndex);

        a.x.assign(vis);
        a.w.assign(terrainY);
        // ── Per-blade identity (travels with the blade as the tile wraps) ──
        const h0 = hash(instanceIndex.add(196));
        const h1 = hash(instanceIndex.add(8521));
        const h2 = hash(instanceIndex.add(3197));
        const h3 = hash(instanceIndex.add(577));
        const h4 = hash(instanceIndex.add(911));
        const h5 = hash(instanceIndex.add(2741));

        // ── World-space Voronoi clumping (Gemini) ──
        const cellP = worldXZ.div(u.uClumpScale);
        const cellID = floor(cellP);
        const cellFrac = fract(cellP);
        const cv = hash42(cellID);
        const clumpDist = length(vec2(cv.x, cv.y).sub(cellFrac));
        const clumpInfluence = smoothstep(0.75, 0.05, clumpDist).mul(
          u.uClumpStrength,
        );

        const yaw = mix(h0, cv.z, clumpInfluence).mul(PI2);
        const hScale = mix(float(0.75), float(1.5), h2);
        const clumpHeightScale = mix(float(0.6), float(1.4), cv.x);
        const naturalLean = mix(h3, cv.w, clumpInfluence).mul(u.uNaturalLean);
        const bladeH = u.uBladeHeight.mul(
          mix(hScale, clumpHeightScale, clumpInfluence),
        );
        const clumpShade = mix(
          float(1.0),
          mix(float(0.82), float(1.18), cv.y),
          clumpInfluence,
        );

        // ── Wind (Gemini formulas, baked windTex channels) ──
        const tBase = time.mul(u.uWindSpeed);
        const dirX = u.uWindDir.x;
        const dirZ = u.uWindDir.y;
        const waveUV = vec2(
          worldX.mul(u.uWindWaveScale).add(dirX.mul(tBase)).div(8.0),
          worldZ.mul(u.uWindWaveScale).add(dirZ.mul(tBase)).div(8.0),
        );
        const gustUV = vec2(
          worldX
            .mul(u.uWindWaveScale)
            .mul(0.25)
            .add(dirX.mul(tBase).mul(0.3))
            .div(3.0),
          worldZ
            .mul(u.uWindWaveScale)
            .mul(0.25)
            .add(dirZ.mul(tBase).mul(0.3))
            .div(3.0),
        );
        const zUV = vec2(
          worldZ.mul(u.uWindWaveScale).add(dirZ.mul(tBase)).add(17.3).div(6.0),
          worldX.mul(u.uWindWaveScale).sub(dirX.mul(tBase)).add(31.7).div(6.0),
        );
        const wave = texture(windTex, waveUV).x.mul(2).sub(1);
        const gustRaw = texture(windTex, gustUV).y.mul(2).sub(1);
        const zRollRaw = texture(windTex, zUV).z.mul(2).sub(1);
        const micro = sin(tBase.add(h0.mul(PI2)).mul(4.0)).mul(0.15);

        const gustStr = smoothstep(float(0.5), float(0.9), gustRaw).mul(
          u.uWindGust,
        );
        const windBase = wave.add(0.4).add(gustStr);
        const room = max(float(0), u.uMaxAngle.sub(naturalLean));
        const windScaled = windBase
          .add(micro)
          .mul(u.uWindStrength)
          .mul(room.div(u.uMaxAngle));

        // ── Player interaction: push blades away (flatten toward player dir) ──
        const toBlade = worldXZ.sub(vec2(u.uPlayerPos.x, u.uPlayerPos.z));
        const pDist = length(toBlade);
        const pFall = float(1).sub(
          smoothstep(float(0.5), u.uInteractionRadius, pDist),
        );
        const pushForce = pFall.mul(u.uInteractionStrength).mul(1.4);

        // ── Gemini-style scalar bend force, temporally smoothed ──
        // Bend happens along the blade's own yaw (rotated in the VS), exactly
        // like Gemini — FrontSide culling is what makes that read coherent.
        // Both force AND zRoll are eased across compute ticks so the throttled
        // 30/10 Hz updates never step visibly (raw zRoll was the wind jitter).
        const targetForce = naturalLean.add(windScaled).add(pushForce);
        const prevForce = p.z;
        const kF = float(0.18);
        const newForce = prevForce.add(targetForce.sub(prevForce).mul(kF));
        p.z.assign(newForce);

        const targetZRoll = zRollRaw.mul(0.4).sub(0.2);
        const prevZRoll = p.w;
        const newZRoll = prevZRoll.add(targetZRoll.sub(prevZRoll).mul(kF));
        p.w.assign(newZRoll);

        a.x.assign(float(1));
        a.y.assign(newForce);
        a.z.assign(newZRoll);

        b.x.assign(bladeH);
        b.y.assign(yaw);
        b.z.assign(clumpShade);
        b.w.assign(mix(float(0.75), float(1.0), h1));

        c.x.assign(h4);
        c.y.assign(h5);
        c.z.assign(tN.x);
        c.w.assign(tN.z);
      });
    })().compute(this.count, [64]);

    // ── Material — tiny VS, Gemini-skin fragment, manual lighting ──
    // FrontSide like Gemini: back-face culling hides "opposing" bends so the
    // field reads coherent; the cross ribbon covers rear viewing angles.
    const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.FrontSide });
    mat.fog = true;
    this._assignNodes(mat, u, { bufPos, bufA, bufB, bufC, compactBuf });
    this.material = mat;

    this.mesh = new THREE.InstancedMesh(geom, mat, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);

    this._lastAnchor = new THREE.Vector3();
    this._anchorDelta = new THREE.Vector2();
    this._cameraMatrix = new THREE.Matrix4();
    this._initDone = false;
    this._enabled = false;
    this.group.visible = false;
  }

  _assignNodes(mat, u, { bufPos, bufA, bufB, bufC, compactBuf }) {
    const vData = varying(vec4(1, 1, 0, 0), "v_hg_data"); // clumpShade, shadeRand, h4, h5
    const vNormal = varying(vec3(0, 1, 0), "v_hg_n");
    const vWorld = varying(vec3(0), "v_hg_w");

    const rotY = (ang, v) => {
      const cc = cos(ang);
      const ss = sin(ang);
      return vec3(
        v.x.mul(cc).add(v.z.mul(ss)),
        v.y,
        negate(v.x).mul(ss).add(v.z.mul(cc)),
      );
    };

    mat.positionNode = Fn(() => {
      // Compacted draw: instanceIndex is a slot in the visible list — remap
      // to the real blade id. Culled blades are never vertex-shaded at all.
      const bladeIdx = compactBuf.element(instanceIndex);
      const p = bufPos.element(bladeIdx);
      const a = bufA.element(bladeIdx);
      const b = bufB.element(bladeIdx);
      const c = bufC.element(bladeIdx);

      const totalForce = a.y;
      const zRoll = a.z;
      const terrainY = a.w;
      const bladeH = b.x;
      const yaw = b.y;

      vData.assign(vec4(b.z, b.w, c.x, c.y));

      // Gemini bend: arc along local X, whole blade (incl. cross ribbon at
      // +90°) rotated by yaw. FrontSide culling makes the field read coherent.
      const isCross = attribute("aCross", "float");
      const crossedYaw = yaw.add(isCross.mul(Math.PI * 0.5));

      const h = uv().y;
      const curveWeight = pow(max(h, 1e-4), u.uBendFocus);
      const angle = totalForce.mul(curveWeight);
      const L = h.mul(bladeH);
      const arcX = sin(angle).mul(L);
      const arcY = cos(angle).mul(L);
      const arcZ = sin(zRoll).mul(L).mul(curveWeight).mul(0.2);

      // Per-frame sway (VS, always 60 fps): the compute pass supplies the
      // smoothed low-frequency gust field; this adds continuous high-frequency
      // motion between compute ticks — tip-weighted, world-space along wind
      // dir + perpendicular flutter.
      const phase = hash(bladeIdx).mul(PI2);
      const swayAmp = clamp(u.uWindStrength, float(0), float(2)).mul(0.5);
      const swayA = sin(time.mul(2.3).add(phase)).mul(0.06).mul(swayAmp);
      const flutterA = sin(time.mul(4.1).add(phase.mul(1.7)))
        .mul(0.025)
        .mul(swayAmp);
      const windPerp = vec2(negate(u.uWindDir.y), u.uWindDir.x);
      const hh = h.mul(h).mul(bladeH);
      const swayX = u.uWindDir.x.mul(swayA).add(windPerp.x.mul(flutterA)).mul(hh);
      const swayZ = u.uWindDir.y.mul(swayA).add(windPerp.y.mul(flutterA)).mul(hh);

      const pArc = vec3(
        arcX.add(positionLocal.x),
        arcY,
        arcZ.add(positionLocal.z),
      );
      const pRot = rotY(crossedYaw, pArc);
      const pYaw = vec3(pRot.x.add(swayX), pRot.y, pRot.z.add(swayZ));

      // Normal: flat blade normal fanned cylindrically, blended to terrain
      const spread = uv()
        .x.mul(2)
        .sub(1)
        .mul(u.uCylindrical)
        .mul(Math.PI * 0.5);
      const bladeN = rotY(crossedYaw.add(spread), vec3(0, 0, 1));
      const tNy = sqrt(
        max(float(0), float(1).sub(c.z.mul(c.z)).sub(c.w.mul(c.w))),
      );
      const terrainN = vec3(c.z, tNy, c.w);
      vNormal.assign(normalize(mix(bladeN, terrainN, u.uSkyBlend)));

      const outPos = vec3(
        pYaw.x.add(p.x),
        pYaw.y.add(terrainY),
        pYaw.z.add(p.y),
      );
      vWorld.assign(outPos.add(vec3(u.uAnchorPos.x, 0, u.uAnchorPos.z)));
      return outPos;
    })();

    mat.colorNode = Fn(() => {
      const clumpShade = vData.x;
      const shadeRand = vData.y;
      const h4 = vData.z;
      const h5 = vData.w;
      const hPct = uv().y;
      const N = normalize(vNormal);

      // ── Gemini color stack ──
      const ao = mix(u.uAoBase, float(1.0), pow(hPct, u.uAoPower));
      const baseCol = mix(u.uBladeCol, u.uTipCol, hPct);

      const warmCol = vec3(0.18, 0.28, 0.02);
      const coolCol = vec3(0.02, 0.18, 0.08);
      const tintTarget = mix(warmCol, coolCol, h4);
      const hueCol = mix(baseCol, tintTarget, u.uCvHueSpread);
      const lum = dot(hueCol, vec3(0.299, 0.587, 0.114));
      const satFactor = float(1.0).sub(h5.mul(u.uCvSatSpread));
      const satCol = mix(vec3(lum, lum, lum), hueCol, satFactor);
      const dryBlend = smoothstep(u.uCvDryAmount, float(0), h5).mul(
        float(1.0).sub(hPct).mul(0.5).add(0.5),
      );
      const dryCol = mix(satCol, u.uCvDryCol, dryBlend);
      const albedo = mix(baseCol, dryCol, u.uColorVar)
        .mul(clumpShade)
        .mul(shadeRand)
        .mul(ao);

      // ── Manual lighting: plain lambert sun + hemisphere ambient ──
      // (matches MeshStandardNodeMaterial's diffuse response so the hybrid
      // renders the same tones as Gemini under the same scene lights)
      const ndl = max(dot(N, u.uSunDir), float(0));
      const sunTerm = u.uSunCol.mul(ndl);
      const hemiT = N.y.mul(0.5).add(0.5);
      const ambient = mix(u.uGroundAmb, u.uSkyAmb, hemiT);

      // ── SSS: backscatter + rim (Gemini emissive, simplified) ──
      const viewDir = normalize(cameraPosition.sub(vWorld));
      const thickness = float(1).sub(hPct).mul(0.7).add(0.3);
      const backScat = max(dot(negate(u.uSunDir), N), float(0));
      const rim = float(1).sub(max(dot(N, viewDir), float(0)));
      const sss = clamp(
        pow(backScat, u.uBssPower)
          .mul(thickness)
          .add(pow(rim, float(3.0)).mul(thickness).mul(u.uRimSSS)),
        float(0),
        float(1),
      );
      const sssCol = u.uBssCol.mul(0.35).mul(sss).mul(u.uBssIntensity);

      return albedo.mul(sunTerm.add(ambient)).add(sssCol);
    })();
  }

  async init(camera) {
    await this.renderer.computeAsync(this.computeInit);
    // Prime the compact list so the first frame draws something sensible
    await this.renderer.computeAsync([this.computeReset, this.computeUpdate]);
    this._initDone = true;
    await this.renderer.compileAsync(this.mesh, camera);
  }

  setEnabled(on) {
    this._enabled = !!on;
    this.group.visible = this._enabled;
  }

  setSunDir(dir) {
    this.u.uSunDir.value.copy(dir);
  }

  update(anchorPos, camera) {
    if (!this._initDone || !this._enabled) return;
    const u = this.u;

    const dx = anchorPos.x - this._lastAnchor.x;
    const dz = anchorPos.z - this._lastAnchor.z;
    this._anchorDelta.set(dx, dz);
    u.uAnchorDeltaXZ.value.copy(this._anchorDelta);
    u.uAnchorPos.value.copy(anchorPos);
    u.uPlayerPos.value.copy(anchorPos);
    this.mesh.position.set(anchorPos.x, 0, anchorPos.z);
    this._lastAnchor.copy(anchorPos);

    this._cameraMatrix.multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    );
    u.uCameraMatrix.value.copy(this._cameraMatrix);
    const e = camera.projectionMatrix.elements;
    u.uFx.value = e[0];
    u.uFy.value = e[5];

    // Per-frame SYNCHRONOUS compute, queued ahead of this frame's render.
    // The old computeAsync + busy-flag pattern waited a full GPU round-trip
    // before allowing the next dispatch → effective 20–30 Hz wind = stepped
    // motion. Gemini is smooth because it evaluates wind every rendered
    // frame; dispatching synchronously gives the hybrid the same cadence
    // (~0.3 ms GPU for all rings — the architecture makes this affordable).
    this.renderer.compute([this.computeReset, this.computeUpdate]);
  }
}
