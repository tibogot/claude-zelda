/**
 * Converts Anderson Mancini GLSL fragment body → WGSL library for TSL wgslFn().
 * Run: node scripts/gen-lensflare-mancini-wgsl.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outPath = path.join(root, "effects", "lensflare-mancini-wgsl.mjs");

/** GLSL fragment body (from LensFlare.js), without uniforms/varying/main wrapper */
const GLSL = `
float uDispersal = 0.3;
float uHaloWidth = 0.6;
float uDistortion = 1.5;
float uBrightDark = 0.5;

float lf_rand(float n){return fract(sin(n) * 43758.5453123);}
float lf_noise(float p){
  float fl = floor(p);
  float fc = fract(p);
  return mix(lf_rand(fl),lf_rand(fl + 1.0), fc);
}
vec3 lf_hsv2rgb(vec3 c) {
  vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
}
float lf_saturate2(float x) { return clamp(x, 0.0, 1.0); }
vec2 lf_rotateUV(vec2 uv, float rotation) {
  return vec2(
    cos(rotation) * uv.x + sin(rotation) * uv.y,
    cos(rotation) * uv.y - sin(rotation) * uv.x
  );
}
`;

function glslToWgsl(src) {
  let w = src;
  w = w.replace(/\/\/.*$/gm, "");
  w = w.replace(/\bfloat\b/g, "f32");
  w = w.replace(/\bvec2\b/g, "vec2f");
  w = w.replace(/\bvec3\b/g, "vec3f");
  w = w.replace(/\bvec4\b/g, "vec4f");
  w = w.replace(/\bmat2\b/g, "mat2x2f");
  w = w.replace(/\bint\b/g, "i32");
  w = w.replace(/\bsampler2D\b/g, "texture_2d<f32>");
  w = w.replace(/\btexture\s*\(/g, "textureSampleLF(");
  w = w.replace(/\.0\b/g, ".0");
  w = w.replace(/(\d+)\./g, "$1.0");
  return w;
}

// Full shader as single template - hand-ported core in output file below via direct write
console.log("Use effects/lensflare-mancini-wgsl.mjs (hand-maintained WGSL)");
