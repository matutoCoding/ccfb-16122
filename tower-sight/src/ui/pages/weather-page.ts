// 天空气象页: 天空参数、天气预设、眩光时段表、全年批量不合格统计
import type { WeatherPreset } from '../../types';
import { store } from '../store';
import { h, clear, button, labeledField, numberInput, slider, table, badge } from '../dom';
import { solarPosition } from '../../core/solar';
import { scanDayGlare, annualGlareHours, annualFailStats } from '../../core/glare';
import { computeCoverage } from '../../core/visibility';

export class WeatherPage {
  render(wrap: HTMLElement) {
    clear(wrap);
    const s = store.scheme;
    const tower = store.tower;
    const sp = solarPosition(s.sky);
    const { windows } = scanDayGlare(s, tower, s.sky.date);

    wrap.append(
      h('div', { class: 'page-head' }, [h('h2', {}, ['天空与气象'])]),
      h('div', { class: 'two-col' }, [
        h('div', { class: 'panel' }, [
          h('h3', {}, ['地理位置与时刻(实时驱动大气散射)']),
          this.skyControls(),
          h('div', { class: 'sun-readout' }, [
            h('div', { class: 'stat' }, [h('b', {}, [`${sp.azimuth.toFixed(2)}°`]), h('span', {}, ['太阳方位角(北0顺)'])]),
            h('div', { class: 'stat' }, [h('b', {}, [`${sp.elevation.toFixed(2)}°`]), h('span', {}, ['几何高度角'])]),
            h('div', { class: 'stat' }, [h('b', {}, [`${sp.elevationApparent.toFixed(2)}°`]), h('span', {}, ['视高度(含折射)'])]),
            h('div', { class: 'stat' }, [h('b', {}, [`${sp.declination.toFixed(2)}°`]), h('span', {}, ['太阳赤纬'])]),
            h('div', { class: 'stat' }, [h('b', {}, [`${sp.equationOfTime.toFixed(2)}′`]), h('span', {}, ['时差(分钟)'])]),
            h('div', { class: 'stat' }, [h('b', {}, [sp.julianDay.toFixed(2)]), h('span', {}, ['儒略日'])]),
          ]),
        ]),
        h('div', { class: 'panel' }, [
          h('h3', {}, ['全年典型天气预设']),
          ...s.weather.map((w) => this.weatherEditor(w)),
          button('新增天气预设', () => store.update((d) => {
            d.weather.push({
              id: store.makeId('w'), name: '新预设', visibility: 5000,
              haze: 0.3, humidity: 0.6, annualHours: 500,
            });
          }), 'primary'),
        ]),
      ]),
      h('div', { class: 'panel' }, [
        h('h3', {}, [`当日眩光时段表 — ${s.sky.date}(低太阳正对跑道/交叉口 ±20°)`]),
        windows.length === 0
          ? h('p', { class: 'hint' }, ['当日无眩光时段(太阳高度角 >30° 或方位未与关键点重叠)。'])
          : table(
              ['目标', '开始', '结束', '时长(分)', '最小夹角'],
              windows.map((w) => [
                w.targetName, w.start, w.end, String(w.durationMin), `${w.minAngle}°`,
              ]),
            ),
        button('扫描其他日期…', () => {
          const date = prompt('输入日期 YYYY-MM-DD', s.sky.date);
          if (date) store.update((d) => { d.sky.date = date; });
        }),
      ]),
      this.annualPanel(),
    );
  }

