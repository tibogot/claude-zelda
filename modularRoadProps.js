import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { computeFrames, buildProfile, buildTunnelGeometry } from "./modularRoadKit.js";
import {
  kickerRampGeometry,
  jumpRampGeometry,
  buildSlopeLabGroup,
  enableMeshShadows,
} from "./modularRoadParkour.js";

/**
 * Free-placement props for the modular road. Unlike auto-chained track pieces,
 * props are standalone objects (box, wall, ramp, cylinders, ring gate, air tunnel)
 * positioned by hand with a shared TransformControls gizmo — the same pattern as
 * the v2 editor props mode (W/E/R = move/rotate/scale, right-click select).
 *
 * Each prop carries a `collision` role so the page can bake it into the right
 * BVH:
 *   - "deck"  → drive surface (wheel raycasts): ramps, the floor of a tube
 *   - "solid" → chassis wall collision only (no wheel ground): wall panels, air-tunnel shell
 *   - "both"  → drive on top AND blocked at the sides: boxes
 *   - "none"  → pure decoration you pass through: ring gates
 */

const V3 = THREE.Vector3;

/* ----------------------------------------------------------------------- */
/* Prop geometry builders                                                   */
/* ----------------------------------------------------------------------- */

/** Right-triangular prism ramp: base on y=0, rising from +Z (low) to -Z (high). */
function rampGeometry(L = 18, H = 6, W = 14) {
  const hw = W / 2;
  const zN = L / 2; // near (low) edge
  const zF = -L / 2; // far (high) edge
  const Al = [-hw, 0, zN], Bl = [-hw, 0, zF], Cl = [-hw, H, zF];
  const Ar = [hw, 0, zN], Br = [hw, 0, zF], Cr = [hw, H, zF];
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const tri = (a, b, c) => pos.push(...a, ...b, ...c);
  quad(Al, Ar, Cr, Cl); // sloped top (drive surface)
  quad(Al, Bl, Br, Ar); // bottom
  quad(Bl, Cl, Cr, Br); // vertical back
  tri(Al, Cl, Bl); // left cap
  tri(Ar, Br, Cr); // right cap
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** A short run of tunnel arch (reuses the kit's shell sweep) on a straight line. */
function airTunnelGeometry(length = 36, height = 9) {
  const n = Math.max(2, Math.ceil(length / 2));
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(new V3(0, 0, -length * (i / n)));
  const frames = computeFrames(pts);
  const profileData = buildProfile();
  const geo = buildTunnelGeometry(frames, profileData, { tunnelHeight: height });
  // Re-centre on Z so the gizmo pivot sits in the middle of the run.
  geo.translate(0, 0, length / 2);
  geo.computeBoundingSphere();
  return geo;
}

/** Thick-walled pipe: outer shell, inner liner, and annular end caps (still hollow to drive through). */
function openTubeGroup(outerR = 9, length = 30, wall = 0.65, segments = 40) {
  const innerR = outerR - wall;
  const half = length / 2;
  const tubeMat = mat(0x3a7bd5, { metalness: 0.55, roughness: 0.4, side: THREE.DoubleSide });
  const innerMat = mat(0x3a7bd5, { metalness: 0.55, roughness: 0.4, side: THREE.BackSide });

  const root = new THREE.Group();
  root.name = "OpenCylinder";

  root.add(new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR, length, segments, 1, true), tubeMat));
  root.add(new THREE.Mesh(new THREE.CylinderGeometry(innerR, innerR, length, segments, 1, true), innerMat));

  for (const y of [half, -half]) {
    const cap = new THREE.Mesh(new THREE.RingGeometry(innerR, outerR, segments), tubeMat);
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = y;
    root.add(cap);
  }

  root.rotation.x = Math.PI / 2;
  root.position.set(0, outerR, 0); // bottom of the pipe rests on the ground
  return root;
}

/* ----------------------------------------------------------------------- */
/* Prop catalog                                                             */
/* ----------------------------------------------------------------------- */

