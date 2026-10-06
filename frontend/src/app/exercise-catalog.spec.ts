import { exerciseFamily, exerciseHistoryKey, slotsForWorkout, variationsForSlot } from './exercise-catalog';

describe('exercise catalog', () => {
  it('shows the provided upper and lower options without requiring every row', () => {
    expect(slotsForWorkout('Upper B').map((slot) => slot.id)).toContain('shoulder');
    expect(slotsForWorkout('Lower A').map((slot) => slot.id)).toContain('calf_raise');
    expect(slotsForWorkout('Custom day')).toEqual([]);
  });

  it('matches older exercise wording to its selectable family', () => {
    expect(exerciseFamily('Arsenal chest supported row')).toBe('chest_supported_row');
    expect(exerciseFamily('Single arm lateral raise')).toBe('shoulder');
    expect(exerciseFamily('Tricep cable handle')).toBe('tricep');
    expect(exerciseFamily('Cable close grip row')).toBe('upper_lat');
    const slot = slotsForWorkout('Upper B').find((item) => item.id === 'shoulder')!;
    expect(variationsForSlot(slot, ['Single arm lateral raise'])).toContain('Single arm lateral raise');
  });

  it('matches true historical aliases without combining distinct variations', () => {
    expect(exerciseHistoryKey('Arsenal incline press')).toBe(exerciseHistoryKey('Arsenal incline chest press'));
    expect(exerciseHistoryKey('Tricep cable handle')).toBe(exerciseHistoryKey('Handle cable tricep pushdown'));
    expect(exerciseHistoryKey('Pec deck')).not.toBe(exerciseHistoryKey('Arsenal chest fly'));
    expect(exerciseHistoryKey('Lying leg curl')).not.toBe(exerciseHistoryKey('Seated leg curl'));
  });

  it('groups full-body variations and saved machines into the provided optional rows', () => {
    const slots = slotsForWorkout('Full Body A');
    expect(slotsForWorkout('Full Body B')).toEqual(slots);
    expect(slots.length).toBe(10);
    expect(slotsForWorkout('Custom full body day')).toEqual([]);
    expect(slotsForWorkout('Full Body')).toEqual([]);
    expect(slotsForWorkout('Upper A').map((slot) => slot.id)).not.toContain('quads');
    expect(slotsForWorkout('Lower B').map((slot) => slot.id)).not.toContain('chest');
    const chest = slots.find((slot) => slot.id === 'chest')!;
    expect(chest.options.length).toBe(6);
    expect(variationsForSlot(chest, ['Arsenal incline press', 'Hammer strength bench press'])).toContain('Arsenal incline press');
    expect(variationsForSlot(slots.find((slot) => slot.id === 'lats')!, ['Cable close grip row'])).toContain('Cable close grip row');
    expect(variationsForSlot(slots.find((slot) => slot.id === 'hamstrings')!, ['Seated leg curl'])).toContain('Seated leg curl');
    expect(variationsForSlot(chest, [], [{ name: 'New machine', muscle_group: 'chest' }])).toContain('New machine');
    expect(variationsForSlot(chest, [], [{ name: 'New machine', muscle_group: 'quads' }])).not.toContain('New machine');
  });
});
