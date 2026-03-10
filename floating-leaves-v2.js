/**
 * floating-leaves-v2.js — Ghost of Tsushima style leaves
 *
 * v2 improvements over v1:
 *  ✦ Per-leaf personality  — each leaf gets its own lift, spin, drag at spawn
 *  ✦ Lift oscillation      — leaves bob upward before settling (not just rain)
 *  ✦ Camera-following area — spawn box always centers on camera / player
 *  ✦ Wind gust system      — random bursts of strong directional wind
 *  ✦ Texture atlas         — 1-3 leaf shape variants in a horizontal strip
 *  ✦ Runtime PNG import    — loadAtlasUrl(url) / loadFromFile(file)
 *  ✦ createControls(pane)  — returns a Tweakpane folder, ready to mount
 *  ✦ Velocity-driven spin  — fast leaves spin fast, settling leaves barely move
 *
 * Usage:
 *   import { createFloatingLeavesV2 } from './floating-leaves-v2.js';
 *   const leavesV2 = createFloatingLeavesV2({ scene, windParams, getTerrainHeight });
 *   leavesV2.createControls(pane);
 *   // in render loop:
 *   leavesV2.update(camera);
 */
import * as THREE from "three";

// ── Canvas fallback atlas ─────────────────────────────────────────────────────
// Produces a horizontal texture strip with `cols` different leaf silhouettes.
// Each cell is cellSize×cellSize with a radial-gradient that fades to transparent
// at the edges, giving soft lobes without any hard alphaTest staircase.
function createCanvasAtlas(cols = 3, cellSize = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = cellSize * cols;
  canvas.height = cellSize;
  const ctx = canvas.getContext("2d");

  // Orange-red autumn palette per variant
  const themes = [
    { fill: "#c85418", vein: "#7a2608" }, // orange-red  (maple-ish)
    { fill: "#d4882a", vein: "#8a5010" }, // amber        (cherry-ish)
    { fill: "#a03820", vein: "#601808" }, // deep crimson (ginkgo-ish)
  ];

  function rgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  for (let c = 0; c < cols; c++) {
    const theme = themes[c % themes.length];
    const r = cellSize * 0.41;
    ctx.save();
    ctx.translate(c * cellSize + cellSize / 2, cellSize / 2);

    ctx.beginPath();
    if (c === 0) {
      // Oval maple — classic pointed oval leaf
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.62, -r * 0.28, r * 0.72, r * 0.38, 0, r * 0.9);
      ctx.bezierCurveTo(-r * 0.72, r * 0.38, -r * 0.62, -r * 0.28, 0, -r);
    } else if (c === 1) {
      // Elongated narrow oval — cherry-blossom leaf
      ctx.moveTo(0, -r);
      ctx.bezierCurveTo(r * 0.3, -r * 0.52, r * 0.3, r * 0.52, 0, r);
      ctx.bezierCurveTo(-r * 0.3, r * 0.52, -r * 0.3, -r * 0.52, 0, -r);
    } else {
      // Fan / ginkgo — wide at top, narrow stem
      ctx.moveTo(0, r * 0.15);
      ctx.bezierCurveTo(r * 0.9, -r * 0.05, r * 0.82, -r * 0.9, r * 0.28, -r * 0.96);
      ctx.bezierCurveTo(r * 0.05, -r, 0, -r, 0, -r);
      ctx.bezierCurveTo(0, -r, -r * 0.05, -r, -r * 0.28, -r * 0.96);
      ctx.bezierCurveTo(-r * 0.82, -r * 0.9, -r * 0.9, -r * 0.05, 0, r * 0.15);
    }
    ctx.closePath();

    // Radial gradient — opaque center, transparent edge (soft lobe look)
    const g = ctx.createRadialGradient(0, -r * 0.12, r * 0.04, 0, 0, r);
    g.addColorStop(0, rgba(theme.fill, 1.0));
    g.addColorStop(0.68, rgba(theme.fill, 0.92));
    g.addColorStop(0.86, rgba(theme.fill, 0.55));
    g.addColorStop(1.0, rgba(theme.fill, 0.0));
    ctx.fillStyle = g;
    ctx.fill();

    // Midrib vein
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.88);
    ctx.lineTo(0, r * 0.72);
    ctx.strokeStyle = rgba(theme.vein, 0.45);
    ctx.lineWidth = Math.max(1, cellSize * 0.011);
    ctx.stroke();

    ctx.restore();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 16;
  return tex;
}

