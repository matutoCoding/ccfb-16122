// 覆盖分析页: 活动区网格覆盖图, 被挡格子反查遮挡建筑, 机型张角标注
import type { CoverageCell } from '../../types';
import { store } from '../store';
import { h, clear, button, labeledField, numberInput, slider, table, badge, selectInput } from '../dom';
import { computeCoverage, activityRegion, sightGeometry, towerEye, analyzeAircraft } from '../../core/visibility';
import { AIRCRAFT_SPECS } from '../../types';

export class CoveragePage {
  private canvas!: HTMLCanvasElement;
  private cells: CoverageCell[] = [];
  private selectedCell: CoverageCell | null = null;
  private hover: CoverageCell | null = null;
  private scale = 0.12;
  private pan = { x: 0, y: 0 };
  private weatherId: string | null = null;

  render(wrap: HTMLElement) {
    clear(wrap);
    const s = store.scheme;
    const tower = store.tower;
    if (!this.weatherId || !s.weather.some((w) => w.id === this.weatherId)) {
      this.weatherId = s.weather[0]?.id ?? null;
    }
    const weather = s.weather.find((w) => w.id === this.weatherId) ?? s.weather[0];
    this.cells = computeCoverage(s, tower, weather);

    const total = this.cells.length;
    const pass = this.cells.filter((c) => c.pass).length;
    const blocked = this.cells.filter((c) => c.blocked).length;
    const visFail = this.cells.filter((c) => !c.visibilityOk).length;
    const mullFail = this.cells.filter((c) => c.mullionBlocked).length;

    this.canvas = h('canvas', { class: 'plan-canvas coverage-canvas' });

    const aircraftRows = s.aircraft.map((ac) => {
      const r = analyzeAircraft(s, tower, ac.id, weather)!;
      return [
        AIRCRAFT_SPECS[ac.type].label,
        `${Math.round(r.distance)}`,
        `${r.angularSizeDeg.toFixed(2)}° (${r.angularSizeArcmin.toFixed(1)}′)`,
        r.apparentContrastValue.toFixed(3),
        r.buildingBlocked ? badge(`建筑: ${r.blocker?.buildingName}`, 'bad')
          : r.mullionBlocked ? badge('竖梃遮挡', 'bad')
          : r.resolvable ? badge('可辨认', 'ok') : badge('低于阈值', 'bad'),
      ];
    });

    wrap.append(
      h('div', { class: 'page-head' }, [
        h('h2', {}, ['视认覆盖分析']),
        button('重新计算', () => this.render(wrap), 'primary'),
      ]),
      h('div', { class: 'two-col' }, [
        h('div', { class: 'panel' }, [
          h('h3', {}, ['网格参数']),
          labeledField('分析天气', selectInput(
            weather.id,
            s.weather.map((w) => ({ value: w.id, label: `${w.name}(V=${w.visibility}m)` })),
            (id) => { this.weatherId = id; this.render(wrap); },
          )),
          labeledField('网格边长(米)', numberInput(s.coverage.cellSize, 10,
            (v) => store.update((d) => { d.coverage.cellSize = v; }), 10, 200)),
          labeledField(`最小俯视角: ${s.coverage.minDipAngle}°`,
            slider(s.coverage.minDipAngle, 0, 10, 0.1,
              (v) => store.update((d) => { d.coverage.minDipAngle = v; }))),
          labeledField('最低能见度要求(米)', numberInput(s.coverage.minVisibility, 100,
            (v) => store.update((d) => { d.coverage.minVisibility = v; }), 500, 10000)),
          h('h3', {}, ['统计结果']),
          h('div', { class: 'summary-grid' }, [
            h('div', { class: 'stat' }, [h('b', {}, [`${(pass / total * 100).toFixed(1)}%`]), h('span', {}, ['覆盖率'])]),
            h('div', { class: 'stat' }, [h('b', {}, [String(total)]), h('span', {}, ['活动区格子'])]),
            h('div', { class: 'stat' }, [h('b', {}, [String(blocked)]), h('span', {}, ['建筑遮挡'])]),
            h('div', { class: 'stat' }, [h('b', {}, [String(visFail)]), h('span', {}, ['能见度不足'])]),
            h('div', { class: 'stat' }, [h('b', {}, [String(mullFail)]), h('span', {}, ['竖梃遮挡'])]),
          ]),
          h('h3', {}, ['图例 / 格子反查']),
          h('div', { class: 'legend' }, [
            h('span', { class: 'legend-item' }, [h('i', { class: 'swatch sw-pass' }), '合格']),
            h('span', { class: 'legend-item' }, [h('i', { class: 'swatch sw-block' }), '建筑遮挡']),
            h('span', { class: 'legend-item' }, [h('i', { class: 'swatch sw-vis' }), '能见度不足']),
            h('span', { class: 'legend-item' }, [h('i', { class: 'swatch sw-dip' }), '俯视角不足']),
            h('span', { class: 'legend-item' }, [h('i', { class: 'swatch sw-mull' }), '竖梃遮挡']),
          ]),
          h('p', { class: 'hint' }, ['点击任意格子查看俯视角、距离、透射率与遮挡建筑反查。']),
          h('div', { id: 'cell-detail' }, [badge('未选择格子', 'info')]),
        ]),
        h('div', { class: 'panel canvas-panel' }, [
          h('div', { class: 'canvas-wrap' }, [this.canvas]),
        ]),
      ]),
      h('div', { class: 'panel' }, [
        h('h3', {}, [`机型视认结果(当前天气: ${weather.name})`]),
        table(['机型', '距离(m)', '张角', '表观对比度', '判定'], aircraftRows),
      ]),
    );

    requestAnimationFrame(() => { this.fit(); this.bind(); this.draw(); });
  }

