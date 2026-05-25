/**
 * fx-ghost-leaves.js
 * Ghost-of-Tsushima-style falling leaves around the player.
 *
 * Design:
 *  - GPU-driven InstancedMesh + TSL MeshBasicNodeMaterial (no per-frame CPU sim).
 *  - XZ position is a hashed base + wind drift, wrapped around the camera so a
 *    ±followRadius cylinder of leaves always surrounds the viewer ("rolling
 *    box" trick: pos = mod(pos - cam + R, 2R) - R + cam).
 *  - Y position cycles top→bottom over a ground-anchored fall band.
 *  - Per-leaf 3D tumble (yaw + pitch evolving with time) so the leaf shows its
 *    edge when it tilts — what billboarded Points can't do.
 *  - Manual sun lighting synced from scene.userData.dirLight + backlight boost.
 *  - Soft fade-in/out at top/bottom of the fall cycle hides the wrap.
 *
 * Texture system:
 *  - leafMapNode = texture(THREE.Texture()) — live-swappable via .value, no
 *    material rebuild required.
 *  - Auto-detects mask channel via detectAlphaChannel(): RGBA leaves sample
 *    alpha from .a, grayscale B&W masks sample from .r. Selected via
 *    uMaskInAlpha uniform.
 *  - When the texture has color (RGBA mode), it tints the leaf via multiply.
 *    When it's a B&W mask, the leaf color comes entirely from colorA/colorB.
 */

import * as THREE from "three";
import {
  cameraPosition,
  cos,
  dot,
  float,
  fract,
  instanceIndex,
  max,
  mix,
  normalize,
  positionLocal,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  vec3,
} from "three/tsl";

const MAX_COUNT = 800;
const TWO_PI = Math.PI * 2;

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

function iHash(offset) {
  return float(instanceIndex)
    .add(float(offset))
    .mul(127.1)
    .sin()
    .mul(43758.5453)
    .fract();
}

