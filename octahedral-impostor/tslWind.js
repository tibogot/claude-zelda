import { Fn, uniform, float, vec2, vec3, fract, mul, add, sin, normalize } from "three/tsl";

export const uFrameOffset = uniform(float(0));
export const uWindTime = uniform(float(0));
export const uWindStrength = uniform(float(0.3));
export const uWindSpeed = uniform(float(1.0));
export const uWindDirection = uniform(vec2(1.0, 0.3));

export const IGN = Fn(([coord]) =>
  fract(
    mul(
      float(52.9829189),
      fract(
        add(
          add(mul(float(0.06711056), coord.x), mul(float(0.00583715), coord.y)),
          uFrameOffset,
        ),
      ),
    ),
  ),
);

export const windDisplacement = Fn(([worldPos, heightFactor, seedOffset]) => {
  const windDir = normalize(vec3(uWindDirection.x, 0, uWindDirection.y));
  const phase = add(mul(uWindTime, uWindSpeed), mul(seedOffset, 0.1));
  const wave1 = sin(add(phase, mul(worldPos.x, 0.5)));
  const wave2 = sin(add(mul(phase, 1.3), mul(worldPos.z, 0.4)));
  const wave3 = sin(
    add(mul(phase, 0.7), mul(add(worldPos.x, worldPos.z), 0.3)),
  );
  const combined = mul(add(wave1, add(mul(wave2, 0.5), mul(wave3, 0.3))), 0.55);
  const strength = mul(
    mul(combined, uWindStrength),
    mul(heightFactor, heightFactor),
  );
  return mul(windDir, strength);
});
