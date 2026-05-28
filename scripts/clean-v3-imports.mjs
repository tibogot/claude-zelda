import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const file = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../octahedral-v3/octahedral-v3.js",
);
let lines = fs.readFileSync(file, "utf8").split("\n");

// Drop duplicated core block (helpers … createImpostorMaterials) — keep saveState at top.
const start = lines.findIndex((l) =>
  l.includes("Octahedral mapping helpers (CPU side"),
);
const end = lines.findIndex((l) => l.startsWith("//  Misc helpers"));
if (start >= 0 && end > start) {
  lines.splice(start, end - start);
}

// Remove duplicate loadState / saveState / QUALITY_PRESETS before CAM_PRESETS
const qualIdx = lines.findIndex((l) => l.startsWith("const QUALITY_PRESETS"));
if (qualIdx >= 0) {
  let camIdx = lines.findIndex((l) => l.startsWith("const CAM_PRESETS"));
  lines.splice(qualIdx, camIdx - qualIdx);
}

// loadState → loadV3State
lines = lines.map((l) =>
  l.replace(/\bloadState\(\)/g, "loadV3State()").replace(/function loadState/, "function _unusedLoadState"),
);

fs.writeFileSync(file, lines.join("\n"));
console.log("cleaned v3.js");
