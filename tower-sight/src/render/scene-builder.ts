// 方案数据 -> 合并网格(地面/建筑/机型/塔台), 世界坐标即机场坐标 x东 y北 z上
import type { AirportScheme, Vec3 } from '../types';
import { AIRCRAFT_SPECS } from '../types';
import { extrudePolygon, polygonToFlatMesh, stripToPolygon, type MeshData } from './geometry-helpers';
import { headingToVec } from '../core/math';

export interface SceneMesh {
  positions: Float32Array;
  normals: Float32Array;
  colors: Float32Array; // 每顶点线性 RGB
  indices: Uint32Array;
}

function mergeMeshes(parts: { mesh: MeshData; color: [number, number, number] }[]): SceneMesh {
  let vCount = 0;
  let iCount = 0;
  for (const p of parts) {
    vCount += p.mesh.positions.length / 3;
    iCount += p.mesh.indices.length;
  }
  const positions = new Float32Array(vCount * 3);
  const normals = new Float32Array(vCount * 3);
  const colors = new Float32Array(vCount * 3);
  const indices = new Uint32Array(iCount);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    positions.set(p.mesh.positions, vo * 3);
    normals.set(p.mesh.normals, vo * 3);
    for (let i = 0; i < p.mesh.positions.length / 3; i++) {
      colors[(vo + i) * 3] = p.color[0];
      colors[(vo + i) * 3 + 1] = p.color[1];
      colors[(vo + i) * 3 + 2] = p.color[2];
    }
    for (const idx of p.mesh.indices) indices[io++] = vo + idx;
    vo += p.mesh.positions.length / 3;
  }
  return { positions, normals, colors, indices };
}

const COLORS = {
  runway: [0.16, 0.16, 0.17] as [number, number, number],
  taxiway: [0.24, 0.24, 0.25] as [number, number, number],
  link: [0.26, 0.26, 0.27] as [number, number, number],
  apron: [0.32, 0.32, 0.33] as [number, number, number],
  ground: [0.21, 0.28, 0.17] as [number, number, number],
};

export function buildSceneMeshes(scheme: AirportScheme): {
  ground: SceneMesh;
  buildings: SceneMesh;
  aircraft: SceneMesh;
} {
  // 地面铺装
  const groundParts: { mesh: MeshData; color: [number, number, number] }[] = [];
  for (const s of scheme.strips) {
    const poly = stripToPolygon(s.points, s.width);
    if (poly.length >= 3) {
      groundParts.push({
        mesh: polygonToFlatMesh(poly, 0.05),
        color: COLORS[s.kind],
      });
    }
  }
  for (const a of scheme.aprons) {
    groundParts.push({ mesh: polygonToFlatMesh(a.polygon, 0.06), color: COLORS.apron });
  }

  // 建筑
  const buildingParts: { mesh: MeshData; color: [number, number, number] }[] = [];
  for (const b of scheme.buildings) {
    buildingParts.push({ mesh: extrudePolygon(b.polygon, b.height), color: b.color });
  }

  // 机型: 简单机身(沿航向的盒子)+ 机翼
  const aircraftParts: { mesh: MeshData; color: [number, number, number] }[] = [];
  for (const ac of scheme.aircraft) {
    const spec = AIRCRAFT_SPECS[ac.type];
    const heading = (ac.heading * Math.PI) / 180;
    const fwd = { x: Math.sin(heading), y: Math.cos(heading) };
    const right = { x: fwd.y, y: -fwd.x };
    const localToWorld = (lx: number, ly: number, lz: number): Vec3 => ({
      x: ac.pos.x + fwd.x * ly + right.x * lx,
      y: ac.pos.y + fwd.y * ly + right.y * lx,
      z: lz,
    });
    // 机身盒子 8 顶点
    const hl = spec.length / 2;
    const hw = 1.6;
    const hh = spec.height / 2;
    const localCorners: [number, number, number][] = [
      [-hw, -hl, 0], [hw, -hl, 0], [hw, hl, 0], [-hw, hl, 0],
      [-hw, -hl, spec.height], [hw, -hl, spec.height],
      [hw, hl, spec.height], [-hw, hl, spec.height],
    ];
    const world = localCorners.map((c) => localToWorld(c[0], c[1], c[2]));
    const pos = new Float32Array(world.length * 3);
    const nor = new Float32Array(world.length * 3);
    world.forEach((p, i) => {
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    });
    const boxIdx = new Uint32Array([
      0, 1, 2, 0, 2, 3, // 底
      4, 6, 5, 4, 7, 6, // 顶
      0, 4, 5, 0, 5, 1,
      1, 5, 6, 1, 6, 2,
      2, 6, 7, 2, 7, 3,
      3, 7, 4, 3, 4, 0,
    ]);
    // 简易法线(以面为主, 这里用顶点法线近似朝上/朝外, 着色器主要靠太阳)
    for (let i = 0; i < 8; i++) nor[i * 3 + 2] = i >= 4 ? 1 : 0;
    aircraftParts.push({
      mesh: { positions: pos, normals: nor, indices: boxIdx },
      color: spec.color,
    });
  }

  return {
    ground: mergeMeshes(groundParts),
    buildings: mergeMeshes(buildingParts),
    aircraft: mergeMeshes(aircraftParts),
  };
}

/** 塔台标记: 细长圆柱体(管制塔)+ 顶部管制室小球,用于场景内定位显示 */
export function buildTowerMarkerMesh(pos: { x: number; y: number }, floorElev: number): SceneMesh {
  const segs = 12;
  const r = 3;
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // 塔身侧面
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    positions.push(pos.x + nx * r, pos.y + ny * r, 0);
    normals.push(nx, ny, 0);
    positions.push(pos.x + nx * r, pos.y + ny * r, floorElev);
    normals.push(nx, ny, 0);
  }
  for (let i = 0; i < segs; i++) {
    const b = i * 2;
    indices.push(b, b + 2, b + 3, b, b + 3, b + 1);
  }
  // 顶部管制室(略大的圆柱)
  const cabBase = positions.length / 3;
  const cabR = 4.5;
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const nx = Math.cos(a);
    const ny = Math.sin(a);
    positions.push(pos.x + nx * cabR, pos.y + ny * cabR, floorElev);
    normals.push(nx, ny, 0);
    positions.push(pos.x + nx * cabR, pos.y + ny * cabR, floorElev + 3.5);
    normals.push(nx, ny, 0);
  }
  for (let i = 0; i < segs; i++) {
    const b = cabBase + i * 2;
    indices.push(b, b + 2, b + 3, b, b + 3, b + 1);
  }
  const n = positions.length / 3;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = 0.85;
    colors[i * 3 + 1] = 0.75;
    colors[i * 3 + 2] = 0.45;
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors,
    indices: new Uint32Array(indices),
  };
}

/** 大地基底(以原点为中心的大平面, 接住天空散射地面色) */
export function buildEarthMesh(halfSize = 20000): SceneMesh {
  const h = halfSize;
  const positions = new Float32Array([
    -h, -h, -0.1, h, -h, -0.1, h, h, -0.1, -h, h, -0.1,
  ]);
  const normals = new Float32Array(12);
  for (let i = 0; i < 4; i++) normals[i * 3 + 2] = 1;
  const colors = new Float32Array(12);
  for (let i = 0; i < 4; i++) {
    colors[i * 3] = COLORS.ground[0];
    colors[i * 3 + 1] = COLORS.ground[1];
    colors[i * 3 + 2] = COLORS.ground[2];
  }
  return { positions, normals, colors, indices: new Uint32Array([0, 1, 2, 0, 2, 3]) };
}
