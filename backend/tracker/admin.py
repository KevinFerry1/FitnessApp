from django.contrib import admin

from .models import BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, SavedMeal, UserProfile, Workout, WorkoutExercise

admin.site.register([UserProfile, Food, FoodLog, SavedMeal, BodyWeightEntry, Exercise, Workout, WorkoutExercise, ExerciseSet])

# Register your models here.
