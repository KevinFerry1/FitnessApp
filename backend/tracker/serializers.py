from rest_framework import serializers

from .models import BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, Workout, WorkoutExercise


class FoodSerializer(serializers.ModelSerializer):
    class Meta:
        model = Food
        fields = "__all__"
        read_only_fields = ("owner",)


class FoodLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = FoodLog
        fields = "__all__"
        read_only_fields = ("user",)


class BodyWeightEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = BodyWeightEntry
        fields = "__all__"
        read_only_fields = ("user",)


class ExerciseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Exercise
        fields = "__all__"
        read_only_fields = ("owner",)


class ExerciseSetSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExerciseSet
        fields = "__all__"


class WorkoutExerciseSerializer(serializers.ModelSerializer):
    exercise = ExerciseSerializer(read_only=True)
    exercise_id = serializers.PrimaryKeyRelatedField(source="exercise", queryset=Exercise.objects.all(), write_only=True)
    sets = ExerciseSetSerializer(many=True, read_only=True)

    class Meta:
        model = WorkoutExercise
        fields = "__all__"


class WorkoutSerializer(serializers.ModelSerializer):
    workout_exercises = WorkoutExerciseSerializer(many=True, read_only=True)

    class Meta:
        model = Workout
        fields = "__all__"
        read_only_fields = ("user",)
