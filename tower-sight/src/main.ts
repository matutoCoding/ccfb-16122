import './styles.css';
import { store, type PageId } from './ui/store';
import { h } from './ui/dom';
import { AirportPage } from './ui/pages/airport-page';
import { TowerPage } from './ui/pages/tower-page';
import { PanoramaPage } from './ui/pages/panorama-page';
import { WeatherPage } from './ui/pages/weather-page';
import { CoveragePage } from './ui/pages/coverage-page';
import { ReportPage } from './ui/pages/report-page';

const NAV: { id: PageId; label: string; icon: string }[] = [
  { id: 'airport', label: '机场方案', icon: '🛬' },
  { id: 'tower', label: '塔台候选', icon: '🗼' },
  { id: 'panorama', label: '视认全景', icon: '👁' },
  { id: 'coverage', label: '覆盖分析', icon: '▦' },
  { id: 'weather', label: '天空气象', icon: '🌤' },
  { id: 'report', label: '比选报告', icon: '📊' },
];

class App {
  private content = document.getElementById('app')!;
  private pages = {
    airport: new AirportPage(),
    tower: new TowerPage(),
    panorama: new PanoramaPage(),
    weather: new WeatherPage(),
    coverage: new CoveragePage(),
    report: new ReportPage(),
  } as Record<string, { render: (el: HTMLElement) => void; destroy?: () => void }>;

  async start() {
    await store.init();
    store.subscribe(() => this.render());
    this.render();
  }

  private render() {
    this.content.replaceChildren();
    const nav = h('nav', { class: 'side-nav' }, [
      h('div', { class: 'brand' }, [h('b', {}, ['塔台选址']), h('span', {}, ['视认分析系统'])]),
      ...NAV.map((n) =>
        h('a', {
          class: `nav-item ${store.page === n.id ? 'active' : ''}`,
          onclick: () => store.goto(n.id),
        }, [h('span', { class: 'nav-icon' }, [n.icon]), n.label]),
      ),
      h('div', { class: 'nav-foot' }, [
        h('span', {}, ['WebGPU 实时大气散射']),
        h('span', { class: 'muted' }, ['数据存于本地 IndexedDB']),
      ]),
    ]);

    const main = h('main', { class: 'main-content' });
    const pageWrap = h('div', { class: 'page-wrap' });
    main.append(pageWrap);

    // 覆盖分析作为视认全景下的子页, 通过天气页/全景页按钮进入; 导航里用第 4 项扩展
    this.content.append(nav, main);

    const page = this.pages[store.page];
    if (page) page.render(pageWrap);
  }
}

// 覆盖页入口: 挂到 window 供页面内按钮跳转
declare global {
  interface Window {
    gotoCoverage: () => void;
  }
}
window.gotoCoverage = () => {
  const app = (window as unknown as { __app?: App }).__app;
  if (app) store.goto('coverage' as PageId);
};

const app = new App();
(window as unknown as { __app?: App }).__app = app;
void app.start();
