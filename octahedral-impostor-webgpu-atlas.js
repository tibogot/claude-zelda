/**
 * WebGPU octahedral impostor atlas bake (shared by editor + forest).
 */
import * as THREE from "three";
import {
  texture,
  uv,
  float,
  mul,
  add,
  sub,
  vec4,
  normalWorld,
  positionView,
  negate,
  div,
  saturate,
} from "three/tsl";

export const BAKE_SPHERE_MARGIN = 1.08;

export function hemiOctaGridToDir(gx, gy, out) {
  out.set(gx - gy, 0, -1 + gx + gy);
  out.y = 1 - Math.abs(out.x) - Math.abs(out.z);
  return out.normalize();
}

export function fullOctaGridToDir(gx, gy, out) {
  const ox = gx * 2 - 1;
  const oz = gy * 2 - 1;
  const oy = 1 - Math.abs(ox) - Math.abs(oz);
  if (oy >= 0) {
    out.set(ox, oy, oz);
  } else {
    out.set(
      (1 - Math.abs(oz)) * (ox >= 0 ? 1 : -1),
      oy,
      (1 - Math.abs(ox)) * (oz >= 0 ? 1 : -1),
    );
  }
  return out.normalize();
}

export function generatePerCellMipmaps(pixels, atlasSize, grid) {
  const levels = [pixels];
  let prevSize = atlasSize;
  while (prevSize > 1) {
    const nextSize = prevSize >> 1;
    if (nextSize < 1) break;
    const prev = levels[levels.length - 1];
    const next = new Uint8Array(nextSize * nextSize * 4);
    const prevCellSize = prevSize / grid;
    const nextCellSize = nextSize / grid;

    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        const nx0 = Math.floor(col * nextCellSize);
        const ny0 = Math.floor(row * nextCellSize);
        const nw = Math.floor((col + 1) * nextCellSize) - nx0;
        const nh = Math.floor((row + 1) * nextCellSize) - ny0;

        for (let dy = 0; dy < nh; dy++) {
          for (let dx = 0; dx < nw; dx++) {
            const sx = Math.floor(col * prevCellSize) + dx * 2;
            const sy = Math.floor(row * prevCellSize) + dy * 2;
            const sxMax = Math.floor((col + 1) * prevCellSize) - 1;
            const syMax = Math.floor((row + 1) * prevCellSize) - 1;

            let r = 0,
              g = 0,
              b = 0,
              a = 0,
              cnt = 0;
            for (let oy = 0; oy < 2; oy++) {
              for (let ox = 0; ox < 2; ox++) {
                const px = Math.min(sx + ox, sxMax);
                const py = Math.min(sy + oy, syMax);
                const idx = (py * prevSize + px) * 4;
                const sa = prev[idx + 3];
                if (sa > 0) {
                  r += prev[idx] * sa;
                  g += prev[idx + 1] * sa;
                  b += prev[idx + 2] * sa;
                  a += sa;
                  cnt++;
                }
              }
            }
            const di = ((ny0 + dy) * nextSize + (nx0 + dx)) * 4;
            if (a > 0) {
              next[di] = Math.round(r / a);
              next[di + 1] = Math.round(g / a);
              next[di + 2] = Math.round(b / a);
              next[di + 3] = Math.round(a / Math.max(cnt, 1));
            }
          }
        }
      }
    }
    levels.push(next);
    prevSize = nextSize;
  }
  return levels;
}

