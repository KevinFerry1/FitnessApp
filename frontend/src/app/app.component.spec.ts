import { HttpClientTestingModule } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent, HttpClientTestingModule],
    }).compileComponents();
  });

  it('creates the mobile app shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
    expect(fixture.componentInstance.activeTab()).toBe('today');
  });

  it('shows the latest matching exercise and can expand to three sessions', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const exercise = (id: number) => ({ id, exercise: { id, name: 'Chest fly' }, notes: 'Seat 4',
      sets: [{ id, set_number: 1, weight: 25, weight_unit: 'lb', reps: 8 }] });
    const workout = (id: number, date: string) => ({ id, name: 'Upper B', started_at: date,
      completed_at: date, workout_exercises: [exercise(id)] });
    app.activeWorkout.set(workout(4, '2026-09-22T12:00:00Z'));
    app.workouts.set([workout(4, '2026-09-22T12:00:00Z'), workout(3, '2026-09-21T12:00:00Z'),
      workout(2, '2026-09-20T12:00:00Z'), workout(1, '2026-09-19T12:00:00Z')]);
    app.selectExercise(exercise(4));
    expect(app.selectedExerciseHistory.map((item) => item.workout.id)).toEqual([3]);
    app.showThreeSessions = true;
    expect(app.selectedExerciseHistory.map((item) => item.workout.id)).toEqual([3, 2, 1]);
  });

  it('shows workout management actions before the exercise list and opens the editor', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    app.activeTab.set('progress');
    app.viewedWorkout.set({ id: 1, name: 'Upper B', started_at: '2026-09-21T12:00:00Z',
      completed_at: '2026-09-21T13:00:00Z', workout_exercises: [{ id: 2,
        exercise: { id: 3, name: 'Chest fly' }, notes: '', sets: [] }] });
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    const actions = root.querySelector('.history-manage-actions');
    const exercise = root.querySelector('.history-full-exercise');
    expect(actions).toBeTruthy();
    expect(exercise).toBeTruthy();
    expect(actions!.compareDocumentPosition(exercise!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions!.textContent).toContain('Delete this day');
    (actions!.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(root.querySelector('.history-editor')).toBeTruthy();
    expect(root.textContent).toContain('Remove exercise');
  });

  it('shows the multiplied nutrition before logging fractional servings', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.foodForm = { name: 'Yogurt', meal_type: 'breakfast', calories: 140, protein: 12.5, carbs: 16, fat: 2.2 };
    app.foodServings = 1.5;
    app.foodSource = 'label';
    expect(app.canAddFood).toBeTrue();
    expect(app.foodTotals).toEqual({ calories: 210, protein: 18.75, carbs: 24, fat: 3.3 });
    app.foodForm.protein = null;
    expect(app.canAddFood).toBeFalse();
  });

  it('shows parsed set details in the Notes import preview', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.componentInstance.activeSheet.set('import');
    fixture.componentInstance.importPreview.set({ workouts: [{ date: '2026-09-21', name: 'Upper B',
      exercises: [{ name: 'Chest fly', notes: 'Seat 4',
        sets: [{ set_number: 1, weight: '25', weight_unit: 'lb', reps: 7 }] }] }], warnings: [] });
    fixture.detectChanges();
    const preview: HTMLElement = fixture.nativeElement.querySelector('.preview-workout');
    expect(preview).toBeTruthy();
    expect(preview.textContent).toContain('25 lb × 7 reps');
    expect(preview.textContent).toContain('Seat 4');
  });
});
