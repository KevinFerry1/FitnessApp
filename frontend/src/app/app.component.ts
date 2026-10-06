import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnInit, OnDestroy, signal, ChangeDetectionStrategy, NgZone } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OfflineStore, PendingChange } from './offline-store';
import { parseNutritionLabel } from './nutrition-label';
import { AppUpdates } from './app-updates';
import { MuscleWeekComponent } from './muscle-week.component';
import { exerciseFamily, exerciseHistoryKey, familyForExercise, matchesSlot, SavedExerciseOption, slotsForWorkout, variationsForSlot } from './exercise-catalog';

type Tab = 'today' | 'food' | 'workout' | 'muscles' | 'progress' | 'weight' | 'profile';
type Sheet = 'food' | 'foodLog' | 'scanner' | 'weight' | 'workout' | 'exercise' | 'import' | 'profile' | 'savedMeal' | null;
type NutritionSource = 'manual' | 'barcode' | 'label' | 'saved_meal';
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
  target_weekly_gain: number;
}

interface FoodLog {
  id: EntityId;
  client_id?: string | null;
  name_snapshot: string;
  meal_type: string;
  calories_snapshot: number;
  protein_snapshot: number;
  carbs_snapshot: number;
  fat_snapshot: number;
  sugar_snapshot?: number | null;
  added_sugar_snapshot?: number | null;
  per_serving?: { calories: number; protein: number; carbohydrates: number; fat: number; sugar: number | null; added_sugar: number | null } | null;
  serving_quantity: number | string;
  serving_description_snapshot: string;
  nutrition_source: NutritionSource;
  label_photo_url: string | null;
  logged_at: string;
}

interface ExerciseSet {
  id: EntityId;
  set_number: number;
  weight: string | number | null;
  weight_unit: string;
  reps: number | null;
  performed_at?: string;
  set_type?: string;
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
  notes?: string;
  workout_exercises: WorkoutExercise[];
}

interface SavedMeal {
  id: EntityId;
  client_id?: string | null;
  name: string;
  serving_description: string;
  meal_type: string;
  calories: number;
  protein: number;
  carbohydrates: number;
  fat: number;
  sugar: number | null;
  added_sugar: number | null;
  components: Array<{ name: string; servings: number }>;
}

interface WeightEntry { id: EntityId; weight: number; unit: 'lb' | 'kg'; recorded_at: string; notes: string }

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
    sets: Array<{ set_number: number; weight: number | null; weight_unit: 'lb' | 'kg' | 'plate'; reps: number; set_type: string; performed_at: string }>;
  }>;
}

