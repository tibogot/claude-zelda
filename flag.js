/**
 * Cloth flag for Three.js WebGPU — no React. Same physics as R3F version.
 * Usage:
 *   import { createFlag } from './flag.js';
 *   const flag = createFlag({ textureUrl: '/path/to/flag.png', position: [0, 0, 0] });
 *   scene.add(flag.group);
 *   // In your animation loop:
 *   flag.update(dt);
 */

import * as THREE from "three";

// Physics constants — same as original R3F flag
const DAMPING = 0.97;
const DRAG = 0.1;
const MASS = 0.1;
const restDistance = 25;
const xSegs = 10;
const ySegs = 10;
const clothWidth = restDistance * xSegs;
const clothHeight = restDistance * ySegs;

const gravity = new THREE.Vector3(0, -981 * 1.4, 0).multiplyScalar(DRAG);
const TIMESTEP_SQ = 0.018 * 0.018;

const windForce = new THREE.Vector3(0, 0, 0);
const tmpForce = new THREE.Vector3();
const diff = new THREE.Vector3();

function clothFunction(u, v, target) {
  const x = (u - 0.5) * clothWidth;
  const y = (v + 0.5) * clothHeight;
  const z = 0;
  target.set(x, y, z);
}

class Particle {
  constructor(u, v) {
    this.position = new THREE.Vector3();
    this.previous = new THREE.Vector3();
    this.original = new THREE.Vector3();
    this.a = new THREE.Vector3(0, 0, 0);
    this.mass = MASS;
    this.invMass = 1 / this.mass;
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    clothFunction(u, v, this.position);
    clothFunction(u, v, this.previous);
    clothFunction(u, v, this.original);
  }

  addForce(force) {
    this.a.add(this.tmp2.copy(force).multiplyScalar(this.invMass));
  }

  integrate(timesq) {
    const newPos = this.tmp.subVectors(this.position, this.previous);
    newPos.multiplyScalar(DAMPING).add(this.position);
    newPos.add(this.a.multiplyScalar(timesq));
    const oldTmp = this.tmp;
    this.tmp = this.previous;
    this.previous = this.position;
    this.position = oldTmp;
    this.a.set(0, 0, 0);
  }
}

function satisfyConstraints(p1, p2, distance) {
  diff.subVectors(p2.position, p1.position);
  const currentDist = diff.length();
  if (currentDist === 0) return;
  const correction = diff.multiplyScalar(1 - distance / currentDist);
  const correctionHalf = correction.multiplyScalar(0.5);
  p1.position.add(correctionHalf);
  p2.position.sub(correctionHalf);
}

class Cloth {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    const particles = [];
    const constraints = [];
    const index = (u, v) => u + v * (w + 1);

    for (let v = 0; v <= h; v++) {
      for (let u = 0; u <= w; u++) {
        particles.push(new Particle(u / w, v / h));
      }
    }

    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        constraints.push([particles[index(u, v)], particles[index(u, v + 1)], restDistance]);
        constraints.push([particles[index(u, v)], particles[index(u + 1, v)], restDistance]);
      }
    }
    for (let u = w, v = 0; v < h; v++) {
      constraints.push([particles[index(u, v)], particles[index(u, v + 1)], restDistance]);
    }
    for (let v = h, u = 0; u < w; u++) {
      constraints.push([particles[index(u, v)], particles[index(u + 1, v)], restDistance]);
    }

    this.particles = particles;
    this.constraints = constraints;
    this.index = index;
  }
}

/**
 * Build a grid BufferGeometry matching the cloth particle layout (same vertex order).
 */
