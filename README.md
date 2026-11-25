# 塔台选址与视认分析系统(ccfb-16122)

网页版支线机场塔台选址 / 视认分析工具。**TypeScript + 原生 WebGPU/WGSL**(无 Three.js 等引擎),
机场方案、塔台候选、天气预设、比选报告全部持久化在浏览器 **IndexedDB**(`tower-sight-db`)。

> 真正的应用位于子目录 **[`tower-sight/`](./tower-sight/)**,所有安装 / 运行 / 测试 / 构建都在该目录内进行。

## 快速开始

```bash
cd tower-sight
npm install
npm run dev        # 默认 http://localhost:5173 ; 验收常用 --port 36122
npm test           # 核心算法单测(太阳天文 / 大气 / 视认 / 眩光 / 矩阵逆)
npm run build      # tsc 类型检查 + vite 生产构建到 tower-sight/dist
```

需 Chrome/Edge 113+ 并启用 WebGPU(硬件加速;无头验收可加
`--enable-unsafe-webgpu --use-angle=d3d11`)。

## 页面与需求对应

| 验收页面 | 实现 |
|---|---|
| 机场方案 | Canvas2D 按坐标/宽度绘制跑道、滑行道、联络道、机坪多边形;建筑轮廓挤出体块;导入总平面图并配准描图 |
| 塔台候选 | 多候选位置;管制室地板标高、眼高;竖梃宽度/根数/均布角宽/外倾角/管制室直径;竖梃遮挡方位计入覆盖与全景 |
| 视认分析(视认全景 + 覆盖分析) | 眼位 360° 全景/透视双模式,鼠标拖动水平旋转/俯仰、滚轮缩放;一键跳转跑道两端与滑行道交叉口;机型张角/表观对比度;活动区网格逐格判定建筑遮挡(可反查遮挡建筑)、俯视角、能见度、竖梃遮挡 |
| 天空气象 | 经纬度/日期/时刻拖动,NOAA 太阳算法实时方位高度;Rayleigh+Mie 大气散射 compute LUT + 逐像素单次散射;低角度太阳眩光扇区与跑道方位重叠时段表;能见度/霾/湿度驱动 Koschmieder 消光与对比衰减;全年典型天气与批量不合格小时 |
| 比选报告 | 多候选塔高/覆盖率/眩光小时/不合格小时/竖梃遮挡占比并排,带逐塔 16:9 WebGPU 全景截图,存 IndexedDB |

测试机场自动生成:一条 2800 m 南北跑道 + 东侧 180 m 平行滑行道 + 三条联络道 + 机坪 +
东侧大机库与航站楼 + 两个塔台候选 + A320/ATR72/通航机。

## 验收要点:太阳/眩光精度

- 太阳位置:`tower-sight/src/core/solar.ts` 的 NOAA SPA 简化版(儒略日→黄经/赤纬/时差→时角→
  高度/方位,北 0° 顺时针,含 Bennett 折射)。
- 用独立 Michalsky 低精度天文算法对 7 地点 × 7 日期 × 9 时刻 = 441 个算例交叉核对:
  白天最大高度角误差约 **0.009°**、方位角误差约 **0.028°**,远优于 0.2° 验收线。
- 眩光:`tower-sight/src/core/glare.ts` 以 5 分钟步长扫描低太阳(高度 ≤30°)与跑道端/交叉口
  方位(±20°)重叠并合并时段;竖梃恰好遮挡太阳时剔除。

## 关键目录

```
tower-sight/src/core/    纯计算: solar / atmosphere / geometry / visibility / glare / storage / test-airport
tower-sight/src/render/  WebGPU: renderer / WGSL 散射天空 / 透射率 LUT / 场景网格 / 矩阵
tower-sight/src/ui/      无框架 DOM: store + 六个页面 + View3D 控制器
```
