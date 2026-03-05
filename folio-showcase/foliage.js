/**
 * Folio Showcase — Foliage (Bruno Simon style).
 * Merged plane blob + SDF texture + instancing. Used for bushes (and later tree leaves).
 */
import * as THREE from "three";
import {
  uniform,
  mix,
  float,
  Fn,
  positionLocal,
  normalWorld,
  uv,
  texture,
  rotateUV,
  vec2,
  vec4,
  vec3,
  instance,
  mul,
  add,
  sub,
  smoothstep,
  screenUV,
  screenSize,
  instanceIndex,
  hash,
  positionWorld,
  cameraPosition,
  length,
  depth,
  clamp,
} from "three/tsl";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/**
 * @param {THREE.Scene} scene
 * @param {Array<{ position: THREE.Vector3, scale?: number }>} references
 * @param {{ windOffsetNode: (pos: any) => any, foliageTexture: THREE.Texture, lightDirection: THREE.Vector3, colorA: string | number, colorB: string | number, orientationsPerInstance?: number, scaleMultiplier?: number, aoStrength?: number, sssStrength?: number, sssColor?: string | number }} options
 * @param options.orientationsPerInstance - Number of rotated copies per ref (e.g. 3 = 0°, 120°, 240°) for fluffy volume. Default 3.
 * @param options.scaleMultiplier - Global scale for foliage size (1 = default, >1 = fluffier/bigger). Default 1.
 * @param options.aoStrength - Fake AO darkening at base of blob (0 = off). Default 0.35.
 * @param options.sssStrength - Fake subsurface when back-lit (0 = off). Default 0.25.
 * @param options.seeThrough - If true, fade foliage around player in screen space (folio-style). Default false (bushes). Use true for tree leaves.
 * @param options.seeThroughMultiplier - Scale for see-through hole size. Default 1.
 * @param options.colorVariationStrength - Per-instance color variation 0–1 (brightness + tint). Default 0.15.
 * @param options.conditionalDepthEnabled - If true, close foliage writes far depth so other foliage stays visible when camera is inside; close leaves can disappear behind terrain. Default false.
 * @param options.depthFadeNear - When conditional depth enabled: distance below which depth is written far. Default 2.
 * @param options.depthFadeFar - When conditional depth enabled: distance above which normal depth is written. Default 6.
 * @param options.baseContactStrength - Extra darkening at the very base of the blob (ground-contact AO). 0 = off. Default 0.25.
 * @param options.alphaThreshold - SDF cutoff for leaf shape (lower = more solid, higher = more lacy/transparent). Default 0.3.
 * @param options.alphaTest - Discard fragments with alpha below this (hardness of leaf edges). Default 0.1.
 * @param options.leafShapeVariation - Per-instance SDF threshold offset (0 = uniform, higher = more varied leaf shapes). Default 0.08.
 * @returns {{ mesh, setColorA, setColorB, updateScaleMultiplier, ... }}
 */
