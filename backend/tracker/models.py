from django.conf import settings
from django.db import models


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class UserProfile(TimeStampedModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="fitness_profile")
    calorie_goal = models.PositiveIntegerField(default=2800)
    protein_goal = models.PositiveIntegerField(default=180)
    carb_goal = models.PositiveIntegerField(default=300)
    fat_goal = models.PositiveIntegerField(default=80)
    current_weight = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    goal_weight = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    preferred_weight_unit = models.CharField(max_length=2, choices=[("lb", "lb"), ("kg", "kg")], default="lb")
    timezone = models.CharField(max_length=64, default="America/New_York")


class AppSettings(TimeStampedModel):
    """Settings for this private, single-user tailnet deployment."""

    display_name = models.CharField(max_length=80, default="Your profile")
    calorie_goal = models.PositiveIntegerField(default=2800)
    protein_goal = models.PositiveIntegerField(default=180)
    preferred_weight_unit = models.CharField(max_length=2, choices=[("lb", "lb"), ("kg", "kg")], default="lb")
    target_weekly_gain = models.DecimalField(max_digits=5, decimal_places=2, default=0.5)


class NotesImportBatch(models.Model):
    client_id = models.UUIDField(unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    workout_ids = models.JSONField(default=list)


class ClientMutationId(models.Model):
    """UUID mixin lets retries after a dropped response avoid duplicate logs."""

    client_id = models.UUIDField(unique=True, null=True, blank=True)

    class Meta:
        abstract = True


class Food(TimeStampedModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="foods")
    name = models.CharField(max_length=160)
    brand = models.CharField(max_length=120, blank=True)
    serving_description = models.CharField(max_length=120, default="1 serving")
    calories = models.PositiveIntegerField()
    protein = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    carbohydrates = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    fat = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    sugar = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    added_sugar = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class FoodLog(ClientMutationId, TimeStampedModel):
    MEALS = [(value, value.title()) for value in ("breakfast", "lunch", "dinner", "snack")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="food_logs")
    food = models.ForeignKey(Food, null=True, blank=True, on_delete=models.SET_NULL, related_name="logs")
    logged_at = models.DateTimeField()
    meal_type = models.CharField(max_length=16, choices=MEALS, default="snack")
    serving_quantity = models.DecimalField(max_digits=7, decimal_places=2, default=1)
    serving_description_snapshot = models.CharField(max_length=120, default="1 serving")
    nutrition_source = models.CharField(max_length=20, default="manual")
    name_snapshot = models.CharField(max_length=160)
    calories_snapshot = models.PositiveIntegerField()
    protein_snapshot = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    carbs_snapshot = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    fat_snapshot = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    sugar_snapshot = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    added_sugar_snapshot = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    # Small, compressed JPEGs live in SQLite so normal database backups include them.
    label_photo = models.BinaryField(null=True, blank=True, editable=False)

    class Meta:
        ordering = ["-logged_at"]


class SavedMeal(ClientMutationId, TimeStampedModel):
    """Reusable nutrition snapshot for a frequently eaten meal or recipe."""

    name = models.CharField(max_length=160)
    serving_description = models.CharField(max_length=120, default="1 serving")
    meal_type = models.CharField(max_length=16, choices=FoodLog.MEALS, default="lunch")
    calories = models.PositiveIntegerField()
    protein = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    carbohydrates = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    fat = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    sugar = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    added_sugar = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    components = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ["name"]


class BodyWeightEntry(ClientMutationId, TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="weight_entries")
    weight = models.DecimalField(max_digits=6, decimal_places=2)
    unit = models.CharField(max_length=2, choices=[("lb", "lb"), ("kg", "kg")], default="lb")
    recorded_at = models.DateTimeField()
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-recorded_at"]


class Exercise(TimeStampedModel):
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="exercises")
    name = models.CharField(max_length=160)
    muscle_group = models.CharField(max_length=80, blank=True)
    equipment = models.CharField(max_length=80, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Workout(ClientMutationId, TimeStampedModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.CASCADE, related_name="workouts")
    name = models.CharField(max_length=160, default="Workout")
    started_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    import_source = models.CharField(max_length=32, blank=True)
    sync_revision = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["-started_at"]


class WorkoutExercise(TimeStampedModel):
    workout = models.ForeignKey(Workout, on_delete=models.CASCADE, related_name="workout_exercises")
    exercise = models.ForeignKey(Exercise, on_delete=models.PROTECT, related_name="workout_exercises")
    order = models.PositiveSmallIntegerField(default=0)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["order", "id"]


class ExerciseSet(TimeStampedModel):
    SET_TYPES = [(value, value.title()) for value in ("working", "warmup", "drop", "failure")]
    workout_exercise = models.ForeignKey(WorkoutExercise, on_delete=models.CASCADE, related_name="sets")
    set_number = models.PositiveSmallIntegerField()
    weight = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    weight_unit = models.CharField(max_length=8, default="lb")
    reps = models.PositiveSmallIntegerField(null=True, blank=True)
    set_type = models.CharField(max_length=16, choices=SET_TYPES, default="working")
    performed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["set_number"]
        constraints = [models.UniqueConstraint(fields=["workout_exercise", "set_number"], name="unique_set_number")]

# Create your models here.
