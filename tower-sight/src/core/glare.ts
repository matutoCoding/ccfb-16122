// 眩光分析: 低角度太阳与跑道端/关键点方位重叠时段扫描
import type { AirportScheme, GlareWindow, TowerCandidate, WeatherPreset } from '../types';
import { solarPosition } from './solar';
import { angleDelta, clamp, normAngle360 } from './math';
import { weatherTransmittance } from './atmosphere';
import { isMullionBlocked, towerEye, sightGeometry } from './visibility';

export interface GlareRule {
  /** 触发眩光的最大太阳高度角(度) */
  maxElevation: number;
  /** 太阳方位与目标方位的最大夹角(度), 结合人眼眩光视场取 ~20 */
  azimuthTolerance: number;
  /** 扫描步长(分钟) */
  stepMin: number;
}

export const DEFAULT_GLARE_RULE: GlareRule = {
  maxElevation: 30,
  azimuthTolerance: 20,
  stepMin: 5,
};

export interface GlareTarget {
  name: string;
  heading: number; // 从塔台看该目标的方位(度)
}

/** 从方案提取眩光检查目标: 跑道两端、滑行道交叉口 */
export function glareTargets(scheme: AirportScheme, tower: TowerCandidate): GlareTarget[] {
  const eye = towerEye(tower);
  const targets: GlareTarget[] = [];
  for (const s of scheme.strips) {
    if (s.kind !== 'runway' || s.points.length < 2) continue;
    const ends = [s.points[0], s.points[s.points.length - 1]];
    ends.forEach((p, i) => {
      const geo = sightGeometry(eye, p);
      const label = s.endA && i === 0 ? `${s.name} ${s.endA.name}` :
        s.endB && i === 1 ? `${s.name} ${s.endB.name}` : `${s.name} 端${i + 1}`;
      targets.push({ name: label, heading: geo.heading });
    });
  }
  // 滑行道交叉口(折线折点)
  for (const s of scheme.strips) {
    if (s.kind !== 'taxiway') continue;
    for (let i = 1; i < s.points.length - 1; i++) {
      const geo = sightGeometry(eye, s.points[i]);
      targets.push({ name: `${s.name} 交叉口${i}`, heading: geo.heading });
    }
  }
  return targets;
}

interface ScanPoint {
  time: string;
  azimuth: number;
  elevation: number;
  glare: boolean;
  target: string | null;
  minAngle: number;
}

/** 单日扫描, 返回原始点序列(供画眩光带)与合并后的时段 */
export function scanDayGlare(
  scheme: AirportScheme,
  tower: TowerCandidate,
  date: string,
  rule: GlareRule = DEFAULT_GLARE_RULE,
): { points: ScanPoint[]; windows: GlareWindow[] } {
  const { sky } = scheme;
  const targets = glareTargets(scheme, tower);
  const points: ScanPoint[] = [];
  const windows: GlareWindow[] = [];

  let current: { target: string; startMin: number; endMin: number; minAngle: number } | null = null;

  for (let mins = 5 * 60; mins <= 19 * 60; mins += rule.stepMin) {
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    const time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const sp = solarPosition({
      latitude: sky.latitude, longitude: sky.longitude, date, time, timezone: sky.timezone,
    });
    let glare = false;
    let targetName: string | null = null;
    let minAngle = 999;

    if (sp.elevation > 0 && sp.elevation <= rule.maxElevation) {
      for (const t of targets) {
        const d = Math.abs(angleDelta(sp.azimuth, t.heading));
        if (d < minAngle) minAngle = d;
        if (d <= rule.azimuthTolerance) {
          glare = true;
          targetName = t.name;
        }
      }
      // 竖梃恰好挡住太阳方位时不计眩光
      if (glare && isMullionBlocked(tower, sp.azimuth, sp.elevation)) {
        glare = false;
      }
    }
    points.push({ time, azimuth: sp.azimuth, elevation: sp.elevation, glare, target: targetName, minAngle });

    if (glare && targetName) {
      if (current && current.target === targetName) {
        current.endMin = mins;
        current.minAngle = Math.min(current.minAngle, minAngle);
      } else {
        if (current) windows.push(finalizeWindow(date, current));
        current = { target: targetName, startMin: mins, endMin: mins, minAngle };
      }
    } else if (current) {
      windows.push(finalizeWindow(date, current));
      current = null;
    }
  }
  if (current) windows.push(finalizeWindow(date, current));
  return { points, windows };
}

