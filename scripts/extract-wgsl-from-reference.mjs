/**
 * Writes _wgsl_body.txt from procedural-clouds-three-r183.html (same WGSL string literal).
 * Run from repo root: node scripts/extract-wgsl-from-reference.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname( fileURLToPath( import.meta.url ) );
const root = path.join( __dirname, ".." );
const htmlPath = path.join( root, "procedural-clouds-three-r183.html" );
const outPath = path.join( root, "_wgsl_body.txt" );

const s = fs.readFileSync( htmlPath, "utf8" );
const marker = "const WGSL_SOURCE = ";
const i = s.indexOf( marker );
if ( i < 0 ) throw new Error( "WGSL_SOURCE not found in reference HTML" );
const tail = s.slice( i + marker.length );
const end = tail.indexOf( ";\n\nif (!navigator.gpu)" );
if ( end < 0 ) throw new Error( "end marker not found" );
const expr = tail.slice( 0, end );
const WGSL_SOURCE = new Function( `return ${ expr }` )();
fs.writeFileSync( outPath, WGSL_SOURCE );
console.log( "Wrote", outPath, WGSL_SOURCE.length, "chars" );
