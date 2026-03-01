/**
 * Tile material — TSL port of the R3F CustomShaderMaterial tile floor.
 * Uses grid.png for two-scale grid lines + procedural hash variation.
 * Exports createTileMaterial(options) and tile config constants.
 */
import * as THREE from "three";
import {
  Fn,
  uniform,
  vec3,
  uv,
  mix,
  mul,
  add,
  sub,
  clamp,
  floor,
  texture,
  negate,
} from "three/tsl";
import { hash12, remap } from "./tsl-utils.js";

// ─── Config (from tileMaterialConfig.ts) ───
export const TILE_REFERENCE_SIZE = 200;
export const TILE_REFERENCE_SCALE = 400;
export const TILE_DENSITY = TILE_REFERENCE_SCALE / TILE_REFERENCE_SIZE;

let gridTextureCache = null;

function getGridTexture() {
  if (gridTextureCache) return gridTextureCache;
  const texLoader = new THREE.TextureLoader();
  gridTextureCache = texLoader.load("textures/grid.png");
  gridTextureCache.wrapS = gridTextureCache.wrapT = THREE.RepeatWrapping;
  gridTextureCache.anisotropy = 16;
  return gridTextureCache;
}

function srgbToLinear(hex) {
  const c = new THREE.Color(hex);
  c.convertSRGBToLinear();
  return c;
}

/**
 * Creates a MeshStandardNodeMaterial with tile floor appearance.
 * @param {object} options
 * @param {number} [options.textureScale=1.0]
 * @param {number} [options.gradientIntensity=0.5]
 * @param {number} [options.gradientBias=0.0]
 * @param {number} [options.tileColor=0x888888]
 * @param {number} [options.gridColor=0x202020]
 * @param {number} [options.gridLineColor=0x000000]
 * @param {number} [options.roughness=1.0]
 * @param {number} [options.metalness=0.0]
 * @returns {THREE.MeshStandardNodeMaterial}
 */
export function createTileMaterial(options = {}) {
  const {
    textureScale = 1.0,
    gradientIntensity = 0.5,
    gradientBias = 0.0,
    tileColor = 0x888888,
    gridColor = 0x202020,
    gridLineColor = 0x000000,
    roughness = 1.0,
    metalness = 0.0,
  } = options;

  const gridTex = getGridTexture();
  const uTextureScale = uniform(textureScale);
  const uGradientIntensity = uniform(gradientIntensity);
  const uGradientBias = uniform(gradientBias);
  const uTileColor = uniform(srgbToLinear(tileColor));
  const uGridColor = uniform(srgbToLinear(gridColor));
  const uGridLineColor = uniform(srgbToLinear(gridLineColor));

  const mat = new THREE.MeshStandardNodeMaterial({
    roughness,
    metalness,
  });

  mat.colorNode = Fn(() => {
    const objectUV = uv().mul(uTextureScale);

    const grid1 = texture(gridTex, mul(objectUV, 0.125)).r;
    const grid2 = texture(gridTex, mul(objectUV, 1.25)).r;

    const gridHash1 = hash12(floor(mul(objectUV, 1.25)));
    const variationAmount = mul(uGradientIntensity, 0.2);

    const baseShade = clamp(
      add(
        0.45,
        remap(gridHash1, 0.0, 1.0, negate(variationAmount), variationAmount),
        uGradientBias
      ),
      0.0,
      1.0
    );

    const tileColour = mul(uTileColor, baseShade);
    let gridColour = mix(tileColour, uGridColor, grid2);
    gridColour = mix(gridColour, uGridLineColor, grid1);

    return gridColour;
  })();

  mat._tileUniforms = {
    textureScale: uTextureScale,
    gradientIntensity: uGradientIntensity,
    gradientBias: uGradientBias,
    tileColor: uTileColor,
    gridColor: uGridColor,
    gridLineColor: uGridLineColor,
  };

  return mat;
}
