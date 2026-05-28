import * as THREE from "three";
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from "three";
import {
  Fn,
  float,
  uniform,
  vec2,
  vec3,
  vec4,
  mix,
  mx_noise_float,
  uv,
  positionLocal,
  positionWorld,
  normalLocal,
  floor,
  fract,
  sin,
  cos,
  dot,
  smoothstep,
  pow,
  max,
  min,
  length,
  abs,
  clamp,
  saturate,
  sub,
  add,
  mul,
  div,
  step,
} from "three/tsl";
import { PARAMS } from "./splatmap-chunks-params.js";
import { _wFbm2, _wVoroF1, _wVoroSmooth } from "./splatmap-chunks-w-tsl-noise.js";

// ── WATERFALL [ H ] — same as splatmap-painter10bvh+post.html ─────────────
const _wfGradientNoise = Fn(([p]) => {
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const uu = f
    .mul(f)
    .mul(f)
    .mul(f.mul(f.mul(6).sub(15)).add(10));
  const rg = Fn(([ip]) => {
    const a = fract(sin(dot(ip, vec2(127.1, 311.7))).mul(43758.5453)).mul(
      Math.PI * 2,
    );
    return vec2(cos(a), sin(a));
  });
  return mix(
    mix(
      dot(rg(i), f),
      dot(rg(i.add(vec2(1, 0))), f.sub(vec2(1, 0))),
      uu.x,
    ),
    mix(
      dot(rg(i.add(vec2(0, 1))), f.sub(vec2(0, 1))),
      dot(rg(i.add(vec2(1, 1))), f.sub(vec2(1, 1))),
      uu.x,
    ),
    uu.y,
  )
    .mul(0.5)
    .add(0.5);
});
const _wfVoroF1 = Fn(([p, jitter]) => {
  const ip = floor(p).toVar();
  const fp = fract(p).toVar();
  const md = float(10).toVar();
  for (const [nx, ny] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ]) {
    const off = vec2(float(nx), float(ny));
    const h = vec2(
      fract(sin(dot(ip.add(off), vec2(127.1, 311.7))).mul(43758.5453)),
      fract(sin(dot(ip.add(off), vec2(269.5, 183.3))).mul(43758.5453)),
    );
    md.assign(
      min(md, length(off.add(mix(vec2(0.5), h, jitter)).sub(fp))),
    );
  }
  return md;
});
const _wfVoroFbm = Fn(([p_in, jitter, octaves, lac, gain]) => {
  const p = p_in.toVar();
  const val = float(0).toVar();
  const amp = float(1).toVar();
  const total = float(0).toVar();
  val.addAssign(amp.mul(_wfVoroF1(p, jitter)));
  total.addAssign(amp);
  p.mulAssign(lac);
  amp.mulAssign(gain);
  const d2 = smoothstep(float(1), float(2), octaves);
  val.addAssign(amp.mul(_wfVoroF1(p, jitter)).mul(d2));
  total.addAssign(amp.mul(d2));
  p.mulAssign(lac);
  amp.mulAssign(gain);
  const d3 = smoothstep(float(2), float(3), octaves);
  val.addAssign(amp.mul(_wfVoroF1(p, jitter)).mul(d3));
  total.addAssign(amp.mul(d3));
  p.mulAssign(lac);
  amp.mulAssign(gain);
  const d4 = smoothstep(float(3), float(4), octaves);
  val.addAssign(amp.mul(_wfVoroF1(p, jitter)).mul(d4));
  total.addAssign(amp.mul(d4));
  return val.div(total);
});
const _wfBandMask = Fn(([y, low, high, n, noiseAmt, sharpness]) => {
  const nLow = low.add(n.sub(0.5).mul(noiseAmt.mul(2)));
  const nHigh = high.add(n.sub(0.5).mul(noiseAmt.mul(2)));
  return smoothstep(nLow.sub(sharpness), nLow.add(sharpness), y).mul(
    smoothstep(nHigh.add(sharpness), nHigh.sub(sharpness), y),
  );
});
const _wfVoroLayer = Fn(
  ([
    v,
    scaleX,
    scaleY,
    offX,
    offY,
    jitter,
    octaves,
    lac,
    gain,
    warpStr,
    warpScale,
    contrast,
  ]) => {
    const p = vec2(
      v.x.mul(scaleX).add(offX),
      v.y.mul(scaleY).add(offY),
    ).toVar();
    const wx = _wfGradientNoise(p.mul(warpScale)).sub(0.5);
    const wy = _wfGradientNoise(p.mul(warpScale).add(vec2(3.7, 8.3))).sub(
      0.5,
    );
    p.addAssign(vec2(wx, wy).mul(warpStr));
    return pow(_wfVoroFbm(p, jitter, octaves, lac, gain), contrast);
  },
);


