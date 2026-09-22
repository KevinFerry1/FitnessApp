from django.contrib import admin

from .models import BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, UserProfile, Workout, WorkoutExercise

admin.site.register([UserProfile, Food, FoodLog, BodyWeightEntry, Exercise, Workout, WorkoutExercise, ExerciseSet])

# Register your models here.
