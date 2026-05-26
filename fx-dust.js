/**
 * fx-dust.js
 * Niagara-style ambient dust motes living in a fixed emitter volume.
 *
 * Design intent (vs the leaves effects):
 *  - Fixed world-space volume (not camera-locked). Snaps to the orbit target
 *    on first selection so the dust appears where you're looking, but does
 *    NOT follow the camera afterwards — pan away and you leave the volume.
 *    Wind drift is contained via mod-based wrap inside the volume.
 *  - 3D-oriented mesh particles (NOT camera-facing billboards). Each
 *    particle has its own hashed yaw + pitch that slowly tumble over time,
 *    so dust visibly catches light at varying angles instead of looking
 *    like flat stickers. Same tumble basis ghost-leaves uses for falling
 *    leaves, just slower.
 *  - Low wind coupling (~0.15) so dust drifts gently rather than streaking.
 *  - Smooth sine-driven life pulse hides the volume wrap by ensuring most
 *    particles are mid-fade when they teleport from one edge to the other.
 *  - Texture system mirrors fx-leaves-physics.js: built-in PNG gallery,
 *    custom file upload, auto B&W-mask vs RGBA detection.
 *  - Additive blending by default — reads as glowing motes in front of dark
 *    backgrounds. Toggleable to normal blending for indoor / dirty dust.
 *
 * Architecture:
 *  - InstancedMesh + MeshBasicNodeMaterial with a custom positionNode that
 *    derives the world position from hashed per-instance seeds + `time` +
 *    a JS-driven volume-center uniform. Zero per-frame CPU work per
 *    particle — all motion lives on the GPU. No compute kernel needed.
 */

import * as THREE from "three/webgpu";
import {
  cos,
  float,
  Fn,
  instanceIndex,
  mix,
  mod,
  pow,
  positionLocal,
  sin,
  texture,
  time,
  uniform,
  vec3,
} from "three/tsl";

const TWO_PI = Math.PI * 2;
const MAX_COUNT = 4096;

// ──────────────────────────────────────────────────────────────────────────────
// Built-in gallery + texture helpers (self-contained, same pattern as
// fx-leaves-physics.js so the picker UX is identical).
// ──────────────────────────────────────────────────────────────────────────────

export const BUILTIN_DUST_TEXTURES = [
  { name: "Dust 35075", path: "textures/dust-png-35075.png" },
  { name: "Dust",       path: "textures/dust.png" },
  { name: "Sparkle",    path: "textures/sparkle-particle.png" },
];

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

