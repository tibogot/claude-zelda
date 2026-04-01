/**
 * fx-flowing-lines.js
 * Wrapper that plugs the generic flowing-lines helper into the Ambient FX Editor.
 *
 * Exposes a Tweakpane-friendly API:
 *   - createFlowingLinesFX(scene, shared)
 *   - buildFlowingLinesUI(folder, state)
 *
 * Internally uses `createFlowingLines` from `flowing-lines.js` and keeps all of
 * the important artist-facing controls (matching flowing-lines-showcase.html).
 */

import * as THREE from "three";
import { createFlowingLines } from "./flowing-lines.js";

/**
 * Create the Flowing Lines / "Wind Lines" ambient FX.
 * @param {THREE.Scene} scene
 * @param {object} shared - shared environment params from ambient-fx-editor
 */
export function createFlowingLinesFX(scene, shared) {
  // Match defaults / ranges from flowing-lines-showcase.html
  const params = {
    lineCount: 12,
    lineLength: 14,
    lineWidth: 0.18,
    segments: 24,
    heightOffset: 0.4,
    verticalWave: 0.1,
    animationSpeed: 1.2,
    pathRadius: 30,
    pathFrequency: 0.9,
    lineColor: "#a8d8ea",
    lineOpacity: 0.75,
    // Extra realism hooks from flowing-lines.js (kept simple by default)
    pathNoise: 0.0,
    windStrength: 0.0,
    depthFadeNear: 0.0,
    depthFadeFar: 0.0,
  };

  let flowing = null;

  function getTerrainHeight(x, z) {
    // Use the shared ground Y so the ribbons follow your current ground offset.
    // You can swap this later for a more complex sampled height if needed.
    return shared.groundY;
  }

  function buildFlowingInstance() {
    // Clean up old instance if any
    if (flowing) {
      if (flowing.group) {
        scene.remove(flowing.group);
      }
      if (flowing.linesData) {
        for (const line of flowing.linesData) {
          if (line.mesh) {
            line.mesh.geometry.dispose();
          }
        }
      }
      if (flowing.uColor && flowing.uColor.value instanceof THREE.Color) {
        // nothing to dispose, just release reference
      }
    }

    flowing = createFlowingLines({
      scene,
      getTerrainHeight,
      lineCount: params.lineCount,
      lineLength: params.lineLength,
      lineWidth: params.lineWidth,
      segments: params.segments,
      heightOffset: params.heightOffset,
      verticalWave: params.verticalWave,
      animationSpeed: params.animationSpeed,
      pathRadius: params.pathRadius,
      pathFrequency: params.pathFrequency,
      lineColor: params.lineColor,
      lineOpacity: params.lineOpacity,
      pathNoise: params.pathNoise,
      // Tie basic wind to the global wind direction/strength
      windDirX: shared.windX,
      windDirZ: shared.windZ,
      windSpeed: params.windStrength * shared.windStrength * 0.05,
      depthFadeNear: params.depthFadeNear,
      depthFadeFar: params.depthFadeFar,
    });
  }

  buildFlowingInstance();

  function update(_dt, elapsed) {
    if (!flowing) return;

    // Keep dynamic params in sync each frame
    flowing.params.heightOffset = params.heightOffset;
    flowing.params.verticalWave = params.verticalWave;
    flowing.params.animationSpeed = params.animationSpeed;
    flowing.params.pathRadius = params.pathRadius;
    flowing.params.pathFrequency = params.pathFrequency;
    flowing.params.pathNoise = params.pathNoise;

    // Couple to shared wind so the lines drift with your ambient wind
    flowing.params.windDirX = shared.windX;
    flowing.params.windDirZ = shared.windZ;
    flowing.params.windSpeed = params.windStrength * shared.windStrength * 0.05;

    flowing.setParams({
      lineColor: params.lineColor,
      lineOpacity: params.lineOpacity,
      depthFadeNear: params.depthFadeNear,
      depthFadeFar: params.depthFadeFar,
    });

    flowing.update(elapsed);
  }

  function dispose(sc) {
    if (flowing) {
      if (flowing.group) {
        sc.remove(flowing.group);
      }
      if (flowing.linesData) {
        for (const line of flowing.linesData) {
          if (line.mesh) {
            line.mesh.geometry.dispose();
          }
        }
      }
      flowing = null;
    }
  }

  function rebuild() {
    buildFlowingInstance();
  }

  return {
    update,
    dispose,
    rebuild,
    params,
    get flowing() {
      return flowing;
    },
  };
}

/**
 * Build the Tweakpane UI for flowing / wind lines.
 * Matches the lil-gui controls from flowing-lines-showcase.html.
 */
export function buildFlowingLinesUI(folder, state) {
  const p = state.params;

  folder.addButton({ title: "Apply geometry" }).on("click", () => {
    state.rebuild();
  });

  folder.addBinding(p, "lineCount", {
    label: "Line Count",
    min: 1,
    max: 24,
    step: 1,
  });

  folder.addBinding(p, "lineLength", {
    label: "Line Length",
    min: 4,
    max: 30,
    step: 1,
  });

  folder.addBinding(p, "lineWidth", {
    label: "Line Width",
    min: 0.05,
    max: 0.5,
    step: 0.01,
  });

  folder.addBinding(p, "segments", {
    label: "Segments",
    min: 8,
    max: 48,
    step: 2,
  });

  folder.addBinding(p, "heightOffset", {
    label: "Height Offset",
    min: 0,
    max: 3,
    step: 0.05,
  });

  folder.addBinding(p, "verticalWave", {
    label: "Vertical Wave",
    min: 0,
    max: 0.3,
    step: 0.01,
  });

  folder.addBinding(p, "animationSpeed", {
    label: "Anim Speed",
    min: 0.2,
    max: 3,
    step: 0.05,
  });

  folder.addBinding(p, "pathRadius", {
    label: "Path Radius",
    min: 10,
    max: 80,
    step: 2,
  });

  folder.addBinding(p, "pathFrequency", {
    label: "Path Freq",
    min: 0.2,
    max: 2,
    step: 0.05,
  });

  folder.addBinding(p, "lineColor", {
    label: "Line Color",
  });

  folder.addBinding(p, "lineOpacity", {
    label: "Opacity",
    min: 0.2,
    max: 1,
    step: 0.05,
  });

  // A small advanced section so you can push realism further if desired.
  const adv = folder.addFolder({ title: "Advanced", expanded: false });

  adv.addBinding(p, "pathNoise", {
    label: "Path Noise",
    min: 0,
    max: 4,
    step: 0.1,
  });

  adv.addBinding(p, "windStrength", {
    label: "Wind Coupling",
    min: 0,
    max: 3,
    step: 0.05,
  });

  adv.addBinding(p, "depthFadeNear", {
    label: "Depth Fade Near",
    min: 0,
    max: 80,
    step: 1,
  });

  adv.addBinding(p, "depthFadeFar", {
    label: "Depth Fade Far",
    min: 0,
    max: 200,
    step: 1,
  });
}

