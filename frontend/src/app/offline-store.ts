import { HttpClient } from '@angular/common/http';
import { Injectable, OnDestroy, signal } from '@angular/core';
import { firstValueFrom, Subject } from 'rxjs';

export type SyncKind = 'food_log' | 'food_log_update' | 'saved_meal' | 'saved_meal_delete' | 'weight_entry' | 'workout' | 'workout_delete' | 'profile' | 'exercise_option';

export interface PendingChange {
  id: string;
  kind: SyncKind;
  payload: unknown;
  createdAt: number;
}

const DATABASE_NAME = 'fitnessapp-offline-v1';

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

@Injectable({ providedIn: 'root' })
export class OfflineStore implements OnDestroy {
  readonly pendingCount = signal(0);
  readonly syncing = signal(false);
  readonly syncError = signal('');
  readonly storageAvailable = signal(true);
  readonly synced = new Subject<void>();

  private database?: Promise<IDBDatabase>;
  private flushing?: Promise<void>;
  private initialized = false;
  private accountId: number | null = null;
  private enabled = false;
  private interval?: number;
  private readonly onlineListener = () => void this.flush();
  private readonly visibilityListener = () => { if (!document.hidden) void this.flush(); };

  constructor(private readonly http: HttpClient) {}

  async selectAccount(id: number, importLegacy = false): Promise<void> {
    if (this.accountId !== null && this.accountId !== id) throw new Error('Reload to switch accounts.');
    this.accountId = id;
    await this.init();
    if (importLegacy && this.database && !await this.getCached('legacyImported')) {
      const legacy = await openDatabase(DATABASE_NAME);
      try {
        const rows = await Promise.all(['queue', 'cache'].map(store => new Promise<unknown[]>((resolve, reject) => {
          const request = legacy.transaction(store, 'readonly').objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        })));
        const db = await this.requireDatabase();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(['queue', 'cache'], 'readwrite');
          // Add only absent legacy records; a retry must not overwrite newer account data.
          rows.forEach((items, index) => items.forEach(value => {
            const store = tx.objectStore(index === 0 ? 'queue' : 'cache');
            const key = (value as { id?: string; key?: string }).id ?? (value as { key: string }).key;
            const request = store.get(key);
            request.onsuccess = () => { if (!request.result) store.put(value); };
          }));
          tx.objectStore('cache').put({ key: 'legacyImported', value: true });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      } finally { legacy.close(); }
    }
    await this.updateCount();
    this.enabled = true;
    void this.flush();
  }

  async pause(): Promise<void> {
    this.enabled = false;
    if (this.flushing) await this.flushing;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.accountId === null) throw new Error("Sign in before opening tracker storage.");
    this.initialized = true;
    this.database = openDatabase(`${DATABASE_NAME}-account-${this.accountId}`);
    try {
      await this.database;
    } catch {
      this.database = undefined;
      this.storageAvailable.set(false);
      return;
    }
    await this.updateCount();
    window.addEventListener('online', this.onlineListener);
    document.addEventListener('visibilitychange', this.visibilityListener);
    this.interval = window.setInterval(() => void this.flush(), 15000);
    void this.flush();
  }

  ngOnDestroy(): void {
    this.enabled = false;
    window.removeEventListener('online', this.onlineListener);
    document.removeEventListener('visibilitychange', this.visibilityListener);
    if (this.interval !== undefined) window.clearInterval(this.interval);
    void this.database?.then(db => db.close());
  }

  async enqueue(kind: SyncKind, payload: unknown, id: string = crypto.randomUUID()): Promise<string> {
    if (!this.initialized) await this.init();
    if (!this.database) {
      await firstValueFrom(this.http.post('/api/sync/', { kind, client_id: id, payload }, { headers: { 'X-Fitness-Account': String(this.accountId) } }));
      this.synced.next();
      return id;
    }
    const existing = await this.get<PendingChange>('queue', id);
    await this.put('queue', { id, kind, payload, createdAt: existing?.createdAt ?? Date.now() });
    await this.updateCount();
    void this.flush();
    return id;
  }

  async getPending(): Promise<PendingChange[]> {
    if (!this.initialized) await this.init();
    if (!this.database) return [];
    const db = await this.requireDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction('queue', 'readonly').objectStore('queue').getAll();
      request.onsuccess = () => resolve((request.result as PendingChange[]).sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error);
    });
  }

  async getCached<T>(key: string): Promise<T | null> {
    if (!this.initialized) await this.init();
    if (!this.database) return null;
    const row = await this.get<{ key: string; value: T }>('cache', key);
    return row?.value ?? null;
  }

  async cache<T>(key: string, value: T): Promise<void> {
    if (!this.initialized) await this.init();
    if (!this.database) return;
    await this.put('cache', { key, value });
  }

  retry(): void {
    void this.flush();
  }

  async flush(): Promise<void> {
    if (!this.enabled) return;
    if (this.flushing) return this.flushing;
    this.flushing = this.flushQueue().finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  private async flushQueue(): Promise<void> {
    if (!this.database) return;
    this.syncing.set(true);
    let sentAny = false;
    try {
      while (this.enabled) {
        const item = (await this.getPending())[0];
        if (!item) break;
        await firstValueFrom(this.http.post('/api/sync/', {
          kind: item.kind, client_id: item.id, payload: item.payload,
        }, { headers: { 'X-Fitness-Account': String(this.accountId) } }));
        // A workout can change while its previous revision is in flight.
        const latest = await this.get<PendingChange>('queue', item.id);
        if (latest && JSON.stringify(latest.payload) === JSON.stringify(item.payload)) {
          await this.remove('queue', item.id);
        }
        sentAny = true;
        this.syncError.set('');
        await this.updateCount();
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      this.syncError.set(status && status >= 400 && status < 500
        ? `A pending save needs attention (HTTP ${status}).`
        : 'Waiting for a connection. Your changes remain on this device.');
    } finally {
      this.syncing.set(false);
      if (sentAny) this.synced.next();
    }
  }

  private async updateCount(): Promise<void> {
    this.pendingCount.set((await this.getPending()).length);
  }

  private async requireDatabase(): Promise<IDBDatabase> {
    if (!this.database) await this.init();
    return this.database!;
  }

  private async get<T>(store: string, key: string): Promise<T | undefined> {
    const db = await this.requireDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  private async put(store: string, value: unknown): Promise<void> {
    const db = await this.requireDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async remove(store: string, key: string): Promise<void> {
    const db = await this.requireDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
