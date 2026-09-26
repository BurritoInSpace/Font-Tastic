"""Variation axes: which ones a project varies along, and what their values mean.

Every master sits at a *location*: one value per axis, e.g. Bold Condensed at
wght 700, wdth 75. Weight is always an axis (it's also the OpenType weight
class of each static font). Others are added per project, from the registered
OpenType axes or as custom ones.

Values are in the axis's own units (the "user" scale apps show): weight class,
width in percent of normal, optical size in points, slant in degrees
(negative leans right, as OpenType defines it).
"""

from __future__ import annotations

import re

from .errors import ProjectError

# The axes a project can pick from. min/max are the hard limits a value must
# stay inside; default is where existing masters are placed when the axis is
# added (it can be changed then).
PRESETS: dict[str, dict] = {
    "wght": {"name": "Weight", "min": 1, "max": 1000, "default": 400, "unit": "",
             "about": "Stroke thickness, as a weight class (Regular 400, Bold 700)"},
    "wdth": {"name": "Width", "min": 1, "max": 1000, "default": 100, "unit": "%",
             "about": "Narrower or wider, in percent of normal (Condensed 75, Expanded 125)"},
    "opsz": {"name": "Optical size", "min": 1, "max": 1000, "default": 12, "unit": "pt",
             "about": "Tuned for a text size in points: sturdier for captions, finer for display"},
    "slnt": {"name": "Slant", "min": -90, "max": 90, "default": 0, "unit": "°",
             "about": "Lean in degrees; negative leans right, as OpenType counts it"},
    "ital": {"name": "Italic", "min": 0, "max": 1, "default": 0, "unit": "",
             "about": "0 upright, 1 italic (a switch rather than a range)"},
    "GRAD": {"name": "Grade", "min": -1000, "max": 1000, "default": 0, "unit": "",
             "about": "Heavier or lighter without changing widths, so text doesn't reflow"},
}
CUSTOM_LIMIT = 32767
CUSTOM_TAG = re.compile(r"^[A-Z][A-Z0-9]{3}$")  # OpenType: custom axes are uppercase

# usWidthClass for common widths (percent), OpenType's table.
WIDTH_CLASSES = [(50, 1), (62.5, 2), (75, 3), (87.5, 4), (100, 5), (112.5, 6), (125, 7), (150, 8), (200, 9)]
WIDTH_NAMES = {50: "UltraCondensed", 62.5: "ExtraCondensed", 75: "Condensed", 87.5: "SemiCondensed",
               100: "", 112.5: "SemiExpanded", 125: "Expanded", 150: "ExtraExpanded", 200: "UltraExpanded"}

DEFAULT_AXES = [{"tag": "wght", "name": "Weight"}]


def limits(tag: str) -> tuple[float, float]:
    preset = PRESETS.get(tag)
    return (preset["min"], preset["max"]) if preset else (-CUSTOM_LIMIT, CUSTOM_LIMIT)


def check_value(tag: str, name: str, value) -> float:
    """``value`` as a number inside the axis's limits, or a ProjectError."""
    try:
        value = float(value)
    except (TypeError, ValueError):
        raise ProjectError(f"{name} needs a number") from None
    lo, hi = limits(tag)
    if not lo <= value <= hi:
        raise ProjectError(f"{name} must be between {lo:g} and {hi:g}")
    if tag == "wght":
        value = round(value)
    return int(value) if value == int(value) else value


def check_new_axis(tag: str, name: str, existing: list[dict]) -> tuple[str, str]:
    tag, name = tag.strip(), name.strip()
    if tag in PRESETS:
        name = name or PRESETS[tag]["name"]
    elif not CUSTOM_TAG.match(tag):
        raise ProjectError(
            f"{tag!r} isn't an axis tag: use one of {', '.join(PRESETS)}, or four characters starting with "
            "a capital letter (custom axes are uppercase, e.g. SERF)")
    if not name:
        raise ProjectError("Give the axis a name")
    if any(a["tag"] == tag for a in existing):
        raise ProjectError(f"The project already has a {tag} axis")
    if any(a["name"].lower() == name.lower() for a in existing):
        raise ProjectError(f"The project already has an axis called {name}")
    return tag, name


def width_class(percent: float) -> int:
    return min(WIDTH_CLASSES, key=lambda wc: abs(wc[0] - percent))[1]


def apply_to_info(info, location: dict):
    """Set the static font's OS/2 and post fields that follow from its location."""
    if "wght" in location:
        info.openTypeOS2WeightClass = max(1, min(1000, round(location["wght"])))
    if "wdth" in location:
        info.openTypeOS2WidthClass = width_class(location["wdth"])
    if "slnt" in location:
        info.italicAngle = location["slnt"]


def describe(axes: list[dict], location: dict) -> str:
    """e.g. "700, wdth 75" (weight first, bare)."""
    parts = []
    for a in axes:
        value = location.get(a["tag"])
        if value is None:
            continue
        parts.append(f"{value:g}" if a["tag"] == "wght" else f"{a['tag']} {value:g}")
    return ", ".join(parts)