interface TodayResponse {
  date: string;
  nutrition: { calories: number; protein: number; carbs: number; fat: number; sugar: number; added_sugar: number;
    sugar_unknown_count: number; added_sugar_unknown_count: number };
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

type WorkoutUnit = 'lb' | 'kg' | 'plate';

interface WorkoutRow {
  key: string;
  label: string;
  options: string[];
  name: string;
  family: string;
  exercise?: WorkoutExercise;
}

interface WorkoutEntry {
  name: string;
  weight: number | null;
  unit: WorkoutUnit;
  reps: number | null;
  notes: string;
  showThree: boolean;
  addingOption: boolean;
  newName: string;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule, FormsModule, MuscleWeekComponent],
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit, OnDestroy {
  readonly api = '/api';
  readonly tabs: Array<{ id: Tab; label: string; icon: string }> = [
    { id: 'today', label: 'Today', icon: '⌂' },
    { id: 'food', label: 'Food', icon: '◒' },
    { id: 'workout', label: 'Workout', icon: '◇' },
    { id: 'muscles', label: 'Muscles', icon: '◉' },
    { id: 'progress', label: 'Progress', icon: '↗' },
    { id: 'weight', label: 'Weight', icon: '⚖' },
    { id: 'profile', label: 'Profile', icon: '○' },
  ];

  activeTab = signal<Tab>('today');
  activeSheet = signal<Sheet>(null);
  loading = signal(true);
  saving = signal(false);
  clockNow = signal(Date.now());
  toast = signal('');
  today = signal<TodayResponse>({
    date: localDateString(),
    nutrition: { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, added_sugar: 0,
      sugar_unknown_count: 0, added_sugar_unknown_count: 0 },
    food_logs: [],
    workouts: [],
    latest_weight: null,
  });
  workouts = signal<Workout[]>([]);
  exerciseOptions = signal<SavedExerciseOption[]>([]);
  savedMeals = signal<SavedMeal[]>([]);
  weightEntries = signal<WeightEntry[]>([]);
  activeWorkout = signal<Workout | null>(null);
  viewedWorkout = signal<Workout | null>(null);
  profile = signal<ProfileSettings>({ display_name: 'Your profile', calorie_goal: 2800, protein_goal: 180,
    preferred_weight_unit: 'lb', target_weekly_gain: 0.5 });
  importPreview = signal<{ workouts: ParsedWorkout[]; warnings: Array<{ line: number; text: string; message: string }> } | null>(null);

  foodForm = { name: '', meal_type: 'lunch', calories: null as number | null, protein: null as number | null,
    carbs: null as number | null, fat: null as number | null, sugar: null as number | null, added_sugar: null as number | null };
  foodServings = 1;
  foodServingDescription = '1 serving';
  foodSource: NutritionSource = 'manual';
  labelPhotoDataUrl: string | null = null;
  labelOcrText = '';
  labelScanStatus = signal('');
  labelScanning = signal(false);
  barcodeNotFound = signal(false);
  selectedFoodLog: FoodLog | null = null;
  editingFoodLog: FoodLog | null = null;
  recipeSelectionMode = false;
  selectedRecipeLogIds = new Set<EntityId>();
  private labelScanToken = 0;
  private labelWorker: { terminate(): Promise<unknown> } | null = null;
  weightForm: { weight: number | null; unit: 'lb' | 'kg'; notes: string } = { weight: null, unit: 'lb', notes: '' };
  workoutName = 'Upper A';
  customWorkoutName = '';
  exerciseName = '';
  setForm = { weight: null as number | null, reps: null as number | null };
  selectedExercise: WorkoutExercise | null = null;
  showThreeSessions = false;
  historyDraft: WorkoutDraft | null = null;
  historyEdit = false;
  historyDate = '';
  reviewImportsOnly = false;
  savedMealForm: SavedMeal = { id: 0, name: '', serving_description: '1 serving', meal_type: 'lunch',
    calories: 0, protein: 0, carbohydrates: 0, fat: 0, sugar: null, added_sugar: null, components: [] };
  barcode = '';
  lookupServing = '';
  barcodeLoading = signal(false);
  barcodeScanStatus = signal('');
  private barcodeLookupToken = 0;
  private scannerControls: { stop(): void } | null = null;
  notesText = '';
  private notesImportId: string = crypto.randomUUID();
  profileForm: ProfileSettings = { ...this.profile() };
  private currentDraft: WorkoutDraft | null = null;
  private serverToday: TodayResponse = structuredClone(this.today());
  private serverWorkouts: Workout[] = [];
  private serverExerciseOptions: SavedExerciseOption[] = [];
  private serverWeightEntries: WeightEntry[] = [];
  private serverSavedMeals: SavedMeal[] = [];
  private clockInterval?: number;
  private entryWorkoutId = '';
  private workoutEntries: Record<string, WorkoutEntry> = {};

  constructor(private readonly http: HttpClient, readonly offline: OfflineStore, private readonly zone: NgZone, readonly appUpdates: AppUpdates) {}

  ngOnInit(): void {
    this.appUpdates.start();
    this.clockInterval = window.setInterval(() => this.clockNow.set(Date.now()), 1000);
    this.offline.synced.subscribe(() => this.refresh());
    void this.initialize();
  }

  ngOnDestroy(): void {
    this.appUpdates.stop();
    if (this.clockInterval !== undefined) window.clearInterval(this.clockInterval);
  }

  private async initialize(): Promise<void> {
    try {
      await this.offline.init();
      this.serverToday = await this.offline.getCached<TodayResponse>('today') ?? this.serverToday;
      this.serverWorkouts = await this.offline.getCached<Workout[]>('workouts') ?? [];
      this.serverExerciseOptions = await this.offline.getCached<SavedExerciseOption[]>('exerciseOptions') ?? [];
      this.serverWeightEntries = await this.offline.getCached<WeightEntry[]>('weightEntries') ?? [];
      this.serverSavedMeals = await this.offline.getCached<SavedMeal[]>('savedMeals') ?? [];
      this.currentDraft = await this.offline.getCached<WorkoutDraft>('activeDraft');
      this.profile.set({ ...this.profile(), ...(await this.offline.getCached<ProfileSettings>('profile') ?? {}) });
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
    this.http.get<SavedExerciseOption[]>(`${this.api}/exercises/`).subscribe({ next: (data) => {
      this.serverExerciseOptions = data;
      void this.offline.cache('exerciseOptions', data).catch(() => {});
      void this.applyLocalState();
    }, error: () => {} });
    this.loadSavedMeals();
    this.loadWeightEntries();
    this.http.get<ProfileSettings>(`${this.api}/profile/`).subscribe({ next: (data) => {
      this.profile.set({ ...this.profile(), ...data });
      void this.offline.cache('profile', data).catch(() => {});
      void this.applyLocalState();
    } });
  }

  setTab(tab: Tab): void {
    this.activeTab.set(tab);
    if (tab !== 'progress') { this.viewedWorkout.set(null); this.historyEdit = false; }
    if (tab === 'workout' || tab === 'progress' || tab === 'muscles') this.loadWorkouts();
  }

  async assignWeeklyMuscle(option: SavedExerciseOption): Promise<void> {
    this.saving.set(true);
    try {
      await this.offline.enqueue('exercise_option', { ...option, replace_group: true });
      this.exerciseOptions.update((options) => [...options.filter((item) => item.name.trim().toLowerCase() !== option.name.trim().toLowerCase()), option]);
      this.saving.set(false);
      this.showToast('Muscle group saved for this exercise');
    } catch { this.failAction('Could not save muscle group'); }
  }

  open(sheet: Sheet): void {
    if (sheet === 'food') this.editingFoodLog = null;
    this.activeSheet.set(sheet);
    if (sheet === 'import') this.importPreview.set(null);
    if (sheet === 'profile') this.profileForm = { ...this.profile() };
    if (sheet === 'weight') this.weightForm.unit = this.profile().preferred_weight_unit;
    if (sheet === 'savedMeal') this.savedMealForm = { id: 0, name: '', serving_description: '1 serving', meal_type: 'lunch',
      calories: 0, protein: 0, carbohydrates: 0, fat: 0, sugar: null, added_sugar: null, components: [] };
  }

  close(): void {
    this.stopScanner();
    this.labelScanToken += 1;
    this.labelScanning.set(false);
    this.stopLabelWorker();
    this.activeSheet.set(null);
  }

  private stopLabelWorker(): void {
    const worker = this.labelWorker;
    this.labelWorker = null;
    if (worker) void worker.terminate().catch(() => {});
  }

  get canAddFood(): boolean {
    const food = this.foodForm;
    return !!food.name.trim() && food.calories !== null && Number.isFinite(Number(food.calories)) &&
      Number(food.calories) >= 0 && Number(this.foodServings) > 0 && Number(this.foodServings) <= 100 &&
      [food.sugar, food.added_sugar].every((value) => value === null || Number.isFinite(Number(value)) && Number(value) >= 0) &&
      (food.sugar === null || food.added_sugar === null || Number(food.added_sugar) <= Number(food.sugar)) &&
      (this.foodSource === 'manual' || [food.protein, food.carbs, food.fat]
        .every((value) => value !== null && Number.isFinite(Number(value)) && Number(value) >= 0));
  }

  get foodTotals(): { calories: number; protein: number; carbs: number; fat: number; sugar: number | null; added_sugar: number | null } {
    const quantity = Number(this.foodServings) || 0;
    const round2 = (value: number | null) => Math.round(Number(value ?? 0) * quantity * 100) / 100;
    return { calories: Math.round(Number(this.foodForm.calories ?? 0) * quantity),
      protein: round2(this.foodForm.protein), carbs: round2(this.foodForm.carbs), fat: round2(this.foodForm.fat),
      sugar: this.foodForm.sugar === null ? null : round2(this.foodForm.sugar),
      added_sugar: this.foodForm.added_sugar === null ? null : round2(this.foodForm.added_sugar) };
  }

  openFoodLog(log: FoodLog): void {
    this.selectedFoodLog = log;
    this.activeSheet.set('foodLog');
  }

  editFoodLog(): void {
    const log = this.selectedFoodLog;
    if (!log) return;
    this.editingFoodLog = log;
    const quantity = Number(log.serving_quantity) || 1;
    const per = log.per_serving;
    this.foodForm = { name: log.name_snapshot, meal_type: log.meal_type,
      calories: per?.calories == null ? Math.round(Number(log.calories_snapshot) / quantity) : Number(per.calories),
      protein: per?.protein == null ? Number(log.protein_snapshot) / quantity : Number(per.protein),
      carbs: per?.carbohydrates == null ? Number(log.carbs_snapshot) / quantity : Number(per.carbohydrates),
      fat: per?.fat == null ? Number(log.fat_snapshot) / quantity : Number(per.fat),
      sugar: per?.sugar == null ? (log.sugar_snapshot == null ? null : Number(log.sugar_snapshot) / quantity) : Number(per.sugar),
      added_sugar: per?.added_sugar == null ? (log.added_sugar_snapshot == null ? null : Number(log.added_sugar_snapshot) / quantity) : Number(per.added_sugar) };
    this.foodServings = quantity;
    this.foodServingDescription = log.serving_description_snapshot;
    this.foodSource = log.nutrition_source;
    this.labelPhotoDataUrl = null;
    this.activeSheet.set('food');
  }

  toggleRecipeLog(id: EntityId): void {
    if (this.selectedRecipeLogIds.has(id)) this.selectedRecipeLogIds.delete(id);
    else this.selectedRecipeLogIds.add(id);
  }

  saveSelectedFoodAsMeal(): void {
    const chosen = this.today().food_logs.filter((log) => this.selectedRecipeLogIds.has(log.id));
    if (!chosen.length) return;
    const sum = (field: 'calories_snapshot' | 'protein_snapshot' | 'carbs_snapshot' | 'fat_snapshot') =>
      chosen.reduce((total, log) => total + Number(log[field] ?? 0), 0);
    const sumKnown = (field: 'sugar_snapshot' | 'added_sugar_snapshot') =>
      chosen.every((log) => log[field] != null) ? Math.round(chosen.reduce((total, log) => total + Number(log[field]), 0) * 100) / 100 : null;
    this.savedMealForm = { id: 0, name: chosen.length === 1 ? chosen[0].name_snapshot : '',
      serving_description: '1 recipe',
      meal_type: chosen[0].meal_type, calories: Math.round(sum('calories_snapshot')),
      protein: Math.round(sum('protein_snapshot') * 100) / 100,
      carbohydrates: Math.round(sum('carbs_snapshot') * 100) / 100,
      fat: Math.round(sum('fat_snapshot') * 100) / 100,
      sugar: sumKnown('sugar_snapshot'), added_sugar: sumKnown('added_sugar_snapshot'),
      components: chosen.map((log) => ({ name: log.name_snapshot, servings: Number(log.serving_quantity) })) };
    this.activeSheet.set('savedMeal');
  }

  private stopScanner(): void {
    this.scannerControls?.stop();
    this.scannerControls = null;
  }

  cancelScanner(): void {
    this.stopScanner();
    this.activeSheet.set('food');
  }

  async startScanner(): Promise<void> {
    this.barcodeScanStatus.set('Searching for a barcode…');
    this.activeSheet.set('scanner');
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const video = document.querySelector<HTMLVideoElement>('#barcode-video');
      if (!video || this.activeSheet() !== 'scanner') return;
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' }, audio: false }, video,
        (result, _error, scanner) => {
          if (!result || this.activeSheet() !== 'scanner') return;
          this.zone.run(() => {
            this.barcode = result.getText();
            this.barcodeScanStatus.set(`Detected ${this.barcode}. Looking up food…`);
            scanner.stop();
            this.scannerControls = null;
            this.activeSheet.set('food');
            this.lookupBarcode();
          });
        });
      if (this.activeSheet() === 'scanner') this.scannerControls = controls;
      else controls.stop();
    } catch {
      this.activeSheet.set('food');
      this.barcodeScanStatus.set('Live camera scan unavailable. Try a photo or enter the number.');
    }
  }

