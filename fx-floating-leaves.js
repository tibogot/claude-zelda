/**
 * fx-floating-leaves.js
 * Thin wrapper around `floating-leaves.js` to plug drifting leaves
 * into the Ambient FX Editor with Tweakpane controls.
 */

import { createFloatingLeaves } from "./floating-leaves.js";

/**
 * Create floating leaves FX for the ambient editor.
 * @param {THREE.Scene} scene
 * @param {object} shared - shared env params (wind, groundY, etc.)
 * @param {(x:number, z:number)=>number} getTerrainHeight
 */
export function createFloatingLeavesFX(scene, shared, getTerrainHeight) {
  const windParams = {
    uTime: { value: 0 },
    uWindStr: { value: 1.0 },
    uWindSpeed: { value: 1.2 },
  };

  const leaves = createFloatingLeaves({
    scene,
    enabled: true,
    useTexture: true,
    enableViewThickening: true,
    viewThickenStrength: 0.35,
    getTerrainHeight: (x, z) => getTerrainHeight(x, z) + shared.groundY,
    windParams,
  });

  function update(dt, elapsed, sh) {
    windParams.uTime.value = elapsed;
    windParams.uWindStr.value = sh.windStrength;
    // uWindSpeed is edited via UI; no extra logic here.
    leaves.update();
  }

  function dispose(sc) {
    if (leaves.mesh) {
      sc.remove(leaves.mesh);
      leaves.mesh.geometry.dispose();
      leaves.mesh.material.dispose();
    }
  }

  return {
    update,
    dispose,
    params: leaves.params,
    windParams,
  };
}

/**
 * Build Tweakpane UI for floating leaves.
 * @param {*} folder
 * @param {{ params: any, windParams: any }} state
 */
export function buildFloatingLeavesUI(folder, state) {
  const p = state.params;

  folder.addBinding(p, "enabled", { label: "Enabled" });

  folder.addBinding(p, "count", {
    label: "Count",
    min: 10,
    max: p.maxCount ?? 500,
    step: 10,
  });

  folder.addBinding(p, "areaSize", {
    label: "Area Size",
    min: 10,
    max: 150,
    step: 5,
  });

  folder.addBinding(p, "spawnHeight", {
    label: "Spawn Height",
    min: 2,
    max: 60,
    step: 1,
  });

  folder.addBinding(p, "leafSize", {
    label: "Leaf Size",
    min: 0.05,
    max: 0.6,
    step: 0.01,
  });

  folder.addBinding(p, "scale", {
    label: "Scale",
    min: 0.3,
    max: 2.5,
    step: 0.1,
  });

  folder.addBinding(p, "opacity", {
    label: "Opacity",
    min: 0.1,
    max: 1,
    step: 0.05,
  });

  folder.addBinding(p, "windInfluence", {
    label: "Wind Influence",
    min: 0,
    max: 3,
    step: 0.05,
  });

  folder.addBinding(p, "gravity", {
    label: "Gravity",
    min: 0.0005,
    max: 0.01,
    step: 0.0005,
  });

  folder.addBinding(p, "terminalVelocity", {
    label: "Terminal Vel",
    min: 0.005,
    max: 0.08,
    step: 0.002,
  });

  folder.addBinding(p, "rotationSpeed", {
    label: "Rotation",
    min: 0,
    max: 0.01,
    step: 0.0005,
  });

  folder.addBinding(p, "airResistance", {
    label: "Air Resistance",
    min: 0.9,
    max: 0.999,
    step: 0.001,
  });

  folder.addBinding(p, "terrainFloorOffset", {
    label: "Floor Offset",
    min: 0,
    max: 5,
    step: 0.1,
  });

  const viewFolder = folder.addFolder({ title: "View Thickening", expanded: false });
  viewFolder.addBinding(p, "enableViewThickening", {
    label: "Enabled",
  });
  viewFolder.addBinding(p, "viewThickenStrength", {
    label: "Strength",
    min: 0,
    max: 1,
    step: 0.05,
  });

  const windFolder = folder.addFolder({ title: "Wind", expanded: false });
  const windState = { speed: state.windParams.uWindSpeed.value };
  windFolder
    .addBinding(windState, "speed", {
      label: "Wind Speed",
      min: 0.2,
      max: 4,
      step: 0.1,
    })
    .on("change", (ev) => {
      state.windParams.uWindSpeed.value = ev.value;
    });
}

