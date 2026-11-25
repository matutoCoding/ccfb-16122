// 测试机场自动生成: 2800m 跑道 + 平行滑行道 + 联络道 + 机坪 + 东侧大机库
import type {
  AirportScheme, Aircraft, Building, CoverageSettings, SkySettings,
  Strip, Apron, TowerCandidate, WeatherPreset,
} from '../types';
import { uid } from './math';
import { rectPolygon } from './geometry';

export const DEFAULT_WEATHER: WeatherPreset[] = [
  { id: 'w_clear', name: '晴天', visibility: 15000, haze: 0.05, humidity: 0.45, annualHours: 4200 },
  { id: 'w_mist', name: '轻雾', visibility: 2500, haze: 0.25, humidity: 0.85, annualHours: 1800 },
  { id: 'w_haze', name: '霾', visibility: 3500, haze: 0.85, humidity: 0.6, annualHours: 1400 },
  { id: 'w_backlit', name: '逆光清晨', visibility: 9000, haze: 0.2, humidity: 0.7, annualHours: 650 },
];

export const DEFAULT_SKY: SkySettings = {
  latitude: 36.5,
  longitude: 117.5,
  date: '2026-06-21',
  time: '07:30',
  timezone: 8,
  turbidity: 2.5,
  exposure: 1.0,
};

export const DEFAULT_COVERAGE: CoverageSettings = {
  cellSize: 50,
  minDipAngle: 0.5,
  minVisibility: 3000,
};

export function createTestAirport(name = '支线测试机场'): AirportScheme {
  // 跑道沿南北向布置, 中心在原点; 北端 09 号... 本例磁差忽略, 真方位:
  // 北端头(朝北) = 360, 南端头(朝南) = 180
  const rwLen = 2800;
  const half = rwLen / 2;

  const runway: Strip = {
    id: uid('rw'),
    kind: 'runway',
    name: 'RWY 18/36',
    width: 45,
    points: [{ x: 0, y: -half }, { x: 0, y: half }],
    endA: { name: '36', heading: 360 },
    endB: { name: '18', heading: 180 },
  };

  // 平行滑行道, 位于跑道东侧 180m
  const taxiOffset = 180;
  const taxiLen = rwLen - 200;
  const taxiway: Strip = {
    id: uid('tw'),
    kind: 'taxiway',
    name: '平行滑行道 A',
    width: 23,
    points: [
      { x: taxiOffset, y: -taxiLen / 2 },
      { x: taxiOffset, y: taxiLen / 2 },
    ],
  };

  // 两端联络道 + 中间联络道
  const links: Strip[] = [
    {
      id: uid('lk'), kind: 'link', name: '联络道 B1', width: 18,
      points: [{ x: 0, y: -half + 200 }, { x: taxiOffset, y: -half + 200 }],
    },
    {
      id: uid('lk'), kind: 'link', name: '联络道 B2', width: 18,
      points: [{ x: 0, y: half - 200 }, { x: taxiOffset, y: half - 200 }],
    },
    {
      id: uid('lk'), kind: 'link', name: '联络道 B3', width: 18,
      points: [{ x: 0, y: 0 }, { x: taxiOffset, y: 0 }],
    },
  ];

  // 机坪: 滑行道东侧
  const apron: Apron = {
    id: uid('ap'),
    name: '站坪 1',
    polygon: rectPolygon(taxiOffset + 220, -300, 320, 480),
  };

  // 东侧大机库(验收要素: 下午遮挡西侧滑行道视线)
  const hangar: Building = {
    id: uid('bd'),
    name: '东侧大机库',
    polygon: rectPolygon(taxiOffset + 260, 400, 120, 90),
    height: 28,
    color: [0.62, 0.64, 0.68],
  };
  const terminal: Building = {
    id: uid('bd'),
    name: '航站楼',
    polygon: rectPolygon(taxiOffset + 240, -480, 150, 70),
    height: 22,
    color: [0.72, 0.7, 0.62],
  };

  // 两个候选塔台: 跑道与滑行道之间偏南 / 机坪附近
  const towers: TowerCandidate[] = [
    {
      id: uid('twr'),
      name: '候选 T1(跑道西侧)',
      pos: { x: -120, y: -250 },
      floorElev: 32,
      eyeHeight: 1.2,
      mullionWidth: 120,
      mullionCount: 8,
      mullionCant: 15,
      cabDiameter: 7,
    },
    {
      id: uid('twr'),
      name: '候选 T2(机坪侧)',
      pos: { x: taxiOffset + 60, y: -50 },
      floorElev: 38,
      eyeHeight: 1.2,
      mullionWidth: 100,
      mullionCount: 10,
      mullionCant: 12,
      cabDiameter: 7,
    },
  ];

  // 跑道两端与滑行道上的机型
  const aircraft: Aircraft[] = [
    { id: uid('ac'), type: 'A320', pos: { x: 0, y: -half + 150 }, heading: 360, onGround: true },
    { id: uid('ac'), type: 'ATR72', pos: { x: taxiOffset, y: 200 }, heading: 360, onGround: true },
    { id: uid('ac'), type: 'GA', pos: { x: taxiOffset + 220, y: -350 }, heading: 180, onGround: true },
  ];

  return {
    id: uid('scheme'),
    name,
    updatedAt: Date.now(),
    strips: [runway, taxiway, ...links],
    aprons: [apron],
    buildings: [hangar, terminal],
    aircraft,
    towers,
    weather: DEFAULT_WEATHER.map((w) => ({ ...w })),
    baseMap: null,
    coverage: { ...DEFAULT_COVERAGE },
    sky: { ...DEFAULT_SKY },
  };
}