// Returns true if the image has any sub-opaque pixel (alpha < 255).
// Cheap sparse sample every 4th pixel; bail on first hit.
function detectAlphaChannel(image) {
  try {
    const w = image.width || image.naturalWidth;
    const h = image.height || image.naturalHeight;
    if (!w || !h) return false;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
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

function configureTexture(tex) {
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

function buildMaterial(u, leafMapNode) {
  // Per-leaf hashed seeds.
  const h0 = iHash(0);
  const h1 = iHash(1);
  const h2 = iHash(2);
  const h3 = iHash(3);
  const h4 = iHash(4);
  const h5 = iHash(5);
  const h6 = iHash(6);
  const h7 = iHash(7);
  const h8 = iHash(8);

  const baseX = h0.mul(2.0).sub(1.0);
  const baseZ = h1.mul(2.0).sub(1.0);

  // Horizontal sway while falling.
  const swayPhase = h3.mul(TWO_PI);
  const swayT = time.mul(u.swaySpeed).add(swayPhase);
  const swayDX = sin(swayT).mul(u.swayAmp);
  const swayDZ = cos(swayT.mul(1.3)).mul(u.swayAmp);

  const rawX = baseX.mul(u.followRadius).add(u.windX.mul(time)).add(swayDX);
  const rawZ = baseZ.mul(u.followRadius).add(u.windZ.mul(time)).add(swayDZ);

  // Wrap-around camera XZ ("rolling box" trick).
  const span = u.followRadius.mul(2.0);
  const offX = rawX.sub(cameraPosition.x).add(u.followRadius);
  const offZ = rawZ.sub(cameraPosition.z).add(u.followRadius);
  const wrapX = fract(offX.div(span)).mul(span).sub(u.followRadius);
  const wrapZ = fract(offZ.div(span)).mul(span).sub(u.followRadius);
  const worldX = cameraPosition.x.add(wrapX);
  const worldZ = cameraPosition.z.add(wrapZ);

  // Vertical fall cycle.
  const fallRate = h8.mul(0.5).add(0.75);
  const fallCyc = fract(
    time.mul(u.fallSpeed).mul(fallRate).mul(0.05).add(h2)
  );
  const topY = u.groundY.add(u.fallHeight);
  const botY = u.groundY.add(u.groundOffset);
  const worldY = mix(topY, botY, fallCyc);

  // 3D tumble basis from yaw + pitch.
  const yawRate = h8.mul(0.6).add(0.9);
  const pitRate = h4.mul(0.5).add(0.6);
  const yawA = time.mul(u.tumbleSpeed).mul(yawRate).add(h6.mul(TWO_PI));
  const pitA = time.mul(u.tumbleSpeed).mul(pitRate).mul(0.7).add(h7.mul(TWO_PI));
  const cy = cos(yawA);
  const sy = sin(yawA);
  const cp = cos(pitA);
  const sp = sin(pitA);
  const rightV = vec3(cy, float(0.0), sy.negate());
  const upV    = vec3(sp.mul(sy),  cp, sp.mul(cy));
  const fwdV   = vec3(cp.mul(sy), sp.negate(), cp.mul(cy));

  // Per-leaf size jitter in [1 - var/2, 1 + var/2].
  const sizeJit = h4.mul(u.sizeVar).add(float(1.0).sub(u.sizeVar.mul(0.5)));
  const finalSize = u.size.mul(sizeJit);

  const localOff = rightV.mul(positionLocal.x.mul(finalSize))
    .add(upV.mul(positionLocal.y.mul(finalSize)));
  const worldCenter = vec3(worldX, worldY, worldZ);
  const worldPos = worldCenter.add(localOff);

  // Wrap fade.
  const fadeIn  = smoothstep(float(0.0),  float(0.12), fallCyc);
  const fadeOut = float(1.0).sub(smoothstep(float(0.85), float(1.0), fallCyc));
  const life = fadeIn.mul(fadeOut);

  // Texture sampling (leafMapNode is a TextureNode bound to a swappable
  // THREE.Texture). Swizzles use the default uv().
  // When uMaskInAlpha=1 (RGBA leaf), color comes from texture.rgb; alpha from .a.
  // When uMaskInAlpha=0 (B&W mask), color is pure tint; alpha from .r.
  const maskCh = mix(leafMapNode.r, leafMapNode.a, u.maskInAlpha);
  const texColor = mix(vec3(1.0, 1.0, 1.0), leafMapNode.rgb, u.maskInAlpha);
  const tint = mix(u.colorA, u.colorB, h5);
  const albedo = texColor.mul(tint);

  // Two-sided diffuse approximation using leaf normal.
  const nDotL = dot(fwdV, u.sunDir);
  const diff = nDotL.mul(0.5).add(0.5);
  const diffBack = nDotL.negate().mul(0.5).add(0.5).mul(0.55);
  const diffBoth = max(diff, diffBack);
  const litColor = albedo.mul(u.sunColor.mul(diffBoth).add(u.ambient));

  // Backlight cheat: warm rim when looking through a leaf toward the sun.
  const toCam = normalize(cameraPosition.sub(worldCenter));
  const back = max(float(0.0), dot(toCam, u.sunDir).negate());
  const grazing = float(1.0).sub(dot(fwdV, toCam).abs());
  const bb = back.mul(grazing).mul(u.backlight);
  const finalColor = litColor.add(vec3(1.0, 0.78, 0.45).mul(bb));

  const alpha = maskCh.mul(u.opacity).mul(life);

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.positionNode = worldPos;
  mat.colorNode = finalColor;
  mat.opacityNode = alpha;
  mat.transparent = true;
  mat.depthWrite = true;
  mat.side = THREE.DoubleSide;
  mat.alphaTest = 0.15;
  return mat;
}

export function createGhostLeavesFX(scene, shared) {
  const params = {
    enabled: true,
    count: 220,
    followRadius: 12.0,
    fallHeight: 11.0,
    groundOffset: 0.2,
    fallSpeed: 1.0,
    swayAmp: 0.6,
    swaySpeed: 0.8,
    tumbleSpeed: 1.4,
    size: 0.22,
    sizeVar: 0.55,
    opacity: 1.0,
    windCoupling: 1.0,
    backlight: 0.95,
    ambient: 0.32,
    colorA: "#d4943a",
    colorB: "#7a3a1a",
    // Texture state — populated by setTextureFromPath / setTextureFromDataUrl.
    texturePath: BUILTIN_LEAF_TEXTURES[0].path,
    customName: "",
  };

  const u = {
    followRadius: uniform(float(params.followRadius)),
    fallHeight:   uniform(float(params.fallHeight)),
    groundOffset: uniform(float(params.groundOffset)),
    groundY:      uniform(float(shared.groundY)),
    fallSpeed:    uniform(float(params.fallSpeed)),
    swayAmp:      uniform(float(params.swayAmp)),
    swaySpeed:    uniform(float(params.swaySpeed)),
    tumbleSpeed:  uniform(float(params.tumbleSpeed)),
    windX:        uniform(float(shared.windX * shared.windStrength * params.windCoupling * 0.4)),
    windZ:        uniform(float(shared.windZ * shared.windStrength * params.windCoupling * 0.4)),
    size:         uniform(float(params.size)),
    sizeVar:      uniform(float(params.sizeVar)),
    opacity:      uniform(float(params.opacity)),
    colorA:       uniform(new THREE.Color(params.colorA)),
    colorB:       uniform(new THREE.Color(params.colorB)),
    sunDir:       uniform(new THREE.Vector3(0.4, 0.85, 0.3)),
    sunColor:     uniform(new THREE.Color(1, 1, 1)),
    ambient:      uniform(float(params.ambient)),
    backlight:    uniform(float(params.backlight)),
    maskInAlpha:  uniform(float(0.0)),
  };

  // Swappable texture node. .value is replaced live when the user picks a
  // new built-in or uploads a custom image; the material samples through it
  // so no rebuild is needed.
  const leafMapNode = texture(new THREE.Texture());

  const mat = buildMaterial(u, leafMapNode);
  const geo = new THREE.PlaneGeometry(1, 1);
  const identity = new THREE.Matrix4();
  const _scratchColor = new THREE.Color();
  let mesh = null;

  function setTextureFromPath(path) {
    const loader = new THREE.TextureLoader();
    loader.load(
      path,
      (tex) => {
        configureTexture(tex);
        leafMapNode.value = tex;
        u.maskInAlpha.value = detectAlphaChannel(tex.image) ? 1.0 : 0.0;
        params.texturePath = path;
        params.customName = "";
      },
      undefined,
      (err) => {
        console.error("Ghost Leaves: failed to load texture", path, err);
      }
    );
  }

  function setTextureFromDataUrl(dataUrl, name) {
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      configureTexture(tex);
      leafMapNode.value = tex;
      u.maskInAlpha.value = detectAlphaChannel(img) ? 1.0 : 0.0;
      params.texturePath = "";
      params.customName = name || "(custom)";
    };
    img.src = dataUrl;
  }

  function spawn() {
    if (mesh) {
      scene.remove(mesh);
      mesh.dispose();
      mesh = null;
    }
    const n = Math.max(
      1,
      Math.min(MAX_COUNT, Math.round(params.count * shared.density))
    );
    mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.count = n;
    mesh.frustumCulled = false;
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, identity);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = params.enabled;
    scene.add(mesh);
  }

  spawn();
  setTextureFromPath(params.texturePath);

  function update(_dt, _elapsed, sh) {
    if (mesh) mesh.visible = params.enabled;

    u.groundY.value = sh.groundY;
    const w = sh.windStrength * params.windCoupling * 0.4;
    u.windX.value = sh.windX * w;
    u.windZ.value = sh.windZ * w;
    u.ambient.value = params.ambient;

    const dirLight = scene.userData.dirLight;
    if (dirLight) {
      const p = dirLight.position;
      const len = Math.hypot(p.x, p.y, p.z) || 1;
      u.sunDir.value.set(p.x / len, p.y / len, p.z / len);
      _scratchColor
        .copy(dirLight.color)
        .multiplyScalar(Math.min(1.0, dirLight.intensity * 0.55));
      u.sunColor.value.copy(_scratchColor);
    }
  }

  function dispose(sc) {
    if (mesh) {
      sc.remove(mesh);
      mesh.dispose();
      mesh = null;
    }
    geo.dispose();
    mat.dispose();
  }

  return {
    update,
    dispose,
    spawn,
    params,
    u,
    setTextureFromPath,
    setTextureFromDataUrl,
    builtinTextures: BUILTIN_LEAF_TEXTURES,
  };
}

export function buildGhostLeavesUI(folder, state) {
  const p = state.params;
  const u = state.u;

  folder.addBinding(p, "enabled", { label: "Enabled" });

  folder.addBinding(p, "count", {
    label: "Count", min: 30, max: 800, step: 10,
  }).on("change", () => state.spawn());

  folder.addBlade({ view: "separator" });

  // Texture picker (built-in gallery + custom file upload).
  if (folder.addTexturePicker) {
    folder.addTexturePicker({
      label: "Leaf Texture",
      builtins: state.builtinTextures,
      getCurrentPath: () => p.texturePath,
      getCurrentName: () => p.customName,
      onBuiltinSelect: (path) => state.setTextureFromPath(path),
      onCustomLoad: (dataUrl, name) => state.setTextureFromDataUrl(dataUrl, name),
    });
    folder.addBlade({ view: "separator" });
  }

  folder.addBinding(p, "followRadius", {
    label: "Follow Radius", min: 4, max: 30, step: 0.5,
  }).on("change", () => { u.followRadius.value = p.followRadius; });

  folder.addBinding(p, "fallHeight", {
    label: "Fall Height", min: 3, max: 30, step: 0.5,
  }).on("change", () => { u.fallHeight.value = p.fallHeight; });

  folder.addBinding(p, "groundOffset", {
    label: "Ground Offset", min: -1, max: 5, step: 0.05,
  }).on("change", () => { u.groundOffset.value = p.groundOffset; });

  folder.addBlade({ view: "separator" });

  folder.addBinding(p, "fallSpeed", {
    label: "Fall Speed", min: 0.1, max: 4, step: 0.05,
  }).on("change", () => { u.fallSpeed.value = p.fallSpeed; });

  folder.addBinding(p, "swayAmp", {
    label: "Sway Amount", min: 0, max: 2.5, step: 0.05,
  }).on("change", () => { u.swayAmp.value = p.swayAmp; });

  folder.addBinding(p, "swaySpeed", {
    label: "Sway Speed", min: 0.05, max: 3, step: 0.05,
  }).on("change", () => { u.swaySpeed.value = p.swaySpeed; });

  folder.addBinding(p, "tumbleSpeed", {
    label: "Tumble Speed", min: 0, max: 4, step: 0.05,
  }).on("change", () => { u.tumbleSpeed.value = p.tumbleSpeed; });

  folder.addBinding(p, "windCoupling", {
    label: "Wind Coupling", min: 0, max: 3, step: 0.05,
  });

  folder.addBlade({ view: "separator" });

  folder.addBinding(p, "size", {
    label: "Size", min: 0.05, max: 0.6, step: 0.005,
  }).on("change", () => { u.size.value = p.size; });

  folder.addBinding(p, "sizeVar", {
    label: "Size Variation", min: 0, max: 1, step: 0.05,
  }).on("change", () => { u.sizeVar.value = p.sizeVar; });

  folder.addBinding(p, "opacity", {
    label: "Opacity", min: 0.1, max: 1, step: 0.01,
  }).on("change", () => { u.opacity.value = p.opacity; });

  folder.addBlade({ view: "separator" });

  folder.addBinding(p, "colorA", { label: "Color A" })
    .on("change", () => { u.colorA.value.set(p.colorA); });

  folder.addBinding(p, "colorB", { label: "Color B" })
    .on("change", () => { u.colorB.value.set(p.colorB); });

  folder.addBinding(p, "ambient", {
    label: "Ambient", min: 0.05, max: 1.0, step: 0.01,
  });

  folder.addBinding(p, "backlight", {
    label: "Backlight", min: 0, max: 2.5, step: 0.05,
  }).on("change", () => { u.backlight.value = p.backlight; });

  folder.addBlade({ view: "separator" });

  folder.addButton({ title: "Respawn" }).on("click", () => state.spawn());
}