  private skyControls(): HTMLElement {
    const sky = store.scheme.sky;
    const set = (fn: () => void) => store.update(fn);

    const dateInput = h('input', { type: 'date', value: sky.date });
    dateInput.addEventListener('change', () => set(() => { sky.date = dateInput.value; }));
    const timeInput = h('input', { type: 'time', value: sky.time, step: '60' });
    timeInput.addEventListener('change', () => set(() => { sky.time = timeInput.value; }));

    return h('div', {}, [
      h('div', { class: 'form-row' }, [
        labeledField('纬度(°)', numberInput(sky.latitude, 0.1, (v) => set(() => { sky.latitude = v; }), -90, 90)),
        labeledField('经度(°)', numberInput(sky.longitude, 0.1, (v) => set(() => { sky.longitude = v; }), -180, 180)),
        labeledField('时区(h)', numberInput(sky.timezone, 1, (v) => set(() => { sky.timezone = v; }), -12, 14)),
      ]),
      h('div', { class: 'form-row' }, [
        labeledField('日期', dateInput),
        labeledField('时刻', timeInput),
      ]),
      labeledField(`时刻快捷拖动: ${sky.time}`, (() => {
        const [hh, mm] = sky.time.split(':').map(Number);
        const mins = hh * 60 + mm;
        return slider(mins, 0, 1439, 5, (v) => set(() => {
          sky.time = `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
        }));
      })()),
      labeledField(`大气浊度: ${sky.turbidity}`,
        slider(sky.turbidity, 1, 10, 0.1, (v) => set(() => { sky.turbidity = v; }))),
      labeledField(`曝光: ${sky.exposure.toFixed(2)}`,
        slider(sky.exposure, 0.2, 3, 0.05, (v) => set(() => { sky.exposure = v; }))),
    ]);
  }

  private weatherEditor(w: WeatherPreset): HTMLElement {
    const set = (fn: (x: WeatherPreset) => void) => store.update((s) => {
      const target = s.weather.find((x) => x.id === w.id);
      if (target) fn(target);
    });
    return h('div', { class: 'weather-card' }, [
      h('div', { class: 'weather-head' }, [
        (() => {
          const name = h('input', { type: 'text', value: w.name });
          name.addEventListener('change', () => set((x) => { x.name = name.value; }));
          return name;
        })(),
        button('删除', () => store.update((s) => { s.weather = s.weather.filter((x) => x.id !== w.id); }), 'danger'),
      ]),
      labeledField(`气象能见度: ${w.visibility} m`,
        slider(w.visibility, 200, 20000, 100, (v) => set((x) => { x.visibility = v; }))),
      labeledField(`霾浓度: ${w.haze.toFixed(2)}`,
        slider(w.haze, 0, 1, 0.05, (v) => set((x) => { x.haze = v; }))),
      labeledField(`相对湿度: ${(w.humidity * 100).toFixed(0)}%`,
        slider(w.humidity, 0, 0.98, 0.02, (v) => set((x) => { x.humidity = v; }))),
      labeledField('全年典型小时数',
        numberInput(w.annualHours, 10, (v) => set((x) => { x.annualHours = v; }), 0)),
    ]);
  }

  private annualPanel(): HTMLElement {
    const s = store.scheme;
    const run = () => {
      const rows: (string | HTMLElement)[][] = [];
      for (const tower of s.towers) {
        const cells = computeCoverage(s, tower, s.weather[0]);
        const passRate = cells.length ? cells.filter((c) => c.pass).length / cells.length : 1;
        const stat = annualFailStats(s, tower, passRate, s.weather);
        rows.push([
          tower.name,
          `${(passRate * 100).toFixed(1)}%`,
          badge(`${stat.glareHours} h`, stat.glareHours > 100 ? 'bad' : 'warn'),
          badge(`${stat.failHours} h`, stat.failHours > 500 ? 'bad' : 'ok'),
          stat.byWeather.map((bw) => {
            const wname = s.weather.find((w) => w.id === bw.weatherId)?.name ?? bw.weatherId;
            return `${wname}:${bw.failHours}h`;
          }).join(' / '),
        ]);
      }
      const host = document.getElementById('annual-result')!;
      host.replaceChildren(
        table(['塔台候选', '覆盖率', '全年眩光小时', '全年不合格小时', '分天气不合格'], rows),
      );
    };

    const glareNow = annualGlareHours(s, s.towers[0]);

    return h('div', { class: 'panel' }, [
      h('h3', {}, ['全年批量视认统计(24 个代表日抽样 × 天气预设加权)']),
      h('p', { class: 'hint' }, [
        `当前首选塔台按抽样推算全年眩光约 ${glareNow.hours.toFixed(1)} 小时。`,
        '批量任务对每个候选位置结合覆盖网格通过率、各天气预设的年小时数与距离衰减,统计全年视认不合格小时。',
      ]),
      button('运行全年批量分析', run, 'primary'),
      h('div', { id: 'annual-result' }, [badge('尚未运行', 'info')]),
    ]);
  }
}
