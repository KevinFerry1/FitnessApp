from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    BodyWeightEntryViewSet,
    ExerciseSetViewSet,
    ExerciseViewSet,
    FoodLogViewSet,
    FoodLabelPhotoView,
    FoodViewSet,
    SavedMealViewSet,
    BarcodeLookupView,
    NotesImportView,
    TodayView,
    WorkoutExerciseViewSet,
    WorkoutViewSet,
)
from .sync import ProfileView, SyncView

router = DefaultRouter()
router.register("foods", FoodViewSet)
router.register("saved-meals", SavedMealViewSet)
router.register("food-logs", FoodLogViewSet)
router.register("weight-entries", BodyWeightEntryViewSet)
router.register("exercises", ExerciseViewSet)
router.register("workouts", WorkoutViewSet)
router.register("workout-exercises", WorkoutExerciseViewSet)
router.register("exercise-sets", ExerciseSetViewSet)

urlpatterns = [
    path("", include(router.urls)),
    path("today/", TodayView.as_view(), name="today"),
    path("food-lookup/<str:barcode>/", BarcodeLookupView.as_view(), name="food-lookup"),
    path("food-logs/<int:pk>/label-photo/", FoodLabelPhotoView.as_view(), name="food-label-photo"),
    path("imports/notes/", NotesImportView.as_view(), name="notes-import"),
    path("profile/", ProfileView.as_view(), name="profile"),
    path("sync/", SyncView.as_view(), name="sync"),
]
