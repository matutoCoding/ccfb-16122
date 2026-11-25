// 视认分析: 眼位射线 vs 建筑体块遮挡、竖梃遮挡、覆盖网格、机型张角/对比度
import type {
  AirportScheme, Building, CoverageCell, TowerCandidate, Vec2, Vec3, WeatherPreset,
} from '../types';
import { AIRCRAFT_SPECS } from '../types';
import {
  DEG, RAD, angleDelta, clamp, dist, headingToVec, normAngle360, pointInPolygon,
  raySegment2D, vecToHeading,
} from './math';
import { bboxOf, bboxOverlap2D, segmentPolygonIntersections } from './geometry';
import {
  apparentContrast, isResolvable, transmittance,
} from './atmosphere';

export interface EyePoint {
  x: number; y: number; z: number;
}

export function towerEye(t: TowerCandidate): EyePoint {
  return { x: t.pos.x, y: t.pos.y, z: t.floorElev + t.eyeHeight };
}

/**
 * 水平方位上的竖梃遮挡角宽(度)
 * 竖梃在管制室外圈,眼位近似位于圆心;考虑外倾角后竖梃向斜上方,
 * 水平方向有效投影宽度 = 物理宽度 / cos(外倾角)
 */
export function mullionAngularWidth(t: TowerCandidate): number {
  const cant = t.mullionCant * DEG;
  const effectiveWidthMm = t.mullionWidth / Math.cos(cant);
  const r = t.cabDiameter / 2;
  // 弦长近似角宽 = 2 asin(w/2 / r)
  return (2 * Math.asin(clamp(effectiveWidthMm / 1000 / 2 / r, 0, 1))) * RAD;
}

/** 竖梃方位列表(均布一圈,第一根在正北) */
export function mullionHeadings(t: TowerCandidate): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.mullionCount; i++) {
    out.push(normAngle360((360 / t.mullionCount) * i));
  }
  return out;
}

/** 给定观察方位是否落在竖梃遮挡扇区内(可加观察俯视角,外倾使遮挡方位随俯仰微移) */
export function isMullionBlocked(t: TowerCandidate, headingDeg: number, dipDeg = 0): boolean {
  if (t.mullionCount <= 0 || t.mullionWidth <= 0) return false;
  const halfW = mullionAngularWidth(t) / 2;
  // 外倾角使竖梃顶部外移: 俯视时竖梃相对方位向外侧偏移 cant*tan(dip) 一阶近似
  const shift = t.mullionCant * Math.tan(-dipDeg * DEG) * 0.1;
  for (const h of mullionHeadings(t)) {
    if (Math.abs(angleDelta(headingDeg + shift, h)) <= halfW) return true;
  }
  return false;
}

export interface BlockerHit {
  buildingId: string;
  buildingName: string;
  distance: number; // 眼位到遮挡点水平距离
  hitZ: number; // 遮挡点建筑高度
  point: Vec3;
}

/**
 * 射线(从眼位到目标点)是否被建筑体块挡住,返回最近遮挡体
 * 做法: 水平射线与建筑轮廓求交,交点处建筑为垂直挤出体(0..height),
 * 比较视线在该水平距离处的高度与建筑高度
 */
export function lineBlockedByBuildings(
  eye: EyePoint,
  target: Vec3,
  buildings: Building[],
): BlockerHit | null {
  const dx = target.x - eye.x;
  const dy = target.y - eye.y;
  const horiz = Math.hypot(dx, dy);
  if (horiz < 1e-6) return null;
  const dz = target.z - eye.z;
  let best: BlockerHit | null = null;

  for (const b of buildings) {
    // 包围盒快速剔除(水平射线)
    const bb = bboxOf(b.polygon);
    const rayBB = bboxOf([{ x: eye.x, y: eye.y }, { x: target.x, y: target.y }]);
    if (!bboxOverlap2D(bb, rayBB)) continue;

    const hits = segmentPolygonIntersections(
      eye.x, eye.y, target.x, target.y, b.polygon,
    );
    for (const hit of hits) {
      if (hit.t <= 0 || hit.t >= 1) continue;
      const sightZ = eye.z + dz * hit.t;
      // 建筑从地面 0 挤出到 height;视线高度低于屋顶即被挡
      if (sightZ <= b.height) {
        const distance = horiz * hit.t;
        if (!best || distance < best.distance) {
          best = {
            buildingId: b.id,
            buildingName: b.name,
            distance,
            hitZ: b.height,
            point: { x: hit.x, y: hit.y, z: sightZ },
          };
        }
      }
    }
  }
  return best;
}

