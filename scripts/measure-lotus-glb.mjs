/**
 * Measure chassis / wheel sizes from Lotus GLBs (meters, glTF units).
 */
import { NodeIO } from "@gltf-transform/core";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function bboxFromAccessor(accessor) {
  const min = accessor.getMin([]);
  const max = accessor.getMax([]);
  return { min, max };
}

function meshWorldBounds(node, parentMatrix = null) {
  const results = [];
  const traverse = (n, pm) => {
    const m = n.getMatrix
      ? (() => {
          const mat = n.getMatrix();
          return pm ? multiply4x4(pm, mat) : mat;
        })()
      : pm;
    if (n.getMesh) {
      const mesh = n.getMesh();
      if (mesh) {
        for (const prim of mesh.listPrimitives()) {
          const pos = prim.getAttribute("POSITION");
          if (!pos) continue;
          const { min, max } = bboxFromAccessor(pos);
          const wMin = [Infinity, Infinity, Infinity];
          const wMax = [-Infinity, -Infinity, -Infinity];
          const corners = [
            [min[0], min[1], min[2]],
            [max[0], min[1], min[2]],
            [min[0], max[1], min[2]],
            [max[0], max[1], min[2]],
            [min[0], min[1], max[2]],
            [max[0], min[1], max[2]],
            [min[0], max[1], max[2]],
            [max[0], max[1], max[2]],
          ];
          for (const c of corners) {
            const w = transformPoint(m, c);
            for (let i = 0; i < 3; i++) {
              wMin[i] = Math.min(wMin[i], w[i]);
              wMax[i] = Math.max(wMax[i], w[i]);
            }
          }
          results.push({
            meshName: mesh.getName() || "(unnamed)",
            nodeName: n.getName() || "(unnamed)",
            min: wMin,
            max: wMax,
            size: [wMax[0] - wMin[0], wMax[1] - wMin[1], wMax[2] - wMin[2]],
          });
        }
      }
    }
    for (const child of n.listChildren()) traverse(child, m);
  };
  traverse(node, parentMatrix);
  return results;
}

function transformPoint(m, p) {
  const x = p[0],
    y = p[1],
    z = p[2];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ];
}

function multiply4x4(a, b) {
  const out = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[i + j * 4] =
        a[i] * b[j * 4] +
        a[i + 4] * b[j * 4 + 1] +
        a[i + 8] * b[j * 4 + 2] +
        a[i + 12] * b[j * 4 + 3];
    }
  }
  return out;
}

function mergeBounds(items) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const it of items) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], it.min[i]);
      max[i] = Math.max(max[i], it.max[i]);
    }
  }
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  };
}

function wheelRadiusFromSize(size) {
  // Wheel axle ~ local X after CAR_MODEL_YAW; tire cross-section in YZ
  return Math.max(size[1], size[2]) * 0.5;
}

async function measureGlb(relPath, label) {
  const io = new NodeIO();
  const doc = await io.read(join(root, relPath));
  const scene = doc.getRoot().listScenes()[0];
  const all = [];
  const walk = (node) => {
    all.push(...meshWorldBounds(node));
    for (const c of node.listChildren()) walk(c);
  };
  for (const n of scene.listChildren()) walk(n);
  const chassis = all.filter(
    (x) =>
      /chassis/i.test(x.nodeName) ||
      (/BODY/i.test(x.meshName) && !/BONNET|BOOT|DOOR/i.test(x.meshName)),
  );
  const tyre = all.filter((x) => /TYRE|tire|wheelCylinder/i.test(x.meshName + x.nodeName));
  const wheelMeshes = all.filter((x) => /WHEEL|ROTOR|TYRE/i.test(x.meshName));

  const whole = mergeBounds(all);
  const chassisBox = chassis.length ? mergeBounds(chassis) : null;
  const tyreBox = tyre.length ? mergeBounds(tyre) : mergeBounds(wheelMeshes);

  console.log(`\n=== ${label} (${relPath}) ===`);
  console.log("Whole scene AABB (m):", fmtSize(whole.size), "min", fmt(whole.min), "max", fmt(whole.max));
  if (chassisBox) {
    console.log("Chassis-ish AABB (m):", fmtSize(chassisBox.size));
  }
  if (tyreBox) {
    const r = wheelRadiusFromSize(tyreBox.size);
    console.log("Tyre/wheel AABB (m):", fmtSize(tyreBox.size), "→ implied radius (max(y,z)/2):", r.toFixed(4));
  }
  return { whole, tyreRadius: tyreBox ? wheelRadiusFromSize(tyreBox.size) : null };
}

