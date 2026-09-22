from django.test import TestCase
from rest_framework.test import APIClient

from .importer import parse_exercise_line, parse_notes
from .models import AppSettings, BodyWeightEntry, ExerciseSet, FoodLog, Workout


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
        committed = client.post("/api/imports/notes/", {**payload, "commit": True,
            "client_id": "3779f177-203f-4202-ac4d-f7120e89e4a1"}, format="json")
        self.assertEqual(committed.status_code, 201)
        self.assertEqual(Workout.objects.count(), 1)
        self.assertEqual(ExerciseSet.objects.count(), 2)
        retry = client.post("/api/imports/notes/", {**payload, "commit": True,
            "client_id": "3779f177-203f-4202-ac4d-f7120e89e4a1"}, format="json")
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(Workout.objects.count(), 1)


class OfflineSyncTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_profile_is_persistent(self):
        response = self.client.patch("/api/profile/", {
            "display_name": "Kevin", "calorie_goal": 3000,
            "protein_goal": 200, "preferred_weight_unit": "kg",
        }, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get("/api/profile/").data["display_name"], "Kevin")
        self.assertEqual(AppSettings.objects.get(pk=1).preferred_weight_unit, "kg")
        queued = {"kind": "profile", "client_id": "18707d69-6b90-48a7-a41a-4f50e6df188a",
                  "payload": {"display_name": "Offline Kevin", "calorie_goal": 2900,
                              "protein_goal": 190, "preferred_weight_unit": "lb"}}
        self.assertEqual(self.client.post("/api/sync/", queued, format="json").status_code, 200)
        self.assertEqual(AppSettings.objects.get(pk=1).display_name, "Offline Kevin")
        self.assertEqual(self.client.patch("/api/profile/", {"protein_goal": 0}, format="json").status_code, 400)

    def test_food_and_weight_retries_do_not_duplicate(self):
        food = {
            "kind": "food_log", "client_id": "a9c3e8a5-59bd-4e9e-9bad-11a5fc92756e",
            "payload": {"name": "Yogurt", "meal_type": "breakfast", "calories": 140,
                        "protein": 12, "carbohydrates": 16, "fat": 2,
                        "logged_at": "2026-09-22T10:00:00-04:00"},
        }
        self.assertEqual(self.client.post("/api/sync/", food, format="json").status_code, 201)
        self.assertEqual(self.client.post("/api/sync/", food, format="json").data["duplicate"], True)
        self.assertEqual(FoodLog.objects.count(), 1)

        weight = {"kind": "weight_entry", "client_id": "fa91001b-d4fa-4866-a57f-48eab570bb25",
                  "payload": {"weight": "175.4", "unit": "lb", "notes": "Morning",
                              "recorded_at": "2026-09-22T10:00:00-04:00"}}
        self.assertEqual(self.client.post("/api/sync/", weight, format="json").status_code, 201)
        self.assertEqual(self.client.post("/api/sync/", weight, format="json").data["duplicate"], True)
        self.assertEqual(BodyWeightEntry.objects.count(), 1)

    def test_workout_snapshot_is_upserted_by_client_id_and_revision(self):
        payload = {
            "kind": "workout", "client_id": "503a1d2a-26d4-4a23-918d-f6604e342fc6",
            "payload": {
                "revision": 1, "name": "Upper B", "started_at": "2026-09-22T10:00:00-04:00",
                "completed_at": None, "exercises": [{"name": "Chest fly", "notes": "Seat 4",
                    "sets": [{"set_number": 1, "weight": "25", "weight_unit": "lb", "reps": 7,
                              "performed_at": "2026-09-22T10:10:00-04:00"}]}],
            },
        }
        self.assertEqual(self.client.post("/api/sync/", payload, format="json").status_code, 200)
        payload["payload"]["revision"] = 2
        payload["payload"]["completed_at"] = "2026-09-22T11:00:00-04:00"
        payload["payload"]["exercises"][0]["sets"].append({
            "set_number": 2, "weight": "25", "weight_unit": "lb", "reps": 6,
            "performed_at": "2026-09-22T10:15:00-04:00",
        })
        self.assertEqual(self.client.post("/api/sync/", payload, format="json").status_code, 200)
        self.assertEqual(self.client.post("/api/sync/", payload, format="json").data["duplicate"], True)
        self.assertEqual(Workout.objects.count(), 1)
        self.assertEqual(ExerciseSet.objects.count(), 2)
        self.assertEqual(Workout.objects.get().sync_revision, 2)

# Create your tests here.
