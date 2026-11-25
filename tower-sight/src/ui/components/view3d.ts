// 共享 WebGPU 视图: 管理渲染器生命周期、相机交互、太阳/天气同步
import { WebGpuRenderer } from '../../render/renderer';
import { store } from '../store';
import { solarPosition, sunDirection } from '../../core/solar';
import type { WeatherPreset } from '../../types';
import { DEG } from '../../core/math';
import { towerEye } from '../../core/visibility';

export class View3D {
  renderer: WebGpuRenderer | null = null;
  private canvas: HTMLCanvasElement;
  private raf = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private error: HTMLElement | null = null;
  onFrame: (() => void) | null = null;
  private weather: WeatherPreset;

  constructor(canvas: HTMLCanvasElement, weather: WeatherPreset) {
    this.canvas = canvas;
    this.weather = weather;
  }

  async init(): Promise<boolean> {
    try {
      this.renderer = await WebGpuRenderer.create(this.canvas);
      this.renderer.loadScene(store.scheme, store.selectedTowerId);
      this.syncSun();
      this.renderer.setWeather(this.weather);
      this.bindControls();
      this.loop();
      (window as unknown as { __renderer?: WebGpuRenderer }).__renderer = this.renderer;
      return true;
    } catch (e) {
      this.error = document.createElement('div');
      this.error.className = 'gpu-error';
      this.error.textContent = `WebGPU 初始化失败: ${(e as Error).message}。请使用 Chrome/Edge 113+ 并启用硬件加速。`;
      this.canvas.replaceWith(this.error);
      return false;
    }
  }

  private bindControls() {
    const r = this.renderer!;
    this.canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    window.addEventListener('mouseup', () => { this.dragging = false; });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      const speed = 0.005 * (r.panoramaMode ? 1.6 : 1);
      r.camera.yaw += dx * speed;
      r.camera.pitch = Math.max(-1.4, Math.min(1.4, r.camera.pitch - dy * speed));
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (r.panoramaMode) {
        r.panFov = Math.max(0.5, Math.min(Math.PI * 2, r.panFov * (e.deltaY > 0 ? 1.08 : 0.92)));
      } else {
        r.camera.fovY = Math.max(0.15, Math.min(1.5, r.camera.fovY * (e.deltaY > 0 ? 1.08 : 0.92)));
      }
    }, { passive: false });
  }

  syncSun() {
    const r = this.renderer;
    if (!r) return;
    const sp = solarPosition(store.scheme.sky);
    const dir = sunDirection(sp.azimuth, sp.elevationApparent);
    r.setSun(dir, store.scheme.sky.exposure, store.scheme.sky.turbidity);
  }

  setWeather(w: WeatherPreset) {
    this.weather = w;
    this.renderer?.setWeather(w);
  }

  placeEyeAtSelectedTower() {
    const r = this.renderer;
    if (!r) return;
    const eye = towerEye(store.tower);
    r.setEyeAtTower(eye);
  }

  setPanorama(on: boolean) {
    if (this.renderer) this.renderer.panoramaMode = on;
  }

  lookHeading(headingDeg: number, pitchDeg = -3) {
    const r = this.renderer;
    if (!r) return;
    r.camera.yaw = headingDeg * DEG;
    r.camera.pitch = pitchDeg * DEG;
  }

  reloadScene() {
    this.renderer?.loadScene(store.scheme, store.selectedTowerId);
  }

  private loop = () => {
    if (!this.renderer) return;
    this.syncSun();
    this.renderer.render();
    this.onFrame?.();
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
  }
}
