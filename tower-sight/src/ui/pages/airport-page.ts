// 机场方案页: Canvas2D 顶视平面图编辑
import type { AirportScheme, Building, Strip, Vec2 } from '../../types';
import { store } from '../store';
import { h, clear, button, labeledField } from '../dom';
import { uid, dist } from '../../core/math';

type EditMode = 'select' | 'strip-runway' | 'strip-taxiway' | 'link' | 'apron' | 'building' | 'tower';

export class AirportPage {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private mode: EditMode = 'select';
  private draft: Vec2[] = [];
  private scale = 0.12; // 米 -> 像素
  private pan: Vec2 = { x: 0, y: 0 };
  private dragPan: { x: number; y: number } | null = null;
  private baseMapImg: HTMLImageElement | null = null;
  private wrap!: HTMLElement;
  private towerScreen = new WeakMap<object, { x: number; y: number }>();
  private clickHandler: ((e: MouseEvent) => void) | null = null;

  render(wrap: HTMLElement) {
    this.wrap = wrap;
    clear(wrap);
    const scheme = store.scheme;

    const toolbar = h('div', { class: 'toolbar' }, [
      button('选择/拖动', () => this.setMode('select'), this.mode === 'select' ? 'primary' : 'ghost'),
      button('跑道', () => this.setMode('strip-runway'), this.mode === 'strip-runway' ? 'primary' : 'ghost'),
      button('滑行道', () => this.setMode('strip-taxiway'), this.mode === 'strip-taxiway' ? 'primary' : 'ghost'),
      button('联络道', () => this.setMode('link'), this.mode === 'link' ? 'primary' : 'ghost'),
      button('机坪', () => this.setMode('apron'), this.mode === 'apron' ? 'primary' : 'ghost'),
      button('建筑轮廓', () => this.setMode('building'), this.mode === 'building' ? 'primary' : 'ghost'),
      button('塔台候选', () => this.setMode('tower'), this.mode === 'tower' ? 'primary' : 'ghost'),
      h('span', { class: 'toolbar-sep' }),
      button('撤销点', () => { this.draft.pop(); this.draw(); }),
      button('完成绘制', () => this.finishDraft(), 'primary'),
      button('重置测试机场', () => store.resetTestAirport(), 'danger'),
    ]);

    const side = h('div', { class: 'side-panel' }, [
      h('h3', {}, ['对象列表']),
      this.objectList(),
      h('h3', {}, ['底图描图']),
      this.baseMapControls(),
      h('h3', {}, ['绘制说明']),
      h('p', { class: 'hint' }, [
        '左键添加顶点(条带两个点即可,机坪/建筑为闭合多边形),右键或"完成绘制"闭合。',
        '滚轮缩放,中键/选择模式下左键空白拖动平移。坐标单位: 米,原点为跑道中心。',
      ]),
    ]);

    this.canvas = h('canvas', { class: 'plan-canvas' });
    const canvasWrap = h('div', { class: 'canvas-wrap' }, [this.canvas]);
    wrap.append(
      h('div', { class: 'page-head' }, [
        h('h2', {}, [`机场方案: ${scheme.name}`]),
        labeledField('方案名称', (() => {
          const inp = h('input', { type: 'text', value: scheme.name });
          inp.addEventListener('change', () => store.update((s) => { s.name = inp.value; }));
          return inp;
        })()),
      ]),
      toolbar,
      h('div', { class: 'plan-body' }, [canvasWrap, side]),
    );

    this.ctx = this.canvas.getContext('2d')!;
    this.bindCanvas();
    this.loadBaseMap();
    requestAnimationFrame(() => { this.fitView(); this.draw(); });
  }

  private setMode(m: EditMode) {
    this.mode = m;
    this.draft = [];
    this.render(this.wrap);
  }