const wfU = {
  darkColor: uniform(new THREE.Color("#00544c")),
  bodyColor: uniform(new THREE.Color("#38d0d0")),
  depthScaleX: uniform(2.0),
  depthScaleY: uniform(1.65),
  depthStrength: uniform(0.5),
  bodyBrightness: uniform(1.0),
  bodyContrast: uniform(1.0),
  cyan_enabled: uniform(1.0),
  cyan_bandLow: uniform(0.3),
  cyan_bandHigh: uniform(0.8),
  cyan_nScaleX: uniform(12.0),
  cyan_nScaleY: uniform(12.0),
  cyan_noiseAmt: uniform(0.3),
  cyan_bandSharp: uniform(0.02),
  cyan_color: uniform(new THREE.Color("#00fff4")),
  cyan_strength: uniform(0.1),
  cyan_flowSpeed: uniform(3.0),
  red_enabled: uniform(1.0),
  red_bandLow: uniform(0.35),
  red_bandHigh: uniform(0.93),
  red_nScaleX: uniform(6.0),
  red_nScaleY: uniform(3.0),
  red_noiseAmt: uniform(0.22),
  red_bandSharp: uniform(0.03),
  red_scaleX: uniform(7.0),
  red_scaleY: uniform(4.0),
  red_offsetX: uniform(0.0),
  red_offsetY: uniform(0.0),
  red_jitter: uniform(0.55),
  red_octaves: uniform(3.0),
  red_lac: uniform(2.35),
  red_gain: uniform(0.41),
  red_warpStr: uniform(0.83),
  red_warpScale: uniform(1.6),
  red_contrast: uniform(1.2),
  red_threshold: uniform(0.12),
  red_sharpness: uniform(0.02),
  red_color: uniform(new THREE.Color("#c8f0ee")),
  red_strength: uniform(0.3),
  green_enabled: uniform(1.0),
  green_bandLow: uniform(0.45),
  green_bandHigh: uniform(0.82),
  green_scaleX: uniform(7.0),
  green_scaleY: uniform(4.0),
  green_offsetX: uniform(0.0),
  green_offsetY: uniform(0.0),
  green_jitter: uniform(0.55),
  green_octaves: uniform(3.0),
  green_lac: uniform(2.35),
  green_gain: uniform(0.41),
  green_warpStr: uniform(0.83),
  green_warpScale: uniform(1.6),
  green_contrast: uniform(1.2),
  green_threshold: uniform(0.12),
  green_sharpness: uniform(0.02),
  green_color: uniform(new THREE.Color("#ffffff")),
  green_strength: uniform(1.0),
  drip_enabled: uniform(1.0),
  drip_bandLow: uniform(0.0),
  drip_bandHigh: uniform(1.0),
  drip_nScaleX: uniform(6.0),
  drip_nScaleY: uniform(2.0),
  drip_noiseAmt: uniform(0.08),
  drip_bandSharp: uniform(0.04),
  drip_scaleX: uniform(14.0),
  drip_scaleY: uniform(1.8),
  drip_offsetX: uniform(0.0),
  drip_offsetY: uniform(0.0),
  drip_jitter: uniform(1.0),
  drip_octaves: uniform(2.0),
  drip_lac: uniform(2.0),
  drip_gain: uniform(0.4),
  drip_warpStr: uniform(0.25),
  drip_warpScale: uniform(1.5),
  drip_contrast: uniform(4.0),
  drip_threshold: uniform(0.12),
  drip_sharpness: uniform(0.03),
  drip_color: uniform(new THREE.Color(0xffffff)),
  drip_strength: uniform(0.9),
  wfFlowTime: uniform(0.0),
  wfFlowSpeed: uniform(0.5),
};

