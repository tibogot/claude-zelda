/**
 * fx-sand.js
 * Desert wind-blown sand — dense 3D round grains (instanced icosahedra).
 *
 * Each grain spawns on the ground, gets carried by wind, rises, and fades
 * out with altitude. Motion is entirely GPU-driven (TSL positionNode).
 */

import * as THREE from "three/webgpu";
import {
  cos,
  float,
  Fn,
  fract,
  instanceIndex,
  mix,
  mod,
  oneMinus,
  positionLocal,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  vec3,
} from "three/tsl";

const TWO_PI = Math.PI * 2;
const MAX_COUNT = 32768;

function iHash(offset) {
  return float(instanceIndex)
    .add(float(offset))
    .mul(127.1)
    .sin()
    .mul(43758.5453)
    .fract();
}

export function createSandFX(scene, shared) {
  const params = {
    enabled: true,
    count: "12000",

    centerX: 0,
    centerY: 0,
    centerZ: 0,
    areaSize: shared.volume ?? 30,

    spawnOffset: 0.03,
    maxRise: 12,
    riseSpeed: 1.15,
    riseCurve: 0.55,

    size: 0.035,
    sizeVar: 0.65,

    windCoupling: 1.0,
    windTravel: 14,
    speed: 1.0,
    turbAmp: 1.8,
    gustKick: 2.5,

    fadeIn: 0.05,
    fadeOut: 0.5,
    fadePower: 1.6,

    colorA: "#c9a86c",
    colorB: "#e8d4a8",
  };

  let camera = null;
  let controls = null;
  let _hasSnapped = false;

  const u = {
    center: uniform(
      new THREE.Vector3(params.centerX, params.centerY, params.centerZ),
    ),
    areaSize: uniform(float(params.areaSize)),
    groundY: uniform(float(shared.groundY || 0)),
    spawnOffset: uniform(float(params.spawnOffset)),
    maxRise: uniform(float(params.maxRise)),
    riseSpeed: uniform(float(params.riseSpeed)),
    riseCurve: uniform(float(params.riseCurve)),
    size: uniform(float(params.size)),
    sizeVar: uniform(float(params.sizeVar)),
    windDir: uniform(new THREE.Vector2(1, 0)),
    windTravel: uniform(float(params.windTravel)),
    speed: uniform(float(params.speed)),
    turbAmp: uniform(float(params.turbAmp)),
    gustKick: uniform(float(params.gustKick)),
    windGlobal: uniform(float(1)),
    fadeIn: uniform(float(params.fadeIn)),
    fadeOut: uniform(float(params.fadeOut)),
    fadePower: uniform(float(params.fadePower)),
    colorA: uniform(new THREE.Color(params.colorA)),
    colorB: uniform(new THREE.Color(params.colorB)),
  };

  function buildMaterial() {
    const h0 = iHash(0);
    const h1 = iHash(1);
    const h2 = iHash(2);
    const h3 = iHash(3);
    const h4 = iHash(4);
    const h5 = iHash(5);
    const h6 = iHash(6);
    const h7 = iHash(7);
    const h8 = iHash(8);
    const h9 = iHash(9);
    const h10 = iHash(10);

    const halfArea = u.areaSize.mul(0.5);
    const anchorX = h0.mul(2.0).sub(1.0).mul(halfArea);
    const anchorZ = h1.mul(2.0).sub(1.0).mul(halfArea);

    const riseRate = h4.mul(0.45).add(0.2).mul(u.riseSpeed).mul(u.windGlobal);
    const phase = h5;
    const cycle = fract(time.mul(riseRate).add(phase));

    const peakH = mix(u.maxRise.mul(0.3), u.maxRise, h6);
    const riseT = pow(cycle, u.riseCurve);
    const altitude = riseT.mul(peakH);

    const gustArc = sin(cycle.mul(Math.PI)).mul(u.gustKick).mul(u.windGlobal);
    const groundY = u.center.y.add(u.groundY).add(u.spawnOffset);
    const worldY = groundY.add(altitude).add(gustArc);

    const travel = cycle.mul(u.windTravel);
    const alongX = u.windDir.x.mul(travel);
    const alongZ = u.windDir.y.mul(travel);

    const turbPhase = h2.mul(TWO_PI);
    const turbFreq = h3.mul(0.55).add(0.75);
    const turbT = time.mul(u.speed).mul(turbFreq).add(turbPhase);
    const turbScale = cycle.mul(cycle);
    const turbX = sin(turbT).mul(u.turbAmp).mul(turbScale);
    const turbZ = cos(turbT.mul(1.23).add(h7.mul(1.5))).mul(u.turbAmp).mul(turbScale);

    const crossT = time.mul(u.speed.mul(0.65)).add(h8.mul(TWO_PI));
    const crossX = sin(crossT.mul(0.8)).mul(u.turbAmp.mul(0.35)).mul(cycle);
    const crossZ = cos(crossT.mul(1.05)).mul(u.turbAmp.mul(0.35)).mul(cycle);

    const rawX = anchorX.add(alongX).add(turbX).add(crossX);
    const rawZ = anchorZ.add(alongZ).add(turbZ).add(crossZ);

    const wrapX = mod(rawX.add(halfArea), u.areaSize).sub(halfArea);
    const wrapZ = mod(rawZ.add(halfArea), u.areaSize).sub(halfArea);
    const worldX = u.center.x.add(wrapX);
    const worldZ = u.center.z.add(wrapZ);

    const worldCenter = vec3(worldX, worldY, worldZ);

    const sizeJit = h9.mul(u.sizeVar).add(float(1.0).sub(u.sizeVar.mul(0.5)));
    const grainR = u.size.mul(sizeJit);
    const worldPos = worldCenter.add(positionLocal.mul(grainR));

    const spawnFade = smoothstep(float(0.0), u.fadeIn, cycle);
    const fadeStartH = peakH.mul(u.fadeOut);
    const heightFade = pow(
      oneMinus(smoothstep(fadeStartH, peakH, altitude)),
      u.fadePower,
    );
    const alpha = spawnFade.mul(heightFade);

    const heightTint = oneMinus(altitude.div(peakH.add(float(0.001))).mul(0.4));
    const tint = mix(u.colorA, u.colorB, h10).mul(heightTint);

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.positionNode = Fn(() => worldPos)();
    mat.colorNode = tint;
    mat.transparent = true;
    mat.opacityNode = alpha;
    mat.depthWrite = false;
    mat.side = THREE.DoubleSide;
    return mat;
  }

  const geometry = new THREE.IcosahedronGeometry(1, 0);
  let material = buildMaterial();
  let mesh = null;
  const _identity = new THREE.Matrix4();

  function rebuildMesh() {
    if (mesh) {
      scene.remove(mesh);
      mesh.dispose();
      mesh = null;
    }
    const requested = Math.max(1, Math.floor(Number(params.count) || 12000));
    const density = Math.max(0.05, Number(shared.density) || 1);
    const n = Math.max(1, Math.min(MAX_COUNT, Math.round(requested * density)));
    mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.count = n;
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, _identity);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = params.enabled;
    mesh.renderOrder = 4;
    scene.add(mesh);
  }

  rebuildMesh();

  function setView(cam, ctrl) {
    camera = cam;
    controls = ctrl;
    if (!_hasSnapped && controls) {
      snapCenterToTarget();
      _hasSnapped = true;
    }
  }

  function snapCenterToTarget() {
    if (!controls) return;
    params.centerX = controls.target.x;
    params.centerY = controls.target.y;
    params.centerZ = controls.target.z;
    u.center.value.set(params.centerX, params.centerY, params.centerZ);
  }

  function update(_dt, _elapsed, sh) {
    if (mesh) mesh.visible = params.enabled;

    u.center.value.set(params.centerX, params.centerY, params.centerZ);
    u.areaSize.value = params.areaSize;
    u.groundY.value = sh.groundY || 0;
    u.spawnOffset.value = params.spawnOffset;
    u.maxRise.value = params.maxRise;
    u.riseSpeed.value = params.riseSpeed;
    u.riseCurve.value = params.riseCurve;
    u.size.value = params.size;
    u.sizeVar.value = params.sizeVar;
    u.speed.value = params.speed;
    u.turbAmp.value = params.turbAmp;
    u.gustKick.value = params.gustKick;
    u.fadeIn.value = params.fadeIn;
    u.fadeOut.value = params.fadeOut;
    u.fadePower.value = params.fadePower;
    u.colorA.value.set(params.colorA);
    u.colorB.value.set(params.colorB);

    const wx = sh.windX || 0;
    const wz = sh.windZ || 0;
    const wlen = Math.hypot(wx, wz) || 1;
    u.windDir.value.set(wx / wlen, wz / wlen);

    const wStr = sh.windStrength ?? 1;
    const dens = sh.density ?? 1;
    u.windTravel.value = params.windTravel * wStr * params.windCoupling;
    u.windGlobal.value = wStr * dens;
  }

  function dispose(sc) {
    if (mesh) {
      sc.remove(mesh);
      mesh.dispose();
      mesh = null;
    }
    geometry.dispose();
    material.dispose();
  }

  return {
    update,
    dispose,
    params,
    rebuildMesh,
    setView,
    snapCenterToTarget,
  };
}

