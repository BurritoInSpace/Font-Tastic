"""Glyph file naming: ``uni05D0.svg`` -> glyph ``uni05D0`` at U+05D0.

Conventions (extending the old FontForge batch-import pipeline):

- ``uni05D0.svg`` / ``u1F600.svg`` / AGL names (``space.svg``) -> encoded glyph
- ``uni05D0.salt.svg``, ``uni05D0.ss01.svg`` -> unencoded alternate of
  ``uni05D0``; the suffix is the OpenType feature that substitutes it in.
  Further alternates in the same feature get a number: ``uni05D0.salt.2``
- ``uni05D0.alt2.svg`` -> unencoded alternate with no automatic feature
- ``uni05D0_uni05DC.svg`` -> ligature glyph (components joined by ``_``)
- ``uni05D0-Bold.svg`` -> reserved for variable-font masters (Phase 2);
  the ``-Master`` part is split off and ignored for now
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from fontTools import agl

from . import hebrew

ALTERNATE_SUFFIX = re.compile(r"^(salt|ss(?:0[1-9]|1\d|20))(?:\.\d+)?$")
LIGATURE_FEATURES = re.compile(r"^(liga|dlig|ss(?:0[1-9]|1\d|20))$")


@dataclass(frozen=True)
class GlyphFileName:
    glyph_name: str
    master: str | None
    unicode: int | None
    base_name: str  # name with any suffix removed
    suffix: str | None  # "salt", "ss01", "alt2", ...
    components: tuple[str, ...]  # ligature components, empty if not a ligature

    @property
    def alternate_feature(self) -> str | None:
        """Feature that should substitute base -> this glyph, if any."""
        if self.suffix and not self.components:
            m = ALTERNATE_SUFFIX.match(self.suffix)
            if m:
                return m.group(1)
        return None


def parse_filename(stem: str) -> GlyphFileName:
    master = None
    if "-" in stem and not stem.startswith("-"):
        stem, master = stem.split("-", 1)

    if stem.startswith("."):  # .notdef, .null
        base, suffix = stem, None
    else:
        base, _, suffix = stem.partition(".")
        suffix = suffix or None
    components = tuple(base.split("_")) if "_" in base.strip("_") else ()

    unicode = None
    if suffix is None and not components:
        unicode = to_unicode(base)
    return GlyphFileName(stem, master, unicode, base, suffix, components)


def canonical_name(cp: int) -> str:
    return f"uni{cp:04X}" if cp <= 0xFFFF else f"u{cp:05X}"


_CODEPOINT = re.compile(r"^(?:u\+?|uni)?([0-9a-f]{4,6})$", re.I)


def token_to_unicode(token: str) -> int | None:
    """Loose lookup for user-chosen file names: ``א``, ``U+05D0``, ``05D0``,
    ``uni05D0``, ``alef``, ``kafsofit``, ``kamatz``..."""
    if len(token) == 1:
        return ord(token)
    m = _CODEPOINT.match(token)
    if m and any(c.isdigit() for c in m.group(1)):
        cp = int(m.group(1), 16)
        return cp if cp <= 0x10FFFF else None
    key = re.sub(r"[\s\-]", "", token.lower())
    if key in hebrew.ALIASES:
        return hebrew.ALIASES[key]
    return to_unicode(token) or to_unicode(key)


@dataclass(frozen=True)
class Recognized:
    glyph_name: str
    unicode: int | None


def recognize(stem: str, cmap: dict[int, str], existing: set[str]) -> Recognized | None:
    """Work out which glyph an imported file is, or ``None`` if the name says
    nothing we understand. Names are canonicalised (``alef.salt`` ->
    ``uni05D0.salt``), preferring a glyph the font already has for a code point."""

    def name_for(token: str) -> tuple[str, int] | None:
        cp = token_to_unicode(token)
        if cp is None:
            return None
        return cmap.get(cp, canonical_name(cp)), cp

    if stem in existing:
        return Recognized(stem, next((cp for cp, n in cmap.items() if n == stem), None))

    if "." not in stem and "_" not in stem:  # AGL would silently drop a suffix
        whole = name_for(stem)
        return Recognized(*whole) if whole else None

    base, _, suffix = stem.partition(".")
    parts = base.split("_")
    names = [name_for(p) for p in parts]
    if not all(names):
        return None
    joined = "_".join(n for n, _ in names)
    if len(parts) > 1:
        return Recognized(f"{joined}.{suffix}" if suffix else f"{joined}.liga", None)
    if suffix:
        return Recognized(f"{joined}.{suffix}", None)
    return Recognized(joined, names[0][1])


def to_unicode(name: str) -> int | None:
    text = agl.toUnicode(name)
    if len(text) == 1:
        return ord(text)
    return None


def unicode_of_base(name: str) -> int | None:
    """Codepoint of a glyph's base name (``uni05D0.salt`` -> 0x05D0)."""
    base = name.partition(".")[0]
    if "_" in base.strip("_"):
        return None
    return to_unicode(base)


def category_for(parsed: GlyphFileName) -> str:
    """OpenType glyph class: ``base``, ``mark`` or ``ligature``."""
    if parsed.components:
        return "ligature"
    cp = parsed.unicode if parsed.unicode is not None else unicode_of_base(parsed.base_name)
    if cp is not None and unicodedata.category(chr(cp)) == "Mn":
        return "mark"
    return "base"


def display_char(name: str) -> str:
    cp = unicode_of_base(name)
    if cp is None:
        return ""
    if cp in hebrew.NIQQUD:
        return "◌" + chr(cp)  # dotted circle carrier so marks are visible
    return chr(cp)
