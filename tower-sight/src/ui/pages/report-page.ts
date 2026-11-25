// 比选报告页: 多候选塔高/覆盖率/眩光/不合格小时并排, 带全景截图
import type { ComparisonReport, ReportRow } from '../../types';
import { store } from '../store';
import { h, clear, button, table, badge } from '../dom';
import { computeCoverage, mullionAngularWidth } from '../../core/visibility';
import { annualFailStats } from '../../core/glare';
import { uid } from '../../core/math';
import { View3D } from '../components/view3d';

export class ReportPage {
  private view: View3D | null = null;
  private canvas!: HTMLCanvasElement;
  private thumbnails: Record<string, string> = {};
  private busy = false;

  render(wrap: HTMLElement) {
    clear(wrap);
    const s = store.scheme;

    this.canvas = h('canvas', { class: 'gpu-canvas thumb-canvas' });

    wrap.append(
      h('div', { class: 'page-head' }, [
        h('h2', {}, ['塔台比选报告']),
        button(this.busy ? '截图生成中…' : '生成比选报告(含全景截图)', () => void this.generate(), 'primary'),
      ]),
      h('div', { class: 'thumb-stage' }, [
        h('div', { class: 'gpu-stage small' }, [this.canvas]),
        h('p', { class: 'hint' }, [
          '生成时依次把眼位放到每个候选塔台,渲染当前天空下的全景画面并截图,',
          '再结合覆盖网格与全年天气统计输出并排对比。截图随报告存入 IndexedDB。',
        ]),
      ]),
      h('div', { id: 'report-current' }),
      h('div', { class: 'panel' }, [
        h('h3', {}, ['已保存报告']),
        h('div', { id: 'report-list' }, [this.reportList()]),
      ]),
    );

    // 延迟初始化 3D(仅在需要截图时)
    void this.ensureView();
  }

  private async ensureView(): Promise<View3D | null> {
    if (this.view) return this.view;
    this.view = new View3D(this.canvas, store.scheme.weather[0]);
    const ok = await this.view.init();
    if (ok) {
      this.view.setPanorama(true);
      this.view.placeEyeAtSelectedTower();
    }
    return ok ? this.view : null;
  }

  private async generate() {
    if (this.busy) return;
    this.busy = true;
    const view = await this.ensureView();
    if (!view || !view.renderer) { this.busy = false; return; }
    const s = store.scheme;

    const rows: ReportRow[] = [];
    this.thumbnails = {};

    for (const tower of s.towers) {
      store.selectTower(tower.id);
      view.reloadScene();
      view.placeEyeAtSelectedTower();
      view.lookHeading(0, 2);
      // 等布局与两帧渲染完成, 保证画布缓冲尺寸正确
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 150));
      const thumb = await view.renderer!.captureDataUrl();
      this.thumbnails[tower.id] = thumb;

      const cells = computeCoverage(s, tower, s.weather[0]);
      const passRate = cells.length ? cells.filter((c) => c.pass).length / cells.length : 0;
      const mullRate = cells.length ? cells.filter((c) => c.mullionBlocked).length / cells.length : 0;
      const stat = annualFailStats(s, tower, passRate, s.weather);

      rows.push({
        towerId: tower.id,
        towerName: tower.name,
        totalHeight: tower.floorElev + tower.eyeHeight,
        coverageRate: passRate,
        glareHours: stat.glareHours,
        failHours: stat.failHours,
        mullionBlockedRate: mullRate,
      });
    }

    const report: ComparisonReport = {
      id: uid('rpt'),
      name: `比选报告 ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      towerIds: s.towers.map((t) => t.id),
      rows,
      thumbnails: { ...this.thumbnails },
    };
    await store.saveReport(report);
    this.busy = false;
    this.showReport(report);
    document.getElementById('report-list')?.replaceChildren(this.reportList());
    const genBtn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('生成比选报告'));
    if (genBtn) genBtn.textContent = '生成比选报告(含全景截图)';
  }

  private showReport(report: ComparisonReport) {
    const host = document.getElementById('report-current');
    if (!host) return;
    clear(host);
    host.append(
      h('div', { class: 'panel' }, [
        h('h3', {}, [report.name]),
        h('div', { class: 'report-grid' }, report.rows.map((r) => {
          const best = Math.max(...report.rows.map((x) => x.coverageRate));
          return h('div', { class: 'report-card' }, [
            h('h4', {}, [r.towerName]),
            h('img', { src: report.thumbnails[r.towerId], class: 'report-thumb' }),
            table(['指标', '数值'], [
              ['眼位标高', `${r.totalHeight.toFixed(1)} m`],
              ['覆盖率', r.coverageRate === best
                ? badge(`${(r.coverageRate * 100).toFixed(1)}%`, 'ok')
                : `${(r.coverageRate * 100).toFixed(1)}%`],
              ['全年眩光小时', badge(`${r.glareHours} h`, r.glareHours > 100 ? 'bad' : 'warn')],
              ['全年不合格小时', badge(`${r.failHours} h`, r.failHours > 500 ? 'bad' : 'ok')],
              ['竖梃遮挡格占比', `${(r.mullionBlockedRate * 100).toFixed(1)}%`],
            ]),
          ]);
        })),
      ]),
    );
  }

  private reportList(): HTMLElement {
    const reports = store.reports;
    if (reports.length === 0) return h('p', { class: 'hint' }, ['暂无已保存报告。']);
    return h('div', { class: 'report-saved-list' }, reports.map((r) =>
      h('div', { class: 'report-saved-row' }, [
        h('a', {
          class: 'link',
          onclick: () => this.showReport(r),
        }, [`📄 ${r.name} — ${r.rows.length} 个候选`]),
        button('删除', () => void store.deleteReport(r.id), 'danger'),
      ])));
  }

  destroy() {
    this.view?.destroy();
  }
}
