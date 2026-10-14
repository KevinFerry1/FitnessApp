import { HttpClient, provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService, accountInterceptor } from './auth.service';
import { OfflineStore } from './offline-store';

describe('Account session', () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let offline: jasmine.SpyObj<OfflineStore>;
  beforeEach(() => {
    localStorage.removeItem('fitness-account');
    offline = jasmine.createSpyObj('OfflineStore', ['pause', 'selectAccount']);
    offline.pause.and.resolveTo(); offline.selectAccount.and.resolveTo();
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withXsrfConfiguration({ cookieName: 'csrftoken', headerName: 'X-CSRFToken' }), withInterceptors([accountInterceptor])),
      provideHttpClientTesting(), { provide: OfflineStore, useValue: offline },
    ]});
    http = TestBed.inject(HttpTestingController); auth = TestBed.inject(AuthService);
  });
  afterEach(() => { http.verify(); localStorage.removeItem('fitness-account'); document.cookie = 'csrftoken=; Max-Age=0; path=/'; });

  it('selects verified account storage before showing the tracker', async () => {
    const restoring = auth.restore();
    http.expectOne('/api/auth/session/').flush({ user: { id: 7, username: 'owner', can_invite: true, legacy_owner: true }, csrf_token: 'csrf' });
    await restoring;
    expect(offline.selectAccount).toHaveBeenCalledWith(7, true);
    expect(auth.user()?.id).toBe(7);
    expect(auth.ready()).toBeTrue();
  });

  it('never trusts an offline account hint when the server reports signed out', async () => {
    localStorage.setItem('fitness-account', JSON.stringify({ id: 7, username: 'owner' }));
    const restoring = auth.restore();
    http.expectOne('/api/auth/session/').flush({ user: null, csrf_token: 'csrf' });
    await restoring;
    expect(auth.user()).toBeNull();
    expect(offline.selectAccount).not.toHaveBeenCalled();
  });

  it('reopens only the last account during a network outage without claiming legacy data', async () => {
    localStorage.setItem('fitness-account', JSON.stringify({ id: 7, username: 'owner', legacy_owner: true }));
    const restoring = auth.restore();
    http.expectOne('/api/auth/session/').error(new ProgressEvent('error'));
    await restoring;
    expect(offline.selectAccount).toHaveBeenCalledWith(7, false);
    expect(auth.offlineSession()).toBeTrue();
  });

  it('sends CSRF and account headers and hides the tracker on an expired session', () => {
    document.cookie = 'csrftoken=csrf-test; path=/';
    auth.user.set({ id: 7, username: 'owner', can_invite: true, legacy_owner: true });
    TestBed.inject(HttpClient).post('/api/sync/', {}).subscribe({ error: () => {} });
    const request = http.expectOne('/api/sync/');
    expect(request.request.headers.get('X-Fitness-Account')).toBe('7');
    expect(request.request.headers.get('X-CSRFToken')).toBe('csrf-test');
    expect(request.request.headers.get('ngsw-bypass')).toBe('true');
    request.flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(auth.user()).toBeNull();
    expect(offline.pause).toHaveBeenCalled();
  });
});
