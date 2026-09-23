"""Hebrew-specific typographic knowledge: niqqud marks, anchor classes, defaults.

Anchor naming follows ufo2ft's markFeatureWriter convention:
base anchor ``top`` pairs with mark anchor ``_top`` (mark-to-base), and
``topmkmk`` / ``_topmkmk`` pairs marks on marks (mark-to-mark).
"""

from __future__ import annotations

# Core niqqud (no cantillation — see brief's non-goals).
# codepoint -> (short name, anchor class the mark attaches to)
NIQQUD: dict[int, tuple[str, str]] = {
    0x05B0: ("sheva", "bottom"),
    0x05B1: ("hataf segol", "bottom"),
    0x05B2: ("hataf patah", "bottom"),
    0x05B3: ("hataf qamats", "bottom"),
    0x05B4: ("hiriq", "bottom"),
    0x05B5: ("tsere", "bottom"),
    0x05B6: ("segol", "bottom"),
    0x05B7: ("patah", "bottom"),
    0x05B8: ("qamats", "bottom"),
    0x05B9: ("holam", "top"),
    0x05BA: ("holam haser for vav", "top"),
    0x05BB: ("qubuts", "bottom"),
    0x05BC: ("dagesh", "dagesh"),
    0x05BD: ("meteg", "bottom"),
    0x05BF: ("rafe", "top"),
    0x05C1: ("shin dot", "shindot"),
    0x05C2: ("sin dot", "sindot"),
    0x05C7: ("qamats qatan", "bottom"),
}

ANCHOR_CLASSES = ("top", "bottom", "dagesh", "shindot", "sindot")

LETTERS = range(0x05D0, 0x05EB)  # alef .. tav, including sofit forms
SHIN = 0x05E9

# Final (sofit) forms have their own codepoints, so they map to Unicode slots
# directly; this table exists so the UI can group them (e.g. for kerning).
SOFIT = {
    0x05DA: 0x05DB,  # final kaf -> kaf
    0x05DD: 0x05DE,  # final mem -> mem
    0x05DF: 0x05E0,  # final nun -> nun
    0x05E3: 0x05E4,  # final pe -> pe
    0x05E5: 0x05E6,  # final tsadi -> tsadi
}


# Common spellings that fontTools' AGL doesn't know (it already has alef, bet,
# finalkaf, patah, dagesh, ...). Keys are lowercase with separators removed.
_LETTER_ALIASES = {
    0x05D1: ["beth", "vet"], 0x05D2: ["gimmel"], 0x05D3: ["daled"], 0x05D4: ["hey", "heh"],
    0x05D5: ["waw"], 0x05D6: ["zain"], 0x05D7: ["chet", "cheth", "heth", "khet"], 0x05D8: ["teth"],
    0x05D9: ["yud", "jod"], 0x05DB: ["khaf", "chaf", "kaph"], 0x05E1: ["samech", "samekh"],
    0x05E4: ["peh", "fe", "feh"], 0x05E6: ["tsade", "tzadi", "tzade", "sadi", "tsadik", "tzadik"],
    0x05E7: ["kuf", "qoph", "kof"], 0x05EA: ["taw", "taf", "sav"],
}
_BASE_NAMES = {
    0x05DB: ["kaf", "khaf", "chaf", "kaph"], 0x05DE: ["mem"], 0x05E0: ["nun"],
    0x05E4: ["pe", "peh", "fe", "feh"], 0x05E6: ["tsadi", "tsade", "tzadi", "tzade", "sadi", "tsadik", "tzadik"],
}
_FINAL_OF = {base: final for final, base in SOFIT.items()}
_MARK_ALIASES = {
    0x05B0: ["shva", "shewa"], 0x05B1: ["chatafsegol", "hatafsegol"], 0x05B2: ["chatafpatach", "hatafpatach"],
    0x05B3: ["chatafkamatz", "hatafkamatz"], 0x05B4: ["hirik", "chirik", "hiriq"], 0x05B5: ["tzere", "tsere"],
    0x05B7: ["patach", "patah"], 0x05B8: ["kamatz", "qamats", "qamatz"], 0x05B9: ["cholam", "holam"],
    0x05BB: ["kubutz", "qubuts", "kubbutz"], 0x05BC: ["dagesh", "mapiq", "shuruk"], 0x05C1: ["shindot"],
    0x05C2: ["sindot"], 0x05C7: ["kamatzkatan", "qamatsqatan"],
}


def _build_aliases():
    table = {}
    for mapping in (_LETTER_ALIASES, _MARK_ALIASES):
        for cp, names in mapping.items():
            for n in names:
                table[n] = cp
    for cp, (name, _) in NIQQUD.items():
        table[name.replace(" ", "")] = cp
    for base, names in _BASE_NAMES.items():
        final = _FINAL_OF[base]
        for n in names:
            for form in (f"final{n}", f"{n}sofit", f"{n}final"):
                table[form] = final
    return table


ALIASES = _build_aliases()


def is_hebrew_letter(cp: int | None) -> bool:
    return cp is not None and cp in LETTERS


def mark_anchor_class(cp: int | None) -> str | None:
    if cp is None or cp not in NIQQUD:
        return None
    return NIQQUD[cp][1]


def default_base_anchors(cp, width, bounds, cap_height):
    """Starting anchor positions for a freshly imported Hebrew letter.

    These are only a seed — the designer drags them into place in-app.
    """
    if bounds is None:
        x_min, y_min, x_max, y_max = 0, 0, width, cap_height
    else:
        x_min, y_min, x_max, y_max = bounds
    cx = round((x_min + x_max) / 2)
    anchors = [
        ("bottom", cx, 0),
        ("top", cx, round(cap_height)),
        ("dagesh", cx, round((y_min + y_max) / 2)),
    ]
    if cp == SHIN:
        anchors += [
            ("shindot", round(x_max), round(cap_height)),
            ("sindot", round(x_min), round(cap_height)),
        ]
    return anchors


def default_mark_anchor(anchor_class, bounds, cap_height):
    """Where a mark's ``_<class>`` anchor starts, assuming the designer drew
    the mark in position relative to a letter sitting on the baseline."""
    if bounds is None:
        return None
    x_min, y_min, x_max, y_max = bounds
    cx = round((x_min + x_max) / 2)
    if anchor_class == "bottom":
        return (cx, 0)
    if anchor_class == "dagesh":
        return (cx, round((y_min + y_max) / 2))
    return (cx, round(cap_height))  # top, shindot, sindot
