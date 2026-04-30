/**
 * 2D road network geometry from `v2/profile-road-lab0.html` (Network Road Lab).
 * Internal plane: (x, y) where y maps to world Z in Three.js.
 */

function vec(x = 0, y = 0) {
  return { x, y };
}
function add(a, b) {
  return vec(a.x + b.x, a.y + b.y);
}
function sub(a, b) {
  return vec(a.x - b.x, a.y - b.y);
}
function mul(a, s) {
  return vec(a.x * s, a.y * s);
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}
function cross(a, b) {
  return a.x * b.y - a.y * b.x;
}
function len(a) {
  return Math.hypot(a.x, a.y);
}
function norm(a) {
  const l = len(a);
  return l < 1e-6 ? vec(1, 0) : vec(a.x / l, a.y / l);
}
function perpLeft(a) {
  return vec(-a.y, a.x);
}
function dist(a, b) {
  return len(sub(a, b));
}
function lerp(a, b, t) {
  return vec(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
}
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function lineIntersection(p, d, q, e) {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-6) return null;
  const qp = sub(q, p);
  const t = cross(qp, e) / den;
  const u = cross(qp, d) / den;
  return { p: add(p, mul(d, t)), t, u };
}

function angleLerp(a0, a1, t) {
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a0 + d * t;
}

function quadraticPoint(P0, P1, P2, t) {
  const u = 1 - t;
  return add(add(mul(P0, u * u), mul(P1, 2 * u * t)), mul(P2, t * t));
}

function quadraticDeriv(P0, P1, P2, t) {
  return add(mul(sub(P1, P0), 2 * (1 - t)), mul(sub(P2, P1), 2 * t));
}

function sampleQuadraticOffset(P0, P1, P2, offset, samples) {
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = quadraticPoint(P0, P1, P2, t);
    const side = perpLeft(norm(quadraticDeriv(P0, P1, P2, t)));
    out.push(add(p, mul(side, offset)));
  }
  return out;
}

function buildNetworkBend(start, control, end, width, curveSegments) {
  const hw = width * 0.5;
  const samples = Math.max(4, curveSegments | 0);
  const left = sampleQuadraticOffset(start, control, end, hw, samples);
  const right = sampleQuadraticOffset(start, control, end, -hw, samples);
  return {
    polygon: [...left, ...right.slice().reverse()],
    left: { path: left, debug: [] },
    right: { path: right, debug: [] },
    center: sampleQuadraticOffset(start, control, end, 0, samples),
    networkBend: true,
  };
}

function junctionBoundary(node, roads, clipDistance, hw, junctionRadius, junctionSegments) {
  const entries = roads
    .map((road) => {
      const clip = Math.min(clipDistance(node.id, road.length), road.length * 0.45);
      const mouth = add(node.p, mul(road.dir, clip));
      const side = perpLeft(road.dir);
      return {
        angle: Math.atan2(road.dir.y, road.dir.x),
        dir: road.dir,
        left: add(mouth, mul(side, hw)),
        right: add(mouth, mul(side, -hw)),
      };
    })
    .sort((a, b) => a.angle - b.angle);

  const fillPath = [];
  const segments = [];
  for (let i = 0; i < entries.length; i++) {
    const current = entries[i];
    const next = entries[(i + 1) % entries.length];
    if (fillPath.length === 0) fillPath.push(current.right);
    fillPath.push(current.left);

    const start = current.left;
    const end = next.right;
    const cornerHit = lineIntersection(start, current.dir, end, next.dir);
    const fallbackMid = lerp(start, end, 0.5);
    const fallbackOut = norm(sub(fallbackMid, node.p));
    let corner = cornerHit ? cornerHit.p : add(fallbackMid, mul(fallbackOut, hw));
    const maxCornerReach = Math.max(hw * 2.2, junctionRadius * 1.25);
    if (dist(corner, start) > maxCornerReach || dist(corner, end) > maxCornerReach) {
      corner = add(fallbackMid, mul(fallbackOut, hw * 0.65));
    }

    const segment = [];
    const segmentCount = Math.max(3, junctionSegments | 0);
    for (let s = 0; s <= segmentCount; s++) {
      const t = s / segmentCount;
      const a = lerp(start, corner, t);
      const b = lerp(corner, end, t);
      segment.push(lerp(a, b, t));
    }
    fillPath.push(...segment.slice(1));
    segments.push(segment);
  }
  return { polygon: fillPath, outlineSegments: segments };
}

