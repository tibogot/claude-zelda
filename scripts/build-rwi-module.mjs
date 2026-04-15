import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "splatmap-chunks-main.js");
const outPath = path.join(root, "splatmap-chunks-river-waterfall-impact.js");

const lines = fs.readFileSync(mainPath, "utf8").split(/\r?\n/);
const wf = lines.slice(372, 486).join("\n");
const partA = lines.slice(567, 1230).join("\n");
const partB = lines.slice(1289, 1481).join("\n");
let body = `${partA}\n\n${partB}`;

/** Declarations moved to rwiRefs / exported const — strip originals from slice. */
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

/** Call from main once scene + transform controls exist. */
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
console.log("wrote", outPath, "bytes", fs.statSync(outPath).size);
