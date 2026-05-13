/**
 * Reads _wgsl_body.txt and emits procedural-clouds-tsl-wgsl.mjs for TSL wgsl()/wgslFn() injection.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const root = path.join( __dirname, ".." );
const srcPath = path.join( root, "_wgsl_body.txt" );
const outPath = path.join( root, "procedural-clouds-tsl-wgsl.mjs" );

function removeFnBlock( source, entryLinePrefix ) {

	const i = source.indexOf( entryLinePrefix );
	if ( i < 0 ) return source;
	const brace0 = source.indexOf( "{", i );
	if ( brace0 < 0 ) return source;
	let depth = 0;
	let k = brace0;
	for ( ; k < source.length; k ++ ) {

		const ch = source[ k ];
		if ( ch === "{" ) depth ++;
		else if ( ch === "}" ) {

			depth --;
			if ( depth === 0 ) {

				k ++;
				break;

			}

		}

	}
	return source.slice( 0, i ) + source.slice( k );

}

let w = fs.readFileSync( srcPath, "utf8" );

w = w.replace(
	/@group\(0\) @binding\(0\) var<uniform> camera : Camera;\s*@group\(0\) @binding\(1\) var<uniform> params : Params;\s*@group\(1\) @binding\(0\) var densitySampler : sampler;\s*@group\(1\) @binding\(1\) var densityTex0 : texture_3d<f32>;\s*@group\(1\) @binding\(2\) var densityTex1 : texture_3d<f32>;\s*@group\(2\) @binding\(0\) var densityStore : texture_storage_3d<rgba16float, write>;\s*/m,
	""
);

// Remove GPU entry points (TSL provides vertex; compute is tsl_compute_write_density_cell).
const vsIdx = w.indexOf( "struct VSOut" );
if ( vsIdx >= 0 ) {

	const he = w.indexOf( "// ============================================================\n// Helpers", vsIdx );
	if ( he > vsIdx ) w = w.slice( 0, vsIdx ) + w.slice( he );

}

w = removeFnBlock( w, "@fragment\nfn fs(" );
w = removeFnBlock( w, "@compute @workgroup_size(8, 8, 4)\nfn cs(" );

w = w.replace(
	/fn getBoxMax\(\) -> vec3f \{\s*return vec3f\(BOX_MAX_XZ, params\.bounds_pack\.x, BOX_MAX_XZ\);\s*\}/m,
	"fn getBoxMax_params( params: Params ) -> vec3f {\n  return vec3f(BOX_MAX_XZ, params.bounds_pack.x, BOX_MAX_XZ);\n}"
);