/**
 * @param nodes { id, x, z, forceJunction? }[]
 * @param edges { a, b }[]
 * @param params { width, lanesPerDir, junctionRadius, curveSegments, junctionSegments, twoRoadNodes, endCapStyle,
 *   centerLine?, laneLines?, doubleCenterLine?, centerLineGap?, centerLineWidth?, centerLeftEnabled?, centerRightEnabled? }
 */
export function buildLabNetworkGeometry(nodes, edges, params) {
  const width = params.width;
  const lanesPerDir = params.lanesPerDir ?? 1;
  const junctionRadius = params.junctionRadius ?? 12;
  const curveSegments = Math.max(4, params.curveSegments ?? 34);
  const junctionSegments = Math.max(3, params.junctionSegments ?? 14);
  const twoRoadNodes = params.twoRoadNodes ?? "smooth";
  const endCapStyle = params.endCapStyle ?? "flat";
  const centerLine = params.centerLine !== false;
  const laneLines = !!params.laneLines;
  const doubleCenterLine = !!params.doubleCenterLine;
  const centerLineGap = params.centerLineGap ?? 0.012;
  const centerLineWidth = params.centerLineWidth ?? 0.02;
  const centerLeftEnabled = params.centerLeftEnabled !== false;
  const centerRightEnabled = params.centerRightEnabled !== false;

  /** Physical lateral offsets along `side` from road spine (matches Full Road normalized gap/width). */
  function centerStripeOffsets() {
    if (!doubleCenterLine) return [{ off: 0, role: "center" }];
    const halfGap = centerLineGap * 0.5;
    const halfW = centerLineWidth * 0.5;
    const d = (halfGap + halfW) * width;
    const out = [];
    if (centerLeftEnabled) out.push({ off: -d, role: "centerLeft" });
    if (centerRightEnabled) out.push({ off: d, role: "centerRight" });
    return out;
  }

  const nodeById = new Map(
    nodes.map((n) => [
      n.id,
      {
        id: n.id,
        p: vec(n.x, n.z),
        forceJunction: !!n.forceJunction,
      },
    ]),
  );
  const adjacency = new Map(nodes.map((n) => [n.id, []]));
  const pieces = [];
  const markings = [];
  const hw = width * 0.5;
  const count = lanesPerDir * 2;
  const laneW = width / count;
  const minEdge = width * 0.75;

  for (const edge of edges) {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b || dist(a.p, b.p) < minEdge) continue;
    adjacency.get(a.id).push({ edge, other: b, dir: norm(sub(b.p, a.p)), length: dist(a.p, b.p) });
    adjacency.get(b.id).push({ edge, other: a, dir: norm(sub(a.p, b.p)), length: dist(a.p, b.p) });
  }

  const clipDistance = (nodeId, length) => {
    const degree = adjacency.get(nodeId).length;
    if (degree <= 1) return 0;
    const radiusCap = junctionRadius * (degree === 2 ? 1 : 0.62);
    const lengthScale = degree === 2 ? 0.32 : 0.24;
    return Math.min(radiusCap, Math.max(hw * 1.15, length * lengthScale));
  };

  for (const edge of edges) {
    const a = nodeById.get(edge.a);
    const b = nodeById.get(edge.b);
    if (!a || !b) continue;
    const length = dist(a.p, b.p);
    if (length < minEdge) continue;
    const dir = norm(sub(b.p, a.p));
    const side = perpLeft(dir);
    const ca = Math.min(clipDistance(a.id, length), length * 0.45);
    const cb = Math.min(clipDistance(b.id, length), length * 0.45);
    const start = add(a.p, mul(dir, ca));
    const end = add(b.p, mul(dir, -cb));
    if (dist(start, end) < 1) continue;
    pieces.push({
      polygon: [add(start, mul(side, hw)), add(end, mul(side, hw)), add(end, mul(side, -hw)), add(start, mul(side, -hw))],
      left: { path: [add(start, mul(side, hw)), add(end, mul(side, hw))], debug: [] },
      right: { path: [add(start, mul(side, -hw)), add(end, mul(side, -hw))], debug: [] },
      center: [start, end],
      networkSpan: true,
    });

    for (let i = 1; i < count; i++) {
      if (i === lanesPerDir) {
        if (!centerLine) continue;
        for (const { off: cOff, role } of centerStripeOffsets()) {
          markings.push({
            path: [add(start, mul(side, cOff)), add(end, mul(side, cOff))],
            type: role,
          });
        }
      } else {
        if (!laneLines) continue;
        const off = -hw + i * laneW;
        markings.push({
          path: [add(start, mul(side, off)), add(end, mul(side, off))],
          type: "divider",
        });
      }
    }
  }

  for (const node of nodeById.values()) {
    const roads = adjacency.get(node.id);
    if (!roads || roads.length === 0) continue;

    if (roads.length === 1) {
      const road = roads[0];
      const side = perpLeft(road.dir);
      let pts;
      if (endCapStyle === "flat") {
        const L = add(node.p, mul(side, -hw));
        const R = add(node.p, mul(side, hw));
        const back = mul(road.dir, -hw * 0.2);
        pts = [L, R, add(R, back), add(L, back)];
      } else {
        pts = [];
        const back = mul(road.dir, -1);
        const base = Math.atan2(back.y, back.x);
        const a0 = base - Math.PI * 0.5;
        const a1 = base + Math.PI * 0.5;
        const segmentCount = Math.max(6, junctionSegments | 0);
        for (let i = 0; i <= segmentCount; i++) {
          const ang = angleLerp(a0, a1, i / segmentCount);
          pts.push(add(node.p, vec(Math.cos(ang) * hw, Math.sin(ang) * hw)));
        }
      }
      pieces.push({
        polygon: pts,
        left: { path: [] },
        right: { path: [] },
        center: [],
        isJunctionCore: true,
        networkNode: node,
        mouths: [],
      });
      continue;
    }

    if (roads.length === 2 && twoRoadNodes === "smooth" && !node.forceJunction) {
      const first = roads[0];
      const second = roads[1];
      const clipA = Math.min(clipDistance(node.id, first.length), first.length * 0.45);
      const clipB = Math.min(clipDistance(node.id, second.length), second.length * 0.45);
      const mouthA = add(node.p, mul(first.dir, clipA));
      const mouthB = add(node.p, mul(second.dir, clipB));
      pieces.push(buildNetworkBend(mouthA, node.p, mouthB, width, curveSegments));

      const bendSamples = Math.max(4, curveSegments | 0);
      for (let i = 1; i < count; i++) {
        if (i === lanesPerDir) {
          if (!centerLine) continue;
          for (const { off: cOff, role } of centerStripeOffsets()) {
            markings.push({
              path: sampleQuadraticOffset(mouthA, node.p, mouthB, cOff, bendSamples),
              type: role,
            });
          }
        } else {
          if (!laneLines) continue;
          const off = -hw + i * laneW;
          markings.push({
            path: sampleQuadraticOffset(mouthA, node.p, mouthB, off, bendSamples),
            type: "divider",
          });
        }
      }
      continue;
    }

    const boundary = junctionBoundary(node, roads, clipDistance, hw, junctionRadius, junctionSegments);
    pieces.push({
      polygon: boundary.polygon,
      left: { path: [] },
      right: { path: [] },
      center: [],
      isJunctionCore: true,
      networkNode: node,
      mouths: roads.map((road) => ({
        c: add(node.p, mul(road.dir, Math.min(clipDistance(node.id, road.length), road.length * 0.45))),
      })),
      outlineSegments: boundary.outlineSegments,
    });
  }

  return { ok: true, pieces, markings, nodes };
}
