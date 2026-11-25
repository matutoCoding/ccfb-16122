// 全景视认页: 360 全景、关键点跳转、眩光扇区叠加、机型视认
import { store } from '../store';
import { h, clear, button, selectInput, table, badge } from '../dom';
import { View3D } from '../components/view3d';
import { currentGlareState, glareTargets } from '../../core/glare';
import { analyzeAircraft, sightGeometry, towerEye } from '../../core/visibility';
import { solarPosition } from '../../core/solar';
import { AIRCRAFT_SPECS } from '../../types';
import type { WeatherPreset } from '../../types';

export class PanoramaPage {
  private view: View3D | null = null;
  private canvas!: HTMLCanvasElement;
  private overlay!: HTMLCanvasElement;
  private state: HTMLElement | null = null;
  private raf = 0;

  render(wrap: HTMLElement) {
    clear(wrap);
    const s = store.scheme;
    const tower = store.tower;
    const weather = s.weather[0];

    this.canvas = h('canvas', { class: 'gpu-canvas' });
    this.overlay = h('canvas', { class: 'overlay-canvas' });
    const stage = h('div', { class: 'gpu-stage' }, [this.canvas, this.overlay]);

    const keyTargets = glareTargets(s, tower);
    const jumpButtons = keyTargets.map((t) =>
      button(t.name, () => this.view?.lookHeading(t.heading)));

    const aircraftResults = s.aircraft
      .map((ac) => ({ ac, r: analyzeAircraft(s, tower, ac.id, weather) }))
      .filter((x) => x.r);

    wrap.append(
      h('div', { class: 'page-head' }, [
        h('h2', {}, ['全景视认分析']),
        button('全景 360°', () => { this.view?.setPanorama(true); }, 'primary'),
        button('透视模式', () => { this.view?.setPanorama(false); }),
        button('眼位回到塔台', () => this.view?.placeEyeAtSelectedTower()),
      ]),
      h('div', { class: 'pan-layout' }, [
        h('div', { class: 'pan-main' }, [
          h('div', { class: 'jump-bar' }, [
            h('span', { class: 'jump-label' }, ['一键跳转关键点:']),
            ...jumpButtons,
          ]),
          stage,
          this.stateLine(),
        ]),
        h('div', { class: 'side-panel pan-side' }, [
          h('h3', {}, ['当前太阳 / 眩光']),
          this.sunPanel(),
          h('h3', {}, ['机型视认(当前晴天预设)']),
          table(
            ['机型', '距离(m)', '张角', '表观对比度', '判定'],
            aircraftResults.map(({ ac, r }) => [
              AIRCRAFT_SPECS[ac.type].label,
              Math.round(r!.distance).toString(),
              `${r!.angularSizeDeg.toFixed(2)}°`,
              r!.apparentContrastValue.toFixed(3),
              r!.pass ? badge('可辨认', 'ok') : badge('不达标', 'bad'),
            ]),
          ),
          h('p', { class: 'hint' }, [
            '鼠标拖动水平/俯仰旋转,滚轮缩放视场角。红色扇区为低角度太阳眩光区,',
            '黄色射线指向跑道端等关键点;机型低于分辨阈值时在表中标红。',
          ]),
        ]),
      ]),
    );

    this.view = new View3D(this.canvas, weather);
    void this.view.init().then((ok) => {
      if (!ok) return;
      this.view!.setPanorama(true);
      this.view!.placeEyeAtSelectedTower();
      this.view!.lookHeading(0, 2); // 近似水平, 天空与地面各半
      this.resizeOverlay();
      new ResizeObserver(() => this.resizeOverlay()).observe(stage);
      this.overlayLoop();
    });
  }

  private stateLine(): HTMLElement {
    this.state = h('div', { class: 'state-line' });
    return this.state;
  }

  private sunPanel(): HTMLElement {
    const sp = solarPosition(store.scheme.sky);
    const glare = currentGlareState(store.scheme, store.tower);
    return h('div', { class: 'sun-panel' }, [
      h('div', { class: 'sun-row' }, [
        h('span', {}, ['太阳方位角']), h('b', {}, [`${sp.azimuth.toFixed(2)}°`]),
      ]),
      h('div', { class: 'sun-row' }, [
        h('span', {}, ['太阳高度角']), h('b', {}, [`${sp.elevation.toFixed(2)}°`]),
      ]),
      h('div', { class: 'sun-row' }, [
        h('span', {}, ['视高度(含折射)']), h('b', {}, [`${sp.elevationApparent.toFixed(2)}°`]),
      ]),
      h('div', { class: 'sun-row' }, [
        h('span', {}, ['眩光状态']),
        glare.glare ? badge(`眩光: 正对 ${glare.target}`, 'bad') : badge('无眩光', 'ok'),
      ]),
    ]);
  }

