import React, { useEffect, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { InstancedMesh2 } from "@three.ez/instanced-mesh";
import { simplifyGeometriesByError } from "@three.ez/simplify-geometry";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  hemiOctaGridToDir,
  octaGridToDir,
} from "./OctahedralForestConsolidated/utils/octahedronUtils";

// ============================================================================
// ATLAS BAKING SHADERS (GLSL3 with MRT)
// ============================================================================

const ATLAS_VERTEX_SHADER = /* glsl */ `
precision highp float;
precision highp int;

varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vHighPrecisionZW;

void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * vec3(normal));

    vec4 mvPosition = vec4(position, 1.0);
    mvPosition = modelViewMatrix * mvPosition;
    gl_Position = projectionMatrix * mvPosition;

    vHighPrecisionZW = gl_Position.zw;
}
`;

const ATLAS_FRAGMENT_SHADER = /* glsl */ `
precision highp float;
precision highp int;

uniform float alphaTest;
uniform mat3 normalMatrix;
uniform sampler2D map;

// Lighting uniforms for proper atlas baking
uniform vec3 bakingAmbientColor;
uniform vec3 bakingDirLightColor;
uniform vec3 bakingDirLightDir;

varying vec2 vUv;
varying vec3 vNormal;
varying vec2 vHighPrecisionZW;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormalDepth;

void main() {
    vec4 albedo = texture(map, vUv);
    if (albedo.a < alphaTest) discard;

    vec3 normal = normalize(vNormal);
    #ifdef DOUBLE_SIDED
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        normal *= faceDirection;
    #endif
    normal = normalize(normalMatrix * normal);

    float fragCoordZ = 0.5 * vHighPrecisionZW[0] / vHighPrecisionZW[1] + 0.5;

    // Compute diffuse lighting so atlas stores properly-lit colors
    float NdotL = max(dot(normal, bakingDirLightDir), 0.0);
    vec3 lighting = bakingAmbientColor + bakingDirLightColor * NdotL;
    vec3 litColor = albedo.rgb * lighting;

    gAlbedo = linearToOutputTexel(vec4(litColor, albedo.a));
    gNormalDepth = vec4(normal, 1.0 - fragCoordZ);
}
`;

// ============================================================================
// IMPOSTOR DISPLAY SHADERS (GLSL1, injected via onBeforeCompile)
// ============================================================================

const IMPOSTOR_PARAMS_VERTEX = /* glsl */ `
#include <clipping_planes_pars_vertex>

uniform mat4 transform;
uniform float spritesPerSide;

varying vec4 vSpritesWeight;
varying vec2 vSprite1;
varying vec2 vSprite2;
varying vec2 vSprite3;
varying vec2 vSpriteUV1;
varying vec2 vSpriteUV2;
varying vec2 vSpriteUV3;

vec2 encodeDirection(vec3 direction) {
  #ifdef EZ_USE_HEMI_OCTAHEDRON
  vec3 octahedron = direction / dot(direction, sign(direction));
  return vec2(1.0 + octahedron.x + octahedron.z, 1.0 + octahedron.z - octahedron.x) * 0.5;
  #else
  return vec2(0.0);
  #endif
}

vec3 decodeDirection(vec2 gridIndex, vec2 spriteCountMinusOne) {
  vec2 gridUV = gridIndex / spriteCountMinusOne;
  #ifdef EZ_USE_HEMI_OCTAHEDRON
  vec3 position = vec3(gridUV.x - gridUV.y, 0.0, -1.0 + gridUV.x + gridUV.y);
  position.y = 1.0 - abs(position.x) - abs(position.z);
  #else
  vec3 position = vec3(0.0, 1.0, 0.0);
  #endif
  return normalize(position);
}

void computePlaneBasis(vec3 normal, out vec3 tangent, out vec3 bitangent) {
  vec3 up = vec3(0.0, 1.0, 0.0);
  if(normal.y > 0.999)
    up = vec3(-1.0, 0.0, 0.0);
  #ifndef EZ_USE_HEMI_OCTAHEDRON
  if(normal.y < -0.999)
    up = vec3(1.0, 0.0, 0.0);
  #endif
  tangent = normalize(cross(up, normal));
  bitangent = cross(normal, tangent);
}

vec3 projectVertex(vec3 normal) {
  vec3 x, y;
  computePlaneBasis(normal, x, y);
  return x * position.x + y * position.y;
}

void computeSpritesWeight(vec2 gridFract) {
  vSpritesWeight = vec4(min(1.0 - gridFract.x, 1.0 - gridFract.y), abs(gridFract.x - gridFract.y), min(gridFract.x, gridFract.y), ceil(gridFract.x - gridFract.y));
}

vec2 projectToPlaneUV(vec3 normal, vec3 tangent, vec3 bitangent, vec3 cameraPosition, vec3 viewDir) {
  float denom = dot(viewDir, normal);
  float t = -dot(cameraPosition, normal) / denom;
  vec3 hit = cameraPosition + viewDir * t;
  vec2 uv = vec2(dot(tangent, hit), dot(bitangent, hit));
  return uv + 0.5;
}
`;

