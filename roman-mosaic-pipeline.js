/**
 * Browser port of yobeatz/mosaic (Python) — Di Blasi / Beetz guideline mosaic.
 * https://github.com/yobeatz/mosaic
 *
 * Curved tesserae come from:
 *  1) EDT from edge map → parallel guidelines
 *  2) Ordered chains along those guidelines
 *  3) Quadrilateral tiles between rotated line segments (angle from EDT gradient)
 */

// ---------------------------------------------------------------------------
// Defaults (mosaic.py)
// ---------------------------------------------------------------------------

const MAX_PIXELS = 810000; // up to ~900×900 like Python

export const DEFAULT_PARAMS = {
  maxWidth: 500, // article coffee is ~400–500px wide
  halfTile: 2, // ~5–7k tiles at 500px (article half_tile=5 is on smaller photo + Shapely clip)
  /** When true, halfTile scales with maxWidth to keep ~similar tile count */
  lockTileDensity: true,
  densityRefWidth: 500,
  densityRefHalfTile: 2, // tuned for ~6000–8000 tesserae at 500px on portrait photos
  gauss: 3,
  edgeDetails: 4,
  edgeMode: "sobel", // Python article uses HED; Sobel is browser fallback
  withFrame: true,
  randSize: 0.3,
  maxAngle: 40,
  gapChainSpacing: 0.5, // mosaic.py
  gapFillStep: 1.0, // Python: step half_tile*2 along filler chains
  gapFillPasses: 2,
  gapTileExpand: 1.02, // Python buffer(0.1) on gap squares
  makeConvex: true,
  tileExpand: 1.05, // overlap before clip (Python Shapely keeps more area than convex clip)
  chainClipMinArea: 0.45, // skip a clip if it would shred the quad
  chainMaxClipNeighbors: 2, // sequential convex clip vs many neighbors was dropping ~70% of tiles
  preShrinkExpand: 1.0, // mortar only via irregularShrink (like Python)
  tileScaleMin: 0.85, // tiles.py irregular_shrink
  tileScaleMax: 1.0,
  mortarInset: 0.03, // tiles.py buffer(-0.03*half_tile)
  groutStroke: 0, // Python SVG has no extra stroke; grout = background between tiles
  minChainTileArea: 0.08,
  minGapTileArea: 0.05,
  dropTileThreshold: 0.02,
  seed: 0,
  backgroundBrightness: 0.2,
};

// ---------------------------------------------------------------------------
// Image I/O
// ---------------------------------------------------------------------------

export async function loadImageFromFile(file, maxWidth = 900) {
  const bitmap = await createImageBitmap(file);
  const { canvas, w, h } = resizeImageToCanvas(bitmap, maxWidth);
  bitmap.close();
  const rgba = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  return { rgba, w, h, canvas };
}

function createCanvas(w, h) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(w, h);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function resizeImageToCanvas(img, maxWidth) {
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (maxWidth && w > maxWidth) {
    const f = maxWidth / w;
    w = Math.round(w * f);
    h = Math.round(h * f);
  }
  if (w * h > MAX_PIXELS) {
    const f = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.max(1, Math.round(w * f));
    h = Math.max(1, Math.round(h * f));
  }
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, w, h };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Edges (edges.py)
// ---------------------------------------------------------------------------

function rgbToGray(rgba, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    g[i] =
      (rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114) / 255;
  }
  return g;
}

function equalizeHist(gray, w, h) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    hist[Math.min(255, (gray[i] * 255) | 0)]++;
  }
  const cdf = new Uint32Array(256);
  cdf[0] = hist[0];
  for (let i = 1; i < 256; i++) cdf[i] = cdf[i - 1] + hist[i];
  const cdfMin = cdf.find((v) => v > 0) ?? 0;
  const out = new Float32Array(gray.length);
  const scale = 255 / (gray.length - cdfMin);
  for (let i = 0; i < gray.length; i++) {
    const b = Math.min(255, (gray[i] * 255) | 0);
    out[i] = ((cdf[b] - cdfMin) * scale) / 255;
  }
  return out;
}

function gaussianSeparable(src, w, h, sigma, truncate) {
  const radius = Math.max(1, Math.ceil(sigma * truncate));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = Math.min(w - 1, Math.max(0, x + k));
        v += src[y * w + xx] * kernel[k + radius];
      }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = Math.min(h - 1, Math.max(0, y + k));
        v += tmp[yy * w + x] * kernel[k + radius];
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

function laplace3x3(src, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = src[y * w + x];
      const v =
        -4 * c +
        src[y * w + (x - 1)] +
        src[y * w + (x + 1)] +
        src[(y - 1) * w + x] +
        src[(y + 1) * w + x];
      out[y * w + x] = v;
    }
  }
  return out;
}

