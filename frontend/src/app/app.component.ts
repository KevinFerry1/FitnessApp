import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';

type Tab = 'today' | 'food' | 'workout' | 'progress' | 'profile';
type Sheet = 'food' | 'weight' | 'workout' | 'exercise' | 'import' | null;

interface FoodLog {
  id: number;
  name_snapshot: string;
  meal_type: string;
  calories_snapshot: number;
  protein_snapshot: number;
  logged_at: string;
}

interface ExerciseSet {
  id: number;
  set_number: number;
  weight: string | number | null;
  weight_unit: string;
  reps: number | null;
}

interface WorkoutExercise {
  id: number;
  exercise: { id: number; name: string };
  sets: ExerciseSet[];
  notes: string;
}

interface Workout {
  id: number;
  name: string;
  started_at: string;
  completed_at: string | null;
  workout_exercises: WorkoutExercise[];
}

interface TodayResponse {
  date: string;
  nutrition: { calories: number; protein: number; carbs: number; fat: number };
  food_logs: FoodLog[];
  workouts: Workout[];
  latest_weight: { weight: string; unit: string } | null;
}

interface ParsedWorkout {
  date: string;
  name: string;
  exercises: Array<{
    name: string;
    notes: string;
    sets: Array<{ set_number: number; reps: number; weight: string | null; weight_unit: string }>;
  }>;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  readonly api = '/api';
  readonly calorieGoal = 2800;
  readonly proteinGoal = 180;
  readonly tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'today', label: 'Today', icon: '⌂' },
    { id: 'food', label: 'Food', icon: '◒' },
    { id: 'workout', label: 'Workout', icon: '◇' },
    { id: 'progress', label: 'Progress', icon: '↗' },
    { id: 'profile', label: 'Profile', icon: '○' },
  ];

  activeTab = signal<Tab>('today');
  activeSheet = signal<Sheet>(null);
  loading = signal(true);
  saving = signal(false);
  toast = signal('');
  today = signal<TodayResponse>({
    date: new Date().toISOString().slice(0, 10),
    nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    food_logs: [],
    workouts: [],
    latest_weight: null,
  });
  workouts = signal<Workout[]>([]);
  activeWorkout = signal<Workout | null>(null);
  importPreview = signal<{ workouts: ParsedWorkout[]; warnings: Array<{ line: number; text: string; message: string }> } | null>(null);

  foodForm = { name: '', meal_type: 'lunch', calories: null as number | null, protein: null as number | null, carbs: null as number | null, fat: null as number | null };
  weightForm = { weight: null as number | null, unit: 'lb', notes: '' };
  workoutName = 'Workout';
  exerciseName = '';
  setForm = { weight: null as number | null, reps: null as number | null };
  selectedExercise: WorkoutExercise | null = null;
  notesText = '';

  constructor(private readonly http: HttpClient) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.http.get<TodayResponse>(`${this.api}/today/`).subscribe({
      next: (data) => {
        this.today.set(data);
        this.activeWorkout.set(data.workouts.find((item) => !item.completed_at) ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.showToast('Could not reach the API. Is Django running?');
      },
    });
    this.http.get<Workout[]>(`${this.api}/workouts/`).subscribe({ next: (data) => this.workouts.set(data) });
  }

  setTab(tab: Tab): void {
    this.activeTab.set(tab);
    if (tab === 'workout' || tab === 'progress') this.loadWorkouts();
  }

  open(sheet: Sheet): void {
    this.activeSheet.set(sheet);
    if (sheet === 'import') this.importPreview.set(null);
  }

  close(): void {
    this.activeSheet.set(null);
  }

  addFood(): void {
    if (!this.foodForm.name.trim() || this.foodForm.calories === null) return;
    this.saving.set(true);
    const food = {
      name: this.foodForm.name.trim(),
      serving_description: '1 serving',
      calories: this.foodForm.calories,
      protein: this.foodForm.protein ?? 0,
      carbohydrates: this.foodForm.carbs ?? 0,
      fat: this.foodForm.fat ?? 0,
    };
    this.http.post<{ id: number }>(`${this.api}/foods/`, food).subscribe({
      next: (created) => {
        const log = {
          food: created.id,
          logged_at: new Date().toISOString(),
          meal_type: this.foodForm.meal_type,
          serving_quantity: 1,
          name_snapshot: food.name,
          calories_snapshot: food.calories,
          protein_snapshot: food.protein,
          carbs_snapshot: food.carbohydrates,
          fat_snapshot: food.fat,
        };
        this.http.post(`${this.api}/food-logs/`, log).subscribe({
          next: () => {
            this.foodForm = { name: '', meal_type: 'lunch', calories: null, protein: null, carbs: null, fat: null };
            this.finishAction('Food added');
          },
          error: () => this.failAction('Could not save food log'),
        });
      },
      error: () => this.failAction('Could not save food'),
    });
  }

  addWeight(): void {
    if (this.weightForm.weight === null) return;
    this.saving.set(true);
    this.http.post(`${this.api}/weight-entries/`, {
      ...this.weightForm,
      recorded_at: new Date().toISOString(),
    }).subscribe({
      next: () => {
        this.weightForm = { weight: null, unit: 'lb', notes: '' };
        this.finishAction('Weight logged');
      },
      error: () => this.failAction('Could not log weight'),
    });
  }

  startWorkout(): void {
    this.saving.set(true);
    this.http.post<Workout>(`${this.api}/workouts/`, {
      name: this.workoutName.trim() || 'Workout',
      started_at: new Date().toISOString(),
      notes: '',
      import_source: '',
    }).subscribe({
      next: (workout) => {
        this.activeWorkout.set({ ...workout, workout_exercises: [] });
        this.saving.set(false);
        this.close();
        this.setTab('workout');
        this.showToast('Workout started');
      },
      error: () => this.failAction('Could not start workout'),
    });
  }

  addExercise(): void {
    const workout = this.activeWorkout();
    if (!workout || !this.exerciseName.trim()) return;
    this.saving.set(true);
    this.http.post<{ id: number; name: string }>(`${this.api}/exercises/`, { name: this.exerciseName.trim(), muscle_group: '', equipment: '' }).subscribe({
      next: (exercise) => {
        this.http.post<WorkoutExercise>(`${this.api}/workout-exercises/`, {
          workout: workout.id,
          exercise_id: exercise.id,
          order: workout.workout_exercises.length,
          notes: '',
        }).subscribe({
          next: (workoutExercise) => {
            const normalized = { ...workoutExercise, exercise, sets: [] };
            this.activeWorkout.set({ ...workout, workout_exercises: [...workout.workout_exercises, normalized] });
            this.exerciseName = '';
            this.saving.set(false);
            this.close();
            this.selectExercise(normalized);
          },
          error: () => this.failAction('Could not add exercise'),
        });
      },
      error: () => this.failAction('Could not create exercise'),
    });
  }

  selectExercise(exercise: WorkoutExercise): void {
    this.selectedExercise = exercise;
    const previous = exercise.sets.at(-1);
    this.setForm = { weight: previous?.weight ? Number(previous.weight) : null, reps: previous?.reps ?? null };
  }

  addSet(exercise: WorkoutExercise): void {
    if (this.setForm.reps === null) return;
    this.saving.set(true);
    this.http.post<ExerciseSet>(`${this.api}/exercise-sets/`, {
      workout_exercise: exercise.id,
      set_number: exercise.sets.length + 1,
      weight: this.setForm.weight,
      weight_unit: 'lb',
      reps: this.setForm.reps,
      set_type: 'working',
      performed_at: new Date().toISOString(),
    }).subscribe({
      next: (set) => {
        exercise.sets = [...exercise.sets, set];
        this.setForm.reps = null;
        this.saving.set(false);
        this.showToast(`Set ${set.set_number} saved`);
      },
      error: () => this.failAction('Could not save set'),
    });
  }

  finishWorkout(): void {
    const workout = this.activeWorkout();
    if (!workout) return;
    this.saving.set(true);
    this.http.patch<Workout>(`${this.api}/workouts/${workout.id}/`, { completed_at: new Date().toISOString() }).subscribe({
      next: () => {
        this.selectedExercise = null;
        this.activeWorkout.set(null);
        this.finishAction('Workout finished');
      },
      error: () => this.failAction('Could not finish workout'),
    });
  }

  previewImport(): void {
    if (!this.notesText.trim()) return;
    this.saving.set(true);
    this.http.post<{ workouts: ParsedWorkout[]; warnings: Array<{ line: number; text: string; message: string }> }>(`${this.api}/imports/notes/`, {
      text: this.notesText,
      commit: false,
    }).subscribe({
      next: (result) => {
        this.importPreview.set(result);
        this.saving.set(false);
      },
      error: () => this.failAction('Could not parse notes'),
    });
  }

  commitImport(): void {
    this.saving.set(true);
    this.http.post<{ created_workout_ids: number[] }>(`${this.api}/imports/notes/`, {
      text: this.notesText,
      commit: true,
    }).subscribe({
      next: (result) => {
        this.notesText = '';
        this.importPreview.set(null);
        this.finishAction(`${result.created_workout_ids.length} workout${result.created_workout_ids.length === 1 ? '' : 's'} imported`);
        this.setTab('progress');
      },
      error: () => this.failAction('Could not import workouts'),
    });
  }

  get caloriePercent(): number {
    return Math.min(100, Math.round((Number(this.today().nutrition.calories) / this.calorieGoal) * 100));
  }

  get caloriesRemaining(): number {
    return Math.max(0, this.calorieGoal - Number(this.today().nutrition.calories));
  }

  get greeting(): string {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  }

  get firstImportedExerciseCount(): number {
    return this.importPreview()?.workouts[0]?.exercises.length ?? 0;
  }

  trackById(_index: number, item: { id: number }): number {
    return item.id;
  }

  private loadWorkouts(): void {
    this.http.get<Workout[]>(`${this.api}/workouts/`).subscribe({ next: (data) => this.workouts.set(data) });
  }

  private finishAction(message: string): void {
    this.saving.set(false);
    this.close();
    this.refresh();
    this.showToast(message);
  }

  private failAction(message: string): void {
    this.saving.set(false);
    this.showToast(message);
  }

  private showToast(message: string): void {
    this.toast.set(message);
    window.setTimeout(() => this.toast.set(''), 2600);
  }
}
