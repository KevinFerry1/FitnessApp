import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { Subscription } from 'rxjs';

export const RELOAD_APP = new InjectionToken<() => void>('Reload app', {
  providedIn: 'root', factory: () => () => window.location.reload(),
});

@Injectable({ providedIn: 'root' })
export class AppUpdates {
  readonly available = signal(false);
  readonly updating = signal(false);
  readonly error = signal('');
  private readonly updates = inject(SwUpdate, { optional: true });
  private readonly reload = inject(RELOAD_APP);
  private subscription?: Subscription;
  private readonly onVisible = () => { if (!document.hidden) void this.check(); };
  private readonly onOnline = () => void this.check();

  start(): void {
    if (!this.updates?.isEnabled || this.subscription) return;
    this.subscription = this.updates.versionUpdates.subscribe((event) => {
      if (event.type === 'VERSION_READY') this.available.set(true);
    });
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('online', this.onOnline);
    void navigator.serviceWorker.ready.then(() => this.check());
  }

  stop(): void {
    this.subscription?.unsubscribe();
    this.subscription = undefined;
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('online', this.onOnline);
  }

  async check(): Promise<void> {
    if (!this.updates?.isEnabled) return;
    try { if (await this.updates.checkForUpdate()) this.available.set(true); }
    catch { /* The installed app remains available while offline. */ }
  }

  async apply(): Promise<void> {
    if (!this.updates?.isEnabled || this.updating()) return;
    this.updating.set(true);
    this.error.set('');
    try {
      await this.updates.activateUpdate();
      this.reload();
    } catch {
      this.error.set('Could not update. Connect to the Pi and try again.');
      this.updating.set(false);
    }
  }
}
