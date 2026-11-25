// 塔台候选页: 候选管理、几何参数、竖梃遮挡扇区图
import type { TowerCandidate } from '../../types';
import { store } from '../store';
import { h, clear, button, labeledField, numberInput, slider, selectInput, badge } from '../dom';
import { mullionAngularWidth, mullionHeadings, towerEye, isMullionBlocked } from '../../core/visibility';
import { DEG } from '../../core/math';

export class TowerPage {
  private canvas!: HTMLCanvasElement;

  render(wrap: HTMLElement) {
    clear(wrap);
    const s = store.scheme;
    const tower = store.tower;

    const towerSelector = selectInput(
      tower.id,
      s.towers.map((t) => ({ value: t.id, label: t.name })),
      (id) => store.selectTower(id),
    );

    wrap.append(
      h('div', { class: 'page-head' }, [
        h('h2', {}, ['塔台候选位置']),
        towerSelector,
        button('新增候选(先在机场方案页放置)', () => store.goto('airport'), 'ghost'),
      ]),
      h('div', { class: 'two-col' }, [
        this.paramPanel(tower),
        h('div', { class: 'panel' }, [
          h('h3', {}, ['竖梃遮挡方位图(极坐标, 北朝上)']),
          this.mullionDiagram(tower),
          h('h3', {}, ['眼位与遮挡摘要']),
          this.summary(tower),
        ]),
      ]),
    );
    this.drawMullion(tower);
  }

  private paramPanel(t: TowerCandidate): HTMLElement {
    const update = (fn: (x: TowerCandidate) => void) =>
      store.update((s) => {
        const target = s.towers.find((x) => x.id === t.id);
        if (target) fn(target);
      });

    const nameInput = h('input', { type: 'text', value: t.name });
    nameInput.addEventListener('change', () => update((x) => { x.name = nameInput.value; }));

    return h('div', { class: 'panel' }, [
      h('h3', {}, ['位置与高度']),
      labeledField('候选名称', nameInput),
      h('div', { class: 'form-row' }, [
        labeledField('X(东向, 米)', numberInput(t.pos.x, 1, (v) => update((x) => x.pos.x = v))),
        labeledField('Y(北向, 米)', numberInput(t.pos.y, 1, (v) => update((x) => x.pos.y = v))),
      ]),
      h('div', { class: 'form-row' }, [
        labeledField('管制室地板标高(米)', numberInput(t.floorElev, 0.5, (v) => update((x) => x.floorElev = v), 0)),
        labeledField('眼高(米)', numberInput(t.eyeHeight, 0.1, (v) => update((x) => x.eyeHeight = v), 0)),
      ]),
      h('h3', {}, ['窗框竖梃']),
      labeledField(`竖梃宽度(毫米): ${t.mullionWidth}`,
        slider(t.mullionWidth, 0, 400, 10, (v) => update((x) => x.mullionWidth = v))),
      labeledField(`竖梃根数: ${t.mullionCount}`,
        slider(t.mullionCount, 0, 24, 1, (v) => update((x) => x.mullionCount = v))),
      labeledField(`外倾角(度): ${t.mullionCant}`,
        slider(t.mullionCant, 0, 45, 1, (v) => update((x) => x.mullionCant = v))),
      labeledField('管制室直径(米)', numberInput(t.cabDiameter, 0.5, (v) => update((x) => x.cabDiameter = v), 3)),
      h('p', { class: 'hint' }, [
        '竖梃按均布一圈排列(第一根朝正北)。外倾角越大,竖梃在水平视线方向的有效投影越宽,',
        '被遮挡的方位扇区随之增大,分析时按角宽计入覆盖网格与眩光判定。',
      ]),
    ]);
  }

  private mullionDiagram(t: TowerCandidate): HTMLElement {
    this.canvas = h('canvas', { class: 'mullion-canvas', width: 360, height: 360 });
    return h('div', { class: 'diagram-wrap' }, [this.canvas]);
  }

  private drawMullion(t: TowerCandidate) {
    const ctx = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const cx = W / 2;
    const cy = W / 2;
    const R = W / 2 - 30;
    ctx.clearRect(0, 0, W, W);

    // 背景圆盘
    ctx.fillStyle = '#11181f';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();

    const halfW = mullionAngularWidth(t) / 2;
    const headings = mullionHeadings(t);

    // 遮挡扇区
    ctx.fillStyle = 'rgba(232, 92, 76, 0.55)';
    for (const hd of headings) {
      const a0 = ((hd - halfW) * DEG) - Math.PI / 2; // canvas 角度: 北朝上(-90°偏移)
      const a1 = ((hd + halfW) * DEG) - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, a0, a1);
      ctx.closePath();
      ctx.fill();
    }

    // 方位刻度
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '11px sans-serif';
    for (let az = 0; az < 360; az += 30) {
      const a = az * DEG - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6));
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
      if (az % 90 === 0) {
        const label = az === 0 ? 'N 0°' : az === 90 ? 'E 90°' : az === 180 ? 'S 180°' : 'W 270°';
        ctx.fillText(label, cx + Math.cos(a) * (R + 14) - 14, cy + Math.sin(a) * (R + 14) + 4);
      }
    }

    // 中心眼位
    ctx.fillStyle = '#ffb454';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    // 统计文字
    const blockedRatio = headings.length * mullionAngularWidth(t) / 360;
    ctx.fillStyle = '#fff';
    ctx.font = '12px sans-serif';
    ctx.fillText(`单根角宽 ${mullionAngularWidth(t).toFixed(2)}°`, 10, 18);
    ctx.fillText(`水平遮挡占比 ${(Math.min(blockedRatio, 1) * 100).toFixed(1)}%`, 10, 36);
  }

  private summary(t: TowerCandidate): HTMLElement {
    const eye = towerEye(t);
    const checks: [string, boolean][] = [
      ['正北方位被竖梃遮挡', isMullionBlocked(t, 0)],
      ['正东方位被竖梃遮挡', isMullionBlocked(t, 90)],
      ['正南方位被竖梃遮挡', isMullionBlocked(t, 180)],
      ['正西方位被竖梃遮挡', isMullionBlocked(t, 270)],
    ];
    return h('div', { class: 'summary-grid' }, [
      h('div', { class: 'stat' }, [h('b', {}, [eye.z.toFixed(1)]), h('span', {}, ['眼位标高(米)'])]),
      h('div', { class: 'stat' }, [h('b', {}, [String(t.mullionCount)]), h('span', {}, ['竖梃根数'])]),
      h('div', { class: 'stat' }, [h('b', {}, [`${mullionAngularWidth(t).toFixed(2)}°`]), h('span', {}, ['单根角宽'])]),
      h('div', { class: 'check-list' }, checks.map(([label, blocked]) =>
        h('div', { class: 'check-row' }, [label, blocked ? badge('遮挡', 'bad') : badge('通视', 'ok')]))),
    ]);
  }
}