const IMPOSTOR_VERTEX = /* glsl */ `
vec2 spritesMinusOne = vec2(spritesPerSide - 1.0);

#if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT
mat4 instanceMatrix2 = instanceMatrix * transform;
vec3 cameraPosLocal = (inverse(instanceMatrix2 * modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
#else
vec3 cameraPosLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
#endif

vec3 cameraDir = normalize(cameraPosLocal);

vec3 projectedVertex = projectVertex(cameraDir);
vec3 viewDirLocal = normalize(projectedVertex - cameraPosLocal);

vec2 grid = encodeDirection(cameraDir) * spritesMinusOne;
vec2 gridFloor = min(floor(grid), spritesMinusOne);
vec2 gridFract = fract(grid);

computeSpritesWeight(gridFract);

vSprite1 = gridFloor;
vSprite2 = min(vSprite1 + mix(vec2(0.0, 1.0), vec2(1.0, 0.0), vSpritesWeight.w), spritesMinusOne);
vSprite3 = min(vSprite1 + vec2(1.0), spritesMinusOne);

vec3 spriteNormal1 = decodeDirection(vSprite1, spritesMinusOne);
vec3 spriteNormal2 = decodeDirection(vSprite2, spritesMinusOne);
vec3 spriteNormal3 = decodeDirection(vSprite3, spritesMinusOne);

vec3 planeX1, planeY1, planeX2, planeY2, planeX3, planeY3;
computePlaneBasis(spriteNormal1, planeX1, planeY1);
computePlaneBasis(spriteNormal2, planeX2, planeY2);
computePlaneBasis(spriteNormal3, planeX3, planeY3);

vSpriteUV1 = projectToPlaneUV(spriteNormal1, planeX1, planeY1, cameraPosLocal, viewDirLocal);
vSpriteUV2 = projectToPlaneUV(spriteNormal2, planeX2, planeY2, cameraPosLocal, viewDirLocal);
vSpriteUV3 = projectToPlaneUV(spriteNormal3, planeX3, planeY3, cameraPosLocal, viewDirLocal);

vec4 mvPosition = vec4(projectedVertex, 1.0);

#if defined USE_INSTANCING || defined USE_INSTANCING_INDIRECT
    mvPosition = instanceMatrix2 * mvPosition;
#endif

mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

const IMPOSTOR_PARAMS_FRAGMENT = /* glsl */ `
#include <clipping_planes_pars_fragment>

uniform float spritesPerSide;
uniform float alphaClamp;

varying vec4 vSpritesWeight;
varying vec2 vSprite1;
varying vec2 vSprite2;
varying vec2 vSprite3;
varying vec2 vSpriteUV1;
varying vec2 vSpriteUV2;
varying vec2 vSpriteUV3;

#ifdef EZ_USE_NORMAL
vec3 blendNormals(vec2 uv1, vec2 uv2, vec2 uv3) {
  vec4 normalDepth1 = texture2D(normalMap, uv1);
  vec4 normalDepth2 = texture2D(normalMap, uv2);
  vec4 normalDepth3 = texture2D(normalMap, uv3);
  return normalize(normalDepth1.xyz * vSpritesWeight.x + normalDepth2.xyz * vSpritesWeight.y + normalDepth3.xyz * vSpritesWeight.z);
}
#endif

