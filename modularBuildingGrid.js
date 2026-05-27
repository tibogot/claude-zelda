import * as THREE from "three";
import { MOD, getModuleTransform, isCornerModule, isEdgeModule } from "./modularBuildingKit.js";

const GRID_Y = 0.085;
const HOVER_Y = 0.09;

/**
 * MOD-aligned build grid drawn above the ground plane (avoids z-fighting).
 */
export class ModularBuildGrid {
  /**
   * @param {THREE.Scene} scene
   * @param {{ extent?: number, mod?: number }} [opts]
   */
  constructor(scene, opts = {}) {
    this.mod = opts.mod ?? MOD;
    this.extent = opts.extent ?? 24;
    this.visible = true;

    this.root = new THREE.Group();
    this.root.name = "ModularBuildGrid";
    scene.add(this.root);

    this.lines = this._buildLines();
    this.root.add(this.lines);

    this.hoverFill = new THREE.Mesh(
      new THREE.PlaneGeometry(this.mod, this.mod),
      new THREE.MeshBasicMaterial({
        color: 0x4a9eff,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.hoverFill.rotation.x = -Math.PI / 2;
    this.hoverFill.position.y = HOVER_Y;
    this.hoverFill.renderOrder = 8;
    this.hoverFill.visible = false;
    this.root.add(this.hoverFill);

    this.hoverEdge = new THREE.Mesh(
      new THREE.PlaneGeometry(this.mod, 0.14),
      new THREE.MeshBasicMaterial({
        color: 0xffcc44,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.hoverEdge.rotation.x = -Math.PI / 2;
    this.hoverEdge.position.y = HOVER_Y + 0.001;
    this.hoverEdge.renderOrder = 9;
    this.hoverEdge.visible = false;
    this.root.add(this.hoverEdge);

    this.hoverCorner = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.32, 4),
      new THREE.MeshBasicMaterial({
        color: 0xffcc44,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.hoverCorner.rotation.x = -Math.PI / 2;
    this.hoverCorner.rotation.z = Math.PI * 0.25;
    this.hoverCorner.position.y = HOVER_Y + 0.002;
    this.hoverCorner.renderOrder = 9;
    this.hoverCorner.visible = false;
    this.root.add(this.hoverCorner);

    this.origin = new THREE.Mesh(
      new THREE.RingGeometry(0.15, 0.35, 32),
      new THREE.MeshBasicMaterial({
        color: 0x5cb85c,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.origin.rotation.x = -Math.PI / 2;
    this.origin.position.y = HOVER_Y + 0.002;
    this.origin.renderOrder = 10;
    this.root.add(this.origin);
  }

  _buildLines() {
    const mod = this.mod;
    const half = this.extent * mod;
    const verts = [];
    const colors = [];
    const minor = new THREE.Color(0x5a6a7a);
    const major = new THREE.Color(0x4a9eff);
    const axis = new THREE.Color(0x5cb85c);

    for (let i = -this.extent; i <= this.extent; i++) {
      const isMajor = i % 4 === 0;
      const isAxis = i === 0;
      const c = isAxis ? axis : isMajor ? major : minor;
      const a = isAxis ? 0.95 : isMajor ? 0.75 : 0.45;
      const x = i * mod;
      const z0 = -half;
      const z1 = half;
      verts.push(x, GRID_Y, z0, x, GRID_Y, z1);
      colors.push(c.r * a, c.g * a, c.b * a, c.r * a, c.g * a, c.b * a);

      const z = i * mod;
      const x0 = -half;
      const x1 = half;
      verts.push(x0, GRID_Y, z, x1, GRID_Y, z);
      colors.push(c.r * a, c.g * a, c.b * a, c.r * a, c.g * a, c.b * a);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 6;
    lines.frustumCulled = false;
    return lines;
  }

  setVisible(on) {
    this.visible = on;
    this.root.visible = on;
  }

  /**
   * @param {number} gx
   * @param {number} gz
   * @param {string} moduleId
   * @param {number} rot
   * @param {boolean} [occupied]
   */
  updateHover(gx, gz, moduleId, rot, occupied = false) {
    if (!this.visible) {
      this.hoverFill.visible = false;
      this.hoverEdge.visible = false;
      this.hoverCorner.visible = false;
      return;
    }

    const isEdge = isEdgeModule(moduleId);
    const isCorner = isCornerModule(moduleId);

    this.hoverFill.visible = !isEdge && !isCorner;
    this.hoverEdge.visible = isEdge;
    this.hoverCorner.visible = isCorner;

    const fillColor = occupied ? 0xff8844 : 0x4a9eff;
    this.hoverFill.material.color.setHex(fillColor);
    this.hoverFill.material.opacity = occupied ? 0.35 : 0.28;

    if (isEdge) {
      const { position, rotationY } = getModuleTransform(moduleId, gx, gz, rot);
      this.hoverEdge.position.set(position.x, HOVER_Y + 0.001, position.z);
      this.hoverEdge.rotation.set(-Math.PI / 2, rotationY, 0);
      this.hoverEdge.material.color.setHex(occupied ? 0xff6644 : 0xffcc44);
    } else if (isCorner) {
      const { position, rotationY } = getModuleTransform(moduleId, gx, gz, rot);
      this.hoverCorner.position.set(position.x, HOVER_Y + 0.002, position.z);
      this.hoverCorner.rotation.set(-Math.PI / 2, rotationY, Math.PI * 0.25);
      this.hoverCorner.material.color.setHex(occupied ? 0xff6644 : 0xffcc44);
    } else {
      const cx = gx * this.mod + this.mod * 0.5;
      const cz = gz * this.mod + this.mod * 0.5;
      this.hoverFill.position.set(cx, HOVER_Y, cz);
      this.hoverFill.rotation.set(-Math.PI / 2, 0, 0);
    }
  }

  hideHover() {
    this.hoverFill.visible = false;
    this.hoverEdge.visible = false;
    this.hoverCorner.visible = false;
  }

  dispose() {
    this.root.parent?.remove(this.root);
    this.lines.geometry.dispose();
    this.lines.material.dispose();
    this.hoverFill.geometry.dispose();
    this.hoverFill.material.dispose();
    this.hoverEdge.geometry.dispose();
    this.hoverEdge.material.dispose();
    this.hoverCorner.geometry.dispose();
    this.hoverCorner.material.dispose();
    this.origin.geometry.dispose();
    this.origin.material.dispose();
  }
}
