"""Explicit, administrator-only assignment of the old personal tracker."""
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from tracker.models import AppSettings, BodyWeightEntry, Exercise, Food, FoodLog, NotesImportBatch, SavedMeal, Workout


class Command(BaseCommand):
    help = 'Assign unowned legacy tracker data to an existing administrator account.'

    def add_arguments(self, parser):
        parser.add_argument('username')

    @transaction.atomic
    def handle(self, *args, **options):
        user = get_user_model().objects.filter(username=options['username']).first()
        if user is None or not user.is_staff:
            raise CommandError('Create this administrator with createsuperuser first.')
        if AppSettings.objects.filter(legacy_owner=True).exclude(user=user).exists():
            raise CommandError('The legacy tracker already belongs to another account.')
        legacy = AppSettings.objects.filter(user__isnull=True).first()
        current = AppSettings.objects.filter(user=user).first()
        if legacy and current:
            raise CommandError('This account already has preferences. Claim the tracker before its first login.')
        profile = legacy or current or AppSettings()
        profile.user = user
        profile.legacy_owner = True
        profile.save()
        for model, field in ((Food, 'owner'), (Exercise, 'owner'), (FoodLog, 'user'),
                             (BodyWeightEntry, 'user'), (Workout, 'user'), (SavedMeal, 'user'),
                             (NotesImportBatch, 'user')):
            count = model.objects.filter(**{field + '__isnull': True}).update(**{field: user})
            self.stdout.write(f'{model.__name__}: assigned {count}')
        self.stdout.write(self.style.SUCCESS('Legacy tracker assigned. Sign in on your existing phone to recover its offline drafts.'))
