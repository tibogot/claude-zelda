/**
 * fx-embers.js
 * GPU-driven embers: InstancedMesh + TSL billboard, additive glow.
 * Motion, flicker, and spawn layout from instanceIndex + time — no per-frame buffer uploads.
 * Shared wind / volume / ground Y applied via a few uniforms in update().
 */

import * as THREE from "three";
import {
  cameraPosition,
  cos,
  cross,
  float,
  fract,
  instanceIndex,
  length,
  max,
  mix,
  normalize,
  positionLocal,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec2,
  vec3,
} from "three/tsl";

const BASE_COUNT = 900;

function iHash(offset) {
  return float(instanceIndex).add(float(offset)).mul(127.1).sin().mul(43758.5453).fract();
}

function createEmberMaterial(uVolume, uGroundY, uWindX, uWindZ, uRiseMul, uRiseSpan, uMinSpawnH, uSizeMul, uGlow, params) {
  const uFlickSpeed = uniform(float(params.flickerSpeed));
  const uWobble = uniform(float(params.wobble));
  const uWarm = uniform(float(params.warmth));

  const positionNode = (() => {
    const h0 = iHash(0);
    const h1 = iHash(1);
    const h2 = iHash(2);
    const h3 = iHash(3);
    const h4 = iHash(4);
    const h5 = iHash(5);

    const angle = h0.mul(Math.PI * 2);
    const rad = pow(h1, float(0.5)).mul(uVolume);
    const baseX = angle.cos().mul(rad);
    const baseZ = angle.sin().mul(rad);

    const riseSpeed = h4.mul(0.22).add(0.18).mul(uRiseMul);
    const phase = h3.mul(62.831);
    const cyc = fract(time.mul(riseSpeed).add(phase.mul(0.01)));

    const wy = uGroundY.add(uMinSpawnH).add(h2.mul(float(0.35))).add(cyc.mul(uRiseSpan));

    const wobbleT = time.mul(float(0.55)).add(h5.mul(6.283));
    const wx = baseX
      .add(sin(wobbleT.mul(0.7).add(h3.mul(12))).mul(uWobble))
      .add(cos(time.mul(float(0.28)).add(h4.mul(8))).mul(uWindX.mul(float(2.5))));
    const wz = baseZ
      .add(cos(wobbleT.mul(0.9).add(h2.mul(9))).mul(uWobble.mul(float(0.85))))
      .add(sin(time.mul(float(0.31)).add(h5.mul(7))).mul(uWindZ.mul(float(2.5))));

    const worldCenter = vec3(wx, wy, wz);

    const toCam = cameraPosition.sub(worldCenter);
    const camDir = normalize(toCam);

    const up = vec3(0, 1, 0);
    const tangent = normalize(cross(up, camDir));
    const bitangent = cross(camDir, tangent);

    const sc = h5.mul(0.35).add(0.65).mul(uSizeMul);
    const billboard = tangent.mul(positionLocal.x.mul(sc)).add(bitangent.mul(positionLocal.y.mul(sc)));

    return worldCenter.add(billboard);
  })();

  const p = uv().sub(vec2(0.5, 0.5));
  const r = length(p);
  const core = smoothstep(float(0.42), float(0.0), r);
  const halo = pow(max(float(0), float(1).sub(r.mul(2.2))), float(2.1));
  const radial = max(core, halo.mul(float(0.55)));

  const flickPhase = iHash(19).mul(Math.PI * 2);
  const flick = sin(time.mul(uFlickSpeed).add(flickPhase)).mul(0.38).add(0.62);

  const warm = uWarm;
  const colInner = vec3(1.0, 0.92, 0.72);
  const colOuter = vec3(1.0, 0.45, 0.12);
  const rgb = mix(colOuter, colInner, smoothstep(float(0.35), float(0.0), r)).mul(warm);

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.positionNode = positionNode;
  mat.colorNode = rgb.mul(radial).mul(flick).mul(uGlow);
  mat.opacityNode = radial.mul(flick).mul(float(0.95));
  mat.transparent = true;
  mat.depthWrite = false;
  mat.blending = THREE.AdditiveBlending;
  mat.side = THREE.DoubleSide;

  return { mat, uFlickSpeed, uWobble, uWarm };
}

