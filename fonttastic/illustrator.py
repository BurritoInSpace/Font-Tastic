"""Open glyph SVGs in Adobe Illustrator — a plain OS-level launch, no Adobe API.

Illustrator saves back to the same file and the glyph watcher re-imports it,
the same round trip Photoshop uses for linked Smart Objects.

The Illustrator used is, in order: the ``FONTTASTIC_ILLUSTRATOR`` environment
variable (path to Illustrator.exe), else the newest release found under
Program Files (betas only if nothing else is installed). If none is found,
the file opens in whatever app Windows associates with .svg.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

EXE_IN_INSTALL = Path("Support Files") / "Contents" / "Windows" / "Illustrator.exe"


@dataclass(frozen=True)
class Illustrator:
    name: str
    path: Path | None  # None on macOS, where it's launched by app name


def _program_files() -> list[Path]:
    dirs = [os.environ.get(v) for v in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)")]
    return list(dict.fromkeys(Path(d) / "Adobe" for d in dirs if d))


def _rank(install: Path) -> tuple[int, int]:
    """Releases before betas, then the highest version year."""
    year = re.search(r"(\d{4})", install.name)
    return (0 if "beta" in install.name.lower() else 1, int(year.group(1)) if year else 0)


def find_illustrator(search_dirs: list[Path] | None = None) -> Illustrator | None:
    if override := os.environ.get("FONTTASTIC_ILLUSTRATOR"):
        path = Path(override)
        return Illustrator(path.parent.name, path) if path.is_file() else None
    if sys.platform == "darwin":
        apps = sorted(Path("/Applications").glob("Adobe Illustrator*"), key=_rank)
        return Illustrator(apps[-1].name, None) if apps else None
    installs = []
    for base in search_dirs if search_dirs is not None else _program_files():
        for install in base.glob("Adobe Illustrator*"):
            if (install / EXE_IN_INSTALL).is_file():
                installs.append(install)
    if not installs:
        return None
    best = max(installs, key=_rank)
    return Illustrator(best.name, best / EXE_IN_INSTALL)


def open_in_illustrator(svg: Path) -> str:
    """Launch Illustrator (or the default SVG app) on ``svg``. Returns what was used."""
    app = find_illustrator()
    if sys.platform == "darwin":
        cmd = ["open", "-a", app.name, str(svg)] if app else ["open", str(svg)]
        subprocess.Popen(cmd)
        return app.name if app else "the default app"
    if app is not None:
        subprocess.Popen([str(app.path), str(svg)], close_fds=True)
        return app.name
    if sys.platform == "win32":
        os.startfile(svg)  # noqa: S606 — the user's own file, in their default app
        return "the default app for .svg"
    subprocess.Popen(["xdg-open", str(svg)])
    return "the default app"


def reveal_in_file_manager(path: Path):
    if sys.platform == "win32":
        subprocess.Popen(["explorer", f"/select,{path}"])
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path.parent)])