  private objectList(): HTMLElement {
    const s = store.scheme;
    const rows: HTMLElement[] = [];
    for (const strip of s.strips) {
      rows.push(this.objectRow(`${strip.kind === 'runway' ? '🛬' : strip.kind === 'taxiway' ? '↔' : '⌐'} ${strip.name} (宽${strip.width}m)`, () => {
        const w = Number(prompt('宽度(米)', String(strip.width)));
        if (Number.isFinite(w)) store.update((d) => { strip.width = w; });
      }, () => store.update((d) => { d.strips = d.strips.filter((x) => x.id !== strip.id); })));
    }
    for (const a of s.aprons) {
      rows.push(this.objectRow(`▰ ${a.name}`, null, () => store.update((d) => { d.aprons = d.aprons.filter((x) => x.id !== a.id); })));
    }
    for (const b of s.buildings) {
      rows.push(this.objectRow(`🏢 ${b.name} (高${b.height}m)`, () => {
        const hgt = Number(prompt('建筑高度(米)', String(b.height)));
        if (Number.isFinite(hgt)) store.update((d) => { b.height = hgt; });
      }, () => store.update((d) => { d.buildings = d.buildings.filter((x) => x.id !== b.id); })));
    }
    for (const t of s.towers) {
      rows.push(this.objectRow(`🗼 ${t.name}`, null, () => store.update((d) => { d.towers = d.towers.filter((x) => x.id !== t.id); })));
    }
    return h('div', { class: 'object-list' }, rows);
  }

  private objectRow(label: string, edit: (() => void) | null, del: () => void): HTMLElement {
    return h('div', { class: 'object-row' }, [
      h('span', {}, [label]),
      h('span', { class: 'row-actions' }, [
        edit ? button('编辑', edit) : null,
        button('删除', del, 'danger'),
      ]),
    ]);
  }

