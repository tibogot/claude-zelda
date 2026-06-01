import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import { texture, uv, mul, uniform } from "three/tsl";
import { PARAMS } from "./splatmap-chunks-params.js";

const ASSET_BASE = new URL("../", import.meta.url);

/** Sun-anchored lens flare (additive, no post-processing). */
export function createLensFlare(scene, camera, sunDir) {
  /* ─────────── Lens Flare (sun-anchored, no post-processing) ───────────
   * One group at camera origin; children live in camera-local space.
   * Every frame: project sunDir into camera space, compute a screen
   * position, place halation+streak at the sun and ghosts along the
   * sun→center line. Dirt is a full-screen quad with a proximity mask.
   * All materials are additive, depthTest:false, renderOrder very high.
   */
  function _makeRadialTex(size, power, innerWhite) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(size, size);
    const half = size * 0.5;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half;
        const dy = (y - half) / half;
        const r = Math.min(1, Math.sqrt(dx * dx + dy * dy));
        const a = Math.pow(1 - r, power);
        const core = innerWhite ? Math.pow(1 - r, power * 3) : 0;
        const v = Math.min(1, a + core);
        const idx = (y * size + x) * 4;
        img.data[idx] = 255;
        img.data[idx + 1] = 255;
        img.data[idx + 2] = 255;
        img.data[idx + 3] = Math.round(v * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  function _makeStreakTex(w, h) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(w, h);
    const hx = w * 0.5;
    const hy = h * 0.5;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const u = (x - hx) / hx;
        const v = (y - hy) / hy;
        const fx = Math.pow(1 - Math.min(1, Math.abs(u)), 1.4);
        const fy = Math.pow(1 - Math.min(1, Math.abs(v)), 3.5);
        const a = Math.max(0, fx * fy);
        const idx = (y * w + x) * 4;
        img.data[idx] = 255;
        img.data[idx + 1] = 255;
        img.data[idx + 2] = 255;
        img.data[idx + 3] = Math.round(a * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  function _makeHexTex(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    const cx = size * 0.5;
    const cy = size * 0.5;
    const r = size * 0.42;
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, "rgba(255,255,255,1)");
    grd.addColorStop(0.6, "rgba(255,255,255,0.45)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  function _makeDirtTex(size) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, size, size);
    /* Scatter smudges, specks and hair-like streaks */
    for (let i = 0; i < 160; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const rr = 6 + Math.random() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
      const a = 0.05 + Math.random() * 0.22;
      g.addColorStop(0, `rgba(255,255,255,${a})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const rr = 0.6 + Math.random() * 1.6;
      ctx.fillStyle = `rgba(255,255,255,${0.15 + Math.random() * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 30; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const len = 20 + Math.random() * 80;
      const ang = Math.random() * Math.PI * 2;
      ctx.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.15})`;
      ctx.lineWidth = 0.5 + Math.random() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  const _lfHalationTex = _makeRadialTex(256, 2.0, true);
  const _lfGhostTex = _makeHexTex(128);
  const _lfStreakTex = _makeStreakTex(512, 32);
  const _lfDirtTex = _makeDirtTex(512);

  const lensFlareGroup = new THREE.Group();
  lensFlareGroup.renderOrder = 9999;
  scene.add(lensFlareGroup);

  function _makeFlareMat(tex, colorHex) {
    const m = new MeshBasicNodeMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const uCol = uniform(new THREE.Color(colorHex).convertSRGBToLinear());
    const uInt = uniform(1.0);
    const sampled = texture(tex, uv());
    m.colorNode = mul(sampled.rgb, uCol);
    m.opacityNode = mul(sampled.a, uInt);
    m.userData = { uCol, uInt };
    return m;
  }

  /* Halation — big soft warm glow centered on the sun */
  const _lfHalationMat = _makeFlareMat(
    _lfHalationTex,
    PARAMS.lensFlare.halationColor,
  );
  const _lfHalation = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    _lfHalationMat,
  );
  _lfHalation.renderOrder = 9998;
  _lfHalation.frustumCulled = false;
  lensFlareGroup.add(_lfHalation);

  /* Anamorphic horizontal streak */
  const _lfStreakMat = _makeFlareMat(
    _lfStreakTex,
    PARAMS.lensFlare.streakColor,
  );
  const _lfStreak = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    _lfStreakMat,
  );
  _lfStreak.renderOrder = 9998;
  _lfStreak.frustumCulled = false;
  lensFlareGroup.add(_lfStreak);

  /* Ghosts along sun → center axis (art-directed, not procedural ring) */
  const _lfGhostDefs = [
    { t: 0.18, size: 0.1, color: "#ff8a66" },
    { t: 0.34, size: 0.06, color: "#ffd980" },
    { t: 0.5, size: 0.16, color: "#9ed4ff" },
    { t: 0.72, size: 0.08, color: "#b298ff" },
    { t: 1.1, size: 0.22, color: "#66d0ff" },
    { t: 1.45, size: 0.05, color: "#fff2a8" },
  ];
  const _lfGhosts = _lfGhostDefs.map((def) => {
    const mat = _makeFlareMat(_lfGhostTex, def.color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.renderOrder = 9998;
    mesh.frustumCulled = false;
    mesh.userData.def = def;
    lensFlareGroup.add(mesh);
    return mesh;
  });

  /* Upgrade halation + ghosts with the hand-authored three.js PNGs.
   * We replace the whole material (clean TSL recompile) and copy the
   * existing uniform values across so tweakpane controls stay live. */
  function _swapFlareTexture(mesh, newTex, colorHex) {
    newTex.colorSpace = THREE.SRGBColorSpace;
    newTex.needsUpdate = true;
    const oldMat = mesh.material;
    const newMat = _makeFlareMat(newTex, colorHex);
    newMat.userData.uCol.value.copy(oldMat.userData.uCol.value);
    newMat.userData.uInt.value = oldMat.userData.uInt.value;
    mesh.material = newMat;
    oldMat.dispose();
  }
  {
    const loader = new THREE.TextureLoader();
    loader.load(new URL("textures/lensflare0.png", ASSET_BASE).href, (tex) => {
      _swapFlareTexture(_lfHalation, tex, PARAMS.lensFlare.halationColor);
    });
    loader.load(new URL("textures/lensflare3.png", ASSET_BASE).href, (tex) => {
      for (const g of _lfGhosts) {
        _swapFlareTexture(g, tex, g.userData.def.color);
      }
    });
  }

  /* Lens dirt — full-screen additive, brightness driven by sun proximity */
  const _lfDirtMat = _makeFlareMat(_lfDirtTex, "#ffffff");
  const _lfDirt = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), _lfDirtMat);
  _lfDirt.renderOrder = 9997;
  _lfDirt.frustumCulled = false;
  lensFlareGroup.add(_lfDirt);

  const _lfSunLocal = new THREE.Vector3();
  const _lfCamQuatInv = new THREE.Quaternion();

  function updateLensFlare() {
    const p = PARAMS.lensFlare;
    if (!p.enabled) {
      lensFlareGroup.visible = false;
      return;
    }
    /* Place the group at the camera — children are in camera-local space */
    lensFlareGroup.position.copy(camera.position);
    lensFlareGroup.quaternion.copy(camera.quaternion);

    /* Sun in camera-local space */
    _lfCamQuatInv.copy(camera.quaternion).invert();
    _lfSunLocal.copy(sunDir).applyQuaternion(_lfCamQuatInv);

    /* Behind camera → hide */
    if (_lfSunLocal.z >= -0.001) {
      lensFlareGroup.visible = false;
      return;
    }
    lensFlareGroup.visible = true;

    /* Horizon fade — sun just above real horizon attenuates */
    const horizonVis = THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.18);

    /* Project to normalized screen coords (-1..1 in view frustum) */
    const invZ = 1 / -_lfSunLocal.z;
    const sxView = _lfSunLocal.x * invZ; // tan-space
    const syView = _lfSunLocal.y * invZ;
    const fovRad = (camera.fov * Math.PI) / 180;
    const halfH = Math.tan(fovRad * 0.5);
    const halfW = halfH * camera.aspect;
    const ndcX = sxView / halfW;
    const ndcY = syView / halfH;

    /* Distance from screen center (fades flare as sun leaves the frame).
     * MathUtils.smoothstep requires min < max, so we do (1 - smoothstep). */
    const radius = Math.sqrt(ndcX * ndcX + ndcY * ndcY);
    const screenVis = 1 - THREE.MathUtils.smoothstep(radius, 0.4, 2.0);
    const offFrameVis = 1 - THREE.MathUtils.smoothstep(radius, 0.0, 3.0);

    const master = p.intensity * horizonVis;
    if (master < 0.001) {
      lensFlareGroup.visible = false;
      return;
    }

    /* Place elements at z = -1 (scaled to camera view at that depth) */
    const Z = -1.0;
    const worldPerNdcX = halfW;
    const worldPerNdcY = halfH;
    const sunWX = ndcX * worldPerNdcX;
    const sunWY = ndcY * worldPerNdcY;

    /* Halation — big warm glow at sun pos */
    _lfHalation.position.set(sunWX, sunWY, Z);
    const halScale = p.halationSize * halfH * 1.4;
    _lfHalation.scale.set(halScale, halScale, 1);
    _lfHalation.material.userData.uInt.value = master * screenVis * 1.4;
    _lfHalation.material.userData.uCol.value
      .set(p.halationColor)
      .convertSRGBToLinear();

    /* Anamorphic streak — wide horizontal bar */
    _lfStreak.position.set(sunWX, sunWY, Z);
    _lfStreak.scale.set(p.streakLength * halfW * 4.0, halfH * 0.12, 1);
    _lfStreak.material.userData.uInt.value =
      master * screenVis * p.streakOpacity;
    _lfStreak.material.userData.uCol.value
      .set(p.streakColor)
      .convertSRGBToLinear();

    /* Ghosts — along sun→center line with spacing param */
    for (let i = 0; i < _lfGhosts.length; i++) {
      const g = _lfGhosts[i];
      const def = g.userData.def;
      const t = def.t * p.ghostSpacing;
      const gx = sunWX * (1 - t * 2);
      const gy = sunWY * (1 - t * 2);
      g.position.set(gx, gy, Z);
      const s = def.size * halfH * 2.0;
      g.scale.set(s, s, 1);
      g.material.userData.uInt.value =
        master * offFrameVis * p.ghostOpacity;
    }

    /* Lens dirt — full-screen, brightens with sun proximity */
    _lfDirt.position.set(0, 0, Z);
    _lfDirt.scale.set(halfW * 2, halfH * 2, 1);
    _lfDirt.material.userData.uInt.value =
      master * screenVis * p.dirtOpacity * 0.9;
  }
  return { updateLensFlare };
}
