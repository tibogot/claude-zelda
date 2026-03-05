/**
 * Folio Showcase — SDF-like texture for foliage alpha.
 * Matches folio: sharp alpha (NearestFilter, no mipmaps), leaf-like shapes.
 */
import * as THREE from "three";

/**
 * Procedural fallback: radial gradient with sharp edge so alpha-test gives defined shape.
 * Folio uses foliageSDF.ktx with NearestFilter; we match that filter for crisp leaves.
 * @param {number} [size=128]
 * @returns {THREE.CanvasTexture}
 */
export function createFoliageTexture(size = 128) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  // Small central “leaf” so edge-on quads stay transparent (no wispy streaks); folio uses real SDF.
  const r = size * 0.35;
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  gradient.addColorStop(0, "#fff");
  gradient.addColorStop(0.2, "#fff");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.5)");
  gradient.addColorStop(0.5, "#000");
  gradient.addColorStop(1, "#000");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  // Folio: NearestFilter + no mipmaps for crisp SDF edges (not soft/cloudy)
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}
