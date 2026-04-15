import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "splatmap-chunks-main.js");
const outPath = path.join(root, "splatmap-chunks-billboard-clouds.js");

const lines = fs.readFileSync(mainPath, "utf8").split(/\r?\n/);

const bannerIdx = lines.findIndex((l) =>
  l.includes("Billboard clouds (Genshin/Zelda-style)"),
);
if (bannerIdx < 0) throw new Error("billboard clouds banner not found");

const startLine = lines.findIndex((l) =>
  l.includes("const billboardClouds = (() => {"),
);
if (startLine < 0) throw new Error("billboardClouds IIFE not found");

const endLine = lines.findIndex(
  (l, i) => i > startLine && l.trim() === "})();",
);
if (endLine < 0) throw new Error("IIFE close not found");

const inner = lines.slice(startLine + 1, endLine);

const header = `import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three";
import {
  texture,
  uv,
  mix,
  pow,
  float,
  saturate,
  mul,
  uniform,
  attribute,
} from "three/tsl";
import { PARAMS } from "./splatmap-chunks-params.js";

/**
 * Billboard clouds (Genshin/Zelda-style).
 * Instanced camera-facing quads with TSL shading, manual frustum cull,
 * no per-frame sort.
 */
export function createBillboardClouds(scene) {
`;

const out = `${header + inner.join("\n")}\n}\n`;
fs.writeFileSync(outPath, out, "utf8");

const before = lines.slice(0, bannerIdx);
const after = lines.slice(endLine + 1);

let insertImport = -1;
for (let i = before.length - 1; i >= 0; i--) {
  if (/from\s+["'][^"']+["']\s*;\s*$/.test(before[i])) {
    insertImport = i + 1;
    break;
  }
}
before.splice(
  insertImport,
  0,
  'import { createBillboardClouds } from "./splatmap-chunks-billboard-clouds.js";',
);

const bridge = [
  "/* ─── Billboard clouds (Genshin/Zelda-style) ──────────────────────────",
  " * Instanced camera-facing quads with TSL shading, manual frustum cull,",
  " * no per-frame sort. Sized for 1600-unit worlds. — splatmap-chunks-billboard-clouds.js",
  " */",
  "const billboardClouds = createBillboardClouds(scene);",
  "",
];

fs.writeFileSync(mainPath, [...before, ...bridge, ...after].join("\n"), "utf8");
console.log("Wrote", path.relative(root, outPath));
console.log("Patched", path.relative(root, mainPath));
