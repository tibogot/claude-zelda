/**
 * Strip river/waterfall/impact + wf TSL from splatmap-chunks-main.js,
 * add imports, bind runtime, UIctx accessors for rwiRefs, global rwiRefs.* renames.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "splatmap-chunks-main.js");

const lines = fs.readFileSync(mainPath, "utf8").split(/\r?\n/);
const ranges = [
  [372, 1230],
  [1289, 1481],
];
const kept = lines.filter(
  (_, i) => !ranges.some(([a, b]) => i >= a && i < b),
);

const importBlock = `import { _wFbm2 } from "./splatmap-chunks-w-tsl-noise.js";
import {
  rwiRefs,
  bindRiverWaterfallImpactRuntime,
  wfU,
  uRiverTime,
  uIFTime,
  riverMat,
  waterfallTemplateMat,
  impactFoamMat,
  impactFoamParams,
  rsU,
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
  buildWaterfallGeo,
  buildImpactFoamGeometry,
  wfPlaceTool,
} from "./splatmap-chunks-river-waterfall-impact.js";`;

const idxTerrain = kept.findIndex((l) =>
  l.includes("from \"./splatmap-chunks-terrain-gen-math.js\""),
);
if (idxTerrain < 0) throw new Error("terrain-gen-math import not found");
kept.splice(idxTerrain + 1, 0, "", importBlock);

const bindBlock = `bindRiverWaterfallImpactRuntime({
  scene,
  transformControls,
  tcHelper,
  controls,
  getPlayMode: () => playMode,
  getEditState: () => editState,
});
syncImpactFoamUniforms();
applyImpactFoamVisibility();`;

const idxTc = kept.findIndex((l) => l.includes("scene.add(tcHelper);"));
if (idxTc < 0) throw new Error("scene.add(tcHelper) not found");
kept.splice(idxTc + 1, 0, "", bindBlock);

let out = kept.join("\n");

const subs = [
  [/\bwaterfallObjects\b/g, "rwiRefs.waterfallObjects"],
  [/\bselectedWaterfall\b/g, "rwiRefs.selectedWaterfall"],
  [/\bsplashCapObjects\b/g, "rwiRefs.splashCapObjects"],
  [/\bselectedSplashCap\b/g, "rwiRefs.selectedSplashCap"],
  [/\bwaterObjects\b/g, "rwiRefs.waterObjects"],
  [/\b_cachedLakeBodies\b/g, "rwiRefs._cachedLakeBodies"],
];
for (const [re, sub] of subs) out = out.replace(re, sub);
out = out.replace(/rwiRefs\.rwiRefs/g, "rwiRefs");

const refKeys = [
  "waterfallObjects",
  "splashCapObjects",
  "waterObjects",
  "selectedWaterfall",
  "selectedSplashCap",
  "selectedWater",
  "_cachedLakeBodies",
];
for (const k of refKeys) {
  out = out.replace(new RegExp(`^\\s*${k},\\s*\\n`, "gm"), "");
}

const uiWire = `  for (const _k of ${JSON.stringify(refKeys)}) {
    Object.defineProperty(UIctx, _k, {
      get() {
        return rwiRefs[_k];
      },
      set(v) {
        rwiRefs[_k] = v;
      },
      enumerable: true,
      configurable: true,
    });
  }`;

out = out.replace(`  wfU,\n});`, `  wfU,\n});\n${uiWire}\n`);

fs.writeFileSync(mainPath, out, "utf8");
console.log("patched", path.relative(root, mainPath));