/** 眼位看地面点的俯视角(度, 正=向下)与方位/距离 */
export function sightGeometry(eye: EyePoint, ground: Vec2): {
  heading: number; dip: number; distance: number;
} {
  const dx = ground.x - eye.x;
  const dy = ground.y - eye.y;
  const horiz = Math.hypot(dx, dy);
  const heading = vecToHeading(dx, dy);
  const dip = Math.atan2(eye.z, horiz) * RAD; // 地面点 z=0
  return { heading, dip, distance: horiz };
}

/** 覆盖网格: 遍历活动区每格, 判定遮挡/俯视角/能见度/竖梃 */
export function computeCoverage(
  scheme: AirportScheme,
  tower: TowerCandidate,
  weather: WeatherPreset,
): CoverageCell[] {
  const eye = towerEye(tower);
  const cells: CoverageCell[] = [];
  const { cellSize, minDipAngle, minVisibility } = scheme.coverage;

  const region = activityRegion(scheme);
  for (let cy = region.minY; cy <= region.maxY; cy += cellSize) {
    for (let cx = region.minX; cx <= region.maxX; cx += cellSize) {
      const center = { x: cx + cellSize / 2, y: cy + cellSize / 2 };
      if (!insideActivity(scheme, center)) continue;

      const geo = sightGeometry(eye, center);
      const target: Vec3 = { x: center.x, y: center.y, z: 0 };
      const blocker = lineBlockedByBuildings(eye, target, scheme.buildings);
      const mull = isMullionBlocked(tower, geo.heading, geo.dip);

      // 能见度: 距离须满足最低能见度要求, 且当前天气下透射率保留 ≥5% 对比度
      const T = transmittance(weather.visibility, geo.distance, weather.haze);
      const visibilityOk = geo.distance <= minVisibility && T >= 0.05;
      const dipOk = geo.dip >= minDipAngle;

      cells.push({
        cx: center.x,
        cy: center.y,
        blocked: blocker !== null,
        blockerBuildingId: blocker?.buildingId ?? null,
        dipAngle: geo.dip,
        visibilityOk,
        mullionBlocked: mull,
        pass: !blocker && dipOk && visibilityOk && !mull,
      });
    }
  }
  return cells;
}

export interface ActivityRegion {
  minX: number; minY: number; maxX: number; maxY: number;
}

/** 活动区范围: 所有条带/机坪的并集包围盒外扩 50m */
export function activityRegion(scheme: AirportScheme): ActivityRegion {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (p: Vec2) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  };
  for (const s of scheme.strips) s.points.forEach(eat);
  for (const a of scheme.aprons) a.polygon.forEach(eat);
  if (!isFinite(minX)) return { minX: -500, minY: -500, maxX: 500, maxY: 500 };
  return { minX: minX - 50, minY: minY - 50, maxX: maxX + 50, maxY: maxY + 50 };
}

/** 点是否在活动区内(条带宽度缓冲 + 机坪多边形) */
export function insideActivity(scheme: AirportScheme, p: Vec2): boolean {
  for (const a of scheme.aprons) {
    if (pointInPolygon(p, a.polygon)) return true;
  }
  for (const s of scheme.strips) {
    let d = Infinity;
    for (let i = 0; i < s.points.length - 1; i++) {
      const ax = s.points[i].x, ay = s.points[i].y;
      const bx = s.points[i + 1].x, by = s.points[i + 1].y;
      const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
      let t = l2 > 0 ? ((p.x - ax) * (bx - ax) + (p.y - ay) * (by - ay)) / l2 : 0;
      t = clamp(t, 0, 1);
      d = Math.min(d, Math.hypot(p.x - (ax + t * (bx - ax)), p.y - (ay + t * (by - ay))));
    }
    if (d <= s.width / 2) return true;
  }
  return false;
}