const _buildWaterfallColorNode = () =>
  Fn(() => {
    const v = uv();
    const depthN = _wfGradientNoise(
      vec2(
        v.x.mul(wfU.depthScaleX),
        v.y.mul(wfU.depthScaleY).add(wfU.wfFlowTime.mul(float(0.5))),
      ),
    );
    const col = mix(
      wfU.darkColor,
      wfU.bodyColor,
      depthN.mul(wfU.depthStrength),
    ).toVar();
    col.assign(
      col
        .sub(0.5)
        .mul(wfU.bodyContrast)
        .add(0.5)
        .mul(wfU.bodyBrightness)
        .clamp(0, 1),
    );
    const cyanN = _wfGradientNoise(
      vec2(
        v.x.mul(wfU.cyan_nScaleX),
        v.y
          .mul(wfU.cyan_nScaleY)
          .add(wfU.wfFlowTime.mul(wfU.cyan_flowSpeed)),
      ),
    );
    const cyanBand = _wfBandMask(
      v.y,
      wfU.cyan_bandLow,
      wfU.cyan_bandHigh,
      cyanN,
      wfU.cyan_noiseAmt,
      wfU.cyan_bandSharp,
    );
    col.assign(
      mix(
        col,
        wfU.cyan_color,
        cyanBand.mul(wfU.cyan_strength).mul(wfU.cyan_enabled).clamp(0, 1),
      ),
    );
    const redCorner = smoothstep(wfU.red_bandLow, wfU.red_bandHigh, v.y)
      .mul(smoothstep(wfU.red_bandHigh, wfU.red_bandLow, v.y))
      .mul(4.0)
      .clamp(0, 1);
    const redDynThresh = mix(float(1.2), wfU.red_threshold, redCorner);
    const redF1 = _wfVoroLayer(
      v,
      wfU.red_scaleX,
      wfU.red_scaleY,
      wfU.red_offsetX,
      wfU.red_offsetY.add(wfU.wfFlowTime),
      wfU.red_jitter,
      wfU.red_octaves,
      wfU.red_lac,
      wfU.red_gain,
      wfU.red_warpStr,
      wfU.red_warpScale,
      wfU.red_contrast,
    );
    const redFoam = smoothstep(
      redDynThresh.sub(wfU.red_sharpness),
      redDynThresh.add(wfU.red_sharpness),
      redF1,
    );
    col.assign(
      mix(
        col,
        wfU.red_color,
        redFoam.mul(wfU.red_strength).mul(wfU.red_enabled).clamp(0, 1),
      ),
    );
    const greenCorner = smoothstep(
      wfU.green_bandLow,
      wfU.green_bandHigh,
      v.y,
    )
      .mul(smoothstep(wfU.green_bandHigh, wfU.green_bandLow, v.y))
      .mul(4.0)
      .clamp(0, 1);
    const greenDynThresh = mix(
      float(1.2),
      wfU.green_threshold,
      greenCorner,
    );
    const greenF1 = _wfVoroLayer(
      v,
      wfU.green_scaleX,
      wfU.green_scaleY,
      wfU.green_offsetX,
      wfU.green_offsetY.add(wfU.wfFlowTime),
      wfU.green_jitter,
      wfU.green_octaves,
      wfU.green_lac,
      wfU.green_gain,
      wfU.green_warpStr,
      wfU.green_warpScale,
      wfU.green_contrast,
    );
    const greenFoam = smoothstep(
      greenDynThresh.sub(wfU.green_sharpness),
      greenDynThresh.add(wfU.green_sharpness),
      greenF1,
    );
    col.assign(
      mix(
        col,
        wfU.green_color,
        greenFoam
          .mul(wfU.green_strength)
          .mul(wfU.green_enabled)
          .clamp(0, 1),
      ),
    );
    const dripN = _wfGradientNoise(
      vec2(v.x.mul(wfU.drip_nScaleX), v.y.mul(wfU.drip_nScaleY)),
    );
    const dripBand = _wfBandMask(
      v.y,
      wfU.drip_bandLow,
      wfU.drip_bandHigh,
      dripN,
      wfU.drip_noiseAmt,
      wfU.drip_bandSharp,
    );
    const dripF1 = _wfVoroLayer(
      v,
      wfU.drip_scaleX,
      wfU.drip_scaleY,
      wfU.drip_offsetX,
      wfU.drip_offsetY.add(wfU.wfFlowTime),
      wfU.drip_jitter,
      wfU.drip_octaves,
      wfU.drip_lac,
      wfU.drip_gain,
      wfU.drip_warpStr,
      wfU.drip_warpScale,
      wfU.drip_contrast,
    );
    const dripFoam = smoothstep(
      wfU.drip_threshold.sub(wfU.drip_sharpness),
      wfU.drip_threshold.add(wfU.drip_sharpness),
      dripF1,
    );
    col.assign(
      mix(
        col,
        wfU.drip_color,
        dripFoam
          .mul(dripBand)
          .mul(wfU.drip_strength)
          .mul(wfU.drip_enabled)
          .clamp(0, 1),
      ),
    );
    return col;
  })();

