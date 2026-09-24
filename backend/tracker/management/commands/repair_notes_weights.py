"""Conservatively repair a legacy comma-before-weight Notes import bug.

Run without flags to inspect candidates. Back up the database before --apply.
Three-set or otherwise ambiguous records are intentionally left untouched.
"""

import re
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from tracker.models import WorkoutExercise


UNIT_NOTE = re.compile(r"^(?P<unit>lbs?|kg|plates?)(?:\s*;\s*(?P<rest>.*))?$", re.IGNORECASE)


def repair_candidate(item):
    workout = item.workout
    if workout.import_source != "apple_notes" or workout.sync_revision != 0:
        return None
    match = UNIT_NOTE.fullmatch(item.notes.strip())
    if not match:
        return None
    sets = list(item.sets.all())
    if len(sets) != 2 or any(entry.weight is not None or entry.reps is None for entry in sets):
        return None
    first_reps, apparent_weight = (entry.reps for entry in sets)
    if not 1 <= first_reps <= 20 or not 20 <= apparent_weight <= 400:
        return None
    raw_unit = match.group("unit").lower()
    unit = "plate" if raw_unit.startswith("plate") else "kg" if raw_unit == "kg" else "lb"
    return sets, first_reps, Decimal(apparent_weight), unit, (match.group("rest") or "").strip()


class Command(BaseCommand):
    help = "Preview or apply high-confidence repairs for imported 2x7, 25lb-style Notes lines."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write the listed repairs; first make a database backup")

    def handle(self, *args, **options):
        repaired = 0
        days = set()
        with transaction.atomic():
            exercises = WorkoutExercise.objects.select_related("workout", "exercise").prefetch_related("sets").order_by("id")
            for item in exercises:
                candidate = repair_candidate(item)
                if candidate is None:
                    continue
                sets, reps, weight, unit, notes = candidate
                self.stdout.write(f"Workout {item.workout_id} · {item.exercise.name}: "
                                  f"{sets[0].reps},{sets[1].reps} with no weight → {reps},{reps} at {weight} {unit}")
                repaired += 1
                days.add(item.workout_id)
                if options["apply"]:
                    for entry in sets:
                        entry.reps = reps
                        entry.weight = weight
                        entry.weight_unit = unit
                        entry.save()
                    item.notes = notes
                    item.save()
        action = "Repaired" if options["apply"] else "Would repair"
        self.stdout.write(f"{action} {repaired} exercises across {len(days)} workout days.")
