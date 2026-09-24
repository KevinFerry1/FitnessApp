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
});
