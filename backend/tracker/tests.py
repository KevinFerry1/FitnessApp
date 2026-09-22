from django.test import TestCase
from rest_framework.test import APIClient

from .importer import parse_exercise_line, parse_notes
from .models import ExerciseSet, Workout


class NotesParserTests(TestCase):
    def test_parses_comma_separated_reps_and_weights(self):
        parsed = parse_exercise_line("Arsenal chest supported row 2x5,5 50,40lb (4,4)")
        self.assertEqual(parsed.name, "Arsenal chest supported row")
        self.assertEqual([item.reps for item in parsed.sets], [5, 5])
        self.assertEqual([str(item.weight) for item in parsed.sets], ["50", "40"])
        self.assertEqual(parsed.notes, "4,4")

    def test_repeats_single_weight_for_each_set(self):
        parsed = parse_exercise_line("Preacher curl 2x7,5 60lb")
        self.assertEqual([str(item.weight) for item in parsed.sets], ["60", "60"])

    def test_recognizes_implicit_fractional_plate_shorthand(self):
        parsed = parse_exercise_line("Hip thrust 2x7,7 2.25")
        self.assertEqual(parsed.sets[0].weight_unit, "plate")

    def test_parses_workout_headers_and_warnings(self):
        workouts, warnings = parse_notes("9/21/26 upper B\nChest fly 2x7,6 25lb\njust a note")
        self.assertEqual(workouts[0].name, "upper B")
        self.assertEqual(workouts[0].workout_date.isoformat(), "2026-09-21")
        self.assertEqual(len(warnings), 1)


class NotesImportApiTests(TestCase):
    def test_preview_does_not_write_and_commit_creates_nested_data(self):
        client = APIClient()
        payload = {"text": "9/21/26 upper B\nChest fly 2x7,6 25lb"}
        preview = client.post("/api/imports/notes/", payload, format="json")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(Workout.objects.count(), 0)
        committed = client.post("/api/imports/notes/", {**payload, "commit": True}, format="json")
        self.assertEqual(committed.status_code, 201)
        self.assertEqual(Workout.objects.count(), 1)
        self.assertEqual(ExerciseSet.objects.count(), 2)

# Create your tests here.