function skeletonize(binary, w, h) {
  const img = binary.slice();
  const toRemove = [];

  const readNeighbors = (x, y) => {
    const p2 = img[(y - 1) * w + x] ? 1 : 0;
    const p3 = img[(y - 1) * w + x + 1] ? 1 : 0;
    const p4 = img[y * w + x + 1] ? 1 : 0;
    const p5 = img[(y + 1) * w + x + 1] ? 1 : 0;
    const p6 = img[(y + 1) * w + x] ? 1 : 0;
    const p7 = img[(y + 1) * w + x - 1] ? 1 : 0;
    const p8 = img[y * w + x - 1] ? 1 : 0;
    const p9 = img[(y - 1) * w + x - 1] ? 1 : 0;
    const n = [p2, p3, p4, p5, p6, p7, p8, p9];
    const count = n.reduce((s, v) => s + v, 0);
    let transitions = 0;
    const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
    for (let i = 0; i < 8; i++) {
      if (!seq[i] && seq[i + 1]) transitions++;
    }
    return { count, transitions, p2, p4, p6, p8 };
  };

  let changed = true;
  let iter = 0;
  while (changed && iter++ < 128) {
    changed = false;
    toRemove.length = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!img[i]) continue;
        const { count, transitions, p2, p4, p6, p8 } = readNeighbors(x, y);
        if (count < 2 || count > 6 || transitions !== 1) continue;
        if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        toRemove.push(i);
      }
    }
    if (toRemove.length) {
      changed = true;
      for (const i of toRemove) img[i] = 0;
    }

    toRemove.length = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!img[i]) continue;
        const { count, transitions, p2, p4, p6, p8 } = readNeighbors(x, y);
        if (count < 2 || count > 6 || transitions !== 1) continue;
        if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue;
        toRemove.push(i);
      }
    }
    if (toRemove.length) {
      changed = true;
      for (const i of toRemove) img[i] = 0;
    }
  }
  return img;
}

export function edgesDiblasi(rgba, w, h, gauss = 3, details = 4) {
  let gray = rgbToGray(rgba, w, h);
  gray = equalizeHist(gray, w, h);
  const sigma = 16;
  const truncate = Math.max(0.25, gauss / 16);
  const blurred = gaussianSeparable(gray, w, h, sigma, truncate);

  let mean = 0;
  for (let i = 0; i < blurred.length; i++) mean += blurred[i];
  mean /= blurred.length;
  let variance = 0;
  for (let i = 0; i < blurred.length; i++) {
    const d = blurred[i] - mean;
    variance += d * d;
  }
  const threshold = (variance / 4) * 2 * details;

  const seg = new Uint8Array(w * h);
  for (let i = 0; i < blurred.length; i++) {
    seg[i] = Math.abs(blurred[i] - mean) > threshold ? 0 : 1;
  }

  const lap = laplace3x3(seg, w, h);
  const edges = new Uint8Array(w * h);
  for (let i = 0; i < lap.length; i++) edges[i] = lap[i] !== 0 ? 1 : 0;
  return edges;
}

export function edgesSobel(rgba, w, h, gauss = 3) {
  let gray = rgbToGray(rgba, w, h);
  if (gauss > 0) {
    const sigma = 16;
    const truncate = Math.max(0.25, gauss / 16);
    gray = gaussianSeparable(gray, w, h, sigma, truncate);
  }
  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx =
        -gray[(y - 1) * w + (x - 1)] +
        gray[(y - 1) * w + (x + 1)] -
        2 * gray[y * w + (x - 1)] +
        2 * gray[y * w + (x + 1)] -
        gray[(y + 1) * w + (x - 1)] +
        gray[(y + 1) * w + (x + 1)];
      const gy =
        -gray[(y - 1) * w + (x - 1)] -
        2 * gray[(y - 1) * w + x] -
        gray[(y - 1) * w + (x + 1)] +
        gray[(y + 1) * w + (x - 1)] +
        2 * gray[(y + 1) * w + x] +
        gray[(y + 1) * w + (x + 1)];
      mag[y * w + x] = Math.hypot(gx, gy);
    }
  }
  const hist = new Uint32Array(256);
  let maxMag = 0;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] <= 0) continue;
    if (mag[i] > maxMag) maxMag = mag[i];
  }
  let t = 0;
  if (maxMag > 0) {
    for (let i = 0; i < mag.length; i++) {
      if (mag[i] <= 0) continue;
      const b = Math.min(255, Math.floor((mag[i] / maxMag) * 255));
      hist[b]++;
    }
    const target = Math.max(1, Math.floor(mag.length * 0.18));
    let cum = 0;
    for (let b = 255; b >= 0; b--) {
      cum += hist[b];
      if (cum >= target) {
        t = (b / 255) * maxMag;
        break;
      }
    }
  }
  const edges = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i++) edges[i] = mag[i] > t ? 1 : 0;
  return skeletonize(edges, w, h);
}

/** Python random.seed(0) */
export function seededRandom(seed = 0) {
  let s = (Math.abs(seed) | 0) % 2147483646 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function addFrame(edges, w, h) {
  for (let x = 0; x < w; x++) {
    edges[x] = 1;
    edges[(h - 1) * w + x] = 1;
  }
  for (let y = 0; y < h; y++) {
    edges[y * w] = 1;
    edges[y * w + (w - 1)] = 1;
  }
}

// ---------------------------------------------------------------------------
// Euclidean distance transform (scipy distance_transform_edt on ~edges)
// ---------------------------------------------------------------------------

/** Distance to nearest edge pixel (scipy distance_transform_edt on non-edge mask). */
function distanceTransformEdt(imgEdges, w, h) {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < imgEdges.length; i++) {
    d[i] = imgEdges[i] ? 0 : INF;
  }
  const diag = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 1);
      if (y > 0) d[i] = Math.min(d[i], d[i - w] + 1);
      if (x > 0 && y > 0) d[i] = Math.min(d[i], d[i - w - 1] + diag);
      if (x < w - 1 && y > 0) d[i] = Math.min(d[i], d[i - w + 1] + diag);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i], d[i + 1] + 1);
      if (y < h - 1) d[i] = Math.min(d[i], d[i + w] + 1);
      if (x < w - 1 && y < h - 1) d[i] = Math.min(d[i], d[i + w + 1] + diag);
      if (x > 0 && y < h - 1) d[i] = Math.min(d[i], d[i + w - 1] + diag);
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Guides (guides.py)
// ---------------------------------------------------------------------------

