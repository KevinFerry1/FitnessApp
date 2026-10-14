"""Session accounts and one-use family invitations, all on the app's origin."""
import hashlib
import secrets
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model, login, logout
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.middleware.csrf import get_token
from django.http import JsonResponse
from django.utils import timezone
from django.utils.cache import patch_vary_headers
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from rest_framework import serializers
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from .models import AccountInvite, AppSettings


class PrivateApiMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        expected = request.headers.get('X-Fitness-Account')
        if (request.path.startswith('/api/') and not request.path.startswith('/api/auth/')
                and expected and request.user.is_authenticated and expected != str(request.user.pk)):
            response = JsonResponse({'detail': 'Account changed. Sign in again before syncing.', 'code': 'account_changed'}, status=409)
        else:
            response = self.get_response(request)
        if request.path.startswith('/api/'):
            response['Cache-Control'] = 'private, no-store'
            patch_vary_headers(response, ['Cookie'])
        return response


class AccountThrottle(SimpleRateThrottle):
    scope = 'account'
    rate = '10/min'

    def get_cache_key(self, request, view):
        # Use the connection address, not spoofable client-supplied forwarding headers.
        return self.cache_format % {'scope': self.scope, 'ident': request.META.get('REMOTE_ADDR', '')}


def account_data(user):
    profile, _ = AppSettings.objects.get_or_create(user=user)
    return {'id': user.pk, 'username': user.username, 'can_invite': user.is_staff,
            'legacy_owner': profile.legacy_owner}


class SessionView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'user': account_data(request.user) if request.user.is_authenticated else None,
                         'csrf_token': get_token(request)})


class LoginPayload(serializers.Serializer):
    username = serializers.CharField(max_length=150)
    password = serializers.CharField(max_length=256, trim_whitespace=False)


class SignupPayload(LoginPayload):
    username = serializers.RegexField(r'^[a-zA-Z0-9_.-]{3,40}$', max_length=40)
    invite = serializers.CharField(max_length=128)

    def validate_username(self, value):
        value = value.lower()
        if get_user_model().objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError('That username is already taken.')
        return value

    def validate(self, attrs):
        try:
            validate_password(attrs['password'], get_user_model()(username=attrs['username']))
        except DjangoValidationError as exc:
            raise serializers.ValidationError({'password': exc.messages}) from exc
        return attrs


@method_decorator(csrf_protect, name='dispatch')
class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AccountThrottle]

    def post(self, request):
        payload = LoginPayload(data=request.data)
        payload.is_valid(raise_exception=True)
        username = payload.validated_data['username']
        known = get_user_model().objects.filter(username__iexact=username).first()
        user = authenticate(request, username=known.username if known else username.lower(),
                            password=payload.validated_data['password'])
        if user is None:
            return Response({'detail': 'Username or password is incorrect.'}, status=400)
        login(request, user)
        return Response({'user': account_data(user), 'csrf_token': get_token(request)})


@method_decorator(csrf_protect, name='dispatch')
class SignupView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AccountThrottle]

    def post(self, request):
        payload = SignupPayload(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        digest = hashlib.sha256(data['invite'].encode()).hexdigest()
        try:
            with transaction.atomic():
                # Conditional update also prevents double redemption on SQLite.
                used = AccountInvite.objects.filter(token_hash=digest, accepted_at__isnull=True,
                                                    expires_at__gt=timezone.now()).update(accepted_at=timezone.now())
                if not used:
                    return Response({'detail': 'This invitation has expired or has already been used.'}, status=400)
                user = get_user_model().objects.create_user(username=data['username'], password=data['password'])
                AppSettings.objects.create(user=user, display_name=data['username'])
        except IntegrityError:
            return Response({'detail': 'That username is already taken.'}, status=400)
        login(request, user, backend='django.contrib.auth.backends.ModelBackend')
        return Response({'user': account_data(user), 'csrf_token': get_token(request)}, status=201)


class LogoutView(APIView):
    def post(self, request):
        logout(request)
        return Response({'user': None, 'csrf_token': get_token(request)})


class InviteView(APIView):
    permission_classes = [IsAdminUser]

    def post(self, request):
        token = secrets.token_urlsafe(32)
        expires = timezone.now() + timedelta(days=7)
        AccountInvite.objects.create(token_hash=hashlib.sha256(token.encode()).hexdigest(),
                                     created_by=request.user, expires_at=expires)
        # A fragment keeps the secret out of server access logs and Referer headers.
        return Response({'invite_path': '/#invite=' + token, 'expires_at': expires}, status=201)