const WF_MESH = {
  width: 4,
  totalHeight: 8,
  topLength: 2.5,
  radius: 1.2,
  segments: 128,
};
function buildWaterfallGeo() {
  const { width, totalHeight, topLength, radius, segments } = WF_MESH;
  const geo = new THREE.PlaneGeometry(width, totalHeight, 1, segments);
  const pos = geo.attributes.position;
  const vv = new THREE.Vector3();
  const curveStart = totalHeight - topLength;
  const curveEnd = curveStart - radius;
  for (let i = 0; i < pos.count; i++) {
    vv.fromBufferAttribute(pos, i);
    let cy = vv.y + totalHeight / 2;
    if (cy >= curveStart) {
      vv.y = cy;
      vv.z = 0;
    } else if (cy > curveEnd) {
      const a = ((curveStart - cy) / radius) * (Math.PI / 2);
      vv.y = curveStart - Math.sin(a) * radius;
      vv.z = -(radius - Math.cos(a) * radius);
    } else {
      vv.y = curveStart - radius;
      vv.z = -radius - (curveEnd - cy);
    }
    pos.setXYZ(i, vv.x, vv.y, vv.z);
  }
  geo.computeVertexNormals();
  return geo;
}

const waterfallTemplateMat = new MeshStandardNodeMaterial({
  side: THREE.DoubleSide,
  roughness: 1.0,
  metalness: 0.0,
});
waterfallTemplateMat.colorNode = _buildWaterfallColorNode();
function _invalidateLakeCache() {
  rwiRefs._cachedLakeBodies = rwiRefs.waterObjects.filter(
    (m) => m.userData.waterStyle === "Lake",
  );
}
const impactFoamParams = {
  impactFoamVisible: true,
  impactFoamDispAmp: 0.62,
  impactFoamNoiseFreq: 2.35,
  impactFoamFlow: 1.35,
  impactFoamOpacity: 0.88,
  impactFoamRimCyan: 0.22,
  impactFoamCapAngle: 0.42,
  impactFoamBaseRadius: 3.35,
};

function buildImpactFoamGeometry(baseRadius, phiFrac) {
  const R = Math.max(0.35, baseRadius);
  const phi = Math.max(0.08, Math.min(0.48, phiFrac));
  return new THREE.SphereGeometry(
    R,
    72,
    52,
    0,
    Math.PI * 2,
    0,
    Math.PI * phi,
  );
}

const uIFTime = uniform(0);
const uIFDisp = uniform(impactFoamParams.impactFoamDispAmp);
const uIFNoiseFreq = uniform(impactFoamParams.impactFoamNoiseFreq);
const uIFFlow = uniform(impactFoamParams.impactFoamFlow);
const uIFOpacity = uniform(impactFoamParams.impactFoamOpacity);
const uIFRimCyan = uniform(impactFoamParams.impactFoamRimCyan);
const uIFRadius = uniform(impactFoamParams.impactFoamBaseRadius);
const uIFFoamWhite = uniform(new THREE.Color(0xf8fbff));
const uIFFoamCyan = uniform(new THREE.Color(0xa8e8f5));

const impactFoamPosNode = Fn(() => {
  const t = uIFTime;
  const xz = positionLocal.xz.mul(uIFNoiseFreq);
  const scroll = vec2(t.mul(uIFFlow), t.mul(uIFFlow.mul(0.74)));
  const n1 = mx_noise_float(xz.add(scroll));
  const n2 = mx_noise_float(
    xz.mul(2.12).sub(vec2(scroll.y, scroll.x.mul(0.9))),
  );
  const n3 = mx_noise_float(
    xz.mul(0.48).add(vec2(t.mul(-0.52), t.mul(0.61))),
  );
  const d = n1.mul(0.38).add(n2.mul(0.34)).add(n3.mul(0.28));
  return positionLocal.add(normalLocal.mul(d.mul(uIFDisp)));
})();

const impactFoamColorNode = Fn(() => {
  const t = uIFTime;
  const xz = positionLocal.xz.mul(uIFNoiseFreq.mul(0.88));
  const scroll = vec2(t.mul(uIFFlow.mul(0.92)), t.mul(uIFFlow.mul(0.58)));
  const f1 = mx_noise_float(xz.add(scroll)).mul(0.5).add(0.5);
  const f2 = mx_noise_float(xz.mul(2.95).sub(scroll)).mul(0.5).add(0.5);
  const rn = length(positionLocal.xz).div(max(uIFRadius, float(0.001)));
  const rim = smoothstep(float(0.22), float(0.98), rn);
  const base = mix(uIFFoamWhite, uIFFoamCyan, rim.mul(uIFRimCyan));
  return mix(
    base,
    uIFFoamWhite,
    f1.mul(0.32).add(f2.mul(0.2)),
  ).saturate();
})();