export function buildSandUI(folder, state) {
  const p = state.params;

  folder.addBinding(p, "enabled", { label: "Enabled" });

  folder
    .addBinding(p, "count", {
      label: "Count",
      options: {
        "2000": "2000",
        "4000": "4000",
        "8000": "8000",
        "12000": "12000",
        "20000": "20000",
        "32768": "32768",
      },
    })
    .on("change", () => state.rebuildMesh());

  const vol = folder.addFolder({ title: "Volume", expanded: true });
  vol.addBinding(p, "areaSize", {
    label: "Area Size",
    min: 5,
    max: 80,
    step: 1,
  });
  vol.addBinding(p, "spawnOffset", {
    label: "Spawn height",
    min: 0,
    max: 0.5,
    step: 0.01,
  });
  vol.addBinding(p, "maxRise", {
    label: "Max rise",
    min: 2,
    max: 30,
    step: 0.25,
  });
  vol.addBinding(p, "centerX", {
    label: "Center X",
    min: -200,
    max: 200,
    step: 0.5,
  });
  vol.addBinding(p, "centerY", {
    label: "Center Y",
    min: -20,
    max: 20,
    step: 0.1,
  });
  vol.addBinding(p, "centerZ", {
    label: "Center Z",
    min: -200,
    max: 200,
    step: 0.5,
  });
  vol.addButton({ title: "Snap Center to Target" }).on("click", () =>
    state.snapCenterToTarget(),
  );

  folder.addBlade({ view: "separator" });

  folder.addBinding(p, "size", {
    label: "Grain Radius",
    min: 0.01,
    max: 0.12,
    step: 0.002,
  });
  folder.addBinding(p, "sizeVar", {
    label: "Size Variation",
    min: 0,
    max: 1,
    step: 0.05,
  });

  folder.addBlade({ view: "separator" });

  const motion = folder.addFolder({ title: "Wind & Rise", expanded: true });
  motion.addBinding(p, "windCoupling", {
    label: "Wind Push",
    min: 0,
    max: 3,
    step: 0.05,
  });
  motion.addBinding(p, "windTravel", {
    label: "Wind Distance",
    min: 2,
    max: 40,
    step: 0.5,
  });
  motion.addBinding(p, "riseSpeed", {
    label: "Rise Speed",
    min: 0.2,
    max: 4,
    step: 0.05,
  });
  motion.addBinding(p, "riseCurve", {
    label: "Rise Curve",
    min: 0.2,
    max: 2,
    step: 0.05,
  });
  motion.addBinding(p, "speed", {
    label: "Turb Speed",
    min: 0,
    max: 4,
    step: 0.05,
  });
  motion.addBinding(p, "turbAmp", {
    label: "Turbulence",
    min: 0,
    max: 5,
    step: 0.05,
  });
  motion.addBinding(p, "gustKick", {
    label: "Gust Kick",
    min: 0,
    max: 10,
    step: 0.1,
  });

  const fade = folder.addFolder({ title: "Height Fade", expanded: true });
  fade.addBinding(p, "fadeIn", {
    label: "Spawn fade-in",
    min: 0.01,
    max: 0.2,
    step: 0.01,
  });
  fade.addBinding(p, "fadeOut", {
    label: "Fade start",
    min: 0.2,
    max: 0.9,
    step: 0.02,
  });
  fade.addBinding(p, "fadePower", {
    label: "Fade sharpness",
    min: 0.5,
    max: 4,
    step: 0.1,
  });

  folder.addBlade({ view: "separator" });
  folder.addBinding(p, "colorA", { label: "Tint A" });
  folder.addBinding(p, "colorB", { label: "Tint B" });
}
