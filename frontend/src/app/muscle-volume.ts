import { exerciseFamily, exerciseHistoryKey, SavedExerciseOption } from './exercise-catalog';

export type MuscleId = 'chest' | 'traps' | 'lats' | 'shoulders' | 'biceps' | 'triceps' | 'forearms' | 'abs' | 'glutes' | 'quads' | 'hamstrings' | 'calves' | 'adductors' | 'abductors';
export type VolumeStatus = 'below' | 'good' | 'above';
export const MUSCLES: Array<{ id: MuscleId; label: string; family: string }> = [
  { id: 'chest', label: 'Chest', family: 'chest' },
  { id: 'traps', label: 'Traps / upper back', family: 'chest_supported_row' },
  { id: 'lats', label: 'Lats', family: 'lower_lat' },
  { id: 'shoulders', label: 'Shoulders', family: 'shoulder' },
  { id: 'biceps', label: 'Biceps', family: 'bicep' },
  { id: 'triceps', label: 'Triceps', family: 'tricep' },
  { id: 'forearms', label: 'Forearms', family: 'forearms' },
  { id: 'abs', label: 'Abs', family: 'abs' },
  { id: 'glutes', label: 'Glutes', family: 'hip_thrust' },
  { id: 'quads', label: 'Quads', family: 'quad_compound' },
  { id: 'hamstrings', label: 'Hamstrings', family: 'hamstring_extension' },
  { id: 'calves', label: 'Calves', family: 'calf_raise' },
  { id: 'adductors', label: 'Adductors', family: 'adductors' },
  { id: 'abductors', label: 'Abductors', family: 'abductors' },
];

export interface VolumeSet {
  id: number | string;
  set_number: number;
  reps: number | null;
  weight: string | number | null;
  weight_unit: string;
  set_type?: string;
  performed_at?: string | null;
}
export interface VolumeWorkout {
  id: number | string;
  client_id?: string | null;
  sync_revision?: number;
  name: string;
  started_at: string;
  completed_at: string | null;
  workout_exercises: Array<{ id: number | string; exercise: { name: string; muscle_group?: string }; notes: string; sets: VolumeSet[] }>;
}
export interface VolumeExercise {
  key: string;
  name: string;
  count: number;
  sessions: Array<{ key: string; workout: string; date: string; inProgress: boolean; notes: string; sets: VolumeSet[] }>;
}
export interface MuscleVolume {
  id: MuscleId | 'unassigned';
  label: string;
  count: number;
  status: VolumeStatus;
  exercises: VolumeExercise[];
}

const FAMILY_MUSCLE: Record<string, MuscleId> = {
  incline_press: 'chest', chest_fly: 'chest', chest: 'chest', chest_supported_row: 'traps',
  lower_lat: 'lats', upper_lat: 'lats', lats: 'lats', shoulder: 'shoulders', bicep: 'biceps', tricep: 'triceps',
  forearms: 'forearms', abs: 'abs', hip_thrust: 'glutes', calf_raise: 'calves', leg_extension: 'quads',
  quad_compound: 'quads', quads: 'quads', leg_curl: 'hamstrings', hamstring_extension: 'hamstrings',
  hamstrings: 'hamstrings', adductors: 'adductors', abductors: 'abductors',
};
const normalized = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export function muscleForExercise(name: string, saved: SavedExerciseOption[] = [], storedGroup?: string): MuscleId | null {
  const assigned = saved.find((option) => normalized(option.name) === normalized(name))?.muscle_group || storedGroup;
  if (assigned) {
    const group = normalized(assigned).replace(/ /g, '_');
    const direct = MUSCLES.find((muscle) => muscle.id === group);
    if (direct) return direct.id;
    if (FAMILY_MUSCLE[group]) return FAMILY_MUSCLE[group];
  }
  const value = normalized(name);
  // Preserve the sheet's primary-muscle convention: rows target traps, and
  // hamstring extensions target hamstrings. Each set is counted once.
  if (/forearm|wrist|kitty kitty/.test(value)) return 'forearms';
  if (/rdl|romanian deadlift|hamstring|lying leg|standing leg curl/.test(value)) return 'hamstrings';
  if (/calf|calves/.test(value)) return 'calves';
  if (/bulgarian|squat/.test(value)) return 'quads';
  if (/pushdown|push down|skullcrusher|skull crusher|long rope|jm.*press/.test(value)) return 'triceps';
  if (/chest.*row|chest supported/.test(value)) return 'traps';
  if (/lat.*row|row.*lat|close grip.*row|closegrip.*row/.test(value)) return 'lats';
  if (/incline/.test(value) && !/curl|bicep/.test(value)) return 'chest';
  if (/chest|pec|cable fly/.test(value)) return 'chest';
  if (/bicep/.test(value)) return 'biceps';
  if (/reverse plank/.test(value)) return 'abs';
  return FAMILY_MUSCLE[exerciseFamily(name)] ?? null;
}

export function calendarDay(value: string | number | Date): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = dayFormatter.formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function mondayFor(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return shiftDay(day, -((weekday + 6) % 7));
}

export function volumeStatus(count: number): VolumeStatus {
  return count < 4 ? 'below' : count <= 12 ? 'good' : 'above';
}

export function weeklyVolume(workouts: VolumeWorkout[], active: VolumeWorkout | null, start: string, saved: SavedExerciseOption[] = []): MuscleVolume[] {
  const end = shiftDay(start, 7);
  const unique: VolumeWorkout[] = [];
  for (const day of [...workouts, ...(active ? [active] : [])]) {
    const index = unique.findIndex((item) => item.id === day.id || (!!day.client_id && item.client_id === day.client_id));
    if (index < 0) unique.push(day);
    else if (day === active || (day.sync_revision ?? 0) >= (unique[index].sync_revision ?? 0)) unique[index] = day;
  }
  const groups: MuscleVolume[] = [...MUSCLES.map((muscle): MuscleVolume => ({ id: muscle.id, label: muscle.label, count: 0, status: 'below', exercises: [] })),
    { id: 'unassigned', label: 'Unassigned', count: 0, status: 'below', exercises: [] }];
  for (const day of unique.sort((a, b) => b.started_at.localeCompare(a.started_at))) {
    for (const exercise of day.workout_exercises) {
      const sets = exercise.sets.filter((set) => {
        const date = calendarDay(set.performed_at ?? day.started_at) ?? calendarDay(day.started_at);
        return date !== null && date >= start && date < end;
      });
      if (!sets.length) continue;
      const muscle = muscleForExercise(exercise.exercise.name, saved, exercise.exercise.muscle_group);
      const group = groups.find((item) => item.id === (muscle ?? 'unassigned'))!;
      const key = exerciseHistoryKey(exercise.exercise.name);
      let movement = group.exercises.find((item) => item.key === key);
      if (!movement) {
        movement = { key, name: exercise.exercise.name, count: 0, sessions: [] };
        group.exercises.push(movement);
      }
      group.count += sets.length;
      movement.count += sets.length;
      movement.sessions.push({ key: `${day.id}:${exercise.id}`, workout: day.name,
        date: sets[0].performed_at ?? day.started_at, inProgress: !day.completed_at, notes: exercise.notes, sets });
    }
  }
  for (const group of groups) group.status = volumeStatus(group.count);
  return groups;
}
