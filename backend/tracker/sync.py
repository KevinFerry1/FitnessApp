"""Atomic, idempotent writes for occasionally-connected phones."""

import base64
import binascii
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AppSettings, BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, SavedMeal, Workout, WorkoutExercise


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSettings
        fields = ("display_name", "calorie_goal", "protein_goal", "preferred_weight_unit", "target_weekly_gain")

    def validate_calorie_goal(self, value):
        if value < 1:
            raise serializers.ValidationError("Calorie goal must be at least 1")
        return value

    def validate_protein_goal(self, value):
        if value < 1:
            raise serializers.ValidationError("Protein goal must be at least 1")
        return value

    def validate_target_weekly_gain(self, value):
        if value < 0 or value > 10:
            raise serializers.ValidationError("Choose a target between 0 and 10 lb per week")
        return value


class ProfileView(APIView):
    def get(self, request):
        profile, _ = AppSettings.objects.get_or_create(pk=1)
        return Response(ProfileSerializer(profile).data)

    def patch(self, request):
        profile, _ = AppSettings.objects.get_or_create(pk=1)
        serializer = ProfileSerializer(profile, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class FoodLogPayload(serializers.Serializer):
    name = serializers.CharField(max_length=160)
    meal_type = serializers.ChoiceField(choices=FoodLog.MEALS)
    calories = serializers.IntegerField(min_value=0, max_value=100000)
    protein = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=Decimal("999.99"))
    carbohydrates = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=Decimal("999.99"))
    fat = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=Decimal("999.99"))
    sugar = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=Decimal("999.99"), allow_null=True, required=False, default=None)
    added_sugar = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, max_value=Decimal("999.99"), allow_null=True, required=False, default=None)
    serving_quantity = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=Decimal("0.01"), max_value=Decimal("100"), required=False, default=Decimal("1"))
    serving_description = serializers.CharField(max_length=120, required=False, default="1 serving")
    nutrition_source = serializers.ChoiceField(choices=("manual", "barcode", "label", "saved_meal"), required=False, default="manual")
    label_photo_data_url = serializers.CharField(required=False, allow_blank=True, max_length=500000)
    logged_at = serializers.DateTimeField()

    def validate(self, attrs):
        if attrs.get("sugar") is not None and attrs.get("added_sugar") is not None and attrs["added_sugar"] > attrs["sugar"]:
            raise serializers.ValidationError({"added_sugar": "Added sugar cannot exceed total sugar"})
        return attrs

    def validate_label_photo_data_url(self, value):
        if not value:
            return None
        prefix = "data:image/jpeg;base64,"
        if not value.startswith(prefix):
            raise serializers.ValidationError("Label photo must be a JPEG")
        try:
            image = base64.b64decode(value[len(prefix):], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise serializers.ValidationError("Invalid label photo") from exc
        if not image.startswith(b"\xff\xd8\xff") or len(image) > 350_000:
            raise serializers.ValidationError("Label photo must be a JPEG under 350 KB")
        return image


class FoodLogUpdatePayload(FoodLogPayload):
    server_id = serializers.IntegerField(min_value=1)


class SavedMealPayload(serializers.Serializer):
    server_id = serializers.IntegerField(min_value=1, required=False)
    name = serializers.CharField(max_length=160)
    serving_description = serializers.CharField(max_length=120)
    meal_type = serializers.ChoiceField(choices=FoodLog.MEALS)
    calories = serializers.IntegerField(min_value=0)
    protein = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0)
    carbohydrates = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0)
    fat = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0)
    sugar = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, allow_null=True, required=False, default=None)
    added_sugar = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, allow_null=True, required=False, default=None)
    components = serializers.ListField(child=serializers.DictField(), required=False, default=list)

    def validate(self, attrs):
        if attrs["sugar"] is not None and attrs["added_sugar"] is not None and attrs["added_sugar"] > attrs["sugar"]:
            raise serializers.ValidationError({"added_sugar": "Added sugar cannot exceed total sugar"})
        return attrs


class SavedMealDeletePayload(serializers.Serializer):
    server_id = serializers.IntegerField(min_value=1, required=False)
    meal_client_id = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("A saved recipe ID is required")
        return attrs


