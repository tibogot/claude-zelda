/**
 * wind-fog-ribbons.js
 * Ghost Tsushima–style smoky wind ribbons (TSL fBm + animated trail geometry).
 * Ported from ghost-tsushima-ribbon-v2.html for reuse in the Ambient FX template.
 */
import * as THREE from "three/webgpu";
import {
  Fn,
  uv,
  vec2,
  float,
  mix,
  smoothstep,
  floor,
  fract,
  sin,
  dot,
  time,
  uniform,
} from "three/tsl";

const SAMPLES = 64;

export const WIND_FOG_RIBBON_DEFAULTS = {
  speedMult: 1.0,
  trailLenMult: 1.0,
  latAmp: 14.0,
  latAmp2: 6.0,
  latFreq: 0.38,
  latFreq2: 0.21,
  vertAmp: 0.7,
  vertFreq: 0.55,
  minClear: 0.38,
  useSharedWind: true,
  windAngle: -8,
  windSpeedCoupling: 1.0,
  widthMult: 1.0,
  tiltOffset: 0.0,
  spread: 1.0,
  row0: { baseY: 0.5, tiltBase: 0.3, count: 6 },
  row1: { baseY: 1.7, tiltBase: 0.48, count: 5 },
  row2: { baseY: 3.0, tiltBase: 0.63, count: 5 },
  row3: { baseY: 4.5, tiltBase: 0.75, count: 4 },
  baseColor: "#aacfff",
  hotColor: "#ffd0a0",
  densityMult: 1.0,
  warpMult: 1.0,
  shaderSpeedMult: 1.0,
};

const hash2 = Fn(([p]) =>
  vec2(
    fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)),
    fract(sin(dot(p, vec2(269.5, 183.3))).mul(43758.5453)),
  ),
);

const gradNoise = Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const u = f.mul(f).mul(float(3).sub(f.mul(2))).toVar();
  const g00 = hash2(i).mul(2).sub(1);
  const g10 = hash2(i.add(vec2(1, 0))).mul(2).sub(1);
  const g01 = hash2(i.add(vec2(0, 1))).mul(2).sub(1);
  const g11 = hash2(i.add(vec2(1, 1))).mul(2).sub(1);
  return mix(
    mix(dot(g00, f), dot(g10, f.sub(vec2(1, 0))), u.x),
    mix(dot(g01, f.sub(vec2(0, 1))), dot(g11, f.sub(vec2(1, 1))), u.x),
    u.y,
  )
    .mul(0.5)
    .add(0.5);
});

const fbm5 = Fn(([p]) => {
  let v = gradNoise(p).mul(0.54);
  v = v.add(gradNoise(p.mul(2.03)).mul(0.25));
  v = v.add(gradNoise(p.mul(4.17)).mul(0.12));
  v = v.add(gradNoise(p.mul(8.21)).mul(0.06));
  v = v.add(gradNoise(p.mul(16.4)).mul(0.03));
  return v;
});

