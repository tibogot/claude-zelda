/**
 * Revo-style fluffy grass tile — density / size from toolState.revoGrass.
 */
export function getRevoGrassConfig(rp) {
  const bladesPerSide = Math.max(32, Math.min(1088, Math.floor(rp.bladesPerSide ?? 1088)));
  const tileSize = Math.max(20, rp.tileSize ?? 130);
  const segments = Math.max(1, Math.min(8, Math.floor(rp.segments ?? 4)));
  const bladeHeight = rp.bladeHeight ?? 1.75;
  const bladeWidth = rp.bladeWidth ?? 0.06;
  return {
    segments,
    bladeWidth,
    bladeHeight,
    bladeBoundingRadius: bladeHeight,
    tileSize,
    tileHalfSize: tileSize * 0.5,
    bladesPerSide,
    count: bladesPerSide * bladesPerSide,
    spacing: tileSize / bladesPerSide,
    workgroupSize: 64,
  };
}