export interface AircraftSightResult {
  aircraftId: string;
  distance: number;
  heading: number;
  dip: number;
  /** 机身/翼展在眼位的张角(度),取较大尺寸 */
  angularSizeDeg: number;
  angularSizeArcmin: number;
  intrinsicContrast: number;
  apparentContrastValue: number;
  transmittance: number;
  resolvable: boolean;
  mullionBlocked: boolean;
  buildingBlocked: boolean;
  blocker: BlockerHit | null;
  pass: boolean;
}

/**
 * 机型视认: 放在跑道端/滑行道上的飞机, 计算张角与表观对比度
 * 固有对比度按机身亮度与地面背景估计(浅色机身对深沥青 ≈ 0.35)
 */
export function analyzeAircraft(
  scheme: AirportScheme,
  tower: TowerCandidate,
  aircraftId: string,
  weather: WeatherPreset,
): AircraftSightResult | null {
  const ac = scheme.aircraft.find((a) => a.id === aircraftId);
  if (!ac) return null;
  const spec = AIRCRAFT_SPECS[ac.type];
  const eye = towerEye(tower);
  const ground: Vec2 = ac.pos;
  const geo = sightGeometry(eye, ground);
  // 飞机有高度, 取机身中部高度作为目标点
  const targetZ = spec.height * 0.6;
  const blocker = lineBlockedByBuildings(
    eye, { x: ground.x, y: ground.y, z: targetZ }, scheme.buildings,
  );

  // 张角: 视线方向上机身投影长度取机长与翼展的较大者(保守用翼展)
  const featureSize = Math.max(spec.length, spec.wingspan);
  const angularSizeRad = 2 * Math.atan(featureSize / 2 / Math.max(geo.distance, 1));
  const angularSizeDeg = angularSizeRad * RAD;
  const angularSizeArcmin = angularSizeDeg * 60;

  const intrinsic = 0.35; // 浅色机身对沥青跑道的固有对比度
  const T = transmittance(weather.visibility, geo.distance, weather.haze);
  const cApp = apparentContrast(intrinsic, weather.visibility, geo.distance, weather.haze);
  const resolvable = isResolvable(cApp, angularSizeArcmin);
  const mull = isMullionBlocked(tower, geo.heading, geo.dip);

  return {
    aircraftId,
    distance: geo.distance,
    heading: geo.heading,
    dip: geo.dip,
    angularSizeDeg,
    angularSizeArcmin,
    intrinsicContrast: intrinsic,
    apparentContrastValue: cApp,
    transmittance: T,
    resolvable,
    mullionBlocked: mull,
    buildingBlocked: blocker !== null,
    blocker,
    pass: !blocker && resolvable && !mull,
  };
}

/** 全景采样: 每个方位角步长上的最近建筑遮挡俯仰角(度, 正=俯角), 供全景叠加 */
export function skylineProfile(
  eye: EyePoint,
  buildings: Building[],
  azimuthStepDeg = 0.5,
): { azimuth: number; maxDip: number; blockerId: string | null }[] {
  const out: { azimuth: number; maxDip: number; blockerId: string | null }[] = [];
  const range = 8000; // 8km 足够覆盖机场周边建筑
  for (let az = 0; az < 360; az += azimuthStepDeg) {
    const v = headingToVec(az);
    const target: Vec3 = { x: eye.x + v.x * range, y: eye.y + v.y * range, z: 0 };
    let maxDip = -90;
    let blockerId: string | null = null;
    for (const b of buildings) {
      const hits = segmentPolygonIntersections(eye.x, eye.y, target.x, target.y, b.polygon);
      for (const hit of hits) {
        if (hit.t <= 0 || hit.t >= 1) continue;
        const horiz = range * hit.t;
        // 屋顶相对眼位的俯视角: 建筑在该方位上填满天空的下界角度
        // (无论眼位是否高于屋顶, 屋顶方向都是被实体占据的)
        const dipRoof = Math.atan2(eye.z - b.height, horiz) * RAD;
        if (dipRoof > maxDip) {
          maxDip = dipRoof;
          blockerId = b.id;
        }
      }
    }
    out.push({ azimuth: az, maxDip, blockerId });
  }
  return out;
}