// ── Main factory ──────────────────────────────────────────────────────────────

/**
 * @param {Object}  opts
 * @param {THREE.Scene}  opts.scene
 * @param {number}  [opts.count=150]
 * @param {number}  [opts.maxCount=600]       — InstancedMesh capacity (per variant)
 * @param {number}  [opts.atlasCols=3]        — 1..3 variants in the atlas image
 * @param {number}  [opts.areaSize=60]
 * @param {number}  [opts.spawnHeight=25]
 * @param {number}  [opts.leafSize=0.22]      — world-space leaf size in metres
 * @param {number}  [opts.scale=1.0]          — uniform scale multiplier (live)
 * @param {number}  [opts.opacity=0.85]
 * @param {boolean} [opts.enabled=false]
 * @param {boolean} [opts.followCamera=true]  — spawn area tracks the camera
 * @param {number}  [opts.gravity=0.0018]
 * @param {number}  [opts.terminalVelocity=0.022]
 * @param {number}  [opts.airResistance=0.992]  — average; per-leaf ±0.004
 * @param {number}  [opts.liftScale=0.0008]   — amplitude of vertical oscillation
 * @param {number}  [opts.liftFreqMin=0.02]
 * @param {number}  [opts.liftFreqMax=0.06]
 * @param {number}  [opts.spinRateMin=0.004]
 * @param {number}  [opts.spinRateMax=0.018]
 * @param {number}  [opts.windInfluence=1.0]
 * @param {number}  [opts.gustProbability=0.003]  — per-frame probability
 * @param {number}  [opts.gustStrength=0.8]
 * @param {number}  [opts.maxAge=1200]
 * @param {number}  [opts.terrainFloorOffset=1.5]
 * @param {(x:number,z:number)=>number} [opts.getTerrainHeight]
 * @param {{ uTime?:{value:number}, uWindStr?:{value:number}, uWindSpeed?:{value:number} }} [opts.windParams]
 */