vec2 getUV(vec2 uv_f, vec2 frame, float frame_size) {
  uv_f = clamp(uv_f, vec2(0.0), vec2(1.0));
  uv_f = frame_size * (frame + uv_f);
  return clamp(uv_f, vec2(0.0), vec2(1.0));
}
`;

const IMPOSTOR_MAP_FRAGMENT = /* glsl */ `
float spriteSize = 1.0 / spritesPerSide;
vec2 uv1 = getUV(vSpriteUV1, vSprite1, spriteSize);
vec2 uv2 = getUV(vSpriteUV2, vSprite2, spriteSize);
vec2 uv3 = getUV(vSpriteUV3, vSprite3, spriteSize);

vec4 sprite1, sprite2, sprite3;
float test = 1.0 - alphaClamp;

if (vSpritesWeight.x >= test) {
  sprite1 = texture2D(map, uv1);
  if (sprite1.a <= alphaClamp) discard;
  sprite2 = texture2D(map, uv2);
  sprite3 = texture2D(map, uv3);
} else if (vSpritesWeight.y >= test) {
  sprite2 = texture2D(map, uv2);
  if (sprite2.a <= alphaClamp) discard;
  sprite1 = texture2D(map, uv1);
  sprite3 = texture2D(map, uv3);
} else if (vSpritesWeight.z >= test) {
  sprite3 = texture2D(map, uv3);
  if (sprite3.a <= alphaClamp) discard;
  sprite1 = texture2D(map, uv1);
  sprite2 = texture2D(map, uv2);
} else {
  sprite1 = texture2D(map, uv1);
  sprite2 = texture2D(map, uv2);
  sprite3 = texture2D(map, uv3);
}

vec4 blendedColor = sprite1 * vSpritesWeight.x + sprite2 * vSpritesWeight.y + sprite3 * vSpritesWeight.z;

if (blendedColor.a <= alphaClamp) discard;

