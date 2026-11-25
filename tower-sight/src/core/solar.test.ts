import { describe, it, expect } from 'vitest';
import {
  solarPosition,
  julianDay,
  atmosphericRefraction,
  dayLength,
  sunDirection,
} from './solar';

// NOAA ESRL《Solar Calculation Reference》公开算例
// 地点: 丹佛 39.742°N, 104.99°W; 2005-06-21 12:00, 时区 UTC-7
const noaaCase = {
  latitude: 39.742,
  longitude: -104.99,
  date: '2005-06-21',
  time: '12:00',
  timezone: -7,
};

describe('NOAA 标准算例校验', () => {
  const s = solarPosition(noaaCase);

  it('儒略日', () => {
    // 当日 0UT 的 JD = 2453542.5,12:00 本地(-7) = 19:00 UT
    expect(julianDay(noaaCase.date, noaaCase.time, noaaCase.timezone)).toBeCloseTo(
      2453543.29167,
      4,
    );
  });

  it('赤纬 ≈ 23.44°(夏至)', () => {
    expect(s.declination).toBeCloseTo(23.44, 2);
  });

  it('时差 ≈ -1.86 分钟', () => {
    expect(s.equationOfTime).toBeCloseTo(-1.86, 1);
  });

  it('真太阳时 ≈ 11:58', () => {
    const h = Math.floor(s.trueSolarTimeMin / 60);
    const m = s.trueSolarTimeMin - h * 60;
    expect(h).toBe(11);
    expect(m).toBeCloseTo(58.2, 1);
  });

  it('高度角 ≈ 73.70°(90−39.74+23.44, 正午微偏)', () => {
    expect(s.elevation).toBeCloseTo(73.7, 1);
    expect(s.zenith).toBeCloseTo(16.3, 1);
  });

  it('折射修正量在太阳高度 74° 处约 0.004°', () => {
    expect(s.elevationApparent - s.elevation).toBeGreaterThan(0);
    expect(s.elevationApparent - s.elevation).toBeLessThan(0.01);
  });

  it('方位角 ≈ 180°(正午正南, 北0顺)', () => {
    expect(Math.min(360 - s.azimuth, s.azimuth - 0)).toBeGreaterThan(178);
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(2);
  });
});

/**
 * 独立交叉验证:Meeus《Astronomical Algorithms》低精度公式,
 * 走格林尼治平恒星时(GMST)路径,与被测代码的时差(Equation of Time)路径完全独立。
 */
