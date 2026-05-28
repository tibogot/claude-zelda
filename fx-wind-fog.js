/**
 * fx-wind-fog.js
 * Ghost Tsushima–style wind fog ribbons for the Ambient FX template.
 *
 *   createWindFogFX(scene, shared, getTerrainHeight)
 *   buildWindFogUI(folder, state)
 */

import {
  createWindFogRibbons,
  WIND_FOG_RIBBON_DEFAULTS,
} from "./wind-fog-ribbons.js";

export function createWindFogFX(scene, shared, getTerrainHeight) {
  const params = structuredClone(WIND_FOG_RIBBON_DEFAULTS);

  let fog = null;

  function terrainAt(x, z) {
    return getTerrainHeight(x, z) + (shared.groundY ?? 0);
  }

  function build() {
    if (fog) fog.dispose(scene);
    fog = createWindFogRibbons({
      scene,
      getTerrainHeight: terrainAt,
      params,
    });
    fog.rebuild(shared.volume ?? 30);
  }

  build();

  function update(_dt, elapsed, env) {
    if (!fog) return;
    const windStrength = (env?.windStrength ?? 1) * (env?.density ?? 1);
    fog.update(elapsed, env?.windX ?? 1, env?.windZ ?? 0, windStrength);
  }

  function dispose(sc) {
    if (fog) {
      fog.dispose(sc);
      fog = null;
    }
  }

  function rebuild() {
    if (fog) fog.rebuild(shared.volume ?? 30);
    else build();
  }

  return {
    update,
    dispose,
    rebuild,
    params,
    get fog() {
      return fog;
    },
  };
}

export function buildWindFogUI(folder, state) {
  const p = state.params;

  const motion = folder.addFolder({ title: "Motion", expanded: true });
  motion.addBinding(p, "speedMult", {
    label: "Speed ×",
    min: 0.05,
    max: 6,
    step: 0.01,
  });
  motion.addBinding(p, "trailLenMult", {
    label: "Trail length ×",
    min: 0.1,
    max: 4,
    step: 0.01,
  });
  motion.addBinding(p, "latAmp", {
    label: "Lateral amp 1",
    min: 0,
    max: 40,
    step: 0.1,
  });
  motion.addBinding(p, "latAmp2", {
    label: "Lateral amp 2",
    min: 0,
    max: 20,
    step: 0.1,
  });
  motion.addBinding(p, "latFreq", {
    label: "Lateral freq 1",
    min: 0.01,
    max: 1.5,
    step: 0.01,
  });
  motion.addBinding(p, "latFreq2", {
    label: "Lateral freq 2",
    min: 0.01,
    max: 1.2,
    step: 0.01,
  });
  motion.addBinding(p, "vertAmp", {
    label: "Vertical amp",
    min: 0,
    max: 5,
    step: 0.05,
  });
  motion.addBinding(p, "vertFreq", {
    label: "Vertical freq",
    min: 0.01,
    max: 2,
    step: 0.01,
  });
  motion.addBinding(p, "minClear", {
    label: "Ground clearance",
    min: 0,
    max: 4,
    step: 0.05,
  });
  motion.addBinding(p, "useSharedWind", { label: "Use env wind dir" });
  motion.addBinding(p, "windAngle", {
    label: "Wind angle °",
    min: -180,
    max: 180,
    step: 1,
  });
  motion.addBinding(p, "windSpeedCoupling", {
    label: "Wind speed coupling",
    min: 0,
    max: 3,
    step: 0.05,
  });

  const shape = folder.addFolder({ title: "Shape", expanded: false });
  shape.addBinding(p, "widthMult", {
    label: "Width ×",
    min: 0.1,
    max: 5,
    step: 0.05,
  });
  shape.addBinding(p, "tiltOffset", {
    label: "Tilt offset",
    min: -0.9,
    max: 0.9,
    step: 0.01,
  });
  shape.addBinding(p, "spread", {
    label: "Spread ×",
    min: 0.3,
    max: 3,
    step: 0.05,
  });

  const rowLabels = ["Row 0 (ground)", "Row 1", "Row 2", "Row 3 (high)"];
  const rowKeys = ["row0", "row1", "row2", "row3"];
  rowKeys.forEach((key, i) => {
    const fr = shape.addFolder({ title: rowLabels[i], expanded: false });
    fr.addBinding(p[key], "baseY", {
      label: "Base height",
      min: 0,
      max: 10,
      step: 0.1,
    });
    fr.addBinding(p[key], "tiltBase", {
      label: "Base tilt",
      min: 0,
      max: 1,
      step: 0.01,
    });
    fr.addBinding(p[key], "count", {
      label: "Count",
      min: 1,
      max: 12,
      step: 1,
    });
  });

  shape.addButton({ title: "Rebuild ribbons" }).on("click", () => {
    state.rebuild();
  });

  const shader = folder.addFolder({ title: "Shader", expanded: true });
  shader.addBinding(p, "baseColor", { label: "Base color" });
  shader.addBinding(p, "hotColor", { label: "Hot color" });
  shader.addBinding(p, "densityMult", {
    label: "Density ×",
    min: 0.1,
    max: 4,
    step: 0.05,
  });
  shader.addBinding(p, "warpMult", {
    label: "Warp ×",
    min: 0,
    max: 3,
    step: 0.05,
  });
  shader.addBinding(p, "shaderSpeedMult", {
    label: "Shader speed ×",
    min: 0.1,
    max: 5,
    step: 0.05,
  });
}