w = w.replace(
	/fn cloudDensity\(pos : vec3f\) -> f32 \{/m,
	"fn cloudDensity_params( pos : vec3f, params: Params ) -> f32 {"
);

w = w.replace(
	/fn sampleDensity\(pos: vec3f\) -> f32 \{\s*let uvw = \(pos - BOX_MIN\) \/ \(getBoxMax\(\) - BOX_MIN\);\s*if \(any\(uvw < vec3f\(0\.0\)\) \|\| any\(uvw > vec3f\(1\.0\)\)\) \{\s*return 0\.0;\s*\}\s*let a = textureSampleLevel\(densityTex0, densitySampler, uvw, 0\.0\)\.r;\s*let b = textureSampleLevel\(densityTex1, densitySampler, uvw, 0\.0\)\.r;\s*let blend = clamp\(params\.cache_pack\.x, 0\.0, 1\.0\);\s*let density = mix\(a, b, blend\);\s*return density;\s*\}/m,
	`fn sampleDensity_params(
  pos: vec3f,
  params: Params,
  densityTex0: texture_3d<f32>,
  densityTex1: texture_3d<f32>
) -> f32 {
  let uvw = (pos - BOX_MIN) / (getBoxMax_params(params) - BOX_MIN);
  if (any(uvw < vec3f(0.0)) || any(uvw > vec3f(1.0))) {
    return 0.0;
  }
  let d0 = textureDimensions(densityTex0);
  let d1 = textureDimensions(densityTex1);
  let p0 = uvw * vec3f(d0);
  let p1 = uvw * vec3f(d1);
  let c0 = clamp(p0, vec3f(0.0), vec3f(d0) - vec3f(1.0));
  let c1 = clamp(p1, vec3f(0.0), vec3f(d1) - vec3f(1.0));
  let tc0 = vec3i(i32(c0.x), i32(c0.y), i32(c0.z));
  let tc1 = vec3i(i32(c1.x), i32(c1.y), i32(c1.z));
  let a = textureLoad(densityTex0, tc0, 0i).r;
  let b = textureLoad(densityTex1, tc1, 0i).r;
  let blend = clamp(params.cache_pack.x, 0.0, 1.0);
  let density = mix(a, b, blend);
  return density;
}`
);

w = w.replace(
	/fn lightMarch\(pos : vec3f\) -> f32 \{\s*var shadow = 0\.0;\s*let steps = i32\(params\.cache_pack\.y\);\s*let stepSize = 0\.15;\s*for \(var i = 1; i <= steps; i\+\+\) \{\s*let p = pos \+ SUN_DIR \* \(f32\(i\) \* stepSize\);\s*shadow \+= sampleDensity\(p\) \* stepSize;\s*\}\s*return exp\(-shadow \* params\.cache_pack\.z\);\s*\}/m,
	`fn lightMarch_params(
  pos : vec3f,
  params: Params,
  densityTex0: texture_3d<f32>,
  densityTex1: texture_3d<f32>
) -> f32 {
  var shadow = 0.0;
  let steps = i32(params.cache_pack.y);
  let stepSize = 0.15;
  for (var i = 1; i <= steps; i = i + 1) {
    let p = pos + SUN_DIR * (f32(i) * stepSize);
    shadow += sampleDensity_params(p, params, densityTex0, densityTex1) * stepSize;
  }
  return exp(-shadow * params.cache_pack.z);
}`
);

w = w.replace( /getBoxMax\(\)/g, "getBoxMax_params(params)" );

w = w.replace(
	/fn intersectBox\(ro : vec3f, rd : vec3f\) -> HitInfo \{/m,
	"fn intersectBox(ro : vec3f, rd : vec3f, params: Params) -> HitInfo {"
);

// Tint / driver hardening: explicit mip level i32, no bool in HitInfo, explicit loop increments.
w = w.replace(
	/struct HitInfo \{\s*\n\s*hit\s*:\s*bool,/m,
	`struct HitInfo {
  hit   : u32,`
);
w = w.replace(
	/return HitInfo\(tFar >= max\(tNear, 0\.0\), tNear, tFar\);/g,
	"return HitInfo(select(0u, 1u, tFar >= max(tNear, 0.0)), tNear, tFar);"
);

// Move BOX_* / getBoxMax_params above intersectBox if order wrong — getBoxMax_params already exists before intersectBox in file.

const tailTsl = `

fn tsl_fragment_shade(
  fragCoord: vec4f,
  uv: vec2f,
  camera: Camera,
  params: Params,
  densityTex0: texture_3d<f32>,
  densityTex1: texture_3d<f32>
) -> vec4f {
  let skipLight = params.extra_pack.w > 0.5;
  let numSteps = i32(params.extra_pack.z);
  // vec4 has no (vec2, f32, f32) overload — use vec2 + vec2.
  let world_near = camera.invViewProj * vec4f(uv, vec2f(0.0, 1.0));
  let world_far  = camera.invViewProj * vec4f(uv, vec2f(1.0, 1.0));
  let ro = camera.position;
  let rd = normalize(world_far.xyz/world_far.w - world_near.xyz/world_near.w);

  let hit = intersectBox(ro, rd, params);

  let sky = mix(BG_COLOR, vec3f(0.1, 0.2, 0.4), clamp(rd.y * 0.5 + 0.5, 0.0, 1.0));
  let sunTheta = dot(rd, SUN_DIR);
  let finalSky = sky + pow(max(sunTheta, 0.0), 64.0) * SUN_COLOR * 0.8;

  var outColor = finalSky;

  if (hit.hit != 0u) {
    let tEntry = max(hit.tNear, 0.0);
    let tExit  = hit.tFar;
    let stepSize = (tExit - tEntry) / f32(numSteps);
    let dither = interleavedGradientNoise(fragCoord.xy);

    var pos = ro + rd * (tEntry + stepSize * dither);
    var transmittance = 1.0;
    var color = vec3f(0.0);
    let phase = mix(1.0, hgPhase(sunTheta, 0.45), 0.6);

    for (var i = 0; i < numSteps; i = i + 1) {
      let d = sampleDensity_params(pos, params, densityTex0, densityTex1);
      if (d > 0.01) {
        let step_trans = exp(-d * stepSize);
        let shadow = select(lightMarch_params(pos, params, densityTex0, densityTex1), 1.0, skipLight);
        let scattering = shadow * phase * (1.0 - exp(-d * 1.0));
        let litColor = SUN_COLOR * scattering * params.cache_pack.w + AMBIENT * 0.5;

        color += transmittance * (1.0 - step_trans) * litColor;
        transmittance *= step_trans;
        let cutoff = 0.01;
        if (transmittance < cutoff) { break; }
      }
      pos += rd * stepSize;
    }
    outColor = color + transmittance * finalSky;
  }

  outColor = outColor / (outColor + vec3f(1.0));
  outColor = pow(outColor, vec3f(1.0 / 2.2));
  return vec4f(outColor, 1.0);
}

fn tsl_compute_write_density_cell(
  gid: vec3u,
  dims: vec3u,
  params: Params,
  densityStore: texture_storage_3d<rgba32float, write>
) {
  if (gid.x >= dims.x || gid.y >= dims.y || gid.z >= dims.z) { return; }

  let uvw = (vec3f(gid) + 0.5) / vec3f(dims);
  let pos = mix(BOX_MIN, getBoxMax_params(params), uvw);
  let d = cloudDensity_params(pos, params);
  textureStore(densityStore, vec3i(gid), vec4f(d, 0.0, 0.0, 1.0));
}
`;

const uniformsHdr = "// ============================================================\n// Uniforms";
const cloudHdr = "// ------------------------------------------------------------\n// Cloud Density (100% Blender Node Graph Match)\n// ------------------------------------------------------------";
const rayHdr = "// ============================================================\n// Ray Marching";

const uIdx = w.indexOf( uniformsHdr );
const cIdx = w.indexOf( cloudHdr );
const rIdx = w.indexOf( rayHdr );
if ( uIdx < 0 || cIdx < 0 || rIdx < 0 || cIdx <= uIdx || rIdx <= cIdx ) {

	throw new Error( "gen-procedural-clouds-tsl-wgsl: section markers missing or out of order (Uniforms / Cloud Density / Ray Marching)." );

}

const helpersHdr = "// ============================================================\n// Helpers";
const hi = w.indexOf( helpersHdr, uIdx );
if ( hi < 0 || hi >= cIdx ) throw new Error( "gen-procedural-clouds-tsl-wgsl: Helpers header not found inside Uniforms..CloudDensity range." );

const rayBlock = w.slice( rIdx );
const hitIdx = rayBlock.indexOf( "struct HitInfo" );
if ( hitIdx < 0 ) throw new Error( "gen-procedural-clouds-tsl-wgsl: struct HitInfo not found in Ray Marching block." );

// sampleDensity_params must come AFTER BOX_MIN / getBoxMax_params — forward use fails on some Tint paths.
const rayPrefix = rayBlock.slice( 0, hitIdx );
const rayRest = rayBlock.slice( hitIdx );
const fragSlice =
	w.slice( uIdx, hi ) +
	rayPrefix +
	w.slice( hi, cIdx ) +
	rayRest;

const iFrag = tailTsl.indexOf( "fn tsl_fragment_shade" );
const iCompute = tailTsl.indexOf( "fn tsl_compute_write_density_cell" );
if ( iFrag < 0 || iCompute < 0 ) throw new Error( "tailTsl missing TSL entry fns" );
const tailFragOnly = tailTsl.slice( iFrag, iCompute ).trimEnd();

let wFrag = fragSlice + "\n\n" + tailFragOnly + "\n";
w += tailTsl;

// Unique struct names: "Params" / "Camera" are common in tooling output and can collide with TSL-generated WGSL.
function renameCloudTypes( src ) {

	let o = src;
	o = o.replace( /^struct Params\s*\{/m, "struct PcCloudParams {" );
	o = o.replace( /^struct Camera\s*\{/m, "struct PcCloudCamera {" );
	o = o.replace( /\bparams: Params\b/g, "params: PcCloudParams" );
	o = o.replace( /\bcamera: Camera\b/g, "camera: PcCloudCamera" );
	return o;

}

w = renameCloudTypes( w );
wFrag = renameCloudTypes( wFrag );

const escapedFull = JSON.stringify( w );
const escapedFrag = JSON.stringify( wFrag );
fs.writeFileSync(
	outPath,
	`// Auto-generated by scripts/gen-procedural-clouds-tsl-wgsl.mjs — do not hand-edit.\n` +
	`/** Full WGSL (noise + Voronoi + density + ray helpers + TSL entry points). Use with compute \`wgslFn\`. */\n` +
	`export const WGSL_TSL_LIB = ${ escapedFull };\n` +
	`/** Small WGSL bundle for the fragment \`wgslFn\` only (no noise graph — avoids validating unused code in the fragment module). */\n` +
	`export const WGSL_TSL_FRAG_LIB = ${ escapedFrag };\n`
);
console.log( "Wrote", outPath, "full", w.length, "frag-only", wFrag.length );