  async captureBarcodeImage(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const url = URL.createObjectURL(file);
    this.barcodeScanStatus.set('Reading barcode from photo…');
    try {
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(url);
      this.barcode = result.getText();
      this.barcodeScanStatus.set(`Detected ${this.barcode}. Looking up food…`);
      this.stopScanner();
      this.activeSheet.set('food');
      this.lookupBarcode();
    } catch {
      this.barcodeScanStatus.set('Could not read that photo. Try a closer, well-lit shot or enter the number.');
    } finally { URL.revokeObjectURL(url); }
  }

  async addFood(): Promise<void> {
    if (!this.canAddFood) return;
    this.saving.set(true);
    const payload = {
      name: this.foodForm.name.trim(),
      meal_type: this.foodForm.meal_type,
      calories: this.foodForm.calories,
      protein: this.foodForm.protein ?? 0,
      carbohydrates: this.foodForm.carbs ?? 0,
      fat: this.foodForm.fat ?? 0,
      sugar: this.foodForm.sugar,
      added_sugar: this.foodForm.added_sugar,
      serving_quantity: this.foodServings,
      serving_description: this.foodServingDescription.trim() || '1 serving',
      nutrition_source: this.foodSource,
      label_photo_data_url: this.labelPhotoDataUrl ?? '',
      logged_at: this.editingFoodLog?.logged_at ?? new Date().toISOString(),
    };
    try {
      const editing = this.editingFoodLog;
      if (editing && typeof editing.id === 'number') {
        await this.offline.enqueue('food_log_update', { ...payload, server_id: editing.id });
      } else {
        await this.offline.enqueue('food_log', payload, editing ? String(editing.id) : crypto.randomUUID());
      }
      this.editingFoodLog = null;
      this.selectedFoodLog = null;
      this.foodForm = { name: '', meal_type: 'lunch', calories: null, protein: null, carbs: null, fat: null,
        sugar: null, added_sugar: null };
      this.foodServings = 1;
      this.foodServingDescription = '1 serving';
      this.foodSource = 'manual';
      this.labelPhotoDataUrl = null;
      this.labelOcrText = '';
      this.labelScanStatus.set('');
      this.lookupServing = '';
      await this.applyLocalState();
      this.finishAction(editing ? 'Food changes saved on device' : 'Food saved on device');
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

  get weightTrend(): { recent: number | null; previous: number | null; change: number | null; count: number } {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dayMs = 86400000;
    const daily = new Map<number, number>();
    for (const entry of [...this.weightEntries()].reverse()) {
      const date = new Date(entry.recorded_at);
      const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      daily.set(day, Number(entry.weight) * (entry.unit === 'kg' ? 2.20462262 : 1));
    }
    const average = (from: number, to: number): number | null => {
      const values = [...daily].filter(([day]) => day >= from && day < to).map(([, weight]) => weight);
      return values.length >= 3 ? values.reduce((sum, weight) => sum + weight, 0) / values.length : null;
    };
    const recent = average(today.getTime() - 6 * dayMs, today.getTime() + dayMs);
    const previous = average(today.getTime() - 13 * dayMs, today.getTime() - 6 * dayMs);
    return { recent, previous, change: recent === null || previous === null ? null : recent - previous,
      count: daily.size };
  }

  get weightTrendStatus(): string {
    const change = this.weightTrend.change;
    if (change === null) return 'Keep logging mornings to compare two weeks.';
    const target = Number(this.profile().target_weekly_gain ?? 0.5);
    if (change < target - 0.15) return 'Below your chosen weekly target';
    if (change > target + 0.15) return 'Above your chosen weekly target';
    return 'Near your chosen weekly target';
  }

  async startWorkout(): Promise<void> {
    this.saving.set(true);
    const draft: WorkoutDraft = {
      client_id: crypto.randomUUID(), revision: 0,
      name: (this.workoutName === 'Custom' ? this.customWorkoutName : this.workoutName).trim() || 'Workout',
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

  workoutRows(workout: Workout): WorkoutRow[] {
    const slots = slotsForWorkout(workout.name);
    const previousNames = this.workouts().flatMap((day) => day.workout_exercises.map((item) => item.exercise.name));
    const exercises = [...workout.workout_exercises].sort((left, right) => {
      const leftTime = left.sets[0]?.performed_at ? Date.parse(left.sets[0].performed_at) : Infinity;
      const rightTime = right.sets[0]?.performed_at ? Date.parse(right.sets[0].performed_at) : Infinity;
      return leftTime - rightTime;
    });
    const savedOptions = this.exerciseOptions();
    const usedFamilies = new Set(exercises.map((item) => slots.find((slot) => matchesSlot(slot, item.exercise.name, savedOptions))?.id
      ?? familyForExercise(item.exercise.name, savedOptions)));
    const logged = exercises.map((exercise): WorkoutRow => {
      const slot = slots.find((item) => matchesSlot(item, exercise.exercise.name, savedOptions));
      const family = slot?.id ?? familyForExercise(exercise.exercise.name, savedOptions);
      const options = variationsForSlot(slot ?? { id: family, label: 'Custom exercise', options: [exercise.exercise.name] }, previousNames, savedOptions);
      if (!options.some((name) => name.toLowerCase() === exercise.exercise.name.toLowerCase())) options.push(exercise.exercise.name);
      return { key: `exercise:${exercise.id}`, label: slot?.label ?? 'Custom exercise',
        options, name: exercise.exercise.name, family, exercise };
    });
    const planned = slots.filter((slot) => !usedFamilies.has(slot.id)).map((slot): WorkoutRow => {
      const priorName = this.historyForFamily(slot.id, workout, 1)[0]?.exercise.exercise.name;
      return { key: `slot:${slot.id}`, label: slot.label, options: variationsForSlot(slot, previousNames, savedOptions),
        name: priorName ?? slot.options[0], family: slot.id };
    });
    return [...logged, ...planned];
  }

  recordedExercises(workout: Workout): WorkoutExercise[] {
    return workout.workout_exercises.filter((exercise) => exercise.sets.length > 0);
  }

  needsImportReview(workout: Workout): boolean {
    return workout.workout_exercises.some((exercise) =>
      /^(?:lbs?|kg|plates?)\b/i.test(exercise.notes.trim()) &&
      exercise.sets.some((set) => set.weight === null && (set.reps ?? 0) >= 20));
  }

  get importReviewCount(): number {
    return this.workouts().filter((workout) => this.needsImportReview(workout)).length;
  }

  get visibleWorkoutHistory(): Workout[] {
    return this.reviewImportsOnly && this.importReviewCount
      ? this.workouts().filter((workout) => this.needsImportReview(workout)) : this.workouts();
  }

  entryFor(row: WorkoutRow): WorkoutEntry {
    const workout = this.activeWorkout();
    const workoutId = String(workout?.client_id ?? workout?.id ?? '');
    if (workoutId !== this.entryWorkoutId) {
      this.entryWorkoutId = workoutId;
      this.workoutEntries = {};
    }
    if (this.workoutEntries[row.key]) return this.workoutEntries[row.key];
    const priorUnit = workout ? this.historyForFamily(row.family, workout, 1)[0]?.exercise.sets.at(-1)?.weight_unit : undefined;
    return this.workoutEntries[row.key] = {
      name: row.name,
      weight: row.exercise?.sets.at(-1)?.weight == null ? null : Number(row.exercise.sets.at(-1)!.weight),
      unit: ((row.exercise?.sets.at(-1)?.weight_unit ?? priorUnit) as WorkoutUnit | undefined) ?? this.profile().preferred_weight_unit,
      reps: null,
      notes: row.exercise?.notes ?? '',
      showThree: false,
      addingOption: false,
      newName: '',
    };
  }

  selectWorkoutOption(row: WorkoutRow, name: string): void {
    const entry = this.entryFor(row);
    entry.addingOption = name === '__new__';
    if (!entry.addingOption) { entry.name = name; entry.showThree = false; }
  }

  async saveExerciseOption(row: WorkoutRow): Promise<void> {
    const entry = this.entryFor(row);
    const name = entry.newName.trim();
    if (!name || name.length > 160) { this.showToast('Enter an exercise name up to 160 characters'); return; }
    const existing = row.options.find((option) => exerciseHistoryKey(option) === exerciseHistoryKey(name));
    if (existing) {
      entry.name = existing;
      entry.addingOption = false;
      entry.newName = '';
      entry.showThree = false;
      return;
    }
    const slot = slotsForWorkout(this.activeWorkout()?.name ?? '').find((item) => item.id === row.family);
    const detected = exerciseFamily(name);
    const option: SavedExerciseOption = { name, muscle_group: slot && (detected === slot.id || slot.families?.includes(detected)) ? detected : row.family };
    this.saving.set(true);
    try {
      await this.offline.enqueue('exercise_option', option);
      this.exerciseOptions.update((options) => [...options.filter((item) => item.name.toLowerCase() !== name.toLowerCase()), option]);
      entry.name = name;
      entry.addingOption = false;
      entry.newName = '';
      entry.showThree = false;
      this.saving.set(false);
      this.showToast('Exercise saved for future workouts');
    } catch { this.failAction('Could not save exercise option'); }
  }

  historyForFamily(family: string, active: Workout, limit: number): Array<{ workout: Workout; exercise: WorkoutExercise }> {
    const slot = slotsForWorkout(active.name).find((item) => item.id === family);
    return [...this.workouts()]
      .filter((workout) => workout.id !== active.id && (!active.client_id || workout.client_id !== active.client_id) &&
        new Date(workout.started_at) <= new Date(active.started_at))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))
      .flatMap((workout) => workout.workout_exercises
        .filter((exercise) => exercise.sets.length > 0 && (slot
          ? matchesSlot(slot, exercise.exercise.name, this.exerciseOptions())
          : familyForExercise(exercise.exercise.name, this.exerciseOptions()) === family))
        .map((exercise) => ({ workout, exercise })))
      .slice(0, limit);
  }

  historyForExerciseName(name: string, active: Workout, limit: number): Array<{ workout: Workout; exercise: WorkoutExercise }> {
    const selectedKey = exerciseHistoryKey(name);
    return [...this.workouts()]
      .filter((workout) => workout.id !== active.id && (!active.client_id || workout.client_id !== active.client_id) &&
        new Date(workout.started_at) <= new Date(active.started_at))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))
      .flatMap((workout) => workout.workout_exercises
        .filter((exercise) => exercise.sets.length > 0 && exerciseHistoryKey(exercise.exercise.name) === selectedKey)
        .map((exercise) => ({ workout, exercise })))
      .slice(0, limit);
  }

