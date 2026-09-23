from django.test import TestCase
from rest_framework.test import APIClient
from unittest.mock import patch
from io import BytesIO
import base64

from .importer import parse_exercise_line, parse_notes
from .models import AppSettings, BodyWeightEntry, ExerciseSet, FoodLog, SavedMeal, Workout


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

    def test_imported_workout_can_be_edited_and_deleted_idempotently(self):
        imported = self.client.post("/api/imports/notes/", {
            "text": "9/21/26 upper B\nChest fly 2x7,6 25lb (seat 4)", "commit": True,
        }, format="json")
        workout_id = imported.data["created_workout_ids"][0]
        client_id = "9d44172b-19e9-41d2-a1c4-8b4d153f7ea4"
        edited = {"kind": "workout", "client_id": client_id, "payload": {
            "server_id": workout_id, "revision": 1, "name": "Upper B edited",
            "started_at": "2026-09-20T12:00:00-04:00", "completed_at": "2026-09-20T12:00:00-04:00",
            "notes": "Felt good", "exercises": [{"name": "Chest fly", "notes": "Seat 5",
                "sets": [{"set_number": 1, "weight": 30, "weight_unit": "lb", "reps": 8,
                          "set_type": "drop", "performed_at": "2026-09-20T12:00:00-04:00"}]}],
        }}
        self.assertEqual(self.client.post("/api/sync/", edited, format="json").status_code, 200)
        self.assertEqual(Workout.objects.get(pk=workout_id).name, "Upper B edited")
        self.assertEqual(ExerciseSet.objects.count(), 1)
        self.assertEqual(ExerciseSet.objects.get().set_type, "drop")
        deleted = {"kind": "workout_delete", "client_id": client_id,
                   "payload": {"server_id": workout_id, "workout_client_id": client_id}}
        self.assertEqual(self.client.post("/api/sync/", deleted, format="json").data["deleted"], True)
        self.assertEqual(self.client.post("/api/sync/", deleted, format="json").data["deleted"], False)
        self.assertEqual(Workout.objects.count(), 0)


class FoodFeaturesTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_saved_meal_crud_and_food_snapshot(self):
        meal = {"name": "Oat bowl", "serving_description": "1 bowl", "meal_type": "breakfast",
                "calories": 450, "protein": 30, "carbohydrates": 55, "fat": 12}
        created = self.client.post("/api/saved-meals/", meal, format="json")
        self.assertEqual(created.status_code, 201)
        self.assertEqual(SavedMeal.objects.count(), 1)
        logged = {"kind": "food_log", "client_id": "a9c3e8a5-59bd-4e9e-9bad-11a5fc92756e",
                  "payload": {"name": meal["name"], "meal_type": meal["meal_type"],
                              "calories": meal["calories"], "protein": meal["protein"],
                              "carbohydrates": meal["carbohydrates"], "fat": meal["fat"],
                              "logged_at": "2026-09-22T10:00:00-04:00"}}
        self.assertEqual(self.client.post("/api/sync/", logged, format="json").status_code, 201)
        self.client.patch(f"/api/saved-meals/{created.data['id']}/", {"calories": 500}, format="json")
        self.assertEqual(FoodLog.objects.get().calories_snapshot, 450)
        self.assertEqual(self.client.delete(f"/api/saved-meals/{created.data['id']}/").status_code, 204)
        self.assertEqual(FoodLog.objects.count(), 1)

    def test_label_photo_and_fractional_servings_are_snapshotted(self):
        jpeg = b"\xff\xd8\xff\xe0test-label\xff\xd9"
        payload = {"kind": "food_log", "client_id": "cc38dfbc-7454-490b-ae93-d4257b91a503",
                   "payload": {"name": "Yogurt", "meal_type": "breakfast", "calories": 140,
                               "protein": "12.5", "carbohydrates": "16", "fat": "2.2",
                               "serving_quantity": "1.5", "serving_description": "1 cup (150 g)",
                               "nutrition_source": "label",
                               "label_photo_data_url": "data:image/jpeg;base64," + base64.b64encode(jpeg).decode(),
                               "logged_at": "2026-09-22T10:00:00-04:00"}}
        response = self.client.post("/api/sync/", payload, format="json")
        self.assertEqual(response.status_code, 201)
        log = FoodLog.objects.get()
        self.assertEqual(log.calories_snapshot, 210)
        self.assertEqual(str(log.protein_snapshot), "18.75")
        self.assertEqual(log.serving_quantity, 1.5)
        self.assertEqual(log.serving_description_snapshot, "1 cup (150 g)")
        self.assertEqual(log.nutrition_source, "label")
        listed = self.client.get("/api/food-logs/").data[0]
        self.assertNotIn("label_photo", listed)
        self.assertEqual(listed["label_photo_url"], f"/api/food-logs/{log.id}/label-photo/")
        photo = self.client.get(listed["label_photo_url"])
        self.assertEqual(photo.status_code, 200)
        self.assertEqual(photo.content, jpeg)
        self.assertEqual(self.client.post("/api/sync/", payload, format="json").data["duplicate"], True)

    def test_label_photo_rejects_non_jpeg(self):
        payload = {"kind": "food_log", "client_id": "4b4b034b-85d4-4d21-91f5-70c2095ba8b3",
                   "payload": {"name": "Snack", "meal_type": "snack", "calories": 50,
                               "protein": 0, "carbohydrates": 10, "fat": 0,
                               "label_photo_data_url": "data:text/html;base64,PGgxPng8L2gxPg==",
                               "logged_at": "2026-09-22T10:00:00-04:00"}}
        self.assertEqual(self.client.post("/api/sync/", payload, format="json").status_code, 400)
        self.assertEqual(FoodLog.objects.count(), 0)

    @patch("tracker.views.urlopen")
    def test_barcode_lookup_prefers_serving_and_rejects_invalid_codes(self, mocked_urlopen):
        mocked_urlopen.return_value.__enter__.return_value = BytesIO(
            b'{"status":1,"product":{"product_name":"Yogurt","serving_size":"150 g",'
            b'"nutriments":{"energy-kcal_serving":140,"proteins_serving":12,'
            b'"carbohydrates_serving":16,"fat_serving":2}}}'
        )
        response = self.client.get("/api/food-lookup/12345678/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["calories"], 140)
        self.assertEqual(response.data["serving_description"], "150 g")
        self.assertEqual(self.client.get("/api/food-lookup/not-a-code/").status_code, 400)

# Create your tests here.
