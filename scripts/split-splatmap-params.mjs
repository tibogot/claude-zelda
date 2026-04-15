/**
 * One-time style helper: peel PARAMS from splatmap-chunks-main.js into splatmap-chunks-params.js
 * and wire the import. Safe to re-run if main.js still has inline PARAMS at same location.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "splatmap-chunks-main.js");
const paramsPath = path.join(root, "splatmap-chunks-params.js");

const lines = fs.readFileSync(mainPath, "utf8").split(/\r?\n/);

if (lines.some((l) => l.includes("./splatmap-chunks-params.js")))
  throw new Error("main.js already imports splatmap-chunks-params.js — aborting");

const start = lines.findIndex((l) => l.startsWith("/** Tweakpane + lighting"));
const paramLine = lines.findIndex(
  (l) => l.startsWith("const PARAMS = {") || l.startsWith("export const PARAMS = {"),
);
if (start < 0 || paramLine !== start + 1)
  throw new Error("PARAMS block start not found (expected Tweakpane comment then const PARAMS)");

let end = -1;
for (let i = paramLine; i < lines.length; i++) {
  if (lines[i] === "};") {
    end = i;
    break;
  }
}
if (end < 0) throw new Error("closing }; for PARAMS not found");

const block = lines.slice(start, end + 1);
block[1] = block[1].replace(/^const PARAMS/, "export const PARAMS");

const paramsFile = `${[
  'import { OCEAN_DEFAULTS } from "./ocean-shader.js";',
  'import { MEADOW_DEFAULT_PARAMS } from "./chunkMeadowTsl.js";',
  'import { GROUND_DEFAULT_PARAMS } from "./chunkGroundTsl.js";',
  "",
  ...block,
  "",
].join("\n")}`;

fs.writeFileSync(paramsPath, paramsFile, "utf8");

const before = lines.slice(0, start);
const after = lines.slice(end + 1);
const importLine = 'import { PARAMS } from "./splatmap-chunks-params.js";';
if (before.some((l) => l.includes("splatmap-chunks-params.js"))) {
  fs.writeFileSync(mainPath, [...before, ...after].join("\n"), "utf8");
  console.log("main.js already had params import; removed duplicate PARAMS block only.");
} else {
  let insertAt = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    if (/from\s+["'][^"']+["']\s*;\s*$/.test(before[i])) {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt < 0) throw new Error("could not find end of import block in main.js");
  before.splice(insertAt, 0, importLine);
  fs.writeFileSync(mainPath, [...before, ...after].join("\n"), "utf8");
  console.log("Inserted params import after line", insertAt);
}

console.log("Wrote", path.relative(root, paramsPath));
console.log("Updated", path.relative(root, mainPath));
