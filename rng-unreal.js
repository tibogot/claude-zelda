/**
 * Seeded RNG for deterministic procedural generation (terrain, trees, etc.).
 */
let _seed = 0;

export function setSeed(s) {
  _seed = s;
}

export function seededRandom() {
  const x = Math.sin(_seed++) * 10000;
  return x - Math.floor(x);
}

export function randRange(lo, hi) {
  return lo + seededRandom() * (hi - lo);
}
