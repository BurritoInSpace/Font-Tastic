"""Checks that a project's weights can interpolate into a variable font.

Weights interpolate point by point, so every glyph needs the same structure in
every weight: same contours, same number of segments per contour, the same
kind of segment (straight or curved) in the same place, the same starting
point and direction, and the same anchors. fontTools' ``varLib.interpolatable``
does the geometric checks (it also notices contours in a different order and
shapes that kink or thin out midway); missing glyphs and anchors are checked
here. Problems are reported in the designer's terms, with contours numbered
from 1.
"""

from __future__ import annotations

from fontTools.varLib import interpolatable

# How serious each kind of problem is:
#   error    - the variable font can't be built (or would be broken)
#   fixable  - breaks interpolation, but the app can re-sequence it without redrawing
#   warning  - builds, but the in-between weights may look off
SEVERITY = {
    "missing": "error",
    "open_path": "error",
    "path_count": "error",
    "node_count": "error",
    "node_incompatibility": "error",
    "anchors": "error",
    "contour_order": "fixable",
    "wrong_start_point": "fixable",
    "kink": "warning",
    "underweight": "warning",
    "overweight": "warning",
}


class _GlyphSet:
    """interpolatable wants ``glyphset[name]`` to be None for a missing glyph."""

    def __init__(self, font):
        self.font = font

    def __getitem__(self, name):
        return self.font.get(name)

    def keys(self):
        return self.font.keys()


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _describe(p: dict) -> str:
    kind = p["type"]
    m1, m2 = p.get("master_1"), p.get("master_2")
    contour = p.get("contour", p.get("path"))
    c = f"Contour {contour + 1}" if isinstance(contour, int) else "A contour"
    if kind == "open_path":
        return f"{c} is open in {p['master']}; close it in Illustrator"
    if kind == "path_count":
        return f"{m1} has {_plural(p['value_1'], 'contour')}, {m2} has {p['value_2']}"
    if kind == "node_count":
        diff = p["value_2"] - p["value_1"]
        more = f"{_plural(abs(diff), 'more segment')}" if diff > 0 else f"{_plural(abs(diff), 'fewer segment')}"
        return f"{c} has {more} in {m2} than in {m1}: add or remove a point in Illustrator"
    if kind == "node_incompatibility":
        shape = {"lineTo": "straight", "curveTo": "curved", "qCurveTo": "curved", "moveTo": "a start"}
        a, b = shape.get(p["value_1"], p["value_1"]), shape.get(p["value_2"], p["value_2"])
        return f"{c}, segment {p['node'] + 1}: {a} in {m1} but {b} in {m2}"
    if kind == "contour_order":
        return f"The contours are in a different order in {m2} than in {m1}"
    if kind == "wrong_start_point":
        extra = " and runs the other way" if p.get("reversed") else ""
        return f"{c} starts at a different point in {m2} than in {m1}{extra}"
    if kind == "kink":
        return f"{c} gets a kink between {m1} and {m2}"
    if kind == "underweight":
        return f"{c} gets thinner than expected between {m1} and {m2}"
    if kind == "overweight":
        return f"{c} gets heavier than expected between {m1} and {m2}"
    return f"{kind} between {m1} and {m2}"


def check(weights: list[tuple[str, object]]) -> dict:
    """``weights``: (name, font) pairs, lightest first. Returns
    ``{"glyphs": {glyph: [problem, ...]}, "errors": n, "fixable": n, "warnings": n}``
    where each problem has ``type``, ``severity``, ``message`` and the raw details."""
    report: dict[str, list[dict]] = {}

    def add(glyph, problem):
        problem["severity"] = SEVERITY.get(problem["type"], "warning")
        problem["message"] = problem.get("message") or _describe(problem)
        report.setdefault(glyph, []).append(problem)

    if len(weights) < 2:
        return {"glyphs": {}, "errors": 0, "fixable": 0, "warnings": 0}

    names = [n for n, _ in weights]
    fonts = [f for _, f in weights]
    everything = sorted({g for f in fonts for g in f.keys()} - {".notdef"})
    complete = []
    for glyph in everything:
        missing = [n for n, f in weights if glyph not in f]
        if missing:
            add(glyph, {"type": "missing", "weights": missing,
                        "message": f"Missing in {', '.join(missing)}: import its SVG there too"})
            continue
        complete.append(glyph)
        anchor_sets = [sorted(a.name for a in f[glyph].anchors) for f in fonts]
        for name, anchors in zip(names[1:], anchor_sets[1:]):
            if anchors != anchor_sets[0]:
                gone = set(anchor_sets[0]) - set(anchors)
                extra = set(anchors) - set(anchor_sets[0])
                detail = "; ".join(filter(None, [
                    f"missing {', '.join(sorted(gone))}" if gone else "",
                    f"extra {', '.join(sorted(extra))}" if extra else "",
                ]))
                add(glyph, {"type": "anchors", "master_1": names[0], "master_2": name,
                            "message": f"Anchors differ in {name} from {names[0]} ({detail})"})

    problems = interpolatable.test([_GlyphSet(f) for f in fonts], glyphs=complete, names=names)
    for glyph, found in problems.items():
        for p in found:
            add(glyph, dict(p))

    counts = {"errors": 0, "fixable": 0, "warnings": 0}
    for found in report.values():
        for p in found:
            counts[{"error": "errors", "fixable": "fixable", "warning": "warnings"}[p["severity"]]] += 1
    return {"glyphs": report, **counts}
