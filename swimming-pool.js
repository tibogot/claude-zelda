/**
 * Swimming Pool — stylized water following aleksandargjoreski.dev/blog/stylized-water-shader
 * RNM blending, Fresnel, Beer-Lambert (fake depth), sun glints. No viewport refraction (WebGPU-safe).
 */
import * as THREE from "three";
import { WaterMesh } from "three/addons/objects/Water2Mesh.js";
import {
  Fn,
  uniform,
  float,
  vec2,
  vec3,
  uv,
  texture,
  positionLocal,
  positionWorld,
  cameraPosition,
  normalize,
  dot,
  reflect,
  mix,
  pow,
  length,
  max,
  exp,
  negate,
  add,
  mul,
  sub,
  varying,
} from "three/tsl";
import { createTileMaterial } from "./tileMaterial.js";

const PI = Math.PI;

function createWaterShaderMesh(geometry, waterNormalTex, opts) {
  const blendRNM = Fn(([n1, n2]) => {
    const t = n1.add(vec3(0, 0, 1));
    const u = n2.mul(vec3(-1, -1, 1));
    return t.mul(dot(t, u)).sub(u.mul(t.z)).normalize();
  });

  const uTime = opts.uTime ?? uniform(0);
  const uSpeed = uniform(opts.flowSpeed ?? 0.12);
  const uUvScale = uniform(opts.uvScale ?? 2.7);
  const uNormalScale = uniform(opts.normalScale ?? 0.12);
  const uFresnelScale = uniform(opts.fresnelScale ?? 0.75);
  const uShininess = uniform(opts.shininess ?? 350);
  const uHighlightsGlow = uniform(opts.highlightsGlow ?? 4);
  const uHighlightFresnelInfluence = uniform(opts.highlightFresnelInfluence ?? 0.5);
  const uHighlightsSpread = uniform(opts.highlightsSpread ?? 0.25);

  const sunDirVec = Array.isArray(opts.sunDirection)
    ? new THREE.Vector3(...opts.sunDirection).normalize()
    : new THREE.Vector3(0.5, 0.7, 0.5).normalize();
  const uSunDir = uniform(sunDirVec);
  const uSunColor = uniform(new THREE.Color("#fffef5").convertSRGBToLinear());

  // Article: scale only XY of tangent-space normal (ripple tilt), not Z
  const uDeepColor = uniform(new THREE.Color("#0d3d4d").convertSRGBToLinear());
  const uShallowColor = uniform(new THREE.Color("#2a7a8f").convertSRGBToLinear());
  const uAbsorptionScale = uniform(opts.absorptionScale ?? 8);
  const uInscatterTint = uniform(new THREE.Color(0.02, 0.12, 0.14).convertSRGBToLinear());
  const uInscatterStrength = uniform(0.9);

  const uTworld = uniform(new THREE.Vector3(1, 0, 0));
  const uBworld = uniform(new THREE.Vector3(0, 0, -1));
  const uNworld = uniform(new THREE.Vector3(0, 1, 0));
  const vLocalPos = varying(vec3(0), "v_wlp");

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  mat.positionNode = Fn(() => {
    vLocalPos.assign(positionLocal);
    return positionLocal;
  })();

  mat.colorNode = Fn(() => {
    const flowDir = opts.flowDirection ?? [0.15, 0.08];
    const speed = uTime.mul(uSpeed);
    const freq = vec2(flowDir[0], flowDir[1]).mul(speed);
    const nUV1 = uv().add(freq).mul(uUvScale.mul(1.37)).fract();
    const nUV2 = uv().sub(freq).mul(uUvScale.mul(0.73)).fract();
    const tsn1 = texture(waterNormalTex, nUV1).rgb.mul(2).sub(1).normalize();
    const tsn2 = texture(waterNormalTex, nUV2).rgb.mul(2).sub(1).normalize();
    const blendedTsn = blendRNM.call(tsn1, tsn2);
    // Article: only scale XY (sideways tilt), not Z — keeps ripple contrast
    const tsn = vec3(blendedTsn.xy.mul(uNormalScale), blendedTsn.z).normalize();

    const normal = uTworld.mul(tsn.x).add(uBworld.mul(tsn.y)).add(uNworld.mul(tsn.z)).normalize();
    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const cosTheta = dot(normal, viewDir).clamp();
    const F0 = float(0.02);
    const grazing = float(1).sub(cosTheta);
    const grazing5 = grazing.mul(grazing).mul(grazing).mul(grazing).mul(grazing);
    const fresnelSchlick = F0.add(float(1).sub(F0).mul(grazing5));
    const fresnelWeight = fresnelSchlick.mul(uFresnelScale).clamp();

    // Fake depth from distance to pool center — drives Beer-Lambert absorption
    const halfW = float((opts.width ?? 12) * 0.5);
    const halfL = float((opts.length ?? 20) * 0.5);
    const distToCenter = length(vLocalPos.xz);
    const maxDist = length(vec2(halfW, halfL));
    const depthFactor = distToCenter.div(maxDist).clamp();
    const waterBase = mix(uShallowColor, uDeepColor, depthFactor);

    // Beer-Lambert: absorption with fake thickness
    const sigma = vec3(0.4, 0.12, 0.06).mul(uAbsorptionScale);
    const fakeThickness = depthFactor.mul(float(2));
    const transmittance = exp(sigma.negate().mul(fakeThickness));
    const tintColor = uInscatterTint.mul(uInscatterStrength);
    const throughWater = mix(tintColor, waterBase, transmittance);

    // Sky gradient reflection (no envMap — WebGPU cube texture issues)
    const skyGrad = reflect(viewDir.negate(), normal).y.mul(0.5).add(0.5).clamp();
    const reflectedColor = mix(vec3(0.6, 0.78, 0.95), vec3(0.35, 0.55, 0.88), skyGrad);

    // Sun glints — separate normal scale (article: tighter for sparkle)
    const tsnHighlights = vec3(blendedTsn.xy.mul(uHighlightsSpread), blendedTsn.z).normalize();
    const normalHighlights = uTworld.mul(tsnHighlights.x)
      .add(uBworld.mul(tsnHighlights.y))
      .add(uNworld.mul(tsnHighlights.z))
      .normalize();
    const reflectedLight = reflect(uSunDir, normalHighlights);
    const align = max(dot(reflectedLight, viewDir), 0);
    const spec = pow(align, uShininess);
    const fresnelSpecBoost = mix(float(1), fresnelSchlick, uHighlightFresnelInfluence);
    const sunGlint = uSunColor.mul(spec.mul(uHighlightsGlow).mul(fresnelSpecBoost));

    const shadedWater = mix(throughWater, reflectedColor, fresnelWeight);
    return shadedWater.add(sunGlint);
  })();

  const mesh = new THREE.Mesh(geometry, mat);
  mesh.updateMatrixWorld(true);
  uTworld.value.set(1, 0, 0).transformDirection(mesh.matrixWorld).normalize();
  uBworld.value.set(0, 0, -1).transformDirection(mesh.matrixWorld).normalize();
  uNworld.value.set(0, 1, 0).transformDirection(mesh.matrixWorld).normalize();
  mesh._waterShaderUniforms = { uTime };
  return mesh;
}

