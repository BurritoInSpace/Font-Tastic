"""Writing systems: which script each glyph belongs to, and what follows from it.

A glyph's script comes from Unicode (fontTools.unicodedata): ``Hebr``,
``Latn``, ``Grek``, ``Cyrl``... Digits, punctuation and the space are
``Zyyy`` (common: shared by every script). Latin-style combining accents
(U+0300 block) are ``Zinh`` (inherited: they take the script of the letter
they sit on), so they're shared by Latin, Greek and Cyrillic.

This drives the OpenType ``languagesystem`` statements, the glyph grid
sections, text direction, and default anchors for scripts other than Hebrew
(whose specifics live in hebrew.py).
"""

from __future__ import annotations

import unicodedata

from fontTools import unicodedata as ucd

from . import hebrew, naming

COMMON, INHERITED = "Zyyy", "Zinh"

# Unicode canonical combining class -> the anchor a mark attaches to.
# https://www.unicode.org/reports/tr44/#Canonical_Combining_Class_Values
_ABOVE = {230, 232, 216, 234}  # above, above right, attached above right (horn), double above
_BELOW = {220, 202, 218, 233}  # below, attached below (cedilla, ogonek), below left, double below


def script_of_codepoint(cp: int | None) -> str | None:
    if cp is None:
        return None
    return ucd.script(chr(cp))


def script_of(name: str) -> str | None:
    """A glyph's script, from its code point, or for alternates and ligatures
    from the letters they're made of (the first that isn't common)."""
    base = name.partition(".")[0]
    parts = [p for p in base.split("_") if p] if "_" in base.strip("_") else [base]
    found = None
    for part in parts:
        script = script_of_codepoint(naming.to_unicode(part))
        if script and script not in (COMMON, INHERITED):
            return script
        found = found or script
    return found


def direction(script: str | None) -> str | None:
    """``rtl`` or ``ltr`` for a real script; None for common/inherited glyphs,
    which take the direction of the text around them."""
    if script is None or script in (COMMON, INHERITED):
        return None
    return "rtl" if ucd.script_horizontal_direction(script, "LTR") == "RTL" else "ltr"


def name_of(script: str) -> str:
    if script == COMMON:
        return "Shared"
    if script == INHERITED:
        return "Accents"
    return ucd.script_name(script, default=script).replace("_", " ")


def present(font) -> list[str]:
    """The real scripts in the font's character map, Hebrew first, then by name."""
    found = set()
    for glyph in font:
        for cp in glyph.unicodes:
            script = script_of_codepoint(cp)
            if script not in (None, COMMON, INHERITED):
                found.add(script)
    return sorted(found, key=lambda s: (s != "Hebr", name_of(s)))


def language_systems(font) -> list[tuple[str, str]]:
    """``languagesystem`` statements: DFLT, then one per script present.
    With no script-specific letters yet, Hebrew (the app's first script)."""
    tags = []
    for script in present(font) or ["Hebr"]:
        for tag in ucd.ot_tags_from_script(script):
            if tag not in tags and tag != "DFLT":
                tags.append(tag)
    return [("DFLT", "dflt")] + [(tag, "dflt") for tag in tags]


# -- default anchors ------------------------------------------------------------


def mark_anchor_class(cp: int | None) -> str | None:
    """The anchor a combining mark attaches to: Hebrew's own classes for
    niqqud, otherwise ``top`` / ``bottom`` from its Unicode combining class."""
    if cp is None:
        return None
    if cp in hebrew.NIQQUD:
        return hebrew.mark_anchor_class(cp)
    ccc = unicodedata.combining(chr(cp))
    if ccc in _ABOVE:
        return "top"
    if ccc in _BELOW:
        return "bottom"
    return None


def _is_alphabetic_letter(cp: int) -> bool:
    return unicodedata.category(chr(cp)).startswith("L") and direction(script_of_codepoint(cp)) == "ltr"


def base_anchors(cp: int | None, width, bounds, info) -> list[tuple[str, int, int]]:
    """Starting anchors for a freshly imported letter (the designer drags them
    into place). Hebrew letters get Hebrew's set; letters of left-to-right
    alphabets (Latin, Greek, Cyrillic) get ``top`` over the letter at x-height
    or cap height, and ``bottom`` on the baseline."""
    if hebrew.is_hebrew_letter(cp):
        return hebrew.default_base_anchors(cp, width, bounds, info.capHeight)
    if cp is None or not _is_alphabetic_letter(cp):
        return []
    x_min, _, x_max, y_max = bounds if bounds else (0, 0, width, info.xHeight)
    cx = round((x_min + x_max) / 2)
    cap, x_height = info.capHeight or 700, info.xHeight or 500
    tall = unicodedata.category(chr(cp)) == "Lu" or y_max > (x_height + cap) / 2
    return [("top", cx, round(cap if tall else x_height)), ("bottom", cx, 0)]


def mark_anchor(cp: int | None, bounds, info, capital: bool = False) -> tuple[str, tuple[int, int]] | None:
    """A combining mark's ``_top`` / ``_bottom`` / ... anchor, assuming it was
    drawn in place over a letter on the baseline: Hebrew marks relative to a
    letter at cap height, other accents relative to a lowercase letter at
    x-height (the usual way accents are drawn), or to a capital for the
    ``.case`` versions."""
    anchor_class = mark_anchor_class(cp)
    if anchor_class is None:
        return None
    if cp in hebrew.NIQQUD:
        pos = hebrew.default_mark_anchor(anchor_class, bounds, info.capHeight)
    elif bounds is None:
        pos = None
    else:
        cx = round((bounds[0] + bounds[2]) / 2)
        top = (info.capHeight or 700) if capital else (info.xHeight or 500)
        pos = (cx, 0) if anchor_class == "bottom" else (cx, round(top))
    return (anchor_class, pos) if pos else None
