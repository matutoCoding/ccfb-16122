import { describe, it, expect } from 'vitest';
import { createTestAirport } from './test-airport';
import {
  towerEye, lineBlockedByBuildings, mullionAngularWidth, isMullionBlocked,
  computeCoverage, analyzeAircraft, sightGeometry, skylineProfile,
} from './visibility';
import type { TowerCandidate } from '../types';

const scheme = createTestAirport();
const tower = scheme.towers[0];
const weather = scheme.weather[0];

describe('眼位与几何', () => {
  it('眼位标高 = 地板标高 + 眼高', () => {
    const eye = towerEye(tower);
    expect(eye.z).toBe(tower.floorElev + tower.eyeHeight);
  });

  it('俯视角随距离减小而增大', () => {
    const near = sightGeometry(towerEye(tower), { x: tower.pos.x + 100, y: tower.pos.y });
    const far = sightGeometry(towerEye(tower), { x: tower.pos.x + 1000, y: tower.pos.y });
    expect(near.dip).toBeGreaterThan(far.dip);
    expect(near.dip).toBeGreaterThan(0);
  });
});

describe('建筑遮挡', () => {
  const hangar = scheme.buildings.find((b) => b.name.includes('机库'))!;

  it('视线穿过矮建筑上方不被挡', () => {
    const eye = { x: -500, y: 0, z: 60 };
    const target = { x: 500, y: 0, z: 0 };
    // 机库在 (440,400) 附近, 这条 y=0 的线不经过机库
    expect(lineBlockedByBuildings(eye, target, scheme.buildings)).toBeNull();
  });

  it('低眼位看向机库另一侧被机库遮挡并可反查', () => {
    const eye = { x: hangar.polygon[0].x - 200, y: hangar.polygon[0].y, z: 5 };
    const target = {
      x: hangar.polygon[2].x + 200, y: hangar.polygon[2].y, z: 0,
    };
    const hit = lineBlockedByBuildings(eye, target, scheme.buildings);
    expect(hit).not.toBeNull();
    expect(hit!.buildingId).toBe(hangar.id);
    expect(hit!.buildingName).toContain('机库');
  });

  it('抬高眼位越过机库屋顶后不再被挡', () => {
    const hangar2 = scheme.buildings.find((b) => b.name.includes('机库'))!;
    const eye = { x: hangar2.polygon[0].x - 200, y: hangar2.polygon[0].y, z: 80 };
    const target = {
      x: hangar2.polygon[2].x + 200, y: hangar2.polygon[2].y, z: 0,
    };
    expect(lineBlockedByBuildings(eye, target, scheme.buildings)).toBeNull();
  });

  it('天际线剖面 720 个方位全覆盖', () => {
    const profile = skylineProfile(towerEye(tower), scheme.buildings, 0.5);
    expect(profile.length).toBe(720);
    const blockedDirs = profile.filter((p) => p.blockerId !== null);
    expect(blockedDirs.length).toBeGreaterThan(0);
  });
});

describe('竖梃遮挡', () => {
  it('竖梃角宽随宽度增大而增大', () => {
    const thin = mullionAngularWidth({ ...tower, mullionWidth: 50 });
    const thick = mullionAngularWidth({ ...tower, mullionWidth: 200 });
    expect(thick).toBeGreaterThan(thin);
  });

  it('外倾角增大使水平有效角宽增大', () => {
    const vertical = mullionAngularWidth({ ...tower, mullionCant: 0 });
    const canted = mullionAngularWidth({ ...tower, mullionCant: 30 });
    expect(canted).toBeGreaterThan(vertical);
  });

  it('竖梃方位(正北第一根)被挡, 间隙方位不被挡', () => {
    const t: TowerCandidate = { ...tower, mullionCount: 8, mullionWidth: 100, cabDiameter: 7 };
    expect(isMullionBlocked(t, 0)).toBe(true);
    expect(isMullionBlocked(t, 45)).toBe(true);
    // 两根竖梃中间 22.5° 附近应为间隙
    const gap = 22.5;
    const halfW = mullionAngularWidth(t) / 2;
    expect(isMullionBlocked(t, gap)).toBe(gap <= halfW || gap >= 360 - halfW);
  });

  it('零竖梃时不产生遮挡', () => {
    const t = { ...tower, mullionCount: 0, mullionWidth: 0 };
    expect(isMullionBlocked(t, 0)).toBe(false);
  });
});

describe('覆盖网格', () => {
  const cells = computeCoverage(scheme, tower, weather);

  it('活动区内生成格子且数量合理', () => {
    expect(cells.length).toBeGreaterThan(100);
  });

  it('每格判定字段完整', () => {
    const c = cells[0];
    expect(typeof c.blocked).toBe('boolean');
    expect(typeof c.pass).toBe('boolean');
    expect(c.dipAngle).toBeGreaterThanOrEqual(0);
  });

  it('被挡格子带遮挡建筑 id, 未挡格子为 null', () => {
    for (const c of cells) {
      if (c.blocked) expect(c.blockerBuildingId).not.toBeNull();
      else expect(c.blockerBuildingId).toBeNull();
    }
  });

  it('提高塔台眼位后覆盖率上升', () => {
    const low = computeCoverage(scheme, { ...tower, floorElev: 10 }, weather);
    const high = computeCoverage(scheme, { ...tower, floorElev: 80 }, weather);
    const rate = (cs: typeof cells) => cs.filter((c) => c.pass).length / cs.length;
    expect(rate(high)).toBeGreaterThanOrEqual(rate(low));
  });

  it('恶劣天气下能见度不合格格子增多', () => {
    const fog = { ...weather, visibility: 400, haze: 0.9 };
    const good = computeCoverage(scheme, tower, weather);
    const bad = computeCoverage(scheme, tower, fog);
    const failVis = (cs: typeof cells) => cs.filter((c) => !c.visibilityOk).length;
    expect(failVis(bad)).toBeGreaterThan(failVis(good));
  });
});

describe('机型视认', () => {
  it('三架飞机都能出结果', () => {
    for (const ac of scheme.aircraft) {
      const r = analyzeAircraft(scheme, tower, ac.id, weather);
      expect(r).not.toBeNull();
      expect(r!.distance).toBeGreaterThan(0);
      expect(r!.angularSizeDeg).toBeGreaterThan(0);
    }
  });

  it('张角随距离增大而减小', () => {
    const near = analyzeAircraft(scheme, tower, scheme.aircraft[0].id, weather)!;
    // 复制一架极远的飞机
    const farScheme = {
      ...scheme,
      aircraft: [{ ...scheme.aircraft[0], id: 'far_ac', pos: { x: 0, y: -5000 } }],
    };
    const far = analyzeAircraft(farScheme, tower, 'far_ac', weather)!;
    expect(far.angularSizeDeg).toBeLessThan(near.angularSizeDeg);
  });

  it('雾中远端飞机对比度衰减并可能低于分辨阈值', () => {
    const fog = { ...weather, visibility: 800, haze: 0.8 };
    const farScheme = {
      ...scheme,
      aircraft: [{ ...scheme.aircraft[0], id: 'far_ac', pos: { x: 0, y: -2600 } }],
    };
    const r = analyzeAircraft(farScheme, tower, 'far_ac', fog)!;
    expect(r.apparentContrastValue).toBeLessThan(r.intrinsicContrast);
    expect(r.transmittance).toBeLessThan(0.2);
  });
});