const CHAIN_NEIGHBORS = [
  [1, 0],
  [-1, 0],
  [1, -1],
  [-1, 1],
  [0, -1],
  [0, 1],
  [-1, -1],
  [1, 1],
];

/** Walk one guideline chain; prefer continuing direction (smooth curved rows). */
function walkGuidelineChain(pixel, w, h, startY, startX) {
  let y = startY;
  let x = startX;
  let prevDx = 0;
  let prevDy = 0;
  const subchain = [];

  while (true) {
    subchain.push([y, x]);
    pixel[y * w + x] = 0;

    const candidates = [];
    for (const [dx, dy] of CHAIN_NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && pixel[ny * w + nx]) {
        candidates.push([dx, dy, nx, ny]);
      }
    }
    if (!candidates.length) break;

    let pick = candidates[0];
    if (prevDx !== 0 || prevDy !== 0) {
      let bestDot = -Infinity;
      for (const c of candidates) {
        const dot = c[0] * prevDx + c[1] * prevDy;
        if (dot > bestDot) {
          bestDot = dot;
          pick = c;
        }
      }
    }

    prevDx = pick[0];
    prevDy = pick[1];
    x = pick[2];
    y = pick[3];
  }
  return subchain;
}

/**
 * Python guides.pixellines_to_ordered_points: label skeleton components, then
 * ordered chains so tiles follow curved EDT guidelines (rounded contour rows).
 */
function pixellinesToOrderedPoints(matrix, w, h, halfTile) {
  const skel = skeletonize(matrix.slice(), w, h);
  const labels = new Int32Array(w * h);
  const components = [];
  let labelId = 0;

  for (let i = 0; i < skel.length; i++) {
    if (!skel[i] || labels[i]) continue;
    labelId++;
    const pixels = [];
    const stack = [i];
    labels[i] = labelId;
    while (stack.length) {
      const idx = stack.pop();
      pixels.push(idx);
      const x = idx % w;
      const y = (idx / w) | 0;
      for (const [dx, dy] of CHAIN_NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (skel[ni] && !labels[ni]) {
          labels[ni] = labelId;
          stack.push(ni);
        }
      }
    }
    components.push(pixels);
  }

  const chains = [];
  const minLen = Math.max(2, (halfTile / 2) | 0);

  for (const compPixels of components) {
    const pixel = new Uint8Array(w * h);
    for (const idx of compPixels) pixel[idx] = 1;

    // O(component size): never rescan the whole component each chain (was freezing)
    for (let qi = 0; qi < compPixels.length; qi++) {
      const idx = compPixels[qi];
      if (!pixel[idx]) continue;
      const sx = idx % w;
      const sy = (idx / w) | 0;
      const subchain = walkGuidelineChain(pixel, w, h, sy, sx);
      if (subchain.length > minLen) chains.push(subchain);
    }
  }
  return chains;
}

export function chainsAndAngles(imgEdges, w, h, halfTile) {
  const distances = distanceTransformEdt(imgEdges, w, h);

  const guidelines = new Uint8Array(w * h);
  const period = 2 * halfTile;
  for (let i = 0; i < distances.length; i++) {
    if ((Math.floor(distances[i]) + halfTile) % period === 0) guidelines[i] = 1;
  }

  const chains = pixellinesToOrderedPoints(guidelines, w, h, halfTile);

  const angles = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const num = distances[y * w + (x + 1)] - distances[y * w + (x - 1)];
      const den = distances[(y + 1) * w + x] - distances[(y - 1) * w + x];
      let g = Math.atan2(num, den);
      angles[y * w + x] = ((g * 180) / Math.PI + 180) % 180;
    }
  }

  return { chains, angles, distances, guidelines };
}

export function chainsIntoGaps(polygons, w, h, halfTile, chainSpacing) {
  const occupied = rasterizePolygons(polygons, w, h);
  const distanceToTile = distanceTransformEdt(occupied, w, h);
  // occupied is 1 where tile exists; EDT expects 1 at seeds

  let spacing = Math.round(halfTile * chainSpacing);
  if (spacing <= 1) spacing = 2;

  const guidelines2 = new Uint8Array(w * h);
  for (let i = 0; i < distanceToTile.length; i++) {
    const d = Math.floor(distanceToTile[i]);
    if (d === 1 || (d > 0 && d % spacing === 0)) guidelines2[i] = 1;
  }

  return pixellinesToOrderedPoints(guidelines2, w, h, halfTile);
}

