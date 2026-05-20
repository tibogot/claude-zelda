/**
 * WGSL port of Anderson Mancini lens flare fragment shader
 * (ektogamat/lensflare-threejs-vanilla — src/LensFlare.js)
 * For use with Three.js TSL wgslFn().
 */
export const WGSL_LENSFLARE_LIB = `
fn lf_rand(n: f32) -> f32 {
  return fract(sin(n) * 43758.5453123);
}

fn lf_noise(p: f32) -> f32 {
  let fl = floor(p);
  let fc = fract(p);
  return mix(lf_rand(fl), lf_rand(fl + 1.0), fc);
}

fn lf_hsv2rgb(c: vec3f) -> vec3f {
  let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3f(c.x) + k.xyz) * 6.0 - k.www);
  return c.z * mix(vec3f(k.x), clamp(p - vec3f(k.x), vec3f(0.0), vec3f(1.0)), c.y);
}

fn lf_saturate2(x: f32) -> f32 {
  return clamp(x, 0.0, 1.0);
}

fn lf_rotateUV(uv: vec2f, rotation: f32) -> vec2f {
  return vec2f(
    cos(rotation) * uv.x + sin(rotation) * uv.y,
    cos(rotation) * uv.y - sin(rotation) * uv.x
  );
}

fn lf_drawflare(
  p: vec2f,
  intensity: f32,
  rnd: f32,
  speed: f32,
  id: i32,
  uAnamorphic: f32,
  starPoints: f32,
  flareSpeed: f32,
  flareShape: f32,
  flareSize: f32,
) -> vec3f {
  let flarehueoffset = (1.0 / 32.0) * f32(id) * 0.1;
  let lingrad = length(vec2f(0.0) - p);
  let expgrad = 1.0 / exp(lingrad * (fract(rnd) * 0.66 + 0.33));
  var colgrad = lf_hsv2rgb(vec3f(
    fract((expgrad * 8.0) + speed * flareSpeed + flarehueoffset),
    pow(1.0 - abs(expgrad * 2.0 - 1.0), 0.45),
    20.0 * expgrad * intensity
  ));

  var internalStarPoints: f32;
  if (uAnamorphic > 0.5) {
    internalStarPoints = 1.0;
  } else {
    internalStarPoints = starPoints;
  }

  let blades = length(p * flareShape * sin(internalStarPoints * atan2(p.x, p.y)));
  // WGSL select() is (falseVal, trueVal, cond) — opposite arg order from GLSL ternary.
  // Original: pow(..., anamorphic ? 100.0 : 12.0).
  var comp = pow(1.0 - lf_saturate2(blades), select(12.0, 100.0, uAnamorphic > 0.5));
  comp += lf_saturate2(expgrad - 0.9) * 3.0;
  comp = pow(comp * expgrad, 8.0 + (1.0 - intensity) * 5.0);

  if (flareSpeed > 0.0) {
    return vec3f(comp) * colgrad;
  }
  return vec3f(comp) * flareSize * 15.0;
}

fn lf_glare(
  uv: vec2f,
  pos: vec2f,
  size: f32,
  iTime: f32,
  uAnimated: f32,
  uAnamorphic: f32,
  starPoints: f32,
) -> f32 {
  var mainv: vec2f;
  if (uAnimated > 0.5) {
    mainv = lf_rotateUV(uv - pos, iTime * 0.1);
  } else {
    mainv = uv - pos;
  }

  let ang = atan2(mainv.y, mainv.x) * select(1.0, starPoints, uAnamorphic > 0.5);
  var distv = length(mainv);
  distv = pow(distv, 0.9);

  let f0 = 1.0 / (length(uv - pos) * (1.0 / size * 16.0) + 0.2);
  return f0 + f0 * (sin(ang) * 0.2 + 0.3);
}

fn lf_sdHex(p: vec2f) -> f32 {
  var pv = abs(p);
  let q = vec2f(pv.x * 2.0 * 0.5773503, pv.y + pv.x * 0.5773503);
  return dot(step(q.xy, q.yx), vec2f(1.0) - q.yx);
}

fn lf_fpow(x: f32, k: f32) -> f32 {
  if (x > k) {
    return pow((x - k) / (1.0 - k), 2.0);
  }
  return 0.0;
}

fn lf_renderhex(uv: vec2f, p: vec2f, s: f32, col: vec3f) -> vec3f {
  let duv = uv - p;
  if (abs(duv.x) < 0.2 * s && abs(duv.y) < 0.2 * s) {
    return mix(
      vec3f(0.0),
      mix(vec3f(0.0), col, 0.1 + lf_fpow(length(duv / s), 0.1) * 10.0),
      smoothstep(0.0, 0.1, lf_sdHex(duv * 20.0 / s))
    );
  }
  return vec3f(0.0);
}

fn lf_LensFlare(
  uv: vec2f,
  pos: vec2f,
  iTime: f32,
  uAnimated: f32,
  uAnamorphic: f32,
  starPoints: f32,
  glareSize: f32,
  flareSize: f32,
  flareSpeed: f32,
  flareShape: f32,
) -> vec3f {
  let mainv = uv - pos;
  let uvd = uv * length(uv);

  let ang = atan2(mainv.x, mainv.y);
  var f0 = 0.3 / (length(uv - pos) * 16.0 + 1.0);
  f0 = f0 * (sin(lf_noise(sin(ang * 3.9 - select(0.0, iTime, uAnimated > 0.5) * 0.3) * starPoints)) * 0.2);

  let f1 = max(0.01 - pow(length(uv + 1.2 * pos), 1.9), 0.0) * 7.0;
  let f2 = max(0.9 / (10.0 + 32.0 * pow(length(uvd + 0.99 * pos), 2.0)), 0.0) * 0.35;
  let f22 = max(0.9 / (11.0 + 32.0 * pow(length(uvd + 0.85 * pos), 2.0)), 0.0) * 0.23;
  let f23 = max(0.9 / (12.0 + 32.0 * pow(length(uvd + 0.95 * pos), 2.0)), 0.0) * 0.6;

  var uvx = mix(uv, uvd, 0.1);
  let f4 = max(0.01 - pow(length(uvx + 0.4 * pos), 2.9), 0.0) * 4.02;
  let f42 = max(0.0 - pow(length(uvx + 0.45 * pos), 2.9), 0.0) * 4.1;
  let f43 = max(0.01 - pow(length(uvx + 0.5 * pos), 2.9), 0.0) * 4.6;

  uvx = mix(uv, uvd, -0.4);
  let f5 = max(0.01 - pow(length(uvx + 0.1 * pos), 5.5), 0.0) * 2.0;
  let f52 = max(0.01 - pow(length(uvx + 0.2 * pos), 5.5), 0.0) * 2.0;
  let f53 = max(0.01 - pow(length(uvx + 0.1 * pos), 5.5), 0.0) * 2.0;

  uvx = mix(uv, uvd, 2.1);
  let f6 = max(0.01 - pow(length(uvx - 0.3 * pos), 1.61), 0.0) * 3.159;
  let f62 = max(0.01 - pow(length(uvx - 0.325 * pos), 1.614), 0.0) * 3.14;
  let f63 = max(0.01 - pow(length(uvx - 0.389 * pos), 1.623), 0.0) * 3.12;

  var c = vec3f(lf_glare(uv, pos, glareSize, iTime, uAnimated, uAnamorphic, starPoints));

  var prot: vec2f;
  if (uAnimated > 0.5) {
    prot = lf_rotateUV(uv - pos, iTime * 0.1);
  } else if (uAnamorphic > 0.5) {
    prot = lf_rotateUV(uv - pos, 1.570796);
  } else {
    prot = uv - pos;
  }

  c += lf_drawflare(
    prot,
    select(flareSize, flareSize * 10.0, uAnamorphic > 0.5),
    0.1,
    iTime,
    1,
    uAnamorphic,
    starPoints,
    flareSpeed,
    flareShape,
    flareSize
  );

  c.r += f1 + f2 + f4 + f5 + f6;
  c.g += f1 + f22 + f42 + f52 + f62;
  c.b += f1 + f23 + f43 + f53 + f63;
  c = c * 1.3 * vec3f(length(uvd) + 0.09);
  c += vec3f(f0);
  return c;
}

fn lf_rnd2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.1234, 72.8392))) * 45123.2);
}

fn lf_rnd1(w: f32) -> f32 {
  return fract(sin(w) * 1000.0);
}

fn lf_regShape(p: vec2f, N: i32, ghostScale: f32) -> f32 {
  let a = atan2(p.x, p.y) + 0.2;
  let b = 6.28319 / f32(N);
  return smoothstep(0.5, 0.51, cos(floor(0.5 + a / b) * b - a) * length(p.xy) * 2.0 - ghostScale);
}

fn lf_circle(
  p: vec2f,
  size: f32,
  decay: f32,
  color: vec3f,
  color2: vec3f,
  dist: f32,
  mouse: vec2f,
  ghostScale: f32,
  colorGain: vec3f,
) -> vec3f {
  let l = length(p + mouse * (dist * 2.0)) + size / 2.0;
  let l2 = length(p + mouse * (dist * 4.0)) + size / 3.0;

  let c = max(0.04 - pow(length(p + mouse * dist), size * ghostScale), 0.0) * 10.0;
  let c1 = max(0.001 - pow(l - 0.3, 1.0 / 40.0) + sin(l * 20.0), 0.0) * 3.0;
  let c2 = max(0.09 / pow(length(p - mouse * dist / 0.5) * 1.0, 0.95), 0.0) / 20.0;
  let s = max(0.02 - pow(lf_regShape(p * 5.0 + mouse * dist * 5.0 + decay, 6, ghostScale), 1.0), 0.0) * 1.5;

  let col = cos(vec3f(colorGain) * 16.0 + dist / 8.0) * 0.5 + 0.5;
  var f = c * col;
  f += c1 * col;
  f += c2 * col;
  f += s * col;
  return f;
}

fn lf_getLensColor(x: f32) -> vec4f {
  return vec4f(
    mix(
      mix(
        mix(
          mix(
            mix(
              mix(
                mix(
                  mix(
                    mix(
                      mix(
                        mix(
                          mix(
                            mix(
                              mix(
                                mix(vec3f(0.0), vec3f(0.0), smoothstep(0.0, 0.063, x)),
                                vec3f(0.0),
                                smoothstep(0.063, 0.125, x)
                              ),
                              vec3f(0.0, 0.0, 0.0),
                              smoothstep(0.125, 0.188, x)
                            ),
                            vec3f(0.188, 0.131, 0.116),
                            smoothstep(0.188, 0.227, x)
                          ),
                          vec3f(0.31, 0.204, 0.537),
                          smoothstep(0.227, 0.251, x)
                        ),
                        vec3f(0.192, 0.106, 0.286),
                        smoothstep(0.251, 0.314, x)
                      ),
                      vec3f(0.102, 0.008, 0.341),
                      smoothstep(0.314, 0.392, x)
                    ),
                    vec3f(0.086, 0.0, 0.141),
                    smoothstep(0.392, 0.502, x)
                  ),
                  vec3f(1.0, 0.31, 0.0),
                  smoothstep(0.502, 0.604, x)
                ),
                vec3f(0.1, 0.1, 0.1),
                smoothstep(0.604, 0.643, x)
              ),
              vec3f(1.0, 0.929, 0.0),
              smoothstep(0.643, 0.761, x)
            ),
            vec3f(1.0, 0.086, 0.424),
            smoothstep(0.761, 0.847, x)
          ),
          vec3f(1.0, 0.49, 0.0),
          smoothstep(0.847, 0.89, x)
        ),
        vec3f(0.945, 0.275, 0.475),
        smoothstep(0.89, 0.941, x)
      ),
      vec3f(0.251, 0.275, 0.796),
      smoothstep(0.941, 1.0, x)
    ),
    1.0
  );
}

fn lf_dirtNoise(p: vec2f) -> f32 {
  var f = fract(p);
  f = (f * f) * (3.0 - (2.0 * f));
  let n = dot(floor(p), vec2f(1.0, 157.0));
  let a = fract(sin(vec4f(n + 0.0, n + 1.0, n + 157.0, n + 158.0)) * 43758.5453123);
  return mix(mix(a.x, a.y, f.x), mix(a.z, a.w, f.x), f.y);
}

fn lf_fbm(p: vec2f) -> f32 {
  const m = mat2x2f(0.80, -0.60, 0.60, 0.80);
  var fp = p;
  var f = 0.0;
  f += 0.5000 * lf_dirtNoise(fp);
  fp = m * fp * 2.02;
  f += 0.2500 * lf_dirtNoise(fp);
  fp = m * fp * 2.03;
  f += 0.1250 * lf_dirtNoise(fp);
  fp = m * fp * 2.01;
  f += 0.0625 * lf_dirtNoise(fp);
  return f / 0.9375;
}

fn lf_getLensStar(p: vec2f, haloScale: f32) -> vec4f {
  let pp = (p - vec2f(0.5)) * 2.0;
  let a = atan2(pp.y, pp.x);
  let cp = vec4f(sin(a * 1.0), length(pp), sin(a * 13.0), sin(a * 53.0));
  let d = sin(
    clamp(pow(length(vec2f(0.5) - p) * 0.5 + haloScale / 2.0, 5.0), 0.0, 1.0) * 3.14159
  );
  let c =
    vec3f(d) *
    vec3f(
      lf_fbm(cp.xy * 16.0) *
        lf_fbm(cp.zw * 9.0) *
        max(
          max(max(max(0.5, sin(a * 1.0)), sin(a * 3.0) * 0.8), sin(a * 7.0) * 0.8),
          sin(a * 9.0) * 10.6
        )
    );
  let mixed =
    mix(
      2.0,
      (sin(length(pp.xy) * 256.0) * 0.5) + 0.5,
      sin((clamp((length(pp.xy) - 0.875) / 0.1, 0.0, 1.0) + 0.0) * 2.0 * 3.14159) * 1.5
    ) + 0.5;
  return vec4f(vec3f(c * 1.0) * vec3f(mixed) * 0.3275, d);
}

fn lf_getLensDirt(p: vec2f) -> vec4f {
  var pv = p;
  pv = pv + vec2f(lf_fbm(pv.yx * 3.0), lf_fbm(pv.yx * 2.0)) * 0.0825;
  var o = vec3f(
    mix(
      0.125,
      0.25,
      max(
        max(smoothstep(0.1, 0.0, length(pv - vec2f(0.25))), smoothstep(0.4, 0.0, length(pv - vec2f(0.75)))),
        smoothstep(0.8, 0.0, length(pv - vec2f(0.875, 0.125)))
      )
    )
  );
  o += vec3f(max(lf_fbm(pv * 1.0) - 0.5, 0.0)) * 0.5;
  o += vec3f(max(lf_fbm(pv * 2.0) - 0.5, 0.0)) * 0.5;
  o += vec3f(max(lf_fbm(pv * 4.0) - 0.5, 0.0)) * 0.25;
  o += vec3f(max(lf_fbm(pv * 8.0) - 0.75, 0.0)) * 1.0;
  o += vec3f(max(lf_fbm(pv * 16.0) - 0.75, 0.0)) * 0.75;
  o += vec3f(max(lf_fbm(pv * 64.0) - 0.75, 0.0)) * 0.5;
  return vec4f(clamp(o, vec3f(0.15), vec3f(1.0)), 1.0);
}

fn lf_textureLimited(tex: texture_2d<f32>, samp: sampler, texCoord: vec2f) -> vec4f {
  if ((texCoord.x < 0.0) || (texCoord.y < 0.0) || (texCoord.x > 1.0) || (texCoord.y > 1.0)) {
    return vec4f(0.0);
  }
  return textureSample(tex, samp, texCoord);
}

fn lf_textureDistorted(
  tex: texture_2d<f32>,
  samp: sampler,
  texCoord: vec2f,
  direction: vec2f,
  distortion: vec3f,
) -> vec4f {
  return vec4f(
    lf_textureLimited(tex, samp, texCoord + direction * distortion.r).r,
    lf_textureLimited(tex, samp, texCoord + direction * distortion.g).g,
    lf_textureLimited(tex, samp, texCoord + direction * distortion.b).b,
    1.0
  );
}

fn lf_getStartBurst(
  vTexCoord: vec2f,
  lensPosition: vec2f,
  iResolution: vec2f,
  haloScale: f32,
  lensDirtTexture: texture_2d<f32>,
  lensDirtSampler: sampler,
) -> vec4f {
  let uDispersal = 0.3;
  let uHaloWidth = 0.6;
  let uDistortion = 1.5;

  let aspectTexCoord = vec2f(1.0) - (((vTexCoord - vec2f(0.5)) * vec2f(1.0)) + vec2f(0.5));
  let texCoord = vec2f(1.0) - vTexCoord;
  let ghostVec = (vec2f(0.5) - texCoord) * uDispersal - lensPosition;
  let ghostVecAspectNormalized = normalize(ghostVec * vec2f(1.0)) * vec2f(1.0);
  let haloVec = normalize(ghostVec) * uHaloWidth;
  let haloVecAspectNormalized = ghostVecAspectNormalized * uHaloWidth;
  let texelSize = vec2f(1.0) / iResolution;
  let distortion = vec3f(-(texelSize.x * uDistortion), 0.2, texelSize.x * uDistortion);
  var c = vec4f(0.0);
  for (var i = 0; i < 8; i++) {
    let offset = texCoord + (ghostVec * f32(i));
    c +=
      lf_textureDistorted(lensDirtTexture, lensDirtSampler, offset, ghostVecAspectNormalized, distortion) *
      pow(max(0.0, 1.0 - (length(vec2f(0.5) - offset) / length(vec2f(0.5)))), 10.0);
  }
  let haloOffset = texCoord + haloVecAspectNormalized;
  return (c * lf_getLensColor(length(vec2f(0.5) - aspectTexCoord) / length(vec2f(haloScale)))) +
    (lf_textureDistorted(lensDirtTexture, lensDirtSampler, haloOffset, ghostVecAspectNormalized, distortion) *
      pow(max(0.0, 1.0 - (length(vec2f(0.5) - haloOffset) / length(vec2f(0.5)))), 10.0));
}

fn lf_fragment_main(
  uv: vec2f,
  iTime: f32,
  opacity: f32,
  starPoints: f32,
  glareSize: f32,
  flareSize: f32,
  flareSpeed: f32,
  flareShape: f32,
  haloScale: f32,
  ghostScale: f32,
  iResolution: vec2f,
  lensPosition: vec2f,
  colorGain: vec3f,
  uAnimated: f32,
  uAnamorphic: f32,
  uEnabled: f32,
  uSecondaryGhosts: f32,
  uStarBurst: f32,
  uAditionalStreaks: f32,
  lensDirtTexture: texture_2d<f32>,
  lensDirtSampler: sampler,
) -> vec4f {
  if (uEnabled <= 0.5) {
    return vec4f(0.0);
  }

  var myUV = uv - 0.5;
  myUV.y *= iResolution.y / iResolution.x;
  var mouse = lensPosition * 0.5;
  mouse.y *= iResolution.y / iResolution.x;

  var finalColor =
    lf_LensFlare(myUV, mouse, iTime, uAnimated, uAnamorphic, starPoints, glareSize, flareSize, flareSpeed, flareShape) *
    20.0 *
    colorGain /
    256.0;

  if (uAditionalStreaks > 0.5) {
    let circColor = vec3f(0.9, 0.2, 0.1);
    let circColor2 = vec3f(0.3, 0.1, 0.9);
    for (var i = 0; i < 10; i++) {
      let fi = f32(i);
      finalColor += lf_circle(
        myUV,
        pow(lf_rnd1(fi * 2000.0) * 2.8, 0.1) + 1.41,
        0.0,
        circColor + vec3f(fi),
        circColor2 + vec3f(fi),
        lf_rnd1(fi * 20.0) * 3.0 + 0.2 - 0.5,
        lensPosition,
        ghostScale,
        colorGain
      );
    }
  }

  if (uSecondaryGhosts > 0.5) {
    var altGhosts = vec3f(0.1);
    altGhosts += lf_renderhex(myUV, -lensPosition * 0.25, ghostScale * 1.4, vec3f(0.03) * colorGain);
    altGhosts += lf_renderhex(myUV, lensPosition * 0.25, ghostScale * 0.5, vec3f(0.03) * colorGain);
    altGhosts += lf_renderhex(myUV, lensPosition * 0.1, ghostScale * 1.6, vec3f(0.03) * colorGain);
    altGhosts += lf_renderhex(myUV, lensPosition * 1.8, ghostScale * 2.0, vec3f(0.03) * colorGain);
    altGhosts += lf_renderhex(myUV, lensPosition * 1.25, ghostScale * 0.8, vec3f(0.03) * colorGain);
    altGhosts += lf_renderhex(myUV, -lensPosition * 1.25, ghostScale * 5.0, vec3f(0.03) * colorGain);
    altGhosts += lf_fpow(1.0 - abs(length(lensPosition * 0.8 - myUV) - 0.5), 0.985) * vec3f(0.1);
    altGhosts += lf_fpow(1.0 - abs(length(lensPosition * 0.4 - myUV) - 0.2), 0.994) * vec3f(0.05);
    finalColor += altGhosts;
  }

  if (uStarBurst > 0.5) {
    let uBrightDark = 0.5;
    let vTexCoord = myUV + 0.5;
    var lensMod = lf_getLensDirt(myUV);
    let tooBright = 1.0 - (clamp(uBrightDark, 0.0, 0.5) * 2.0);
    let tooDark = clamp(uBrightDark - 0.5, 0.0, 0.5) * 2.0;
    lensMod += mix(lensMod, pow(lensMod * 2.0, vec4f(2.0)) * 0.5, tooBright);
    let lensStarRotationAngle = (myUV.x + myUV.y) * (1.0 / 6.0);
    let lensStarTexCoord =
      mat2x2f(
        cos(lensStarRotationAngle),
        -sin(lensStarRotationAngle),
        sin(lensStarRotationAngle),
        cos(lensStarRotationAngle)
      ) * vTexCoord;
    lensMod += lf_getLensStar(lensStarTexCoord, haloScale) * 2.0;
    finalColor += clamp(lensMod.rgb * lf_getStartBurst(vTexCoord, lensPosition, iResolution, haloScale, lensDirtTexture, lensDirtSampler).rgb, vec3f(0.01), vec3f(1.0));
  }

  // Match the original GLSL: gl_FragColor = vec4(finalColor, mix(finalColor, -vec3(.15), 0.5) * opacity);
  // That's vec4(vec3, vec3) — WebGL/ANGLE keeps only the .x of the second vec3, so alpha
  // ends up driven by the red channel (~3× stronger than the channel-average we had before).
  let alpha = mix(finalColor, vec3f(-0.15), vec3f(0.5)).x * opacity;
  return vec4f(finalColor, alpha);
}
`;
