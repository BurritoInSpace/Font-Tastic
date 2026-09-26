"""Watch a project's SVG folders (one per weight) and re-import SVGs when they change on disk.

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
        # Every weight's folder is watched, not just the one being edited: a
        # weight's SVGs can be saved in Illustrator while another is on screen.
        # The set of folders changes when weights are added or removed, so it's
        # re-read on every quiet tick and the watch restarts when it moved.
        try:
            while not self._stop.is_set():
                folders = self.project.watch_dirs()
                existing = [f for f in folders if f.is_dir()]
                if not existing:
                    self._stop.wait(1)
                    continue
                for changes in watch(*existing, watch_filter=_is_svg, stop_event=self._stop, debounce=800,
                                     step=100, recursive=False, raise_interrupt=False,
                                     yield_on_timeout=True, rust_timeout=1000):
                    if self._stop.is_set():
                        return
                    if changes:
                        time.sleep(SETTLE_SECONDS)
                        changed = {folders.get(Path(p).parent.resolve()) for _, p in changes}
                        self._import(sorted(n for n in changed if n))
                    if self.project.watch_dirs() != folders:
                        break  # weights were added, removed or moved: watch the new set
        except Exception:  # never take the app down; the Re-import button still works
            traceback.print_exc(file=sys.stderr)

    def _import(self, weights: list[str] | None = None):
        report = self.project.import_weights(weights)
        if report["imported"] or report["errors"] or report["missingSource"]:
            self.last_report = {**report, "revision": self.project.revision, "at": time.time()}
            if self.on_change:
                self.on_change(self.last_report)