function rasterizePolygons(polygons, w, h) {
  const grid = new Uint8Array(w * h);
  for (const poly of polygons) {
    const pts = openRing(poly.exterior);
    if (pts.length < 3) continue;
    let minY = h,
      maxY = 0;
    for (let pi = 0; pi < pts.length; pi++) {
      const py = pts[pi][1];
      minY = Math.min(minY, Math.max(0, Math.floor(py)));
      maxY = Math.max(maxY, Math.min(h - 1, Math.ceil(py)));
    }
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const yi = pts[i][1],
          yj = pts[j][1];
        if ((yi <= y && yj > y) || (yj <= y && yi > y)) {
          xs.push(
            pts[i][0] +
              ((y - yi) * (pts[j][0] - pts[i][0])) / (yj - yi + 1e-12),
          );
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k < xs.length; k += 2) {
        const x0 = Math.max(0, Math.ceil(xs[k]));
        const x1 = Math.min(w - 1, Math.floor(xs[k + 1] ?? xs[k]));
        for (let x = x0; x <= x1; x++) grid[y * w + x] = 1;
      }
    }
  }
  return grid;
}

// ---------------------------------------------------------------------------
// Geometry helpers (tiles.py)
// ---------------------------------------------------------------------------

function verticalLine(col, row, halfTile) {
  return [
    [col, row - halfTile],
    [col, row + halfTile],
  ];
}

/** Gap / chain tile quad rotated like mosaic.py affinity.rotate(-angle). */
function rotatedSquareRing(col, row, halfTile, angleDeg) {
  const corners = [
    [col - halfTile, row + halfTile],
    [col + halfTile, row + halfTile],
    [col + halfTile, row - halfTile],
    [col - halfTile, row - halfTile],
  ];
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const pts = corners.map(([px, py]) => {
    const dx = px - col;
    const dy = py - row;
    return [col + dx * cos - dy * sin, row + dx * sin + dy * cos];
  });
  return closeRing(pts);
}

function rotateLine(line, angleDeg, cx, cy) {
  const rad = (-angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return line.map(([px, py]) => {
    const dx = px - cx;
    const dy = py - cy;
    return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
  });
}

function signedAreaPts(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a * 0.5;
}

function ensureCCWRing(ring) {
  const pts = openRing(ring);
  if (pts.length < 3) return closeRing(pts);
  if (signedAreaPts(pts) < 0) pts.reverse();
  return closeRing(pts);
}

function convexQuadFromLines(lineA, lineB) {
  const pts = [...lineA, ...lineB];
  const hull = convexHull(pts);
  if (hull.length < 3) return { exterior: [], area: 0 };
  const closed = ensureCCWRing([...hull, hull[0]]);
  return { exterior: closed, area: polygonArea(closed) };
}

function scalePolygonAboutCentroid(p, factor) {
  const [cx, cy] = representativePoint(p);
  const pts = openRing(p.exterior).map(([x, y]) => [
    cx + (x - cx) * factor,
    cy + (y - cy) * factor,
  ]);
  const closed = ensureCCWRing([...pts, pts[0]]);
  return { exterior: closed, area: polygonArea(closed) };
}

function convexHull(points) {
  const pts = [];
  for (const p of points) {
    if (!pts.length || pts[pts.length - 1][0] !== p[0] || pts[pts.length - 1][1] !== p[1]) {
      pts.push(p);
    }
  }
  if (pts.length <= 2) return pts;
  pts.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] - b[0]));
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Normalize exterior to open ring of [x, y] pairs (handles accidental flat arrays). */
function toPointRing(ring) {
  if (!ring?.length) return [];
  if (Array.isArray(ring[0]) && typeof ring[0][0] === "number") {
    const closed =
      ring.length > 1 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1];
    return closed ? ring.slice(0, -1) : ring.slice();
  }
  if (typeof ring[0] === "number") {
    const pts = [];
    const n = ring.length;
    const closed = n >= 4 && ring[0] === ring[n - 2] && ring[1] === ring[n - 1];
    const lim = closed ? n - 2 : n;
    for (let i = 0; i + 1 < lim; i += 2) pts.push([ring[i], ring[i + 1]]);
    return pts;
  }
  return [];
}

function closeRing(pts) {
  if (!pts.length) return [];
  return [...pts, pts[0]];
}

function polygonArea(ring) {
  const pts = toPointRing(ring);
  if (pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) * 0.5;
}

function openRing(ring) {
  return toPointRing(ring);
}

function pointInPolygon(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1];
    const xj = ring[j][0],
      yj = ring[j][1];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a, b, c, d) {
  const cross = (p, q, r) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function polygonsOverlap(a, b) {
  const ra = openRing(a.exterior);
  const rb = openRing(b.exterior);
  for (let i = 0; i < ra.length; i++) {
    if (pointInPolygon(ra[i][0], ra[i][1], rb)) return true;
  }
  for (let i = 0; i < rb.length; i++) {
    if (pointInPolygon(rb[i][0], rb[i][1], ra)) return true;
  }
  for (let i = 0; i < ra.length; i++) {
    const a0 = ra[i];
    const a1 = ra[(i + 1) % ra.length];
    for (let j = 0; j < rb.length; j++) {
      if (segmentsIntersect(a0, a1, rb[j], rb[(j + 1) % rb.length])) return true;
    }
  }
  return false;
}

function cross2(a, b, p) {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
}

function lineIntersect(a, b, p, q) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [q[0] - p[0], q[1] - p[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p[0] - a[0]) * s[1] - (p[1] - a[1]) * s[0]) / den;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

function clipToOutsideHalfPlane(poly, a, b) {
  if (!poly.length) return [];
  const inside = (pt) => cross2(a, b, pt) > 1e-9;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pin = inside(p);
    const qin = inside(q);
    if (!pin) out.push(p);
    if (pin !== qin) {
      const hit = lineIntersect(a, b, p, q);
      if (hit) out.push(hit);
    }
  }
  return out;
}