const impactFoamAlphaNode = Fn(() => {
  const t = uIFTime;
  const xz = positionLocal.xz.mul(uIFNoiseFreq.mul(1.05));
  const scroll = vec2(t.mul(uIFFlow.mul(1.05)), t.mul(0.5));
  const a1 = mx_noise_float(xz.add(scroll)).mul(0.5).add(0.5);
  const a2 = mx_noise_float(xz.mul(3.2).sub(vec2(t.mul(1.2), float(0))))
    .mul(0.5)
    .add(0.5);
  const rn = length(positionLocal.xz).div(max(uIFRadius, float(0.001)));
  const edgeFade = float(1).sub(smoothstep(float(0.78), float(1.05), rn));
  return uIFOpacity
    .mul(float(0.42).add(a1.mul(0.38)).add(a2.mul(0.2)))
    .mul(edgeFade.add(0.12));
})();

const impactFoamMat = new MeshBasicNodeMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
});
impactFoamMat.positionNode = impactFoamPosNode;
impactFoamMat.colorNode = impactFoamColorNode;
impactFoamMat.opacityNode = impactFoamAlphaNode;

const uRiverTime = uniform(0.0);
const uRiverFlowSpeed = uniform(PARAMS.river.flowSpeed);
const uRiverDeepColor = uniform(new THREE.Color(PARAMS.river.deepColor));
const uRiverShallowColor = uniform(
  new THREE.Color(PARAMS.river.shallowColor),
);
const uRiverHighlight = uniform(
  new THREE.Color(PARAMS.river.highlightColor),
);
const uRiverFoamColor = uniform(new THREE.Color(PARAMS.river.foamColor));
const uRiverFoamWidth = uniform(PARAMS.river.foamWidth);
const uRiverOpacity = uniform(PARAMS.river.opacity);

const rsU = {
  flowSpeed: uniform(0.05),
  darkColor: uniform(new THREE.Color(0x041820)),
  bodyColor: uniform(new THREE.Color(0x30989f)),
  depthScaleU: uniform(1.5),
  depthScaleV: uniform(0.8),
  depthStrength: uniform(0.55),
  bodyBright: uniform(1.0),
  bodyContrast: uniform(1.0),
  streakEnabled: uniform(1.0),
  streakScaleV: uniform(12.0),
  streakScaleU: uniform(8.0),
  streakWarpStr: uniform(0.25),
  streakWarpSc: uniform(1.5),
  streakContrast: uniform(4.0),
  streakThresh: uniform(0.12),
  streakSharp: uniform(0.03),
  streakColor: uniform(new THREE.Color(0xffffff)),
  streakStr: uniform(0.9),
  foamAEnabled: uniform(1.0),
  foamBEnabled: uniform(1.0),
  foamWidth: uniform(0.18),
  foamScaleV: uniform(10.0),
  foamScaleU: uniform(6.0),
  foamJitter: uniform(0.9),
  foamOctaves: uniform(3.0),
  foamLac: uniform(2.35),
  foamGain: uniform(0.41),
  foamWarpStr: uniform(1.2),
  foamWarpSc: uniform(1.6),
  foamContrast: uniform(2.5),
  foamThresh: uniform(0.12),
  foamSharp: uniform(0.02),
  foamAColor: uniform(new THREE.Color("#ffffff")),
  foamAStr: uniform(0.5),
  foamBColor: uniform(new THREE.Color("#ffffff")),
  foamBStr: uniform(0.8),
  shimEnabled: uniform(1.0),
  shimNScV: uniform(12.0),
  shimNScU: uniform(12.0),
  shimNoiseAmt: uniform(0.3),
  shimSharp: uniform(0.02),
  shimColor: uniform(new THREE.Color("#00fff4")),
  shimStr: uniform(0.08),
  shimFlowSpd: uniform(1.5),
  opacity: uniform(0.92),
};

const buildRiverFrag = Fn(() => {
  const uvCoord = uv();
  const flowU = uvCoord.x.sub(uRiverTime.mul(uRiverFlowSpeed));
  const animUV = vec2(flowU, uvCoord.y);
  const wave1 = _wFbm2(animUV.mul(6.0));
  const wave2 = _wFbm2(animUV.mul(3.0).add(vec2(1.7, 3.1)));
  const wave = wave1.mul(0.6).add(wave2.mul(0.4));
  const centerDist = abs(uvCoord.y.sub(0.5)).mul(2.0);
  const depthColor = mix(
    uRiverDeepColor,
    uRiverShallowColor,
    pow(centerDist, float(0.6)),
  );
  const shimmer = wave.sub(0.5).mul(0.18);
  const surfaceColor = mix(
    depthColor,
    uRiverHighlight,
    clamp(shimmer.add(0.5), float(0), float(1)),
  );
  const leftFoam = smoothstep(uRiverFoamWidth, float(0), uvCoord.y);
  const rightFoam = smoothstep(
    float(1).sub(uRiverFoamWidth),
    float(1),
    uvCoord.y,
  );
  const bankFoam = max(leftFoam, rightFoam);
  const finalColor = mix(
    surfaceColor,
    uRiverFoamColor,
    bankFoam.mul(0.85),
  );
  return vec4(finalColor, uRiverOpacity);
});

