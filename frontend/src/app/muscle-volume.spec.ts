import { calendarDay, mondayFor, MuscleId, muscleForExercise, VolumeWorkout, volumeStatus, weeklyVolume } from './muscle-volume';

function day(id: number | string, date: string, name: string, count: number): VolumeWorkout {
  return { id, name: 'Full Body A', started_at: date, completed_at: date,
    workout_exercises: [{ id: `${id}:exercise`, exercise: { name }, notes: 'Seat 4',
      sets: Array.from({ length: count }, (_, index) => ({ id: `${id}:${index}`, set_number: index + 1, weight: 60, weight_unit: 'lb', reps: 8 })) }] };
}

describe('weekly muscle volume', () => {
  it('uses Monday–Sunday calendar weeks in New York across midnight and daylight saving', () => {
    expect(calendarDay('2026-10-05T03:59:00Z')).toBe('2026-10-04');
    expect(calendarDay('2026-10-05T04:00:00Z')).toBe('2026-10-05');
    expect(mondayFor('2026-10-04')).toBe('2026-09-28');
    expect(mondayFor('2026-10-05')).toBe('2026-10-05');
    expect(mondayFor('2026-11-01')).toBe('2026-10-26');
    const days = [day(1, '2026-11-02T04:30:00Z', 'Chest supported row', 2), day(2, '2026-11-02T05:00:00Z', 'Chest supported row', 3)];
    expect(weeklyVolume(days, null, '2026-10-26').find((group) => group.id === 'traps')!.count).toBe(2);
  });

  it('treats 4 and 12 as in range and excludes neither endpoint', () => {
    expect([0, 3, 4, 12, 13].map(volumeStatus)).toEqual(['below', 'below', 'good', 'good', 'above']);
  });

  it('uses one primary muscle per exercise, including historical names and saved machines', () => {
    const examples: Record<string, MuscleId> = { 'Hammer strength bench press': 'chest', 'Arsenal chest supported row upper': 'traps',
      'Cable lat row stack': 'lats', 'Standing leg curl upstairs': 'hamstrings', 'Smith rdl': 'hamstrings',
      'Calf raises (outer then inner)': 'calves', 'JM press smith': 'triceps', 'Flat bench ez bar skullcrusher': 'triceps',
      'Forearm cable twist': 'forearms', 'Smith incline': 'chest', 'Db Bulgarian': 'quads', 'Hip thrust': 'glutes' };
    for (const [name, group] of Object.entries(examples)) expect(muscleForExercise(name)).withContext(name).toBe(group);
    expect(muscleForExercise('Converging machine')).toBeNull();
    expect(muscleForExercise('New machine', [{ name: 'New machine', muscle_group: 'leg_curl' }])).toBe('hamstrings');
  });

  it('counts imported sets with no timestamps and retains weights, reps, plates, and notes', () => {
    const workout = day(1, '2026-10-05T12:00:00-04:00', 'Hammer strength bench press', 2);
    workout.workout_exercises[0].sets[0].weight = 1;
    workout.workout_exercises[0].sets[1].weight = '1.10';
    workout.workout_exercises[0].sets.forEach((set) => set.weight_unit = 'plate');
    const group = weeklyVolume([workout], null, '2026-10-05').find((item) => item.id === 'chest')!;
    expect(group.count).toBe(2);
    expect(group.exercises.length).toBe(1);
    expect(group.exercises[0].sessions[0].sets.map((set) => set.weight)).toEqual([1, '1.10']);
    expect(group.exercises[0].sessions[0].notes).toBe('Seat 4');
  });

  it('replaces the server snapshot with an active offline draft without double counting', () => {
    const server = { ...day(42, '2026-10-05T12:00:00-04:00', 'Chest supported row', 2), client_id: 'same-workout' };
    const active = { ...day('same-workout', '2026-10-05T12:00:00-04:00', 'Chest supported row', 3), client_id: 'same-workout', completed_at: null };
    const group = weeklyVolume([server, server], active, '2026-10-05').find((item) => item.id === 'traps')!;
    expect(group.count).toBe(3);
    expect(group.exercises[0].sessions.length).toBe(1);
    expect(group.exercises[0].sessions[0].inProgress).toBeTrue();
    active.workout_exercises[0].sets.pop();
    expect(weeklyVolume([server], active, '2026-10-05').find((item) => item.id === 'traps')!.count).toBe(2);
  });

  it('places sets into their actual week when a workout crosses the week boundary', () => {
    const workout = day(1, '2026-10-04T23:55:00-04:00', 'DB incline press', 2);
    workout.workout_exercises[0].sets[0].performed_at = '2026-10-04T23:58:00-04:00';
    workout.workout_exercises[0].sets[1].performed_at = '2026-10-05T00:01:00-04:00';
    expect(weeklyVolume([workout], null, '2026-09-28').find((item) => item.id === 'chest')!.count).toBe(1);
    expect(weeklyVolume([workout], null, '2026-10-05').find((item) => item.id === 'chest')!.count).toBe(1);
  });

  it('keeps unknown sets visible and moves them into the assigned group without changing the total', () => {
    const days = [day(1, '2026-10-05T12:00:00-04:00', 'Mystery machine', 2)];
    expect(weeklyVolume(days, null, '2026-10-05').find((item) => item.id === 'unassigned')!.count).toBe(2);
    const groups = weeklyVolume(days, null, '2026-10-05', [{ name: 'Mystery machine', muscle_group: 'chest' }]);
    expect(groups.find((item) => item.id === 'unassigned')!.count).toBe(0);
    expect(groups.find((item) => item.id === 'chest')!.count).toBe(2);
    expect(groups.reduce((total, group) => total + group.count, 0)).toBe(2);
  });
});
