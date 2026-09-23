# Apple Notes Workout Import

The importer is designed around the existing convention:

```text
exercise name 2x8,7 185,175lb optional notes
```

Each workout begins with a date and optional workout name:

```text
9/21/26 upper B
Arsenal incline press 2x5,5 1 plate (4,1)
Cable close grip row 2x5,5 88lbs
```

## Mapping rules

- `2x5,5` means two sets with 5 and 5 reps.
- `2x7` means two sets, both with 7 reps.
- `2x7, 25lb` also means two sets of 7 reps at 25 lb; the comma separates reps from the weight because `lb` follows it.
- `50,40lb` maps 50 lb to set one and 40 lb to set two.
- `60lb` repeats the 60 lb value across every set.
- `1 plate` stores a numeric weight of `1` with unit `plate`; it does not guess the machine's pound equivalent.
- Fractional values of five or less without a suffix, such as `2.25`, are treated as plate shorthand. Add `lb` or `kg` when that is not intended.
- Parentheses such as `(4,1)` are preserved as exercise notes because they commonly represent machine settings.
- Free text after the recognized weight is also preserved as notes.
- Unrecognized lines are skipped and shown in the preview as warnings.

The preview performs no writes. Expand a workout to inspect every parsed set and note before confirming. Confirming the preview creates the workouts, exercises, and sets in one database transaction. Re-importing an already imported note as a new batch creates duplicates; editing an existing day is safer for corrections.