/** Shared look for the emissive "Glow box" prop. Edited live via the inspector;
 *  high emissiveIntensity (>1) so it blooms against any sky (folio-2025 style). */
export const glowPropParams = { color: "#ff5a1e", intensity: 6 };

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.7,
    metalness: opts.metalness ?? 0.1,
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    side: opts.side ?? THREE.FrontSide,
  });
}

/** @type {{id:string,label:string,collision:string,make:()=>THREE.Object3D}[]} */
export const PROP_CATALOG = [
  {
    id: "box",
    label: "Box",
    collision: "both",
    make: () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 8), mat(0x8a9099, { roughness: 0.85 }));
      m.geometry.translate(0, 2, 0); // sit on the ground
      return m;
    },
  },
  {
    id: "wall",
    label: "Wall",
    collision: "solid",
    make: () => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 4, 22), mat(0x804040, { roughness: 0.75 }));
      m.geometry.translate(0, 2, 0); // rest on the ground
      return m;
    },
  },
  {
    id: "ramp",
    label: "Slope ramp",
    collision: "both",
    make: () => new THREE.Mesh(rampGeometry(18, 6, 14), mat(0xe8912d, { roughness: 0.8 })),
  },
  {
    id: "slopelab",
    label: "Slope lab",
    collision: "both",
    make: () => buildSlopeLabGroup(),
  },
  {
    id: "glowbox",
    label: "Glow box",
    collision: "both",
    make: () => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(6, 12, 3),
        mat(glowPropParams.color, {
          roughness: 0.5,
          emissive: glowPropParams.color,
          emissiveIntensity: glowPropParams.intensity,
        }),
      );
      m.geometry.translate(0, 6, 0); // rest on the ground
      m.userData.isGlow = true;
      return m;
    },
  },
  {
    id: "kickerramp",
    label: "Convex kicker",
    collision: "both",
    make: () =>
      new THREE.Mesh(
        kickerRampGeometry(14, 20, 7, 32),
        mat(0xc07840, { roughness: 0.82 }),
      ),
  },
  {
    id: "jumpkicker",
    label: "Jump ramp",
    collision: "both",
    make: () =>
      new THREE.Mesh(
        jumpRampGeometry(14, 22, 8, 32),
        mat(0x886838, { roughness: 0.82 }),
      ),
  },
  {
    id: "tube",
    label: "Open cylinder",
    collision: "deck",
    make: () => openTubeGroup(),
  },
  {
    id: "cylinder_full",
    label: "Solid cylinder",
    collision: "both",
    make: () => {
      const r = 0.55;
      const len = 8;
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, len, 20),
        mat(0x707880, { roughness: 0.88 }),
      );
      m.geometry.rotateZ(Math.PI / 2); // axis along X — log lying on the floor
      m.geometry.translate(0, r, 0);
      return m;
    },
  },
  {
    id: "ring",
    label: "Ring (gate)",
    collision: "none",
    make: () => {
      const m = new THREE.Mesh(
        new THREE.TorusGeometry(9, 1, 18, 56),
        mat(0xf1c40f, { metalness: 0.7, roughness: 0.3, emissive: 0x6b5300, emissiveIntensity: 0.4 }),
      );
      m.geometry.translate(0, 10, 0); // lift so the hole is off the ground
      return m;
    },
  },
  {
    id: "airtunnel",
    label: "Tunnel (air)",
    collision: "solid",
    make: () => new THREE.Mesh(airTunnelGeometry(36, 9), mat(0x5b6168, { roughness: 0.92, side: THREE.DoubleSide })),
  },
];

export const PROP_BY_ID = new Map(PROP_CATALOG.map((p) => [p.id, p]));

/* ----------------------------------------------------------------------- */
/* Manager                                                                  */
/* ----------------------------------------------------------------------- */