const buildRiverStylizedFrag = Fn(() => {
  const uvCoord = uv();
  const fUV = vec2(
    uvCoord.y,
    uvCoord.x.sub(uRiverTime.mul(rsU.flowSpeed)),
  );
  const depthN = _wfGradientNoise(
    vec2(fUV.x.mul(rsU.depthScaleV), fUV.y.mul(rsU.depthScaleU)),
  );
  const col = mix(
    rsU.darkColor,
    rsU.bodyColor,
    depthN.mul(rsU.depthStrength),
  ).toVar();
  col.assign(
    col
      .sub(0.5)
      .mul(rsU.bodyContrast)
      .add(0.5)
      .mul(rsU.bodyBright)
      .clamp(0, 1),
  );
  const shimN = _wfGradientNoise(
    vec2(
      fUV.x.mul(rsU.shimNScV),
      fUV.y.mul(rsU.shimNScU).add(uRiverTime.mul(rsU.shimFlowSpd)),
    ),
  );
  const shimBand = _wfBandMask(
    uvCoord.y,
    float(0.2),
    float(0.8),
    shimN,
    rsU.shimNoiseAmt,
    rsU.shimSharp,
  );
  col.assign(
    mix(
      col,
      rsU.shimColor,
      shimBand.mul(rsU.shimStr).mul(rsU.shimEnabled).clamp(0, 1),
    ),
  );
  const foamAMask = smoothstep(rsU.foamWidth, float(0), uvCoord.y).clamp(
    0,
    1,
  );
  const foamADynThresh = mix(float(1.2), rsU.foamThresh, foamAMask);
  const foamAF1 = _wfVoroLayer(
    fUV,
    rsU.foamScaleV,
    rsU.foamScaleU,
    float(0),
    float(0),
    rsU.foamJitter,
    rsU.foamOctaves,
    rsU.foamLac,
    rsU.foamGain,
    rsU.foamWarpStr,
    rsU.foamWarpSc,
    rsU.foamContrast,
  );
  const foamA = smoothstep(
    foamADynThresh.sub(rsU.foamSharp),
    foamADynThresh.add(rsU.foamSharp),
    foamAF1,
  );
  col.assign(
    mix(
      col,
      rsU.foamAColor,
      foamA.mul(rsU.foamAStr).mul(rsU.foamAEnabled).clamp(0, 1),
    ),
  );
  const foamBMask = smoothstep(
    float(1).sub(rsU.foamWidth),
    float(1),
    uvCoord.y,
  ).clamp(0, 1);
  const foamBDynThresh = mix(float(1.2), rsU.foamThresh, foamBMask);
  const foamBF1 = _wfVoroLayer(
    fUV,
    rsU.foamScaleV,
    rsU.foamScaleU,
    float(5.3),
    float(2.7),
    rsU.foamJitter,
    rsU.foamOctaves,
    rsU.foamLac,
    rsU.foamGain,
    rsU.foamWarpStr,
    rsU.foamWarpSc,
    rsU.foamContrast,
  );
  const foamB = smoothstep(
    foamBDynThresh.sub(rsU.foamSharp),
    foamBDynThresh.add(rsU.foamSharp),
    foamBF1,
  );
  col.assign(
    mix(
      col,
      rsU.foamBColor,
      foamB.mul(rsU.foamBStr).mul(rsU.foamBEnabled).clamp(0, 1),
    ),
  );
  const sUV = vec2(
    fUV.x.mul(rsU.streakScaleV),
    fUV.y.mul(rsU.streakScaleU),
  ).toVar();
  const sWarpT = uRiverTime.mul(rsU.flowSpeed).mul(float(0.4));
  const sWx = _wfGradientNoise(
    vec2(
      sUV.x.mul(rsU.streakWarpSc),
      sUV.y.mul(rsU.streakWarpSc).add(sWarpT),
    ),
  ).sub(0.5);
  const sWy = _wfGradientNoise(
    vec2(
      sUV.x.mul(rsU.streakWarpSc).add(float(3.7)),
      sUV.y.mul(rsU.streakWarpSc).add(float(8.3)).add(sWarpT),
    ),
  ).sub(0.5);
  sUV.addAssign(vec2(sWx, sWy).mul(rsU.streakWarpStr));
  const streakRaw = pow(
    _wfVoroFbm(sUV, float(1), float(2), float(2), float(0.4)),
    rsU.streakContrast,
  );
  const streak = smoothstep(
    rsU.streakThresh.sub(rsU.streakSharp),
    rsU.streakThresh.add(rsU.streakSharp),
    streakRaw,
  );
  col.assign(
    mix(
      col,
      rsU.streakColor,
      streak.mul(rsU.streakStr).mul(rsU.streakEnabled).clamp(0, 1),
    ),
  );
  return vec4(col, rsU.opacity);
});

