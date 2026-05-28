/** Stable string keys for chunk (cx, cz) — used across height/splat maps and LOD. */

export function chunkKey(cx, cz) {
  return `${cx},${cz}`;
}

export function parseChunkKey(key) {
  const [cx, cz] = key.split(",").map(Number);
  return { cx, cz };
}
