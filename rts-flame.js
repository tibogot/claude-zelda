/**
 * RTS flamethrower jets — the zelda-smoke.html "Fire" preset material
 * (triplanar voronoi erosion + hot→orange→dark emissive ramp, additive)
 * driving a world-space directional jet pool instead of a rising plume.
 * One shared InstancedMesh serves every flamer on the map.
 *
 * `createRtsFlameJets(scene)` → { spray(from, to), update(dt, timeMs), dispose }
 */
import * as THREE from "three/webgpu";
import {
  attribute,
  texture,
  uniform,
  vec2,
  float,
  mix,
  smoothstep,
  dot,
  positionLocal,
  positionWorld,
  normalLocal,
  normalWorld,
  cameraPosition,
  mrt,
  output,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const VORO_URL = "./textures/particles/T_Voronoi01.png";

// zelda-smoke FIRE_LOOK, tuned for a fast horizontal jet.
const JET = {
  tiling: 0.5,
  panSpeed: 0.25,
  holeDepth: 0.5,
  edgeNoise: 0.6,
  cutoff: 0.1,
  dissolveSoft: 0.2,
  erode: 0.7,
  fadeIn: 0.08,
  opacity: 1.0,
  colHot: "#fff2c0",
  colMid: "#ff7a18",
  colTip: "#5a1203",
  intensity: 2.2, // HDR >1 → picked up by the bloom pass
  midPoint: 0.4,
  // jet sim
  speed: 26, // initial blob speed along aim (world u/s)
  drag: 2.2, // 1/s velocity damping
  buoyancy: 3.0, // upward drift as the blob ages
  coneJitter: 0.16, // radians of spray cone
  sizeStart: 0.42,
  sizeEnd: 1.7,
  spin: 2.2,
  blobsPerSpray: 3,
};

const MAX_BLOBS = 192;

function makeBlobGeometry() {
  const a = new THREE.IcosahedronGeometry(1.0, 3);
  const b = new THREE.IcosahedronGeometry(0.8, 3).translate(0.95, 0.45, 0.15);
  const c = new THREE.IcosahedronGeometry(0.78, 3).translate(-0.7, 0.55, -0.35);
  const g = mergeGeometries([a, b, c]);
  g.deleteAttribute("uv");
  g.center();
  return g;
}

function buildFireMaterial(voroTex, u) {
  const iSeed = attribute("iSeed", "float");
  const iLife = attribute("iLife", "float");

  // triplanar voronoi (object space) — identical to the zelda-smoke recipe
  const p = positionLocal.mul(u.tiling);
  const aN = normalLocal.abs();
  const bl = aN.div(aN.x.add(aN.y).add(aN.z).add(0.0001));
  const t = u.time.mul(u.panSpeed);
  const off = vec2(iSeed, iSeed.mul(1.7)).add(vec2(t.mul(0.3), t.negate()));
  const sX = texture(voroTex, p.yz.add(off)).r;
  const sY = texture(voroTex, p.xz.add(off)).r;
  const sZ = texture(voroTex, p.xy.add(off)).r;
  const V = sX.mul(bl.x).add(sY.mul(bl.y)).add(sZ.mul(bl.z));

  const N = normalWorld.normalize();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const facing = dot(N, viewDir).clamp(0, 1);

  // erosion / dissolve
  const holed = facing.mul(mix(float(1), V, u.holeDepth));
  const edged = holed.add(V.sub(0.5).mul(u.edgeNoise));
  const thr = u.cutoff.add(iLife.mul(u.erode));
  const fadeIn = smoothstep(float(0), u.fadeIn, iLife);
  const alpha = smoothstep(thr, thr.add(u.dissolveSoft), edged)
    .mul(fadeIn)
    .mul(u.opacity);

  // emissive colour ramp over life: hot core → orange → dark tip
  const c1 = mix(u.colHot, u.colMid, smoothstep(float(0), u.midPoint, iLife));
  const ramp = mix(c1, u.colTip, smoothstep(u.midPoint, float(1), iLife));

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const col = ramp.mul(u.intensity);
  mat.colorNode = col;
  mat.opacityNode = alpha;
  // Opt into the emissive MRT buffer — this is what the selective bloom
  // pass reads. Ignored when rendering without MRT (post disabled).
  mat.mrtNode = mrt({ output, emissive: col.mul(alpha) });
  return mat;
}

export async function createRtsFlameJets(scene) {
  const u = {
    time: uniform(0),
    tiling: uniform(JET.tiling),
    panSpeed: uniform(JET.panSpeed),
    holeDepth: uniform(JET.holeDepth),
    edgeNoise: uniform(JET.edgeNoise),
    cutoff: uniform(JET.cutoff),
    dissolveSoft: uniform(JET.dissolveSoft),
    erode: uniform(JET.erode),
    fadeIn: uniform(JET.fadeIn),
    opacity: uniform(JET.opacity),
    colHot: uniform(new THREE.Color(JET.colHot)),
    colMid: uniform(new THREE.Color(JET.colMid)),
    colTip: uniform(new THREE.Color(JET.colTip)),
    intensity: uniform(JET.intensity),
    midPoint: uniform(JET.midPoint),
  };

  const voroTex = await new Promise((res, rej) => {
    new THREE.TextureLoader().load(
      VORO_URL,
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.colorSpace = THREE.NoColorSpace;
        res(tex);
      },
      undefined,
      rej,
    );
  });

  const geo = makeBlobGeometry();
  const seedArr = new Float32Array(MAX_BLOBS);
  const lifeArr = new Float32Array(MAX_BLOBS).fill(1);
  geo.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seedArr, 1));
  const lifeAttr = new THREE.InstancedBufferAttribute(lifeArr, 1);
  geo.setAttribute("iLife", lifeAttr);

  const mat = buildFireMaterial(voroTex, u);
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_BLOBS);
  mesh.frustumCulled = false;
  mesh.count = MAX_BLOBS;
  mesh.renderOrder = 8;
  scene.add(mesh);

  const active = new Uint8Array(MAX_BLOBS);
  const px = new Float32Array(MAX_BLOBS);
  const py = new Float32Array(MAX_BLOBS);
  const pz = new Float32Array(MAX_BLOBS);
  const vx = new Float32Array(MAX_BLOBS);
  const vy = new Float32Array(MAX_BLOBS);
  const vz = new Float32Array(MAX_BLOBS);
  const age = new Float32Array(MAX_BLOBS);
  const life = new Float32Array(MAX_BLOBS);
  const axX = new Float32Array(MAX_BLOBS);
  const axY = new Float32Array(MAX_BLOBS);
  const axZ = new Float32Array(MAX_BLOBS);
  const spin = new Float32Array(MAX_BLOBS);
  const ang = new Float32Array(MAX_BLOBS);

  const _d = new THREE.Object3D();
  const _axis = new THREE.Vector3();
  const _dir = new THREE.Vector3();
  const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  /** Emit a burst of blobs from `from` toward `to` (Vector3-likes). */
  function spray(from, to) {
    _dir.set(to.x - from.x, to.y - from.y, to.z - from.z);
    const dist = Math.max(1, _dir.length());
    _dir.normalize();
    for (let k = 0; k < JET.blobsPerSpray; k++) {
      const i = active.indexOf(0);
      if (i < 0) return;
      active[i] = 1;
      // small stagger back along the jet so a burst reads as a stream
      const lag = k * 0.55;
      px[i] = from.x - _dir.x * lag + (Math.random() - 0.5) * 0.2;
      py[i] = from.y - _dir.y * lag + (Math.random() - 0.5) * 0.2;
      pz[i] = from.z - _dir.z * lag + (Math.random() - 0.5) * 0.2;
      const speed = JET.speed * (0.9 + Math.random() * 0.25);
      const jx = (Math.random() - 0.5) * JET.coneJitter;
      const jy = (Math.random() - 0.5) * JET.coneJitter * 0.6;
      vx[i] = (_dir.x + jx) * speed;
      vy[i] = (_dir.y + jy) * speed;
      vz[i] = (_dir.z + (Math.random() - 0.5) * JET.coneJitter) * speed;
      age[i] = 0;
      // live just long enough to cross the gap, plus a lick of overshoot
      life[i] = Math.min(0.85, (dist / speed) * 1.2 + 0.12);
      _axis
        .set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .normalize();
      axX[i] = _axis.x;
      axY[i] = _axis.y;
      axZ[i] = _axis.z;
      spin[i] = (Math.random() - 0.5) * 2;
      ang[i] = Math.random() * Math.PI * 2;
      seedArr[i] = Math.random() * 10;
    }
  }

  function update(dt, timeMs) {
    u.time.value = timeMs * 0.001;
    let any = false;
    const damp = Math.max(0, 1 - JET.drag * dt);
    for (let i = 0; i < MAX_BLOBS; i++) {
      if (!active[i]) {
        mesh.setMatrixAt(i, _hidden);
        lifeArr[i] = 1;
        continue;
      }
      any = true;
      age[i] += dt;
      const lr = age[i] / life[i];
      if (lr >= 1) {
        active[i] = 0;
        mesh.setMatrixAt(i, _hidden);
        lifeArr[i] = 1;
        continue;
      }
      vx[i] *= damp;
      vz[i] *= damp;
      vy[i] = vy[i] * damp + JET.buoyancy * lr * dt;
      px[i] += vx[i] * dt;
      py[i] += vy[i] * dt;
      pz[i] += vz[i] * dt;
      ang[i] += spin[i] * JET.spin * dt;

      const ease = 1 - (1 - lr) * (1 - lr);
      const scale = JET.sizeStart + (JET.sizeEnd - JET.sizeStart) * ease;
      _d.position.set(px[i], py[i], pz[i]);
      _axis.set(axX[i], axY[i], axZ[i]);
      _d.quaternion.setFromAxisAngle(_axis, ang[i]);
      _d.scale.setScalar(scale);
      _d.updateMatrix();
      mesh.setMatrixAt(i, _d.matrix);
      lifeArr[i] = lr;
    }
    mesh.instanceMatrix.needsUpdate = true;
    lifeAttr.needsUpdate = true;
    mesh.visible = any;
  }

  function clear() {
    active.fill(0);
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    voroTex.dispose();
  }

  return { spray, update, clear, dispose, uniforms: u, mesh };
}