function seededRng(seed) {
  let s = (seed * 9301 + 49297) | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = t + Math.imul(t ^ (t >>> 7), 61 | t) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createFogLineMaterial(seed, params) {
  const rng = seededRng((seed * 3579 + 19384) | 0);
  const baseShaderSpeed = 0.28 + rng() * 0.18;
  const baseDensity = 1.1 + rng() * 0.45;
  const baseWarp = 0.38 + rng() * 0.28;

  const uSpeed = uniform(baseShaderSpeed * params.shaderSpeedMult);
  const uWidthSoft = uniform(1.6 + rng() * 0.4);
  const uDensity = uniform(baseDensity * params.densityMult);
  const uStretchX = uniform(11 + rng() * 8);
  const uStretchY = uniform(2.0 + rng() * 1.0);
  const uWarp = uniform(baseWarp * params.warpMult);
  const uSeed = uniform(seed);
  const uBaseColor = uniform(new THREE.Color(params.baseColor));
  const uHotColor = uniform(new THREE.Color(params.hotColor));

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const st = uv();
  const t = time.mul(uSpeed);
  const p0 = vec2(
    st.x.mul(uStretchX).add(t.mul(1.3)).add(uSeed),
    st.y.sub(0.5).mul(uStretchY).sub(t.mul(0.15)),
  ).toVar();
  const warpX = fbm5(p0.mul(0.6).add(vec2(0.0, t.mul(0.45)))).sub(0.5);
  const warpY = fbm5(p0.mul(0.8).sub(vec2(t.mul(0.35), 0.0))).sub(0.5);
  const p = p0.add(vec2(warpX, warpY).mul(uWarp)).toVar();
  const n1 = fbm5(p).toVar();
  const n2 = fbm5(p.mul(2.5).add(vec2(t.mul(0.28), t.mul(-0.22)))).toVar();
  const n3 = fbm5(vec2(p.x.mul(0.35), p.y.mul(2.45).add(n1.mul(1.7)))).toVar();
  const center = float(1.0)
    .sub(st.y.sub(0.5).abs().mul(uWidthSoft))
    .saturate()
    .pow(1.4)
    .toVar();
  const tips = smoothstep(0.02, 0.14, st.x)
    .mul(smoothstep(0.02, 0.2, float(1.0).sub(st.x)))
    .toVar();
  const wisps = smoothstep(0.44, 0.9, n1.mul(0.8).add(n2.mul(0.72))).toVar();
  const filaments = float(1.0)
    .sub(n3.sub(0.5).abs().mul(2.0))
    .pow(2.1)
    .toVar();
  const alpha = center
    .mul(tips)
    .mul(wisps.mul(0.85).add(filaments.mul(0.52)))
    .mul(uDensity)
    .saturate()
    .toVar();
  const glowMask = smoothstep(0.72, 1.0, n2).mul(0.34);
  const col = mix(uBaseColor, uHotColor, glowMask.add(alpha.mul(0.3))).mul(
    alpha.mul(1.1).add(glowMask.mul(0.8)),
  );

  mat.colorNode = col;
  mat.opacityNode = alpha;

  return {
    mat,
    shaderBase: { baseShaderSpeed, baseDensity, baseWarp },
    shaderUniforms: { uSpeed, uDensity, uWarp, uBaseColor, uHotColor },
  };
}

/**
 * @param {object} options
 * @param {THREE.Scene} options.scene
 * @param {(x: number, z: number) => number} options.getTerrainHeight
 * @param {object} [options.params]
 */
export function createWindFogRibbons({
  scene,
  getTerrainHeight,
  params: userParams = {},
}) {
  const params = { ...WIND_FOG_RIBBON_DEFAULTS, ...userParams };
  for (const key of ["row0", "row1", "row2", "row3"]) {
    params[key] = { ...WIND_FOG_RIBBON_DEFAULTS[key], ...userParams[key] };
  }

  const bandGroup = new THREE.Group();
  scene.add(bandGroup);

  const ribbons = [];
  const scrPts = Array.from({ length: SAMPLES }, () => ({ x: 0, y: 0, z: 0 }));

  let wX = 1;
  let wZ = 0;
  let pX = 0;
  let pZ = -1;

  function applyWind(windX, windZ) {
    if (params.useSharedWind) {
      const len = Math.hypot(windX, windZ) || 1;
      wX = windX / len;
      wZ = windZ / len;
    } else {
      const a = (params.windAngle * Math.PI) / 180;
      wX = Math.cos(a);
      wZ = Math.sin(a);
    }
    pX = wZ;
    pZ = -wX;
  }

  applyWind(1, 0);

  function createRibbonData({
    cx,
    cz,
    baseY,
    baseTrailLen,
    baseWidth,
    baseTilt,
    baseSpeed,
    seed,
  }) {
    const rng = seededRng((seed * 1e5) | 0);
    const ra = rng();
    const rb = rng();
    const rc = rng();
    const rd = rng();
    const re = rng();

    const posArr = new Float32Array(SAMPLES * 2 * 3);
    const uvArr = new Float32Array(SAMPLES * 2 * 2);
    const idxArr = [];
    for (let i = 0; i < SAMPLES; i++) {
      const u = i / (SAMPLES - 1);
      uvArr.set([u, 0], i * 4);
      uvArr.set([u, 1], i * 4 + 2);
    }
    for (let i = 0; i < SAMPLES - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      idxArr.push(a, c, b, b, c, d);
    }

    const geo = new THREE.BufferGeometry();
    const posAttr = new THREE.BufferAttribute(posArr, 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", posAttr);
    geo.setAttribute("uv", new THREE.BufferAttribute(uvArr, 2));
    geo.setIndex(idxArr);

    const { mat, shaderBase, shaderUniforms } = createFogLineMaterial(
      seed,
      params,
    );
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 40;
    mesh.frustumCulled = false;

    return {
      cx,
      cz,
      baseY,
      baseTrailLen,
      baseWidth,
      baseTilt,
      baseSpeed,
      ra,
      rb,
      rc,
      rd,
      re,
      geo,
      mesh,
      shaderBase,
      shaderUniforms,
    };
  }

  function headAt(ribbon, t, out, windStrength) {
    const { cx, cz, baseY, baseSpeed, ra, rb, rc, rd, re } = ribbon;

    const speed =
      baseSpeed * params.speedMult * (0.35 + windStrength * params.windSpeedCoupling);
    const lat =
      Math.sin(params.latFreq * ra * t + 6.0 * rb) * params.latAmp * ra +
      Math.sin(params.latFreq2 * rc * t + 6.0 * rd) * params.latAmp2 * rc;
    const windAdv = speed * t;

    const x = cx + wX * windAdv + pX * lat;
    const z = cz + wZ * windAdv + pZ * lat;

    const vertBob =
      Math.sin(params.vertFreq * re * t + 6.0 * ra) * params.vertAmp * re;
    const ground = getTerrainHeight(x, z);
    const y = Math.max(ground + params.minClear, baseY + vertBob);

    out.x = x;
    out.y = y;
    out.z = z;
  }

  function updateRibbon(ribbon, elapsed, windStrength) {
    const { baseTrailLen, baseWidth, baseTilt, baseSpeed, geo } = ribbon;

    const speed =
      baseSpeed * params.speedMult * (0.35 + windStrength * params.windSpeedCoupling);
    const trailLen = baseTrailLen * params.trailLenMult;
    const timeStep = trailLen / (speed * SAMPLES);
    const width = baseWidth * params.widthMult;
    const tilt = Math.max(0, Math.min(1, baseTilt + params.tiltOffset));

    for (let i = 0; i < SAMPLES; i++) {
      headAt(ribbon, elapsed - i * timeStep, scrPts[i], windStrength);
    }

    const posArr = geo.attributes.position.array;
    for (let i = 0; i < SAMPLES; i++) {
      const p = scrPts[i];
      const prev = scrPts[Math.max(0, i - 1)];
      const next = scrPts[Math.min(SAMPLES - 1, i + 1)];

      let tx = next.x - prev.x;
      let ty = next.y - prev.y;
      let tz = next.z - prev.z;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;

      let hx = -tz;
      let hz = tx;
      const hl = Math.sqrt(hx * hx + hz * hz) || 1;
      hx /= hl;
      hz /= hl;

      let sx = hx * (1 - tilt);
      let sy = tilt;
      let sz = hz * (1 - tilt);
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      sx /= sl;
      sy /= sl;
      sz /= sl;

      const hw = width * 0.5;
      const vi = i * 6;
      posArr[vi] = p.x - sx * hw;
      posArr[vi + 1] = p.y - sy * hw;
      posArr[vi + 2] = p.z - sz * hw;
      posArr[vi + 3] = p.x + sx * hw;
      posArr[vi + 4] = p.y + sy * hw;
      posArr[vi + 5] = p.z + sz * hw;
    }

    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
  }

  function updateShaderUniforms() {
    const newBase = new THREE.Color(params.baseColor);
    const newHot = new THREE.Color(params.hotColor);
    for (const r of ribbons) {
      const sb = r.shaderBase;
      const su = r.shaderUniforms;
      su.uSpeed.value = sb.baseShaderSpeed * params.shaderSpeedMult;
      su.uDensity.value = sb.baseDensity * params.densityMult;
      su.uWarp.value = sb.baseWarp * params.warpMult;
      su.uBaseColor.value.copy(newBase);
      su.uHotColor.value.copy(newHot);
    }
  }

  function disposeRibbons() {
    for (const r of ribbons) {
      bandGroup.remove(r.mesh);
      r.geo.dispose();
      r.mesh.material.dispose();
    }
    ribbons.length = 0;
  }

  function buildRibbons(spreadRadius = 30) {
    disposeRibbons();

    const spread = params.spread * (spreadRadius / 30);
    const rowCfgs = [params.row0, params.row1, params.row2, params.row3];
    let idx = 0;

    rowCfgs.forEach((row, ri) => {
      for (let col = 0; col < row.count; col++) {
        const rng = seededRng(idx * 43 + 13);
        const cx =
          (col - (row.count - 1) * 0.5) * 7.0 * spread + (rng() - 0.5) * 2.0 * spread;
        const cz =
          (-3 - ri * 6.0 + (rng() - 0.5) * 2.0) * spread;
        const baseTilt = Math.max(
          0.05,
          Math.min(0.95, row.tiltBase + (rng() - 0.5) * 0.2),
        );
        const baseWidth = 1.1 + rng() * 1.0;
        const baseSpeed = 1.8 + rng() * 2.2;
        const baseTrailLen = 38 + rng() * 14;
        const seed = idx * 0.137 + 0.03;

        const data = createRibbonData({
          cx,
          cz,
          baseY: row.baseY,
          baseTrailLen,
          baseWidth,
          baseTilt,
          baseSpeed,
          seed,
        });
        ribbons.push(data);
        bandGroup.add(data.mesh);
        idx++;
      }
    });

    updateShaderUniforms();
  }

  buildRibbons();

  return {
    group: bandGroup,
    params,
    ribbons,

    update(elapsed, windX = 1, windZ = 0, windStrength = 1) {
      applyWind(windX, windZ);
      updateShaderUniforms();
      for (const r of ribbons) {
        updateRibbon(r, elapsed, windStrength);
      }
    },

    rebuild(spreadRadius = 30) {
      buildRibbons(spreadRadius);
    },

    dispose(sc) {
      disposeRibbons();
      sc.remove(bandGroup);
    },
  };
}

export default createWindFogRibbons;
