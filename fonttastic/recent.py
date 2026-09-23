"""Recently opened projects, kept per user (not per project).

Stored in ``%APPDATA%\\Font-tastic\\recent.json`` (``~/.config/Font-tastic`` elsewhere);
``FONTTASTIC_CONFIG_DIR`` overrides the location, which the tests use.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

MAX_RECENT = 12


def config_dir() -> Path:
    if override := os.environ.get("FONTTASTIC_CONFIG_DIR"):
        return Path(override)
    base = os.environ.get("APPDATA") or Path.home() / ".config"
    return Path(base) / "Font-tastic"


def _path() -> Path:
    return config_dir() / "recent.json"


def _read() -> list[dict]:
    try:
        data = json.loads(_path().read_text(encoding="utf-8"))
        return [e for e in data if isinstance(e, dict) and "path" in e]
    except (OSError, ValueError):
        return []


def _write(entries: list[dict]):
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8")


def load() -> list[dict]:
    """Recent projects, newest first; ``exists`` is False for moved/deleted ones."""
    return [{**e, "exists": Path(e["path"]).is_file()} for e in _read()]


def touch(project_file: Path, name: str):
    entries = [e for e in _read() if Path(e["path"]) != project_file]
    entries.insert(0, {"path": str(project_file), "name": name, "opened": datetime.now().isoformat(timespec="seconds")})
    _write(entries[:MAX_RECENT])


def remove(project_file: str):
    _write([e for e in _read() if Path(e["path"]) != Path(project_file)])


def last_existing() -> Path | None:
    for e in load():
        if e["exists"]:
            return Path(e["path"])
    return None
