import { TestBed } from '@angular/core/testing';
import { MuscleWeekComponent } from './muscle-week.component';
import { VolumeWorkout } from './muscle-volume';

const workout = (id: number, date: string, count: number): VolumeWorkout => ({ id, name: 'Upper A', started_at: date, completed_at: date,
  workout_exercises: [{ id, exercise: { name: 'DB incline press' }, notes: '', sets: Array.from({ length: count }, (_, i) => ({ id: `${id}:${i}`, set_number: i + 1, weight: 50, weight_unit: 'lb', reps: 8 })) }] });

describe('MuscleWeekComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [MuscleWeekComponent] }));

  it('replaces the overview with body-click details and updates those details mid-workout', () => {
    const fixture = TestBed.createComponent(MuscleWeekComponent);
    fixture.componentRef.setInput('now', Date.parse('2026-10-06T12:00:00-04:00'));
    fixture.componentRef.setInput('workouts', [workout(1, '2026-10-05T12:00:00-04:00', 3)]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const chest = root.querySelector('g[aria-label^="Chest:"]')!;
    expect(chest.classList.contains('below')).toBeTrue();
    chest.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector('.overview-heading')).toBeNull();
    expect(root.querySelector('.muscle-detail h3')?.textContent).toBe('Chest');
    expect(root.querySelector('.detail-total b')?.textContent).toBe('3');
    expect(root.querySelector('.volume-exercise')?.textContent).toContain('DB incline press');
    fixture.componentRef.setInput('activeWorkout', { ...workout(1, '2026-10-05T12:00:00-04:00', 4), completed_at: null });
    fixture.detectChanges();
    expect(root.querySelector('.detail-total b')?.textContent).toBe('4');
    expect(root.querySelector('g[aria-label^="Chest:"]')?.classList.contains('good')).toBeTrue();
    expect(root.querySelector('.volume-session')?.textContent).toContain('In progress');
    (root.querySelector('.overview-back') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.overview-heading')).toBeTruthy();
  });

  it('browses historical weeks with arrows and supports back-view muscles', () => {
    const fixture = TestBed.createComponent(MuscleWeekComponent);
    fixture.componentRef.setInput('now', Date.parse('2026-10-06T12:00:00-04:00'));
    fixture.componentRef.setInput('workouts', [workout(1, '2026-10-05T12:00:00-04:00', 4), workout(2, '2026-10-01T12:00:00-04:00', 2)]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.disabled).toBeTrue();
    root.querySelector<HTMLButtonElement>('[aria-label="Previous week"]')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.weekStart()).toBe('2026-09-28');
    expect(fixture.componentInstance.totalSets()).toBe(2);
    const row = [...root.querySelectorAll<HTMLButtonElement>('.muscle-overview-row')].find((item) => item.textContent!.includes('Chest'))!;
    row.click(); fixture.detectChanges();
    expect(root.querySelector('.detail-total b')?.textContent).toBe('2');
    root.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click(); fixture.detectChanges();
    expect(root.querySelector('.detail-total b')?.textContent).toBe('4');
    fixture.componentInstance.view.set('back'); fixture.detectChanges();
    expect(root.querySelector('g[aria-label^="Hamstrings:"]')).toBeTruthy();
  });
});