const DEFAULT_OPTIONS = {
  scene: null,
  floorY: 1,
  x: 0,
  z: 0,
  length: 20,
  width: 12,
  depth: 1.8,
  waterLevelOffset: 0.03,
  waterColor: "#2a7a8f",
  normalScale: 2.5,
  flowSpeed: 0.08,
  flowDirection: [0.15, 0.08],
  reflectivity: 0.15,
  useTileMaterial: true,
  linerColor: "#1a5f7a",
  waterMode: "shader",
  sunDirection: [0.5, 0.7, 0.5],
  uTime: null,
  envMap: null,
  uvScale: 2.7,
};

/** Returns deck outer bounds for floor hole: { halfW, halfL } */
export function getPoolDeckBounds(opts) {
  const { width, length } = { ...DEFAULT_OPTIONS, ...opts };
  const wallThickness = 0.5;
  const deckWidth = 2.5;
  const deckOuterW = width + deckWidth * 2 + wallThickness * 2;
  const deckOuterL = length + deckWidth * 2 + wallThickness * 2;
  return { halfW: deckOuterW / 2, halfL: deckOuterL / 2 };
}

/**
 * Creates a swimming pool that sits ON the surface. Deck is at floorY.
 * Use createFloorWithPoolHole() to cut a hole in the floor so the pool is visible.
 */
