from rest_framework import serializers

from .models import BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, SavedMeal, Workout, WorkoutExercise


class FoodSerializer(serializers.ModelSerializer):
    class Meta:
        model = Food
        fields = "__all__"
        read_only_fields = ("owner",)


class FoodLogSerializer(serializers.ModelSerializer):
    label_photo_url = serializers.SerializerMethodField()

    def get_label_photo_url(self, obj):
        return f"/api/food-logs/{obj.pk}/label-photo/" if obj.label_photo else None

    class Meta:
        model = FoodLog
        exclude = ("label_photo",)
        read_only_fields = ("user", "label_photo_url")


class SavedMealSerializer(serializers.ModelSerializer):
    class Meta:
        model = SavedMeal
        fields = ("id", "name", "serving_description", "meal_type", "calories", "protein", "carbohydrates", "fat")


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
