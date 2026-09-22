from datetime import datetime, time
from uuid import UUID

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from .importer import parse_notes
from .models import BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, NotesImportBatch, Workout, WorkoutExercise
from .serializers import (
    BodyWeightEntrySerializer,
    ExerciseSerializer,
    ExerciseSetSerializer,
    FoodLogSerializer,
    FoodSerializer,
    WorkoutExerciseSerializer,
    WorkoutSerializer,
)


class OwnerViewSet(viewsets.ModelViewSet):
    owner_field = "user"

    def perform_create(self, serializer):
        if self.request.user.is_authenticated:
            serializer.save(**{self.owner_field: self.request.user})
        else:
            serializer.save()


class FoodViewSet(OwnerViewSet):
    queryset = Food.objects.all()
    serializer_class = FoodSerializer
    owner_field = "owner"


class FoodLogViewSet(OwnerViewSet):
    queryset = FoodLog.objects.select_related("food").all()
    serializer_class = FoodLogSerializer


class BodyWeightEntryViewSet(OwnerViewSet):
    queryset = BodyWeightEntry.objects.all()
    serializer_class = BodyWeightEntrySerializer


class ExerciseViewSet(OwnerViewSet):
    queryset = Exercise.objects.all()
    serializer_class = ExerciseSerializer
    owner_field = "owner"


class WorkoutViewSet(OwnerViewSet):
    queryset = Workout.objects.prefetch_related("workout_exercises__exercise", "workout_exercises__sets").all()
    serializer_class = WorkoutSerializer


class WorkoutExerciseViewSet(viewsets.ModelViewSet):
    queryset = WorkoutExercise.objects.select_related("exercise", "workout").prefetch_related("sets").all()
    serializer_class = WorkoutExerciseSerializer


class ExerciseSetViewSet(viewsets.ModelViewSet):
    queryset = ExerciseSet.objects.select_related("workout_exercise").all()
    serializer_class = ExerciseSetSerializer


class TodayView(APIView):
    def get(self, request):
        today = timezone.localdate()
        start = timezone.make_aware(datetime.combine(today, time.min))
        end = timezone.make_aware(datetime.combine(today, time.max))
        logs = FoodLog.objects.filter(logged_at__range=(start, end))
        totals = logs.aggregate(
            calories=Sum("calories_snapshot"),
            protein=Sum("protein_snapshot"),
            carbs=Sum("carbs_snapshot"),
            fat=Sum("fat_snapshot"),
        )
        workouts = Workout.objects.filter(started_at__range=(start, end)).prefetch_related(
            "workout_exercises__exercise", "workout_exercises__sets"
        )
        weight = BodyWeightEntry.objects.filter(recorded_at__lte=end).first()
        return Response(
            {
                "date": today,
                "nutrition": {key: value or 0 for key, value in totals.items()},
                "food_logs": FoodLogSerializer(logs, many=True).data,
                "workouts": WorkoutSerializer(workouts, many=True).data,
                "latest_weight": BodyWeightEntrySerializer(weight).data if weight else None,
            }
        )


class NotesImportView(APIView):
    def post(self, request):
        text = request.data.get("text", "")
        commit = bool(request.data.get("commit", False))
        workouts, warnings = parse_notes(text, request.data.get("default_year"))
        parsed = [workout.to_dict() for workout in workouts]
        if not commit:
            return Response({"workouts": parsed, "warnings": warnings, "committed": False})

        raw_client_id = request.data.get("client_id")
        try:
            client_id = UUID(str(raw_client_id)) if raw_client_id else None
        except ValueError as exc:
            raise ValidationError({"client_id": "Must be a valid UUID"}) from exc

        created_ids = []
        with transaction.atomic():
            if client_id:
                previous = NotesImportBatch.objects.filter(client_id=client_id).first()
                if previous:
                    return Response({"workouts": parsed, "warnings": warnings, "committed": True,
                                     "created_workout_ids": previous.workout_ids, "duplicate": True})
            for parsed_workout in workouts:
                started_at = timezone.make_aware(datetime.combine(parsed_workout.workout_date, time(hour=12)))
                workout = Workout.objects.create(
                    user=request.user if request.user.is_authenticated else None,
                    name=parsed_workout.name,
                    started_at=started_at,
                    completed_at=started_at,
                    import_source="apple_notes",
                )
                created_ids.append(workout.id)
                for order, parsed_exercise in enumerate(parsed_workout.exercises):
                    exercise, _ = Exercise.objects.get_or_create(
                        owner=request.user if request.user.is_authenticated else None,
                        name__iexact=parsed_exercise.name,
                        defaults={"name": parsed_exercise.name},
                    )
                    workout_exercise = WorkoutExercise.objects.create(
                        workout=workout,
                        exercise=exercise,
                        order=order,
                        notes=parsed_exercise.notes,
                    )
                    ExerciseSet.objects.bulk_create(
                        [
                            ExerciseSet(
                                workout_exercise=workout_exercise,
                                set_number=item.set_number,
                                reps=item.reps,
                                weight=item.weight,
                                weight_unit=item.weight_unit,
                                performed_at=started_at,
                            )
                            for item in parsed_exercise.sets
                        ]
                    )
            if client_id:
                NotesImportBatch.objects.create(client_id=client_id, workout_ids=created_ids)
        return Response(
            {"workouts": parsed, "warnings": warnings, "committed": True, "created_workout_ids": created_ids},
            status=status.HTTP_201_CREATED,
        )

# Create your views here.
