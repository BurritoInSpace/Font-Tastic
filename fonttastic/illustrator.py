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
from contextlib import contextmanager
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


@contextmanager
def _outside_bundle():
    """Yields the environment to start another program with.

    In the packaged app, PyInstaller points the DLL search path (and PATH) at
    the app's bundled runtime. Programs started from it would inherit that and
    load the app's copies of DLLs such as MSVCP140.dll, which also locks them
    while those programs run. Clear both for the launch.
    """
    bundle = getattr(sys, "_MEIPASS", None)
    if not bundle or sys.platform != "win32":
        yield None
        return
    import ctypes

    inside = os.path.normcase(os.path.abspath(bundle))
    env = dict(os.environ)
    env["PATH"] = os.pathsep.join(
        p for p in env.get("PATH", "").split(os.pathsep)
        if p and not os.path.normcase(os.path.abspath(p)).startswith(inside)
    )
    kernel32 = ctypes.windll.kernel32
    kernel32.SetDllDirectoryW(None)
    try:
        yield env
    finally:
        kernel32.SetDllDirectoryW(bundle)


def open_in_illustrator(svg: Path) -> str:
    """Launch Illustrator (or the default SVG app) on ``svg``. Returns what was used."""
    app = find_illustrator()
    with _outside_bundle() as env:
        return _launch(app, svg, env)


def _launch(app: Illustrator | None, svg: Path, env) -> str:
    if sys.platform == "darwin":
        cmd = ["open", "-a", app.name, str(svg)] if app else ["open", str(svg)]
        subprocess.Popen(cmd)
        return app.name if app else "the default app"
    if app is not None:
        # From the home folder: its helper processes (crash reporter etc.) inherit
        # the working folder and can outlive it, keeping it locked.
        subprocess.Popen([str(app.path), str(svg)], close_fds=True, env=env, cwd=Path.home())
        return app.name
    if sys.platform == "win32":
        os.startfile(svg)  # noqa: S606 — the user's own file, in their default app
        return "the default app for .svg"
    subprocess.Popen(["xdg-open", str(svg)])
    return "the default app"


def reveal_command(path: Path) -> str:
    """The Windows command line that opens Explorer with ``path`` selected."""
    return f'explorer /select,"{Path(path).resolve()}"'


def reveal_in_file_manager(path: Path):
    if sys.platform == "win32":
        # Explorer wants /select,"C:\path" with the quotes around the path only; passed
        # as a list item, Python would quote the whole argument and Explorer
        # would ignore it (just opening a window on its default folder).
        with _outside_bundle() as env:
            subprocess.Popen(reveal_command(path), env=env)
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path.parent)])
