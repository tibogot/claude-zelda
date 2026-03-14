import * as THREE from "three";
import { pass } from "three/tsl";
import {
  Fn,
  normalize,
  sub,
  mul,
  add,
  div,
  abs,
  vec2,
  vec3,
  sign,
  dot,
  floor,
  fract,
  texture,
  cameraPosition,
  positionWorld,
} from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TorusKnotGeometry } from "three";

export async function run() {
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x20252f);

  const camera = new THREE.PerspectiveCamera(
    50,
    innerWidth / innerHeight,
    0.1,
    200,
  );
  camera.position.set(6, 4, 8);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1, 0);
  controls.update();

  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(5, 10, 3);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x8899aa, 0.5));

  const geo = new TorusKnotGeometry(1, 0.35, 256, 64);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x7fd0ff,
    roughness: 0.35,
    metalness: 0.15,
  });

  const original = new THREE.Mesh(geo, mat);
  original.position.x = -2.5;
  scene.add(original);

  const bakeSize = 2048;
  const grid = 16;
  const atlas = new THREE.RenderTarget(bakeSize, bakeSize);

  const bakeCam = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 20);
  const bakeScene = new THREE.Scene();
  const bakeMesh = new THREE.Mesh(geo, mat);
  bakeScene.add(bakeMesh);
  bakeScene.add(light.clone());
  bakeScene.add(new THREE.AmbientLight(0x8899aa, 0.5));

  renderer.setRenderTarget(atlas);
  renderer.setSize(bakeSize, bakeSize);
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const u = x / (grid - 1);
      const v = y / (grid - 1);
      const dir = new THREE.Vector3(
        u - v,
        1 - Math.abs(u - v) - Math.abs(u + v - 1),
        u + v - 1,
      ).normalize();
      bakeCam.position.copy(dir.multiplyScalar(4));
      bakeCam.lookAt(0, 0, 0);
      bakeCam.updateMatrixWorld();
      const cellSize = bakeSize / grid;
      renderer.setViewport(x * cellSize, y * cellSize, cellSize, cellSize);
      renderer.render(bakeScene, bakeCam);
    }
  }
  renderer.setRenderTarget(null);
  renderer.setSize(innerWidth, innerHeight);

  const impostorGeo = new THREE.PlaneGeometry(4, 4);

  const nodeMat = new THREE.MeshBasicNodeMaterial();

  const atlasTex = atlas.texture;

  const sps = grid;

  nodeMat.colorNode = Fn(() => {
    const camDir = normalize(sub(cameraPosition, positionWorld));
    const s = vec3(sign(camDir.x), sign(camDir.y), sign(camDir.z));
    const d = dot(camDir, s);
    const oct = vec3(div(camDir.x, d), div(camDir.y, d), div(camDir.z, d));
    const uvOct = mul(vec2(add(1, add(oct.x, oct.z)), add(1, sub(oct.z, oct.x))), 0.5);
    const frame = floor(mul(uvOct, sps));
    const uvLocal = fract(mul(uvOct, sps));
    const uvAtlas = div(add(frame, uvLocal), sps);
    return texture(atlasTex, uvAtlas);
  })();

  const impostor = new THREE.Mesh(impostorGeo, nodeMat);
  impostor.position.x = 2.5;
  scene.add(impostor);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const renderPipeline = new THREE.RenderPipeline(renderer);
  renderPipeline.outputNode = pass(scene, camera);
  await renderer.compileAsync(scene, camera);

  renderer.setAnimationLoop(() => {
    original.rotation.y += 0.01;
    renderPipeline.render();
  });
}
