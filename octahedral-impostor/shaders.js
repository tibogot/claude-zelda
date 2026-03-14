export const ATLAS_VERT = /* glsl */ `#version 300 es
in vec3 position; in vec2 uv; in vec3 normal;
uniform mat4 modelViewMatrix, projectionMatrix, modelMatrix;
out vec2 vUv;
out vec3 vWorldNormal;
out vec3 vWorldPos;
void main() {
  vUv = uv;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

export const ATLAS_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map;
uniform float alphaTest;
uniform vec3 uMatColor;
uniform vec3 uSphereCenter;
uniform float uSphereRadius;
in vec2 vUv;
in vec3 vWorldNormal;
in vec3 vWorldPos;
out vec4 outColor;
void main() {
  vec4 c = texture(map, vUv);
  if (c.a < alphaTest) discard;
  c.rgb = pow(max(c.rgb, vec3(0.001)), vec3(2.2));
  c.rgb *= pow(max(uMatColor, vec3(0.001)), vec3(2.2));
  float baseY = uSphereCenter.y - uSphereRadius;
  float yNorm = clamp((vWorldPos.y - baseY) / (uSphereRadius * 0.8), 0.0, 1.0);
  float ao = mix(0.92, 1.0, yNorm);
  outColor = vec4(c.rgb * ao, c.a);
}`;

export const NORMAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map; uniform float alphaTest;
in vec2 vUv; in vec3 vWorldNormal;
out vec4 outColor;
void main() {
  if (texture(map, vUv).a < alphaTest) discard;
  outColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
}`;

export const AO_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map; uniform float alphaTest;
in vec2 vUv; in vec3 vWorldNormal;
out vec4 outColor;
void main() {
  if (texture(map, vUv).a < alphaTest) discard;
  float n = normalize(vWorldNormal).y;
  float ao = 0.5 + 0.5 * n;
  outColor = vec4(ao, ao, ao, 1.0);
}`;

export const ROUGHNESS_METAL_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D map;
uniform sampler2D uRoughnessMap;
uniform sampler2D uMetalnessMap;
uniform float alphaTest;
uniform float uRoughness;
uniform float uMetalness;
in vec2 vUv;
out vec4 outColor;
void main() {
  if (texture(map, vUv).a < alphaTest) discard;
  float r = uRoughness * texture(uRoughnessMap, vUv).g;
  float m = uMetalness * texture(uMetalnessMap, vUv).b;
  outColor = vec4(r, m, 0.0, 1.0);
}`;
