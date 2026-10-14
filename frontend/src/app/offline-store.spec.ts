import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { OfflineStore } from './offline-store';

function writeLegacy(key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fitnessapp-offline-v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('queue', { keyPath: 'id' });
      request.result.createObjectStore('cache', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').put({ key, value });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe('Account offline storage', () => {
  const stores: OfflineStore[] = [];
  const ids: number[] = [];
  function makeStore(): OfflineStore {
    const store = new OfflineStore({ post: () => of({}) } as unknown as HttpClient);
    stores.push(store);
    return store;
  }
  function nextId(): number {
    const id = Math.floor(Math.random() * 1_000_000_000) + 1000;
    ids.push(id);
    return id;
  }
  afterEach(() => {
    stores.splice(0).forEach(store => store.ngOnDestroy());
    ids.splice(0).forEach(id => indexedDB.deleteDatabase(`fitnessapp-offline-v1-account-${id}`));
  });

  it('does not open tracker data until an account is selected', async () => {
    await expectAsync(makeStore().init()).toBeRejected();
  });

  it('keeps cached profiles, workout drafts, and queued writes separate', async () => {
    const alice = makeStore(); const bob = makeStore();
    spyOn(alice, 'flush').and.resolveTo(); spyOn(bob, 'flush').and.resolveTo();
    const a = nextId(); const b = nextId();
    await alice.selectAccount(a); await bob.selectAccount(b);
    await alice.cache('profile', { display_name: 'Alice' });
    await alice.cache('activeDraft', { name: 'Private workout' });
    await alice.enqueue('profile', { display_name: 'Alice' }, 'same-id');
    await bob.enqueue('profile', { display_name: 'Bob' }, 'same-id');
    expect(await bob.getCached('profile')).toBeNull();
    expect(await bob.getCached('activeDraft')).toBeNull();
    expect((await alice.getPending())[0].payload).toEqual({ display_name: 'Alice' });
    expect((await bob.getPending())[0].payload).toEqual({ display_name: 'Bob' });
    await expectAsync(alice.selectAccount(b)).toBeRejected();
  });

  it('imports old on-device drafts only for the designated legacy account and only once', async () => {
    await writeLegacy('activeDraft', { name: 'Old phone workout' });
    const family = makeStore(); const owner = makeStore();
    spyOn(family, 'flush').and.resolveTo(); spyOn(owner, 'flush').and.resolveTo();
    await family.selectAccount(nextId());
    expect(await family.getCached('activeDraft')).toBeNull();
    const ownerId = nextId();
    await owner.selectAccount(ownerId, true);
    expect(await owner.getCached('activeDraft')).toEqual({ name: 'Old phone workout' });
    await owner.cache('activeDraft', { name: 'New workout' });
    await owner.selectAccount(ownerId, true);
    expect(await owner.getCached('activeDraft')).toEqual({ name: 'New workout' });
  });

  it('preserves writes after session expiry and tags replay with the originating account', async () => {
    const post = jasmine.createSpy('post').and.returnValue(throwError(() => ({ status: 401 })));
    const store = new OfflineStore({ post } as unknown as HttpClient); stores.push(store);
    const id = nextId();
    await store.selectAccount(id);
    await store.pause();
    await store.enqueue('profile', { display_name: 'Offline' }, 'queued-id');
    expect(post).not.toHaveBeenCalled();
    await store.selectAccount(id);
    await store.flush();
    expect(store.pendingCount()).toBe(1);
    expect(post.calls.mostRecent().args[2].headers['X-Fitness-Account']).toBe(String(id));
    post.and.returnValue(of({}));
    await store.flush();
    expect(store.pendingCount()).toBe(0);
  });
});
