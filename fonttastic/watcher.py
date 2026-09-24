"""Watch a project's glyphs/ folder and re-import SVGs when they change on disk.

Saving in Illustrator is the main trigger, but anything counts: files added,
edited or deleted by any program. Re-import is mtime-based, so a burst of
events (Illustrator often writes a file more than once per save) costs one
parse of the file that actually changed.
"""

from __future__ import annotations

import sys
import threading
import time
import traceback
from pathlib import Path

from watchfiles import watch

SETTLE_SECONDS = 0.3  # let the saving app finish writing before reading


def _is_svg(_change, path: str) -> bool:
    return path.lower().endswith(".svg")


class GlyphWatcher:
    def __init__(self, project, on_change=None):
        self.project = project
        self.on_change = on_change  # called with the import report when something was imported
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="glyph-watcher", daemon=True)
        self.last_report: dict | None = None

    def start(self):
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()

    @property
    def running(self) -> bool:
        return self._thread.is_alive() and not self._stop.is_set()

    def _run(self):
        folder = Path(self.project.glyphs_dir)
        try:
            for _changes in watch(folder, watch_filter=_is_svg, stop_event=self._stop,
                                  debounce=800, step=100, recursive=False, raise_interrupt=False):
                time.sleep(SETTLE_SECONDS)
                if self._stop.is_set():
                    return
                self._import()
        except Exception:  # never take the app down; the Re-import button still works
            traceback.print_exc(file=sys.stderr)

    def _import(self):
        report = self.project.import_all()
        if report["imported"] or report["errors"] or report["missingSource"]:
            self.last_report = {**report, "revision": self.project.revision, "at": time.time()}
            if self.on_change:
                self.on_change(self.last_report)
