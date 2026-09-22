from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BodyWeightEntryViewSet,
    ExerciseSetViewSet,
    ExerciseViewSet,
    FoodLogViewSet,
    FoodViewSet,
    NotesImportView,
    TodayView,
    WorkoutExerciseViewSet,
    WorkoutViewSet,
)

router = DefaultRouter()
router.register("foods", FoodViewSet)
router.register("food-logs", FoodLogViewSet)
router.register("weight-entries", BodyWeightEntryViewSet)
router.register("exercises", ExerciseViewSet)
router.register("workouts", WorkoutViewSet)
router.register("workout-exercises", WorkoutExerciseViewSet)
router.register("exercise-sets", ExerciseSetViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("today/", TodayView.as_view(), name="today"),
    path("imports/notes/", NotesImportView.as_view(), name="notes-import"),
]
