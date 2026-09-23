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
});
