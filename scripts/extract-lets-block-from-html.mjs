import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "splatmap-chunks.html");
const html = fs.readFileSync(htmlPath, "utf8");
const start = html.indexOf('<script type="module">');
const end = html.indexOf("</script>", start + 1);
let inner = html.slice(start + '<script type="module">'.length, end);
inner = inner.replace(/^\r?\n/, "");
const lines = inner.split(/\r?\n/).map((line) => line.replace(/^      /, ""));

const a = lines.findIndex((l) => l.trim() === "let splinePoints = [];");
const b = lines.findIndex((l) => l.trim().startsWith("function worldToUV("));
if (a < 0 || b < 0) throw new Error(`markers not found a=${a} b=${b}`);
const block = lines.slice(a, b).join("\n");
fs.writeFileSync(path.join(root, "scripts/_lets-from-html.txt"), block, "utf8");
console.log("lines", b - a, "written scripts/_lets-from-html.txt");
