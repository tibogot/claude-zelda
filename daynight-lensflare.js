/**
 * Sun-anchored lens flare — ported from NOT-USED/splatmap-chunks.html (the
 * non-Mancini, no-post-processing one). Additive sprite stack (halation +
 * anamorphic streak + ghosts + lens dirt) placed by projecting the sun into
 * screen space each frame. Procedural canvas textures, upgraded with the
 * hand-authored PNGs (textures/lensflare0.png / lensflare3.png) when available.
 *
 * Custom-pipeline note: daynight-sky renders the scene to an offscreen buffer
 * and composites clouds on top, so a flare living in the scene would be hidden
 * behind the clouds. Instead the flare group is on its own layer (19) and the
 * page draws it as a final ADDITIVE overlay to the canvas via `render()`, after
 * the cloud composite — so it sits on top of everything, like a real lens flare.
 */
import * as THREE from "three/webgpu";
import { uniform, texture, uv, mul } from "three/tsl";

const LENS_LAYER = 19;

function makeRadialTex(size, power, innerWhite) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const half = size * 0.5;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half, dy = (y - half) / half;
      const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const a = Math.pow(1 - r, power);
      const core = innerWhite ? Math.pow(1 - r, power * 3) : 0;
      const v = Math.min(1, a + core);
      const idx = (y * size + x) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeStreakTex(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const hx = w * 0.5, hy = h * 0.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x - hx) / hx, v = (y - hy) / hy;
      const fx = Math.pow(1 - Math.min(1, Math.abs(u)), 1.4);
      const fy = Math.pow(1 - Math.min(1, Math.abs(v)), 3.5);
      const a = Math.max(0, fx * fy);
      const idx = (y * w + x) * 4;
      img.data[idx] = img.data[idx + 1] = img.data[idx + 2] = 255;
      img.data[idx + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeHexTex(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const cx = size * 0.5, cy = size * 0.5, r = size * 0.42;
  const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.6, "rgba(255,255,255,0.45)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grd;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function makeDirtTex(size) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 160; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const rr = 6 + Math.random() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    const a = 0.05 + Math.random() * 0.22;
    g.addColorStop(0, `rgba(255,255,255,${a})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const rr = 0.6 + Math.random() * 1.6;
    ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.6})`;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const len = 20 + Math.random() * 80, ang = Math.random() * Math.PI * 2;
    ctx.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.15})`;
    ctx.lineWidth = 0.5 + Math.random() * 1.2;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

const GHOST_DEFS = [
  { t: 0.18, size: 0.1, color: "#ff8a66" },
  { t: 0.34, size: 0.06, color: "#ffd980" },
  { t: 0.5, size: 0.16, color: "#9ed4ff" },
  { t: 0.72, size: 0.08, color: "#b298ff" },
  { t: 1.1, size: 0.22, color: "#66d0ff" },
  { t: 1.45, size: 0.05, color: "#fff2a8" },
];

export function createLensFlare({ camera }) {
  const halTex = makeRadialTex(256, 2.0, true);
  const ghostTex = makeHexTex(128);
  const streakTex = makeStreakTex(512, 32);
  const dirtTex = makeDirtTex(512);

  const group = new THREE.Group();
  group.renderOrder = 9999;
  group.name = "DayNightLensFlare";

  function makeFlareMat(tex, colorHex) {
    const m = new THREE.MeshBasicNodeMaterial({
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const uCol = uniform(new THREE.Color(colorHex).convertSRGBToLinear());
    const uInt = uniform(1.0);
    const sampled = texture(tex, uv());
    m.colorNode = mul(sampled.rgb, uCol);
    m.opacityNode = mul(sampled.a, uInt);
    m.userData = { uCol, uInt };
    return m;
  }
  const quad = new THREE.PlaneGeometry(1, 1);
  function makeMesh(mat, order) {
    const mesh = new THREE.Mesh(quad, mat);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.layers.set(LENS_LAYER);
    group.add(mesh);
    return mesh;
  }

  const halation = makeMesh(makeFlareMat(halTex, "#ffdca8"), 9998);
  const streak = makeMesh(makeFlareMat(streakTex, "#8cc8ff"), 9998);
  const ghosts = GHOST_DEFS.map((def) => {
    const mesh = makeMesh(makeFlareMat(ghostTex, def.color), 9998);
    mesh.userData.def = def;
    return mesh;
  });
  const dirt = makeMesh(makeFlareMat(dirtTex, "#ffffff"), 9997);

  // Upgrade halation + ghosts with the hand-authored PNGs (clean TSL recompile,
  // copying the live uniform values across so controls keep working).
  function swapTexture(mesh, newTex, colorHex) {
    newTex.colorSpace = THREE.SRGBColorSpace;
    newTex.needsUpdate = true;
    const oldMat = mesh.material;
    const newMat = makeFlareMat(newTex, colorHex);
    newMat.userData.uCol.value.copy(oldMat.userData.uCol.value);
    newMat.userData.uInt.value = oldMat.userData.uInt.value;
    mesh.material = newMat;
    oldMat.dispose();
  }
  {
    const loader = new THREE.TextureLoader();
    const base = import.meta.url;
    loader.load(new URL("./textures/lensflare0.png", base).href, (t) =>
      swapTexture(halation, t, "#ffdca8"));
    loader.load(new URL("./textures/lensflare3.png", base).href, (t) => {
      for (const g of ghosts) swapTexture(g, t, g.userData.def.color);
    });
  }

  const _sunLocal = new THREE.Vector3();
  const _camQuatInv = new THREE.Quaternion();

  /** @param {THREE.Vector3} sunDir @param {object} P PARAMS.lensFlare */
  function update(sunDir, P) {
    if (!P.enabled) { group.visible = false; return; }
    group.position.copy(camera.position);
    group.quaternion.copy(camera.quaternion);

    _camQuatInv.copy(camera.quaternion).invert();
    _sunLocal.copy(sunDir).applyQuaternion(_camQuatInv);
    if (_sunLocal.z >= -0.001) { group.visible = false; return; } // behind camera
    group.visible = true;

    const horizonVis = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.18);

    const invZ = 1 / -_sunLocal.z;
    const fovRad = (camera.fov * Math.PI) / 180;
    const halfH = Math.tan(fovRad * 0.5);
    const halfW = halfH * camera.aspect;
    const ndcX = (_sunLocal.x * invZ) / halfW;
    const ndcY = (_sunLocal.y * invZ) / halfH;

    const radius = Math.sqrt(ndcX * ndcX + ndcY * ndcY);
    const screenVis = 1 - THREE.MathUtils.smoothstep(radius, 0.4, 2.0);
    const offFrameVis = 1 - THREE.MathUtils.smoothstep(radius, 0.0, 3.0);

    const master = P.intensity * horizonVis;
    if (master < 0.001) { group.visible = false; return; }

    const Z = -1.0;
    const sunWX = ndcX * halfW;
    const sunWY = ndcY * halfH;

    halation.position.set(sunWX, sunWY, Z);
    const halScale = P.halationSize * halfH * 1.4;
    halation.scale.set(halScale, halScale, 1);
    halation.material.userData.uInt.value = master * screenVis * 1.4;
    halation.material.userData.uCol.value.set(P.halationColor).convertSRGBToLinear();

    streak.position.set(sunWX, sunWY, Z);
    streak.scale.set(P.streakLength * halfW * 4.0, halfH * 0.12, 1);
    streak.material.userData.uInt.value = master * screenVis * P.streakOpacity;
    streak.material.userData.uCol.value.set(P.streakColor).convertSRGBToLinear();

    for (const g of ghosts) {
      const t = g.userData.def.t * P.ghostSpacing;
      g.position.set(sunWX * (1 - t * 2), sunWY * (1 - t * 2), Z);
      const s = g.userData.def.size * halfH * 2.0;
      g.scale.set(s, s, 1);
      g.material.userData.uInt.value = master * offFrameVis * P.ghostOpacity;
    }

    dirt.position.set(0, 0, Z);
    dirt.scale.set(halfW * 2, halfH * 2, 1);
    dirt.material.userData.uInt.value = master * screenVis * P.dirtOpacity * 0.9;
  }

  /** Additive overlay onto the canvas — call AFTER the cloud composite/present. */
  function render(renderer, scene, cam) {
    if (!group.visible) return;
    const prevMask = cam.layers.mask;
    const prevAuto = renderer.autoClear;
    cam.layers.set(LENS_LAYER);
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(scene, cam);
    cam.layers.mask = prevMask;
    renderer.autoClear = prevAuto;
  }

  function dispose() {
    group.traverse((o) => { if (o.material) o.material.dispose(); });
    quad.dispose();
    for (const t of [halTex, ghostTex, streakTex, dirtTex]) t.dispose();
  }

  return { group, layer: LENS_LAYER, update, render, dispose };
}

export const LENS_FLARE_DEFAULTS = {
  enabled: false,
  intensity: 3.0,
  halationSize: 3.0,
  halationColor: "#ffdca8",
  streakLength: 0.4,
  streakOpacity: 0.7,
  streakColor: "#8cc8ff",
  ghostOpacity: 2.0,
  ghostSpacing: 1.0,
  dirtOpacity: 0.0,
};