/** Sutherland–Hodgman clip to axis-aligned rectangle (image bounds). */
function clipToInsideHalfPlane(poly, a, b) {
  if (!poly.length) return [];
  const inside = (pt) => cross2(a, b, pt) > 1e-9;
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const pin = inside(p);
    const qin = inside(q);
    if (pin) out.push(p);
    if (pin !== qin) {
      const hit = lineIntersect(a, b, p, q);
      if (hit) out.push(hit);
    }
  }
  return out;
}

function clipPolygonToImage(poly, w, h) {
  let ring = openRing(poly.exterior);
  if (ring.length < 3) return null;
  ring = clipToInsideHalfPlane(ring, [0, h], [0, 0]);
  ring = clipToInsideHalfPlane(ring, [w, 0], [w, h]);
  ring = clipToInsideHalfPlane(ring, [0, 0], [w, 0]);
  ring = clipToInsideHalfPlane(ring, [w, h], [0, h]);
  if (ring.length < 3) return null;
  const closed = closeRing(ring);
  return { exterior: closed, area: polygonArea(closed) };
}

function polygonDifferenceConvex(subject, clip) {
  let ring = openRing(ensureCCWRing(subject.exterior));
  const clipRing = openRing(ensureCCWRing(clip.exterior));
  if (clipRing.length < 3) return subject;
  for (let i = 0; i < clipRing.length; i++) {
    const a = clipRing[i];
    const b = clipRing[(i + 1) % clipRing.length];
    ring = clipToOutsideHalfPlane(ring, a, b);
    if (ring.length < 3) return null;
  }
  const closed = closeRing(ring);
  return { exterior: closed, area: polygonArea(closed) };
}

