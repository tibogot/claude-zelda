import * as THREE from "three";

/**
 * Moving/kinematic platforms for the character lab (translation-only v1:
 * elevator + slider). Each platform is an axis-aligned box, so it stays an AABB
 * as it moves — collision + carry are handled analytically by CapsuleController
 * (these meshes are NOT baked into the static BVH).
 *
 * Each platform exposes:
 *   .box   { minX..maxZ }  — current world AABB (refreshed each update)
 *   .delta { x, y, z }     — world translation applied THIS frame (for carry)
 *
 * Call update(dt) BEFORE the controller so delta + box reflect the current frame.
 */
export function createMovingPlatforms(scene) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xd2a64a,
    roughness: 0.55,
    metalness: 0.1,
  });

  const defs = [
    // Vertical elevator near the SW corner.
    { id: "elevator", w: 4, hh: 0.4, l: 4, baseX: -14, baseY: 0.4, baseZ: -16, axis: "y", amp: 2.6, speed: 0.6, phase: 0 },
    // Horizontal slider near the NE corner (moves along X).
    { id: "slider", w: 4, hh: 0.4, l: 4, baseX: 14, baseY: 0.6, baseZ: 16, axis: "x", amp: 5.0, speed: 0.7, phase: 1.4 },
  ];

  const platforms = defs.map((d) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(d.w, d.hh, d.l), mat.clone());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const p = {
      id: d.id,
      mesh,
      def: d,
      _t: d.phase,
      prevX: 0,
      prevY: 0,
      prevZ: 0,
      delta: { x: 0, y: 0, z: 0 },
      box: { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 },
      hx: d.w * 0.5,
      hy: d.hh * 0.5,
      hz: d.l * 0.5,
    };
    place(p, 0); // initial position at phase
    refreshBox(p);
    scene.add(mesh);
    return p;
  });

  function place(p) {
    const d = p.def;
    const off = Math.sin(p._t) * d.amp;
    let x = d.baseX;
    let y = d.baseY;
    let z = d.baseZ;
    // Elevator stays above its base (offset 0..2*amp) instead of dipping below.
    if (d.axis === "y") y = d.baseY + off + d.amp;
    else if (d.axis === "x") x = d.baseX + off;
    else if (d.axis === "z") z = d.baseZ + off;
    p.mesh.position.set(x, y, z);
  }

  function refreshBox(p) {
    const c = p.mesh.position;
    p.box.minX = c.x - p.hx;
    p.box.maxX = c.x + p.hx;
    p.box.minY = c.y - p.hy;
    p.box.maxY = c.y + p.hy;
    p.box.minZ = c.z - p.hz;
    p.box.maxZ = c.z + p.hz;
  }

  function update(dt) {
    for (const p of platforms) {
      p.prevX = p.mesh.position.x;
      p.prevY = p.mesh.position.y;
      p.prevZ = p.mesh.position.z;
      p._t += dt * p.def.speed;
      place(p);
      p.delta.x = p.mesh.position.x - p.prevX;
      p.delta.y = p.mesh.position.y - p.prevY;
      p.delta.z = p.mesh.position.z - p.prevZ;
      refreshBox(p);
    }
  }

  return { platforms, update };
}
