/**
 * fx-leaves-physics.js
 * Port of folio-2025 Leaves.js (Bruno Simon) to the Ambient FX Editor.
 *
 * Design:
 *  - GPU compute kernel (TSL) drives per-leaf position + velocity in
 *    instancedArray buffers — no per-frame CPU loop over leaves.
 *  - "Physics" push comes from an AgentProbe (position + velocity uniforms);
 *    the folio version reads `physicalVehicle.position/velocity`, here we
 *    drive those uniforms with either the mouse (raycast to ground) or
 *    WASD-controlled kinematic capsule. The compute shader is identical.
 *  - Wind uses mx_noise_float (procedural) instead of folio's perlin texture.
 *  - Terrain height matches the editor's CPU terrainHeight() formula,
 *    reimplemented in TSL so leaves clamp to bumpy ground on the GPU.
 *  - Focus point follows OrbitControls target so leaves tile around the
 *    camera (folio uses view.optimalArea.position).
 *
 * No water / wetness / shadow-fade: the editor scene has no water surface,
 * and shadow tuning is optional. Easy to add later via uniforms.
 */

import * as THREE from "three/webgpu";
import {
  color,
  cos,
  float,
  Fn,
  hash,
  instancedArray,
  instanceIndex,
  max,
  mix,
  mod,
  mx_noise_float,
  positionGeometry,
  rotateUV,
  sin,
  step,
  texture,
  uniform,
  vec2,
  vec3,
} from "three/tsl";

// ──────────────────────────────────────────────────────────────────────────────
// Leaf texture gallery (mirrors fx-ghost-leaves.js so both effects share the
// same built-in PNGs without depending on each other). Add paths here to
// expand the picker.
// ──────────────────────────────────────────────────────────────────────────────

export const BUILTIN_LEAF_TEXTURES = [
  { name: "Leaf 1",   path: "textures/leaf1-tiny.png" },
  { name: "Petal",    path: "textures/petal-alpha.png" },
  { name: "SDF",      path: "textures/leaves/foliageSDF.png" },
  { name: "Leaf 7",   path: "textures/leaves/Frame 7.png" },
  { name: "Leaf 128", path: "textures/leaves/image 128.png" },
  { name: "Leafcard", path: "textures/leaves/leafcard.jpg" },
  { name: "Pine",     path: "textures/pine-leaves/Frame 56.png" },
  { name: "Flower",   path: "textures/flowers/Flower32.png" },
];

// Sparse sample to detect whether the image carries useful alpha (RGBA leaf)
// or is a B&W mask (alpha solid). Drives the uMaskInAlpha uniform.
function detectAlphaChannel(image) {
  try {
    const w = image.width || image.naturalWidth;
    const h = image.height || image.naturalHeight;
    if (!w || !h) return false;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 16) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch (_e) {
    return false;
  }
}

function configureLeafTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.flipY = false;
  tex.needsUpdate = true;
}

// ──────────────────────────────────────────────────────────────────────────────
// AgentProbe — small actor whose (position, velocity) feeds the leaves' push.
// In the v2 editor, swap this out for a binding to the car/character body.
// ──────────────────────────────────────────────────────────────────────────────

