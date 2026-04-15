/**
 * Read splatmap-chunks.html (unchanged) and refresh splatmap-chunks-app.css.
 * JS lives in splatmap-chunks-main.js (+ modules); it is not overwritten here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "splatmap-chunks.html");
const outCss = path.join(root, "splatmap-chunks-app.css");

const raw = fs.readFileSync(src, "utf8");
const lines = raw.split(/\r?\n/);

// <style> content: lines 8–218 in current file (1-based) → index 7–217
const cssLines = lines.slice(7, 218);
const css = cssLines
  .map((line) => (line.startsWith("      ") ? line.slice(6) : line))
  .join("\n")
  .trimEnd();

// <script type="module"> body: after line 300 opening tag → through line before </script>
const cssBanner =
  "/* Synced from splatmap-chunks.html — run: npm run extract:splatmap */\n\n";

fs.writeFileSync(outCss, cssBanner + css + "\n", "utf8");
console.log(
  "Wrote",
  path.relative(root, outCss),
  `(${fs.statSync(outCss).size} bytes)`,
);