function finalizeWindow(
  date: string, c: { target: string; startMin: number; endMin: number; minAngle: number },
): GlareWindow {
  const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return {
    date,
    start: fmt(c.startMin),
    end: fmt(c.endMin),
    durationMin: c.endMin - c.startMin + DEFAULT_GLARE_RULE.stepMin,
    targetName: c.target,
    minAngle: Math.round(c.minAngle * 10) / 10,
  };
}

/** 全年眩光小时数: 按月抽样(每月 1 日与 15 日)推算全年 */
export function annualGlareHours(
  scheme: AirportScheme,
  tower: TowerCandidate,
  rule: GlareRule = DEFAULT_GLARE_RULE,
): { hours: number; windows: GlareWindow[] } {
  const year = Number(scheme.sky.date.slice(0, 4));
  const sampleDates: string[] = [];
  for (let m = 1; m <= 12; m++) {
    sampleDates.push(`${year}-${String(m).padStart(2, '0')}-01`);
    sampleDates.push(`${year}-${String(m).padStart(2, '0')}-15`);
  }
  let totalMin = 0;
  const windows: GlareWindow[] = [];
  for (const d of sampleDates) {
    const { windows: w } = scanDayGlare(scheme, tower, d, rule);
    for (const win of w) {
      totalMin += win.durationMin;
      windows.push(win);
    }
  }
  // 24 个样本日代表 365 天
  return { hours: (totalMin / 60) * (365 / sampleDates.length), windows };
}

export interface AnnualFailResult {
  towerId: string;
  glareHours: number;
  failHours: number;
  byWeather: { weatherId: string; failHours: number }[];
}

/**
 * 全年视认不合格小时批量统计
 * 对每个天气预设: 在其 annualHours 内, 按覆盖网格通过率折算不合格小时
 * (天气越差/覆盖率越低, 不合格小时越多), 再叠加眩光小时
 */
export function annualFailStats(
  scheme: AirportScheme,
  tower: TowerCandidate,
  coveragePassRate: number,
  weatherList: WeatherPreset[],
): AnnualFailResult {
  const { hours: glareHours } = annualGlareHours(scheme, tower);
  const byWeather: { weatherId: string; failHours: number }[] = [];
  let failHours = 0;

  for (const w of weatherList) {
    // 该天气下的距离衰减不合格比例: 用 3km 典型活动区距离估透射率
    const T3km = weatherTransmittance(w, 3000);
    const weatherPenalty = clamp(1 - T3km, 0, 1) * 0.5;
    const failRate = clamp((1 - coveragePassRate) + weatherPenalty, 0, 1);
    const wh = w.annualHours * failRate;
    byWeather.push({ weatherId: w.id, failHours: Math.round(wh * 10) / 10 });
    failHours += wh;
  }

  return {
    towerId: tower.id,
    glareHours: Math.round(glareHours * 10) / 10,
    failHours: Math.round(failHours * 10) / 10,
    byWeather,
  };
}

/** 当前时刻太阳是否处于眩光状态(全景页面实时标记用) */
export function currentGlareState(
  scheme: AirportScheme,
  tower: TowerCandidate,
  rule: GlareRule = DEFAULT_GLARE_RULE,
): { glare: boolean; target: string | null; angle: number; elevation: number; azimuth: number } {
  const sp = solarPosition(scheme.sky);
  const targets = glareTargets(scheme, tower);
  let best: { target: string | null; angle: number } = { target: null, angle: 999 };
  for (const t of targets) {
    const d = Math.abs(angleDelta(sp.azimuth, t.heading));
    if (d < best.angle) best = { target: t.name, angle: d };
  }
  const lowSun = sp.elevation > 0 && sp.elevation <= rule.maxElevation;
  const inCone = best.angle <= rule.azimuthTolerance;
  const mullion = isMullionBlocked(tower, sp.azimuth, sp.elevation);
  return {
    glare: lowSun && inCone && !mullion,
    target: inCone ? best.target : null,
    angle: Math.round(best.angle * 10) / 10,
    elevation: sp.elevation,
    azimuth: normAngle360(sp.azimuth),
  };
}
