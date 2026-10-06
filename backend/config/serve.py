"""Serve the built PWA and Django API from one small WSGI process."""

import os
from pathlib import Path

from whitenoise import WhiteNoise

from .wsgi import application as django_application


default_frontend = Path(__file__).resolve().parents[2] / "frontend/dist/frontend/browser"
frontend_root = Path(os.environ.get("FITNESS_FRONTEND_DIR", default_frontend))

def app_cache_headers(headers, path, url):
    if url in ("/", "/index.html", "/ngsw.json", "/ngsw-worker.js", "/update.html"):
        headers["Cache-Control"] = "no-cache, max-age=0, must-revalidate"


application = WhiteNoise(
    django_application,
    root=str(frontend_root),
    index_file=True,
    mimetypes={".webmanifest": "application/manifest+json"},
    add_headers_function=app_cache_headers,
)
