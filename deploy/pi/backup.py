"""Make an online-consistent SQLite backup without stopping FitnessApp."""

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


db_path = Path(os.environ["FITNESS_DB_PATH"])
if not db_path.exists():
    raise SystemExit(f"Database does not exist: {db_path}")

backup_dir = db_path.parent / "backups"
backup_dir.mkdir(mode=0o700, exist_ok=True)
backup_path = backup_dir / f"fitnessapp-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}.sqlite3"

with sqlite3.connect(db_path) as source, sqlite3.connect(backup_path) as destination:
    source.backup(destination)

backup_path.chmod(0o600)
print(backup_path)
