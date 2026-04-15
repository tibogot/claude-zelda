import * as THREE from "three";

/**
 * splatmap-chunks `applySculptAt`: Alt → flatten, Ctrl → smooth, else stamp from `sculptMode`.
 * Flatten-only tool (`sculptMode === "flatten"`) always flattens without Alt.
 */
export function resolveSculptStrokeMode(toolState, pointerEvent = {}) {
  if (toolState.sculptMode === "flatten") {
    return { mode: "flatten" };
  }
  if (pointerEvent.altKey) {
    return { mode: "flatten" };
  }
  if (pointerEvent.ctrlKey || pointerEvent.metaKey) {
    return { mode: "smooth" };
  }
  if (toolState.sculptMode === "noise") {
    return { mode: "noise" };
  }
  return { mode: toolState.sculptMode };
}

export function createBrushStrokeFromHit({
  hitPoint,
  toolState,
  sign,
  flattenTargetY,
  sessionBrushSeed,
  pointerEvent,
}) {
  const radius = toolState.brush.radius;
  const strength = toolState.brush.strength;
  const useSessionSeed = toolState.sculptMode === "fbmPeak";
  const { mode: resolvedMode } = resolveSculptStrokeMode(toolState, pointerEvent);
  return {
    mode: resolvedMode,
    sign,
    cx: hitPoint.x,
    cz: hitPoint.z,
    radius,
    strength,
    falloff: toolState.brush.falloff,
    flattenTargetY,
    seed: useSessionSeed ? (sessionBrushSeed ?? 0) : Math.random() * 10000,
    minX: hitPoint.x - radius,
    maxX: hitPoint.x + radius,
    minZ: hitPoint.z - radius,
    maxZ: hitPoint.z + radius,
    ...(toolState.sculptMode === "fbmPeak"
      ? { fbmPeak: { ...toolState.fbmPeak } }
      : {}),
  };
}

export function shouldApplyStroke(lastPoint, nextPoint, radius, spacingFactor) {
  if (!lastPoint) return true;
  const minDist = Math.max(0.6, radius * spacingFactor);
  return lastPoint.distanceToSquared(nextPoint) >= minDist * minDist;
}

export function worldBrushBounds(center, radius) {
  return {
    minX: center.x - radius,
    minZ: center.z - radius,
    maxX: center.x + radius,
    maxZ: center.z + radius,
  };
}