#ifndef EZ_TRANSPARENT
blendedColor = vec4(vec3(blendedColor.rgb) / blendedColor.a, 1.0);
#endif
`;

const IMPOSTOR_NORMAL_FRAGMENT_BEGIN = /* glsl */ `
vec3 normal = blendNormals(uv1, uv2, uv3);
vec3 nonPerturbedNormal = normal;
`;

// ============================================================================
// UTILITY: Compute bounding sphere of an Object3D hierarchy
// ============================================================================

const _sphere = new THREE.Sphere();

function computeObjectBoundingSphere(
  obj: THREE.Object3D,
  target = new THREE.Sphere(),
  forceCompute = false
): THREE.Sphere {
  target.makeEmpty();

  function traverse(o: THREE.Object3D): void {
    if ((o as THREE.Mesh).isMesh) {
      const geometry = (o as THREE.Mesh).geometry;
      if (forceCompute || !geometry.boundingSphere)
        geometry.computeBoundingSphere();
      _sphere.copy(geometry.boundingSphere!).applyMatrix4(o.matrixWorld);
      target.union(_sphere);
    }
    for (const child of o.children) {
      traverse(child);
    }
  }

  traverse(obj);
  return target;
}

// ============================================================================
// ATLAS BAKING (FIXED: uses a temporary Scene with lights)
// ============================================================================

interface CreateTextureAtlasParams {
  renderer: THREE.WebGLRenderer;
  useHemiOctahedron: boolean;
  target: THREE.Object3D;
  textureSize?: number;
  spritesPerSide?: number;
  cameraFactor?: number;
}

interface TextureAtlasResult {
  renderTarget: THREE.WebGLRenderTarget;
  albedo: THREE.Texture;
  normalDepth: THREE.Texture;
}

const _camera = new THREE.OrthographicCamera();
const _bSphere = new THREE.Sphere();
const _oldScissor = new THREE.Vector4();
const _oldViewport = new THREE.Vector4();
const _coords = new THREE.Vector2();
const _userDataMaterialKey = "_oif_originalMaterial";

function createTextureAtlas(
  params: CreateTextureAtlasParams
): TextureAtlasResult {
  const { renderer, target, useHemiOctahedron } = params;

  const atlasSize = params.textureSize ?? 2048;
  const countPerSide = params.spritesPerSide ?? 16;
  const countPerSideMinusOne = countPerSide - 1;
  const spriteSize = atlasSize / countPerSide;
  const cameraFactor = params.cameraFactor ?? 1;

  computeObjectBoundingSphere(target, _bSphere, true);

  // Camera setup
  _camera.left = -_bSphere.radius;
  _camera.right = _bSphere.radius;
  _camera.top = _bSphere.radius;
  _camera.bottom = -_bSphere.radius;
  _camera.zoom = cameraFactor;
  _camera.near = 0.001;
  _camera.far = _bSphere.radius * 2 + 0.001;
  _camera.updateProjectionMatrix();

  // ===== FIX: Create temporary Scene with lighting =====
  const tempScene = new THREE.Scene();
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
  tempScene.add(ambientLight);

  // Save original parent so we can restore after baking
  const originalParent = target.parent;
  tempScene.add(target); // moves target into tempScene

  // Save renderer state
  const oldPixelRatio = renderer.getPixelRatio();
  const oldScissorTest = renderer.getScissorTest();
  const oldClearAlpha = renderer.getClearAlpha();
  const oldToneMapping = renderer.toneMapping;
  renderer.getScissor(_oldScissor);
  renderer.getViewport(_oldViewport);

  // Create MRT render target (2 textures: albedo + normalDepth)
  const renderTarget = new THREE.WebGLRenderTarget(atlasSize, atlasSize, {
    count: 2,
    generateMipmaps: false,
  });

  renderTarget.textures[0].minFilter = THREE.LinearFilter;
  renderTarget.textures[0].magFilter = THREE.LinearFilter;
  renderTarget.textures[0].type = THREE.UnsignedByteType;
  renderTarget.textures[0].colorSpace = renderer.outputColorSpace;

  renderTarget.textures[1].minFilter = THREE.NearestFilter;
  renderTarget.textures[1].magFilter = THREE.NearestFilter;
  renderTarget.textures[1].type = THREE.HalfFloatType;
  renderTarget.textures[1].colorSpace = THREE.LinearSRGBColorSpace;

  // Configure renderer for atlas baking
  renderer.setRenderTarget(renderTarget);
  renderer.setScissorTest(true);
  renderer.setPixelRatio(1);
  renderer.setClearAlpha(0);
  // Disable tone mapping to prevent double-application
  renderer.toneMapping = THREE.NoToneMapping;

  // Override materials with atlas baking shader
  overrideTargetMaterial(target);

  console.log("[OctahedralImpostorForest] Baking atlas with temp Scene + AmbientLight, toneMapping disabled");

  // Render all views
  for (let row = 0; row < countPerSide; row++) {
    for (let col = 0; col < countPerSide; col++) {
      _coords.set(col / countPerSideMinusOne, row / countPerSideMinusOne);

      if (useHemiOctahedron) hemiOctaGridToDir(_coords, _camera.position);
      else octaGridToDir(_coords, _camera.position);

      _camera.position
        .setLength(_bSphere.radius * cameraFactor)
        .add(_bSphere.center);
      _camera.lookAt(_bSphere.center);

      const xOffset = (col / countPerSide) * atlasSize;
      const yOffset = (row / countPerSide) * atlasSize;
      renderer.setViewport(xOffset, yOffset, spriteSize, spriteSize);
      renderer.setScissor(xOffset, yOffset, spriteSize, spriteSize);

      // FIX: Render the Scene (not bare Object3D) for proper renderer state
      renderer.render(tempScene, _camera);
    }
  }

  // Restore materials
  restoreTargetMaterial(target);

  // Restore target to original parent
  if (originalParent) {
    originalParent.add(target);
  } else {
    tempScene.remove(target);
  }

  // Clean up temp scene
  tempScene.remove(ambientLight);
  ambientLight.dispose();

  // Restore renderer state
  renderer.setRenderTarget(null);
  renderer.setScissorTest(oldScissorTest);
  renderer.setViewport(
    _oldViewport.x,
    _oldViewport.y,
    _oldViewport.z,
    _oldViewport.w
  );
  renderer.setScissor(
    _oldScissor.x,
    _oldScissor.y,
    _oldScissor.z,
    _oldScissor.w
  );
  renderer.setPixelRatio(oldPixelRatio);
  renderer.setClearAlpha(oldClearAlpha);
  renderer.toneMapping = oldToneMapping;
  renderer.resetState();

  return {
    renderTarget,
    albedo: renderTarget.textures[0],
    normalDepth: renderTarget.textures[1],
  };

  function overrideTargetMaterial(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).material) {
        const material = (child as THREE.Mesh).material;
        child.userData[_userDataMaterialKey] = material;
        const overrideMaterial = Array.isArray(material)
          ? material.map((mat) => createBakingMaterial(mat))
          : createBakingMaterial(material);
        (child as THREE.Mesh).material = overrideMaterial;
      }
    });
  }

  function createBakingMaterial(
    material: THREE.Material
  ): THREE.ShaderMaterial {
    const uniforms: { [uniform: string]: THREE.IUniform } = {
      map: { value: (material as THREE.MeshStandardMaterial).map },
      alphaTest: {
        value: (material as THREE.MeshStandardMaterial).alphaTest,
      },
      // Full ambient = capture pure albedo at full brightness
      // Lambert material handles real-time lighting at display time
      bakingAmbientColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
      bakingDirLightColor: { value: new THREE.Color(0.0, 0.0, 0.0) },
      bakingDirLightDir: {
        value: new THREE.Vector3(0.0, 1.0, 0.0).normalize(),
      },
    };

    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: ATLAS_VERTEX_SHADER,
      fragmentShader: ATLAS_FRAGMENT_SHADER,
      glslVersion: THREE.GLSL3,
      side: material.side,
      transparent: material.transparent,
    });
  }

  function restoreTargetMaterial(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child.userData[_userDataMaterialKey]) {
        (child as THREE.Mesh).material = child.userData[_userDataMaterialKey];
        delete child.userData[_userDataMaterialKey];
      }
    });
  }
}

// ============================================================================
// IMPOSTOR MATERIAL CREATION
// ============================================================================

interface OctahedralImpostorUniforms {
  spritesPerSide: THREE.IUniform<number>;
  alphaClamp: THREE.IUniform<number>;
  transform: THREE.IUniform<THREE.Matrix4>;
}

interface OctahedralImpostorDefines {
  EZ_USE_HEMI_OCTAHEDRON?: boolean;
  EZ_USE_NORMAL?: boolean;
  EZ_USE_ORM?: boolean;
  EZ_TRANSPARENT?: boolean;
}

// Module augmentation for impostor properties on Material
declare module "three" {
  interface Material {
    isOctahedralImpostorMaterial2?: boolean;
    _oifUniforms?: OctahedralImpostorUniforms;
    _oifDefines?: OctahedralImpostorDefines;
  }
}

interface CreateImpostorParams extends CreateTextureAtlasParams {
  baseType: new () => THREE.Material;
  transparent?: boolean;
  alphaClamp?: number;
  scale?: number;
  translation?: THREE.Vector3;
}

function createImpostorMaterial(params: CreateImpostorParams): THREE.Material {
  const { albedo, normalDepth } = createTextureAtlas(params);

  const material = new params.baseType();
  material.isOctahedralImpostorMaterial2 = true;
  material.transparent = params.transparent ?? false;
  (material as any).map = albedo;
  // Don't set normalMap for MeshBasicMaterial (it doesn't support it)
  // Normals aren't needed for distant LOD impostors

  material._oifDefines = {};
  if (params.useHemiOctahedron)
    material._oifDefines.EZ_USE_HEMI_OCTAHEDRON = true;
  if (params.transparent) material._oifDefines.EZ_TRANSPARENT = true;
  // EZ_USE_NORMAL disabled - MeshBasicMaterial has no normalMap uniform

  const { scale, translation, spritesPerSide, alphaClamp } = params;

  material._oifUniforms = {
    spritesPerSide: { value: spritesPerSide ?? 16 },
    alphaClamp: { value: alphaClamp ?? 0.4 },
    transform: {
      value: new THREE.Matrix4()
        .makeScale(scale ?? 1, scale ?? 1, scale ?? 1)
        .setPosition(translation ?? new THREE.Vector3()),
    },
  };

  injectImpostorShaders(material);

  return material;
}

function injectImpostorShaders(material: THREE.Material): void {
  const onBeforeCompileBase = material.onBeforeCompile;

  material.onBeforeCompile = (shader, renderer) => {
    shader.defines = { ...shader.defines, ...material._oifDefines };
    shader.uniforms = { ...shader.uniforms, ...material._oifUniforms };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <clipping_planes_pars_vertex>",
        IMPOSTOR_PARAMS_VERTEX
      )
      .replace("#include <project_vertex>", IMPOSTOR_VERTEX);

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <clipping_planes_pars_fragment>",
        IMPOSTOR_PARAMS_FRAGMENT
      )
      .replace(
        "#include <normal_fragment_begin>",
        IMPOSTOR_NORMAL_FRAGMENT_BEGIN
      )
      .replace(
        "#include <normal_fragment_maps>",
        "// #include <normal_fragment_maps>"
      )
      .replace(
        "#include <map_fragment>",
        `${IMPOSTOR_MAP_FRAGMENT}\n\tdiffuseColor *= blendedColor;`
      );

    onBeforeCompileBase?.call(material, shader, renderer);
  };

  const customProgramCacheKeyBase = material.customProgramCacheKey;

  material.customProgramCacheKey = () => {
    const hemiOcta = !!material._oifDefines?.EZ_USE_HEMI_OCTAHEDRON;
    const useNormal = !!material._oifDefines?.EZ_USE_NORMAL;
    const transparent = !!material.transparent;
    return `oif_${hemiOcta}_${transparent}_${useNormal}_${customProgramCacheKeyBase.call(
      material
    )}`;
  };
}

// ============================================================================
// OCTAHEDRAL IMPOSTOR MESH
// ============================================================================

class OctahedralImpostorMesh extends THREE.Mesh<
  THREE.PlaneGeometry,
  THREE.Material
> {
  constructor(params: CreateImpostorParams) {
    super(new THREE.PlaneGeometry(), undefined);

    const sphere = computeObjectBoundingSphere(
      params.target,
      new THREE.Sphere(),
      true
    );

    this.scale.multiplyScalar(sphere.radius * 2);
    this.position.copy(sphere.center);

    params.scale = sphere.radius * 2;
    params.translation = sphere.center.clone();

    this.material = createImpostorMaterial(params);
  }
}

// ============================================================================
// REACT COMPONENT: OctahedralImpostorForest
// ============================================================================

interface OctahedralImpostorForestProps {
  modelPath: string;
  centerPosition: [number, number, number];
  minRadius: number;
  radius: number;
  treeCount: number;
  terrainMesh?: THREE.Mesh;
  getTerrainHeight?: (x: number, z: number) => number;
  lodDistances?: { mid: number; far: number };
  leavesAlphaTest?: number;
  leavesOpacity?: number;
  impostorSettings?: {
    spritesPerSide?: number;
    textureSize?: number;
    useHemiOctahedron?: boolean;
    alphaClamp?: number;
  };
}

export const OctahedralImpostorForest: React.FC<
  OctahedralImpostorForestProps
> = ({
  modelPath,
  centerPosition,
  minRadius,
  radius,
  treeCount,
  terrainMesh,
  getTerrainHeight,
  lodDistances = { mid: 20, far: 100 },
  leavesAlphaTest = 0.4,
  leavesOpacity = 1,
  impostorSettings = {
    spritesPerSide: 12,
    textureSize: 1024,
    useHemiOctahedron: true,
    alphaClamp: 0.4,
  },
}) => {
  const { scene } = useGLTF(modelPath);
  const { scene: threeScene, gl, camera } = useThree();
  const instancedMeshRef = useRef<InstancedMesh2 | null>(null);

  useEffect(() => {
    if (!scene) return;

    let isCancelled = false;
    let createdMesh: (InstancedMesh2 & { camera?: THREE.Camera }) | null = null;

    const setupForest = async () => {
      console.log("[OctahedralImpostorForest] NEW COMPONENT RUNNING - v2 with temp Scene fix");

      // Step 1: Extract meshes from model
      const meshes: THREE.Mesh[] = [];
      scene.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          meshes.push(child as THREE.Mesh);
        }
      });

      if (meshes.length === 0) return;

      // Step 2: Prepare materials (fix transparency for leaves)
      meshes.forEach((mesh) => {
        const material = mesh.material as THREE.Material;
        if (material.transparent || (material as any).alphaTest) {
          const newMat = material.clone();
          (newMat as any).alphaTest = leavesAlphaTest;
          newMat.opacity = leavesOpacity;
          newMat.transparent = leavesOpacity < 1;
          if ((newMat as any).map) {
            (newMat as any).map.generateMipmaps = false;
          }
          mesh.material = newMat;
        }
      });

      // Step 3: Transform geometries to world space (match GLB hierarchy so model stands correctly)
      // and merge. Same approach as YellowFlower: apply matrixWorld so orientation/scale match
      // the scene (and thus the impostor atlas).
      const geometries = meshes.map((m) => {
        m.updateMatrixWorld(true);
        const cloned = m.geometry.clone();
        cloned.applyMatrix4(m.matrixWorld);
        cloned.computeVertexNormals();
        cloned.computeBoundingSphere();
        return cloned;
      });
      const materials = meshes.map((m) => m.material as THREE.Material);
      const mergedGeo = mergeGeometries(geometries, true);

      // Step 4: Generate positions (donut ring + terrain raycasting)
      const positions: THREE.Vector3[] = [];
      for (let i = 0; i < treeCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const distance = minRadius + Math.random() * (radius - minRadius);
        const x = centerPosition[0] + Math.cos(angle) * distance;
        const z = centerPosition[2] + Math.sin(angle) * distance;

        let y = centerPosition[1];
        if (getTerrainHeight) {
          y = getTerrainHeight(x, z);
        } else if (terrainMesh) {
          const raycaster = new THREE.Raycaster();
          raycaster.set(
            new THREE.Vector3(x, 1000, z),
            new THREE.Vector3(0, -1, 0)
          );
          const intersects = raycaster.intersectObject(terrainMesh, false);
          if (intersects.length > 0) {
            y = intersects[0].point.y;
          }
        }

        positions.push(new THREE.Vector3(x, y, z));
      }

      // Step 5: Create InstancedMesh2
      const iMesh = new InstancedMesh2(mergedGeo, materials, {
        createEntities: true,
        renderer: gl,
        capacity: positions.length,
      }) as unknown as InstancedMesh2 & { camera?: THREE.Camera };

      createdMesh = iMesh;

      iMesh.camera = camera;
      iMesh.castShadow = true;
      iMesh.receiveShadow = true;

      // Step 6: Add instances with randomization
      iMesh.addInstances(positions.length, (obj, index) => {
        obj.position.copy(positions[index]);
        obj.rotateY(Math.random() * Math.PI * 2);
        obj.rotateX(Math.random() * 0.5 - 0.25);
        obj.scale.setScalar(Math.random() * 0.5 + 0.75);
        obj.updateMatrix();
      });

      // Step 7: LOD 1 - meshoptimizer simplified
      try {
        const LODGeo = await simplifyGeometriesByError(geometries, [0, 0.01]);
        if (isCancelled) {
          iMesh.dispose();
          return;
        }
        const mergedGeoLOD = mergeGeometries(LODGeo, true);
        const clonedMaterials = materials.map((m) => m.clone());
        iMesh.addLOD(mergedGeoLOD, clonedMaterials, lodDistances.mid);
      } catch (error) {
        console.error("OctahedralImpostorForest: LOD 1 failed:", error);
      }

      if (isCancelled) {
        iMesh.dispose();
        return;
      }

      // Step 8: LOD 2 - Octahedral impostor (FIXED with temp Scene + lights)
      try {
        const impostor = new OctahedralImpostorMesh({
          renderer: gl,
          target: scene,
          useHemiOctahedron: impostorSettings.useHemiOctahedron ?? true,
          transparent: leavesOpacity < 1,
          alphaClamp: impostorSettings.alphaClamp ?? 0.4,
          spritesPerSide: impostorSettings.spritesPerSide ?? 12,
          textureSize: impostorSettings.textureSize ?? 1024,
          baseType: THREE.MeshBasicMaterial,
        });

        iMesh.addLOD(impostor.geometry, impostor.material, lodDistances.far);
      } catch (error) {
        console.error("OctahedralImpostorForest: Impostor LOD failed:", error);
      }

      if (isCancelled) {
        iMesh.dispose();
        return;
      }

      // Step 9: Compute BVH for frustum culling
      iMesh.computeBVH();

      // Add to scene
      threeScene.add(iMesh);
      instancedMeshRef.current = iMesh;
    };

    setupForest();

    return () => {
      isCancelled = true;
      if (instancedMeshRef.current) {
        threeScene.remove(instancedMeshRef.current);
        instancedMeshRef.current.dispose();
        instancedMeshRef.current = null;
      } else if (createdMesh) {
        createdMesh.dispose();
      }
      createdMesh = null;
    };
  }, [
    scene,
    treeCount,
    centerPosition,
    minRadius,
    radius,
    terrainMesh,
    getTerrainHeight,
    lodDistances,
    impostorSettings,
    threeScene,
    gl,
    camera,
    leavesAlphaTest,
    leavesOpacity,
  ]);

  return null;
};

export default OctahedralImpostorForest;
