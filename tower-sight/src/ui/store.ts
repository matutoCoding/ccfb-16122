// 全局应用状态(发布订阅), 方案持久化到 IndexedDB
import type { AirportScheme, ComparisonReport, TowerCandidate } from '../types';
import { storage } from '../core/storage';
import { createTestAirport } from '../core/test-airport';
import { uid } from '../core/math';

type Listener = () => void;

class AppStore {
  scheme: AirportScheme = createTestAirport();
  selectedTowerId: string = '';
  reports: ComparisonReport[] = [];
  page: PageId = 'airport';
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    this.listeners.forEach((fn) => fn());
  }

  get tower(): TowerCandidate {
    return (
      this.scheme.towers.find((t) => t.id === this.selectedTowerId) ??
      this.scheme.towers[0]
    );
  }

  selectTower(id: string) {
    this.selectedTowerId = id;
    this.emit();
  }

  update(mutator: (s: AirportScheme) => void) {
    mutator(this.scheme);
    this.scheme.updatedAt = Date.now();
    this.emit();
    void this.save();
  }

  async init() {
    const list = await storage.listSchemes();
    if (list.length > 0) {
      this.scheme = list[0];
      this.selectedTowerId = this.scheme.towers[0]?.id ?? '';
    } else {
      this.selectedTowerId = this.scheme.towers[0]?.id ?? '';
      await this.save();
    }
    this.reports = await storage.listReports();
    this.emit();
  }

  async save() {
    await storage.saveScheme(this.scheme);
  }

  async newScheme() {
    this.scheme = createTestAirport(`支线机场方案 ${new Date().toLocaleDateString()}`);
    this.selectedTowerId = this.scheme.towers[0]?.id ?? '';
    await this.save();
    this.emit();
  }

  async resetTestAirport() {
    const keepId = this.scheme.id;
    const fresh = createTestAirport(this.scheme.name);
    fresh.id = keepId;
    this.scheme = fresh;
    this.selectedTowerId = fresh.towers[0].id;
    await this.save();
    this.emit();
  }

  async saveReport(report: ComparisonReport) {
    await storage.saveReport(report);
    this.reports = await storage.listReports();
    this.emit();
  }

  async deleteReport(id: string) {
    await storage.deleteReport(id);
    this.reports = await storage.listReports();
    this.emit();
  }

  goto(page: PageId) {
    this.page = page;
    this.emit();
  }

  makeId(prefix: string) {
    return uid(prefix);
  }
}

export type PageId = 'airport' | 'tower' | 'panorama' | 'coverage' | 'weather' | 'report';

export const store = new AppStore();
