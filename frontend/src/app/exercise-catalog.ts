export interface ExerciseSlot {
  id: string;
  label: string;
  options: string[];
  families?: string[];
}

export interface SavedExerciseOption {
  name: string;
  muscle_group: string;
}

export const UPPER_SLOTS: ExerciseSlot[] = [
  { id: 'incline_press', label: 'Incline chest press', options: ['Arsenal incline chest press', 'DB incline press', 'Smith incline press'] },
  { id: 'chest_fly', label: 'Chest fly', options: ['Pec deck', 'Arsenal chest fly'] },
  { id: 'chest_supported_row', label: 'Traps / chest-supported row', options: ['Chest supported row', 'Arsenal chest supported row'] },
  { id: 'lower_lat', label: 'Lower lat', options: ['Lat pulldown', 'JPG', 'Pull-ups'] },
  { id: 'upper_lat', label: 'Upper lat', options: ['Cable close grip row'] },
  { id: 'tricep', label: 'Tricep', options: ['Handle cable tricep pushdown', 'Strap cable tricep pushdown', 'JM press', 'EZ bar press down'] },
  { id: 'bicep', label: 'Bicep', options: ['Preacher curl', 'DB incline curl', 'Standing DB curl'] },
  { id: 'abs', label: 'Abs', options: ['Standing cable crunch', 'Decline sit ups'] },
  { id: 'forearms', label: 'Forearms', options: ['Kitty kitty down from up', 'Kitty kitty up from under'] },
  { id: 'shoulder', label: 'Shoulder', options: ['Cable handle lateral raise', 'Arsenal lateral raise', 'Strap cable lateral raise'] },
];

export const LOWER_SLOTS: ExerciseSlot[] = [
  { id: 'abductors', label: 'Abductors', options: ['Abductors'] },
  { id: 'adductors', label: 'Adductors', options: ['Adductors'] },
  { id: 'hip_thrust', label: 'Hip thrust', options: ['Hip thrust'] },
  { id: 'calf_raise', label: 'Standing calf raise', options: ['Standing calf raise', 'Seated calf raise'] },
  { id: 'leg_extension', label: 'Leg extension', options: ['Leg extension'] },
  { id: 'leg_curl', label: 'Leg curl', options: ['Lying leg curl', 'Seated leg curl'] },
  { id: 'hamstring_extension', label: '45° hamstring extension', options: ['45 degree hamstring extension'] },
  { id: 'quad_compound', label: 'Quad compound', options: ['Leg press', 'Hack squat', 'Belt squat'] },
  { id: 'abs', label: 'Abs', options: ['Standing cable crunch', 'Decline sit ups'] },
];

export const FULL_BODY_SLOTS: ExerciseSlot[] = [
  { id: 'chest', label: 'Chest', families: ['incline_press', 'chest_fly'], options: ['Hammer strength bench press', 'Arsenal incline chest press', 'DB incline press', 'Smith incline press', 'Pec deck', 'Arsenal chest fly'] },
  { id: 'chest_supported_row', label: 'Traps / chest-supported row', options: ['Chest supported row'] },
  { id: 'lats', label: 'Lats', families: ['lower_lat', 'upper_lat'], options: ['Lat pulldown', 'JPG', 'Pull-ups', 'Cable close grip row'] },
  { id: 'quads', label: 'Quads', families: ['quad_compound', 'leg_extension'], options: ['Hack squat', 'Leg extension', 'Pendulum squat', 'Leg press'] },
  { id: 'hamstrings', label: 'Hamstrings', families: ['hamstring_extension', 'leg_curl'], options: ['45 degree hamstring extension', 'Leg curl'] },
  { id: 'abs', label: 'Abs', options: ['Standing cable crunch', 'Decline sit ups', 'Ab crunch machine'] },
  { id: 'calf_raise', label: 'Calves', options: ['Standing calf raise'] },
  { id: 'bicep', label: 'Bicep', options: ['Preacher curl', 'DB incline curl', 'Standing DB curl'] },
  { id: 'tricep', label: 'Triceps', options: ['Long rope tricep pushdown', 'Handle cable tricep pushdown', 'Strap cable tricep pushdown', 'JM press', 'EZ bar press down'] },
  { id: 'shoulder', label: 'Shoulder', options: ['DB shoulder press'] },
];