export function createFoliage(scene, references, options) {
  const {
    windOffsetNode,
    foliageTexture,
    lightDirection,
    colorA = "#b4b536",
    colorB = "#d8cf3b",
    orientationsPerInstance = 5,
    scaleMultiplier = 1,
    aoStrength = 0.35,
    sssStrength = 0.25,
    sssColor = "#6b8c3a",
    seeThrough = false,
    seeThroughMultiplier = 1,
    colorVariationStrength = 0.15,
    conditionalDepthEnabled = false,
    depthFadeNear = 2,
    depthFadeFar = 6,
    baseContactStrength = 0.25,
    alphaThreshold = 0.3,
    alphaTest = 0.1,
    leafShapeVariation = 0.08,
  } = options;

  // Normal lerp: 0.85 = smoother blob; lower (e.g. 0.78) = more per-plane variation, leaves look more 3D/faceted
  const NORMAL_LERP = 0.82;

  const rng = seededRandom(12345);
  const planeCount = 100;
  const planes = [];

  for (let i = 0; i < planeCount; i++) {
    const plane = new THREE.PlaneGeometry(0.85, 0.85);
    const spherical = new THREE.Spherical(
      1 - Math.pow(rng(), 2.5),
      Math.PI * 2 * rng(),
      Math.PI * rng()
    );
    const position = new THREE.Vector3().setFromSpherical(spherical);
    plane.rotateZ(rng() * 9999);
    plane.translate(position.x, position.y, position.z);
    const normal = position.clone().normalize();
    const normalArray = new Float32Array(12);
    for (let v = 0; v < 4; v++) {
      const i3 = v * 3;
      const pos = new THREE.Vector3(
        plane.attributes.position.array[i3],
        plane.attributes.position.array[i3 + 1],
        plane.attributes.position.array[i3 + 2]
      );
      const mixedNormal = pos.lerp(normal, NORMAL_LERP);
      normalArray[i3] = mixedNormal.x;
      normalArray[i3 + 1] = mixedNormal.y;
      normalArray[i3 + 2] = mixedNormal.z;
    }
    plane.setAttribute("normal", new THREE.BufferAttribute(normalArray, 3));
    planes.push(plane);
  }

  const geometry = mergeGeometries(planes);
  geometry.computeBoundingBox();
  const blobMinY = geometry.boundingBox.min.y;
  const blobMaxY = geometry.boundingBox.max.y;
  const blobHeight = blobMaxY - blobMinY;
  const lightDirUniform = uniform(
    new THREE.Vector3(
      lightDirection.x,
      lightDirection.y,
      lightDirection.z
    ).normalize()
  );
  const colorAUniform = uniform(new THREE.Color(colorA));
  const colorBUniform = uniform(new THREE.Color(colorB));
  const blobMinYUniform = uniform(blobMinY);
  const aoStrengthUniform = uniform(aoStrength);
  const sssStrengthUniform = uniform(sssStrength);
  const sssColorUniform = uniform(new THREE.Color(sssColor));
  const seeThroughUniform = uniform(seeThrough ? 1 : 0);
  const seeThroughPositionUniform = uniform(new THREE.Vector2(0.5, 0.5));
  const seeThroughEdgeMinUniform = uniform(0.11);
  const seeThroughEdgeMaxUniform = uniform(0.57);
  const colorVariationStrengthUniform = uniform(colorVariationStrength);
  const conditionalDepthEnabledUniform = uniform(conditionalDepthEnabled ? 1 : 0);
  const depthFadeNearUniform = uniform(depthFadeNear);
  const depthFadeFarUniform = uniform(depthFadeFar);
  const baseContactStrengthUniform = uniform(baseContactStrength);
  const alphaThresholdUniform = uniform(alphaThreshold);
  const alphaTestUniform = uniform(alphaTest);
  const leafShapeVariationUniform = uniform(leafShapeVariation);
  const BASE_CONTACT_RANGE = 0.15; // bottom 15% of blob height for ground-contact AO

  const foliageAlpha = Fn(() => {
    const windOffset = windOffsetNode(positionLocal.xz);
    const rotAngle = windOffset.length().mul(2.2);
    const rotatedUv = rotateUV(uv(), rotAngle, vec2(0.5));
    return texture(foliageTexture, rotatedUv).r;
  });

  const alphaNode = Fn(() => {
    const foliageSDF = foliageAlpha();
    const thresholdOffset = hash(instanceIndex).sub(0.5).mul(2).mul(leafShapeVariationUniform);
    const effectiveThreshold = alphaThresholdUniform.add(thresholdOffset);
    const toPlayer = screenUV.sub(seeThroughPositionUniform);
    const toPlayerAspect = mul(toPlayer, vec2(screenSize.x.div(screenSize.y), float(1)));
    const distanceToPlayer = toPlayerAspect.length();
    const distanceFade = smoothstep(seeThroughEdgeMinUniform, seeThroughEdgeMaxUniform, distanceToPlayer);
    const alphaSeeThrough = foliageSDF.mul(distanceFade.mul(float(1).sub(effectiveThreshold)).add(effectiveThreshold)).sub(effectiveThreshold);
    const alphaNormal = foliageSDF.sub(effectiveThreshold);
    return mix(alphaSeeThrough, alphaNormal, float(1).sub(seeThroughUniform));
  })();

  const colorNode = Fn(() => {
    const NdotL = normalWorld.dot(lightDirUniform);
    const mixStrength = NdotL.smoothstep(0, 1);
    let col = mix(colorAUniform, colorBUniform, mixStrength);
    // Fake AO: darken base of blob (blend over bottom 40% of height)
    const aoBlend = positionLocal.y.sub(blobMinYUniform).div(float(blobHeight * 0.4)).smoothstep(0, 1);
    col = mix(col.mul(float(1).sub(aoStrengthUniform)), col, aoBlend);
    // Ground-contact AO: extra darkening at the very base (bottom 15%) — looks like trunk/ground shadow
    const baseContactBlend = positionLocal.y.sub(blobMinYUniform).div(float(blobHeight * BASE_CONTACT_RANGE)).smoothstep(0, 1);
    col = mix(col.mul(float(1).sub(baseContactStrengthUniform)), col, baseContactBlend);
    const backLit = NdotL.smoothstep(-1, 0);
    col = col.add(mul(sssColorUniform, sssStrengthUniform, backLit));
    // Per-instance color variation (brightness + tint from hash)
    const r0 = hash(instanceIndex);
    const r1 = hash(instanceIndex.add(1));
    const r2 = hash(instanceIndex.add(2));
    const brightness = float(1).add(r0.sub(0.5).mul(2).mul(colorVariationStrengthUniform));
    const tint = vec3(r0.sub(0.5), r1.sub(0.5), r2.sub(0.5)).mul(colorVariationStrengthUniform);
    col = clamp(col.mul(brightness).add(tint), 0, 1);
    return col;
  })();

  const material = new THREE.MeshLambertNodeMaterial({
    transparent: true,
    alphaTest: alphaTest,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  material.alphaNode = alphaNode;
  // Folio-style: explicit output with alpha so WebGPU pipeline renders transparency (SDF leaves)
  material.colorNode = colorNode;
  material.outputNode = Fn(() => {
    alphaNode.lessThan(alphaTestUniform).discard();
    return vec4(colorNode, alphaNode);
  })();

  // Optional conditional depth: when enabled, close fragments write far depth so other foliage stays visible when camera is inside (close leaves may disappear behind terrain)
  material.depthNode = Fn(() => {
    const dist = length(sub(positionWorld, cameraPosition));
    const fade = smoothstep(depthFadeNearUniform, depthFadeFarUniform, dist);
    const conditionalDepth = mix(float(1), depth, fade);
    return mix(depth, conditionalDepth, conditionalDepthEnabledUniform);
  })();

  // Shadow pass: discard transparent fragments so shadow matches leaf shape (SDF alpha)
  material.castShadowNode = Fn(() => {
    const thresholdOffset = hash(instanceIndex).sub(0.5).mul(2).mul(leafShapeVariationUniform);
    const effectiveThreshold = alphaThresholdUniform.add(thresholdOffset);
    const shadowAlpha = foliageAlpha().sub(effectiveThreshold);
    shadowAlpha.lessThan(alphaTestUniform).discard();
    return vec4(0, 0, 0, 1);
  })();

  const count = references.length * Math.max(1, orientationsPerInstance);
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  mesh.count = count;

  const instanceMatrixAttr = new THREE.InstancedBufferAttribute(
    new Float32Array(count * 16),
    16
  );
  instanceMatrixAttr.setUsage(THREE.DynamicDrawUsage);

  const nOri = Math.max(1, orientationsPerInstance);
  const instanceData = [];
  for (let i = 0; i < count; i++) {
    const refIndex = Math.floor(i / nOri);
    const oriIndex = i % nOri;
    const ref = references[refIndex];
    const refScale =
      typeof ref.scale === "number"
        ? ref.scale
        : ref.scale?.x != null
          ? ref.scale.x
          : 1;
    const yaw = (oriIndex / nOri) * Math.PI * 2;
    instanceData.push({
      position: new THREE.Vector3(ref.position.x, ref.position.y, ref.position.z),
      refScale,
      yaw,
    });
  }

  function updateInstanceMatrices(mult) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const d = instanceData[i];
      const scale = d.refScale * mult;
      const baseY = d.position.y - blobMinY * scale;
      dummy.position.set(d.position.x, baseY, d.position.z);
      dummy.scale.setScalar(scale);
      dummy.quaternion.setFromEuler(new THREE.Euler(0, d.yaw, 0));
      dummy.updateMatrix();
      dummy.matrix.toArray(instanceMatrixAttr.array, i * 16);
    }
    instanceMatrixAttr.needsUpdate = true;
  }

  updateInstanceMatrices(scaleMultiplier);

  material.positionNode = Fn(({ object }) => {
    instance(object.count, instanceMatrixAttr).toStack();
    return positionLocal;
  })();

  scene.add(mesh);

  function setColorA(c) {
    colorAUniform.value.set(c);
  }
  function setColorB(c) {
    colorBUniform.value.set(c);
  }

  return {
    mesh,
    setColorA,
    setColorB,
    updateScaleMultiplier: updateInstanceMatrices,
    colorAUniform,
    colorBUniform,
    lightDirUniform,
    aoStrengthUniform,
    sssStrengthUniform,
    sssColorUniform,
    colorVariationStrengthUniform,
    conditionalDepthEnabledUniform,
    depthFadeNearUniform,
    depthFadeFarUniform,
    baseContactStrengthUniform,
    alphaThresholdUniform,
    alphaTestUniform,
    leafShapeVariationUniform,
    seeThroughPosition: seeThroughPositionUniform,
    seeThroughEdgeMin: seeThroughEdgeMinUniform,
    seeThroughEdgeMax: seeThroughEdgeMaxUniform,
  };
}
