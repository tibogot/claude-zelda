/**
 * Extract Tweakpane "Terrain studio" block into splatmap-chunks-editor-pane.js (sloppy Function + with(UIctx)).
 * Patches splatmap-chunks-main.js: removes block, adds UIctx import + wire + mount (keeps Pane import for wiring).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import babelParser from "@babel/parser";
import traverse from "@babel/traverse";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mainPath = path.join(root, "splatmap-chunks-main.js");
const outCtx = path.join(root, "splatmap-chunks-ui-context.js");
const outPane = path.join(root, "splatmap-chunks-editor-pane.js");

const browserGlobals = new Set(
  [
    "Image",
    "FileReader",
    "File",
    "Blob",
    "URL",
    "alert",
    "fetch",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "getComputedStyle",
    "matchMedia",
  ].map((s) => s),
);

const reserved = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with let static yield await of arguments".split(
    " ",
  ),
);

const builtins = new Set(
  "Math console document window JSON Array Date Object parseInt parseFloat isFinite Infinity NaN Promise Map Set Symbol RegExp Error Uint8Array Uint8ClampedArray ImageData Blob URL performance Number String Boolean Intl undefined NaN".split(
    " ",
  ),
);

const mainText = fs.readFileSync(mainPath, "utf8");
if (!mainText.includes('const pane = new Pane({ title: "Terrain studio" }')) {
  throw new Error(
    "Terrain studio pane block not found in main (already extracted?). Restore from git before re-running.",
  );
}

const lines = mainText.split(/\r?\n/);

let start = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === "{" && lines[i + 1]?.includes("const pane = new Pane({ title: \"Terrain studio\" }")) {
    start = i;
    break;
  }
}
if (start < 0) throw new Error("pane block start not found");

let end = -1;
for (let i = start + 10; i < lines.length; i++) {
  if (lines[i].trim() !== "}") continue;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() === "") j++;
  if (lines[j]?.trim().startsWith("renderer.domElement.addEventListener")) {
    end = i;
    break;
  }
}
if (end < 0) throw new Error("pane block end not found");

let body = lines.slice(start + 1, end).join("\n");
body = body.replace(/^\s*editorPane\s*=\s*pane\s*;\s*$/m, "");
body = body.replace(/\beditorPane\b/g, "pane");

const firstLineRe = /^\s*const\s+pane\s*=\s*new\s+Pane\(\{\s*title:\s*"Terrain studio"\s*\}\)\s*;\s*\n?/;
if (!firstLineRe.test(body)) throw new Error("expected first line const pane = new Pane(...)");
const innerRest = body.replace(firstLineRe, "");

let ast;
try {
  ast = babelParser.parse(innerRest, {
    sourceType: "script",
    allowReturnOutsideFunction: false,
    plugins: ["optionalChaining", "nullishCoalescingOperator", "numericSeparator"],
  });
} catch (e) {
  console.error(e);
  throw e;
}

const unbound = new Set();
traverse.default(ast, {
  ReferencedIdentifier(path) {
    const name = path.node.name;
    const binding = path.scope.getBinding(name);
    if (!binding) unbound.add(name);
  },
});

const needWire = [...unbound]
  .filter((n) => !reserved.has(n) && !builtins.has(n) && !browserGlobals.has(n))
  .filter((n) => n !== "pane")
  .sort();

/** `new Pane` lives in the sloppy wrapper, not innerRest — ensure Pane is wired. */
if (!needWire.includes("Pane")) needWire.push("Pane");
needWire.sort();

fs.writeFileSync(
  outCtx,
  `/** Live bindings for the Terrain studio Tweakpane (sloppy \`with\` scope). */\nexport const UIctx = Object.create(null);\n`,
  "utf8",
);

const innerJson = JSON.stringify(innerRest + "\n");

const paneSource = `${[
  `import { UIctx } from "./splatmap-chunks-ui-context.js";`,
  ``,
  `const __INNER__ = ${innerJson};`,
  ``,
  `/** Creates the Terrain studio pane; requires UIctx populated from main (see Object.assign after ambient FX init). */`,
  `export function mountTerrainStudioPane() {`,
  `  const fn = new Function(`,
  `    "__",`,
  `    "with(__) {\\nvar pane = new Pane({ title: \\"Terrain studio\\" });\\n" + __INNER__ + "\\n}\\nreturn pane;\\n",`,
  `  );`,
  `  return fn(UIctx);`,
  `}`,
  ``,
].join("\n")}`;

fs.writeFileSync(outPane, paneSource, "utf8");

const wireLines = [
  `queueMicrotask(() => {`,
  `Object.assign(UIctx, {`,
  ...needWire.map((k) => `  ${k},`),
  `});`,
  `editorPane = mountTerrainStudioPane();`,
  `});`,
];

const before = lines.slice(0, start).join("\n");
const after = lines.slice(end + 1).join("\n");

let newMain = `${before}\n${wireLines.join("\n")}\n${after}`;

if (!newMain.includes("splatmap-chunks-ui-context")) {
  newMain = newMain.replace(
    /^import \* as THREE from "three";\s*\n/m,
    `import * as THREE from "three";\nimport { UIctx } from "./splatmap-chunks-ui-context.js";\nimport { mountTerrainStudioPane } from "./splatmap-chunks-editor-pane.js";\n`,
  );
}

fs.writeFileSync(mainPath, newMain, "utf8");

console.log("Wrote", path.relative(root, outCtx));
console.log("Wrote", path.relative(root, outPane));
console.log("Patched", path.relative(root, mainPath), "needWire keys:", needWire.length);