export async function createSwimmingPool(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const { scene, floorY, x, z, length, width, depth, waterLevelOffset } = opts;

  const poolGroup = new THREE.Group();
  poolGroup.position.set(x, floorY, z);
  poolGroup.renderOrder = 100;

  const halfW = width / 2;
  const halfL = length / 2;
  const wallThickness = 0.5;
  const deckWidth = 2.5;
  const copingHeight = 0.1;
  const copingWidth = 0.3;

  // ─── Pool basin (floor + 4 walls) ───
  const basinMeshes = [];
  const poolBlue = new THREE.Color("#1a6b7a");

  if (opts.useTileMaterial) {
    const poolMat = createTileMaterial({
      textureScale: 320,
      gradientIntensity: 0.3,
      gradientBias: 0.02,
      tileColor: "#b8e0e8",
      gridColor: "#6aa8b8",
      gridLineColor: "#4a8898",
      roughness: 0.2,
      metalness: 0.05,
      objectSpace: true,
      uvOffset: [123.4, 56.7, 89.1],
    });

    const floorGeo = new THREE.PlaneGeometry(width, length);
    floorGeo.rotateX(-PI / 2);
    const floorMesh = new THREE.Mesh(floorGeo, poolMat);
    floorMesh.position.y = -depth;
    floorMesh.receiveShadow = true;
    floorMesh.renderOrder = 50;
    poolGroup.add(floorMesh);
    basinMeshes.push(floorMesh);

    const wallMat = createTileMaterial({
      textureScale: 200,
      gradientIntensity: 0.25,
      gradientBias: 0.01,
      tileColor: "#a8d8e8",
      gridColor: "#5a98a8",
      gridLineColor: "#3a7888",
      roughness: 0.22,
      metalness: 0.06,
      objectSpace: true,
      uvOffset: [45.2, 78.3, 12.6],
    });

    const addWall = (w, h, px, py, pz, rotY) => {
      const g = new THREE.PlaneGeometry(w, h);
      g.rotateY(rotY);
      const m = new THREE.Mesh(g, wallMat);
      m.position.set(px, py, pz);
      m.castShadow = true;
      m.receiveShadow = true;
      m.renderOrder = 50;
      poolGroup.add(m);
      basinMeshes.push(m);
    };

    const wy = -depth / 2;
    addWall(width + wallThickness * 2, depth, 0, wy, -halfL - wallThickness / 2, 0);
    addWall(width + wallThickness * 2, depth, 0, wy, halfL + wallThickness / 2, PI);
    addWall(length + wallThickness * 2, depth, -halfW - wallThickness / 2, wy, 0, -PI / 2);
    addWall(length + wallThickness * 2, depth, halfW + wallThickness / 2, wy, 0, PI / 2);
  } else {
    const linerMat = new THREE.MeshStandardMaterial({
      color: opts.linerColor,
      roughness: 0.5,
      metalness: 0.08,
    });
    const floorGeo = new THREE.PlaneGeometry(width, length);
    floorGeo.rotateX(-PI / 2);
    const floorMesh = new THREE.Mesh(floorGeo, linerMat);
    floorMesh.position.y = -depth;
    floorMesh.receiveShadow = true;
    poolGroup.add(floorMesh);
    basinMeshes.push(floorMesh);

    const wallMat = new THREE.MeshStandardMaterial({
      color: opts.linerColor,
      roughness: 0.48,
      metalness: 0.06,
    });
    const addWall = (w, h, px, py, pz, rotY) => {
      const g = new THREE.PlaneGeometry(w, h);
      g.rotateY(rotY);
      const m = new THREE.Mesh(g, wallMat);
      m.position.set(px, py, pz);
      m.castShadow = true;
      m.receiveShadow = true;
      poolGroup.add(m);
      basinMeshes.push(m);
    };
    const wy = -depth / 2;
    addWall(width + wallThickness * 2, depth, 0, wy, -halfL - wallThickness / 2, 0);
    addWall(width + wallThickness * 2, depth, 0, wy, halfL + wallThickness / 2, PI);
    addWall(length + wallThickness * 2, depth, -halfW - wallThickness / 2, wy, 0, -PI / 2);
    addWall(length + wallThickness * 2, depth, halfW + wallThickness / 2, wy, 0, PI / 2);
  }

  // ─── Pool deck (surface-level tile surround) ───
  const deckMat = createTileMaterial({
    textureScale: 450,
    gradientIntensity: 0.4,
    gradientBias: 0.06,
    tileColor: "#c8d8e0",
    gridColor: "#708898",
    gridLineColor: "#506070",
    roughness: 0.75,
    metalness: 0,
    objectSpace: true,
    uvOffset: [200.1, 150.3, 80.5],
  });

  const deckOuterW = width + deckWidth * 2 + wallThickness * 2;
  const deckOuterL = length + deckWidth * 2 + wallThickness * 2;
  const deckHoleW = width + wallThickness * 2;
  const deckHoleL = length + wallThickness * 2;
  const cornerR = 1.2;

  const deckShape = new THREE.Shape();
  const hw = deckOuterW / 2;
  const hl = deckOuterL / 2;
  deckShape.moveTo(-hw + cornerR, -hl);
  deckShape.lineTo(hw - cornerR, -hl);
  deckShape.quadraticCurveTo(hw, -hl, hw, -hl + cornerR);
  deckShape.lineTo(hw, hl - cornerR);
  deckShape.quadraticCurveTo(hw, hl, hw - cornerR, hl);
  deckShape.lineTo(-hw + cornerR, hl);
  deckShape.quadraticCurveTo(-hw, hl, -hw, hl - cornerR);
  deckShape.lineTo(-hw, -hl + cornerR);
  deckShape.quadraticCurveTo(-hw, -hl, -hw + cornerR, -hl);

  const hole = new THREE.Path();
  const hhw = deckHoleW / 2;
  const hhl = deckHoleL / 2;
  hole.moveTo(-hhw, -hhl);
  hole.lineTo(hhw, -hhl);
  hole.lineTo(hhw, hhl);
  hole.lineTo(-hhw, hhl);
  hole.lineTo(-hhw, -hhl);
  deckShape.holes.push(hole);

  const deckGeo = new THREE.ShapeGeometry(deckShape);
  deckGeo.rotateX(-PI / 2);
  const deckMesh = new THREE.Mesh(deckGeo, deckMat);
  deckMesh.position.y = 0;
  deckMesh.receiveShadow = true;
  deckMesh.castShadow = true;
  deckMesh.renderOrder = 90;
  poolGroup.add(deckMesh);
  basinMeshes.push(deckMesh);

  // ─── Coping (white rim) ───
  const copingMat = new THREE.MeshStandardMaterial({
    color: 0xf0f4f8,
    roughness: 0.35,
    metalness: 0.02,
  });
  const cw = copingWidth;
  const ch = copingHeight;
  const addCoping = (sx, sy, px, py, pz) => {
    const g = new THREE.BoxGeometry(sx, sy, 1);
    const m = new THREE.Mesh(g, copingMat);
    m.position.set(px, py, pz);
    m.castShadow = true;
    m.receiveShadow = true;
    m.renderOrder = 85;
    poolGroup.add(m);
    basinMeshes.push(m);
  };
  addCoping(width + cw * 2, ch, 0, ch / 2, -halfL - cw);
  addCoping(width + cw * 2, ch, 0, ch / 2, halfL + cw);
  addCoping(length + cw * 2, ch, -halfW - cw, ch / 2, 0);
  addCoping(length + cw * 2, ch, halfW + cw, ch / 2, 0);

  // ─── Entry steps ───
  const stepMat = new THREE.MeshStandardMaterial({
    color: 0xc0d4e0,
    roughness: 0.4,
    metalness: 0.05,
  });
  const stepW = 2;
  const stepD = 0.45;
  const stepH = 0.25;
  for (let i = 0; i < 4; i++) {
    const g = new THREE.BoxGeometry(stepW, stepH, stepD);
    const m = new THREE.Mesh(g, stepMat);
    m.position.set(-halfW + 1.5, -stepH * (i + 0.5), halfL - 0.6 - i * stepD * 0.7);
    m.castShadow = true;
    m.receiveShadow = true;
    m.renderOrder = 80;
    poolGroup.add(m);
    basinMeshes.push(m);
  }

  // ─── Water surface ───
  const texLoader = new THREE.TextureLoader();
  const waterNormalTex = await texLoader.loadAsync("textures/waterNormal.webp");
  waterNormalTex.wrapS = waterNormalTex.wrapT = THREE.RepeatWrapping;
  waterNormalTex.colorSpace = THREE.LinearSRGBColorSpace;
  waterNormalTex.anisotropy = 16;

  const waterGeo = new THREE.PlaneGeometry(width, length, 64, 64);
  waterGeo.rotateX(-PI / 2);

  let waterMesh;
  if (opts.waterMode === "water2mesh") {
    waterMesh = new WaterMesh(waterGeo, {
      color: opts.waterColor,
      scale: opts.normalScale,
      flowDirection: new THREE.Vector2(opts.flowDirection[0], opts.flowDirection[1]),
      flowSpeed: opts.flowSpeed,
      reflectivity: opts.reflectivity,
      normalMap0: waterNormalTex,
      normalMap1: waterNormalTex,
    });
  } else {
    waterMesh = createWaterShaderMesh(waterGeo, waterNormalTex, opts);
  }

  waterMesh.position.y = waterLevelOffset;
  waterMesh.renderOrder = 9999;
  poolGroup.add(waterMesh);

  if (scene) scene.add(poolGroup);

  return {
    poolGroup,
    waterMesh,
    basinMeshes,
    options: opts,
    deckBounds: { halfW: deckOuterW / 2, halfL: deckOuterL / 2 },
  };
}

/**
 * Creates a floor mesh with a rectangular hole for the pool.
 * Add the pool first, then create the floor so it surrounds the pool deck.
 */
export function createFloorWithPoolHole(floorMat, floorSize, poolX, poolZ, deckHalfW, deckHalfL, floorY = 1) {
  const half = floorSize / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-half, -half);
  shape.lineTo(half, -half);
  shape.lineTo(half, half);
  shape.lineTo(-half, half);
  shape.lineTo(-half, -half);

  const hole = new THREE.Path();
  hole.moveTo(poolX - deckHalfW, poolZ - deckHalfL);
  hole.lineTo(poolX + deckHalfW, poolZ - deckHalfL);
  hole.lineTo(poolX + deckHalfW, poolZ + deckHalfL);
  hole.lineTo(poolX - deckHalfW, poolZ + deckHalfL);
  hole.lineTo(poolX - deckHalfW, poolZ - deckHalfL);
  shape.holes.push(hole);

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-PI / 2);
  const mesh = new THREE.Mesh(geo, floorMat);
  mesh.position.y = floorY;
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  return mesh;
}