def replace_food_log(log, payload):
    """Replace a log's per-serving food and totals without losing its saved label photo."""
    food = log.food if log.food and not log.food.logs.exclude(pk=log.pk).exists() else Food()
    for field in ("name", "calories", "protein", "carbohydrates", "fat", "sugar", "added_sugar"):
        setattr(food, field, payload[field])
    food.serving_description = payload["serving_description"]
    food.save()
    quantity = payload["serving_quantity"]
    log.food = food
    log.logged_at = payload["logged_at"]
    log.meal_type = payload["meal_type"]
    log.name_snapshot = food.name
    log.serving_quantity = quantity
    log.serving_description_snapshot = food.serving_description
    log.nutrition_source = payload["nutrition_source"]
    log.calories_snapshot = int((Decimal(food.calories) * quantity).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    for field, source in (("protein_snapshot", food.protein), ("carbs_snapshot", food.carbohydrates),
                          ("fat_snapshot", food.fat), ("sugar_snapshot", food.sugar),
                          ("added_sugar_snapshot", food.added_sugar)):
        setattr(log, field, (source * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if source is not None else None)
    log.save()
    return log

class WeightPayload(serializers.Serializer):
    weight = serializers.DecimalField(max_digits=6, decimal_places=2, min_value=0)
    unit = serializers.ChoiceField(choices=("lb", "kg"))
    notes = serializers.CharField(allow_blank=True, required=False)
    recorded_at = serializers.DateTimeField()


class SetPayload(serializers.Serializer):
    set_number = serializers.IntegerField(min_value=1, max_value=255)
    weight = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0, allow_null=True)
    weight_unit = serializers.ChoiceField(choices=("lb", "kg", "plate"))
    reps = serializers.IntegerField(min_value=0, max_value=255)
    set_type = serializers.ChoiceField(choices=("working", "warmup", "drop", "failure"), required=False)
    performed_at = serializers.DateTimeField()


class ExerciseOptionPayload(serializers.Serializer):
    name = serializers.CharField(max_length=160)
    muscle_group = serializers.CharField(max_length=80, allow_blank=True)
    replace_group = serializers.BooleanField(required=False, default=False)


class ExercisePayload(serializers.Serializer):
    name = serializers.CharField(max_length=160)
    notes = serializers.CharField(allow_blank=True, required=False)
    sets = SetPayload(many=True)


class WorkoutPayload(serializers.Serializer):
    server_id = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    revision = serializers.IntegerField(min_value=1)
    name = serializers.CharField(max_length=160)
    started_at = serializers.DateTimeField()
    completed_at = serializers.DateTimeField(allow_null=True)
    notes = serializers.CharField(allow_blank=True, required=False)
    exercises = ExercisePayload(many=True)


class WorkoutDeletePayload(serializers.Serializer):
    server_id = serializers.IntegerField(min_value=1, required=False)
    workout_client_id = serializers.UUIDField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("A workout ID is required")
        return attrs


class SyncEnvelope(serializers.Serializer):
    kind = serializers.ChoiceField(choices=("food_log", "food_log_update", "saved_meal", "saved_meal_delete", "weight_entry", "workout", "workout_delete", "profile", "exercise_option"))
    client_id = serializers.UUIDField()
    payload = serializers.JSONField()


class SyncView(APIView):
    """A client UUID makes a retried write safe when an HTTP response is lost."""

    def post(self, request):
        envelope = SyncEnvelope(data=request.data)
        envelope.is_valid(raise_exception=True)
        kind = envelope.validated_data["kind"]
        client_id = envelope.validated_data["client_id"]
        raw_payload = envelope.validated_data["payload"]
        payload_class = {
            "exercise_option": ExerciseOptionPayload,
            "food_log": FoodLogPayload,
            "food_log_update": FoodLogUpdatePayload,
            "saved_meal": SavedMealPayload,
            "saved_meal_delete": SavedMealDeletePayload,
            "weight_entry": WeightPayload,
            "workout": WorkoutPayload,
            "workout_delete": WorkoutDeletePayload,
            "profile": ProfileSerializer,
        }[kind]
        payload_serializer = payload_class(data=raw_payload)
        payload_serializer.is_valid(raise_exception=True)
        payload = payload_serializer.validated_data

        with transaction.atomic():
            if kind == "exercise_option":
                replace_group = payload.pop("replace_group")
                exercise = Exercise.objects.filter(owner=None, name__iexact=payload["name"]).first()
                created = exercise is None
                if created:
                    exercise = Exercise.objects.create(**payload)
                elif not exercise.muscle_group or replace_group:
                    exercise.muscle_group = payload["muscle_group"]
                    exercise.save(update_fields=["muscle_group", "updated_at"])
                return Response({"id": exercise.id}, status=201 if created else 200)

            if kind == "food_log":
                existing = FoodLog.objects.select_related("food").filter(client_id=client_id).first()
                if existing:
                    replace_food_log(existing, payload)
                    return Response({"id": existing.id, "duplicate": True})
                quantity = payload["serving_quantity"]
                food = Food.objects.create(
                    name=payload["name"], calories=payload["calories"], protein=payload["protein"],
                    carbohydrates=payload["carbohydrates"], fat=payload["fat"],
                    sugar=payload["sugar"], added_sugar=payload["added_sugar"],
                    serving_description=payload["serving_description"],
                )
                log = FoodLog.objects.create(
                    client_id=client_id, food=food, logged_at=payload["logged_at"],
                    meal_type=payload["meal_type"], name_snapshot=food.name,
                    serving_quantity=quantity,
                    serving_description_snapshot=payload["serving_description"],
                    nutrition_source=payload["nutrition_source"],
                    label_photo=payload.get("label_photo_data_url"),
                    calories_snapshot=int((Decimal(food.calories) * quantity).quantize(Decimal("1"), rounding=ROUND_HALF_UP)),
                    protein_snapshot=(food.protein * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                    carbs_snapshot=(food.carbohydrates * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                    fat_snapshot=(food.fat * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                    sugar_snapshot=(food.sugar * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if food.sugar is not None else None,
                    added_sugar_snapshot=(food.added_sugar * quantity).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if food.added_sugar is not None else None,
                )
                return Response({"id": log.id}, status=status.HTTP_201_CREATED)

            if kind == "food_log_update":
                log = FoodLog.objects.select_related("food").filter(pk=payload["server_id"]).first()
                if log is None:
                    return Response({"detail": "Food log not found"}, status=404)
                # The payload is a complete replacement, so retrying after a lost response is safe.
                replace_food_log(log, payload)
                return Response({"id": log.id})

            if kind == "saved_meal":
                meal = SavedMeal.objects.filter(client_id=client_id).first()
                if meal is None and payload.get("server_id"):
                    meal = SavedMeal.objects.filter(pk=payload["server_id"]).first()
                created = meal is None
                if created:
                    meal = SavedMeal(client_id=client_id)
                elif meal.client_id is None:
                    meal.client_id = client_id
                for field in ("name", "serving_description", "meal_type", "calories", "protein",
                              "carbohydrates", "fat", "sugar", "added_sugar", "components"):
                    setattr(meal, field, payload[field])
                meal.save()
                return Response({"id": meal.id}, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

            if kind == "saved_meal_delete":
                meals = SavedMeal.objects.all()
                if payload.get("server_id"):
                    meals = meals.filter(pk=payload["server_id"])
                if payload.get("meal_client_id"):
                    meals = meals.filter(client_id=payload["meal_client_id"])
                count, _ = meals.delete()
                return Response({"deleted": bool(count)})

            if kind == "weight_entry":
                existing = BodyWeightEntry.objects.filter(client_id=client_id).first()
                if existing:
                    return Response({"id": existing.id, "duplicate": True})
                entry = BodyWeightEntry.objects.create(client_id=client_id, **payload)
                return Response({"id": entry.id}, status=status.HTTP_201_CREATED)

            if kind == "profile":
                profile, _ = AppSettings.objects.get_or_create(pk=1)
                for field, value in payload.items():
                    setattr(profile, field, value)
                profile.save()
                return Response(ProfileSerializer(profile).data)

            if kind == "workout_delete":
                workouts = Workout.objects.all()
                if payload.get("server_id"):
                    workouts = workouts.filter(pk=payload["server_id"])
                if payload.get("workout_client_id"):
                    workouts = workouts.filter(client_id=payload["workout_client_id"])
                count, _ = workouts.delete()
                return Response({"deleted": bool(count)})

            workout = Workout.objects.filter(client_id=client_id).first()
            if workout is None and payload.get("server_id"):
                workout = Workout.objects.filter(pk=payload["server_id"]).first()
                if workout and workout.client_id not in (None, client_id):
                    return Response({"detail": "Workout belongs to a different client ID"}, status=409)
            if workout is None:
                workout = Workout(client_id=client_id)
            if payload["revision"] <= workout.sync_revision:
                return Response({"id": workout.id, "revision": workout.sync_revision, "duplicate": True})

            workout.client_id = client_id
            workout.sync_revision = payload["revision"]
            workout.name = payload["name"]
            workout.started_at = payload["started_at"]
            workout.completed_at = payload["completed_at"]
            workout.notes = payload.get("notes", "")
            workout.save()
            workout.workout_exercises.all().delete()
            for order, item in enumerate(payload["exercises"]):
                exercise = Exercise.objects.filter(owner=None, name__iexact=item["name"]).first()
                if exercise is None:
                    exercise = Exercise.objects.create(name=item["name"])
                workout_exercise = WorkoutExercise.objects.create(
                    workout=workout, exercise=exercise, order=order, notes=item.get("notes", "")
                )
                ExerciseSet.objects.bulk_create([
                    ExerciseSet(workout_exercise=workout_exercise, set_number=set_item["set_number"],
                                weight=set_item["weight"], weight_unit=set_item["weight_unit"],
                                reps=set_item["reps"], set_type=set_item.get("set_type", "working"),
                                performed_at=set_item["performed_at"])
                    for set_item in item["sets"]
                ])
            return Response({"id": workout.id, "revision": workout.sync_revision})