class AgentProbe {
  constructor({ scene, camera, canvas, terrainHeight, groundYRef }) {
    this.scene = scene;
    this.camera = camera;
    this.canvas = canvas;
    this.terrainHeight = terrainHeight;
    this.groundYRef = groundYRef;

    this.position = new THREE.Vector3(0, 0, 0);
    this.prevPosition = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.radius = 1.0;
    this.mode = "mouse";
    this.wasdSpeed = 8.0;

    // Wireframe capsule gizmo (always-on-top so it stays visible over leaves).
    const gizmoGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.6, 12, 1, true);
    const gizmoMat = new THREE.MeshBasicMaterial({
      color: 0xffaa44,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    this.gizmo = new THREE.Mesh(gizmoGeo, gizmoMat);
    this.gizmo.renderOrder = 999;
    this.gizmo.frustumCulled = false;
    this.scene.add(this.gizmo);

    // Input state.
    this._mouseNdc = new THREE.Vector2();
    this._mouseValid = false;
    this._raycaster = new THREE.Raycaster();
    // Plane normal up, constant set per-frame to current ground level.
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
    this._keys = new Set();

    this._onPointerMove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this._mouseNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._mouseNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this._mouseValid = true;
    };
    this._onPointerLeave = () => {
      this._mouseValid = false;
    };
    this._onKeyDown = (e) => {
      this._keys.add(e.code);
    };
    this._onKeyUp = (e) => {
      this._keys.delete(e.code);
    };

    this.canvas.addEventListener("pointermove", this._onPointerMove);
    this.canvas.addEventListener("pointerleave", this._onPointerLeave);
    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);
  }

  setMode(mode) {
    this.mode = mode;
  }

  setVisible(v) {
    this.gizmo.visible = v;
  }

  setRadius(r) {
    this.radius = r;
    this.gizmo.scale.setScalar(r);
  }

  update(dt) {
    this.prevPosition.copy(this.position);

    if (this.mode === "mouse") {
      if (this._mouseValid) {
        // Use a horizontal plane at the current local terrain height as the
        // intersection target. Cheap and visually close enough on gentle hills.
        const groundY =
          this.terrainHeight(this.position.x, this.position.z) +
          (this.groundYRef?.value ?? 0);
        // Plane equation: y = groundY  →  n·p + d = 0  with n=(0,1,0)  →  d = -groundY.
        this._plane.constant = -groundY;
        this._raycaster.setFromCamera(this._mouseNdc, this.camera);
        if (this._raycaster.ray.intersectPlane(this._plane, this._hit)) {
          this.position.x = this._hit.x;
          this.position.z = this._hit.z;
        }
      }
    } else if (this.mode === "wasd") {
      // Camera-relative forward / right, projected to XZ.
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      let mx = 0;
      let mz = 0;
      if (this._keys.has("KeyW") || this._keys.has("ArrowUp")) mz += 1;
      if (this._keys.has("KeyS") || this._keys.has("ArrowDown")) mz -= 1;
      if (this._keys.has("KeyD") || this._keys.has("ArrowRight")) mx += 1;
      if (this._keys.has("KeyA") || this._keys.has("ArrowLeft")) mx -= 1;
      if (mx !== 0 || mz !== 0) {
        const move = new THREE.Vector3()
          .addScaledVector(fwd, mz)
          .addScaledVector(right, mx)
          .normalize()
          .multiplyScalar(this.wasdSpeed * dt);
        this.position.x += move.x;
        this.position.z += move.z;
      }
    }

    this.position.y =
      this.terrainHeight(this.position.x, this.position.z) +
      (this.groundYRef?.value ?? 0);

    if (dt > 0) {
      this.velocity
        .subVectors(this.position, this.prevPosition)
        .divideScalar(dt);
    } else {
      this.velocity.set(0, 0, 0);
    }

    // Lift gizmo so its center sits ~capsule-half above feet.
    this.gizmo.position.set(
      this.position.x,
      this.position.y + 0.8 * this.radius,
      this.position.z
    );
  }

  dispose() {
    this.canvas.removeEventListener("pointermove", this._onPointerMove);
    this.canvas.removeEventListener("pointerleave", this._onPointerLeave);
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    this.scene.remove(this.gizmo);
    this.gizmo.geometry.dispose();
    this.gizmo.material.dispose();
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// World-space terrain samplers (TSL + CPU mirrors of the editor's formula).
//
// IMPORTANT — Z convention:
//   The editor builds the ground by displacing a PlaneGeometry along its
//   *local* Z via `terrainHeight(localX, localY)`, THEN rotating it -π/2 about
//   X. That rotation maps local (x, y) → world (x, -y), so the *visible*
//   ground Y at world (X, Z) equals `editorTerrainHeight(X, -Z)`. We apply
//   that negation here so both samplers return world-space Y given world XZ
//   — matching whatever the user actually sees.
// ──────────────────────────────────────────────────────────────────────────────

function buildTerrainHeightTSL(groundYUniform) {
  return (xz) => {
    const x = xz.x;
    const z = xz.y.negate();
    const base = sin(x.mul(0.25))
      .mul(cos(z.mul(0.2)))
      .mul(0.5)
      .add(sin(x.mul(0.15).add(z.mul(0.1))).mul(0.3))
      .add(cos(z.mul(0.3).add(x.mul(0.05))).mul(0.2));
    return base.mul(3.0).add(groundYUniform);
  };
}

// CPU fallback (used by the probe before setTerrainHeight is called).
// setTerrainHeight expects a world-space sampler; the editor wraps its own
// terrainHeight with `-z` at the call site to honour the convention above.
function defaultTerrainHeight(x, z) {
  const zz = -z;
  const base =
    Math.sin(x * 0.25) * Math.cos(zz * 0.2) * 0.5 +
    Math.sin(x * 0.15 + zz * 0.1) * 0.3 +
    Math.cos(zz * 0.3 + x * 0.05) * 0.2;
  return base * 3.0;
}

// ──────────────────────────────────────────────────────────────────────────────
// Effect factory
// ──────────────────────────────────────────────────────────────────────────────

export function createLeavesPhysicsFX(scene, shared, renderer) {
  const params = {
    // String-typed so the inspector renders it as a dropdown (its addBinding
    // dispatches on value type before checking `opts.options`; a numeric
    // binding would be turned into a 0..1 slider). build() coerces via
    // Number() when allocating buffers.
    count: "2048",
    sizeRadius: 30,
    scale: 0.25,
    rotationFrequency: 3,
    rotationElevationMultiplier: 1,
    pushSidewaysMultiplier: 20,
    pushMultiplier: 100,
    windFrequency: 0.005,
    windMultiplier: 0,
    upwardMultiplier: 1,
    defaultDamping: 1.5,
    gravity: 9.807,
    colorA: "#95513a",
    colorB: "#f56a3a",
    opacity: 1.0,
    castShadows: true,

    texturePath: BUILTIN_LEAF_TEXTURES[0].path,
    customName: "",

    probeMode: "wasd",
    probeRadius: 1.0,
    showProbe: true,
    wasdSpeed: 8.0,
  };

  let camera = null;
  let controls = null;
  let probe = null;
  let terrainHeightFn = defaultTerrainHeight;
  let built = null;
  // Rebuilds happen at most once per animate() tick to avoid
  //   1) tearing the compute kernel down while last frame's commands are
  //      still pending on the GPU (→ "Binding size … is zero" / "Invalid
  //      CommandBuffer" errors), and
  //   2) re-allocating instancedArray buffers dozens of times when the user
  //      drags a slider quickly.
  let _rebuildPending = false;
  // Our custom inspector has no concept of "last change" on a slider, so we
  // debounce here: the actual _rebuildPending flip happens 200 ms after the
  // user stops touching the control. Per-frame coalescing then turns it into
  // one rebuild on the next animate() tick.
  let _rebuildDebounceTimer = null;
  // Old built groups are disposed one frame *after* they were unmounted so
  // any in-flight compute/render commands referencing their buffers drain
  // before WebGPU frees the underlying storage.
  const _disposeQueue = [];

  // Swappable texture node — lives at factory scope so live swaps survive
  // count-driven material/buffer rebuilds. The material samples through
  // leafMapNode and we just reassign .value when the user picks a new image.
  const leafMapNode = texture(new THREE.Texture());
  const uMaskInAlpha = uniform(0.0);
  const uOpacity = uniform(params.opacity);

  function destroyBuilt() {
    if (!built) return;
    scene.remove(built.mesh);
    // Defer dispose by one frame (see _disposeQueue comment).
    _disposeQueue.push(built);
    built = null;
  }

  function flushDisposeQueue() {
    if (_disposeQueue.length === 0) return;
    for (const old of _disposeQueue) {
      old.geometry.dispose();
      old.material.dispose();
    }
    _disposeQueue.length = 0;
  }

  function build() {
    destroyBuilt();

    // Coerce in case Tweakpane hands us a string from a dropdown.
    const count = Math.max(1, Math.floor(Number(params.count) || 2048));
    const size = Math.max(1, Number(params.sizeRadius) || 30) * 2;

    // ── Geometry: stretched plane → diamond/rectangle leaf ──────────────
    const geometry = new THREE.PlaneGeometry(1, 1);
    const posArr = geometry.attributes.position.array;
    posArr[0] += 0.15;
    posArr[3] += 0.15;
    posArr[6] -= 0.15;
    posArr[9] -= 0.15;
    geometry.rotateX(-Math.PI * 0.5);

    // ── Uniforms ─────────────────────────────────────────────────────────
    const focusPoint = uniform(vec2());
    const probePosition = uniform(vec3());
    const probeVelocity = uniform(vec3());
    const scaleU = uniform(params.scale);
    const rotationFrequencyU = uniform(params.rotationFrequency);
    const rotationElevationMultiplierU = uniform(
      params.rotationElevationMultiplier
    );
    const pushSidewaysMultiplierU = uniform(params.pushSidewaysMultiplier);
    const pushMultiplierU = uniform(params.pushMultiplier);
    const windFrequencyU = uniform(params.windFrequency);
    const windMultiplierU = uniform(params.windMultiplier);
    const upwardMultiplierU = uniform(params.upwardMultiplier);
    const defaultDampingU = uniform(params.defaultDamping);
    const gravityU = uniform(params.gravity);
    const colorAU = uniform(color(params.colorA));
    const colorBU = uniform(color(params.colorB));
    const sizeU = uniform(size);
    const groundYU = uniform(shared.groundY || 0);
    const windDirectionU = uniform(
      new THREE.Vector2(shared.windX, shared.windZ)
    );
    const windStrengthU = uniform(shared.windStrength);
    const windLocalTimeU = uniform(0);
    const dtU = uniform(0.016);

    // ── Per-leaf buffers ─────────────────────────────────────────────────
    const positionBuffer = instancedArray(count, "vec3");
    const velocityBuffer = instancedArray(count, "vec3");

    const baseRotationArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      baseRotationArr[i] = Math.random() * Math.PI * 2;
    }
    const baseRotationBuffer = instancedArray(
      baseRotationArr,
      "float"
    ).toAttribute();

    const scaleArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      scaleArr[i] = Math.random() * 0.5 + 0.5;
    }
    const scaleBuffer = instancedArray(scaleArr, "float").toAttribute();

    const weightArr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      weightArr[i] = Math.random() * 0.1 + 0.1;
    }
    const weightBuffer = instancedArray(weightArr, "float");

    const normalArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const n = new THREE.Vector3(0, 1, 0);
      n.applyAxisAngle(
        new THREE.Vector3(1, 0, 0),
        (Math.random() - 0.5) * 2
      );
      n.applyAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (Math.random() - 0.5) * 2
      );
      n.toArray(normalArr, i * 3);
    }
    const normalBuffer = instancedArray(normalArr, "vec3").toAttribute();

    // ── Color + alpha ────────────────────────────────────────────────────
    // The per-leaf tint mixes two browns/oranges via a hash on instanceIndex.
    // Texture sampling supports both RGBA leaves (color from texture, alpha
    // from .a) and B&W masks (color from tint only, alpha from .r) — selected
    // via uMaskInAlpha which is auto-set by detectAlphaChannel on load.
    const tintNode = Fn(() => {
      const mixStrength = hash(instanceIndex.add(99));
      return vec3(mix(colorAU, colorBU, mixStrength));
    })();

    // In RGBA mode (uMaskInAlpha=1): albedo = tex.rgb * tint, mask = tex.a.
    // In B&W mode  (uMaskInAlpha=0): albedo = tint,           mask = tex.r.
    const texColor = mix(vec3(1.0, 1.0, 1.0), leafMapNode.rgb, uMaskInAlpha);
    const maskCh = mix(leafMapNode.r, leafMapNode.a, uMaskInAlpha);
    const albedoNode = texColor.mul(tintNode);
    const alphaNode = maskCh.mul(uOpacity);

    // ── Material ─────────────────────────────────────────────────────────
    const material = new THREE.MeshStandardNodeMaterial({
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0.0,
      transparent: true,
    });
    material.colorNode = albedoNode;
    material.opacityNode = alphaNode;
    // Static alphaTest drives both the color-pass discard AND the shadow
    // depth-pass discard in NodeMaterial — so leaf-shaped shadows fall out
    // of correctly setting opacityNode + a >0 alphaTest.
    material.alphaTest = 0.15;
    // Per-instance normal so leaves shade differently → less "flat carpet" look.
    // Mesh is identity-transformed, so object-space normal == world-space normal.
    material.normalNode = normalBuffer;

    // ── Vertex displacement: base rect → scaled, tilted, world-positioned ─
    material.positionNode = Fn(() => {
      const leavePosition = positionBuffer.toAttribute();
      const newPosition = positionGeometry.mul(scaleBuffer).mul(scaleU);

      // Subtle "lift-and-tumble" that increases with altitude so airborne
      // leaves visibly twirl. On the ground (y≈0) rotation contribution is 0.
      const rotationMultiplier = max(
        leavePosition.y.mul(rotationElevationMultiplierU),
        0
      );
      const rotationZ = sin(leavePosition.x.mul(rotationFrequencyU)).mul(
        rotationMultiplier
      );
      const rotationX = sin(leavePosition.z.mul(rotationFrequencyU)).mul(
        rotationMultiplier
      );
      const rotationY = baseRotationBuffer;

      newPosition.xy.assign(rotateUV(newPosition.xy, rotationZ, vec2(0)));
      newPosition.yz.assign(rotateUV(newPosition.yz, rotationX, vec2(0)));
      newPosition.xz.assign(rotateUV(newPosition.xz, rotationY, vec2(0)));

      return newPosition.add(leavePosition);
    })();

    // ── Init compute: spread leaves in a sizeU × sizeU tile around origin ─
    const terrainTSL = buildTerrainHeightTSL(groundYU);

    const init = Fn(() => {
      const position = positionBuffer.element(instanceIndex);
      position.assign(
        vec3(
          hash(instanceIndex).sub(0.5).mul(sizeU),
          0,
          hash(instanceIndex.add(1)).sub(0.5).mul(sizeU)
        )
      );
    })();
    renderer.computeAsync(init.compute(count));

    // ── Update compute (the actual "physics") ────────────────────────────
    const updateKernel = Fn(() => {
      const position = positionBuffer.element(instanceIndex);
      const velocity = velocityBuffer.element(instanceIndex);
      const weight = weightBuffer.element(instanceIndex);

      // Push from agent (mouse / WASD capsule / future: car body).
      const probeDelta = position.sub(probePosition);
      const pushSideways = vec3(probeDelta.x, 0, probeDelta.z)
        .normalize()
        .mul(pushSidewaysMultiplierU);
      const pushVelocity = vec3(probeVelocity.x, 0, probeVelocity.z).mul(
        pushMultiplierU
      );
      const distanceToProbe = probeDelta.length();
      const probeFalloff = distanceToProbe.remapClamp(0.5, 2, 1, 0);
      const probeSpeed = probeVelocity.length();
      const probePush = pushVelocity
        .add(pushSideways)
        .mul(probeSpeed)
        .mul(probeFalloff);
      velocity.addAssign(probePush);

      // Wind (procedural noise — folio uses a perlin texture).
      const noiseInput = position.xz
        .mul(windFrequencyU)
        .add(windDirectionU.mul(windLocalTimeU));
      const noise01 = mx_noise_float(vec3(noiseInput.x, 0, noiseInput.y))
        .mul(0.5)
        .add(0.5);
      const wind = windStrengthU
        .sub(noise01)
        .mul(weight)
        .mul(windMultiplierU)
        .max(0);
      velocity.x.addAssign(windDirectionU.x.mul(wind));
      velocity.z.addAssign(windDirectionU.y.mul(wind));

      // Upward "carried" effect: airborne leaves with horizontal speed
      // gain vertical velocity (so wind+push lifts them off the ground).
      const upwardDim = position.y.sub(groundYU).remapClamp(0, 6, 1, 0);
      velocity.y = velocity.xz
        .length()
        .min(2)
        .mul(upwardMultiplierU)
        .mul(upwardDim);

      // Damping — only kicks in when airborne (above terrain).
      const inAir = step(0.05, position.y.sub(groundYU)).mul(defaultDampingU);
      const damping = inAir.mul(dtU);
      velocity.mulAssign(float(1).sub(damping));

      // Gravity.
      velocity.y = velocity.y.sub(gravityU.mul(weight));

      // Integrate.
      position.addAssign(velocity.mul(dtU));

      // Clamp to terrain (folio clamps to a wetness-blended flat floor;
      // we clamp to the bumpy procedural ground so leaves drape correctly).
      const floorY = terrainTSL(position.xz).add(0.02);
      position.y.assign(max(position.y, floorY));

      // Wrap-around the focus point so leaves tile with the camera (folio
      // "rolling box" trick: pos = mod(pos - focus + R, 2R) - R + focus).
      const halfSize = sizeU.mul(0.5);
      position.x.assign(
        mod(position.x.add(halfSize).sub(focusPoint.x), sizeU)
          .sub(halfSize)
          .add(focusPoint.x)
      );
      position.z.assign(
        mod(position.z.add(halfSize).sub(focusPoint.y), sizeU)
          .sub(halfSize)
          .add(focusPoint.y)
      );
    })();
    const updateCompute = updateKernel.compute(count);

    // ── Mesh ─────────────────────────────────────────────────────────────
    const mesh = new THREE.Mesh(geometry, material);
    mesh.count = count;
    mesh.frustumCulled = false;
    mesh.castShadow = params.castShadows;
    mesh.receiveShadow = true;
    mesh.renderOrder = 2;
    scene.add(mesh);

    built = {
      mesh,
      material,
      geometry,
      updateCompute,
      uniforms: {
        focusPoint,
        probePosition,
        probeVelocity,
        scaleU,
        rotationFrequencyU,
        rotationElevationMultiplierU,
        pushSidewaysMultiplierU,
        pushMultiplierU,
        windFrequencyU,
        windMultiplierU,
        upwardMultiplierU,
        defaultDampingU,
        gravityU,
        colorAU,
        colorBU,
        sizeU,
        groundYU,
        windDirectionU,
        windStrengthU,
        windLocalTimeU,
        dtU,
      },
    };
  }

  // ── Public API ────────────────────────────────────────────────────────
  function setView(cam, ctrl) {
    camera = cam;
    controls = ctrl;
    if (!probe && renderer && camera) {
      probe = new AgentProbe({
        scene,
        camera,
        canvas: renderer.domElement,
        terrainHeight: (x, z) => terrainHeightFn(x, z),
        groundYRef: { value: shared.groundY || 0 },
      });
      probe.setVisible(params.showProbe);
      probe.setRadius(params.probeRadius);
      probe.setMode(params.probeMode);
      probe.wasdSpeed = params.wasdSpeed;
    }
  }

  function setTerrainHeight(fn) {
    terrainHeightFn = fn;
    if (probe) probe.terrainHeight = (x, z) => terrainHeightFn(x, z);
  }

  function update(dt, _elapsed, sh) {
    // Drain GPU resources from the previous frame's destroy() before doing
    // anything else this frame — by now their last command buffer has run.
    flushDisposeQueue();

    if (_rebuildPending) {
      _rebuildPending = false;
      build();
    }

    if (!built) {
      build();
      // First-build: kick off the default texture load. Subsequent rebuilds
      // (count/sizeRadius changes) keep whatever texture was last picked.
      if (params.texturePath) setTextureFromPath(params.texturePath);
    }
    const u = built.uniforms;

    uOpacity.value = params.opacity;
    if (built.mesh.castShadow !== params.castShadows) {
      built.mesh.castShadow = params.castShadows;
    }

    u.scaleU.value = params.scale;
    u.rotationFrequencyU.value = params.rotationFrequency;
    u.rotationElevationMultiplierU.value = params.rotationElevationMultiplier;
    u.pushSidewaysMultiplierU.value = params.pushSidewaysMultiplier;
    u.pushMultiplierU.value = params.pushMultiplier;
    u.windFrequencyU.value = params.windFrequency;
    u.windMultiplierU.value = params.windMultiplier;
    u.upwardMultiplierU.value = params.upwardMultiplier;
    u.defaultDampingU.value = params.defaultDamping;
    u.gravityU.value = params.gravity;
    u.colorAU.value.set(params.colorA);
    u.colorBU.value.set(params.colorB);
    u.sizeU.value = params.sizeRadius * 2;

    u.groundYU.value = sh.groundY || 0;
    u.windDirectionU.value.set(sh.windX, sh.windZ);
    u.windStrengthU.value = sh.windStrength;
    u.windLocalTimeU.value += dt * 0.25;
    // Clamp dt so a tab-switch / hiccup doesn't catapult leaves into space.
    u.dtU.value = Math.min(dt, 1 / 30);

    // Focus point follows the orbit target so leaves tile around the camera.
    const focus = controls ? controls.target : { x: 0, z: 0 };
    u.focusPoint.value.set(focus.x, focus.z);

    if (probe) {
      probe.groundYRef.value = sh.groundY || 0;
      probe.update(u.dtU.value);
      u.probePosition.value.copy(probe.position);
      u.probeVelocity.value.copy(probe.velocity);
    } else {
      // Park the probe far below so its push falloff (0.5..2) never activates.
      u.probePosition.value.set(0, -9999, 0);
      u.probeVelocity.value.set(0, 0, 0);
    }

    renderer.computeAsync(built.updateCompute);
  }

  function dispose(_sc) {
    if (_rebuildDebounceTimer) {
      clearTimeout(_rebuildDebounceTimer);
      _rebuildDebounceTimer = null;
    }
    _rebuildPending = false;
    destroyBuilt();
    flushDisposeQueue();
    if (probe) {
      probe.dispose();
      probe = null;
    }
  }

  // Schedule a rebuild. We debounce by 200 ms (so dragging a slider doesn't
  // fire dozens of rebuilds), then flip the per-frame pending flag — the
  // actual destroy+build happens at the top of the next update() tick.
  function rebuildCount() {
    if (_rebuildDebounceTimer) clearTimeout(_rebuildDebounceTimer);
    _rebuildDebounceTimer = setTimeout(() => {
      _rebuildDebounceTimer = null;
      _rebuildPending = true;
    }, 200);
  }

  function setProbeMode(m) {
    params.probeMode = m;
    if (probe) probe.setMode(m);
  }

  // ── Texture swap (live, no rebuild) ───────────────────────────────────
  function setTextureFromPath(path) {
    const loader = new THREE.TextureLoader();
    loader.load(
      path,
      (tex) => {
        configureLeafTexture(tex);
        leafMapNode.value = tex;
        uMaskInAlpha.value = detectAlphaChannel(tex.image) ? 1.0 : 0.0;
        params.texturePath = path;
        params.customName = "";
      },
      undefined,
      (err) => {
        console.error("Leaves (Physics): failed to load texture", path, err);
      }
    );
  }

  function setTextureFromDataUrl(dataUrl, name) {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      configureLeafTexture(tex);
      leafMapNode.value = tex;
      uMaskInAlpha.value = detectAlphaChannel(img) ? 1.0 : 0.0;
      params.texturePath = "";
      params.customName = name || "(custom)";
    };
    img.src = dataUrl;
  }

  return {
    update,
    dispose,
    params,
    setView,
    setTerrainHeight,
    rebuildCount,
    setProbeMode,
    setTextureFromPath,
    setTextureFromDataUrl,
    getProbe: () => probe,
    builtinTextures: BUILTIN_LEAF_TEXTURES,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Tweakpane UI
// ──────────────────────────────────────────────────────────────────────────────

export function buildLeavesPhysicsUI(folder, state, _shared) {
  const p = state.params;

  // ── Texture picker (built-in gallery + custom upload) ────────────────
  // Inspector helper from inspector.js; if it isn't available (older builds)
  // we skip silently so the rest of the panel still renders.
  if (folder.addTexturePicker) {
    folder.addTexturePicker({
      label: "Leaf Texture",
      builtins: state.builtinTextures,
      getCurrentPath: () => p.texturePath,
      getCurrentName: () => p.customName,
      onBuiltinSelect: (path) => state.setTextureFromPath(path),
      onCustomLoad: (dataUrl, name) =>
        state.setTextureFromDataUrl(dataUrl, name),
    });
    folder.addBlade({ view: "separator" });
  }

  // Leaf Count is a dropdown — the binding value (p.count) is kept as a
  // *string* so the inspector dispatches to its select widget instead of
  // turning a number binding into a 0..1 slider. build() coerces via Number.
  folder
    .addBinding(p, "count", {
      label: "Leaf Count",
      options: {
        "512": "512",
        "1024": "1024",
        "2048": "2048",
        "4096": "4096",
        "8192": "8192",
      },
    })
    .on("change", () => state.rebuildCount());

  // Tile Radius is a slider. state.rebuildCount() debounces internally so
  // dragging the slider results in a single rebuild ~200 ms after release.
  folder
    .addBinding(p, "sizeRadius", {
      label: "Tile Radius",
      min: 10,
      max: 120,
      step: 1,
    })
    .on("change", () => state.rebuildCount());

  folder.addBlade({ view: "separator" });

  folder.addBinding(p, "scale", {
    label: "Leaf Scale",
    min: 0,
    max: 1,
    step: 0.001,
  });
  folder.addBinding(p, "opacity", {
    label: "Opacity",
    min: 0.1,
    max: 1,
    step: 0.01,
  });
  folder.addBinding(p, "castShadows", { label: "Cast Shadows" });
  folder.addBinding(p, "colorA", { label: "Color A" });
  folder.addBinding(p, "colorB", { label: "Color B" });

  const tum = folder.addFolder({ title: "Tumble", expanded: false });
  tum.addBinding(p, "rotationFrequency", {
    label: "Rot Frequency",
    min: 0,
    max: 20,
    step: 0.01,
  });
  tum.addBinding(p, "rotationElevationMultiplier", {
    label: "Rot Elev Mul",
    min: 0,
    max: 2,
    step: 0.001,
  });

  const wnd = folder.addFolder({ title: "Wind", expanded: false });
  wnd.addBinding(p, "windFrequency", {
    label: "Wind Freq",
    min: 0,
    max: 0.02,
    step: 0.00001,
  });
  wnd.addBinding(p, "windMultiplier", {
    label: "Wind Mul",
    min: 0,
    max: 10,
    step: 0.0001,
  });

  const phys = folder.addFolder({ title: "Physics", expanded: true });
  phys.addBinding(p, "pushSidewaysMultiplier", {
    label: "Push Sideways",
    min: 0,
    max: 300,
    step: 1,
  });
  phys.addBinding(p, "pushMultiplier", {
    label: "Push Forward",
    min: 0,
    max: 300,
    step: 1,
  });
  phys.addBinding(p, "upwardMultiplier", {
    label: "Upward Mul",
    min: 0,
    max: 10,
    step: 0.01,
  });
  phys.addBinding(p, "defaultDamping", {
    label: "Damping",
    min: 0,
    max: 10,
    step: 0.01,
  });
  phys.addBinding(p, "gravity", {
    label: "Gravity",
    min: 0,
    max: 20,
    step: 0.01,
  });

  const probeF = folder.addFolder({ title: "Agent Probe", expanded: true });
  probeF
    .addBinding(p, "probeMode", {
      label: "Mode",
      options: { Mouse: "mouse", WASD: "wasd" },
    })
    .on("change", (ev) => state.setProbeMode(ev.value));
  probeF
    .addBinding(p, "probeRadius", {
      label: "Radius",
      min: 0.3,
      max: 4,
      step: 0.05,
    })
    .on("change", () => {
      const pr = state.getProbe();
      if (pr) pr.setRadius(p.probeRadius);
    });
  probeF
    .addBinding(p, "wasdSpeed", {
      label: "WASD Speed",
      min: 1,
      max: 30,
      step: 0.5,
    })
    .on("change", () => {
      const pr = state.getProbe();
      if (pr) pr.wasdSpeed = p.wasdSpeed;
    });
  probeF
    .addBinding(p, "showProbe", { label: "Show Gizmo" })
    .on("change", () => {
      const pr = state.getProbe();
      if (pr) pr.setVisible(p.showProbe);
    });
}