export class PropManager {
  /**
   * @param {object} o
   * @param {THREE.Scene} o.scene
   * @param {THREE.Camera} o.camera
   * @param {HTMLElement} o.domElement
   * @param {import("three/addons/controls/OrbitControls.js").OrbitControls} o.orbit
   * @param {() => void} [o.onChange] fired when props are added/removed/moved (collision is now stale)
   * @param {() => void} [o.onSelect] fired when a prop is selected (deselect other gizmos)
   */
  constructor({ scene, camera, domElement, orbit, onChange = null, onSelect = null }) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.orbit = orbit;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.enabled = false;

    /** @type {{id:string, def:object, root:THREE.Object3D, collision:string}[]} */
    this.instances = [];
    this.selected = null;

    this.group = new THREE.Group();
    this.group.name = "RoadProps";
    scene.add(this.group);

    this.raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();

    this.gizmo = new TransformControls(camera, domElement);
    this.gizmo.setMode("translate");
    this.gizmo.setSpace("local");
    this.gizmo.enabled = false;
    this.gizmo.visible = false;
    this.gizmo.size = 0.9;
    scene.add(this.gizmo.getHelper());

    this.selBox = new THREE.BoxHelper(new THREE.Object3D(), 0xffe066);
    this.selBox.visible = false;
    scene.add(this.selBox);

    this.gizmo.addEventListener("dragging-changed", (e) => {
      if (this.orbit) this.orbit.enabled = !e.value && this.enabled;
    });
    this.gizmo.addEventListener("change", () => {
      if (this.selected) this.selBox.setFromObject(this.selected.root);
    });
    this.gizmo.addEventListener("mouseUp", () => this.onChange?.());

    domElement.addEventListener("pointerdown", (e) => {
      if (!this.enabled) return;
      if (e.button === 2) this._pickAt(e); // right-click select / deselect
    });