function meeusRef(lat: number, lon: number, date: string, time: string, tz: number) {
  const [y0, m0, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  let y = y0;
  let m = m0;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
  const jd0 =
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    d + B - 1524.5;
  const JD = jd0 + (hh + mm / 60 - tz) / 24;
  const T = (JD - 2451545) / 36525;

  // Meeus 13.1 平黄经 / 平近点角
  const L0 = (280.46646 + 36000.76983 * T + 0.0003032 * T * T) % 360;
  const M = ((357.52911 + 35999.05029 * T - 0.0001537 * T * T) % 360) * (Math.PI / 180);
  const C =
    (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  const omega = (125.04 - 1934.136 * T) * (Math.PI / 180);
  const lambda = ((L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * Math.PI) / 180;
  const eps0 =
    23 +
    (26 + (21.448 - 46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * (Math.PI / 180);

  // 赤经赤纬
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));

  // GMST(度), Meeus 12.4
  const T0 = (Math.floor(JD + 0.5) - 0.5 - 2451545) / 36525;
  const gmst =
    (280.46061837 +
      360.98564736629 * (JD - 2451545) +
      0.000387933 * T0 * T0 -
      (T0 * T0 * T0) / 38710000) %
    360;
  const lst = ((gmst + lon) * Math.PI) / 180;
  const ha = lst - ra; // 时角(弧度)

  const phi = (lat * Math.PI) / 180;
  const sinEl =
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha);
  const elevation = Math.asin(Math.max(-1, Math.min(1, sinEl))) * (180 / Math.PI);
  const az =
    (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) +
      Math.PI) *
    (180 / Math.PI);
  return { elevation, azimuth: (az + 360) % 360, declination: (dec * 180) / Math.PI };
}

describe('Meeus 独立路径交叉校核(高度角/方位角 ≤ 0.2°)', () => {
  const cases: Array<[number, number, string, string, number]> = [
    [39.5, 116.4, '2024-01-15', '08:30', 8],    // 北京 冬日上午
    [39.5, 116.4, '2024-06-21', '16:45', 8],    // 北京 夏至下午
    [22.3, 113.9, '2024-03-20', '12:10', 8],    // 深圳 春分近午
    [45.7, -108.5, '2023-12-22', '09:00', -7],  // 美国中部 冬至
    [-33.9, 151.2, '2024-09-23', '17:20', 10],  // 悉尼 秋分傍晚(南半球)
    [51.5, -0.12, '2024-07-07', '06:15', 1],    // 伦敦 清晨
    [1.35, 103.99, '2024-11-11', '19:05', 8],   // 新加坡 赤道附近
    [39.742, -104.99, '2005-06-21', '12:00', -7], // NOAA 算例点
  ];

  for (const [lat, lon, date, time, tz] of cases) {
    it(`${date} ${time} @${lat},${lon}`, () => {
      const s = solarPosition({ latitude: lat, longitude: lon, date, time, timezone: tz });
      const ref = meeusRef(lat, lon, date, time, tz);
      expect(Math.abs(s.elevation - ref.elevation)).toBeLessThan(0.2);
      // 方位角在正北附近做环形差处理
      let dAz = Math.abs(s.azimuth - ref.azimuth);
      dAz = Math.min(dAz, 360 - dAz);
      expect(dAz).toBeLessThan(0.2);
      expect(Math.abs(s.declination - ref.declination)).toBeLessThan(0.05);
    });
  }
});

describe('几何常识检验', () => {
  it('北半球正午太阳在正南(方位≈180)', () => {
    const s = solarPosition({
      latitude: 40, longitude: 116, date: '2024-04-10', time: '12:00', timezone: 8,
    });
    expect(Math.abs(s.azimuth - 180)).toBeLessThan(12);
  });

  it('春分正午高度角 ≈ 90 - |纬度|', () => {
    const s = solarPosition({
      latitude: 30, longitude: 120, date: '2024-03-20', time: '12:08', timezone: 8,
    });
    expect(s.elevation).toBeCloseTo(60, 0);
  });

  it('太阳方向向量为单位向量且水平分量与方位一致', () => {
    const s = solarPosition(noaaCase);
    const d = sunDirection(s.azimuth, s.elevationApparent);
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 9);
    expect(d.z).toBeCloseTo(Math.sin((s.elevationApparent * Math.PI) / 180), 9);
  });

  it('折射在低空为正且量级合理(NOAA 多项式地平线值 ≈0.48°)', () => {
    expect(atmosphericRefraction(0)).toBeCloseTo(0.482, 2);
    expect(atmosphericRefraction(90)).toBe(0);
    // 大气折射恒为正(始终抬升视高度),低空随高度下降快速增大
    expect(atmosphericRefraction(-5)).toBeGreaterThan(0);
    expect(atmosphericRefraction(2)).toBeGreaterThan(atmosphericRefraction(10));
  });

  it('夏至北纬70度为极昼', () => {
    const s = solarPosition({
      latitude: 70, longitude: 0, date: '2024-06-21', time: '00:30', timezone: 0,
    });
    const dl = dayLength(70, s.declination);
    expect(dl.polar).toBe('day');
  });

  it('日出方位: 赤道春分日出正东(方位≈90)', () => {
    // 赤道春分, 地方时 06:00 前后太阳在正东
    const s = solarPosition({
      latitude: 0, longitude: 0, date: '2024-03-20', time: '05:59', timezone: 0,
    });
    expect(Math.abs(s.azimuth - 90)).toBeLessThan(3);
  });

  it('下午太阳在西方(北京冬日15时方位 200~250)', () => {
    const s = solarPosition({
      latitude: 39.9, longitude: 116.4, date: '2024-01-20', time: '15:00', timezone: 8,
    });
    expect(s.azimuth).toBeGreaterThan(200);
    expect(s.azimuth).toBeLessThan(250);
  });
});