  historyForRow(row: WorkoutRow): Array<{ workout: Workout; exercise: WorkoutExercise }> {
    const active = this.activeWorkout();
    if (!active) return [];
    const entry = this.entryFor(row);
    return this.historyForExerciseName(entry.name, active, entry.showThree ? 3 : 1);
  }

  get lastSetTimer(): { label: string; value: string } {
    const workout = this.activeWorkout();
    if (!workout) return { label: 'Since last set', value: '00:00' };
    const latestSet = workout.workout_exercises.flatMap((exercise) => exercise.sets)
      .reduce((latest, set) => Math.max(latest, set.performed_at ? Date.parse(set.performed_at) || 0 : 0), 0);
    const seconds = Math.max(0, Math.floor((this.clockNow() - (latestSet || Date.parse(workout.started_at))) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60).toString().padStart(2, '0');
    const remainder = (seconds % 60).toString().padStart(2, '0');
    return { label: latestSet ? 'Since last set' : 'Workout running',
      value: hours ? `${hours}:${minutes}:${remainder}` : `${minutes}:${remainder}` };
  }

  private draftExerciseIndex(draft: WorkoutDraft, row: WorkoutRow, originalIndex: number): number {
    const byId = draft.exercises.findIndex((exercise) => exercise.client_id === String(row.exercise?.id));
    return byId >= 0 ? byId : originalIndex;
  }

  async saveWorkoutRowSet(row: WorkoutRow): Promise<void> {
    const entry = this.entryFor(row);
    const reps = Number(entry.reps);
    const weight = entry.weight === null ? null : Number(entry.weight);
    if (!entry.name.trim() || entry.reps === null || !Number.isInteger(reps) || reps < 0 ||
      (weight !== null && (!Number.isFinite(weight) || weight < 0))) {
      this.showToast('Enter an exercise and valid weight and reps');
      return;
    }
    const originalIndex = row.exercise ? this.activeWorkout()?.workout_exercises.findIndex((item) => item.id === row.exercise?.id) ?? -1 : -1;
    const current = await this.ensureDraft();
    if (!current) return;
    const draft = structuredClone(current);
    let index = row.exercise ? this.draftExerciseIndex(draft, row, originalIndex) : -1;
    if (index < 0) {
      draft.exercises.push({ client_id: crypto.randomUUID(), name: entry.name.trim(), notes: entry.notes.trim(), sets: [] });
      index = draft.exercises.length - 1;
    }
    const exercise = draft.exercises[index];
    exercise.name = entry.name.trim();
    exercise.notes = entry.notes.trim();
    const savedAt = new Date().toISOString();
    exercise.sets.push({ set_number: exercise.sets.length + 1, weight, weight_unit: entry.unit,
      reps, set_type: 'working', performed_at: savedAt });
    draft.exercises.sort((left, right) => {
      const leftTime = left.sets[0]?.performed_at ? Date.parse(left.sets[0].performed_at) : Infinity;
      const rightTime = right.sets[0]?.performed_at ? Date.parse(right.sets[0].performed_at) : Infinity;
      return leftTime - rightTime;
    });
    this.saving.set(true);
    try {
      await this.persistDraft(draft);
      entry.reps = null;
      this.clockNow.set(Date.now());
      this.saving.set(false);
      this.showToast('Set saved on device');
    } catch { this.failAction('Could not save set on this device'); }
  }

  async saveWorkoutRowDetails(row: WorkoutRow): Promise<void> {
    if (!row.exercise) return;
    const entry = this.entryFor(row);
    if (!entry.name.trim()) return;
    const originalIndex = this.activeWorkout()?.workout_exercises.findIndex((item) => item.id === row.exercise?.id) ?? -1;
    const current = await this.ensureDraft();
    if (!current) return;
    const draft = structuredClone(current);
    const exercise = draft.exercises[this.draftExerciseIndex(draft, row, originalIndex)];
    if (!exercise) return;
    if (exercise.name === entry.name.trim() && exercise.notes === entry.notes.trim()) return;
    exercise.name = entry.name.trim();
    exercise.notes = entry.notes.trim();
    this.saving.set(true);
    try { await this.persistDraft(draft); this.saving.set(false); }
    catch { this.failAction('Could not save exercise details'); }
  }

  async removeWorkoutRow(row: WorkoutRow): Promise<void> {
    if (!row.exercise) return;
    if (row.exercise.sets.length && !window.confirm(`Remove ${row.exercise.exercise.name} and all its sets from this workout?`)) return;
    const originalIndex = this.activeWorkout()?.workout_exercises.findIndex((item) => item.id === row.exercise?.id) ?? -1;
    const current = await this.ensureDraft();
    if (!current) return;
    const draft = structuredClone(current);
    const index = this.draftExerciseIndex(draft, row, originalIndex);
    if (index < 0) return;
    draft.exercises.splice(index, 1);
    this.saving.set(true);
    try {
      await this.persistDraft(draft);
      delete this.workoutEntries[row.key];
      this.saving.set(false);
      this.showToast('Exercise removed from this workout');
    } catch { this.failAction('Could not remove exercise'); }
  }

  selectExercise(exercise: WorkoutExercise): void {
    this.selectedExercise = exercise;
    this.showThreeSessions = false;
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
      set_type: 'working',
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
    const current = await this.ensureDraft();
    if (!current) return;
    const draft = structuredClone(current);
    draft.exercises = draft.exercises.filter((exercise) => exercise.sets.length > 0);
    if (!draft.exercises.length) { this.showToast('Log at least one set before finishing'); return; }
    this.saving.set(true);
    draft.completed_at = new Date().toISOString();
    try {
      await this.persistDraft(draft);
      this.currentDraft = null;
      await this.offline.cache('activeDraft', null);
      this.selectedExercise = null;
      await this.applyLocalState();
      this.finishAction('Workout saved on device');
    } catch { this.failAction('Could not finish workout on this device'); }
  }

  async saveProfile(): Promise<void> {
    const next = { ...this.profileForm, display_name: this.profileForm.display_name.trim() || 'Your profile' };
    if (next.calorie_goal < 1 || next.protein_goal < 1 || !Number.isFinite(Number(next.target_weekly_gain)) ||
      Number(next.target_weekly_gain) < 0 || Number(next.target_weekly_gain) > 10) return;
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
    const draft = this.workoutToDraft(workout);
    this.currentDraft = draft;
    await this.offline.cache('activeDraft', draft);
    await this.applyLocalState();
    return draft;
  }

  private workoutToDraft(workout: Workout): WorkoutDraft {
    return {
      client_id: workout.client_id || crypto.randomUUID(),
      server_id: typeof workout.id === 'number' ? workout.id : undefined,
      revision: workout.sync_revision ?? 0,
      name: workout.name,
      started_at: workout.started_at,
      completed_at: workout.completed_at,
      notes: workout.notes ?? '',
      exercises: workout.workout_exercises.map((item) => ({
        client_id: crypto.randomUUID(), name: item.exercise.name, notes: item.notes,
        sets: item.sets.map((set) => ({
          set_number: set.set_number, weight: set.weight === null ? null : Number(set.weight),
          weight_unit: set.weight_unit === 'kg' || set.weight_unit === 'plate' ? set.weight_unit : 'lb', reps: set.reps ?? 0,
          set_type: set.set_type ?? 'working',
          performed_at: set.performed_at ?? new Date().toISOString(),
        })),
      })),
    };
  }

  viewWorkout(workout: Workout): void {
    this.viewedWorkout.set(workout);
    this.historyDraft = null;
    this.historyEdit = false;
  }

  editWorkout(): void {
    const workout = this.viewedWorkout();
    if (!workout) return;
    this.historyDraft = this.workoutToDraft(workout);
    const date = new Date(workout.started_at);
    this.historyDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    this.historyEdit = true;
  }

  addHistoryExercise(): void {
    this.historyDraft?.exercises.push({ client_id: crypto.randomUUID(), name: '', notes: '', sets: [] });
  }

  removeHistoryExercise(index: number): void {
    this.historyDraft?.exercises.splice(index, 1);
  }

  addHistorySet(index: number): void {
    const exercise = this.historyDraft?.exercises[index];
    if (!exercise) return;
    exercise.sets.push({ set_number: exercise.sets.length + 1, weight: null,
      weight_unit: this.profile().preferred_weight_unit, reps: 0, set_type: 'working', performed_at: this.historyDraft!.started_at });
  }

  removeHistorySet(exerciseIndex: number, setIndex: number): void {
    const sets = this.historyDraft?.exercises[exerciseIndex]?.sets;
    if (!sets) return;
    sets.splice(setIndex, 1);
    sets.forEach((set, index) => set.set_number = index + 1);
  }

  async saveHistory(): Promise<void> {
    const draft = this.historyDraft;
    if (!draft || !draft.name.trim() || draft.exercises.some((item) => !item.name.trim()) || !this.historyDate) return;
    if (draft.exercises.some((item) => item.sets.some((set) => set.reps === null || set.reps < 0 ||
      set.weight !== null && set.weight < 0))) {
      this.showToast('Enter valid reps and non-negative weights for every set');
      return;
    }
    this.saving.set(true);
    const priorStart = new Date(draft.started_at);
    const [year, month, day] = this.historyDate.split('-').map(Number);
    const revisedStart = new Date(priorStart);
    revisedStart.setFullYear(year, month - 1, day);
    const duration = draft.completed_at ? new Date(draft.completed_at).getTime() - priorStart.getTime() : null;
    draft.started_at = revisedStart.toISOString();
    if (duration !== null) draft.completed_at = new Date(revisedStart.getTime() + duration).toISOString();
    draft.exercises.forEach((exercise) => exercise.sets.forEach((set, index) => {
      set.set_number = index + 1;
      set.performed_at = draft.started_at;
    }));
    draft.revision += 1;
    try {
      await this.offline.enqueue('workout', draft, draft.client_id);
      if (this.currentDraft && (this.currentDraft.client_id === draft.client_id ||
        draft.server_id !== undefined && this.currentDraft.server_id === draft.server_id)) {
        this.currentDraft = draft;
        await this.offline.cache('activeDraft', draft);
      }
      this.viewedWorkout.set(this.draftToWorkout(draft));
      this.historyEdit = false;
      await this.applyLocalState();
      this.saving.set(false);
      this.showToast('Workout changes saved on device');
    } catch { this.failAction('Could not save workout changes'); }
  }

  async deleteViewedWorkout(): Promise<void> {
    const workout = this.viewedWorkout();
    if (!workout || !window.confirm(`Delete ${workout.name} and all its exercises and sets?`)) return;
    this.saving.set(true);
    const serverId = typeof workout.id === 'number' ? workout.id : undefined;
    const clientId = workout.client_id || undefined;
    try {
      await this.offline.enqueue('workout_delete', { server_id: serverId, workout_client_id: clientId }, clientId ?? crypto.randomUUID());
      if (this.currentDraft && ((clientId !== undefined && this.currentDraft.client_id === clientId) ||
        (serverId !== undefined && this.currentDraft.server_id === serverId))) {
        this.currentDraft = null;
        await this.offline.cache('activeDraft', null);
        this.selectedExercise = null;
      }
      this.viewedWorkout.set(null);
      this.historyEdit = false;
      await this.applyLocalState();
      this.saving.set(false);
      this.showToast('Workout deleted on device');
    } catch { this.failAction('Could not delete workout'); }
  }

  get selectedExerciseHistory(): Array<{ workout: Workout; exercise: WorkoutExercise }> {
    const active = this.activeWorkout();
    if (!active || !this.selectedExercise) return [];
    return this.historyForFamily(exerciseFamily(this.selectedExercise.exercise.name), active, this.showThreeSessions ? 3 : 1);
  }

  async logSavedMeal(meal: SavedMeal): Promise<void> {
    try {
      await this.offline.enqueue('food_log', { name: meal.name, meal_type: meal.meal_type,
        calories: meal.calories, protein: meal.protein, carbohydrates: meal.carbohydrates,
        fat: meal.fat, sugar: meal.sugar, added_sugar: meal.added_sugar,
        serving_quantity: 1, serving_description: meal.serving_description,
        nutrition_source: 'saved_meal', logged_at: new Date().toISOString() });
      await this.applyLocalState();
      this.showToast(`${meal.name} saved on device`);
    } catch { this.showToast('Could not log saved meal'); }
  }

  editSavedMeal(meal: SavedMeal): void {
    this.activeSheet.set('savedMeal');
    this.savedMealForm = { ...meal };
  }

  useSavedMeal(meal: SavedMeal): void {
    this.barcodeLookupToken += 1;
    this.foodForm = { name: meal.name, meal_type: meal.meal_type, calories: meal.calories,
      protein: meal.protein, carbs: meal.carbohydrates, fat: meal.fat,
      sugar: meal.sugar ?? null, added_sugar: meal.added_sugar ?? null };
    this.foodServings = 1;
    this.foodServingDescription = meal.serving_description;
    this.foodSource = 'saved_meal';
    this.labelPhotoDataUrl = null;
    this.lookupServing = '';
    this.activeSheet.set('food');
  }

  saveFoodAsMeal(): void {
    if (!this.canAddFood) return;
    this.savedMealForm = {
      id: 0, name: this.foodForm.name.trim(), serving_description: this.foodServingDescription.trim() || '1 serving',
      meal_type: this.foodForm.meal_type, calories: this.foodForm.calories!,
      protein: this.foodForm.protein ?? 0, carbohydrates: this.foodForm.carbs ?? 0,
      fat: this.foodForm.fat ?? 0, sugar: this.foodForm.sugar,
      added_sugar: this.foodForm.added_sugar, components: [],
    };
    this.activeSheet.set('savedMeal');
  }

  async saveSavedMeal(): Promise<void> {
    const meal = this.savedMealForm;
    if (!meal.name.trim() || [meal.calories, meal.protein, meal.carbohydrates, meal.fat]
      .some((value) => value === null || !Number.isFinite(Number(value)) || Number(value) < 0)) {
      this.showToast('Enter a name and non-negative macros for one serving');
      return;
    }
    if (meal.sugar !== null && meal.added_sugar !== null && Number(meal.added_sugar) > Number(meal.sugar)) {
      this.showToast('Added sugar cannot exceed total sugar'); return;
    }
    this.saving.set(true);
    try {
      const id = meal.client_id ?? (typeof meal.id === 'string' ? meal.id : crypto.randomUUID());
      await this.offline.enqueue('saved_meal', { ...meal, server_id: typeof meal.id === 'number' && meal.id > 0 ? meal.id : undefined }, id);
      await this.applyLocalState();
      this.saving.set(false); this.close();
      this.recipeSelectionMode = false; this.selectedRecipeLogIds.clear();
      this.showToast('Recipe saved on device and ready to quick-log');
    } catch { this.failAction('Could not save recipe on this device'); }
  }

  async deleteSavedMeal(meal: SavedMeal): Promise<void> {
    if (!window.confirm(`Delete saved meal ${meal.name}? Your existing food logs will stay.`)) return;
    try {
      const id = meal.client_id ?? (typeof meal.id === 'string' ? meal.id : crypto.randomUUID());
      await this.offline.enqueue('saved_meal_delete', {
        server_id: typeof meal.id === 'number' ? meal.id : undefined,
        meal_client_id: meal.client_id ?? (typeof meal.id === 'string' ? meal.id : undefined),
      }, id);
      await this.applyLocalState();
      this.showToast('Saved meal removed on device');
    } catch { this.showToast('Could not remove saved meal on this device'); }
  }

  lookupBarcode(): void {
    const code = this.barcode.trim();
    if (!/^\d{8,14}$/.test(code)) { this.showToast('Enter an 8–14 digit barcode'); return; }
    const token = ++this.barcodeLookupToken;
    this.labelScanToken += 1;
    this.stopLabelWorker();
    this.labelScanning.set(false);
    this.lookupServing = '';
    this.barcodeNotFound.set(false);
    this.barcodeLoading.set(true);
    this.http.get<{ name: string; brand: string; calories: number | null; protein: number | null;
      carbohydrates: number | null; fat: number | null; sugar: number | null; added_sugar: number | null;
      serving_description: string }>(`${this.api}/food-lookup/${code}/`).subscribe({
      next: (product) => {
        if (token !== this.barcodeLookupToken) return;
        this.foodForm.name = product.brand ? `${product.name} — ${product.brand}` : product.name;
        this.foodForm.calories = product.calories === null ? null : Math.round(Number(product.calories));
        this.foodForm.protein = product.protein === null ? null : Number(product.protein);
        this.foodForm.carbs = product.carbohydrates === null ? null : Number(product.carbohydrates);
        this.foodForm.fat = product.fat === null ? null : Number(product.fat);
        this.foodForm.sugar = product.sugar == null ? null : Number(product.sugar);
        this.foodForm.added_sugar = product.added_sugar == null ? null : Number(product.added_sugar);
        this.lookupServing = product.serving_description || '100 g';
        this.foodServingDescription = this.lookupServing;
        this.foodServings = 1;
        this.foodSource = 'barcode';
        this.labelPhotoDataUrl = null;
        this.barcodeLoading.set(false);
        this.barcodeScanStatus.set(`Found ${this.foodForm.name}. Review the values before adding.`);
        this.showToast(`Found ${product.serving_description || '100 g'}; review macros before adding`);
      },
      error: (error) => {
        if (token !== this.barcodeLookupToken) return;
        this.barcodeLoading.set(false);
        this.barcodeNotFound.set(error.status === 404);
        this.barcodeScanStatus.set(error.status === 404 ? 'Barcode recognized, but no food was found. Enter values manually.' : 'Lookup unavailable. Try again or enter values manually.');
        this.showToast(error.status === 404 ? 'Barcode not found; enter food manually' : 'Lookup unavailable; enter food manually');
      },
    });
  }

  async captureLabel(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const token = ++this.labelScanToken;
    this.barcodeLookupToken += 1;
    this.barcodeLoading.set(false);
    this.stopLabelWorker();
    this.labelScanning.set(true);
    this.labelScanStatus.set('Preparing photo…');
    this.barcodeNotFound.set(false);
    try {
      const photo = await this.compressLabelPhoto(file);
      if (token !== this.labelScanToken) return;
      this.labelPhotoDataUrl = photo;
      this.foodSource = 'label';
      this.foodServings = 1;
      this.foodServingDescription = '1 serving';
      this.foodForm.calories = null;
      this.foodForm.protein = null;
      this.foodForm.carbs = null;
      this.foodForm.fat = null;
      this.foodForm.sugar = null;
      this.foodForm.added_sugar = null;
      this.labelOcrText = '';
      this.labelScanStatus.set('Reading label on your phone…');
      const ocr = await import('tesseract.js');
      const createWorker = (ocr as unknown as { default?: typeof ocr }).default?.createWorker ?? ocr.createWorker;
      const worker = await createWorker('eng', 1, {
        workerPath: '/ocr/worker.min.js', corePath: '/ocr/core', langPath: '/ocr/lang',
        logger: (message) => {
          if (token === this.labelScanToken && this.activeSheet() === 'food') {
            const percent = Number.isFinite(message.progress) ? ` ${Math.round(message.progress * 100)}%` : '';
            this.labelScanStatus.set(`Reading label on your phone…${percent}`);
          }
        },
      });
      if (token !== this.labelScanToken || this.activeSheet() !== 'food') {
        await worker.terminate().catch(() => {});
        return;
      }
      this.labelWorker = worker;
      try {
        const result = await worker.recognize(photo);
        if (token !== this.labelScanToken || this.activeSheet() !== 'food') return;
        this.labelOcrText = result.data.text;
        const values = parseNutritionLabel(result.data.text);
        this.foodServingDescription = values.servingDescription || '1 serving';
        this.foodForm.calories = values.calories;
        this.foodForm.protein = values.protein;
        this.foodForm.carbs = values.carbs;
        this.foodForm.fat = values.fat;
        this.foodForm.sugar = values.sugar;
        this.foodForm.added_sugar = values.addedSugar;
        this.labelScanStatus.set('Review the label photo and correct every field before logging.');
      } finally {
        if (this.labelWorker === worker) {
          this.labelWorker = null;
          await worker.terminate().catch(() => {});
        }
      }
    } catch {
      if (token !== this.labelScanToken) return;
      this.labelScanStatus.set(this.labelPhotoDataUrl
        ? 'Could not read the label automatically. Enter its values while viewing the photo.'
        : 'Could not open this photo. Try a clearer picture or enter the values manually.');
    } finally { if (token === this.labelScanToken) this.labelScanning.set(false); }
  }

  removeLabelPhoto(): void {
    this.labelScanToken += 1;
    this.stopLabelWorker();
    this.labelPhotoDataUrl = null;
    this.labelOcrText = '';
    this.labelScanStatus.set('');
    this.labelScanning.set(false);
    if (this.foodSource === 'label') this.foodSource = 'manual';
  }

  private async compressLabelPhoto(file: File): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('Not an image');
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      let scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      for (let attempt = 0; attempt < 6; attempt++) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', attempt < 3 ? 0.78 - attempt * 0.13 : 0.62);
        if (dataUrl.length < 460_000) return dataUrl;
        scale *= 0.78;
      }
      throw new Error('Photo too large');
    } finally { URL.revokeObjectURL(url); }
  }

  private draftToWorkout(draft: WorkoutDraft): Workout {
    return {
      id: draft.server_id ?? draft.client_id,
      client_id: draft.client_id,
      sync_revision: draft.revision,
      name: draft.name,
      started_at: draft.started_at,
      completed_at: draft.completed_at,
      notes: draft.notes,
      workout_exercises: draft.exercises.map((item) => ({
        id: item.client_id,
        exercise: { id: item.client_id, name: item.name },
        notes: item.notes,
        sets: item.sets.map((set) => ({
          id: `${item.client_id}-${set.set_number}`,
          set_number: set.set_number, weight: set.weight, weight_unit: set.weight_unit,
          reps: set.reps, set_type: set.set_type, performed_at: set.performed_at,
        })),
      })),
    };
  }

  private async applyLocalState(): Promise<void> {
    let pending: PendingChange[] = [];
    try { pending = await this.offline.getPending(); } catch { /* Online-only fallback. */ }
    const today = structuredClone(this.serverToday);
    today.nutrition = { ...today.nutrition, sugar: today.nutrition.sugar ?? 0,
      added_sugar: today.nutrition.added_sugar ?? 0, sugar_unknown_count: today.nutrition.sugar_unknown_count ?? 0,
      added_sugar_unknown_count: today.nutrition.added_sugar_unknown_count ?? 0 };
    const workouts = structuredClone(this.serverWorkouts);
    const exerciseOptions = structuredClone(this.serverExerciseOptions);
    for (const change of pending.filter((item) => item.kind === 'exercise_option')) {
      const option = change.payload as SavedExerciseOption & { replace_group?: boolean };
      const index = exerciseOptions.findIndex((item) => item.name.toLowerCase() === option.name.toLowerCase());
      if (index < 0) exerciseOptions.push(option);
      else if (!exerciseOptions[index].muscle_group || option.replace_group) exerciseOptions[index] = option;
    }
    this.exerciseOptions.set(exerciseOptions);
    const weights = structuredClone(this.serverWeightEntries);
    const savedMeals = structuredClone(this.serverSavedMeals);
    const applyWorkout = (draft: WorkoutDraft) => {
      const workout = this.draftToWorkout(draft);
      const oldIndex = workouts.findIndex((item) => item.client_id === draft.client_id || item.id === draft.server_id);
      if (oldIndex >= 0) workouts.splice(oldIndex, 1);
      workouts.unshift(workout);
      const existingToday = today.workouts.findIndex((item) => item.client_id === draft.client_id || item.id === draft.server_id);
      if (existingToday >= 0) today.workouts.splice(existingToday, 1);
      if (new Date(draft.started_at).toDateString() === new Date(today.date + 'T12:00:00').toDateString()) {
        today.workouts.unshift(workout);
      }
    };
    for (const item of pending) {
      if (item.kind === 'food_log' || item.kind === 'food_log_update') {
        const food = item.payload as { name: string; meal_type: string; calories: number; protein: number; carbohydrates: number; fat: number; logged_at: string;
          sugar?: number | null; added_sugar?: number | null; server_id?: number;
          serving_quantity?: number; serving_description?: string; nutrition_source?: NutritionSource; label_photo_data_url?: string };
        const oldIndex = today.food_logs.findIndex((log) => log.id === food.server_id || log.id === item.id || log.client_id === item.id);
        const old = oldIndex >= 0 ? today.food_logs.splice(oldIndex, 1)[0] : null;
        if (new Date(food.logged_at).toDateString() === new Date(today.date + 'T12:00:00').toDateString()) {
          const quantity = Number(food.serving_quantity ?? 1);
          const calories = Math.round(Number(food.calories) * quantity);
          const protein = Number(food.protein) * quantity;
          const carbs = Number(food.carbohydrates) * quantity;
          const fat = Number(food.fat) * quantity;
          today.food_logs.unshift({ id: food.server_id ?? old?.id ?? item.id, client_id: item.id,
            name_snapshot: food.name, meal_type: food.meal_type,
            calories_snapshot: calories, protein_snapshot: protein, carbs_snapshot: carbs, fat_snapshot: fat,
            sugar_snapshot: food.sugar == null ? null : Math.round(Number(food.sugar) * quantity * 100) / 100,
            added_sugar_snapshot: food.added_sugar == null ? null : Math.round(Number(food.added_sugar) * quantity * 100) / 100,
            per_serving: { calories: Number(food.calories), protein: Number(food.protein),
              carbohydrates: Number(food.carbohydrates), fat: Number(food.fat),
              sugar: food.sugar ?? null, added_sugar: food.added_sugar ?? null },
            serving_quantity: quantity, serving_description_snapshot: food.serving_description ?? '1 serving',
            nutrition_source: food.nutrition_source ?? 'manual', label_photo_url: food.label_photo_data_url || old?.label_photo_url || null,
            logged_at: food.logged_at });
        }
      } else if (item.kind === 'weight_entry') {
        const weight = item.payload as { weight: number; unit: 'lb' | 'kg'; recorded_at: string; notes: string };
        const oldIndex = weights.findIndex((entry) => entry.id === item.id);
        if (oldIndex >= 0) weights.splice(oldIndex, 1);
        weights.unshift({ id: item.id, ...weight });
      } else if (item.kind === 'saved_meal') {
        const meal = item.payload as SavedMeal & { server_id?: number };
        const oldIndex = savedMeals.findIndex((saved) => saved.id === meal.server_id || saved.id === item.id || saved.client_id === item.id);
        if (oldIndex >= 0) savedMeals.splice(oldIndex, 1);
        savedMeals.unshift({ ...meal, id: meal.server_id ?? item.id, client_id: item.id });
      } else if (item.kind === 'saved_meal_delete') {
        const deleted = item.payload as { server_id?: number; meal_client_id?: string };
        const index = savedMeals.findIndex((meal) => meal.id === deleted.server_id || meal.id === deleted.meal_client_id ||
          meal.client_id === deleted.meal_client_id);
        if (index >= 0) savedMeals.splice(index, 1);
      } else if (item.kind === 'workout') {
        applyWorkout(item.payload as WorkoutDraft);
      } else if (item.kind === 'workout_delete') {
        const deleted = item.payload as { server_id?: number; workout_client_id?: string };
        const matches = (workout: Workout) => workout.id === deleted.server_id || workout.client_id === deleted.workout_client_id;
        const index = workouts.findIndex(matches);
        if (index >= 0) workouts.splice(index, 1);
        const dayIndex = today.workouts.findIndex(matches);
        if (dayIndex >= 0) today.workouts.splice(dayIndex, 1);
      } else if (item.kind === 'profile') {
        this.profile.set(item.payload as ProfileSettings);
      }
    }
    for (const field of ['calories', 'protein', 'carbs', 'fat', 'sugar', 'added_sugar'] as const) {
      const snapshot = field === 'calories' ? 'calories_snapshot' : field === 'protein' ? 'protein_snapshot'
        : field === 'carbs' ? 'carbs_snapshot' : field === 'fat' ? 'fat_snapshot'
        : field === 'sugar' ? 'sugar_snapshot' : 'added_sugar_snapshot';
      today.nutrition[field] = today.food_logs.reduce((sum, log) => sum + Number(log[snapshot] ?? 0), 0);
    }
    today.nutrition.sugar_unknown_count = today.food_logs.filter((log) => log.sugar_snapshot == null).length;
    today.nutrition.added_sugar_unknown_count = today.food_logs.filter((log) => log.added_sugar_snapshot == null).length;
    weights.sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));
    this.weightEntries.set(weights);
    this.savedMeals.set(savedMeals);
    if (weights[0]) today.latest_weight = { weight: String(weights[0].weight), unit: weights[0].unit };
    if (this.currentDraft) {
      const serverMatch = workouts.find((item) => item.client_id === this.currentDraft?.client_id && typeof item.id === 'number');
      if (serverMatch) this.currentDraft.server_id = serverMatch.id as number;
      applyWorkout(this.currentDraft);
    }
    this.today.set(today);
    this.workouts.set(workouts);
    if (this.viewedWorkout()) this.viewedWorkout.set(workouts.find((item) => item.id === this.viewedWorkout()?.id ||
      (!!this.viewedWorkout()?.client_id && item.client_id === this.viewedWorkout()?.client_id)) ?? null);
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

  private loadSavedMeals(): void {
    this.http.get<SavedMeal[]>(`${this.api}/saved-meals/`).subscribe({ next: (data) => {
      this.serverSavedMeals = data;
      void this.offline.cache('savedMeals', data).catch(() => {});
      void this.applyLocalState();
    } });
  }

  private loadWeightEntries(): void {
    this.http.get<WeightEntry[]>(`${this.api}/weight-entries/`).subscribe({ next: (data) => {
      this.serverWeightEntries = data;
      void this.offline.cache('weightEntries', data).catch(() => {});
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
