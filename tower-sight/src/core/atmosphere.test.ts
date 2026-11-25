import { describe, it, expect } from 'vitest';
import {
  extinctionFromVisibility,
  transmittance,
  apparentContrast,
  isResolvable,
  weatherTransmittance,
  effectiveExtinction,
} from './atmosphere';

describe('Koschmieder 能见度定律', () => {
  it('能见度距离处表观对比度恰为阈值 0.05', () => {
    const V = 5000;
    const c = apparentContrast(-1, V, V, 0);
    expect(Math.abs(c)).toBeCloseTo(0.05, 3);
  });

  it('消光系数与能见度成反比', () => {
    expect(extinctionFromVisibility(1000)).toBeCloseTo(2.9957 / 1000, 5);
    expect(extinctionFromVisibility(10000)).toBeLessThan(extinctionFromVisibility(1000));
  });

  it('透射率随距离单调下降且在 (0,1]', () => {
    const t1 = transmittance(3000, 1000);
    const t2 = transmittance(3000, 5000);
    expect(t1).toBeLessThanOrEqual(1);
    expect(t2).toBeLessThan(t1);
    expect(t2).toBeGreaterThan(0);
  });

  it('零距离透射率为 1', () => {
    expect(transmittance(200, 0)).toBe(1);
  });

  it('霾浓度提高使透射率下降(不是固定白雾)', () => {
    const clean = transmittance(5000, 3000, 0);
    const hazy = transmittance(5000, 3000, 1);
    expect(hazy).toBeLessThan(clean);
  });
});

describe('目标分辨判定', () => {
  it('目标在 2.5 倍能见度距离外不可分辨', () => {
    // V 处 |C|=0.05 为临界; 2.5V 处 |C|≈0.002, 即便大目标也低于阈值
    const c = apparentContrast(-0.8, 2000, 5000, 0);
    expect(isResolvable(c, 30)).toBe(false);
  });

  it('近距离高对比目标可分辨', () => {
    const c = apparentContrast(-0.9, 5000, 500, 0);
    expect(isResolvable(c, 20)).toBe(true);
  });

  it('小目标(亚角分)需要更高对比度', () => {
    expect(isResolvable(0.06, 0.5)).toBe(false);
    expect(isResolvable(0.2, 0.5)).toBe(true);
  });
});

describe('综合天气', () => {
  const w = {
    id: 'w', name: '轻雾', visibility: 2000, haze: 0.5, humidity: 0.8, annualHours: 200,
  };

  it('综合消光不低于纯能见度消光', () => {
    expect(effectiveExtinction(w)).toBeGreaterThan(extinctionFromVisibility(w.visibility));
  });

  it('天气透射率随距离递减', () => {
    expect(weatherTransmittance(w, 4000)).toBeLessThan(weatherTransmittance(w, 500));
  });

  it('同距离下湿度增加消光增强', () => {
    const dry = effectiveExtinction({ ...w, humidity: 0.2 });
    const wet = effectiveExtinction({ ...w, humidity: 0.95 });
    expect(wet).toBeGreaterThan(dry);
  });
});
