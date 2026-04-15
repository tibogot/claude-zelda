/**
 * One-time: cut lens flare block from splatmap-chunks-main.js into splatmap-chunks-lensflare.js
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "splatmap-chunks-main.js");
const outPath = path.join(root, "splatmap-chunks-lensflare.js");

const mainRaw = fs.readFileSync(mainPath, "utf8");
if (mainRaw.includes("createLensFlare(scene, camera, sunDir)"))
  throw new Error("Lens flare already extracted — delete splatmap-chunks-lensflare.js and restore main.js from git to re-run.");

const lines = mainRaw.split(/\r?\n/);

const start = lines.findIndex((l) =>
  l.includes("Lens Flare (sun-anchored, no post-processing)"),
);
if (start < 0) throw new Error("lens flare block not found");

const csmIdx = lines.findIndex(
  (l, i) => i > start && l.includes("Same CSM setup as splatmap-painter"),
);
if (csmIdx < 0) throw new Error("CSM comment after lens flare not found");
let end = csmIdx - 1;
while (end > start && lines[end].trim() === "") end--;
if (lines[end].trim() !== "}")
  throw new Error(`expected closing brace before CSM, got: ${lines[end]}`);

const body = lines.slice(start, end + 1).join("\n");
const indent = (s) =>
  s
    .split("\n")
    .map((line) => (line.length ? `  ${line}` : line))
    .join("\n");

const file = `${[
  "import * as THREE from \"three\";",
  "import { MeshBasicNodeMaterial } from \"three\";",
  "import { texture, uv, mul } from \"three/tsl\";",
  "import { PARAMS } from \"./splatmap-chunks-params.js\";",
  "",
  "/** Sun-anchored lens flare (additive, no post-processing). */",
  "export function createLensFlare(scene, camera, sunDir) {",
  indent(body),
  "  return { updateLensFlare };",
  "}",
  "",
].join("\n")}`;

fs.writeFileSync(outPath, file, "utf8");

const before = lines.slice(0, start);
const after = lines.slice(end + 1);
const bridge = [
  'import { createLensFlare } from "./splatmap-chunks-lensflare.js";',
];
if (before.some((l) => l.includes("splatmap-chunks-lensflare.js"))) {
  throw new Error("main.js already imports lens flare module");
}
let insertImport = -1;
for (let i = before.length - 1; i >= 0; i--) {
  if (/from\s+["'][^"']+["']\s*;\s*$/.test(before[i])) {
    insertImport = i + 1;
    break;
  }
}
before.splice(insertImport, 0, ...bridge);
const callLine =
  "const { updateLensFlare } = createLensFlare(scene, camera, sunDir);";
before.push("", callLine);

fs.writeFileSync(mainPath, [...before, ...after].join("\n"), "utf8");
console.log("Wrote", path.relative(root, outPath));
console.log("Patched", path.relative(root, mainPath));
