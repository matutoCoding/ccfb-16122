// 大气透射与对比度衰减: Koschmieder 定律 + Duntley 对比传输
import { clamp, lerp } from './math';
import type { WeatherPreset } from '../types';

/**
 * 气象能见度(米) -> 消光系数(1/米)
 * Koschmieder: V = -ln(ε)/σ, 阈值对比度 ε=0.05(民航/航空气象惯例)
 */
export const CONTRAST_THRESHOLD = 0.05;

export function extinctionFromVisibility(visibilityM: number): number {
  return -Math.log(CONTRAST_THRESHOLD) / Math.max(1, visibilityM);
}

/**
 * 路径透射率 T = exp(-σ L)
 * @param visibilityM 气象能见度(米)
 * @param distanceM 视线长度(米)
 * @param hazeFactor 霾浓度 0..1, 在纯空气分子消光基础上叠加气溶胶消光(×1.0~×3.5)
 */
export function transmittance(visibilityM: number, distanceM: number, hazeFactor = 0): number {
  const base = extinctionFromVisibility(visibilityM);
  const sigma = base * (1 + clamp(hazeFactor, 0, 1) * 2.5);
  return Math.exp(-sigma * distanceM);
}

/**
 * 表观对比度(目标相对背景): C = C0 · T(Duntley, 均匀大气)
 * @param intrinsicContrast 固有对比度(负值表示比背景暗), 取绝对值与阈值比较
 */
export function apparentContrast(
  intrinsicContrast: number,
  visibilityM: number,
  distanceM: number,
  hazeFactor = 0,
): number {
  return intrinsicContrast * transmittance(visibilityM, distanceM, hazeFactor);
}

/**
 * 目标能否被分辨: |表观对比度| ≥ 人眼阈值对比度
 * 同时考虑张角修正: 小目标需要更高对比度(Baylor 型经验式, 张角单位角分)
 */
export function isResolvable(
  apparentContrastValue: number,
  angularSizeArcmin: number,
): boolean {
  // 角分辨率阈值随目标张角放宽: 1 角分目标需 0.05(Koschmieder 基准),
  // 大目标趋近 0.03; 亚角分小目标阈值快速上升
  const sizeFactor = clamp(Math.sqrt(1 / Math.max(0.2, angularSizeArcmin)), 0.6, 5);
  const required = 0.05 * sizeFactor;
  return Math.abs(apparentContrastValue) >= required;
}

/**
 * 湿度对气溶胶消光的修正(相对湿度增长因子, Hänel 经验式简化)
 * 湿度越高, 吸湿粒子膨胀, 消光增强
 */
export function humidityGrowthFactor(humidity: number): number {
  const h = clamp(humidity, 0, 0.98);
  return 1 / (1 - h * 0.85);
}

/** 综合消光系数(含霾与湿度),供着色器/批量计算统一使用 */
export function effectiveExtinction(weather: WeatherPreset): number {
  const base = extinctionFromVisibility(weather.visibility);
  const haze = base * (1 + clamp(weather.haze, 0, 1) * 2.5);
  return haze * (0.6 + 0.4 * humidityGrowthFactor(weather.humidity) / humidityGrowthFactor(0));
}

/** 距离上的透射率(综合天气) */
export function weatherTransmittance(weather: WeatherPreset, distanceM: number): number {
  return Math.exp(-effectiveExtinction(weather) * distanceM);
}

/** 雾色混合系数 = 1-T,供渲染端按像素深度做大气混合(不是一层白雾, 是深度相关) */
export function fogBlend(weather: WeatherPreset, distanceM: number): number {
  return 1 - weatherTransmittance(weather, distanceM);
}

/** 线性插值两个天气(拖滑块时平滑过渡) */
export function blendWeather(
  a: WeatherPreset,
  b: WeatherPreset,
  t: number,
): { visibility: number; haze: number; humidity: number } {
  return {
    visibility: lerp(a.visibility, b.visibility, t),
    haze: lerp(a.haze, b.haze, t),
    humidity: lerp(a.humidity, b.humidity, t),
  };
}