export function makeTexWithMips(mipLevels, atlasSize, maxAniso, srgb) {
  const t = new THREE.DataTexture(
    mipLevels[0],
    atlasSize,
    atlasSize,
    THREE.RGBAFormat,
  );
  t.mipmaps = [];
  let sz = atlasSize;
  for (let i = 0; i < mipLevels.length; i++) {
    t.mipmaps.push({ data: mipLevels[i], width: sz, height: sz });
    sz >>= 1;
  }
  t.needsUpdate = true;
  t.flipY = false;
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

/**
 * @param {THREE.WebGPURenderer} renderer
 * @param {Array<{ geometry: THREE.BufferGeometry, material: THREE.Material }>} bakeMeshData
 * @param {{ grid: number, atlasSize: number, maxAniso: number, cellPad?: number }} opts
 */
export async function bakeAtlases(renderer, bakeMeshData, opts) {
  const { grid, atlasSize, maxAniso, cellPad = 2, fullOctahedral = false } = opts;
  const gridToDir = fullOctahedral ? fullOctaGridToDir : hemiOctaGridToDir;
  const cs = Math.floor(atlasSize / grid);
  const pad = cellPad;
  const innerCS = cs - pad * 2;

  const box = new THREE.Box3();
  for (const { geometry } of bakeMeshData) {
    geometry.computeBoundingBox();
    box.union(geometry.boundingBox);
  }
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = sphere.radius * BAKE_SPHERE_MARGIN;
  const center = sphere.center.clone();
  const half = radius;

  const ortho = new THREE.OrthographicCamera(
    -half,
    half,
    half,
    -half,
    0.001,
    radius * 4,
  );
  const dir = new THREE.Vector3();

  const colorScene = new THREE.Scene();
  const normalScene = new THREE.Scene();
  const rmScene = new THREE.Scene();
  const depthScene = new THREE.Scene();

  const BAKE_ALPHA = 0.05;
  const depthNear = radius;
  const depthSpan = 2 * radius;

  for (const { geometry, material } of bakeMeshData) {
    const hasAlpha = !!(material.map || material.alphaMap);

    const colorMat = new THREE.MeshBasicMaterial({
      color: material.color
        ? material.color.clone()
        : new THREE.Color(0xffffff),
      map: material.map || null,
      alphaTest: hasAlpha ? BAKE_ALPHA : 0,
      alphaMap: material.alphaMap || null,
      side: THREE.DoubleSide,
    });
    colorScene.add(new THREE.Mesh(geometry, colorMat));

    const alphaNode = material.map ? texture(material.map, uv()).a : float(1);
    const nMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(mul(add(normalWorld, 1), 0.5), alphaNode),
    });
    if (hasAlpha) nMat.alphaTest = BAKE_ALPHA;
    normalScene.add(new THREE.Mesh(geometry.clone(), nMat));

    const r = material.roughness !== undefined ? material.roughness : 0.5;
    const m = material.metalness !== undefined ? material.metalness : 0.0;
    let rNode = float(r);
    let mNode = float(m);
    if (material.roughnessMap)
      rNode = mul(texture(material.roughnessMap, uv()).g, float(r));
    if (material.metalnessMap)
      mNode = mul(texture(material.metalnessMap, uv()).b, float(m));

    const rmMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(rNode, mNode, float(0), alphaNode),
    });
    if (hasAlpha) rmMat.alphaTest = BAKE_ALPHA;
    rmScene.add(new THREE.Mesh(geometry.clone(), rmMat));

    const depthVal = saturate(
      div(sub(negate(positionView.z), float(depthNear)), float(depthSpan)),
    );
    const dMat = new THREE.MeshBasicNodeMaterial({
      side: THREE.DoubleSide,
      colorNode: vec4(depthVal, depthVal, depthVal, alphaNode),
    });
    if (hasAlpha) dMat.alphaTest = BAKE_ALPHA;
    depthScene.add(new THREE.Mesh(geometry.clone(), dMat));
  }

  const cellRT = new THREE.RenderTarget(innerCS, innerCS, {
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.LinearSRGBColorSpace,
  });

  const savedTM = renderer.toneMapping;
  const savedOCS = renderer.outputColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  await renderer.compileAsync(colorScene, ortho);
  await renderer.compileAsync(normalScene, ortho);
  await renderer.compileAsync(rmScene, ortho);
  await renderer.compileAsync(depthScene, ortho);

  const colorPixels = new Uint8Array(atlasSize * atlasSize * 4);
  const normalPixels = new Uint8Array(atlasSize * atlasSize * 4);
  const rmPixels = new Uint8Array(atlasSize * atlasSize * 4);
  const depthPixels = new Uint8Array(atlasSize * atlasSize * 4);

  const tightRow = innerCS * 4;
  const paddedRow = Math.ceil(tightRow / 256) * 256;

  const scenes = [
    [colorScene, colorPixels],
    [normalScene, normalPixels],
    [rmScene, rmPixels],
    [depthScene, depthPixels],
  ];

  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      gridToDir(gx / (grid - 1), gy / (grid - 1), dir);
      ortho.position.copy(center).addScaledVector(dir, radius * 2);
      ortho.lookAt(center);
      ortho.updateMatrixWorld(true);

      for (const [sc, dest] of scenes) {
        renderer.setRenderTarget(cellRT);
        renderer.autoClear = true;
        renderer.render(sc, ortho);

        const buf = await renderer.readRenderTargetPixelsAsync(
          cellRT,
          0,
          0,
          innerCS,
          innerCS,
        );
        const src = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        const srcStride =
          src.length > innerCS * innerCS * 4 ? paddedRow : tightRow;

        for (let row = 0; row < innerCS; row++) {
          const srcOff = (innerCS - 1 - row) * srcStride;
          const dy = gy * cs + pad + row;
          const dstOff = (dy * atlasSize + gx * cs + pad) * 4;
          dest.set(src.subarray(srcOff, srcOff + tightRow), dstOff);
        }
      }
    }
  }

  cellRT.dispose();
  renderer.setRenderTarget(null);
  renderer.autoClear = true;
  renderer.toneMapping = savedTM;
  renderer.outputColorSpace = savedOCS;

  const colorMips = generatePerCellMipmaps(colorPixels, atlasSize, grid);
  const normalMips = generatePerCellMipmaps(normalPixels, atlasSize, grid);
  const rmMips = generatePerCellMipmaps(rmPixels, atlasSize, grid);
  const depthMips = generatePerCellMipmaps(depthPixels, atlasSize, grid);

  return {
    colorTex: makeTexWithMips(colorMips, atlasSize, maxAniso, false),
    normalTex: makeTexWithMips(normalMips, atlasSize, maxAniso, false),
    rmTex: makeTexWithMips(rmMips, atlasSize, maxAniso, false),
    depthTex: makeTexWithMips(depthMips, atlasSize, maxAniso, false),
    radius,
    center,
    grid,
    atlasSize,
    cellPad: pad,
  };
}