  private fit() {
    const region = activityRegion(store.scheme);
    const w = this.canvas.clientWidth || 700;
    const h = this.canvas.clientHeight || 600;
    this.canvas.width = w;
    this.canvas.height = h;
    this.scale = Math.min(w / (region.maxX - region.minX), h / (region.maxY - region.minY)) * 0.92;
  }

  private worldToScreen(x: number, y: number) {
    return {
      x: x * this.scale + this.canvas.width / 2 + this.pan.x,
      y: -y * this.scale + this.canvas.height / 2 + this.pan.y,
    };
  }

  private screenToWorld(sx: number, sy: number) {
    return {
      x: (sx - this.pan.x - this.canvas.width / 2) / this.scale,
      y: -(sy - this.pan.y - this.canvas.height / 2) / this.scale,
    };
  }

  private bind() {
    this.canvas.onmousemove = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const w = this.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      let best: CoverageCell | null = null;
      let bd = Infinity;
      for (const c of this.cells) {
        const d = (c.cx - w.x) ** 2 + (c.cy - w.y) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      this.hover = best;
      this.draw();
    };
    this.canvas.onclick = () => {
      this.selectedCell = this.hover;
      this.showDetail();
      this.draw();
    };
  }

  private showDetail() {
    const host = document.getElementById('cell-detail');
    if (!host || !this.selectedCell) return;
    const c = this.selectedCell;
    const eye = towerEye(store.tower);
    const geo = sightGeometry(eye, { x: c.cx, y: c.cy });
    const building = store.scheme.buildings.find((b) => b.id === c.blockerBuildingId);
    host.replaceChildren(
      table(['属性', '值'], [
        ['中心坐标', `(${c.cx.toFixed(1)}, ${c.cy.toFixed(1)})`],
        ['水平距离', `${geo.distance.toFixed(1)} m`],
        ['观察方位', `${geo.heading.toFixed(1)}°`],
        ['俯视角', `${c.dipAngle.toFixed(2)}° (要求 ≥ ${store.scheme.coverage.minDipAngle}°)`],
        ['能见度', c.visibilityOk ? badge('满足', 'ok') : badge('不足', 'bad')],
        ['竖梃', c.mullionBlocked ? badge('遮挡', 'bad') : badge('无遮挡', 'ok')],
        ['遮挡建筑', building ? badge(`${building.name}(顶高 ${building.height}m)`, 'bad') : badge('无', 'ok')],
        ['综合判定', c.pass ? badge('合格', 'ok') : badge('不合格', 'bad')],
      ]),
    );
  }

  private draw() {
    const ctx = this.canvas.getContext('2d')!;
    ctx.fillStyle = '#141a16';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = store.scheme;
    const cs = s.coverage.cellSize;

    for (const c of this.cells) {
      const p = this.worldToScreen(c.cx - cs / 2, c.cy + cs / 2);
      const size = cs * this.scale;
      let color = 'rgba(94, 208, 120, 0.55)';
      if (c.blocked) color = 'rgba(232, 92, 76, 0.7)';
      else if (!c.visibilityOk) color = 'rgba(232, 170, 76, 0.7)';
      else if (c.dipAngle < s.coverage.minDipAngle) color = 'rgba(120, 140, 232, 0.7)';
      else if (c.mullionBlocked) color = 'rgba(190, 110, 220, 0.7)';
      if (this.hover === c || this.selectedCell === c) color = 'rgba(255, 255, 255, 0.85)';
      ctx.fillStyle = color;
      ctx.fillRect(p.x, p.y, Math.max(size - 1, 2), Math.max(size - 1, 2));
    }

    // 建筑轮廓叠加
    ctx.strokeStyle = '#e8c47d';
    ctx.lineWidth = 1.5;
    for (const b of s.buildings) {
      ctx.beginPath();
      b.polygon.forEach((p, i) => {
        const sp = this.worldToScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    // 塔台位置与视域连线
    const t = store.tower;
    const tp = this.worldToScreen(t.pos.x, t.pos.y);
    ctx.fillStyle = '#ffb454';
    ctx.beginPath();
    ctx.arc(tp.x, tp.y, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText(t.name, tp.x + 10, tp.y);

    // 机型位置
    for (const ac of s.aircraft) {
      const p = this.worldToScreen(ac.pos.x, ac.pos.y);
      ctx.fillStyle = '#9ed8ff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#cfeaff';
      ctx.fillText(AIRCRAFT_SPECS[ac.type].label, p.x + 7, p.y - 6);
    }
  }
}
