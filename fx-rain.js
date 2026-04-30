/**
 * fx-rain.js
 * Stylized rain streaks for the Ambient FX Editor.
 *
 * CPU-updated instanced quads, driven by:
 *  - shared wind (windX, windZ, windStrength)
 *  - a getTerrainHeight(x, z) callback so drops collide with terrain/props
 *
 * Exposes:
 *   createRainFX(scene, shared, getTerrainHeight)
 *   buildRainUI(folder, state)
 */

import * as THREE from "three";

function createStreakTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, "rgba(255,255,255,0.0)");
  grad.addColorStop(0.15, "rgba(255,255,255,0.35)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.85, "rgba(255,255,255,0.35)");
  grad.addColorStop(1.0, "rgba(255,255,255,0.0)");

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function createRainFX(scene, shared, getTerrainHeight) {
  const params = {
    enabled: true,
    count: 6000,
    areaSize: 100,
    minHeight: 15,
    maxHeight: 55,
    fallSpeed: 22,
    swayAmount: 1.5,
    swayFrequency: 2.2,
    dropLength: 1.8,
    dropWidth: 0.03,
    opacity: 0.55,
  };

  const maxCount = 20000;

  const geom = new THREE.PlaneGeometry(1, 1);
  const streakTex = createStreakTexture();
  const mat = new THREE.MeshBasicMaterial({
    map: streakTex || null,
    color: 0xa8c8ff,
    transparent: true,
    opacity: params.opacity,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.InstancedMesh(geom, mat, maxCount);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const drops = new Array(maxCount);
  const dummy = new THREE.Object3D();
  
  // Reusable vectors for billboard calculation
  const _camPos = new THREE.Vector3();
  const _fallDir = new THREE.Vector3();
  const _toCamera = new THREE.Vector3();
  const _right = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _matrix = new THREE.Matrix4();

  const randRange = (min, max) => min + Math.random() * (max - min);

  function spawnDrop(i) {
    const halfArea = params.areaSize * 0.5;
    const x = randRange(-halfArea, halfArea);
    const z = randRange(-halfArea, halfArea);
    const baseY = getTerrainHeight ? getTerrainHeight(x, z) : shared.groundY;
    const y = baseY + randRange(params.minHeight, params.maxHeight);

    const speed = params.fallSpeed * (0.7 + Math.random() * 0.6);
    const swayPhase = Math.random() * Math.PI * 2;

    drops[i] = { x, y, z, speed, swayPhase };
  }

  for (let i = 0; i < maxCount; i++) {
    spawnDrop(i);
  }

  // Store camera reference for billboarding
  let camera = null;

  function applyMatrices(time) {
    const n = Math.min(params.count, maxCount);
    mesh.count = n;

    const halfArea = params.areaSize * 0.5;
    const windX = shared.windX * shared.windStrength;
    const windZ = shared.windZ * shared.windStrength;

    // Get camera position for billboarding
    if (camera) {
      _camPos.copy(camera.position);
    } else {
      _camPos.set(0, 10, 20);
    }

    // Fall direction (slanted by wind)
    _fallDir.set(windX * 0.6, -1, windZ * 0.6).normalize();

    for (let i = 0; i < n; i++) {
      const d = drops[i];

      const sway = Math.sin(time * params.swayFrequency + d.swayPhase) * params.swayAmount;

      const px = d.x + sway * 0.18;
      const pz = d.z;
      const py = d.y;

      dummy.position.set(px, py, pz);

      // Billboard calculation: make plane face camera while aligning Y with fall direction
      _toCamera.subVectors(_camPos, dummy.position).normalize();
      
      // Right vector: perpendicular to both camera direction and fall direction
      _right.crossVectors(_toCamera, _fallDir);
      if (_right.lengthSq() < 0.001) {
        // Fallback if fall direction is parallel to camera view
        _right.set(1, 0, 0);
      }
      _right.normalize();
      
      // Up vector: along the fall direction, projected to be perpendicular to right
      _up.crossVectors(_right, _toCamera).normalize();
      
      // Build rotation from basis vectors (right = X, up = Y, toCamera = Z)
      _matrix.makeBasis(_right, _up, _toCamera);
      dummy.quaternion.setFromRotationMatrix(_matrix);
      
      dummy.scale.set(params.dropWidth, params.dropLength, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Respawn if too far out of area to avoid drift build-up.
      if (Math.abs(d.x) > halfArea * 1.6 || Math.abs(d.z) > halfArea * 1.6) {
        spawnDrop(i);
      }
    }

    mesh.instanceMatrix.needsUpdate = true;
  }
  
  function setCamera(cam) {
    camera = cam;
  }

  function update(dt, elapsed, sh) {
    mesh.visible = params.enabled;
    mat.opacity = params.opacity;
    if (!params.enabled) return;

    const n = Math.min(params.count, maxCount);

    for (let i = 0; i < n; i++) {
      const d = drops[i];

      d.y -= d.speed * dt;
      d.x += sh.windX * sh.windStrength * 0.55 * dt;
      d.z += sh.windZ * sh.windStrength * 0.55 * dt;

      const terrainY = getTerrainHeight ? getTerrainHeight(d.x, d.z) : sh.groundY;
      const hitY = terrainY + 0.25;

      if (d.y < hitY) {
        spawnDrop(i);
      }
    }

    applyMatrices(elapsed);
  }

  function dispose(sc) {
    sc.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }

  return { update, dispose, params, setCamera };
}

export function buildRainUI(folder, state) {
  const p = state.params;

  folder.addBinding(p, "enabled", { label: "Enabled" });

  folder.addBinding(p, "count", {
    label: "Drop Count",
    min: 1000,
    max: 20000,
    step: 100,
  });

  folder.addBinding(p, "areaSize", {
    label: "Area Size",
    min: 20,
    max: 160,
    step: 5,
  });

  folder.addBinding(p, "minHeight", {
    label: "Min Height",
    min: 2,
    max: 40,
    step: 1,
  });

  folder.addBinding(p, "maxHeight", {
    label: "Max Height",
    min: 10,
    max: 80,
    step: 1,
  });

  folder.addBinding(p, "fallSpeed", {
    label: "Fall Speed",
    min: 4,
    max: 40,
    step: 1,
  });

  folder.addBinding(p, "swayAmount", {
    label: "Sway Amount",
    min: 0,
    max: 5,
    step: 0.1,
  });

  folder.addBinding(p, "swayFrequency", {
    label: "Sway Freq",
    min: 0.2,
    max: 4,
    step: 0.1,
  });

  folder.addBinding(p, "dropLength", {
    label: "Drop Length",
    min: 0.4,
    max: 3,
    step: 0.1,
  });

  folder.addBinding(p, "dropWidth", {
    label: "Drop Width",
    min: 0.01,
    max: 0.15,
    step: 0.005,
  });

  folder.addBinding(p, "opacity", {
    label: "Opacity",
    min: 0.05,
    max: 0.8,
    step: 0.05,
  });
}

