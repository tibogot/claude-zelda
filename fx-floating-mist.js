/**
 * fx-floating-mist.js
 * Traveling smoke wisps — independent puff billboards drifting along +X,
 * each with its own lifecycle fade. Irregular noise shape, not a flat band.
 */

import * as THREE from "three/webgpu";
import { MeshBasicNodeMaterial } from "three";
import {
  Fn,
  attribute,
  cameraFar,
  cameraNear,
  dot,
  float,
  floor,
  fract,
  length,
  mix,
  oneMinus,
  perspectiveDepthToViewZ,
  positionView,
  positionWorld,
  pow,
  sin,
  smoothstep,
  saturate,
  time,
  uniform,
  uv,
  vec2,
  viewportDepthTexture,
} from "three/tsl";

const MAX_PUFFS = 32;

export const FLOATING_MIST_DEFAULTS = {
  enabled: true,
  seed: 0xf10a7,

  spawnX: -30,
  spawnZ: 12,
  heightAboveGround: 4.5,

  puffCount: 20,
  puffSize: 3.8,
  spreadX: 1.8,
  spreadY: 2.8,
  spreadZ: 6,

  travelDistance: 55,
  travelSpeed: 0.055,
  travelDir: 1,
  bobAmp: 0.12,
  bobSpeed: 0.35,
  fadeIn: 0.04,
  fadeOut: 0.62,

  playerFadeNear: 4,
  playerFadeFar: 14,
  cameraFadeFar: 80,

  opacity: 0.62,
  noiseScale: 3.1,
  shaderSpeedMult: 0.85,
  densityMult: 1.05,
  warpMult: 1.15,
  wispThreshold: 0.38,

  baseColor: "#c8d4e0",
  hotColor: "#fff4e8",
  softParticles: true,
  softFadeDist: 1.4,
  renderOrder: 6,
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

export function createFloatingMistFX(scene, shared, getTerrainHeight) {
  const params = { ...FLOATING_MIST_DEFAULTS };

  const geometry = new THREE.PlaneGeometry(1, 1);
  const opacityArr = new Float32Array(MAX_PUFFS);
  const seedArr = new Float32Array(MAX_PUFFS);
  geometry.setAttribute(
    "mistOpacity",
    new THREE.InstancedBufferAttribute(opacityArr, 1),
  );
  geometry.setAttribute(
    "mistSeed",
    new THREE.InstancedBufferAttribute(seedArr, 1),
  );

  const uBaseColor = uniform(new THREE.Color(params.baseColor));
  const uHotColor = uniform(new THREE.Color(params.hotColor));
  const uMasterOpacity = uniform(params.opacity);
  const uNoiseScale = uniform(params.noiseScale);
  const uShaderSpeed = uniform(params.shaderSpeedMult);
  const uDensity = uniform(params.densityMult);
  const uWarp = uniform(params.warpMult);
  const uWispThreshold = uniform(params.wispThreshold);
  const uPlayerPos = uniform(new THREE.Vector3());
  const uPlayerFadeNear = uniform(params.playerFadeNear);
  const uPlayerFadeFar = uniform(params.playerFadeFar);
  const uSoftEnabled = uniform(params.softParticles ? 1.0 : 0.0);
  const uSoftFadeDist = uniform(Math.max(0.01, params.softFadeDist));

  const opacityAttr = attribute("mistOpacity");
  const seedAttr = attribute("mistSeed");

  const st = uv();
  const centered = st.sub(vec2(0.5, 0.5));
  const t = time.mul(uShaderSpeed);
  const seedOff = seedAttr.mul(19.17);

  const p0 = vec2(
    st.x.mul(3.2).add(t.mul(0.55)).add(seedOff),
    st.y.mul(2.4).add(t.mul(0.12)).add(seedOff.mul(0.37)),
  ).toVar();
  const warpX = fbm5(p0.mul(0.55).add(vec2(0.0, t.mul(0.28)))).sub(0.5);
  const warpY = fbm5(p0.mul(0.7).sub(vec2(t.mul(0.18), 0.0))).sub(0.5);
  const p = p0.add(vec2(warpX, warpY).mul(uWarp.mul(0.65))).toVar();

  const n1 = fbm5(p.mul(uNoiseScale)).toVar();
  const n2 = fbm5(p.mul(2.35).add(vec2(t.mul(0.15), t.mul(-0.11)))).toVar();
  const n3 = fbm5(p.mul(5.8).add(vec2(t.mul(-0.22), t.mul(0.08)))).toVar();

  const edgeX = smoothstep(0.0, 0.18, st.x).mul(oneMinus(smoothstep(0.82, 1.0, st.x)));
  const edgeY = smoothstep(0.0, 0.14, st.y).mul(oneMinus(smoothstep(0.86, 1.0, st.y)));
  const edgeFade = edgeX.mul(edgeY);

  const riseBias = smoothstep(0.92, 0.15, st.y);
  const billow = smoothstep(uWispThreshold, float(0.78), n1.mul(0.72).add(n2.mul(0.55)));
  const filaments = pow(saturate(n3.sub(0.42).mul(2.8)), float(2.4)).mul(0.55);
  const breakup = smoothstep(0.48, 0.72, n2.sub(n3.mul(0.35)));

  const r = length(centered);
  const edgeNoise = fbm5(p.mul(1.8).add(vec2(seedOff.mul(0.2), 0.0))).sub(0.5);
  const noisyEdge = smoothstep(
    float(0.52).add(edgeNoise.mul(0.18)),
    float(0.08),
    r,
  );

  const smokeAlpha = billow
    .mul(breakup.mul(0.75).add(filaments).add(0.22))
    .mul(riseBias)
    .mul(edgeFade)
    .mul(noisyEdge)
    .mul(uDensity)
    .saturate();

  const toPlayer = vec2(
    positionWorld.x.sub(uPlayerPos.x),
    positionWorld.z.sub(uPlayerPos.z),
  );
  const playerFade = smoothstep(
    uPlayerFadeNear,
    uPlayerFadeFar,
    length(toPlayer),
  );

  const sceneViewZ = perspectiveDepthToViewZ(
    viewportDepthTexture(),
    cameraNear,
    cameraFar,
  );
  const depthDelta = positionView.z.sub(sceneViewZ);
  const softFactor = mix(
    float(1.0),
    saturate(depthDelta.div(uSoftFadeDist)),
    uSoftEnabled,
  );

  const glow = smoothstep(0.58, 0.95, n2).mul(0.18);
  const rgb = mix(uBaseColor, uHotColor, glow.add(smokeAlpha.mul(0.15)));

  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.colorNode = rgb;
  mat.opacityNode = smokeAlpha
    .mul(opacityAttr)
    .mul(uMasterOpacity)
    .mul(playerFade)
    .mul(softFactor);

  const mesh = new THREE.InstancedMesh(geometry, mat, MAX_PUFFS);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = params.renderOrder;
  scene.add(mesh);

  const puffs = [];
  const visible = new Array(MAX_PUFFS);
  for (let i = 0; i < MAX_PUFFS; i++) {
    visible[i] = {
      x: 0,
      y: 0,
      z: 0,
      sx: 1,
      sy: 1,
      dist: 0,
      alpha: 1,
      seed: 0,
    };
  }
  const sortIdx = new Array(MAX_PUFFS);
  for (let i = 0; i < MAX_PUFFS; i++) sortIdx[i] = i;

  const _dummy = new THREE.Object3D();
  const _qYBill = new THREE.Quaternion();
  const _yAxis = new THREE.Vector3(0, 1, 0);
  const _sortCmp = (a, b) => visible[b].dist - visible[a].dist;

  let camera = null;
  let playerPos = null;
  let controls = null;
  const phase = (params.seed % 997) / 997;

  function terrainY(x, z) {
    return getTerrainHeight(x, z) + (shared.groundY ?? 0);
  }

  function rebuildPuffs() {
    puffs.length = 0;
    const rand = mulberry32(params.seed >>> 0);
    const n = Math.max(1, Math.min(MAX_PUFFS, Math.round(params.puffCount)));
    for (let i = 0; i < n; i++) {
      puffs.push({
        phase: rand(),
        ox: (rand() - 0.5) * 2 * params.spreadX,
        oy: (rand() - 0.5) * 2 * params.spreadY,
        oz: (rand() - 0.5) * 2 * params.spreadZ,
        scaleMul: 0.5 + rand() * 0.95,
        aspectY: 0.85 + rand() * 1.35,
        seed: rand() * 100,
        alphaMul: 0.35 + rand() * 0.65,
        bobPhase: rand() * Math.PI * 2,
      });
    }
  }

  rebuildPuffs();

  function syncUniforms() {
    uBaseColor.value.set(params.baseColor);
    uHotColor.value.set(params.hotColor);
    uMasterOpacity.value = params.opacity;
    uNoiseScale.value = params.noiseScale;
    uShaderSpeed.value = params.shaderSpeedMult;
    uDensity.value = params.densityMult;
    uWarp.value = params.warpMult;
    uWispThreshold.value = params.wispThreshold;
    uPlayerFadeNear.value = params.playerFadeNear;
    uPlayerFadeFar.value = Math.max(
      params.playerFadeNear + 1,
      params.playerFadeFar,
    );
    uSoftEnabled.value = params.softParticles ? 1.0 : 0.0;
    uSoftFadeDist.value = Math.max(0.01, params.softFadeDist);
    mesh.renderOrder = params.renderOrder;
  }

  syncUniforms();

  function puffFade(cycle) {
    const inF = Math.min(1, Math.max(0, cycle / params.fadeIn));
    const outF =
      cycle <= params.fadeOut
        ? 1
        : Math.max(0, 1 - (cycle - params.fadeOut) / (1 - params.fadeOut));
    return inF * outF;
  }

  function update(_dt, elapsed, sh) {
    if (!params.enabled || !camera) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    syncUniforms();

    if (playerPos) uPlayerPos.value.copy(playerPos);

    const dens = sh.density ?? 1;
    const speed = params.travelSpeed * dens;
    const dir = Math.sign(params.travelDir || 1);

    const camPos = camera.position;
    const fadeFar = Math.max(10, params.cameraFadeFar);
    const fadeFarStart = fadeFar * 0.78;

    let vCount = 0;

    for (let i = 0; i < puffs.length; i++) {
      const puff = puffs[i];
      const cycle = ((elapsed * speed + phase + puff.phase) % 1 + 1) % 1;
      const fade = puffFade(cycle);
      if (fade < 0.015) continue;

      const travel = cycle * params.travelDistance * dir;
      const px = params.spawnX + travel + puff.ox * dir;
      const pz = params.spawnZ + puff.oz;
      const ground = terrainY(px, pz);
      const bob =
        Math.sin(elapsed * params.bobSpeed + puff.bobPhase) * params.bobAmp;
      const py = ground + params.heightAboveGround + puff.oy + bob;

      const dx = px - camPos.x;
      const dy = py - camPos.y;
      const dz = pz - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > fadeFar) continue;

      let alpha = fade * puff.alphaMul;
      if (dist > fadeFarStart) {
        alpha *= 1 - (dist - fadeFarStart) / (fadeFar - fadeFarStart);
      }

      const v = visible[vCount];
      v.x = px;
      v.y = py;
      v.z = pz;
      const s = params.puffSize * puff.scaleMul;
      v.sx = s;
      v.sy = s * puff.aspectY;
      v.dist = dist;
      v.alpha = alpha;
      v.seed = puff.seed;
      vCount++;
      if (vCount >= MAX_PUFFS) break;
    }

    if (vCount === 0) {
      mesh.count = 0;
      return;
    }

    for (let i = 0; i < vCount; i++) sortIdx[i] = i;
    sortIdx.length = vCount;
    if (vCount > 1) sortIdx.sort(_sortCmp);
    sortIdx.length = MAX_PUFFS;

    for (let i = 0; i < vCount; i++) {
      const v = visible[sortIdx[i]];
      _dummy.position.set(v.x, v.y, v.z);
      const yawToCam = Math.atan2(camPos.x - v.x, camPos.z - v.z);
      _qYBill.setFromAxisAngle(_yAxis, yawToCam);
      _dummy.quaternion.copy(_qYBill);
      _dummy.scale.set(v.sx, v.sy, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      opacityArr[i] = v.alpha;
      seedArr[i] = v.seed;
    }

    mesh.count = vCount;
    mesh.instanceMatrix.needsUpdate = true;
    geometry.attributes.mistOpacity.needsUpdate = true;
    geometry.attributes.mistSeed.needsUpdate = true;
  }

  function setView(cam, ctrl) {
    camera = cam;
    controls = ctrl;
  }

  function snapSpawnToTarget() {
    if (!controls) return;
    params.spawnX = controls.target.x - params.travelDistance * 0.4 * Math.sign(params.travelDir || 1);
    params.spawnZ = controls.target.z;
  }

  function dispose(sc) {
    sc.remove(mesh);
    geometry.dispose();
    mat.dispose();
  }

  function setPlayer(pos) {
    playerPos = pos;
  }

  return {
    update,
    dispose,
    rebuildPuffs,
    params,
    setView,
    setPlayer,
    snapSpawnToTarget,
  };
}

export function buildFloatingMistUI(folder, state) {
  const p = state.params;
  const reb = () => state.rebuildPuffs();

  folder.addBinding(p, "enabled", { label: "Enabled" });

  const spawn = folder.addFolder({ title: "Spawn", expanded: true });
  spawn.addBinding(p, "spawnX", {
    label: "Start X",
    min: -200,
    max: 200,
    step: 0.5,
  });
  spawn.addBinding(p, "spawnZ", {
    label: "Center Z",
    min: -200,
    max: 200,
    step: 0.5,
  });
  spawn.addButton({ title: "Snap spawn to view" }).on("click", () =>
    state.snapSpawnToTarget(),
  );
  spawn.addBinding(p, "heightAboveGround", {
    label: "Height",
    min: 1,
    max: 20,
    step: 0.25,
  });

  const cluster = folder.addFolder({ title: "Smoke wisps", expanded: true });
  cluster
    .addBinding(p, "puffCount", {
      label: "Wisps",
      min: 6,
      max: 32,
      step: 1,
    })
    .on("change", reb);
  cluster.addBinding(p, "puffSize", {
    label: "Size",
    min: 1.5,
    max: 10,
    step: 0.25,
  });
  cluster
    .addBinding(p, "spreadX", {
      label: "X jitter",
      min: 0,
      max: 8,
      step: 0.25,
    })
    .on("change", reb);
  cluster
    .addBinding(p, "spreadY", {
      label: "Height spread",
      min: 1,
      max: 12,
      step: 0.25,
    })
    .on("change", reb);
  cluster
    .addBinding(p, "spreadZ", {
      label: "Depth spread",
      min: 2,
      max: 16,
      step: 0.5,
    })
    .on("change", reb);

  const travel = folder.addFolder({ title: "Travel (+X)", expanded: true });
  travel.addBinding(p, "travelDistance", {
    label: "Distance",
    min: 10,
    max: 100,
    step: 1,
  });
  travel.addBinding(p, "travelSpeed", {
    label: "Speed",
    min: 0.02,
    max: 0.3,
    step: 0.01,
  });
  travel.addBinding(p, "travelDir", {
    label: "Direction",
    min: -1,
    max: 1,
    step: 1,
  });
  travel.addBinding(p, "bobAmp", {
    label: "Bob",
    min: 0,
    max: 1,
    step: 0.05,
  });
  travel.addBinding(p, "fadeIn", {
    label: "Fade in",
    min: 0.01,
    max: 0.2,
    step: 0.01,
  });
  travel.addBinding(p, "fadeOut", {
    label: "Fade out at",
    min: 0.35,
    max: 0.92,
    step: 0.02,
  });

  const fade = folder.addFolder({ title: "Player fade", expanded: true });
  fade.addBinding(p, "playerFadeNear", {
    label: "Gone by",
    min: 1,
    max: 10,
    step: 0.25,
  });
  fade.addBinding(p, "playerFadeFar", {
    label: "Full by",
    min: 4,
    max: 30,
    step: 0.5,
  });
  fade.addBinding(p, "cameraFadeFar", {
    label: "Camera far",
    min: 20,
    max: 150,
    step: 1,
  });
  fade.addBinding(p, "softParticles", { label: "Soft depth" });
  fade.addBinding(p, "softFadeDist", {
    label: "Soft dist",
    min: 0.2,
    max: 4,
    step: 0.05,
  });

  const look = folder.addFolder({ title: "Look", expanded: true });
  look.addBinding(p, "opacity", {
    label: "Opacity",
    min: 0.05,
    max: 1,
    step: 0.01,
  });
  look.addBinding(p, "wispThreshold", {
    label: "Wisp breakup",
    min: 0.15,
    max: 0.65,
    step: 0.01,
  });
  look.addBinding(p, "noiseScale", {
    label: "Noise scale",
    min: 0.5,
    max: 6,
    step: 0.05,
  });
  look.addBinding(p, "densityMult", {
    label: "Density",
    min: 0.3,
    max: 2.5,
    step: 0.05,
  });
  look.addBinding(p, "warpMult", {
    label: "Warp",
    min: 0.2,
    max: 2.5,
    step: 0.05,
  });
  look.addBinding(p, "shaderSpeedMult", {
    label: "Anim speed",
    min: 0.1,
    max: 3,
    step: 0.05,
  });
  look.addBinding(p, "baseColor", { label: "Base" });
  look.addBinding(p, "hotColor", { label: "Highlight" });
}
