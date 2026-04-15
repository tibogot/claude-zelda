import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlPath = path.join(root, "splatmap-chunks.html");
const outPath = path.join(root, "splatmap-chunks-main.js");

const html = fs.readFileSync(htmlPath, "utf8");
const start = html.indexOf('<script type="module">');
const end = html.indexOf("</script>", start + 1);
if (start < 0 || end < 0) throw new Error("module script not found");

let inner = html.slice(start + '<script type="module">'.length, end);
inner = inner.replace(/^\r?\n/, "");
const lines = inner.split(/\r?\n/).map((line) => line.replace(/^      /, ""));
const body = lines.join("\n");

const modularHead = `// App entry (split from the monolithic HTML workflow). Sync stylesheet from splatmap-chunks.html: npm run extract:splatmap

import { UIctx } from "./splatmap-chunks-ui-context.js";
import { mountTerrainStudioPane } from "./splatmap-chunks-editor-pane.js";
`;

let merged = modularHead + body;

/** HTML monolith still imports ocean OCEAN_DEFAULTS — keep modular main's slimmer import. */
merged = merged.replace(
  /import \{ createOceanShader, OCEAN_DEFAULTS \} from "\.\/ocean-shader\.js";/,
  'import { createOceanShader } from "./ocean-shader.js";',
);

fs.writeFileSync(outPath, merged, "utf8");
console.log("recovered", outPath, "lines", merged.split(/\r?\n/).length);
