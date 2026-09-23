"""Atomic, idempotent writes for occasionally-connected phones."""

from django.db import transaction
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import AppSettings, BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, Workout, WorkoutExercise


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = AppSettings
        fields = ("display_name", "calorie_goal", "protein_goal", "preferred_weight_unit")

    def validate_calorie_goal(self, value):
        if value < 1:
            raise serializers.ValidationError("Calorie goal must be at least 1")
        return value

    def validate_protein_goal(self, value):
        if value < 1:
            raise serializers.ValidationError("Protein goal must be at least 1")
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
    calories = serializers.IntegerField(min_value=0)
    protein = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0)
    carbohydrates = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0)
    fat = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0)
    logged_at = serializers.DateTimeField()


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
    kind = serializers.ChoiceField(choices=("food_log", "weight_entry", "workout", "workout_delete", "profile"))
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
            "food_log": FoodLogPayload,
            "weight_entry": WeightPayload,
            "workout": WorkoutPayload,
            "workout_delete": WorkoutDeletePayload,
            "profile": ProfileSerializer,
        }[kind]
        payload_serializer = payload_class(data=raw_payload)
        payload_serializer.is_valid(raise_exception=True)
        payload = payload_serializer.validated_data

        with transaction.atomic():
            if kind == "food_log":
                existing = FoodLog.objects.filter(client_id=client_id).first()
                if existing:
                    return Response({"id": existing.id, "duplicate": True})
                food = Food.objects.create(
                    name=payload["name"], calories=payload["calories"], protein=payload["protein"],
                    carbohydrates=payload["carbohydrates"], fat=payload["fat"],
                )
                log = FoodLog.objects.create(
                    client_id=client_id, food=food, logged_at=payload["logged_at"],
                    meal_type=payload["meal_type"], name_snapshot=food.name,
                    calories_snapshot=food.calories, protein_snapshot=food.protein,
                    carbs_snapshot=food.carbohydrates, fat_snapshot=food.fat,
                )
                return Response({"id": log.id}, status=status.HTTP_201_CREATED)

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
