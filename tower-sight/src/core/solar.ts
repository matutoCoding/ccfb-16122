// 太阳位置算法:NOAA Solar Position Algorithm 简化版
// 参考: NOAA ESRL Solar Calculation Reference (gml.noaa.gov/grad/solcalc)
// 输出方位角为北=0°顺时针,高度角分几何值与大气折射修正值
import { DEG, RAD, clamp, normAngle360 } from './math';

export interface SolarInput {
  latitude: number; // 度
  longitude: number; // 度, 东经为正
  date: string; // YYYY-MM-DD(本地日期)
  time: string; // HH:MM(本地标准时间)
  timezone: number; // 时区小时(东为正, 中国 +8)
}

export interface SolarPosition {
  julianDay: number;
  declination: number; // 太阳赤纬(度)
  equationOfTime: number; // 时差(分钟)
  hourAngle: number; // 时角(度), 正午为0, 下午为正
  zenith: number; // 天顶角(度)
  elevation: number; // 几何高度角(度, 未修正折射)
  elevationApparent: number; // 视高度角(含大气折射, 度)
  azimuth: number; // 方位角(度, 北=0 顺时针)
  trueSolarTimeMin: number; // 真太阳时(分钟, 从子夜起)
}

/** 本地日期时间 -> 儒略日(含 UT 日小数) */
export function julianDay(date: string, time: string, timezone: number): number {
  const [y0, m0, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  let year = y0;
  let month = m0;
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  const jd0 =
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    d +
    B -
    1524.5;
  const utHours = hh + mm / 60 - timezone;
  return jd0 + utHours / 24;
}

/** NOAA 标准大气折射修正(度),入参为未修正高度角(度) */
export function atmosphericRefraction(elevDeg: number): number {
  if (elevDeg > 85) return 0;
  const h = elevDeg * DEG;
  if (elevDeg > 5) {
    return 1 / Math.tan(h) / 60;
  }
  if (elevDeg > -0.575) {
    return (
      (1735 +
        elevDeg *
          (-518.2 + elevDeg * (103.4 + elevDeg * (-12.79 + elevDeg * 0.711)))) /
      3600
    );
  }
  return -20.772 / Math.tan(h) / 3600;
}

export function solarPosition(inp: SolarInput): SolarPosition {
  const { latitude, longitude, timezone } = inp;
  const [, , day] = inp.date.split('-').map(Number);
  const [hh, mm] = inp.time.split(':').map(Number);

  const JD = julianDay(inp.date, inp.time, timezone);
  const T = (JD - 2451545) / 36525; // 儒略世纪

  // 几何平黄经
  const L0 = normAngle360(280.46646 + T * (36000.76983 + 0.0003032 * T));
  // 平近点角
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  // 地球轨道偏心率
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  // 太阳中心差
  const Mr = M * DEG;
  const C =
    Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * Mr) * 0.000289;
  // 真黄经 / 视黄经
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);
  // 黄赤交角
  const meanObliq =
    23 +
    (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * DEG);
  // 赤纬
  const decl = Math.asin(Math.sin(obliq * DEG) * Math.sin(appLong * DEG)) * RAD;

  // 时差(分钟)
  const y = Math.tan((obliq / 2) * DEG) ** 2;
  const eqTime =
    4 *
    RAD *
    (
      y * Math.sin(2 * L0 * DEG) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0 * DEG) -
      0.5 * y * y * Math.sin(4 * L0 * DEG) -
      1.25 * e * e * Math.sin(2 * Mr)
    );

  // 真太阳时与时角
  const localMinutes = hh * 60 + mm;
  const tst = localMinutes + eqTime + 4 * longitude - 60 * timezone;
  let ha = tst / 4 - 180;
  // 极昼/极夜区域 ha 可超出, 仅归一化到 [-180,180)
  ha = ((ha + 180) % 360 + 360) % 360 - 180;

  const latR = latitude * DEG;
  const declR = decl * DEG;
  const haR = ha * DEG;
  const cosZen =
    Math.sin(latR) * Math.sin(declR) +
    Math.cos(latR) * Math.cos(declR) * Math.cos(haR);
  const zenith = Math.acos(clamp(cosZen, -1, 1)) * RAD;
  const elevation = 90 - zenith;

  // 方位角(北=0 顺时针)
  // NOAA 的 acos 结果以正南为零轴: 上午向西... 实测换算为
  // 上午(HRA<0): 180-raw; 下午(HRA>0): 180+raw; 正午 raw≈0 → 180
  const rawAz =
    Math.acos(
      clamp(
        (Math.sin(latR) * cosZen - Math.sin(declR)) /
          (Math.cos(latR) * Math.sin(zenith * DEG) || 1e-12),
        -1,
        1,
      ),
    ) * RAD;
  const az = normAngle360(ha < 0 ? 180 - rawAz : 180 + rawAz);

  const refr = atmosphericRefraction(elevation);

  return {
    julianDay: JD,
    declination: decl,
    equationOfTime: eqTime,
    hourAngle: ha,
    zenith,
    elevation,
    elevationApparent: elevation + refr,
    azimuth: az,
    trueSolarTimeMin: ((tst % 1440) + 1440) % 1440,
  };
}

/** 太阳方向单位向量: x=东, y=北, z=上(高度角取视高度) */
export function sunDirection(azimuthDeg: number, elevationDeg: number): { x: number; y: number; z: number } {
  const az = azimuthDeg * DEG;
  const el = elevationDeg * DEG;
  const ce = Math.cos(el);
  return { x: ce * Math.sin(az), y: ce * Math.cos(az), z: Math.sin(el) };
}

/** 昼长(小时), 极昼/极夜返回 null 并在标志位说明 */
export function dayLength(latDeg: number, declDeg: number): { hours: number | null; polar: 'none' | 'day' | 'night' } {
  const lat = latDeg * DEG;
  const dec = declDeg * DEG;
  const cosH = -Math.tan(lat) * Math.tan(dec);
  if (cosH < -1) return { hours: null, polar: 'day' };
  if (cosH > 1) return { hours: null, polar: 'night' };
  return { hours: 2 * Math.acos(cosH) * RAD / 15, polar: 'none' };
}

/** 一年中的第几天(1..366) */
export function dayOfYear(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const n1 = Date.UTC(y, 0, 1);
  const n2 = Date.UTC(y, m - 1, d);
  return Math.round((n2 - n1) / 86400000) + 1;
}

/** 年积日 -> 日期字符串(平年 365 天) */
export function dateFromDayOfYear(year: number, doy: number): string {
  const ms = Date.UTC(year, 0, 1) + (doy - 1) * 86400000;
  const dt = new Date(ms);
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${year}-${m}-${d}`;
}
