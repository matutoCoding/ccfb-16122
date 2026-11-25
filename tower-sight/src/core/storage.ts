// IndexedDB 持久化: 机场方案 / 比选报告
import type { AirportScheme, ComparisonReport } from '../types';

const DB_NAME = 'tower-sight-db';
const DB_VERSION = 1;
const STORE_SCHEMES = 'schemes';
const STORE_REPORTS = 'reports';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SCHEMES)) {
        db.createObjectStore(STORE_SCHEMES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_REPORTS)) {
        db.createObjectStore(STORE_REPORTS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const storage = {
  async listSchemes(): Promise<AirportScheme[]> {
    const rows = await tx<AirportScheme[]>(STORE_SCHEMES, 'readonly', (s) => s.getAll() as IDBRequest<AirportScheme[]>);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async saveScheme(scheme: AirportScheme): Promise<void> {
    scheme.updatedAt = Date.now();
    await tx(STORE_SCHEMES, 'readwrite', (s) => s.put(scheme));
  },

  async deleteScheme(id: string): Promise<void> {
    await tx(STORE_SCHEMES, 'readwrite', (s) => s.delete(id));
  },

  async listReports(): Promise<ComparisonReport[]> {
    const rows = await tx<ComparisonReport[]>(STORE_REPORTS, 'readonly', (s) => s.getAll() as IDBRequest<ComparisonReport[]>);
    return rows.sort((a, b) => b.createdAt - a.createdAt);
  },

  async saveReport(report: ComparisonReport): Promise<void> {
    await tx(STORE_REPORTS, 'readwrite', (s) => s.put(report));
  },

  async deleteReport(id: string): Promise<void> {
    await tx(STORE_REPORTS, 'readwrite', (s) => s.delete(id));
  },
};
