"""Compile the project's UFO to a binary font with ufo2ft."""

from __future__ import annotations

import io

import ufo2ft
from ufo2ft import CFFOptimization


class CompileError(Exception):
    pass


def compile_otf(font, preview: bool = True) -> bytes:
    """Compile to CFF-flavoured OpenType.

    ``preview`` skips CFF subroutinization, which is by far the slowest step
    and makes no visible difference; exports use the full optimisation.
    """
    try:
        otf = ufo2ft.compileOTF(
            font,
            useProductionNames=False,
            optimizeCFF=CFFOptimization.NONE if preview else CFFOptimization.SUBROUTINIZE,
        )
    except Exception as exc:
        raise CompileError(f"{type(exc).__name__}: {exc}") from exc
    buf = io.BytesIO()
    otf.save(buf)
    return buf.getvalue()


class CompileCache:
    """Keeps the last preview build so repeated requests are free."""

    def __init__(self):
        self._revision = None
        self._data = None
        self._error = None

    def get(self, project) -> bytes:
        with project.lock:
            if self._revision != project.revision:
                try:
                    self._data, self._error = compile_otf(project.font), None
                except CompileError as exc:
                    self._data, self._error = None, exc
                self._revision = project.revision
            if self._error:
                raise self._error
            return self._data
