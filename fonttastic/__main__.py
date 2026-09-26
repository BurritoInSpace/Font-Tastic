"""Launch Font-tastic.

    python -m fonttastic [PROJECT]            desktop window
    python -m fonttastic [PROJECT] --browser  serve and open in a browser tab
    python -m fonttastic [PROJECT] --dev      window on the Vite dev server (hot reload)

PROJECT is a .fonttastic file or the folder holding one. Without it, the last
project is reopened (--home starts on the home screen instead).
"""

from __future__ import annotations

import argparse
import socket
import sys
import threading
import time
import webbrowser

import uvicorn

from . import recent
from .project import NeedsConversion, Project, ProjectError
from .server import FRONTEND_DIST, create_app

DEV_API_PORT = 8765  # must match frontend/vite.config.ts
DEV_UI_URL = "http://localhost:5173"


class Bridge:
    """Native helpers exposed to the UI as ``window.pywebview.api``."""

    def pick_folder(self):
        import webview

        result = webview.windows[0].create_file_dialog(webview.FileDialog.FOLDER)
        return result[0] if result else None

    def pick_project_file(self):
        import webview

        result = webview.windows[0].create_file_dialog(
            # pywebview only allows letters, digits and spaces in the description
            webview.FileDialog.OPEN, file_types=("Fonttastic project (*.fonttastic)", "All files (*.*)")
        )
        return result[0] if result else None


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(port: int, timeout: float = 10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.05)
    raise RuntimeError(f"Server did not start on port {port}")


def frozen() -> bool:
    """True when running as the packaged Font-tastic.exe."""
    return getattr(sys, "frozen", False)


def _log_to_file_without_console():
    """The windowed .exe has no console (sys.stderr is None), which would crash
    anything that logs. Send output to a log file next to the recent list."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    log_dir = recent.config_dir()
    log_dir.mkdir(parents=True, exist_ok=True)
    log = open(log_dir / "fonttastic.log", "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stdout or log
    sys.stderr = sys.stderr or log


def main(argv=None):
    _log_to_file_without_console()
    parser = argparse.ArgumentParser(prog="fonttastic", description=__doc__.splitlines()[0])
    parser.add_argument("project", nargs="?", help="a .fonttastic file, or the folder holding one")
    parser.add_argument("--home", action="store_true", help="start on the home screen, don't reopen the last project")
    parser.add_argument("--convert", action="store_true",
                        help="add a project file to a folder in the old glyphs/ + font.ufo/ layout")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--browser", action="store_true", help="open in the default browser instead of a window")
    mode.add_argument("--dev", action="store_true", help="use the Vite dev server for the UI")
    parser.add_argument("--port", type=int, help="API port (default: random, or 8765 with --dev)")
    args = parser.parse_args(argv)

    project = None
    target = args.project or (None if args.home else recent.last_existing())
    if target:
        try:
            project = Project.convert(target) if args.convert else Project(target)
        except NeedsConversion as exc:
            if not frozen():
                parser.exit(1, f"{exc}\nRun again with --convert to add a project file.\n")
            print(exc, file=sys.stderr)  # the home screen offers the conversion
        except ProjectError as exc:
            if args.project and not frozen():
                parser.exit(1, f"{exc}\n")
            print(exc, file=sys.stderr)  # start on the home screen instead
        if project is not None:
            recent.touch(project.file, project.name)
            project.import_all()

    port = args.port or (DEV_API_PORT if args.dev else free_port())
    if not args.dev and not FRONTEND_DIST.is_dir():
        parser.exit(1, "UI not built. Run `npm run build` in frontend/, or use --dev.\n")

    server = uvicorn.Server(uvicorn.Config(create_app(project), host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    wait_for(port)

    url = DEV_UI_URL if args.dev else f"http://127.0.0.1:{port}"
    if args.browser:
        print(f"Font-tastic running at {url} — Ctrl+C to stop")
        webbrowser.open(url)
        try:
            thread.join()
        except KeyboardInterrupt:
            server.should_exit = True
        return

    import webview

    webview.create_window("Font-tastic", url, js_api=Bridge(), width=1400, height=900, min_size=(900, 600))
    webview.start(debug=args.dev)
    server.should_exit = True


if __name__ == "__main__":
    main()