const riverMat = new MeshBasicNodeMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
});
{
  const f = buildRiverFrag();
  riverMat.colorNode = f.rgb;
  riverMat.opacityNode = f.a;
}

function syncRiverMat() {
  uRiverFlowSpeed.value = PARAMS.river.flowSpeed;
  uRiverDeepColor.value.set(PARAMS.river.deepColor);
  uRiverShallowColor.value.set(PARAMS.river.shallowColor);
  uRiverHighlight.value.set(PARAMS.river.highlightColor);
  uRiverFoamColor.value.set(PARAMS.river.foamColor);
  uRiverFoamWidth.value = PARAMS.river.foamWidth;
  uRiverOpacity.value = PARAMS.river.opacity;
}

function applyRiverStyle(style) {
  const f =
    style === "Stylized" ? buildRiverStylizedFrag() : buildRiverFrag();
  riverMat.colorNode = f.rgb;
  riverMat.opacityNode = f.a;
  riverMat.needsUpdate = true;
}


let _ifSnap = "";
function syncImpactFoamUniforms() {
  const p = impactFoamParams;
  const snap = `${p.impactFoamDispAmp},${p.impactFoamNoiseFreq},${p.impactFoamFlow},${p.impactFoamOpacity},${p.impactFoamRimCyan},${p.impactFoamBaseRadius}`;
  if (snap === _ifSnap) return;
  _ifSnap = snap;
  uIFDisp.value = p.impactFoamDispAmp;
  uIFNoiseFreq.value = p.impactFoamNoiseFreq;
  uIFFlow.value = p.impactFoamFlow;
  uIFOpacity.value = p.impactFoamOpacity;
  uIFRimCyan.value = p.impactFoamRimCyan;
  uIFRadius.value = p.impactFoamBaseRadius;
}

function applyImpactFoamVisibility() {
  rwiRefs.splashCapObjects.forEach((m) => {
    m.visible = impactFoamParams.impactFoamVisible;
  });
  if (rwiRefs.selectedSplashCap && !impactFoamParams.impactFoamVisible) {
    _rt.transformControls.detach();
    _rt.tcHelper.visible = false;
    if (!_rt.getPlayMode()) _rt.controls.enabled = true;
  } else if (
    rwiRefs.selectedSplashCap &&
    impactFoamParams.impactFoamVisible &&
    _rt.getEditState().mode === "waterfall"
  ) {
    _rt.transformControls.enabled = true;
    _rt.tcHelper.visible = true;
    _rt.transformControls.attach(rwiRefs.selectedSplashCap);
  }
}

function rebuildAllImpactFoamGeometry() {
  rwiRefs.splashCapObjects.forEach((m) => {
    const old = m.geometry;
    m.geometry = buildImpactFoamGeometry(
      impactFoamParams.impactFoamBaseRadius,
      impactFoamParams.impactFoamCapAngle,
    );
    old.dispose();
  });
  uIFRadius.value = impactFoamParams.impactFoamBaseRadius;
}

function selectWaterfall(mesh) {
  rwiRefs.selectedSplashCap = null;
  rwiRefs.selectedWaterfall = mesh;
  if (mesh) {
    _rt.transformControls.enabled = true;
    _rt.tcHelper.visible = true;
    _rt.transformControls.attach(mesh);
  } else {
    _rt.tcHelper.visible = false;
    _rt.transformControls.detach();
  }
}

function selectSplashCap(mesh) {
  rwiRefs.selectedWaterfall = null;
  rwiRefs.selectedSplashCap = mesh;
  if (mesh) {
    _rt.transformControls.enabled = true;
    _rt.tcHelper.visible = true;
    _rt.transformControls.attach(mesh);
  } else {
    _rt.tcHelper.visible = false;
    _rt.transformControls.detach();
  }
}

