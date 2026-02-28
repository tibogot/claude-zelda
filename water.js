/**
 * Water: Fresnel shader, animated normals, sun glints.
 * createWater(scene, PARAMS, { uTime, uSunDir, texLoader }) → { waterMesh, waterUniforms }.
 * waterUniforms is the object for ctx.water (Tweakpane). Index updates waterMesh position/scale/visible from PARAMS.
 */
import * as THREE from "three";
import {
  Fn,
  uniform,
  float,
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
  smoothstep,
  pow,
  length,
  max,
  varying,
} from "three/tsl";

const PI = Math.PI;

export function createWater(scene, PARAMS, { uTime, uSunDir, texLoader }) {
  const waterGeo = new THREE.CircleGeometry(1, 128);
  waterGeo.rotateX(-PI / 2);

  const uWaterUvScale = uniform(PARAMS.waterUvScale);
  const uWaterNormalScale = uniform(PARAMS.waterNormalScale);
  const uWaterFresnelScale = uniform(PARAMS.waterFresnelScale);
  const uWaterSpeed = uniform(PARAMS.waterSpeed);
  const uWaterShininess = uniform(PARAMS.waterShininess);
  const uWaterSunColor = uniform(
    new THREE.Color(PARAMS.waterSunColor).convertSRGBToLinear(),
  );
  const uWaterHighlightsGlow = uniform(PARAMS.waterHighlightsGlow);
  const uWaterHighlightFresnelInfluence = uniform(
    PARAMS.waterHighlightFresnelInfluence,
  );
  const uWaterHighlightsSpread = uniform(PARAMS.waterHighlightsSpread);
  const uWaterDeepColor = uniform(
    new THREE.Color(PARAMS.waterDeepColor).convertSRGBToLinear(),
  );
  const uWaterShallowColor = uniform(
    new THREE.Color(0x4a90a4).convertSRGBToLinear(),
  );
  const uWaterMinOpacity = uniform(PARAMS.waterMinOpacity);
  const uWaterNoiseScrollDir = uniform(new THREE.Vector2(0.1, 0));

  const uWaterTworld = uniform(new THREE.Vector3(1, 0, 0));
  const uWaterBworld = uniform(new THREE.Vector3(0, 0, -1));
  const uWaterNworld = uniform(new THREE.Vector3(0, 1, 0));

  const waterNormalTex = texLoader.load("textures/waterNormal.webp");
  waterNormalTex.wrapS = waterNormalTex.wrapT = THREE.RepeatWrapping;

  const vWaterLocalPos = varying(vec3(0), "v_wlp");

  const blendRNM = Fn(([n1, n2]) => {
    const t = n1.add(vec3(0, 0, 1));
    const u = n2.mul(vec3(-1, -1, 1));
    return t.mul(dot(t, u)).sub(u.mul(t.z)).normalize();
  });

  const waterMat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
  });

  waterMat.positionNode = Fn(() => {
    vWaterLocalPos.assign(positionLocal);
    return positionLocal;
  })();

  waterMat.colorNode = Fn(() => {
    const speed = uTime.mul(uWaterSpeed);
    const frequency = uWaterNoiseScrollDir.mul(speed);
    const nUV1 = uv().add(frequency).mul(uWaterUvScale.mul(1.37)).fract();
    const tex1 = texture(waterNormalTex, nUV1);
    const tsn1 = tex1.rgb.mul(2).sub(1).normalize();
    const nUV2 = uv().sub(frequency).mul(uWaterUvScale.mul(0.73)).fract();
    const tex2 = texture(waterNormalTex, nUV2);
    const tsn2 = tex2.rgb.mul(2).sub(1).normalize();
    const blendedTsn = blendRNM(tsn1, tsn2);
    const tsn = vec3(
      blendedTsn.xy.mul(uWaterNormalScale),
      blendedTsn.z,
    ).normalize();

    const normal = uWaterTworld
      .mul(tsn.x)
      .add(uWaterBworld.mul(tsn.y))
      .add(uWaterNworld.mul(tsn.z))
      .normalize();

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const cosTheta = dot(normal, viewDir).clamp();
    const F0 = float(0.02);
    const grazingAngle = float(1.0).sub(cosTheta);
    const grazingAnglePow5 = grazingAngle
      .mul(grazingAngle)
      .mul(grazingAngle)
      .mul(grazingAngle)
      .mul(grazingAngle);
    const fresnelSchlick = F0.add(float(1).sub(F0).mul(grazingAnglePow5));
    const fresnelWeight = fresnelSchlick.mul(uWaterFresnelScale).clamp();

    const reflectVector = reflect(viewDir.negate(), normal);
    const skyGradient = reflectVector.y.mul(0.5).add(0.5).clamp();
    const horizonColor = vec3(0.7, 0.82, 0.95);
    const zenithColor = vec3(0.4, 0.6, 0.9);
    const reflectedColor = mix(horizonColor, zenithColor, skyGradient);

    const distToCenter = length(vWaterLocalPos.xz);
    const depthFactor = smoothstep(float(0.3), float(0.9), distToCenter);
    const waterBaseColor = mix(
      uWaterDeepColor,
      uWaterShallowColor,
      depthFactor,
    );

    const tsnHighlights = vec3(
      blendedTsn.xy.mul(uWaterHighlightsSpread),
      blendedTsn.z,
    ).normalize();
    const normalHighlights = uWaterTworld
      .mul(tsnHighlights.x)
      .add(uWaterBworld.mul(tsnHighlights.y))
      .add(uWaterNworld.mul(tsnHighlights.z))
      .normalize();
    const reflectedLight = reflect(uSunDir, normalHighlights);
    const align = max(dot(reflectedLight, viewDir), 0);
    const spec = pow(align, uWaterShininess);
    const fresnelSpecBoost = mix(
      float(1),
      fresnelSchlick,
      uWaterHighlightFresnelInfluence,
    );
    const sunGlint = uWaterSunColor.mul(
      spec.mul(uWaterHighlightsGlow).mul(fresnelSpecBoost),
    );

    const shadedWater = mix(
      waterBaseColor,
      reflectedColor,
      fresnelWeight,
    );
    return shadedWater.add(sunGlint);
  })();

  waterMat.opacityNode = Fn(() => {
    const distToCenter = length(vWaterLocalPos.xz);
    const edgeFade = smoothstep(float(1.0), float(0.85), distToCenter);

    const viewDir = normalize(cameraPosition.sub(positionWorld));
    const NdotV = max(dot(uWaterNworld, viewDir), float(0));
    const fresnelOpacity = float(1)
      .sub(pow(NdotV, float(2.5)))
      .mul(0.4)
      .add(0.6);

    return edgeFade
      .mul(fresnelOpacity)
      .mul(uWaterMinOpacity.add(0.5))
      .clamp();
  })();

  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.scale.setScalar(PARAMS.lakeRadius);
  waterMesh.position.set(
    PARAMS.lakeCenterX,
    PARAMS.waterLevel,
    PARAMS.lakeCenterZ,
  );
  waterMesh.visible = PARAMS.showWater;
  waterMesh.renderOrder = 100;

  waterMesh.updateMatrixWorld(true);
  uWaterTworld.value
    .set(1, 0, 0)
    .transformDirection(waterMesh.matrixWorld)
    .normalize();
  uWaterBworld.value
    .set(0, 0, -1)
    .transformDirection(waterMesh.matrixWorld)
    .normalize();
  uWaterNworld.value
    .set(0, 1, 0)
    .transformDirection(waterMesh.matrixWorld)
    .normalize();

  scene.add(waterMesh);

  const waterUniforms = {
    uWaterSpeed,
    uWaterNormalScale,
    uWaterUvScale,
    uWaterShininess,
    uWaterHighlightsGlow,
    uWaterHighlightFresnelInfluence,
    uWaterSunColor,
    uWaterHighlightsSpread,
    uWaterDeepColor,
    uWaterShallowColor,
    uWaterFresnelScale,
    uWaterMinOpacity,
  };

  return { waterMesh, waterUniforms };
}
