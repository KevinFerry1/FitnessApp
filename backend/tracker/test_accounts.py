import hashlib
from datetime import timedelta
from io import StringIO
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import AccountInvite, AppSettings, BodyWeightEntry, Exercise, ExerciseSet, Food, FoodLog, NotesImportBatch, SavedMeal, Workout, WorkoutExercise


class AccountIsolationTests(TestCase):
    def setUp(self):
        self.alice = get_user_model().objects.create_user('alice', password='A-strong-password-817!')
        self.bob = get_user_model().objects.create_user('bob', password='B-strong-password-819!')
        self.client = APIClient()
        self.client.force_authenticate(self.bob)
        self.food = Food.objects.create(owner=self.alice, name='Private food', calories=100)
        self.log = FoodLog.objects.create(user=self.alice, food=self.food, logged_at=timezone.now(),
            name_snapshot='Private food', calories_snapshot=100, label_photo=b'private-photo')
        self.meal = SavedMeal.objects.create(user=self.alice, name='Private meal', calories=100)
        self.weight = BodyWeightEntry.objects.create(user=self.alice, weight=175, recorded_at=timezone.now())
        self.exercise = Exercise.objects.create(owner=self.alice, name='Private exercise')
        self.workout = Workout.objects.create(user=self.alice, name='Private workout', started_at=timezone.now())
        self.row = WorkoutExercise.objects.create(workout=self.workout, exercise=self.exercise)
        self.set = ExerciseSet.objects.create(workout_exercise=self.row, set_number=1, reps=8)

    def test_anonymous_cannot_read_or_write_any_tracker_endpoint(self):
        anonymous = APIClient()
        endpoints = ['today', 'profile', 'foods', 'food-logs', 'saved-meals', 'weight-entries', 'exercises',
                     'workouts', 'workout-exercises', 'exercise-sets', 'sync', 'imports/notes',
                     'food-lookup/12345678', f'food-logs/{self.log.pk}/label-photo']
        for endpoint in endpoints:
            with self.subTest(endpoint=endpoint):
                for method in (anonymous.get, anonymous.post):
                    self.assertEqual(method(f'/api/{endpoint}/').status_code, 401)

    def test_lists_details_edits_and_deletes_are_scoped_even_for_staff(self):
        self.bob.is_staff = True
        self.bob.save()
        entities = [('foods', self.food), ('food-logs', self.log), ('saved-meals', self.meal),
                    ('weight-entries', self.weight), ('exercises', self.exercise), ('workouts', self.workout),
                    ('workout-exercises', self.row), ('exercise-sets', self.set)]
        for endpoint, item in entities:
            with self.subTest(endpoint=endpoint):
                self.assertEqual(self.client.get(f'/api/{endpoint}/').data, [])
                url = f'/api/{endpoint}/{item.pk}/'
                self.assertEqual(self.client.get(url).status_code, 404)
                self.assertEqual(self.client.patch(url, {}, format='json').status_code, 404)
                self.assertEqual(self.client.delete(url).status_code, 404)
        self.assertEqual(self.client.get(f'/api/food-logs/{self.log.pk}/label-photo/').status_code, 404)
        today = self.client.get('/api/today/').data
        self.assertEqual(today['food_logs'], [])
        self.assertEqual(today['workouts'], [])
        self.assertIsNone(today['latest_weight'])
        self.assertEqual(today['nutrition']['calories'], 0)

    def test_nested_references_cannot_point_at_another_account(self):
        own_workout = Workout.objects.create(user=self.bob, started_at=timezone.now())
        payloads = [('/api/workout-exercises/', {'workout': self.workout.pk, 'exercise_id': self.exercise.pk}),
                    ('/api/workout-exercises/', {'workout': own_workout.pk, 'exercise_id': self.exercise.pk}),
                    ('/api/exercise-sets/', {'workout_exercise': self.row.pk, 'set_number': 2, 'reps': 6}),
                    ('/api/food-logs/', {'food': self.food.pk, 'logged_at': timezone.now().isoformat(),
                                       'name_snapshot': 'Food', 'calories_snapshot': 100})]
        for url, payload in payloads:
            with self.subTest(url=url):
                self.assertEqual(self.client.post(url, payload, format='json').status_code, 400)
        self.assertEqual(self.row.sets.count(), 1)

    def test_profile_is_separate_and_ownership_input_is_ignored(self):
        AppSettings.objects.create(user=self.alice, display_name='Alice', calorie_goal=1234)
        response = self.client.patch('/api/profile/', {'display_name': 'Bob'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(AppSettings.objects.get(user=self.alice).display_name, 'Alice')
        self.assertEqual(self.client.get('/api/profile/').data['display_name'], 'Bob')
        created = self.client.post('/api/foods/', {'name': 'Mine', 'calories': 200, 'owner': self.alice.pk}, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(Food.objects.get(pk=created.data['id']).owner, self.bob)

    def test_sync_updates_and_deletes_cannot_touch_other_accounts(self):
        common = {'name': 'Changed', 'meal_type': 'lunch', 'calories': 200, 'protein': 1,
                  'carbohydrates': 1, 'fat': 1, 'logged_at': timezone.now().isoformat()}
        operations = [('food_log_update', {**common, 'server_id': self.log.pk}, 404),
                      ('saved_meal', {'server_id': self.meal.pk, 'name': 'Changed', 'serving_description': '1',
                                     'meal_type': 'lunch', 'calories': 200, 'protein': 1, 'carbohydrates': 1, 'fat': 1}, 404),
                      ('workout', {'server_id': self.workout.pk, 'revision': 1, 'name': 'Changed',
                                   'started_at': timezone.now().isoformat(), 'completed_at': None, 'exercises': []}, 404),
                      ('saved_meal_delete', {'server_id': self.meal.pk}, 200),
                      ('workout_delete', {'server_id': self.workout.pk}, 200)]
        for kind, payload, expected in operations:
            with self.subTest(kind=kind):
                response = self.client.post('/api/sync/', {'kind': kind, 'client_id': str(uuid4()), 'payload': payload}, format='json')
                self.assertEqual(response.status_code, expected)
        self.log.refresh_from_db()
        self.assertEqual(self.log.calories_snapshot, 100)
        self.assertTrue(SavedMeal.objects.filter(pk=self.meal.pk).exists())
        self.assertTrue(Workout.objects.filter(pk=self.workout.pk).exists())

    def test_same_offline_ids_and_import_ids_are_independent(self):
        for kind, payload, model in [
            ('food_log', {'name': 'Snack', 'meal_type': 'snack', 'calories': 50, 'protein': 0,
                          'carbohydrates': 1, 'fat': 1, 'logged_at': timezone.now().isoformat()}, FoodLog),
            ('weight_entry', {'weight': 170, 'unit': 'lb', 'recorded_at': timezone.now().isoformat()}, BodyWeightEntry),
            ('saved_meal', {'name': 'Meal', 'serving_description': '1 bowl', 'meal_type': 'lunch', 'calories': 50,
                            'protein': 0, 'carbohydrates': 1, 'fat': 1}, SavedMeal),
            ('workout', {'revision': 1, 'name': 'Session', 'started_at': timezone.now().isoformat(),
                         'completed_at': None, 'exercises': []}, Workout),
        ]:
            uid = str(uuid4())
            for user in (self.alice, self.bob):
                self.client.force_authenticate(user)
                result = self.client.post('/api/sync/', {'kind': kind, 'client_id': uid, 'payload': payload}, format='json')
                self.assertIn(result.status_code, (200, 201), result.data)
            self.assertEqual(model.objects.filter(client_id=uid).count(), 2)
        uid = str(uuid4())
        for user in (self.alice, self.bob):
            self.client.force_authenticate(user)
            result = self.client.post('/api/imports/notes/', {'text': '9/21/26 Upper A\nChest fly 2x7 25lb',
                                      'commit': True, 'client_id': uid}, format='json')
            self.assertEqual(result.status_code, 201)
        self.assertEqual(NotesImportBatch.objects.filter(client_id=uid).count(), 2)
        self.assertEqual(Exercise.objects.filter(name='Chest fly').count(), 2)


class SessionAccountTests(TestCase):
    def setUp(self):
        cache.clear()
        self.owner = get_user_model().objects.create_user('owner', password='A-strong-password-817!', is_staff=True)
        self.client = APIClient(enforce_csrf_checks=True)
        self.csrf()

    def csrf(self):
        response = self.client.get('/api/auth/session/')
        self.client.credentials(HTTP_X_CSRFTOKEN=response.data['csrf_token'])
        return response

    def login(self):
        result = self.client.post('/api/auth/login/', {'username': 'owner', 'password': 'A-strong-password-817!'}, format='json')
        self.assertEqual(result.status_code, 200, result.content)
        self.csrf()
        return result

    def test_session_login_logout_and_csrf_on_anonymous_login(self):
        self.assertIsNone(self.csrf().data['user'])
        missing_csrf = APIClient(enforce_csrf_checks=True)
        self.assertEqual(missing_csrf.post('/api/auth/login/', {'username': 'owner', 'password': 'A-strong-password-817!'}, format='json').status_code, 403)
        self.assertEqual(missing_csrf.post('/api/auth/signup/', {}, format='json').status_code, 403)
        self.login()
        self.assertEqual(self.client.get('/api/today/').status_code, 200)
        self.client.credentials()
        self.assertEqual(self.client.patch('/api/profile/', {'display_name': 'X'}, format='json').status_code, 403)
        self.csrf()
        self.assertEqual(self.client.post('/api/auth/logout/', {}).status_code, 200)
        self.assertEqual(self.client.get('/api/today/').status_code, 401)

    def test_invitation_required_one_use_and_creates_empty_account(self):
        self.login()
        invite = self.client.post('/api/auth/invites/', {}, format='json')
        self.assertEqual(invite.status_code, 201)
        token = invite.data['invite_path'].split('=')[1]
        self.assertEqual(AccountInvite.objects.get().token_hash, hashlib.sha256(token.encode()).hexdigest())
        self.client.post('/api/auth/logout/', {})
        self.csrf()
        data = {'username': 'family', 'password': 'Family-password-891!', 'invite': 'wrong'}
        self.assertEqual(self.client.post('/api/auth/signup/', data, format='json').status_code, 400)
        data['invite'] = token
        response = self.client.post('/api/auth/signup/', data, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data['user']['can_invite'])
        self.assertFalse(response.data['user']['legacy_owner'])
        self.csrf()
        self.assertEqual(self.client.get('/api/workouts/').data, [])
        self.assertEqual(self.client.post('/api/auth/invites/', {}).status_code, 403)
        self.client.post('/api/auth/logout/', {})
        self.csrf()
        data['username'] = 'another'
        self.assertEqual(self.client.post('/api/auth/signup/', data, format='json').status_code, 400)
        self.assertFalse(get_user_model().objects.filter(username='another').exists())

    def test_weak_password_and_expired_invitation_are_rejected(self):
        AccountInvite.objects.create(token_hash=hashlib.sha256(b'expired').hexdigest(), created_by=self.owner,
                                     expires_at=timezone.now()-timedelta(days=1))
        for password in ('12345678', 'A-strong-password-817!'):
            self.assertEqual(self.client.post('/api/auth/signup/', {'username': 'family', 'password': password,
                             'invite': 'expired'}, format='json').status_code, 400)
        self.assertEqual(get_user_model().objects.count(), 1)

    def test_login_is_throttled(self):
        for _ in range(10):
            self.assertEqual(self.client.post('/api/auth/login/', {'username': 'owner', 'password': 'wrong'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/auth/login/', {'username': 'owner', 'password': 'wrong'}, format='json').status_code, 429)

    def test_account_header_prevents_stale_tab_writes_and_api_is_not_cached(self):
        self.login()
        self.client.credentials(HTTP_X_CSRFTOKEN=self.client.cookies['csrftoken'].value, HTTP_X_FITNESS_ACCOUNT='999')
        self.assertEqual(self.client.patch('/api/profile/', {'display_name': 'Wrong account'}, format='json').status_code, 409)
        self.assertEqual(self.client.get('/api/today/')['Cache-Control'], 'private, no-store')


class LegacyClaimTests(TestCase):
    def test_claim_is_explicit_preserves_history_and_cannot_be_reassigned(self):
        owner = get_user_model().objects.create_user('owner', is_staff=True)
        legacy = AppSettings.objects.create(display_name='Kevin', calorie_goal=3000)
        workout = Workout.objects.create(name='Legacy', started_at=timezone.now())
        exercise = Exercise.objects.create(name='Legacy exercise')
        call_command('claim_tracker', 'owner', stdout=StringIO())
        legacy.refresh_from_db(); workout.refresh_from_db(); exercise.refresh_from_db()
        self.assertEqual(legacy.user, owner)
        self.assertEqual(legacy.calorie_goal, 3000)
        self.assertTrue(legacy.legacy_owner)
        self.assertEqual(workout.user, owner)
        self.assertEqual(exercise.owner, owner)
        call_command('claim_tracker', 'owner', stdout=StringIO())
        get_user_model().objects.create_user('other', is_staff=True)
        with self.assertRaises(CommandError): call_command('claim_tracker', 'other', stdout=StringIO())