function configureDustTexture(tex) {
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

// Per-instance pseudo-random in [0, 1).
function iHash(offset) {
  return float(instanceIndex)
    .add(float(offset))
    .mul(127.1)
    .sin()
    .mul(43758.5453)
    .fract();
}

// ──────────────────────────────────────────────────────────────────────────────
// Factory
// ──────────────────────────────────────────────────────────────────────────────

export function createDustFX(scene, shared) {
  const params = {
    enabled: true,
    // Dropdown — kept as a string so the inspector renders a select instead
    // of turning a number binding into a 0..1 slider. build() coerces.
    count: "600",

    // Fixed emitter volume (world-space). Defaults park the dust around
    // origin; snapCenterToTarget() repositions it at the orbit target.
    centerX: 0,
    centerY: 0,
    centerZ: 0,
    areaSize: 16,            // XZ side length of the volume (square)
    heightMin: 0.4,
    heightMax: 3.5,

    size: 0.16,
    sizeVar: 0.7,

    speed: 0.5,              // wander frequency multiplier
    wanderAmp: 0.6,          // local Brownian sway amplitude
    bobAmp: 0.3,             // vertical bob amplitude
    tumbleSpeed: 0.45,       // per-particle 3D rotation speed
    windCoupling: 0.15,      // low — keeps motion contained
    lifeSpeed: 0.25,         // how fast the appear/disappear pulse cycles

    opacity: 0.55,
    // Alpha boost — multiplies the texture mask by this factor before
    // saturation clamp, which sharpens the soft falloff of a dust PNG into
    // a denser, more solid disc. Different from opacity (which is a linear
    // 0..1 fade): a value of 4 pushes mid-gray mask pixels (≈0.25) up to
    // the saturation ceiling, while fully-transparent pixels stay
    // fully-transparent. Combined with normal blending this is the
    // "make dust look darker / denser" control from typical Niagara tuts.
    alphaBoost: 1.0,
    additive: true,
    colorA: "#d8c8a4",       // warm dust
    colorB: "#cad4dc",       // cool dust
    softness: 0.35,          // pulse curve exponent

    texturePath: BUILTIN_DUST_TEXTURES[0].path,
    customName: "",
  };

  let camera = null;
  let controls = null;
  let _hasSnapped = false;

  // Swappable texture node — survives count rebuilds.
  const dustMapNode = texture(new THREE.Texture());
  const uMaskInAlpha = uniform(0.0);

  // Uniforms exposed to the shader.
  const u = {
    center:       uniform(new THREE.Vector3(params.centerX, params.centerY, params.centerZ)),
    areaSize:     uniform(float(params.areaSize)),
    heightMin:    uniform(float(params.heightMin)),
    heightMax:    uniform(float(params.heightMax)),
    groundY:      uniform(float(shared.groundY || 0)),
    size:         uniform(float(params.size)),
    sizeVar:      uniform(float(params.sizeVar)),
    speed:        uniform(float(params.speed)),
    wanderAmp:    uniform(float(params.wanderAmp)),
    bobAmp:       uniform(float(params.bobAmp)),
    tumbleSpeed:  uniform(float(params.tumbleSpeed)),
    windX:        uniform(float(0)),
    windZ:        uniform(float(0)),
    lifeSpeed:    uniform(float(params.lifeSpeed)),
    opacity:      uniform(float(params.opacity)),
    alphaBoost:   uniform(float(params.alphaBoost)),
    softness:     uniform(float(params.softness)),
    colorA:       uniform(new THREE.Color(params.colorA)),
    colorB:       uniform(new THREE.Color(params.colorB)),
  };

  // ── Build the TSL material once (per-instance behavior is all hashed off
  //    instanceIndex, so we don't rebuild the material on count changes; we
  //    just resize the InstancedMesh).
  function buildMaterial() {
    // Per-instance seeds.
    const h0  = iHash(0);
    const h1  = iHash(1);
    const h2  = iHash(2);
    const h3  = iHash(3);
    const h4  = iHash(4);
    const h5  = iHash(5);
    const h6  = iHash(6);
    const h7  = iHash(7);
    const h8  = iHash(8);
    const h9  = iHash(9);
    const h10 = iHash(10);
    const h11 = iHash(11);
    const h12 = iHash(12);
    const h13 = iHash(13);

    // ── XZ base position uniformly inside the fixed volume.
    const halfArea = u.areaSize.mul(0.5);
    const baseX = h0.mul(2.0).sub(1.0).mul(halfArea);
    const baseZ = h1.mul(2.0).sub(1.0).mul(halfArea);

    // Slow per-particle wander (different frequency + phase per particle).
    const wPhase = h2.mul(TWO_PI);
    const wFreq = h3.mul(0.5).add(0.75);
    const wT = time.mul(u.speed).mul(wFreq).add(wPhase);
    const wanderX = sin(wT).mul(u.wanderAmp);
    const wanderZ = cos(wT.mul(1.3)).mul(u.wanderAmp);

    // Light wind drift (windX/Z already pre-scaled by coupling on the JS side
    // so the shader stays uncluttered).
    const driftX = u.windX.mul(time);
    const driftZ = u.windZ.mul(time);

    const rawX = baseX.add(wanderX).add(driftX);
    const rawZ = baseZ.add(wanderZ).add(driftZ);

    // ── Volume wrap: mod-based, contains wind drift forever inside the
    //    fixed volume so dust never leaks away. The life-pulse fade hides
    //    the moment a particle teleports from one edge to the other.
    const wrapX = mod(rawX.add(halfArea), u.areaSize).sub(halfArea);
    const wrapZ = mod(rawZ.add(halfArea), u.areaSize).sub(halfArea);
    const worldX = u.center.x.add(wrapX);
    const worldZ = u.center.z.add(wrapZ);

    // ── Vertical: hashed band height + slow bob, anchored to center.y
    //    plus the editor's groundY offset.
    const bandY = mix(u.heightMin, u.heightMax, h4);
    const bobPhase = h5.mul(TWO_PI);
    const bobFreq = h6.mul(0.6).add(0.7);
    const bob = sin(time.mul(bobFreq).mul(0.5).add(bobPhase)).mul(u.bobAmp);
    const worldY = u.center.y.add(u.groundY).add(bandY).add(bob);

    const worldCenter = vec3(worldX, worldY, worldZ);

    // ── Per-particle 3D tumble basis (yaw + pitch evolve over time with
    //    per-particle rates and phases). Dust catches light at varying
    //    angles instead of looking like flat camera-facing stickers.
    const yawRate = h7.mul(0.6).add(0.7);
    const pitRate = h8.mul(0.5).add(0.6);
    const yawA = time.mul(u.tumbleSpeed).mul(yawRate).add(h9.mul(TWO_PI));
    const pitA = time
      .mul(u.tumbleSpeed)
      .mul(pitRate)
      .mul(0.7)
      .add(h10.mul(TWO_PI));
    const cy = cos(yawA);
    const sy = sin(yawA);
    const cp = cos(pitA);
    const sp = sin(pitA);
    // Right and Up basis vectors for the rotated quad; columns of the
    // rotation matrix (yaw around Y then pitch around the new X).
    const rightV = vec3(cy, float(0.0), sy.negate());
    const upV = vec3(sp.mul(sy), cp, sp.mul(cy));

    // Per-particle size jitter in [1 - var/2, 1 + var/2].
    const sizeJit = h11.mul(u.sizeVar).add(float(1.0).sub(u.sizeVar.mul(0.5)));
    const finalSize = u.size.mul(sizeJit);

    const localOff = rightV
      .mul(positionLocal.x.mul(finalSize))
      .add(upV.mul(positionLocal.y.mul(finalSize)));
    const worldPos = worldCenter.add(localOff);

    // ── Life pulse: smooth sine cycle so particles drift in and out instead
    //    of popping at the edges. softness shapes the peak (low = peakier).
    const lifePhase = h12.mul(TWO_PI);
    const lifeFreq = h13.mul(0.5).add(0.75);
    const lifeRaw = sin(time.mul(u.lifeSpeed).mul(lifeFreq).add(lifePhase))
      .mul(0.5)
      .add(0.5);
    const life = pow(lifeRaw, u.softness.mul(2.0).add(0.5));

    // ── Color: per-particle warm↔cool tint mix.
    const tint = mix(u.colorA, u.colorB, h5);

    // ── Texture sampling — same RGBA/B&W-mask trick as fx-leaves-physics.
    const texColor = mix(vec3(1.0, 1.0, 1.0), dustMapNode.rgb, uMaskInAlpha);
    const maskCh = mix(dustMapNode.r, dustMapNode.a, uMaskInAlpha);

    // Alpha boost: sharpen soft mask into a solid shape (saturates first so
    // boost cannot bleed beyond the texture's transparent regions). Opacity
    // then dials the *saturated* shape down linearly — composes cleanly with
    // boost and with the life pulse.
    const boostedMask = maskCh.mul(u.alphaBoost).saturate();

    const finalColor = texColor.mul(tint);
    const finalAlpha = boostedMask.mul(u.opacity).mul(life);

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.positionNode = Fn(() => worldPos)();
    mat.colorNode = finalColor;
    mat.opacityNode = finalAlpha;
    mat.transparent = true;
    mat.depthWrite = false;          // particles don't occlude each other
    mat.side = THREE.DoubleSide;
    mat.alphaTest = 0.001;           // discard fully transparent only
    mat.blending = params.additive
      ? THREE.AdditiveBlending
      : THREE.NormalBlending;
    return mat;
  }

  // Geometry: unit quad. Per-instance scaling happens in positionNode.
  const geometry = new THREE.PlaneGeometry(1, 1);
  let material = buildMaterial();
  let mesh = null;
  const _identity = new THREE.Matrix4();

  function rebuildMesh() {
    if (mesh) {
      scene.remove(mesh);
      mesh.dispose();
      mesh = null;
    }
    const requested = Math.max(1, Math.floor(Number(params.count) || 600));
    const density = Math.max(0.05, Number(shared.density) || 1);
    const n = Math.max(1, Math.min(MAX_COUNT, Math.round(requested * density)));
    mesh = new THREE.InstancedMesh(geometry, material, n);
    mesh.count = n;
    mesh.frustumCulled = false;
    // All instances share the identity matrix; per-instance animation lives
    // entirely in positionNode driven by instanceIndex.
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, _identity);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = params.enabled;
    mesh.renderOrder = 3;
    scene.add(mesh);
  }

  function rebuildMaterial() {
    const old = material;
    material = buildMaterial();
    if (mesh) {
      mesh.material = material;
    }
    old.dispose();
  }

  rebuildMesh();

  // ── Texture loaders (live swap — no material rebuild needed) ──────────
  function setTextureFromPath(path) {
    const loader = new THREE.TextureLoader();
    loader.load(
      path,
      (tex) => {
        configureDustTexture(tex);
        dustMapNode.value = tex;
        uMaskInAlpha.value = detectAlphaChannel(tex.image) ? 1.0 : 0.0;
        params.texturePath = path;
        params.customName = "";
      },
      undefined,
      (err) => {
        console.error("Dust: failed to load texture", path, err);
      }
    );
  }

  function setTextureFromDataUrl(dataUrl, name) {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      configureDustTexture(tex);
      dustMapNode.value = tex;
      uMaskInAlpha.value = detectAlphaChannel(img) ? 1.0 : 0.0;
      params.texturePath = "";
      params.customName = name || "(custom)";
    };
    img.src = dataUrl;
  }

  // Kick off default texture.
  setTextureFromPath(params.texturePath);

  // ── View binding + manual center snap ─────────────────────────────────
  // setView is called once at effect creation. We snap the volume to the
  // current orbit target on first call so dust appears where the user is
  // looking (not at world origin, which may be off-screen).
  function setView(cam, ctrl) {
    camera = cam;
    controls = ctrl;
    if (!_hasSnapped && controls) {
      snapCenterToTarget();
      _hasSnapped = true;
    }
  }

  // Manual one-shot reposition — does NOT auto-follow the camera afterwards.
  function snapCenterToTarget() {
    if (!controls) return;
    params.centerX = controls.target.x;
    params.centerY = controls.target.y;
    params.centerZ = controls.target.z;
    u.center.value.set(params.centerX, params.centerY, params.centerZ);
  }

  // ── Per-frame uniform sync ────────────────────────────────────────────
  function update(_dt, _elapsed, sh) {
    if (mesh) mesh.visible = params.enabled;

    u.center.value.set(params.centerX, params.centerY, params.centerZ);
    u.areaSize.value = params.areaSize;
    u.heightMin.value = params.heightMin;
    u.heightMax.value = params.heightMax;
    u.groundY.value = sh.groundY || 0;
    u.size.value = params.size;
    u.sizeVar.value = params.sizeVar;
    u.speed.value = params.speed;
    u.wanderAmp.value = params.wanderAmp;
    u.bobAmp.value = params.bobAmp;
    u.tumbleSpeed.value = params.tumbleSpeed;
    u.lifeSpeed.value = params.lifeSpeed;
    u.opacity.value = params.opacity;
    u.alphaBoost.value = params.alphaBoost;
    u.softness.value = params.softness;
    u.colorA.value.set(params.colorA);
    u.colorB.value.set(params.colorB);

    // Wind drift is pre-scaled here so the shader stays cheap. windStrength
    // is global; windCoupling is per-effect; the 0.05 keeps overall motion
    // gentle relative to leaves at the same wind strength.
    const w = (sh.windStrength || 0) * params.windCoupling * 0.05;
    u.windX.value = (sh.windX || 0) * w;
    u.windZ.value = (sh.windZ || 0) * w;
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
    rebuildMaterial,
    setView,
    snapCenterToTarget,
    setTextureFromPath,
    setTextureFromDataUrl,
    builtinTextures: BUILTIN_DUST_TEXTURES,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Inspector UI
// ──────────────────────────────────────────────────────────────────────────────

export function buildDustUI(folder, state) {
  const p = state.params;

  folder.addBinding(p, "enabled", { label: "Enabled" });

  // Texture picker (built-in gallery + drag-and-drop custom PNG).
  if (folder.addTexturePicker) {
    folder.addTexturePicker({
      label: "Dust Texture",
      builtins: state.builtinTextures,
      getCurrentPath: () => p.texturePath,
      getCurrentName: () => p.customName,
      onBuiltinSelect: (path) => state.setTextureFromPath(path),
      onCustomLoad: (dataUrl, name) =>
        state.setTextureFromDataUrl(dataUrl, name),
    });
    folder.addBlade({ view: "separator" });
  }

  // Count dropdown — kept as a string for the same inspector-dispatch
  // reason as fx-leaves-physics.js. rebuildMesh() is cheap, so no debounce.
  folder
    .addBinding(p, "count", {
      label: "Count",
      options: {
        "150":  "150",
        "300":  "300",
        "600":  "600",
        "1200": "1200",
        "2400": "2400",
        "4096": "4096",
      },
    })
    .on("change", () => state.rebuildMesh());

  // ── Volume controls (fixed emitter in world-space) ────────────────────
  const vol = folder.addFolder({ title: "Volume", expanded: true });

  vol.addBinding(p, "areaSize", {
    label: "Area Size",
    min: 2,
    max: 80,
    step: 0.5,
  });

  vol.addBinding(p, "heightMin", {
    label: "Height Min",
    min: 0,
    max: 8,
    step: 0.05,
  });

  vol.addBinding(p, "heightMax", {
    label: "Height Max",
    min: 0.5,
    max: 12,
    step: 0.05,
  });

  vol.addBinding(p, "centerX", { label: "Center X", min: -100, max: 100, step: 0.5 });
  vol.addBinding(p, "centerY", { label: "Center Y", min: -20,  max: 20,  step: 0.1 });
  vol.addBinding(p, "centerZ", { label: "Center Z", min: -100, max: 100, step: 0.5 });

  vol.addButton({ title: "Snap Center to Target" })
    .on("click", () => state.snapCenterToTarget());

  folder.addBlade({ view: "separator" });

  folder.addBinding(p, "size", {
    label: "Size",
    min: 0.02,
    max: 0.6,
    step: 0.005,
  });

  folder.addBinding(p, "sizeVar", {
    label: "Size Variation",
    min: 0,
    max: 1,
    step: 0.05,
  });

  folder.addBinding(p, "opacity", {
    label: "Opacity",
    min: 0.05,
    max: 1,
    step: 0.01,
  });

  // Alpha Boost: multiplies the texture mask by a >1 factor before clamping
  // to 1. Sharpens soft PNG edges into solid shapes → with Additive off this
  // is the "make dust look darker / denser" knob from Niagara tutorials.
  folder.addBinding(p, "alphaBoost", {
    label: "Alpha Boost",
    min: 0.1,
    max: 10,
    step: 0.05,
  });

  folder.addBinding(p, "additive", { label: "Additive Blend" })
    .on("change", () => state.rebuildMaterial());

  folder.addBlade({ view: "separator" });

  const motion = folder.addFolder({ title: "Motion", expanded: true });
  motion.addBinding(p, "speed",       { label: "Wander Speed", min: 0,    max: 3,    step: 0.01 });
  motion.addBinding(p, "wanderAmp",   { label: "Wander Amp",   min: 0,    max: 3,    step: 0.01 });
  motion.addBinding(p, "bobAmp",      { label: "Bob",          min: 0,    max: 2,    step: 0.01 });
  motion.addBinding(p, "tumbleSpeed", { label: "Tumble Speed", min: 0,    max: 3,    step: 0.01 });
  motion.addBinding(p, "lifeSpeed",   { label: "Pulse Speed",  min: 0.02, max: 1.5,  step: 0.01 });
  motion.addBinding(p, "softness",    { label: "Pulse Soft",   min: 0.05, max: 1.5,  step: 0.01 });

  const wnd = folder.addFolder({ title: "Wind", expanded: false });
  wnd.addBinding(p, "windCoupling", {
    label: "Wind Coupling",
    min: 0,
    max: 1,
    step: 0.01,
  });

  folder.addBlade({ view: "separator" });

  folder.addBinding(p, "colorA", { label: "Tint A" });
  folder.addBinding(p, "colorB", { label: "Tint B" });
}
