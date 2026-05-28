import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const src = fs.readFileSync(
  path.join(root, "octahedral-v3/octahedral-v3.js"),
  "utf8",
);
const lines = src.split("\n");

const header = `/**
 * Octahedral impostor core — v3 bake pipeline + materials (shared by editor and forest).
 */
import * as THREE from "three";
import {
  Fn, If, normalize, sub, mul, add, div, abs, vec2, vec3, vec4, sign, dot, cross,
  floor, fract, min, max, clamp, saturate, texture, cameraPosition,
  positionWorld, positionLocal, positionView, float, uniform, varying, select,
  length, negate, mix, smoothstep, fwidth, pow, sin, cos, normalWorld,
  tangentLocal, viewportCoordinate, uv, instanceIndex, screenCoordinate,
} from "three/tsl";
`;

const body = lines.slice(23, 727).join("\n");

const footer = `
export {
  BAKE_SPHERE_MARGIN,
  bakeAtlases,
  createImpostorMaterials,
  hemiOctaGridToDir,
  fullOctaGridToDir,
  hemiOctaEncodeCPU,
  countTris,
};
export const STORAGE_KEY = "octa-v2-state";
export const LEGACY_STORAGE_KEY = "octa-v3-state";
export const QUALITY_PRESETS = {
  Low:    { useBary: 0, useParallax: 0, edgeSmooth: 1.2 },
  Medium: { useBary: 1, useParallax: 0, edgeSmooth: 1.5 },
  High:   { useBary: 1, useParallax: 1, edgeSmooth: 1.5 },
};
export function loadV3State() {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ||
      localStorage.getItem(LEGACY_STORAGE_KEY) ||
      "{}";
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
`;

const out = path.join(root, "octahedral-v3/octahedral-core.js");
fs.writeFileSync(out, header + body + footer);
console.log("wrote", out, fs.statSync(out).size);