function fmt(v) {
  return v.map((n) => n.toFixed(3)).join(", ");
}
function fmtSize(s) {
  return `X=${s[0].toFixed(3)} Y=${s[1].toFixed(3)} Z=${s[2].toFixed(3)}`;
}

const realsize = await measureGlb("models/lotusrealsize2.glb", "lotusrealsize2 (real)");
const claude = await measureGlb("models/lotusclaude2.glb", "lotusclaude2 (play Lotus)");

console.log("\n=== Play-mode effective scales ===");
const CAR_MODEL_SCALE = 1.9;
const TARGET_FOOTPRINT = 5.5;
// lotusrealsize whole ~ 4.97 long → footprint max(x,z) ~ 4.97
const rsFootprint = Math.max(realsize.whole.size[0], realsize.whole.size[2]);
const claudeFootprintAt19 = Math.max(claude.whole.size[0], claude.whole.size[2]) * CAR_MODEL_SCALE;
const lotusNormalize = TARGET_FOOTPRINT / claudeFootprintAt19;
const lotusEffective = CAR_MODEL_SCALE * lotusNormalize;
const claudeNativeFootprint = Math.max(claude.whole.size[0], claude.whole.size[2]);

console.log(`\nlotusrealsize2 @ 1:1 — length~${realsize.whole.size[2].toFixed(2)}m width~${realsize.whole.size[0].toFixed(2)}m tyre R~${realsize.tyreRadius?.toFixed(3)}m`);
console.log(`lotusclaude2 native — footprint~${claudeNativeFootprint.toFixed(4)}m tyre R~${claude.tyreRadius?.toFixed(4)}m (${(realsize.tyreRadius / claude.tyreRadius).toFixed(0)}× smaller file)`);
console.log(`\nLotus play mode (lotusclaude2.glb):`);
console.log(`  scale ${CAR_MODEL_SCALE} then normalize to ${TARGET_FOOTPRINT}m → total ×${lotusEffective.toFixed(2)}`);
if (claude.tyreRadius) {
  console.log(`  effective wheel radius ≈ ${(claude.tyreRadius * lotusEffective).toFixed(3)} m`);
}
console.log(`\nVVV play mode:`);
console.log(`  wheels from lotusrealsize2.glb, scaled to physics DEFAULT ${0.36}m (native tyre ~${realsize.tyreRadius?.toFixed(3)}m)`);
console.log(`  placeholder chassis ${3.6}×${1.8}×${0.6}m vs real car ~${realsize.whole.size[2].toFixed(1)}×${realsize.whole.size[0].toFixed(1)}m`);
if (realsize.tyreRadius) {
  console.log(`  wheel vs real GLB: ${((0.36 / realsize.tyreRadius) * 100).toFixed(1)}% of true tyre radius`);
}
if (claude.tyreRadius && realsize.tyreRadius) {
  const lotusWheelAtPlay = claude.tyreRadius * lotusEffective;
  console.log(`\nLotus play wheel vs real lotusrealsize2 tyre: ${((lotusWheelAtPlay / realsize.tyreRadius) * 100).toFixed(1)}% (${lotusWheelAtPlay > realsize.tyreRadius ? "larger" : "smaller"})`);
}
