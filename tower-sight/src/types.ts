// 全局数据模型:坐标统一为机场平面坐标 x=东(米), y=北(米), z=标高(米, 黄海高程)

export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type StripKind = 'runway' | 'taxiway' | 'link';

/** 跑道 / 滑行道 / 联络道:折线(跑道取两端直线)+ 宽度 */
export interface Strip {
  id: string;
  kind: StripKind;
  name: string;
  points: Vec2[]; // 中心线点列
  width: number; // 米
  // 跑道专用:两端号码方位(度, 真方位),用于关键点跳转/眩光时段表
  endA?: { name: string; heading: number };
  endB?: { name: string; heading: number };
}

/** 机坪:多边形区域 */
export interface Apron {
  id: string;
  name: string;
  polygon: Vec2[];
}

/** 建筑(航站楼/机库等):平面轮廓 + 高度 */
export interface Building {
  id: string;
  name: string;
  polygon: Vec2[];
  height: number; // 建筑顶标高(米)
  color: [number, number, number]; // 0..1 线性 RGB
}

export type AircraftType = 'A320' | 'ATR72' | 'GA';

export interface AircraftSpec {
  type: AircraftType;
  label: string;
  length: number; // 机身长 米
  wingspan: number; // 翼展 米
  height: number; // 机身高 米
  color: [number, number, number];
}

export interface Aircraft {
  id: string;
  type: AircraftType;
  pos: Vec2;
  heading: number; // 机头方位 度(真方位, 北=0 顺时针)
  onGround: boolean;
}

/** 塔台候选 */
export interface TowerCandidate {
  id: string;
  name: string;
  pos: Vec2;
  floorElev: number; // 管制室地板标高(米)
  eyeHeight: number; // 眼位高于地板(米, 一般 1.2)
  /** 窗框竖梃 */
  mullionWidth: number; // 竖梃宽度(毫米)
  mullionCount: number; // 竖梃根数(均布一圈)
  mullionCant: number; // 外倾角(度, 竖梃相对铅垂向外倾斜)
  cabDiameter: number; // 管制室直径(米), 竖梃所在圆周
}

export interface WeatherPreset {
  id: string;
  name: string;
  visibility: number; // 地面气象能见度(米)
  haze: number; // 霾浓度 0..1(气溶胶光学厚度系数)
  humidity: number; // 相对湿度 0..1
  /** 全年典型出现小时数(批量统计用) */
  annualHours: number;
}

/** 天空/时刻设置 */
export interface SkySettings {
  latitude: number; // 度
  longitude: number; // 度
  date: string; // YYYY-MM-DD
  time: string; // HH:MM (本地标准时间, 不含夏令时)
  timezone: number; // 时区小时(中国 +8)
  turbidity: number; // 大气浊度
  exposure: number;
}

export interface BaseMapImage {
  name: string;
  dataUrl: string;
  // 图上两个参考点对应机场坐标,用于配准描图
  p1: { img: Vec2; world: Vec2 };
  p2: { img: Vec2; world: Vec2 };
  opacity: number;
}

export interface CoverageSettings {
  cellSize: number; // 网格边长(米)
  minDipAngle: number; // 最小俯视角(度), 低于即不合格
  minVisibility: number; // 最低能见度要求(米)
}

export interface AirportScheme {
  id: string;
  name: string;
  updatedAt: number;
  strips: Strip[];
  aprons: Apron[];
  buildings: Building[];
  aircraft: Aircraft[];
  towers: TowerCandidate[];
  weather: WeatherPreset[];
  baseMap: BaseMapImage | null;
  coverage: CoverageSettings;
  sky: SkySettings;
}

/** 覆盖网格单格结果 */
export interface CoverageCell {
  cx: number;
  cy: number;
  blocked: boolean;
  blockerBuildingId: string | null;
  dipAngle: number; // 俯视角(度), 负=仰视
  visibilityOk: boolean;
  mullionBlocked: boolean;
  pass: boolean;
}

export interface GlareWindow {
  date: string;
  start: string;
  end: string;
  durationMin: number;
  targetName: string; // 重叠的跑道端/方位名称
  minAngle: number; // 时段内最小夹角(度)
}

export interface AnnualStat {
  towerId: string;
  weatherId: string;
  glareHours: number;
  failHours: number;
  totalHours: number;
}

export interface ComparisonReport {
  id: string;
  name: string;
  createdAt: number;
  towerIds: string[];
  rows: ReportRow[];
  thumbnails: Record<string, string>; // towerId -> dataURL
}

export interface ReportRow {
  towerId: string;
  towerName: string;
  totalHeight: number; // 地板标高
  coverageRate: number; // 0..1
  glareHours: number;
  failHours: number;
  mullionBlockedRate: number;
}

export const AIRCRAFT_SPECS: Record<AircraftType, AircraftSpec> = {
  A320: { type: 'A320', label: '空客 A320', length: 37.57, wingspan: 35.8, height: 11.76, color: [0.82, 0.85, 0.9] },
  ATR72: { type: 'ATR72', label: 'ATR 72', length: 27.17, wingspan: 27.05, height: 7.65, color: [0.78, 0.8, 0.84] },
  GA: { type: 'GA', label: '小型通航机', length: 8.0, wingspan: 11.0, height: 3.0, color: [0.9, 0.82, 0.6] },
};
