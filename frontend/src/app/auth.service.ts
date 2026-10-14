import { HttpClient, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { catchError, firstValueFrom, throwError } from 'rxjs';
import { OfflineStore } from './offline-store';

export interface Account { id: number; username: string; can_invite: boolean; legacy_owner: boolean }
interface Session { user: Account | null; csrf_token: string }
const ACCOUNT_HINT = 'fitness-account';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<Account | null>(null);
  readonly ready = signal(false);
  readonly error = signal('');
  readonly busy = signal(false);
  readonly offlineSession = signal(false);

  constructor(private readonly http: HttpClient, private readonly offline: OfflineStore) {}

  async restore(): Promise<void> {
    try {
      const session = await firstValueFrom(this.http.get<Session>('/api/auth/session/'));
      await this.accept(session.user, false);
    } catch (error) {
      if ((error as HttpErrorResponse).status === 0) {
        try {
          const hint = JSON.parse(localStorage.getItem(ACCOUNT_HINT) ?? 'null') as Account | null;
          if (hint && Number.isInteger(hint.id) && hint.id > 0) await this.accept(hint, true);
        } catch { /* No previous account available offline. */ }
      }
      if (!this.user()) this.error.set('Connect to the internet to sign in.');
    } finally { this.ready.set(true); }
  }

  private async accept(user: Account | null, offlineSession: boolean): Promise<void> {
    if (this.user() && user && this.user()!.id !== user.id) { window.location.reload(); return; }
    await this.offline.pause();
    if (user) {
      // Legacy storage is assigned only after the server verifies its designated owner.
      await this.offline.selectAccount(user.id, !offlineSession && user.legacy_owner);
      try { localStorage.setItem(ACCOUNT_HINT, JSON.stringify(user)); } catch { /* Optional offline hint. */ }
    } else {
      try { localStorage.removeItem(ACCOUNT_HINT); } catch { /* Storage may be disabled. */ }
    }
    this.offlineSession.set(offlineSession);
    this.user.set(user);
  }

  async submit(username: string, password: string, invite: string): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    await this.offline.pause();
    try {
      await firstValueFrom(this.http.get<Session>('/api/auth/session/'));
      await firstValueFrom(this.http.post<Session>(`/api/auth/${invite ? 'signup' : 'login'}/`, { username, password, invite }));
      // Discard old in-memory forms and in-flight reads before binding another account.
      history.replaceState(null, '', location.pathname + location.search);
      window.location.reload();
    } catch (error) { this.error.set(this.message(error)); }
    finally { this.busy.set(false); }
  }

  async signOut(): Promise<void> {
    this.error.set('');
    await this.offline.pause();
    if (this.offline.pendingCount() > 0) {
      this.error.set('Sync your pending saves before signing out.');
      await this.offline.selectAccount(this.user()!.id);
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(this.http.post('/api/auth/logout/', {}));
      try { localStorage.removeItem(ACCOUNT_HINT); } catch { /* Optional hint. */ }
      window.location.reload();
    } catch (error) {
      this.error.set(this.message(error));
      if (this.user()) await this.offline.selectAccount(this.user()!.id);
    } finally { this.busy.set(false); }
  }

  expire(): void {
    void this.offline.pause();
    this.user.set(null);
    try { localStorage.removeItem(ACCOUNT_HINT); } catch { /* Optional hint. */ }
    this.error.set('Your session ended. Sign in again; your pending saves are still on this device.');
  }

  private message(error: unknown): string {
    const response = error as HttpErrorResponse;
    if (response.status === 0) return 'Could not connect. Please try again when online.';
    if (response.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    const details = response.error;
    if (typeof details?.detail === 'string') return details.detail;
    if (details && typeof details === 'object') return Object.values(details).flat().join(' ');
    return 'Could not complete that request. Please try again.';
  }
}

export const accountInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith('/api/')) return next(request);
  const auth = inject(AuthService);
  const user = auth.user();
  request = request.clone({ setHeaders: {
    'ngsw-bypass': 'true',
    ...(user && !request.url.startsWith('/api/auth/') ? { 'X-Fitness-Account': String(user.id) } : {}),
  }});
  return next(request).pipe(catchError((error: HttpErrorResponse) => {
    if (!request.url.startsWith('/api/auth/') && (error.status === 401 || (error.status === 409 && error.error?.code === 'account_changed'))) auth.expire();
    return throwError(() => error);
  }));
};