function buildClothGeometry() {
  const w = xSegs;
  const h = ySegs;
  const vertexCount = (w + 1) * (h + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = [];

  for (let v = 0; v <= h; v++) {
    for (let u = 0; u <= w; u++) {
      const i = u + v * (w + 1);
      const x = (u / w - 0.5) * clothWidth;
      const y = (v / h + 0.5) * clothHeight;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
      uvs[i * 2] = u / w;
      uvs[i * 2 + 1] = 1 - v / h;
    }
  }

  for (let v = 0; v < h; v++) {
    for (let u = 0; u < w; u++) {
      const a = u + v * (w + 1);
      const b = u + 1 + v * (w + 1);
      const c = u + (v + 1) * (w + 1);
      const d = u + 1 + (v + 1) * (w + 1);
      indices.push(a, b, c, b, d, c);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geom.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * @param {Object} options
 * @param {string} [options.textureUrl] - URL for flag texture (optional; flag will be white without it)
 * @param {boolean} [options.enableWind=true]
 * @param {number} [options.windIntensity=300]
 * @param {number} [options.windDirectionX=100]
 * @param {number} [options.windDirectionY=0]
 * @param {number} [options.windDirectionZ=1]
 * @param {number} [options.windSpeed=1000]
 * @param {number} [options.windOscillation=1]
 * @param {number[]} [options.pins=[0,1,2,3,4,5,6,7,8,9,10]] - pinned particle indices (left edge by default)
 * @param {[number,number,number]} [options.position=[0,0,0]]
 * @param {number} [options.scale=1]
 * @returns {{ group: THREE.Group, update: (dt: number) => void }}
 */
export function createFlag(options = {}) {
  const {
    textureUrl = "",
    enableWind = true,
    windIntensity = 300,
    windDirectionX = 100,
    windDirectionY = 0,
    windDirectionZ = 1,
    windSpeed = 1000,
    windOscillation = 1,
    pins = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    position = [0, 0, 0],
    scale = 1,
  } = options;

  const group = new THREE.Group();
  group.position.set(position[0], position[1], position[2]);
  group.scale.setScalar(scale);

  const cloth = new Cloth(xSegs, ySegs);
  const geometry = buildClothGeometry();
  const material = new THREE.MeshLambertMaterial({
    side: THREE.DoubleSide,
    color: 0xffffff,
  });

  if (textureUrl) {
    const loader = new THREE.TextureLoader();
    loader.load(
      textureUrl,
      (tex) => {
        tex.anisotropy = 16;
        tex.colorSpace = THREE.SRGBColorSpace;
        material.map = tex;
        material.needsUpdate = true;
      },
      undefined,
      () => {}
    );
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(0.39, 0.12, 0);
  mesh.scale.set(0.0013, 0.0013, 0.0013);
  mesh.castShadow = true;
  group.add(mesh);

  const poleGeo = new THREE.BoxGeometry(10, 700, 10);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
  const pole = new THREE.Mesh(poleGeo, poleMat);
  pole.position.set(-125, 25, 0);
  pole.castShadow = true;
  pole.receiveShadow = true;
  mesh.add(pole);

  const baseGeo = new THREE.BoxGeometry(20, 10, 20);
  const baseMat = new THREE.MeshPhongMaterial({
    color: 0xc0c0c0,
    specular: 0xc0c0c0,
    shininess: 100,
  });
  const base = new THREE.Mesh(baseGeo, baseMat);
  base.position.set(-125, -320, 0);
  base.castShadow = true;
  base.receiveShadow = true;
  mesh.add(base);

  const state = {
    cloth,
    geometry,
    pins: [...pins],
    enableWind,
    windIntensity,
    windDirectionX,
    windDirectionY,
    windDirectionZ,
    windSpeed,
    windOscillation,
    time: 0,
  };

  group.userData.flagState = state;

  function update(dt = 0.016) {
    const s = state;
    s.time += dt * 1000;

    const oscillation = Math.sin(s.time / s.windSpeed) * s.windOscillation;
    windForce.set(s.windDirectionX, s.windDirectionY, s.windDirectionZ + oscillation);
    windForce.normalize();
    windForce.multiplyScalar(s.windIntensity);

    const particles = s.cloth.particles;

    if (s.enableWind) {
      const normal = new THREE.Vector3();
      const indices = geometry.index;
      const normals = geometry.attributes.normal;
      for (let i = 0, il = indices.count; i < il; i += 3) {
        for (let j = 0; j < 3; j++) {
          const indx = indices.getX(i + j);
          normal.fromBufferAttribute(normals, indx);
          tmpForce.copy(normal).normalize().multiplyScalar(normal.dot(windForce));
          particles[indx].addForce(tmpForce);
        }
      }
    }

    for (let i = 0; i < particles.length; i++) {
      particles[i].addForce(gravity);
      particles[i].integrate(TIMESTEP_SQ);
    }

    for (let i = 0; i < s.cloth.constraints.length; i++) {
      const c = s.cloth.constraints[i];
      satisfyConstraints(c[0], c[1], c[2]);
    }

    for (let i = 0; i < s.pins.length; i++) {
      let xy = Math.round(s.pins[i] * xSegs + i);
      if (xy > particles.length) xy = particles.length;
      if (xy < 0) xy = 0;
      const p = particles[xy];
      p.position.copy(p.original);
      p.previous.copy(p.original);
    }

    const posAttr = geometry.attributes.position;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      posAttr.setXYZ(i, p.position.x, p.position.y, p.position.z);
    }
    posAttr.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  return { group, update };
}
