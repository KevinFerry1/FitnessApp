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
        exercise: { id: 3, name: 'Chest fly' }, notes: '', sets: [{ id: 4, set_number: 1,
          weight: 25, weight_unit: 'lb', reps: 7 }] }] });
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
    app.foodForm = { name: 'Yogurt', meal_type: 'breakfast', calories: 140, protein: 12.5, carbs: 16, fat: 2.2,
      sugar: 10, added_sugar: 4 };
    app.foodServings = 1.5;
    app.foodSource = 'label';
    expect(app.canAddFood).toBeTrue();
    expect(app.foodTotals).toEqual({ calories: 210, protein: 18.75, carbs: 24, fat: 3.3, sugar: 15, added_sugar: 6 });
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

  it('logs an optional lower-body row first, preserves plate units, and removes it offline', async () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    spyOn(app.offline, 'cache').and.resolveTo();
    spyOn(app.offline, 'getPending').and.resolveTo([]);
    spyOn(app.offline, 'enqueue').and.resolveTo('saved');
    app.activeWorkout.set({ id: 'workout-1', client_id: 'workout-1', name: 'Lower A',
      started_at: '2026-09-24T12:00:00Z', completed_at: null, workout_exercises: [] });
    const calf = app.workoutRows(app.activeWorkout()!).find((row) => row.family === 'calf_raise')!;
    const entry = app.entryFor(calf);
    entry.weight = 2.25;
    entry.unit = 'plate';
    entry.reps = 8;
    await app.saveWorkoutRowSet(calf);
    const workout = app.activeWorkout()!;
    expect(workout.workout_exercises.length).toBe(1);
    expect(app.workoutRows(workout)[0].family).toBe('calf_raise');
    expect(workout.workout_exercises[0].sets[0].weight_unit).toBe('plate');
    expect(workout.workout_exercises[0].sets[0].weight).toBe(2.25);
    expect(app.recordedExercises(workout).length).toBe(1);
    spyOn(window, 'confirm').and.returnValue(true);
    await app.removeWorkoutRow(app.workoutRows(workout)[0]);
    expect(app.activeWorkout()!.workout_exercises.length).toBe(0);
  });

  it('times from the most recently logged set', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.activeWorkout.set({ id: 1, name: 'Upper B', started_at: '2026-09-24T12:00:00Z',
      completed_at: null, workout_exercises: [{ id: 2, exercise: { id: 3, name: 'Chest fly' }, notes: '',
        sets: [{ id: 4, set_number: 1, weight: 25, weight_unit: 'lb', reps: 7,
          performed_at: '2026-09-24T12:10:00Z' }] }] });
    app.clockNow.set(Date.parse('2026-09-24T12:11:23Z'));
    expect(app.lastSetTimer).toEqual({ label: 'Since last set', value: '01:23' });
  });

  it('filters only ambiguous imported days for review', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const workout = (id: number, notes: string, weight: number | null) => ({ id, name: 'Upper B',
      started_at: '2026-09-21T12:00:00Z', completed_at: '2026-09-21T13:00:00Z',
      workout_exercises: [{ id, exercise: { id, name: 'Chest fly' }, notes,
        sets: [{ id, set_number: 1, weight, weight_unit: 'lb', reps: 25 }] }] });
    app.workouts.set([workout(1, 'lb; seat 4', null), workout(2, 'seat 4', 25)]);
    expect(app.importReviewCount).toBe(1);
    app.reviewImportsOnly = true;
    expect(app.visibleWorkoutHistory.map((day) => day.id)).toEqual([1]);
  });

  it('shows a similarly named historical exercise beneath a current option', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.activeWorkout.set({ id: 'current', client_id: 'current', name: 'Upper B',
      started_at: '2026-09-24T12:00:00Z', completed_at: null, workout_exercises: [] });
    app.workouts.set([{ id: 1, name: 'Upper A', started_at: '2026-09-17T12:00:00Z',
      completed_at: '2026-09-17T13:00:00Z', workout_exercises: [{ id: 2,
        exercise: { id: 3, name: 'Single arm lateral raise' }, notes: 'Good form',
        sets: [{ id: 4, set_number: 1, weight: 10, weight_unit: 'lb', reps: 7 }] }] }]);
    const row = app.workoutRows(app.activeWorkout()!).find((item) => item.family === 'shoulder')!;
    expect(row.options).toContain('Single arm lateral raise');
    expect(app.historyForRow(row)[0].exercise.exercise.name).toBe('Single arm lateral raise');
  });

  it('updates the previous panel when an exercise variation is selected', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    const day = (id: number, date: string, name: string, weight: number) => ({
      id, name: 'Upper B', started_at: date, completed_at: date,
      workout_exercises: [{ id, exercise: { id, name }, notes: '',
        sets: [{ id, set_number: 1, weight, weight_unit: 'lb', reps: 7 }] }],
    });
    app.activeTab.set('workout');
    app.activeWorkout.set({ id: 10, name: 'Upper B', started_at: '2026-09-24T12:00:00Z',
      completed_at: null, workout_exercises: [] });
    app.workouts.set([day(3, '2026-09-23T12:00:00Z', 'Pec deck', 50),
      day(2, '2026-09-22T12:00:00Z', 'Arsenal chest fly', 25),
      day(1, '2026-09-21T12:00:00Z', 'Arsenal chest fly', 20)]);
    fixture.detectChanges();
    const rows = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.training-row')];
    const flyRow = rows.find((row) => row.querySelector('.training-group')?.textContent === 'Chest fly')!;
    const select = flyRow.querySelector<HTMLSelectElement>('.training-select select')!;
    expect(flyRow.querySelector('.training-previous')?.textContent).toContain('50 lb');
    expect(flyRow.querySelector('.training-previous')?.textContent).not.toContain('25 lb');
    expect(flyRow.querySelector('.training-previous button')).toBeNull();

    select.value = 'Arsenal chest fly';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(flyRow.querySelector('.training-previous')?.textContent).toContain('25 lb');
    expect(flyRow.querySelector('.training-previous')?.textContent).not.toContain('50 lb');
    expect(flyRow.querySelector('.training-previous button')?.textContent).toContain('See last 3');
  });

  it('combines selected logged foods into one reusable recipe without changing today', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const today = app.today();
    today.food_logs = [
      { id: 1, name_snapshot: 'Oats', meal_type: 'breakfast', serving_quantity: 1,
        serving_description_snapshot: 'cup', calories_snapshot: 150, protein_snapshot: 5,
        carbs_snapshot: 27, fat_snapshot: 3, sugar_snapshot: 1, added_sugar_snapshot: 0,
        nutrition_source: 'manual', label_photo_url: null, logged_at: new Date().toISOString() },
      { id: 2, name_snapshot: 'Milk', meal_type: 'breakfast', serving_quantity: 1.5,
        serving_description_snapshot: 'cup', calories_snapshot: 180, protein_snapshot: 12,
        carbs_snapshot: 18, fat_snapshot: 7, sugar_snapshot: 18, added_sugar_snapshot: null,
        nutrition_source: 'manual', label_photo_url: null, logged_at: new Date().toISOString() },
    ];
    app.today.set({ ...today });
    app.toggleRecipeLog(1);
    app.toggleRecipeLog(2);
    app.saveSelectedFoodAsMeal();
    expect(app.savedMealForm.calories).toBe(330);
    expect(app.savedMealForm.protein).toBe(17);
    expect(app.savedMealForm.sugar).toBe(19);
    expect(app.savedMealForm.added_sugar).toBeNull();
    expect(app.savedMealForm.components).toEqual([{ name: 'Oats', servings: 1 }, { name: 'Milk', servings: 1.5 }]);
    expect(app.today().food_logs.length).toBe(2);
  });

  it('compares recent and prior morning-weight averages with the chosen target', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    const morning = (daysAgo: number) => {
      const date = new Date();
      date.setDate(date.getDate() - daysAgo);
      date.setHours(8, 0, 0, 0);
      return date.toISOString();
    };
    app.weightEntries.set([
      { id: 1, weight: 180.5, unit: 'lb', recorded_at: morning(0), notes: '' },
      { id: 2, weight: 180.5, unit: 'lb', recorded_at: morning(2), notes: '' },
      { id: 5, weight: 180.5, unit: 'lb', recorded_at: morning(4), notes: '' },
      { id: 3, weight: 180, unit: 'lb', recorded_at: morning(8), notes: '' },
      { id: 4, weight: 180, unit: 'lb', recorded_at: morning(10), notes: '' },
      { id: 6, weight: 180, unit: 'lb', recorded_at: morning(12), notes: '' },
    ]);
    expect(app.weightTrend.change).toBeCloseTo(0.5, 2);
    expect(app.weightTrendStatus).toContain('Near');
  });

  it('opens a logged food for editing with its original per-serving values', () => {
    const app = TestBed.createComponent(AppComponent).componentInstance;
    app.openFoodLog({ id: 7, name_snapshot: 'Cereal', meal_type: 'breakfast', serving_quantity: 2,
      serving_description_snapshot: '1 bowl', calories_snapshot: 320, protein_snapshot: 8,
      carbs_snapshot: 60, fat_snapshot: 4, sugar_snapshot: 24, added_sugar_snapshot: 18,
      per_serving: { calories: 160, protein: 4, carbohydrates: 30, fat: 2, sugar: 12, added_sugar: 9 },
      nutrition_source: 'barcode', label_photo_url: null, logged_at: new Date().toISOString() });
    app.editFoodLog();
    expect(app.activeSheet()).toBe('food');
    expect(app.foodServings).toBe(2);
    expect(app.foodForm.added_sugar).toBe(9);
    expect(app.foodTotals.added_sugar).toBe(18);
    app.foodServings = 3;
    expect(app.foodTotals.calories).toBe(480);
  });
});
