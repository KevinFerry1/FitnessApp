from rest_framework import serializers

from .models import BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, SavedMeal, Workout, WorkoutExercise


class FoodSerializer(serializers.ModelSerializer):
    class Meta:
        model = Food
        fields = "__all__"
        read_only_fields = ("owner",)


class FoodLogSerializer(serializers.ModelSerializer):
    label_photo_url = serializers.SerializerMethodField()
    per_serving = FoodSerializer(source="food", read_only=True)

    def get_label_photo_url(self, obj):
        return f"/api/food-logs/{obj.pk}/label-photo/" if obj.label_photo else None

    class Meta:
        model = FoodLog
        exclude = ("label_photo",)
        read_only_fields = ("user", "label_photo_url", "per_serving")


class SavedMealSerializer(serializers.ModelSerializer):
    def validate(self, attrs):
        sugar = attrs.get("sugar", getattr(self.instance, "sugar", None))
        added = attrs.get("added_sugar", getattr(self.instance, "added_sugar", None))
        if sugar is not None and added is not None and added > sugar:
            raise serializers.ValidationError({"added_sugar": "Added sugar cannot exceed total sugar"})
        return attrs

    class Meta:
        model = SavedMeal
        fields = ("id", "client_id", "name", "serving_description", "meal_type", "calories", "protein", "carbohydrates", "fat", "sugar", "added_sugar", "components")
        read_only_fields = ("client_id",)


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
