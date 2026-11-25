// 比选报告页: 多候选塔高/覆盖率/眩光小时/不合格小时并排, 带全景截图
import type { ComparisonReport, ReportRow, TowerCandidate } from '../../types';
import { store } from '../store';
import { h, clear, button, table, badge } from '../dom';
import { computeCoverage, towerEye } from '../../core/visibility';
import { annualFailStats } from '../../core/glare';
import { solarPosition, sunDirection } from '../../core/solar';
import { uid } from '../../core/math';
import { WebGpuRenderer } from '../../render/renderer';

export class ReportPage {
  private busy = false;
  private status: HTMLElement | null = null;

  render(wrap: HTMLElement) {
    clear(wrap);
    const s = store.scheme;
    const genBtn = button(this.busy ? '截图生成中…' : '生成比选报告(含全景截图)', () => void this.generate(), 'primary');
    genBtn.id = 'btn-generate-report';
    if (this.busy) genBtn.disabled = true;

    wrap.append(
      h('div', { class: 'page-head' }, [
        h('h2', {}, ['塔台比选报告']),
        genBtn,
      ]),
      h('p', { class: 'hint', id: 'report-status' }, [
        '生成时依次把眼位放到每个候选塔台,用独立离屏 WebGPU 渲染当前天空下的 16:9 全景并截图,',
        '再结合覆盖网格与全年天气统计输出并排对比。截图随报告存入 IndexedDB。',
      ]),
      h('div', { id: 'report-current' }),
      h('div', { class: 'panel' }, [
        h('h3', {}, ['已保存报告']),
        h('div', { id: 'report-list' }, [this.reportList()]),
      ]),
    );
    this.status = document.getElementById('report-status');
  }

  /** 为单个候选塔台渲染一张 16:9 全景 dataURL(离屏画布, 640×360 回读再裁剪缩放) */
  private async renderThumbnail(tower: TowerCandidate): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const renderer = await WebGpuRenderer.create(canvas);
    try {
      const s = store.scheme;
      renderer.loadScene(s, tower.id);
      const w = s.weather[0];
      renderer.setWeather(w);
      const sp = solarPosition(s.sky);
      renderer.setSun(
        sunDirection(sp.azimuth, sp.elevationApparent),
        s.sky.exposure,
        s.sky.turbidity,
      );
      renderer.panoramaMode = true;
      renderer.panFov = (110 * Math.PI) / 180;
      const eye = towerEye(tower);
      renderer.camera.eye = { ...eye };
      renderer.camera.yaw = 0;
      renderer.camera.pitch = (2 * Math.PI) / 180;

      const cap = renderer.captureDataUrl({ width: 480, height: 270 });
      renderer.render();
      return await cap;
    } finally {
      renderer.device.destroy();
    }
  }

  private setStatus(text: string) {
    const el = document.getElementById('report-status');
    if (el) el.textContent = text;
  }

  private async generate() {
    if (this.busy) return;
    this.busy = true;
    const btn = document.querySelector<HTMLButtonElement>('#btn-generate-report');
    if (btn) { btn.disabled = true; btn.textContent = '截图生成中…'; }

    const s = store.scheme;
    const rows: ReportRow[] = [];
    const thumbnails: Record<string, string> = {};

    try {
      for (let i = 0; i < s.towers.length; i++) {
        const tower = s.towers[i];
        this.setStatus(`正在渲染候选 ${i + 1}/${s.towers.length}: ${tower.name} …`);
        // 让状态文字先上屏, 再做同步/异步 GPU 工作
        await new Promise((r) => setTimeout(r, 30));

        const thumb = await this.renderThumbnail(tower);
        thumbnails[tower.id] = thumb;

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
        thumbnails: { ...thumbnails },
      };
      await store.saveReport(report);
      this.showReport(report);
      document.getElementById('report-list')?.replaceChildren(this.reportList());
      this.setStatus('报告已生成, 并已保存到本机 IndexedDB。');
    } catch (e) {
      this.setStatus(`报告生成失败: ${(e as Error).message}`);
    } finally {
      this.busy = false;
      const b = document.querySelector<HTMLButtonElement>('#btn-generate-report');
      if (b) { b.disabled = false; b.textContent = '生成比选报告(含全景截图)'; }
    }
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
            h('img', { src: report.thumbnails[r.towerId], class: 'report-thumb', alt: r.towerName }),
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
    // 离屏渲染器在用完后即销毁 device, 这里无需额外清理 RAF
  }
}