function placeWaterfall(wx, wy, wz) {
  const mesh = new THREE.Mesh(
    buildWaterfallGeo(),
    waterfallTemplateMat.clone(),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(wx, wy, wz);
  mesh.renderOrder = 2;
  _rt.scene.add(mesh);
  rwiRefs.waterfallObjects.push(mesh);
  selectWaterfall(mesh);
}

function applyWaterfalls(data) {
  rwiRefs.waterfallObjects.forEach((m) => _rt.scene.remove(m));
  rwiRefs.waterfallObjects = [];
  selectWaterfall(null);
  data.forEach((d) => {
    const mesh = new THREE.Mesh(
      buildWaterfallGeo(),
      waterfallTemplateMat.clone(),
    );
    mesh.position.set(d.x, d.y, d.z);
    mesh.rotation.set(d.rx, d.ry, d.rz);
    mesh.scale.set(d.sx, d.sy, d.sz);
    mesh.renderOrder = 2;
    _rt.scene.add(mesh);
    rwiRefs.waterfallObjects.push(mesh);
  });
}

function saveWaterfalls() {
  const data = rwiRefs.waterfallObjects.map((m) => ({
    x: m.position.x,
    y: m.position.y,
    z: m.position.z,
    rx: m.rotation.x,
    ry: m.rotation.y,
    rz: m.rotation.z,
    sx: m.scale.x,
    sy: m.scale.y,
    sz: m.scale.z,
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "waterfalls.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function placeSplashCap(wx, wy, wz) {
  const mesh = new THREE.Mesh(
    buildImpactFoamGeometry(
      impactFoamParams.impactFoamBaseRadius,
      impactFoamParams.impactFoamCapAngle,
    ),
    impactFoamMat,
  );
  mesh.name = "SplashCap";
  mesh.userData.isSplashCap = true;
  mesh.rotation.x = 0;
  mesh.position.set(wx, wy, wz);
  mesh.scale.set(1, 1, 1);
  mesh.visible = impactFoamParams.impactFoamVisible;
  mesh.renderOrder = 4;
  _rt.scene.add(mesh);
  rwiRefs.splashCapObjects.push(mesh);
  selectSplashCap(mesh);
}

function applySplashCaps(data) {
  rwiRefs.splashCapObjects.forEach((m) => {
    _rt.scene.remove(m);
    m.geometry.dispose();
  });
  rwiRefs.splashCapObjects = [];
  selectSplashCap(null);
  data.forEach((d) => {
    const mesh = new THREE.Mesh(
      buildImpactFoamGeometry(
        impactFoamParams.impactFoamBaseRadius,
        impactFoamParams.impactFoamCapAngle,
      ),
      impactFoamMat,
    );
    mesh.name = "SplashCap";
    mesh.userData.isSplashCap = true;
    mesh.position.set(d.x, d.y, d.z);
    mesh.rotation.set(d.rx, d.ry, d.rz);
    mesh.scale.set(d.sx, d.sy, d.sz);
    mesh.visible = impactFoamParams.impactFoamVisible;
    mesh.renderOrder = 4;
    _rt.scene.add(mesh);
    rwiRefs.splashCapObjects.push(mesh);
  });
}

function saveSplashCaps() {
  const data = rwiRefs.splashCapObjects.map((m) => ({
    x: m.position.x,
    y: m.position.y,
    z: m.position.z,
    rx: m.rotation.x,
    ry: m.rotation.y,
    rz: m.rotation.z,
    sx: m.scale.x,
    sy: m.scale.y,
    sz: m.scale.z,
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "splash-caps.json";
  a.click();
  URL.revokeObjectURL(a.href);
}



export const wfPlaceTool = { tool: "waterfall" };

export const rwiRefs = {
  waterfallObjects: [],
  selectedWaterfall: null,
  splashCapObjects: [],
  selectedSplashCap: null,
  waterObjects: [],
  _cachedLakeBodies: [],
  selectedWater: null,
};

const _rt = {
  scene: null,
  transformControls: null,
  tcHelper: null,
  controls: null,
  getPlayMode: () => false,
  getEditState: () => ({ mode: "view" }),
};

export function bindRiverWaterfallImpactRuntime(api) {
  Object.assign(_rt, api);
}


export {
  wfU,
  impactFoamParams,
  rsU,
  riverMat,
  waterfallTemplateMat,
  impactFoamMat,
  uRiverTime,
  uIFTime,
  buildWaterfallGeo,
  buildImpactFoamGeometry,
  syncRiverMat,
  applyRiverStyle,
  syncImpactFoamUniforms,
  applyImpactFoamVisibility,
  rebuildAllImpactFoamGeometry,
  selectWaterfall,
  selectSplashCap,
  placeWaterfall,
  applyWaterfalls,
  saveWaterfalls,
  placeSplashCap,
  applySplashCaps,
  saveSplashCaps,
  _invalidateLakeCache,
};