function normalized(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Only merge different names for the same movement. A muscle-group match is too
// broad for the Previous panel (for example, pec deck is not an Arsenal fly).
const HISTORY_ALIASES: Record<string, string> = {
  'arsenal incline press': 'arsenal incline chest press',
  'incline db press': 'db incline press',
  'tricep cable handle': 'handle cable tricep pushdown',
  'cable handle tricep': 'handle cable tricep pushdown',
  'tricep cable strap': 'strap cable tricep pushdown',
  'cable strap tricep': 'strap cable tricep pushdown',
  'incline db curl': 'db incline curl',
  'cable lateral raise': 'cable handle lateral raise',
  'standing cable abs': 'standing cable crunch',
};

export function exerciseHistoryKey(name: string): string {
  const value = normalized(name);
  return HISTORY_ALIASES[value] ?? value;
}

export function exerciseFamily(name: string): string {
  const value = normalized(name);
  if (/incline/.test(value) && /(press|bench)/.test(value)) return 'incline_press';
  if (/bench press|chest press/.test(value)) return 'chest';
  if (/(chest|pec)/.test(value) && /(fly|deck)/.test(value)) return 'chest_fly';
  if (/chest supported row/.test(value)) return 'chest_supported_row';
  if (/(close grip|closegrip)/.test(value) && /row/.test(value)) return 'upper_lat';
  if (/(pull ?down|pull ?up|jpg)/.test(value)) return 'lower_lat';
  if (/tricep|press ?down|jm press/.test(value)) return 'tricep';
  if (/curl/.test(value) && !/leg/.test(value)) return 'bicep';
  if (/lateral raise|shoulder press|rear delt/.test(value)) return 'shoulder';
  if (/kitty kitty|forearm/.test(value)) return 'forearms';
  if (/abductor|abductors/.test(value)) return 'abductors';
  if (/adductor|adductors/.test(value)) return 'adductors';
  if (/hip thrust|glute bridge/.test(value)) return 'hip_thrust';
  if (/calf raise/.test(value)) return 'calf_raise';
  if (/leg extension/.test(value)) return 'leg_extension';
  if (/leg curl/.test(value)) return 'leg_curl';
  if (/hamstring extension|back extension/.test(value)) return 'hamstring_extension';
  if (/leg press|hack squat|belt squat|pendulum squat/.test(value)) return 'quad_compound';
  if (/abs|crunch|sit ?up/.test(value)) return 'abs';
  return value;
}

export function slotsForWorkout(name: string): ExerciseSlot[] {
  if (/^full[\s-]*body\s+[ab]$/i.test(name.trim())) return FULL_BODY_SLOTS;
  if (/upper/i.test(name)) return UPPER_SLOTS;
  if (/lower|legs/i.test(name)) return LOWER_SLOTS;
  return [];
}

export function familyForExercise(name: string, savedOptions: SavedExerciseOption[] = []): string {
  return savedOptions.find((option) => normalized(option.name) === normalized(name))?.muscle_group || exerciseFamily(name);
}

export function matchesSlot(slot: ExerciseSlot, name: string, savedOptions: SavedExerciseOption[] = []): boolean {
  const family = familyForExercise(name, savedOptions);
  return slot.options.some((option) => normalized(option) === normalized(name)) || slot.id === family || !!slot.families?.includes(family);
}

export function variationsForSlot(slot: ExerciseSlot, previousNames: string[], savedOptions: SavedExerciseOption[] = []): string[] {
  const names = [...slot.options, ...previousNames.filter((name) => matchesSlot(slot, name, savedOptions)),
    ...savedOptions.filter((option) => matchesSlot(slot, option.name, savedOptions)).map((option) => option.name)];
  return names.filter((name, index) => names.findIndex((candidate) => normalized(candidate) === normalized(name)) === index);
}
