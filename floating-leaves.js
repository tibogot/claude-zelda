/**
 * Floating Leaves — vanilla JS, WebGPU-compatible.
 * Drifting leaves with gravity, wind, terrain collision, and optional view-space thickening.
 *
 * Usage:
 *   import { createFloatingLeaves } from './floating-leaves.js';
 *   const leaves = createFloatingLeaves({ scene, windParams: { uTime, uWindStr, uWindSpeed } });
 *   // In animation loop:
 *   leaves.update();
 *
 * Textures: textures/leaf1-tiny.png, textures/whitesquare.png (fallback)
 */
import * as THREE from "three";

const DEFAULT_COUNT = 100;
const DEFAULT_MAX_COUNT = 500;
const DEFAULT_AREA_SIZE = 50;
const DEFAULT_SPAWN_HEIGHT = 20;
const DEFAULT_LEAF_SIZE = 0.2;
const DEFAULT_SCALE = 1.0;
const DEFAULT_OPACITY = 0.8;
const DEFAULT_WIND_INFLUENCE = 1.0;
const DEFAULT_GRAVITY = 0.002;
const DEFAULT_TERMINAL_VELOCITY = 0.02;
const DEFAULT_ROTATION_SPEED = 0.001;
const DEFAULT_AIR_RESISTANCE = 0.99;
const DEFAULT_MAX_AGE = 1000;
const DEFAULT_TERRAIN_FLOOR_OFFSET = 2;

function createFallbackTexture(color = 0xff6b35) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16;
  return tex;
}

/**
 * @param {Object} opts
 * @param {THREE.Scene} opts.scene
 * @param {number} [opts.count=100]
 * @param {number} [opts.maxCount=500] — buffer size; count can be reduced live
 * @param {number} [opts.areaSize=50]
 * @param {number} [opts.spawnHeight=20]
 * @param {number} [opts.leafSize=0.2]
 * @param {number} [opts.scale=1] — uniform scale multiplier
 * @param {number} [opts.opacity=0.8]
 * @param {number} [opts.windInfluence=1.0]
 * @param {number} [opts.gravity=0.002]
 * @param {number} [opts.terminalVelocity=0.02]
 * @param {number} [opts.rotationSpeed=0.001]
 * @param {number} [opts.airResistance=0.99]
 * @param {number} [opts.maxAge=1000]
 * @param {number} [opts.terrainFloorOffset=2]
 * @param {boolean} [opts.enabled=false]
 * @param {boolean} [opts.useTexture=true]
 * @param {boolean} [opts.enableViewThickening=false]
 * @param {number} [opts.viewThickenStrength=0.3]
 * @param {(x:number,z:number)=>number} [opts.getTerrainHeight]
 * @param {{ uTime?: { value: number }, uWindStr?: { value: number }, uWindSpeed?: { value: number } }} [opts.windParams]
 */
