import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OfflineStore, PendingChange } from './offline-store';

type Tab = 'today' | 'food' | 'workout' | 'progress' | 'profile';
type Sheet = 'food' | 'weight' | 'workout' | 'exercise' | 'import' | 'profile' | null;
type EntityId = number | string;

function localDateString(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

interface ProfileSettings {
  display_name: string;
  calorie_goal: number;
  protein_goal: number;
  preferred_weight_unit: 'lb' | 'kg';
}

interface FoodLog {
  id: EntityId;
  name_snapshot: string;
  meal_type: string;
  calories_snapshot: number;
  protein_snapshot: number;
  logged_at: string;
}

interface ExerciseSet {
  id: EntityId;
  set_number: number;
  weight: string | number | null;
  weight_unit: string;
  reps: number | null;
  performed_at?: string;
}

interface WorkoutExercise {
  id: EntityId;
  exercise: { id: EntityId; name: string };
  sets: ExerciseSet[];
  notes: string;
}

interface Workout {
  id: EntityId;
  client_id?: string | null;
  sync_revision?: number;
  name: string;
  started_at: string;
  completed_at: string | null;
  workout_exercises: WorkoutExercise[];
}

interface WorkoutDraft {
  client_id: string;
  server_id?: number;
  revision: number;
  name: string;
  started_at: string;
  completed_at: string | null;
  notes: string;
  exercises: Array<{
    client_id: string;
    name: string;
    notes: string;
    sets: Array<{ set_number: number; weight: number | null; weight_unit: 'lb' | 'kg'; reps: number; performed_at: string }>;
  }>;
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
    date: localDateString(),
    nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    food_logs: [],
    workouts: [],
    latest_weight: null,
  });
  workouts = signal<Workout[]>([]);
  activeWorkout = signal<Workout | null>(null);
  expandedWorkoutId = signal<EntityId | null>(null);
  profile = signal<ProfileSettings>({ display_name: 'Your profile', calorie_goal: 2800, protein_goal: 180, preferred_weight_unit: 'lb' });
  importPreview = signal<{ workouts: ParsedWorkout[]; warnings: Array<{ line: number; text: string; message: string }> } | null>(null);

  foodForm = { name: '', meal_type: 'lunch', calories: null as number | null, protein: null as number | null, carbs: null as number | null, fat: null as number | null };
  weightForm: { weight: number | null; unit: 'lb' | 'kg'; notes: string } = { weight: null, unit: 'lb', notes: '' };
  workoutName = 'Workout';
  exerciseName = '';
  setForm = { weight: null as number | null, reps: null as number | null };
  selectedExercise: WorkoutExercise | null = null;
  notesText = '';
  private notesImportId: string = crypto.randomUUID();
  profileForm: ProfileSettings = { ...this.profile() };
  private currentDraft: WorkoutDraft | null = null;
  private serverToday: TodayResponse = structuredClone(this.today());
  private serverWorkouts: Workout[] = [];

  constructor(private readonly http: HttpClient, readonly offline: OfflineStore) {}

  ngOnInit(): void {
    this.offline.synced.subscribe(() => this.refresh());
    void this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await this.offline.init();
      this.serverToday = await this.offline.getCached<TodayResponse>('today') ?? this.serverToday;
      this.serverWorkouts = await this.offline.getCached<Workout[]>('workouts') ?? [];
      this.currentDraft = await this.offline.getCached<WorkoutDraft>('activeDraft');
      this.profile.set(await this.offline.getCached<ProfileSettings>('profile') ?? this.profile());
      const notesDraft = await this.offline.getCached<{ text: string; id: string }>('notesDraft');
      if (notesDraft) { this.notesText = notesDraft.text; this.notesImportId = notesDraft.id; }
      await this.applyLocalState();
    } catch {
      this.showToast('On-device storage is unavailable. Saves need a connection.');
    }
    this.refresh();
  }

  refresh(): void {
    this.loading.set(true);
    this.http.get<TodayResponse>(`${this.api}/today/`).subscribe({
      next: (data) => {
        this.serverToday = data;
        void this.offline.cache('today', data).catch(() => {});
        void this.applyLocalState();
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
    this.loadWorkouts();
    this.http.get<ProfileSettings>(`${this.api}/profile/`).subscribe({ next: (data) => {
      this.profile.set(data);
      void this.offline.cache('profile', data).catch(() => {});
      void this.applyLocalState();
    } });
  }

  setTab(tab: Tab): void {
    this.activeTab.set(tab);
    if (tab === 'workout' || tab === 'progress') this.loadWorkouts();
  }

  open(sheet: Sheet): void {
    this.activeSheet.set(sheet);
    if (sheet === 'import') this.importPreview.set(null);
    if (sheet === 'profile') this.profileForm = { ...this.profile() };
    if (sheet === 'weight') this.weightForm.unit = this.profile().preferred_weight_unit;
  }

  close(): void {
    this.activeSheet.set(null);
  }

  async addFood(): Promise<void> {
    if (!this.foodForm.name.trim() || this.foodForm.calories === null) return;
    this.saving.set(true);
    const payload = {
      name: this.foodForm.name.trim(),
      meal_type: this.foodForm.meal_type,
      calories: this.foodForm.calories,
      protein: this.foodForm.protein ?? 0,
      carbohydrates: this.foodForm.carbs ?? 0,
      fat: this.foodForm.fat ?? 0,
      logged_at: new Date().toISOString(),
    };
    try {
      await this.offline.enqueue('food_log', payload);
      this.foodForm = { name: '', meal_type: 'lunch', calories: null, protein: null, carbs: null, fat: null };
      await this.applyLocalState();
      this.finishAction('Food saved on device');
    } catch {
      this.failAction('Could not save food on this device');
    }
  }

  async addWeight(): Promise<void> {
    if (this.weightForm.weight === null) return;
    this.saving.set(true);
    try {
      await this.offline.enqueue('weight_entry', { ...this.weightForm, recorded_at: new Date().toISOString() });
      this.weightForm = { weight: null, unit: this.profile().preferred_weight_unit, notes: '' };
      await this.applyLocalState();
      this.finishAction('Weight saved on device');
    } catch {
      this.failAction('Could not save weight on this device');
    }
  }

  async startWorkout(): Promise<void> {
    this.saving.set(true);
    const draft: WorkoutDraft = {
      client_id: crypto.randomUUID(), revision: 0,
      name: this.workoutName.trim() || 'Workout',
      started_at: new Date().toISOString(),
      completed_at: null,
      notes: '',
      exercises: [],
    };
    try {
      await this.persistDraft(draft);
      this.close();
      this.setTab('workout');
      this.saving.set(false);
      this.showToast('Workout saved on device');
    } catch {
      this.failAction('Could not save workout on this device');
    }
  }

  async addExercise(): Promise<void> {
    const draft = await this.ensureDraft();
    if (!draft || !this.exerciseName.trim()) return;
    this.saving.set(true);
    const clientId = crypto.randomUUID();
    draft.exercises.push({ client_id: clientId, name: this.exerciseName.trim(), notes: '', sets: [] });
    try {
      await this.persistDraft(draft);
      this.exerciseName = '';
      this.saving.set(false);
      this.close();
      const exercise = this.activeWorkout()?.workout_exercises.find((item) => item.id === clientId);
      if (exercise) this.selectExercise(exercise);
    } catch {
      draft.exercises.pop();
      this.failAction('Could not save exercise on this device');
    }
  }

  selectExercise(exercise: WorkoutExercise): void {
    this.selectedExercise = exercise;
    const previous = exercise.sets.at(-1);
    this.setForm = { weight: previous?.weight ? Number(previous.weight) : null, reps: previous?.reps ?? null };
  }

  async addSet(exercise: WorkoutExercise): Promise<void> {
    if (this.setForm.reps === null) return;
    const draft = await this.ensureDraft();
    const draftExercise = draft?.exercises.find((item) => item.client_id === exercise.id);
    if (!draft || !draftExercise) return;
    this.saving.set(true);
    draftExercise.sets.push({
      set_number: draftExercise.sets.length + 1,
      weight: this.setForm.weight,
      weight_unit: this.profile().preferred_weight_unit,
      reps: this.setForm.reps,
      performed_at: new Date().toISOString(),
    });
    try {
      await this.persistDraft(draft);
      this.selectedExercise = this.activeWorkout()?.workout_exercises.find((item) => item.id === exercise.id) ?? null;
      this.setForm.reps = null;
      this.saving.set(false);
      this.showToast(`Set ${draftExercise.sets.length} saved on device`);
    } catch {
      draftExercise.sets.pop();
      this.failAction('Could not save set on this device');
    }
  }

  async finishWorkout(): Promise<void> {
    const draft = await this.ensureDraft();
    if (!draft) return;
    this.saving.set(true);
    draft.completed_at = new Date().toISOString();
    try {
      await this.persistDraft(draft);
      this.currentDraft = null;
      await this.offline.cache('activeDraft', null);
      this.selectedExercise = null;
      await this.applyLocalState();
      this.finishAction('Workout saved on device');
    } catch {
      draft.completed_at = null;
      this.failAction('Could not finish workout on this device');
    }
  }

  async saveProfile(): Promise<void> {
    const next = { ...this.profileForm, display_name: this.profileForm.display_name.trim() || 'Your profile' };
    if (next.calorie_goal < 1 || next.protein_goal < 1) return;
    this.saving.set(true);
    try {
      await this.offline.enqueue('profile', next);
      this.profile.set(next);
      await this.offline.cache('profile', next);
      this.close();
      this.saving.set(false);
      this.showToast('Profile saved on device');
    } catch {
      this.failAction('Could not save profile on this device');
    }
  }

  private async persistDraft(draft: WorkoutDraft): Promise<void> {
    draft.revision += 1;
    await this.offline.enqueue('workout', draft, draft.client_id);
    this.currentDraft = draft.completed_at ? null : draft;
    await this.offline.cache('activeDraft', this.currentDraft);
    await this.applyLocalState();
  }

  private async ensureDraft(): Promise<WorkoutDraft | null> {
    if (this.currentDraft) return this.currentDraft;
    const workout = this.activeWorkout();
    if (!workout) return null;
    const draft: WorkoutDraft = {
      client_id: workout.client_id || crypto.randomUUID(),
      server_id: typeof workout.id === 'number' ? workout.id : undefined,
      revision: workout.sync_revision ?? 0,
      name: workout.name,
      started_at: workout.started_at,
      completed_at: workout.completed_at,
      notes: '',
      exercises: workout.workout_exercises.map((item) => ({
        client_id: crypto.randomUUID(), name: item.exercise.name, notes: item.notes,
        sets: item.sets.map((set) => ({
          set_number: set.set_number, weight: set.weight === null ? null : Number(set.weight),
          weight_unit: set.weight_unit === 'kg' ? 'kg' : 'lb', reps: set.reps ?? 0,
          performed_at: set.performed_at ?? new Date().toISOString(),
        })),
      })),
    };
    this.currentDraft = draft;
    await this.offline.cache('activeDraft', draft);
    await this.applyLocalState();
    return draft;
  }

  private draftToWorkout(draft: WorkoutDraft): Workout {
    return {
      id: draft.server_id ?? draft.client_id,
      client_id: draft.client_id,
      sync_revision: draft.revision,
      name: draft.name,
      started_at: draft.started_at,
      completed_at: draft.completed_at,
      workout_exercises: draft.exercises.map((item) => ({
        id: item.client_id,
        exercise: { id: item.client_id, name: item.name },
        notes: item.notes,
        sets: item.sets.map((set) => ({
          id: `${item.client_id}-${set.set_number}`,
          set_number: set.set_number, weight: set.weight, weight_unit: set.weight_unit,
          reps: set.reps, performed_at: set.performed_at,
        })),
      })),
    };
  }

  private async applyLocalState(): Promise<void> {
    let pending: PendingChange[] = [];
    try { pending = await this.offline.getPending(); } catch { /* Online-only fallback. */ }
    const today = structuredClone(this.serverToday);
    const workouts = structuredClone(this.serverWorkouts);
    const applyWorkout = (draft: WorkoutDraft) => {
      const workout = this.draftToWorkout(draft);
      const oldIndex = workouts.findIndex((item) => item.client_id === draft.client_id || item.id === draft.server_id);
      if (oldIndex >= 0) workouts.splice(oldIndex, 1);
      workouts.unshift(workout);
      if (new Date(draft.started_at).toDateString() === new Date(today.date + 'T12:00:00').toDateString()) {
        const dayIndex = today.workouts.findIndex((item) => item.client_id === draft.client_id || item.id === draft.server_id);
        if (dayIndex >= 0) today.workouts.splice(dayIndex, 1);
        today.workouts.unshift(workout);
      }
    };
    for (const item of pending) {
      if (item.kind === 'food_log') {
        const food = item.payload as { name: string; meal_type: string; calories: number; protein: number; carbohydrates: number; fat: number; logged_at: string };
        if (new Date(food.logged_at).toDateString() === new Date(today.date + 'T12:00:00').toDateString()) {
          today.food_logs.unshift({ id: item.id, name_snapshot: food.name, meal_type: food.meal_type,
            calories_snapshot: food.calories, protein_snapshot: food.protein, logged_at: food.logged_at });
          today.nutrition.calories = Number(today.nutrition.calories) + Number(food.calories);
          today.nutrition.protein = Number(today.nutrition.protein) + Number(food.protein);
          today.nutrition.carbs = Number(today.nutrition.carbs) + Number(food.carbohydrates);
          today.nutrition.fat = Number(today.nutrition.fat) + Number(food.fat);
        }
      } else if (item.kind === 'weight_entry') {
        const weight = item.payload as { weight: number; unit: string };
        today.latest_weight = { weight: String(weight.weight), unit: weight.unit };
      } else if (item.kind === 'workout') {
        applyWorkout(item.payload as WorkoutDraft);
      } else if (item.kind === 'profile') {
        this.profile.set(item.payload as ProfileSettings);
      }
    }
    if (this.currentDraft) {
      const serverMatch = workouts.find((item) => item.client_id === this.currentDraft?.client_id && typeof item.id === 'number');
      if (serverMatch) this.currentDraft.server_id = serverMatch.id as number;
      applyWorkout(this.currentDraft);
    }
    this.today.set(today);
    this.workouts.set(workouts);
    this.activeWorkout.set(this.currentDraft ? this.draftToWorkout(this.currentDraft) : today.workouts.find((item) => !item.completed_at) ?? null);
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
      client_id: this.notesImportId,
    }).subscribe({
      next: (result) => {
        this.notesText = '';
        this.notesImportId = crypto.randomUUID();
        void this.offline.cache('notesDraft', null).catch(() => {});
        this.importPreview.set(null);
        this.finishAction(`${result.created_workout_ids.length} workout${result.created_workout_ids.length === 1 ? '' : 's'} imported`);
        this.setTab('progress');
      },
      error: () => this.failAction('Could not import workouts'),
    });
  }

  noteTextChanged(): void {
    this.notesImportId = crypto.randomUUID();
    void this.offline.cache('notesDraft', { text: this.notesText, id: this.notesImportId }).catch(() => {});
  }

  get caloriePercent(): number {
    return Math.min(100, Math.round((Number(this.today().nutrition.calories) / this.calorieGoal) * 100));
  }

  get caloriesRemaining(): number {
    return Math.max(0, this.calorieGoal - Number(this.today().nutrition.calories));
  }

  get calorieGoal(): number { return this.profile().calorie_goal; }
  get proteinGoal(): number { return this.profile().protein_goal; }
  get initials(): string {
    return this.profile().display_name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'ME';
  }

  get greeting(): string {
    const hour = new Date().getHours();
    return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  }

  get firstImportedExerciseCount(): number {
    return this.importPreview()?.workouts[0]?.exercises.length ?? 0;
  }

  trackById(_index: number, item: { id: EntityId }): EntityId {
    return item.id;
  }

  private loadWorkouts(): void {
    this.http.get<Workout[]>(`${this.api}/workouts/`).subscribe({ next: (data) => {
      this.serverWorkouts = data;
      void this.offline.cache('workouts', data).catch(() => {});
      void this.applyLocalState();
    } });
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
