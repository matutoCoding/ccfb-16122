import { describe, it, expect } from 'vitest';
import { createTestAirport } from './test-airport';
import { scanDayGlare, annualGlareHours, currentGlareState, glareTargets } from './glare';
import { solarPosition } from './solar';

const scheme = createTestAirport();
const tower = scheme.towers[0];

describe('眩光目标提取', () => {
  it('包含跑道两端', () => {
    const targets = glareTargets(scheme, tower);
    expect(targets.some((t) => t.name.includes('36'))).toBe(true);
    expect(targets.some((t) => t.name.includes('18'))).toBe(true);
  });
});

describe('单日眩光扫描', () => {
  it('夏至日扫描返回全天点列(05:00-19:00, 5分钟步长)', () => {
    const { points } = scanDayGlare(scheme, tower, '2026-06-21');
    expect(points.length).toBe((14 * 60) / 5 + 1);
  });

  it('夜间/高太阳不产生眩光; 低角度且方位重叠才产生', () => {
    const { points } = scanDayGlare(scheme, tower, '2026-06-21');
    for (const p of points) {
      if (p.glare) {
        expect(p.elevation).toBeGreaterThan(0);
        expect(p.elevation).toBeLessThanOrEqual(30);
        expect(p.target).not.toBeNull();
      }
    }
  });

  it('合并时段时间连续且时长为步长整数倍', () => {
    const { windows } = scanDayGlare(scheme, tower, '2026-06-21');
    for (const w of windows) {
      expect(w.durationMin % 5).toBe(0);
      expect(w.start < w.end).toBe(true);
    }
  });

  it('放宽方位容差后眩光时段不减', () => {
    const narrow = scanDayGlare(scheme, tower, '2026-06-21', {
      maxElevation: 30, azimuthTolerance: 5, stepMin: 5,
    });
    const wide = scanDayGlare(scheme, tower, '2026-06-21', {
      maxElevation: 30, azimuthTolerance: 40, stepMin: 5,
    });
    const sum = (ws: { durationMin: number }[]) => ws.reduce((a, w) => a + w.durationMin, 0);
    expect(sum(wide.windows)).toBeGreaterThanOrEqual(sum(narrow.windows));
  });
});

describe('全年统计与实时状态', () => {
  it('全年眩光小时为非负数', () => {
    const { hours } = annualGlareHours(scheme, tower);
    expect(hours).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(hours)).toBe(true);
  });

  it('当前时刻状态字段完整且角度来自太阳算法', () => {
    const st = currentGlareState(scheme, tower);
    const sp = solarPosition(scheme.sky);
    expect(st.azimuth).toBeCloseTo(sp.azimuth, 6);
    expect(st.elevation).toBeCloseTo(sp.elevation, 6);
    expect(typeof st.glare).toBe('boolean');
  });

  it('竖梃挡住太阳方位时眩光被消除', () => {
    // 构造竖梃极密的塔台, 任意方位都被挡
    const dense = {
      ...tower,
      mullionCount: 36,
      mullionWidth: 300,
      cabDiameter: 7,
      mullionCant: 0,
    };
    const st = currentGlareState(scheme, dense);
    expect(st.glare).toBe(false);
  });
});