export function createFloatingLeaves(opts = {}) {
  const {
    scene,
    count = DEFAULT_COUNT,
    maxCount = DEFAULT_MAX_COUNT,
    areaSize = DEFAULT_AREA_SIZE,
    spawnHeight = DEFAULT_SPAWN_HEIGHT,
    leafSize = DEFAULT_LEAF_SIZE,
    scale = DEFAULT_SCALE,
    opacity = DEFAULT_OPACITY,
    windInfluence = DEFAULT_WIND_INFLUENCE,
    gravity = DEFAULT_GRAVITY,
    terminalVelocity = DEFAULT_TERMINAL_VELOCITY,
    rotationSpeed = DEFAULT_ROTATION_SPEED,
    airResistance = DEFAULT_AIR_RESISTANCE,
    maxAge = DEFAULT_MAX_AGE,
    terrainFloorOffset = DEFAULT_TERRAIN_FLOOR_OFFSET,
    enabled = false,
    useTexture = true,
    enableViewThickening = false,
    viewThickenStrength = 0.3,
    getTerrainHeight,
    windParams,
  } = opts;

  const cap = Math.min(Math.max(count, 1), maxCount);
  const leafData = {
    positions: new Float32Array(maxCount * 3),
    rotations: new Float32Array(maxCount * 3),
    velocities: new Float32Array(maxCount * 3),
    ages: new Float32Array(maxCount),
    maxAge,
  };

  // Initialize positions
  for (let i = 0; i < cap; i++) {
    const i3 = i * 3;
    const x = (Math.random() - 0.5) * areaSize;
    const z = (Math.random() - 0.5) * areaSize;
    leafData.positions[i3] = x;
    leafData.positions[i3 + 1] = getTerrainHeight
      ? getTerrainHeight(x, z) + Math.random() * spawnHeight + 5
      : Math.random() * spawnHeight + 5;
    leafData.positions[i3 + 2] = z;
    leafData.rotations[i3] = Math.random() * Math.PI * 2;
    leafData.rotations[i3 + 1] = Math.random() * Math.PI * 2;
    leafData.rotations[i3 + 2] = Math.random() * Math.PI * 2;
    leafData.velocities[i3] = (Math.random() - 0.5) * 0.01;
    leafData.velocities[i3 + 1] = -Math.random() * 0.005;
    leafData.velocities[i3 + 2] = (Math.random() - 0.5) * 0.01;
    leafData.ages[i] = Math.random() * maxAge;
  }

  const leafGeometry = new THREE.PlaneGeometry(leafSize, leafSize);
  let leafTexture = null;

  const loader = new THREE.TextureLoader();
  const texturePath = useTexture ? "textures/leaf1-tiny.png" : "textures/whitesquare.png";
  loader.load(
    texturePath,
    (tex) => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 16;
      tex.flipY = false;
      leafTexture = tex;
      if (leafMaterial) {
        leafMaterial.map = tex;
        leafMaterial.needsUpdate = true;
      }
    },
    undefined,
    () => {
      leafTexture = createFallbackTexture(0xff6b35);
      if (leafMaterial && leafTexture) {
        leafMaterial.map = leafTexture;
        leafMaterial.needsUpdate = true;
      }
    }
  );

  const fallbackTex = createFallbackTexture(0xff6b35);
  const leafMaterial = new THREE.MeshStandardMaterial({
    map: leafTexture || fallbackTex,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    alphaTest: 0.1,
  });

  if (enableViewThickening) {
    leafMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
        #include <begin_vertex>
        vec3 instanceLocalPos = vec3(instanceMatrix[3].xyz);
        vec4 instancePosWorld = modelMatrix * vec4(instanceLocalPos, 1.0);
        vec3 instanceWorldPos = instancePosWorld.xyz;
        vec3 camPos = (inverse(viewMatrix) * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 viewDir = normalize(camPos - instanceWorldPos);
        vec3 leafNormalLocal = vec3(0.0, 0.0, 1.0);
        vec3 leafNormal = normalize((modelMatrix * instanceMatrix * vec4(leafNormalLocal, 0.0)).xyz);
        float viewDotNormal = abs(dot(viewDir, leafNormal));
        float thickenFactor = pow(1.0 - viewDotNormal, 2.0);
        thickenFactor *= smoothstep(0.0, 0.3, viewDotNormal);
        vec3 offset = leafNormal * thickenFactor * ${viewThickenStrength.toFixed(2)} * ${leafSize.toFixed(2)} * 0.5;
        transformed += offset;
        `
      );
    };
  }

  const instancedMesh = new THREE.InstancedMesh(leafGeometry, leafMaterial, maxCount);
  instancedMesh.frustumCulled = false;
  instancedMesh.castShadow = true;
  instancedMesh.visible = enabled;
  instancedMesh.count = cap;
  scene.add(instancedMesh);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Euler();
  const quaternion = new THREE.Quaternion();
  const scaleVec = new THREE.Vector3(1, 1, 1);

  const params = {
    enabled,
    count: cap,
    maxCount,
    areaSize,
    spawnHeight,
    leafSize,
    scale,
    opacity,
    windInfluence,
    gravity,
    terminalVelocity,
    rotationSpeed,
    airResistance,
    maxAge,
    terrainFloorOffset,
    useTexture,
    enableViewThickening,
    viewThickenStrength,
  };

  function applyMatrices() {
    const n = Math.min(Math.max(params.count, 1), params.maxCount);
    instancedMesh.count = n;
    scaleVec.setScalar(params.scale);
    for (let i = 0; i < n; i++) {
      position.set(
        leafData.positions[i * 3],
        leafData.positions[i * 3 + 1],
        leafData.positions[i * 3 + 2]
      );
      rotation.set(
        leafData.rotations[i * 3],
        leafData.rotations[i * 3 + 1],
        leafData.rotations[i * 3 + 2]
      );
      quaternion.setFromEuler(rotation);
      matrix.compose(position, quaternion, scaleVec);
      instancedMesh.setMatrixAt(i, matrix);
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
  }

  function update() {
    instancedMesh.visible = params.enabled;
    leafMaterial.opacity = params.opacity;
    if (!params.enabled) return;

    const time = windParams?.uTime?.value ?? 0;
    const windStrength = (windParams?.uWindStr?.value ?? 0.3) * params.windInfluence;
    const windSpeed = windParams?.uWindSpeed?.value ?? 1.2;
    const n = Math.min(Math.max(params.count, 1), params.maxCount);

    for (let i = 0; i < n; i++) {
      const i3 = i * 3;

      leafData.ages[i]++;
      if (leafData.ages[i] > params.maxAge) {
        leafData.ages[i] = 0;
        const rx = (Math.random() - 0.5) * params.areaSize;
        const rz = (Math.random() - 0.5) * params.areaSize;
        leafData.positions[i3] = rx;
        leafData.positions[i3 + 1] = getTerrainHeight
          ? getTerrainHeight(rx, rz) + params.spawnHeight + Math.random() * 5
          : params.spawnHeight;
        leafData.positions[i3 + 2] = rz;
        leafData.velocities[i3] = (Math.random() - 0.5) * 0.01;
        leafData.velocities[i3 + 1] = -Math.random() * 0.005;
        leafData.velocities[i3 + 2] = (Math.random() - 0.5) * 0.01;
      }

      leafData.velocities[i3 + 1] -= params.gravity;
      if (Math.abs(leafData.velocities[i3 + 1]) > params.terminalVelocity) {
        leafData.velocities[i3 + 1] =
          Math.sign(leafData.velocities[i3 + 1]) * params.terminalVelocity;
      }
      leafData.velocities[i3] *= params.airResistance;
      leafData.velocities[i3 + 2] *= params.airResistance;

      if (windParams) {
        const windX =
          Math.sin(time * windSpeed + leafData.positions[i3] * 0.1) *
          windStrength *
          0.01;
        const windZ =
          Math.cos(time * windSpeed + leafData.positions[i3 + 2] * 0.1) *
          windStrength *
          0.01;
        leafData.velocities[i3] += windX;
        leafData.velocities[i3 + 2] += windZ;
      }

      leafData.positions[i3] += leafData.velocities[i3];
      leafData.positions[i3 + 1] += leafData.velocities[i3 + 1];
      leafData.positions[i3 + 2] += leafData.velocities[i3 + 2];

      const floor = params.terrainFloorOffset;
      if (getTerrainHeight) {
        const terrainHeight = getTerrainHeight(
          leafData.positions[i3],
          leafData.positions[i3 + 2]
        );
        if (leafData.positions[i3 + 1] < terrainHeight + floor) {
          // Respawn at random position to avoid stacking in a column
          const rx = (Math.random() - 0.5) * params.areaSize;
          const rz = (Math.random() - 0.5) * params.areaSize;
          leafData.positions[i3] = rx;
          leafData.positions[i3 + 1] =
            getTerrainHeight(rx, rz) + params.spawnHeight * 0.5 + Math.random() * params.spawnHeight;
          leafData.positions[i3 + 2] = rz;
          leafData.velocities[i3] = (Math.random() - 0.5) * 0.01;
          leafData.velocities[i3 + 1] = -Math.random() * 0.005;
          leafData.velocities[i3 + 2] = (Math.random() - 0.5) * 0.01;
        }
      }

      const rot = params.rotationSpeed;
      leafData.rotations[i3] += rot + leafData.velocities[i3] * 0.5;
      leafData.rotations[i3 + 1] += rot * 0.5 + leafData.velocities[i3 + 1] * 0.2;
      leafData.rotations[i3 + 2] += rot + leafData.velocities[i3 + 2] * 0.5;
    }

    applyMatrices();
  }

  applyMatrices();

  return {
    mesh: instancedMesh,
    update,
    params,
  };
}