function centroidDist2(a, b) {
  const [ax, ay] = representativePoint(a);
  const [bx, by] = representativePoint(b);
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/** Chain tiles: convex clip approximates Shapely difference — skip harsh clips, not whole tiles. */
function fitInPolygonForChains(
  p,
  nearby,
  minAreaFraction = 0.45,
  maxNeighbors = 2,
) {
  const origArea = p.area;
  if (maxNeighbors <= 0 || !nearby.length) return p;

  const overlapping = nearby
    .filter((other) => !disjointApprox(p, other) && polygonsOverlap(p, other))
    .sort((a, b) => centroidDist2(p, a) - centroidDist2(p, b))
    .slice(0, maxNeighbors);

  let current = p;
  for (const other of overlapping) {
    if (disjointApprox(current, other)) continue;
    if (!polygonsOverlap(current, other)) continue;
    const clipped = polygonDifferenceConvex(current, other);
    if (!clipped || clipped.area < 1e-6) return null;
    if (clipped.area < minAreaFraction * origArea) continue;
    current = clipped;
  }
  return current.area >= minAreaFraction * origArea * 0.85 ? current : null;
}

function fitInPolygon(p, nearby) {
  let current = p;
  for (const other of nearby) {
    if (disjointApprox(current, other)) continue;
    if (!polygonsOverlap(current, other)) continue;
    const clipped = polygonDifferenceConvex(current, other);
    if (!clipped || clipped.area < 1e-6) return null;
    current = clipped;
  }
  return current;
}

function lineBufferBBox(chain, halfTile) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [row, col] of chain) {
    minX = Math.min(minX, col);
    minY = Math.min(minY, row);
    maxX = Math.max(maxX, col);
    maxY = Math.max(maxY, row);
  }
  const pad = 2.1 * halfTile;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function bboxOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function polyBBox(poly) {
  const ring = openRing(poly.exterior);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const x = ring[i][0];
    const y = ring[i][1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

function disjointApprox(a, b) {
  const ba = polyBBox(a);
  const bb = polyBBox(b);
  return !bboxOverlap(ba, bb);
}

/** Spatial hash so tile overlap checks stay O(1) per candidate, not O(all tiles). */
class PolySpatialIndex {
  constructor(cellSize, w, h) {
    this.cell = Math.max(8, cellSize);
    this.w = w;
    this.h = h;
    this.cols = Math.ceil(w / this.cell);
    this.rows = Math.ceil(h / this.cell);
    this.buckets = new Map();
    this.items = [];
  }

  key(cx, cy) {
    const x = Math.max(0, Math.min(this.cols - 1, (cx / this.cell) | 0));
    const y = Math.max(0, Math.min(this.rows - 1, (cy / this.cell) | 0));
    return y * this.cols + x;
  }

  insert(poly) {
    const id = this.items.length;
    this.items.push(poly);
    const bb = polyBBox(poly);
    const x0 = Math.max(0, ((bb.minX / this.cell) | 0) - 1);
    const x1 = Math.min(this.cols - 1, ((bb.maxX / this.cell) | 0) + 1);
    const y0 = Math.max(0, ((bb.minY / this.cell) | 0) - 1);
    const y1 = Math.min(this.rows - 1, ((bb.maxY / this.cell) | 0) + 1);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const k = cy * this.cols + cx;
        let bucket = this.buckets.get(k);
        if (!bucket) {
          bucket = [];
          this.buckets.set(k, bucket);
        }
        bucket.push(id);
      }
    }
    return id;
  }

  queryBBox(bbox) {
    const x0 = Math.max(0, ((bbox.minX / this.cell) | 0) - 1);
    const x1 = Math.min(this.cols - 1, ((bbox.maxX / this.cell) | 0) + 1);
    const y0 = Math.max(0, ((bbox.minY / this.cell) | 0) - 1);
    const y1 = Math.min(this.rows - 1, ((bbox.maxY / this.cell) | 0) + 1);
    const seen = new Set();
    const out = [];
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const bucket = this.buckets.get(cy * this.cols + cx);
        if (!bucket) continue;
        for (const id of bucket) {
          if (seen.has(id)) continue;
          seen.add(id);
          const poly = this.items[id];
          if (bboxOverlap(polyBBox(poly), bbox)) out.push(poly);
        }
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Tiles (tiles.py)
// ---------------------------------------------------------------------------

export function placeTilesAlongChains(
  chains,
  angles,
  w,
  h,
  halfTile,
  randSize,
  maxAngle,
  A0,
  minAreaRatio = 0.08,
  tileExpand = 1,
  rng = Math.random,
  chainClipMinArea = 0.55,
  chainMaxClipNeighbors = 5,
) {
  const randExtra = Math.round(halfTile * randSize);
  const deltaI = halfTile * 2;
  const polygons = [];
  const spatial = new PolySpatialIndex(halfTile * 4, w, h);

  for (const chain of chains) {
    const bbox = lineBufferBBox(chain, halfTile);
    const nearbyPre = spatial.queryBBox(bbox);

    let lineStart = null;
    let winkelStart = 0;
    let iStart = 0;
    let randI = Math.floor(rng() * (2 * randExtra + 1)) - randExtra;

    for (let i = 0; i < chain.length; i++) {
      const [row, col] = chain[i];
      const winkel = angles[row * w + col];

      if (i === 0) {
        iStart = i;
        randI = Math.floor(rng() * (2 * randExtra + 1)) - randExtra;
        winkelStart = winkel;
        lineStart = rotateLine(verticalLine(col, row, halfTile), winkelStart, col, row);
      }

      let drawPolygon = false;
      if (i === chain.length - 1) {
        drawPolygon = true;
      } else {
        const [rowN, colN] = chain[i + 1];
        const winkelNext = angles[rowN * w + colN];
        let winkelDelta = winkelNext - winkelStart;
        winkelDelta = Math.min(180 - Math.abs(winkelDelta), Math.abs(winkelDelta));
        if (winkelDelta > maxAngle) drawPolygon = true;
        if (i - iStart === deltaI + randI) drawPolygon = true;
      }

      if (drawPolygon) {
        const lineEnd = rotateLine(verticalLine(col, row, halfTile), winkel, col, row);
        let p = convexQuadFromLines(lineStart, lineEnd);

        lineStart = lineEnd;
        winkelStart = winkel;

        if (i - iStart <= 2) {
          iStart = i;
          continue;
        }
        iStart = i;
        randI = Math.floor(rng() * (2 * randExtra + 1)) - randExtra;

        if (tileExpand > 1) p = scalePolygonAboutCentroid(p, tileExpand);
        const nearby = nearbyPre.filter((poly) => !disjointApprox(p, poly));
        p = fitInPolygonForChains(p, nearby, chainClipMinArea, chainMaxClipNeighbors);
        if (!p) continue;
        if (p.area >= minAreaRatio * A0 && p.exterior.length >= 4) {
          polygons.push(p);
          spatial.insert(p);
          nearbyPre.push(p);
        }
      }
    }
  }
  return polygons;
}

export function placeTilesIntoGaps(
  polygons,
  fillerChains,
  angles,
  w,
  h,
  halfTile,
  A0,
  spatial = null,
  minAreaRatio = 0.05,
  fillStep = 1,
  gapTileExpand = 1,
  onProgress = null,
) {
  let counter = 0;
  const maxClipNeighbors = 8;
  if (!spatial) {
    spatial = new PolySpatialIndex(halfTile * 4, w, h);
    for (const p of polygons) spatial.insert(p);
  }
  let chainIdx = 0;
  for (const chain of fillerChains) {
    chainIdx++;
    if (onProgress && (chainIdx & 63) === 0) {
      onProgress(`Gap tiles… chain ${chainIdx}/${fillerChains.length}`);
    }

    const bbox = lineBufferBBox(chain, halfTile);
    const nearbyPre = spatial.queryBBox(bbox);

    const step = Math.max(1, Math.round(halfTile * 2 * fillStep));
    const indexList = [];
    for (let i = 0; i < chain.length; i += step) indexList.push(i);
    const lastI = chain.length - 1;
    if (indexList[indexList.length - 1] !== lastI && lastI - indexList[indexList.length - 1] >= 3) {
      indexList.push(lastI);
    }

    for (const i of indexList) {
      const [row, col] = chain[i];
      const angle = angles[row * w + col] ?? 0;
      const ring = rotatedSquareRing(col, row, halfTile, angle);
      let p = { exterior: ring, area: polygonArea(ring) };

      if (gapTileExpand > 1) p = scalePolygonAboutCentroid(p, gapTileExpand);
      const nearby = nearbyPre.filter((poly) => !disjointApprox(p, poly));
      if (nearby.length === 0) {
        if (p.area >= minAreaRatio * A0) {
          polygons.push(p);
          spatial.insert(p);
          nearbyPre.push(p);
          counter++;
        }
        continue;
      }
      if (nearby.length > maxClipNeighbors) continue;
      p = fitInPolygon(p, nearby);
      if (!p) continue;
      if (p.area >= minAreaRatio * A0) {
        polygons.push(p);
        spatial.insert(p);
        nearbyPre.push(p);
        counter++;
      }
    }
  }
  return { polygons, counter };
}

export function cutTilesOutsideFrame(polygons, halfTile, w, h, A0) {
  const out = [];
  const margin = 4 * halfTile;
  for (const p of polygons) {
    const [cx, cy] = representativePoint(p);
    let poly = p;
    if (cy < margin || cy > h - margin || cx < margin || cx > w - margin) {
      poly = clipPolygonToImage(p, w, h);
      if (!poly) continue;
    }
    if (poly.area >= 0.05 * A0) out.push(poly);
  }
  return out;
}

export function irregularShrink(
  polygons,
  halfTile,
  {
    tileScaleMin = 0.96,
    tileScaleMax = 1,
    mortarInset = 0.01,
  } = {},
  rng = Math.random,
) {
  const inset = mortarInset * halfTile;
  const scaleSpan = Math.max(0, tileScaleMax - tileScaleMin);
  return polygons.map((p) => {
    const [cx, cy] = representativePoint(p);
    const sx = tileScaleMin + rng() * scaleSpan;
    const sy = tileScaleMin + rng() * scaleSpan;
    let ring = p.exterior.map(([x, y]) => [
      cx + (x - cx) * sx,
      cy + (y - cy) * sy,
    ]);
    if (inset > 0) ring = insetRing(ring, inset);
    const pts = openRing(ring);
    const closed = [...pts, pts[0]];
    return { exterior: closed, area: polygonArea(closed) };
  });
}

function insetRing(ring, amount) {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const open = ring[0][0] === ring[ring.length - 1][0];
  const pts = open ? ring.slice(0, -1) : ring;
  const out = pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x - (dx / len) * amount, y - (dy / len) * amount];
  });
  out.push(out[0]);
  return out;
}