    // Gizmo hotkeys run in the capture phase so they take priority over the
    // builder's bubble-phase shortcuts (e.g. R = flip, Backspace = undo).
    window.addEventListener("keydown", (e) => this._onKey(e), true);
  }

  get hasSelection() {
    return !!this.selected;
  }

  /** True while the user is grabbing/hovering a gizmo handle (suppress placing). */
  isUsingGizmo() {
    return this.enabled && (this.gizmo.dragging || this.gizmo.axis != null);
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.deselect();
  }

  setMode(mode) {
    this.gizmo.setMode(mode);
  }

  /** Push the shared glow params onto every placed Glow box (live tuning). */
  applyGlowParams() {
    for (const inst of this.instances) {
      if (inst.id !== "glowbox") continue;
      inst.root.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material.color.set(glowPropParams.color);
          o.material.emissive.set(glowPropParams.color);
          o.material.emissiveIntensity = glowPropParams.intensity;
        }
      });
    }
  }

  /** Spawn a prop near the orbit target (or origin) and select it. */
  add(typeId) {
    this.onSelect?.();
    const def = PROP_BY_ID.get(typeId);
    if (!def) return null;
    const root = def.make();
    enableMeshShadows(root);
    root.userData.isProp = true;
    if (this.orbit?.target) {
      root.position.set(this.orbit.target.x, Math.max(0, this.orbit.target.y), this.orbit.target.z);
    }
    this.group.add(root);
    const inst = { id: typeId, def, root, collision: def.collision };
    root.userData.propInstance = inst;
    this.instances.push(inst);
    this._select(inst);
    this.onChange?.();
    return inst;
  }

  duplicateSelected() {
    if (!this.selected) return;
    const src = this.selected;
    const root = src.def.make();
    enableMeshShadows(root);
    root.userData.isProp = true;
    root.position.copy(src.root.position).add(new V3(4, 0, 4));
    root.quaternion.copy(src.root.quaternion);
    root.scale.copy(src.root.scale);
    this.group.add(root);
    const inst = { id: src.id, def: src.def, root, collision: src.collision };
    root.userData.propInstance = inst;
    this.instances.push(inst);
    this._select(inst);
    this.onChange?.();
  }

  deleteSelected() {
    if (!this.selected) return;
    this._removeInstance(this.selected);
    this.selected = null;
    this.gizmo.detach();
    this.gizmo.enabled = false;
    this.gizmo.visible = false;
    this.selBox.visible = false;
    this.onChange?.();
  }

  clear() {
    this.deselect();
    for (const inst of this.instances) this._disposeInstance(inst);
    this.instances = [];
    this.onChange?.();
  }

  deselect() {
    this.selected = null;
    this.gizmo.detach();
    this.gizmo.enabled = false;
    this.gizmo.visible = false;
    this.selBox.visible = false;
  }

  /** Meshes split by collision role, for the page's BVH bake. */
  collisionMeshes() {
    const deck = [];
    const solids = [];
    for (const inst of this.instances) {
      if (inst.collision === "none") continue;
      inst.root.traverse((o) => {
        if (!o.isMesh) return;
        if (inst.collision === "deck" || inst.collision === "both") deck.push(o);
        if (inst.collision === "solid" || inst.collision === "both") solids.push(o);
      });
    }
    return { deck, solids };
  }

  /** @returns {{type:string, position:number[], quaternion:number[], scale:number[]}[]} */
  exportInstances() {
    return this.instances.map((inst) => ({
      type: inst.id,
      position: inst.root.position.toArray(),
      quaternion: inst.root.quaternion.toArray(),
      scale: inst.root.scale.toArray(),
    }));
  }

  /** @param {{type:string, position:number[], quaternion:number[], scale:number[]}[]} list */
  importInstances(list) {
    this.deselect();
    for (const inst of this.instances) this._disposeInstance(inst);
    this.instances = [];
    if (!Array.isArray(list)) return;
    for (const item of list) {
      const def = PROP_BY_ID.get(item.type);
      if (!def || !Array.isArray(item.position)) continue;
      const root = def.make();
      enableMeshShadows(root);
      root.userData.isProp = true;
      root.position.fromArray(item.position);
      if (Array.isArray(item.quaternion) && item.quaternion.length === 4) {
        root.quaternion.fromArray(item.quaternion);
      }
      if (Array.isArray(item.scale) && item.scale.length === 3) {
        root.scale.fromArray(item.scale);
      }
      this.group.add(root);
      const inst = { id: item.type, def, root, collision: def.collision };
      root.userData.propInstance = inst;
      this.instances.push(inst);
    }
    this.onChange?.();
  }

  /* ----- internals ----- */

  _select(inst) {
    this.onSelect?.();
    this.selected = inst;
    this.gizmo.attach(inst.root);
    this.gizmo.enabled = true;
    this.gizmo.visible = true;
    this.selBox.setFromObject(inst.root);
    this.selBox.visible = true;
  }

  _pickAt(e) {
    const rect = this.domElement.getBoundingClientRect();
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this._ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.group.children, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && !o.userData.propInstance) o = o.parent;
      if (o?.userData.propInstance) {
        this._select(o.userData.propInstance);
        return;
      }
    }
    this.deselect();
  }

  _onKey(e) {
    if (!this.enabled || !this.selected) return;
    if (e.target instanceof HTMLInputElement) return;
    let handled = true;
    switch (e.code) {
      case "KeyW": this.setMode("translate"); break;
      case "KeyE": this.setMode("rotate"); break;
      case "KeyR": this.setMode("scale"); break;
      case "KeyQ": this.gizmo.setSpace(this.gizmo.space === "local" ? "world" : "local"); break;
      case "Delete": case "Backspace": this.deleteSelected(); break;
      case "Escape": this.deselect(); break;
      case "KeyD": if (e.ctrlKey || e.metaKey) this.duplicateSelected(); else handled = false; break;
      default: handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  _removeInstance(inst) {
    const i = this.instances.indexOf(inst);
    if (i >= 0) this.instances.splice(i, 1);
    this._disposeInstance(inst);
  }

  _disposeInstance(inst) {
    this.group.remove(inst.root);
    inst.root.traverse((o) => {
      if (o.isMesh) o.geometry?.dispose?.();
    });
  }
}
