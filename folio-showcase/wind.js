/**
 * Folio Showcase — Wind (Bruno Simon style).
 * offsetNode(positionVec2) returns a vec2 for foliage UV animation.
 */
import { vec2, Fn, texture, uniform } from "three/tsl";

/**
 * @param {{ noiseTexture: THREE.Texture }} options
 * @returns {{ offsetNode: (position: import('three/tsl').Node) => import('three/tsl').Node, update: (delta: number) => void, direction: THREE.Vector2, strength: number }}
 */
export function createWind(options) {
  const { noiseTexture } = options;
  const angle = Math.PI * 0.6;
  const direction = uniform(vec2(Math.sin(angle), Math.cos(angle)));
  const positionFrequency = uniform(0.5);
  const strength = uniform(0.5);
  const localTime = uniform(0);
  const timeFrequency = 0.1;

  const offsetNode = Fn(([position]) => {
    const remapedPosition = position.mul(positionFrequency);
    const noiseUv1 = remapedPosition.xy.mul(0.2).add(direction.mul(localTime)).xy;
    const noise1 = texture(noiseTexture, noiseUv1).r.sub(0.5);
    const noiseUv2 = remapedPosition.xy.mul(0.1).add(direction.mul(localTime.mul(0.2))).xy;
    const noise2 = texture(noiseTexture, noiseUv2).r.sub(0.5);
    const intensity = noise2.add(noise1);
    return vec2(direction.mul(intensity).mul(strength));
  });

  function update(delta) {
    localTime.value += delta * timeFrequency * strength.value;
  }

  return {
    offsetNode,
    update,
    direction,
    strength,
    localTime,
  };
}