function representativePoint(poly) {
  const pts = openRing(poly.exterior);
  if (!pts.length) return [0, 0];
  let sx = 0,
    sy = 0;
  for (let i = 0; i < pts.length; i++) {
    sx += pts[i][0];
    sy += pts[i][1];
  }
  return [sx / pts.length, sy / pts.length];
}

export function repairTiles(polygons) {
  return polygons.filter((p) => p.exterior && p.exterior.length >= 4);
}

export function reduceEdgeCount(polygons, halfTile, tol = 20) {
  return polygons.map((p) => {
    const exterior = simplifyRing(p.exterior, halfTile / tol);
    return { exterior, area: polygonArea(exterior) };
  });
}

function simplifyRing(ring, tolerance) {
  const open = ring[0][0] === ring[ring.length - 1][0];
  const pts = open ? ring.slice(0, -1) : ring;
  if (pts.length <= 4) return ring;
  const simplified = rdp(pts, tolerance);
  simplified.push(simplified[0]);
  return simplified;
}

function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  let dmax = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const d = perpDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }
  if (dmax > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

function perpDistance(pt, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const mag = Math.hypot(dx, dy) || 1;
  return Math.abs(dy * pt[0] - dx * pt[1] + b[0] * a[1] - b[1] * a[0]) / mag;
}

export function dropSmallTiles(polygons, A0, threshold = 0.03) {
  return polygons.filter((p) => p.area > threshold * A0);
}

/** Replace concave tiles with their convex hull (no triangle shards). */
export function makeConvex(polygons, halfTile, A0) {
  const out = [];
  for (const p of polygons) {
    const pts = openRing(p.exterior);
    if (pts.length < 3) continue;
    const hull = convexHull(pts);
    if (hull.length < 3) continue;
    const closed = [...hull, hull[0]];
    const poly = { exterior: closed, area: polygonArea(closed) };
    if (poly.area >= 0.05 * A0) out.push(poly);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Coloring (coloring.py)
// ---------------------------------------------------------------------------

/** Average color inside each tile (coloring.py method='average', sparse sample). */
export function colorsFromOriginal(polygons, rgba, w, h) {
  const colors = new Array(polygons.length);
  const step = 2;
  for (let j = 0; j < polygons.length; j++) {
    const pts = openRing(polygons[j].exterior);
    let minX = w,
      maxX = 0,
      minY = h,
      maxY = 0;
    for (let pi = 0; pi < pts.length; pi++) {
      const x = pts[pi][0];
      const y = pts[pi][1];
      minX = Math.min(minX, Math.max(0, Math.floor(x)));
      maxX = Math.max(maxX, Math.min(w - 1, Math.ceil(x)));
      minY = Math.min(minY, Math.max(0, Math.floor(y)));
      maxY = Math.max(maxY, Math.min(h - 1, Math.ceil(y)));
    }
    let sr = 0,
      sg = 0,
      sb = 0,
      n = 0;
    for (let y = minY; y <= maxY; y += step) {
      for (let x = minX; x <= maxX; x += step) {
        if (!pointInPolygon(x + 0.5, y + 0.5, pts)) continue;
        const i = (y * w + x) * 4;
        sr += rgba[i];
        sg += rgba[i + 1];
        sb += rgba[i + 2];
        n++;
      }
    }
    if (n === 0) {
      const [cx, cy] = representativePoint(polygons[j]);
      const ix = Math.min(w - 1, Math.max(0, Math.round(cx)));
      const iy = Math.min(h - 1, Math.max(0, Math.round(cy)));
      const i = (iy * w + ix) * 4;
      colors[j] = [rgba[i] / 255, rgba[i + 1] / 255, rgba[i + 2] / 255];
    } else {
      colors[j] = [sr / n / 255, sg / n / 255, sb / n / 255];
    }
  }
  return colors;
}

// ---------------------------------------------------------------------------
// Draw (plotting.py)
// ---------------------------------------------------------------------------

export function drawMosaic(
  polygons,
  colors,
  w,
  h,
  backgroundBrightness = 0.2,
  groutStroke = 0.75,
) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const bg = Math.round(backgroundBrightness * 255);
  const grout = `rgb(${bg},${bg},${bg})`;
  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, w, h);

  for (let j = 0; j < polygons.length; j++) {
    const ring = closeRing(openRing(polygons[j].exterior));
    if (ring.length < 3) continue;
    const c = colors[j];
    ctx.fillStyle = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
    ctx.beginPath();
    ctx.moveTo(ring[0][0], ring[0][1]);
    for (let k = 1; k < ring.length; k++) ctx.lineTo(ring[k][0], ring[k][1]);
    ctx.closePath();
    ctx.fill();
    if (groutStroke > 0) {
      ctx.strokeStyle = grout;
      ctx.lineWidth = groutStroke;
      ctx.stroke();
    }
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// Full pipeline (mosaic.py)
// ---------------------------------------------------------------------------

export async function generateMosaic(source, userParams = {}, onProgress) {
  const p = { ...DEFAULT_PARAMS, ...userParams };
  const report = (msg) => onProgress?.(msg);

  let rgba, w, h, canvas;
  if (source instanceof File || source instanceof Blob) {
    report("Loading image…");
    ({ rgba, w, h, canvas } = await loadImageFromFile(source, p.maxWidth));
  } else if (source.rgba) {
    ({ rgba, w, h, canvas } = source);
  } else {
    throw new Error("Expected File, Blob, or { rgba, w, h, canvas }");
  }
  await tick();

  report("Edge detection…");
  let imgEdges =
    p.edgeMode === "sobel"
      ? edgesSobel(rgba, w, h, p.gauss)
      : edgesDiblasi(rgba, w, h, p.gauss, p.edgeDetails);
  if (p.withFrame) addFrame(imgEdges, w, h);
  await tick();

  const halfTile = p.halfTile;
  const A0 = (2 * halfTile) ** 2;
  const rng = seededRandom(p.seed);

  report("Guidelines & angles…");
  const { chains, angles } = chainsAndAngles(imgEdges, w, h, halfTile);
  await tick();

  report(`Placing tiles along ${chains.length} chains…`);
  let polygons = placeTilesAlongChains(
    chains,
    angles,
    w,
    h,
    halfTile,
    p.randSize,
    p.maxAngle,
    A0,
    p.minChainTileArea,
    p.tileExpand,
    rng,
    p.chainClipMinArea,
    p.chainMaxClipNeighbors,
  );
  const chainTileCount = polygons.length;
  const spatial = new PolySpatialIndex(halfTile * 4, w, h);
  for (const poly of polygons) spatial.insert(poly);
  await tick();

  const gapPasses = Math.max(1, Math.round(p.gapFillPasses ?? 1));
  let gapAdded = 0;
  for (let pass = 0; pass < gapPasses; pass++) {
    report(`Filling gaps (pass ${pass + 1}/${gapPasses}, ${polygons.length} tiles)…`);
    const fillerChains = chainsIntoGaps(polygons, w, h, halfTile, p.gapChainSpacing);
    const { counter } = placeTilesIntoGaps(
      polygons,
      fillerChains,
      angles,
      w,
      h,
      halfTile,
      A0,
      spatial,
      p.minGapTileArea,
      p.gapFillStep,
      p.gapTileExpand,
      report,
    );
    gapAdded += counter;
    if (counter === 0) break;
    await tick();
  }
  report(`Gap fill added ${gapAdded} tiles`);

  polygons = cutTilesOutsideFrame(polygons, halfTile, w, h, A0);

  if (p.makeConvex) {
    report("Convex decomposition…");
    polygons = makeConvex(polygons, halfTile, A0);
    await tick();
  }

  if (p.preShrinkExpand > 1) {
    polygons = polygons.map((poly) =>
      scalePolygonAboutCentroid(poly, p.preShrinkExpand),
    );
  }

  polygons = irregularShrink(
    polygons,
    halfTile,
    {
      tileScaleMin: p.tileScaleMin,
      tileScaleMax: p.tileScaleMax,
      mortarInset: p.mortarInset,
    },
    rng,
  );
  polygons = repairTiles(polygons);
  polygons = reduceEdgeCount(polygons, halfTile);
  polygons = dropSmallTiles(polygons, A0, p.dropTileThreshold);
  await tick();

  report("Coloring tiles…");
  const colors = colorsFromOriginal(polygons, rgba, w, h);

  report("Rasterizing…");
  const mosaicCanvas = drawMosaic(
    polygons,
    colors,
    w,
    h,
    p.backgroundBrightness,
    p.groutStroke,
  );
  await tick();

  return {
    canvas: mosaicCanvas,
    sourceCanvas: canvas,
    w,
    h,
    tileCount: polygons.length,
    chainTileCount,
    chainCount: chains.length,
    polygons,
    colors,
    edges: imgEdges,
  };
}