  private resizeOverlay() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.overlay.width = this.canvas.clientWidth * dpr;
    this.overlay.height = this.canvas.clientHeight * dpr;
    this.overlay.style.width = `${this.canvas.clientWidth}px`;
    this.overlay.style.height = `${this.canvas.clientHeight}px`;
  }

  private overlayLoop = () => {
    this.drawOverlay();
    this.raf = requestAnimationFrame(this.overlayLoop);
  };

  private drawOverlay() {
    const cv = this.overlay;
    const ctx = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const r = this.view?.renderer;
    if (!r) return;

    const sp = solarPosition(store.scheme.sky);
    const glare = currentGlareState(store.scheme, store.tower);
    const pan = r.panoramaMode;

    // 屏幕坐标映射: 全景等距柱状
    const project = (azimuthDeg: number, pitchDeg: number): { x: number; y: number } | null => {
      if (pan) {
        const dYaw = ((azimuthDeg * Math.PI) / 180 - r.camera.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        if (Math.abs(dYaw) > r.panFov / 2) return null;
        const x = W / 2 + (dYaw / r.panFov) * W;
        const pitch = pitchDeg * Math.PI / 180;
        const vFov = r.panFov / (W / H);
        const dPitch = pitch - r.camera.pitch;
        if (Math.abs(dPitch) > vFov / 2) return null;
        const y = H / 2 - (dPitch / vFov) * H;
        return { x, y };
      }
      return null; // 透视模式只画文字状态
    };

    if (pan) {
      // 眩光扇区(太阳方位 ±20°, 低太阳)
      if (sp.elevation > 0 && sp.elevation <= 30) {
        const c = project(sp.azimuth, sp.elevation);
        if (c) {
          const grad = ctx.createRadialGradient(c.x, c.y, 4, c.x, c.y, Math.min(W, H) * 0.25);
          grad.addColorStop(0, 'rgba(255, 220, 120, 0.55)');
          grad.addColorStop(1, 'rgba(255, 120, 60, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(c.x, c.y, Math.min(W, H) * 0.25, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = glare.glare ? 'rgba(255,80,60,0.9)' : 'rgba(255,200,90,0.7)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(c.x, c.y, 14, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = `${14 * (W / 900)}px sans-serif`;
          ctx.fillText(`太阳 ${sp.azimuth.toFixed(1)}° / ${sp.elevation.toFixed(1)}°`, c.x + 18, c.y - 18);
        }
      }

      // 关键点射线
      const eye = towerEye(store.tower);
      for (const t of glareTargets(store.scheme, store.tower)) {
        const p = project(t.heading, -2);
        if (p) {
          ctx.strokeStyle = 'rgba(255, 180, 84, 0.8)';
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 6]);
          ctx.beginPath();
          ctx.moveTo(W / 2, H);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#ffb454';
          ctx.font = `${13 * (W / 900)}px sans-serif`;
          ctx.fillText(`${t.name} ${t.heading.toFixed(0)}°`, p.x + 6, p.y);
        }
      }

      // 竖梃遮挡方位竖线
      const tower = store.tower;
      if (tower.mullionCount > 0) {
        for (let az = 0; az < 360; az += 360 / tower.mullionCount) {
          const p = project(az, 0);
          if (p) {
            ctx.fillStyle = 'rgba(40, 44, 52, 0.35)';
            ctx.fillRect(p.x - 2, 0, 4, H);
          }
        }
      }

      // 罗盘刻度
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.font = `${13 * (W / 900)}px sans-serif`;
      for (let az = 0; az < 360; az += 15) {
        const p = project(az, 0);
        if (p) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath();
          ctx.moveTo(p.x, 0);
          ctx.lineTo(p.x, az % 45 === 0 ? 14 : 8);
          ctx.stroke();
          if (az % 45 === 0) ctx.fillText(`${az}°`, p.x - 12, 28);
        }
      }

      // 中心十字
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.moveTo(W / 2 - 12, H / 2); ctx.lineTo(W / 2 + 12, H / 2);
      ctx.moveTo(W / 2, H / 2 - 12); ctx.lineTo(W / 2, H / 2 + 12);
      ctx.stroke();
      void eye;
    }

    // 状态行
    if (this.state) {
      const eye = towerEye(store.tower);
      this.state.textContent =
        `眼位(${eye.x.toFixed(1)}, ${eye.y.toFixed(1)}, ${eye.z.toFixed(1)}m)  ` +
        `方位 ${(r.camera.yaw * 180 / Math.PI).toFixed(1)}°  俯仰 ${(r.camera.pitch * 180 / Math.PI).toFixed(1)}°  ` +
        `${pan ? '全景' : '透视'}  太阳 A${sp.azimuth.toFixed(1)}° E${sp.elevation.toFixed(1)}°  ` +
        (glare.glare ? `⚠ 眩光: ${glare.target}` : '无眩光');
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.view?.destroy();
  }
}
