import { TestBed } from '@angular/core/testing';
import { SwUpdate, VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdates, RELOAD_APP } from './app-updates';

describe('app updates', () => {
  let service: AppUpdates;
  let events: Subject<VersionEvent>;
  let updates: { isEnabled: boolean; versionUpdates: Subject<VersionEvent>; checkForUpdate: jasmine.Spy; activateUpdate: jasmine.Spy };
  let reload: jasmine.Spy;

  beforeEach(() => {
    events = new Subject<VersionEvent>();
    updates = { isEnabled: true, versionUpdates: events,
      checkForUpdate: jasmine.createSpy().and.resolveTo(false), activateUpdate: jasmine.createSpy().and.resolveTo(true) };
    reload = jasmine.createSpy();
    TestBed.configureTestingModule({ providers: [{ provide: SwUpdate, useValue: updates }, { provide: RELOAD_APP, useValue: reload }] });
    service = TestBed.inject(AppUpdates);
  });

  afterEach(() => service.stop());

  it('offers a downloaded version without interrupting an active workout', () => {
    service.start();
    events.next({ type: 'VERSION_READY', currentVersion: { hash: 'old' }, latestVersion: { hash: 'new' } });
    expect(service.available()).toBeTrue();
    expect(reload).not.toHaveBeenCalled();
  });

  it('activates the update before reloading when the user taps update', async () => {
    updates.activateUpdate.and.callFake(async () => {
      expect(reload).not.toHaveBeenCalled();
      return true;
    });
    await service.apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the current app usable when the Pi is offline and allows an update retry', async () => {
    updates.checkForUpdate.and.rejectWith(new Error('offline'));
    await service.check();
    expect(service.available()).toBeFalse();
    updates.activateUpdate.and.rejectWith(new Error('offline'));
    await service.apply();
    expect(service.updating()).toBeFalse();
    expect(service.error()).toContain('Could not update');
    expect(reload).not.toHaveBeenCalled();
    updates.activateUpdate.and.resolveTo(true);
    await service.apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
