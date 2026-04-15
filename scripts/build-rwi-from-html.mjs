/**
 * Build splatmap-chunks-river-waterfall-impact.js from splatmap-chunks.html inline module.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "splatmap-chunks.html");
const outPath = path.join(root, "splatmap-chunks-river-waterfall-impact.js");

const html = fs.readFileSync(htmlPath, "utf8");
const start = html.indexOf('<script type="module">');
const end = html.indexOf("</script>", start + 1);
if (start < 0 || end < 0) throw new Error("module script not found");
let inner = html.slice(start + '<script type="module">'.length, end);
inner = inner.replace(/^\r?\n/, "");
const lines = inner.split(/\r?\n/).map((line) => line.replace(/^      /, ""));

const iWf = lines.findIndex((l) => l.includes("// ── WATERFALL [ H ]"));
const iNoise = lines.findIndex((l) => l.includes("const _wNHash = Fn"));
if (iWf < 0 || iNoise < 0) throw new Error("wf / noise markers not found");
const wf = lines.slice(iWf, iNoise).join("\n");

const iWfU = lines.findIndex((l) => l.trim().startsWith("const wfU = {"));
const iRoad = lines.findIndex((l) => l.trim().startsWith("const uRoadAsphaltDark = uniform("));
if (iWfU < 0 || iRoad < 0) throw new Error("wfU / road start not found");
const partA = lines.slice(iWfU, iRoad).join("\n");

const iIfSnap = lines.findIndex((l) => l.trim().startsWith("let _ifSnap = "));
const iSyncImpact = lines.findIndex(
  (l, idx) => idx > iIfSnap && l.trim() === "syncImpactFoamUniforms();",
);
if (iIfSnap < 0 || iSyncImpact < 0) throw new Error("impact foam block not found");
const partB = lines.slice(iIfSnap, iSyncImpact).join("\n");

let body = `${partA}\n\n${partB}`;
body = body.replace(/^\s*let waterfallObjects = \[\];\s*\n/m, "");
body = body.replace(/^\s*let selectedWaterfall = null;\s*\n/m, "");
body = body.replace(/^\s*let splashCapObjects = \[\];\s*\n/m, "");
body = body.replace(/^\s*let selectedSplashCap = null;\s*\n/m, "");
body = body.replace(/^\s*let waterObjects = \[\];\s*\n/m, "");
body = body.replace(/^\s*let _cachedLakeBodies = \[\];\s*\n/m, "");
body = body.replace(/^\s*let selectedWater = null;\s*\n/m, "");
body = body.replace(/^\s*let waterFolderRef = null;\s*\n/m, "");
body = body.replace(/^\s*const wfPlaceTool = \{[^}]*\};\s*\n/m, "");

const reps = [
  [/\bwaterfallObjects\b/g, "rwiRefs.waterfallObjects"],
  [/\bselectedWaterfall\b/g, "rwiRefs.selectedWaterfall"],
  [/\bsplashCapObjects\b/g, "rwiRefs.splashCapObjects"],
  [/\bselectedSplashCap\b/g, "rwiRefs.selectedSplashCap"],
  [/\bwaterObjects\b/g, "rwiRefs.waterObjects"],
  [/\b_cachedLakeBodies\b/g, "rwiRefs._cachedLakeBodies"],
  [/\bscene\./g, "_rt.scene."],
  [/\btransformControls\./g, "_rt.transformControls."],
  [/\btcHelper\./g, "_rt.tcHelper."],
  [/\bcontrols\./g, "_rt.controls."],
  [/\bplayMode\b/g, "_rt.getPlayMode()"],
  [/\beditState\.mode\b/g, "_rt.getEditState().mode"],
];
for (const [re, sub] of reps) body = body.replace(re, sub);
body = body.replace(/rwiRefs\.rwiRefs/g, "rwiRefs");

const header = `import * as THREE from "three";
import { MeshStandardNodeMaterial, MeshBasicNodeMaterial } from "three";
import {
  Fn,
  float,
  uniform,
  vec2,
  vec3,
  vec4,
  mix,
  mx_noise_float,
  uv,
  positionLocal,
  positionWorld,
  normalLocal,
  floor,
  fract,
  sin,
  cos,
  dot,
  smoothstep,
  pow,
  max,
  min,
  length,
  abs,
  clamp,
  saturate,
  sub,
  add,
  mul,
  div,
  step,
} from "three/tsl";
import { PARAMS } from "./splatmap-chunks-params.js";
import { _wFbm2, _wVoroF1, _wVoroSmooth } from "./splatmap-chunks-w-tsl-noise.js";

`;

const rwiBlock = `
export const wfPlaceTool = { tool: "waterfall" };

export const rwiRefs = {
  waterfallObjects: [],
  selectedWaterfall: null,
  splashCapObjects: [],
  selectedSplashCap: null,
  waterObjects: [],
  _cachedLakeBodies: [],
  selectedWater: null,
};

const _rt = {
  scene: null,
  transformControls: null,
  tcHelper: null,
  controls: null,
  getPlayMode: () => false,
  getEditState: () => ({ mode: "view" }),
};

export function bindRiverWaterfallImpactRuntime(api) {
  Object.assign(_rt, api);
}

`;

const footer = `
export {
  wfU,
  impactFoamParams,
  rsU,
  riverMat,
  waterfallTemplateMat,
  impactFoamMat,
  uRiverTime,
  uIFTime,
  buildWaterfallGeo,
  buildImpactFoamGeometry,
  syncRiverMat,
  applyRiverStyle,
  syncImpactFoamUniforms,
  applyImpactFoamVisibility,
  rebuildAllImpactFoamGeometry,
  selectWaterfall,
  selectSplashCap,
  placeWaterfall,
  applyWaterfalls,
  saveWaterfalls,
  placeSplashCap,
  applySplashCaps,
  saveSplashCaps,
  _invalidateLakeCache,
};
`;

fs.writeFileSync(
  outPath,
  `${header}${wf}\n\n${body}\n\n${rwiBlock}${footer}`,
  "utf8",
);
console.log("wrote", outPath, fs.statSync(outPath).size);