  private baseMapControls(): HTMLElement {
    const file = h('input', { type: 'file', accept: 'image/*' }) as HTMLInputElement;
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        store.update((s) => {
          s.baseMap = {
            name: f.name, dataUrl, opacity: 0.5,
            p1: { img: { x: 0, y: 0 }, world: { x: -1000, y: -1000 } },
            p2: { img: { x: 100, y: 100 }, world: { x: 1000, y: 1000 } },
          };
        });
        this.loadBaseMap();
      };
      reader.readAsDataURL(f);
    });
    const opacity = labeledField('底图透明度', (() => {
      const inp = h('input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: String(store.scheme.baseMap?.opacity ?? 0.5) });
      inp.addEventListener('input', () => store.update((s) => { if (s.baseMap) s.baseMap.opacity = Number(inp.value); }));
      return inp;
    })());
    return h('div', { class: 'basemap-controls' }, [
      file,
      opacity,
      store.scheme.baseMap ? button('移除底图', () => store.update((s) => { s.baseMap = null; }), 'danger') : null,
    ]);
  }

  private loadBaseMap() {
    const bm = store.scheme.baseMap;
    if (!bm) { this.baseMapImg = null; return; }
    const img = new Image();
    img.onload = () => { this.baseMapImg = img; this.draw(); };
    img.src = bm.dataUrl;
  }

  private bindCanvas() {
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.finishDraft();
    });
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 1 || (e.button === 0 && this.mode === 'select')) {
        this.dragPan = { x: e.clientX, y: e.clientY };
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (this.dragPan) {
        this.pan.x += e.clientX - this.dragPan.x;
        this.pan.y += e.clientY - this.dragPan.y;
        this.dragPan = { x: e.clientX, y: e.clientY };
        this.draw();
      }
    });
    window.addEventListener('mouseup', () => { this.dragPan = null; });
    this.canvas.addEventListener('click', (e) => {
      if (this.mode === 'select' || e.button !== 0) return;
      const p = this.screenToWorld(e.offsetX, e.offsetY);
      if (this.mode === 'tower') {
        store.update((s) => {
          s.towers.push({
            id: uid('twr'), name: `候选 T${s.towers.length + 1}`,
            pos: p, floorElev: 35, eyeHeight: 1.2,
            mullionWidth: 120, mullionCount: 8, mullionCant: 15, cabDiameter: 7,
          });
        });
        this.setMode('select');
        return;
      }
      this.draft.push(p);
      this.draw();
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const before = this.screenToWorld(e.offsetX, e.offsetY);
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      this.scale *= factor;
      const after = this.worldToScreen(before.x, before.y);
      this.pan.x += e.offsetX - after.x;
      this.pan.y += e.offsetY - after.y;
      this.draw();
    }, { passive: false });
    const resize = () => {
      this.canvas.width = this.canvas.clientWidth;
      this.canvas.height = this.canvas.clientHeight;
      this.draw();
    };
    new ResizeObserver(resize).observe(this.canvas);
  }

  private screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: (sx - this.pan.x - this.canvas.width / 2) / this.scale,
      y: -(sy - this.pan.y - this.canvas.height / 2) / this.scale,
    };
  }

  private worldToScreen(wx: number, wy: number): { x: number; y: number } {
    return {
      x: wx * this.scale + this.canvas.width / 2 + this.pan.x,
      y: -wy * this.scale + this.canvas.height / 2 + this.pan.y,
    };
  }

  private fitView() {
    const region = (() => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const s of store.scheme.strips) for (const p of s.points) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      }
      return { minX, maxX, minY, maxY };
    })();
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    const sx = w / ((region.maxX - region.minX) * 1.4);
    const sy = h / ((region.maxY - region.minY) * 1.4);
    this.scale = Math.min(sx, sy);
    this.pan = { x: 0, y: 0 };
    this.canvas.width = w;
    this.canvas.height = h;
  }

  private finishDraft() {
    if (this.draft.length < 2) { this.draft = []; this.draw(); return; }
    const pts = this.draft;
    store.update((s) => {
      if (this.mode === 'strip-runway' || this.mode === 'strip-taxiway' || this.mode === 'link') {
        const kind: Strip['kind'] = this.mode === 'strip-runway' ? 'runway' : this.mode === 'strip-taxiway' ? 'taxiway' : 'link';
        const width = kind === 'runway' ? 45 : kind === 'taxiway' ? 23 : 18;
        const strip: Strip = {
          id: uid(kind), kind,
          name: `${kind === 'runway' ? '跑道' : kind === 'taxiway' ? '滑行道' : '联络道'} ${s.strips.filter((x) => x.kind === kind).length + 1}`,
          points: pts.map((p) => ({ ...p })),
          width,
        };
        if (kind === 'runway' && pts.length === 2) {
          const heading = (Math.atan2(pts[1].x - pts[0].x, pts[1].y - pts[0].y) * 180) / Math.PI;
          strip.endA = { name: 'A', heading: Math.round((heading + 360) % 360) };
          strip.endB = { name: 'B', heading: Math.round((heading + 180) % 360) };
        }
        s.strips.push(strip);
      } else if (this.mode === 'apron') {
        s.aprons.push({ id: uid('ap'), name: `机坪 ${s.aprons.length + 1}`, polygon: pts.map((p) => ({ ...p })) });
      } else if (this.mode === 'building') {
        const b: Building = {
          id: uid('bd'), name: `建筑 ${s.buildings.length + 1}`,
          polygon: pts.map((p) => ({ ...p })), height: 15,
          color: [0.65, 0.65, 0.68],
        };
        s.buildings.push(b);
      }
    });
    this.draft = [];
    this.setMode('select');
  }

  private draw() {
    const ctx = this.ctx;
    const s = store.scheme;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.fillStyle = '#1a2018';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // 底图(简单两点仿射配准)
    if (this.baseMapImg && s.baseMap) {
      const bm = s.baseMap;
      const dx = bm.p2.world.x - bm.p1.world.x;
      const dy = bm.p2.world.y - bm.p1.world.y;
      const di = Math.hypot(bm.p2.img.x - bm.p1.img.x, bm.p2.img.y - bm.p1.img.y) || 1;
      const dw = Math.hypot(dx, dy);
      const k = (dw / di) * this.scale;
      const p1 = this.worldToScreen(bm.p1.world.x, bm.p1.world.y);
      ctx.save();
      ctx.globalAlpha = bm.opacity;
      ctx.translate(p1.x, p1.y);
      const ang = Math.atan2(-dy, dx) - Math.atan2(bm.p2.img.y - bm.p1.img.y, bm.p2.img.x - bm.p1.img.x);
      ctx.rotate(ang);
      ctx.scale(k, k);
      ctx.drawImage(this.baseMapImg, -bm.p1.img.x, -bm.p1.img.y);
      ctx.restore();
    }

    this.drawGrid();

    // 机坪
    for (const a of s.aprons) this.drawPolygon(a.polygon, '#5a5f66', '#8a9099');
    // 条带
    for (const strip of s.strips) {
      const color = strip.kind === 'runway' ? '#33363b' : strip.kind === 'taxiway' ? '#3d4147' : '#44484f';
      this.drawStrip(strip.points, strip.width, color);
      if (strip.kind === 'runway') this.drawRunwayMarks(strip);
    }
    // 建筑
    for (const b of s.buildings) this.drawPolygon(b.polygon, '#7d6a55', '#c9a878', b.name);
    // 机型
    for (const ac of s.aircraft) {
      const p = this.worldToScreen(ac.pos.x, ac.pos.y);
      ctx.fillStyle = '#d8e2f0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    // 塔台
    for (const t of s.towers) {
      const p = this.worldToScreen(t.pos.x, t.pos.y);
      const selected = t.id === store.selectedTowerId;
      ctx.fillStyle = selected ? '#ffb454' : '#e89b3c';
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 9);
      ctx.lineTo(p.x + 8, p.y + 6);
      ctx.lineTo(p.x - 8, p.y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '12px sans-serif';
      ctx.fillText(t.name, p.x + 10, p.y);
      this.towerScreen.set(t, p);
    }

    // 草稿
    if (this.draft.length > 0) {
      ctx.strokeStyle = '#5fd0ff';
      ctx.fillStyle = '#5fd0ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      this.draft.forEach((p, i) => {
        const sp = this.worldToScreen(p.x, p.y);
        if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
      });
      ctx.stroke();
      for (const p of this.draft) {
        const sp = this.worldToScreen(p.x, p.y);
        ctx.beginPath(); ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2); ctx.fill();
      }
    }

    // 塔台选中交互(选择模式下单击塔台图标)
    if (this.clickHandler) this.canvas.removeEventListener('click', this.clickHandler);
    this.clickHandler = (e: MouseEvent) => {
      if (this.mode !== 'select') return;
      for (const t of s.towers) {
        const sp = this.towerScreen.get(t);
        if (sp && Math.hypot(e.offsetX - sp.x, e.offsetY - sp.y) < 12) {
          store.selectTower(t.id);
          this.draw();
          return;
        }
      }
    };
    this.canvas.addEventListener('click', this.clickHandler);
  }

  private drawGrid() {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    const step = 200 * this.scale;
    if (step < 12) return;
    for (let x = this.canvas.width / 2 + this.pan.x % step; x < this.canvas.width; x += step) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.canvas.height); ctx.stroke();
    }
    for (let y = this.canvas.height / 2 + this.pan.y % step; y < this.canvas.height; y += step) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.canvas.width, y); ctx.stroke();
    }
  }

  private drawStrip(points: Vec2[], width: number, color: string) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width * this.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((p, i) => {
      const sp = this.worldToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
    });
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  private drawRunwayMarks(strip: Strip) {
    if (strip.points.length !== 2) return;
    const ctx = this.ctx;
    const [a, b] = strip.points;
    const len = dist(a, b);
    const n = Math.floor(len / 200);
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    for (let i = 1; i < n; i++) {
      const c = { x: a.x + dir.x * i * 200, y: a.y + dir.y * i * 200 };
      const p1 = this.worldToScreen(c.x - dir.x * 30, c.y - dir.y * 30);
      const p2 = this.worldToScreen(c.x + dir.x * 30, c.y + dir.y * 30);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
  }

  private drawPolygon(poly: Vec2[], fill: string, stroke: string, label?: string) {
    const ctx = this.ctx;
    ctx.beginPath();
    poly.forEach((p, i) => {
      const sp = this.worldToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sp.x, sp.y); else ctx.lineTo(sp.x, sp.y);
    });
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (label) {
      const c = poly.reduce((acc, p) => ({ x: acc.x + p.x / poly.length, y: acc.y + p.y / poly.length }), { x: 0, y: 0 });
      const sp = this.worldToScreen(c.x, c.y);
      ctx.fillStyle = '#eee';
      ctx.font = '12px sans-serif';
      ctx.fillText(label, sp.x - 10, sp.y);
    }
  }
}

