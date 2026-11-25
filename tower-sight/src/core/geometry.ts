// 平面几何工具: 条带展宽、建筑三角化、包围盒
import type { Vec2 } from '../types';
import { polygonArea } from './math';
import earcut from 'earcut';

/** 折线(中心线)+ 宽度 -> 左右轮廓多边形(简单斜接, 工程草图精度足够) */
export function stripToPolygon(center: Vec2[], width: number): Vec2[] {
  if (center.length < 2) return [];
  const half = width / 2;
  const left: Vec2[] = [];
  const right: Vec2[] = [];

  for (let i = 0; i < center.length; i++) {
    const p = center[i];
    let nx: number, ny: number;
    if (i === 0) {
      const d = center[1];
      const dx = d.x - p.x;
      const dy = d.y - p.y;
      const l = Math.hypot(dx, dy) || 1;
      nx = -dy / l;
      ny = dx / l;
    } else if (i === center.length - 1) {
      const d = center[i - 1];
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      const l = Math.hypot(dx, dy) || 1;
      nx = -dy / l;
      ny = dx / l;
    } else {
      // 相邻两段法线取平均(斜接)
      const p0 = center[i - 1];
      const p1 = center[i + 1];
      const d1x = p.x - p0.x, d1y = p.y - p0.y;
      const d2x = p1.x - p.x, d2y = p1.y - p.y;
      const l1 = Math.hypot(d1x, d1y) || 1;
      const l2 = Math.hypot(d2x, d2y) || 1;
      nx = (-d1y / l1 + -d2y / l2) / 2;
      ny = (d1x / l1 + d2x / l2) / 2;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
    }
    left.push({ x: p.x + nx * half, y: p.y + ny * half });
    right.push({ x: p.x - nx * half, y: p.y - ny * half });
  }
  return [...left, ...right.reverse()];
}

export interface BBox {
  minX: number; minY: number; maxX: number; maxY: number;
}

export function bboxOf(poly: Vec2[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

export function bboxOverlap2D(a: BBox, b: BBox): boolean {
  return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

/** 多边形三角化(earcut),返回索引(顶点为 poly 顺序)。自动处理绕向。 */
export function triangulate(poly: Vec2[]): number[] {
  const flat: number[] = [];
  for (const p of poly) flat.push(p.x, p.y);
  const indices = earcut(flat);
  // earcut 按输入绕向输出;统一成逆时针(从上方看)
  if (polygonArea(poly) < 0) {
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
  }
  return indices;
}

export interface MeshData {
  positions: Float32Array; // xyz
  normals: Float32Array;
  indices: Uint32Array;
}

/** 水平多边形 -> 给定标高的平面网格(法线朝上) */
export function polygonToFlatMesh(poly: Vec2[], z: number): MeshData {
  const idx = triangulate(poly);
  const n = poly.length;
  const positions = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = poly[i].x;
    positions[i * 3 + 1] = poly[i].y;
    positions[i * 3 + 2] = z;
    normals[i * 3 + 2] = 1;
  }
  return { positions, normals, indices: new Uint32Array(idx) };
}

/**
 * 建筑轮廓 -> 挤出体块(顶面 + 侧面,底面不画)
 * 顶面 z=height, 地面 z=0(后续可加场地标高参数)
 */
export function extrudePolygon(poly: Vec2[], height: number): MeshData {
  const n = poly.length;
  const topCount = n;
  const sideVerts = n * 2;
  const total = topCount + sideVerts;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);

  for (let i = 0; i < n; i++) {
    positions[i * 3] = poly[i].x;
    positions[i * 3 + 1] = poly[i].y;
    positions[i * 3 + 2] = height;
    normals[i * 3 + 2] = 1;
  }
  for (let i = 0; i < n; i++) {
    const base = (topCount + i * 2) * 3;
    positions[base] = poly[i].x;
    positions[base + 1] = poly[i].y;
    positions[base + 2] = 0;
    positions[base + 3] = poly[i].x;
    positions[base + 4] = poly[i].y;
    positions[base + 5] = height;
    // 墙面法线(外法线, 水平)
    const j = (i + 1) % n;
    const dx = poly[j].x - poly[i].x;
    const dy = poly[j].y - poly[i].y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = dy / l;
    const ny = -dx / l;
    normals[base] = nx; normals[base + 1] = ny; normals[base + 2] = 0;
    normals[base + 3] = nx; normals[base + 4] = ny; normals[base + 5] = 0;
  }

  const topIdx = triangulate(poly);
  const indices: number[] = [...topIdx];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const bi = topCount + i * 2;
    const bj = topCount + j * 2;
    // 墙四边形(朝外)
    indices.push(bi, bj, bj + 1, bi, bj + 1, bi + 1);
  }
  return { positions, normals, indices: new Uint32Array(indices) };
}

/** 线段与多边形求交:返回所有交点(沿线段参数 t 升序) */
export function segmentPolygonIntersections(
  ax: number, ay: number, bx: number, by: number,
  poly: Vec2[],
): { t: number; x: number; y: number; edgeIndex: number }[] {
  const out: { t: number; x: number; y: number; edgeIndex: number }[] = [];
  const dx = bx - ax;
  const dy = by - ay;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sx = q.x - p.x;
    const sy = q.y - p.y;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((p.x - ax) * sy - (p.y - ay) * sx) / denom;
    const u = ((p.x - ax) * dy - (p.y - ay) * dx) / denom;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
      out.push({ t, x: ax + t * dx, y: ay + t * dy, edgeIndex: i });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** 矩形多边形(用于机库/航站楼快速生成) */
export function rectPolygon(cx: number, cy: number, w: number, h: number, rotDeg = 0): Vec2[] {
  const r = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(r), sin = Math.sin(r);
  const local: Vec2[] = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  return local.map((p) => ({
    x: cx + p.x * cos - p.y * sin,
    y: cy + p.x * sin + p.y * cos,
  }));
}