export function createFloatingLeavesV2(opts = {}) {
  const {
    scene,
    count        = 150,
    maxCount     = 600,
    atlasCols    = 3,
    areaSize     = 60,
    spawnHeight  = 25,
    leafSize     = 0.22,
    scale        = 1.0,
    opacity      = 0.85,
    enabled      = false,
    followCamera = true,
    gravity      = 0.0018,
    terminalVelocity = 0.022,
    airResistance    = 0.992,
    liftScale    = 0.0008,
    liftFreqMin  = 0.02,
    liftFreqMax  = 0.06,
    spinRateMin  = 0.004,
    spinRateMax  = 0.018,
    windInfluence = 1.0,
    gustProbability = 0.003,
    gustStrength    = 0.8,
    maxAge       = 1200,
    terrainFloorOffset = 1.5,
    getTerrainHeight,
    windParams,
  } = opts;

  const cols  = Math.max(1, Math.min(3, Math.round(atlasCols)));
  const total = Math.max(1, Math.min(count, maxCount));

  // ── Flat data arrays for ALL leaves ──────────────────────────────────────
  const positions  = new Float32Array(maxCount * 3);
  const velocities = new Float32Array(maxCount * 3);
  const rotations  = new Float32Array(maxCount * 3);
  const ages       = new Float32Array(maxCount);

  // Per-leaf personality — randomised fresh at each spawn, never changes mid-life
  const liftAmt   = new Float32Array(maxCount); // 0.3..1.0  — oscillation strength
  const liftFreq  = new Float32Array(maxCount); // oscillation frequency
  const liftPhase = new Float32Array(maxCount); // phase offset (desync leaves)
  const spinRate  = new Float32Array(maxCount); // base rotation speed
  const drag      = new Float32Array(maxCount); // per-leaf air resistance

  // ── Live params object ────────────────────────────────────────────────────
  const params = {
    enabled,
    followCamera,
    count: total,
    maxCount,
    atlasCols: cols,
    areaSize,
    spawnHeight,
    leafSize,
    scale,
    opacity,
    gravity,
    terminalVelocity,
    airResistance,
    liftScale,
    liftFreqMin,
    liftFreqMax,
    spinRateMin,
    spinRateMax,
    windInfluence,
    gustProbability,
    gustStrength,
    maxAge,
    terrainFloorOffset,
  };

  // ── Wind gust state machine ───────────────────────────────────────────────
  const gust = {
    active:   false,
    timer:    0,
    duration: 0,
    cooldown: 0,
    dirX:     1,
    dirZ:     0,
    force:    0,
  };

  // ── Spawn a single leaf near (cx, cz) ────────────────────────────────────
  function spawnLeaf(i, cx, cz) {
    const i3  = i * 3;
    const rx  = cx + (Math.random() - 0.5) * params.areaSize;
    const rz  = cz + (Math.random() - 0.5) * params.areaSize;
    const baseY = getTerrainHeight ? getTerrainHeight(rx, rz) : 0;
    positions[i3]     = rx;
    positions[i3 + 1] = baseY + params.spawnHeight * (0.4 + Math.random() * 0.8);
    positions[i3 + 2] = rz;
    velocities[i3]     = (Math.random() - 0.5) * 0.008;
    velocities[i3 + 1] = -Math.random() * 0.003;
    velocities[i3 + 2] = (Math.random() - 0.5) * 0.008;
    ages[i] = Math.random() * 60; // stagger initial age to avoid sync spawning

    // Personality — fresh each life
    liftAmt[i]   = 0.3  + Math.random() * 0.7;
    liftFreq[i]  = params.liftFreqMin + Math.random() * (params.liftFreqMax - params.liftFreqMin);
    liftPhase[i] = Math.random() * Math.PI * 2;
    spinRate[i]  = params.spinRateMin + Math.random() * (params.spinRateMax - params.spinRateMin);
    drag[i]      = 0.988 + Math.random() * 0.008; // 0.988..0.996
  }

  // Initial population
  for (let i = 0; i < total; i++) {
    spawnLeaf(i, 0, 0);
    // Spread initial ages so not everything lands at once
    ages[i] = Math.random() * params.maxAge;
  }

  // ── Texture / atlas ───────────────────────────────────────────────────────
  // Each variant gets its own material pointing at the same atlas texture but
  // with a different UV offset + repeat — no shader magic needed.
  let atlasTexture = createCanvasAtlas(cols);

  function makeMaterial(variantIndex) {
    const t = atlasTexture.clone();
    t.wrapS    = THREE.ClampToEdgeWrapping;
    t.wrapT    = THREE.ClampToEdgeWrapping;
    t.repeat.set(1 / cols, 1);
    t.offset.set(variantIndex / cols, 0);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({
      map:         t,
      transparent: true,
      opacity:     params.opacity,
      side:        THREE.DoubleSide,
      alphaTest:   0.04,
    });
  }

  // ── InstancedMeshes — one per atlas variant ───────────────────────────────
  // Leaf i  →  mesh[i % cols]  at slot  Math.floor(i / cols)
  const maxPerMesh = Math.ceil(maxCount / cols);
  const geo = new THREE.PlaneGeometry(1, 1);

  const materials = [];
  const meshes    = [];
  for (let v = 0; v < cols; v++) {
    const mat  = makeMaterial(v);
    const mesh = new THREE.InstancedMesh(geo, mat, maxPerMesh);
    mesh.frustumCulled = false;
    mesh.castShadow    = false;
    mesh.count         = 0;
    mesh.visible       = params.enabled;
    scene.add(mesh);
    materials.push(mat);
    meshes.push(mesh);
  }

  // ── Matrix temporaries ────────────────────────────────────────────────────
  const _pos  = new THREE.Vector3();
  const _rot  = new THREE.Euler();
  const _quat = new THREE.Quaternion();
  const _scl  = new THREE.Vector3();
  const _mtx  = new THREE.Matrix4();

  function applyMatrices() {
    const n   = Math.max(1, Math.min(params.count, maxCount));
    const sz  = params.leafSize * params.scale;
    _scl.setScalar(sz);

    const perMesh = new Array(cols).fill(0);

    for (let i = 0; i < n; i++) {
      const v    = i % cols;
      const slot = Math.floor(i / cols);
      _pos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      _rot.set(rotations[i * 3], rotations[i * 3 + 1], rotations[i * 3 + 2]);
      _quat.setFromEuler(_rot);
      _mtx.compose(_pos, _quat, _scl);
      meshes[v].setMatrixAt(slot, _mtx);
      perMesh[v] = slot + 1;
    }

    for (let v = 0; v < cols; v++) {
      meshes[v].count = perMesh[v];
      meshes[v].instanceMatrix.needsUpdate = true;
      meshes[v].material.opacity = params.opacity;
    }
  }

  // ── setAtlasTexture — swap atlas at runtime ───────────────────────────────
  function setAtlasTexture(tex) {
    atlasTexture = tex;
    for (let v = 0; v < cols; v++) {
      const t = tex.clone();
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.repeat.set(1 / cols, 1);
      t.offset.set(v / cols, 0);
      t.needsUpdate = true;
      materials[v].map = t;
      materials[v].needsUpdate = true;
    }
  }

  // ── Public load helpers ───────────────────────────────────────────────────
  function loadAtlasUrl(url) {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 16;
      setAtlasTexture(tex);
    });
  }

  function loadFromFile(file) {
    const url = URL.createObjectURL(file);
    new THREE.TextureLoader().load(url, (tex) => {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 16;
      setAtlasTexture(tex);
      URL.revokeObjectURL(url);
    });
  }

  // ── Main update ───────────────────────────────────────────────────────────
  /**
   * Call once per frame.
   * @param {THREE.Camera} [camera] — if provided and followCamera=true, spawn area tracks it
   */
  function update(camera) {
    const vis = params.enabled;
    meshes.forEach((m) => { m.visible = vis; });
    if (!vis) return;

    const time       = windParams?.uTime?.value    ?? 0;
    const windStr    = (windParams?.uWindStr?.value  ?? 0.3) * params.windInfluence;
    const windSpeed  = windParams?.uWindSpeed?.value ?? 1.2;
    const n          = Math.max(1, Math.min(params.count, maxCount));

    // Camera center for follow-mode
    const cx = (params.followCamera && camera) ? camera.position.x : 0;
    const cz = (params.followCamera && camera) ? camera.position.z : 0;
    const halfArea = params.areaSize * 0.55;

    // ── Gust state machine ──────────────────────────────────────────────────
    if (gust.cooldown > 0) {
      gust.cooldown--;
    } else if (!gust.active && Math.random() < params.gustProbability) {
      gust.active   = true;
      gust.timer    = 0;
      gust.duration = 60 + Math.random() * 110;
      gust.cooldown = 180 + Math.random() * 400;
      const angle   = Math.random() * Math.PI * 2;
      gust.dirX     = Math.cos(angle);
      gust.dirZ     = Math.sin(angle);
      gust.force    = params.gustStrength * (0.5 + Math.random() * 0.5) * 0.006;
    }
    let gustEnvelope = 0;
    if (gust.active) {
      gust.timer++;
      gustEnvelope = Math.sin((gust.timer / gust.duration) * Math.PI); // rise then fall
      if (gust.timer >= gust.duration) gust.active = false;
    }

    // ── Per-leaf physics ────────────────────────────────────────────────────
    for (let i = 0; i < n; i++) {
      const i3 = i * 3;

      ages[i]++;

      // Respawn: too old
      if (ages[i] > params.maxAge) {
        spawnLeaf(i, cx, cz);
        continue;
      }

      // Respawn: drifted outside follow-area (only in followCamera mode)
      if (params.followCamera && camera) {
        const dx = positions[i3]     - cx;
        const dz = positions[i3 + 2] - cz;
        if (Math.abs(dx) > halfArea || Math.abs(dz) > halfArea) {
          spawnLeaf(i, cx, cz);
          continue;
        }
      }

      // ── Gravity ──────────────────────────────────────────────────────────
      velocities[i3 + 1] -= params.gravity;
      if (velocities[i3 + 1] < -params.terminalVelocity)
        velocities[i3 + 1] = -params.terminalVelocity;

      // ── Lift oscillation — the "caught in wind" bob ───────────────────────
      // Each leaf has its own frequency and phase so they oscillate out of sync.
      // This is the key difference vs v1 (which was just rain).
      const lift = Math.sin(ages[i] * liftFreq[i] + liftPhase[i])
        * liftAmt[i] * params.liftScale;
      velocities[i3 + 1] += lift;

      // ── Wind (continuous noise) ───────────────────────────────────────────
      if (windParams) {
        const wx = Math.sin(time * windSpeed + positions[i3]     * 0.1) * windStr * 0.01;
        const wz = Math.cos(time * windSpeed + positions[i3 + 2] * 0.1) * windStr * 0.01;
        velocities[i3]     += wx;
        velocities[i3 + 2] += wz;
      }

      // ── Gust (brief directional burst) ────────────────────────────────────
      if (gust.active) {
        const gf = gust.force * gustEnvelope;
        velocities[i3]     += gust.dirX * gf;
        velocities[i3 + 2] += gust.dirZ * gf;
        // Gusts also briefly push leaves upward (classic GoT look)
        velocities[i3 + 1] += gf * 0.35 * liftAmt[i];
      }

      // ── Air resistance (per-leaf personality) ────────────────────────────
      velocities[i3]     *= drag[i];
      velocities[i3 + 2] *= drag[i];

      // ── Integrate ─────────────────────────────────────────────────────────
      positions[i3]     += velocities[i3];
      positions[i3 + 1] += velocities[i3 + 1];
      positions[i3 + 2] += velocities[i3 + 2];

      // ── Floor collision → respawn ─────────────────────────────────────────
      const floor = getTerrainHeight
        ? getTerrainHeight(positions[i3], positions[i3 + 2]) + params.terrainFloorOffset
        : params.terrainFloorOffset;
      if (positions[i3 + 1] < floor) {
        spawnLeaf(i, cx, cz);
        continue;
      }

      // ── Velocity-driven rotation ──────────────────────────────────────────
      // Fast leaves spin fast; gently drifting leaves barely rotate.
      // Feels physical: tumbling in a gust, gliding while settling.
      const spd = Math.abs(velocities[i3]) + Math.abs(velocities[i3 + 1]) + Math.abs(velocities[i3 + 2]);
      const spinFactor = Math.min(spd / Math.max(params.terminalVelocity, 0.001), 2.0);
      const spin = spinRate[i] * (0.25 + spinFactor * 0.75);
      rotations[i3]     += spin + velocities[i3]     * 0.28;
      rotations[i3 + 1] += spin * 0.55;
      rotations[i3 + 2] += spin + velocities[i3 + 2] * 0.28;
    }

    applyMatrices();
  }

  // First frame
  applyMatrices();

  // ── Tweakpane controls ────────────────────────────────────────────────────
  /**
   * Adds a "Leaves V2" folder to the given Tweakpane pane.
   * Returns the folder so the caller can append extra bindings.
   * @param {import('tweakpane').Pane} pane
   */
  function createControls(pane) {
    const folder = pane.addFolder({ title: "Leaves V2", expanded: false });

    // General
    folder.addBinding(params, "enabled",      { label: "enable" });
    folder.addBinding(params, "followCamera", { label: "follow camera" });
    folder.addBinding(params, "count",        { label: "count", min: 10, max: maxCount, step: 10 });
    folder.addBinding(params, "areaSize",     { label: "area size",    min: 20,   max: 400,  step: 5 });
    folder.addBinding(params, "spawnHeight",  { label: "spawn height", min: 3,    max: 80,   step: 1 });
    folder.addBinding(params, "leafSize",     { label: "leaf size",    min: 0.04, max: 1.5,  step: 0.01 });
    folder.addBinding(params, "scale",        { label: "scale",        min: 0.2,  max: 4,    step: 0.05 });
    folder.addBinding(params, "opacity",      { label: "opacity",      min: 0.05, max: 1,    step: 0.05 });

    // Physics
    const phys = folder.addFolder({ title: "Physics", expanded: false });
    phys.addBinding(params, "gravity",          { min: 0,     max: 0.008, step: 0.0002 });
    phys.addBinding(params, "terminalVelocity", { label: "terminal vel",   min: 0.004, max: 0.08, step: 0.002 });
    phys.addBinding(params, "airResistance",    { label: "air resistance", min: 0.97,  max: 1,    step: 0.001 });
    phys.addBinding(params, "liftScale",        { label: "lift strength",  min: 0,     max: 0.004,step: 0.0001 });
    phys.addBinding(params, "liftFreqMin",      { label: "lift freq min",  min: 0.005, max: 0.1,  step: 0.005 });
    phys.addBinding(params, "liftFreqMax",      { label: "lift freq max",  min: 0.005, max: 0.15, step: 0.005 });
    phys.addBinding(params, "spinRateMin",      { label: "spin min",       min: 0,     max: 0.02, step: 0.001 });
    phys.addBinding(params, "spinRateMax",      { label: "spin max",       min: 0,     max: 0.04, step: 0.001 });
    phys.addBinding(params, "maxAge",           { label: "max age (frames)", min: 200, max: 4000, step: 100 });
    phys.addBinding(params, "terrainFloorOffset",{ label: "floor offset",  min: 0.5,  max: 12,   step: 0.5 });

    // Wind & Gusts
    const wind = folder.addFolder({ title: "Wind & Gusts", expanded: false });
    wind.addBinding(params, "windInfluence",    { label: "wind influence",  min: 0, max: 3,    step: 0.05 });
    wind.addBinding(params, "gustProbability",  { label: "gust probability",min: 0, max: 0.02, step: 0.0005 });
    wind.addBinding(params, "gustStrength",     { label: "gust strength",   min: 0, max: 3,    step: 0.1 });
    wind.addButton({ title: "Trigger Gust Now" }).on("click", () => {
      if (!gust.active) {
        gust.active   = true;
        gust.timer    = 0;
        gust.duration = 80;
        const angle   = Math.random() * Math.PI * 2;
        gust.dirX     = Math.cos(angle);
        gust.dirZ     = Math.sin(angle);
        gust.force    = params.gustStrength * 0.008;
      }
    });

    // Texture / Atlas
    const tex = folder.addFolder({ title: "Texture", expanded: false });
    tex.addBinding(params, "atlasCols", { label: "atlas cols (read-only)", readonly: true });

    // Hidden file input for PNG import
    const fileInput = document.createElement("input");
    fileInput.type    = "file";
    fileInput.accept  = "image/*";
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) loadFromFile(file);
      fileInput.value = "";
    });

    tex.addButton({ title: "Import Atlas PNG…" }).on("click", () => fileInput.click());
    tex.addButton({ title: "Reset to Canvas Fallback" }).on("click", () => {
      setAtlasTexture(createCanvasAtlas(cols));
    });

    return folder;
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    meshes,          // array of InstancedMesh (one per variant)
    params,          // live-tweakable settings
    update,          // update(camera?) — call every frame
    createControls,  // createControls(pane) — adds Tweakpane folder
    loadAtlasUrl,    // loadAtlasUrl(url)
    loadFromFile,    // loadFromFile(file)
    setAtlasTexture, // setAtlasTexture(THREE.Texture)
    dispose() {
      meshes.forEach((m) => scene.remove(m));
      geo.dispose();
      materials.forEach((mat) => { mat.map?.dispose(); mat.dispose(); });
      if (fileInput?.parentNode) fileInput.parentNode.removeChild(fileInput);
    },
  };
}