export function createEmberFX(scene, shared) {
  const params = {
    riseSpeed: 1.0,
    riseHeight: 5.5,
    minSpawn: 0.35,
    size: 0.14,
    glow: 1.35,
    flickerSpeed: 7.5,
    wobble: 0.45,
    warmth: 1.0,
  };

  const uVolume = uniform(float(shared.volume));
  const uGroundY = uniform(float(shared.groundY));
  const uWindX = uniform(float(shared.windX * shared.windStrength * 0.05));
  const uWindZ = uniform(float(shared.windZ * shared.windStrength * 0.05));
  const uRiseMul = uniform(float(params.riseSpeed));
  const uRiseSpan = uniform(float(params.riseHeight));
  const uMinSpawnH = uniform(float(params.minSpawn));
  const uSizeMul = uniform(float(params.size));
  const uGlow = uniform(float(params.glow));

  const { mat, uFlickSpeed, uWobble, uWarm } = createEmberMaterial(
    uVolume, uGroundY, uWindX, uWindZ, uRiseMul, uRiseSpan, uMinSpawnH, uSizeMul, uGlow, params,
  );

  const geo = new THREE.PlaneGeometry(1, 1);
  const identityMatrix = new THREE.Matrix4();
  let mesh = null;
  let count = 0;

  function spawn() {
    if (mesh) {
      scene.remove(mesh);
      mesh.geometry = null;
      mesh.material = null;
      mesh.dispose();
      mesh = null;
    }

    count = Math.max(1, Math.round(BASE_COUNT * shared.density));
    mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.count = count;
    mesh.frustumCulled = false;

    for (let i = 0; i < count; i++) {
      mesh.setMatrixAt(i, identityMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;

    scene.add(mesh);
  }

  spawn();

  function update(_dt, _elapsed, sh) {
    uVolume.value = sh.volume;
    uGroundY.value = sh.groundY;
    const w = 0.05 * sh.windStrength;
    uWindX.value = sh.windX * w;
    uWindZ.value = sh.windZ * w;
  }

  function dispose(sc) {
    if (mesh) {
      sc.remove(mesh);
      mesh.geometry = null;
      mesh.material = null;
      mesh.dispose();
      mesh = null;
    }
    geo.dispose();
    mat.dispose();
    count = 0;
  }

  return {
    update,
    dispose,
    spawn,
    params,
    uRiseMul,
    uRiseSpan,
    uMinSpawnH,
    uSizeMul,
    uGlow,
    uFlickSpeed,
    uWobble,
    uWarm,
  };
}

export function buildEmberUI(folder, state) {
  folder.addBinding(state.params, "riseSpeed", {
    label: "Rise Speed", min: 0.2, max: 2.5, step: 0.05,
  }).on("change", () => { state.uRiseMul.value = state.params.riseSpeed; });

  folder.addBinding(state.params, "riseHeight", {
    label: "Rise Height", min: 1, max: 18, step: 0.25,
  }).on("change", () => { state.uRiseSpan.value = state.params.riseHeight; });

  folder.addBinding(state.params, "minSpawn", {
    label: "Min Spawn Y", min: 0, max: 4, step: 0.05,
  }).on("change", () => { state.uMinSpawnH.value = state.params.minSpawn; });

  folder.addBlade({ view: "separator" });

  folder.addBinding(state.params, "size", {
    label: "Size", min: 0.04, max: 0.35, step: 0.005,
  }).on("change", () => { state.uSizeMul.value = state.params.size; });

  folder.addBinding(state.params, "glow", {
    label: "Glow", min: 0.2, max: 3, step: 0.05,
  }).on("change", () => { state.uGlow.value = state.params.glow; });

  folder.addBinding(state.params, "flickerSpeed", {
    label: "Flicker", min: 0.5, max: 18, step: 0.5,
  }).on("change", () => { state.uFlickSpeed.value = state.params.flickerSpeed; });

  folder.addBinding(state.params, "wobble", {
    label: "Wobble", min: 0, max: 1.5, step: 0.05,
  }).on("change", () => { state.uWobble.value = state.params.wobble; });

  folder.addBinding(state.params, "warmth", {
    label: "Warmth", min: 0.4, max: 1.8, step: 0.05,
  }).on("change", () => { state.uWarm.value = state.params.warmth; });

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Respawn" }).on("click", () => state.spawn());
}
