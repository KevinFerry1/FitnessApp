"""Serve the built PWA and Django API from one small WSGI process."""

import os
from pathlib import Path

from whitenoise import WhiteNoise

from .wsgi import application as django_application


default_frontend = Path(__file__).resolve().parents[2] / "frontend/dist/frontend/browser"
frontend_root = Path(os.environ.get("FITNESS_FRONTEND_DIR", default_frontend))

application = WhiteNoise(
    django_application,
    root=str(frontend_root),
    index_file=True,
    mimetypes={".webmanifest": "application/manifest+json"},
)
