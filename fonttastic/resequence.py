"""Point order fixes for interpolation: contour order, direction and start points.

Masters drawn separately in Illustrator often have the same points in a
different order: contours listed differently, or a contour starting at
another corner. Interpolation pairs points by position in the list, so those
glyphs twist or collapse in between. Nothing about the drawing is wrong, so
the fix lives here rather than in the SVG.

A fix is stored as a *recipe* in the glyph's lib: for each contour of the
result, which contour of the SVG as drawn it comes from, whether it's
reversed and which point it starts at. It's applied every time the SVG is
imported, so the SVG can keep being edited in Illustrator. The recipe also
records the drawing's structure (the kind of each point); when a redrawing
changes that, the recipe no longer fits and is dropped.

Contours are lists of ``(x, y, segmentType, smooth)`` as a point pen sees
them: ``segmentType`` is ``None`` for off-curve points.
"""

from __future__ import annotations

import itertools
import math

from fontTools.pens.pointPen import AbstractPointPen

Contour = list[tuple]

INFINITE = 1e9
BRUTE_FORCE_UP_TO = 7  # contours; 7! orderings is still quick


class ResequenceError(ValueError):
    pass


class _Collector(AbstractPointPen):
    def __init__(self):
        self.contours: list[Contour] = []

    def beginPath(self, identifier=None, **kwargs):
        self.contours.append([])

    def addPoint(self, pt, segmentType=None, smooth=False, name=None, identifier=None, **kwargs):
        self.contours[-1].append((pt[0], pt[1], segmentType, bool(smooth)))

    def endPath(self):
        pass

    def addComponent(self, glyphName, transformation, identifier=None, **kwargs):
        pass


def collect(draw_points) -> list[Contour]:
    """Contours from anything with a ``drawPoints``-style method, passed as that method."""
    pen = _Collector()
    draw_points(pen)
    return pen.contours


def glyph_contours(glyph) -> list[Contour]:
    return collect(glyph.drawPoints)


def write_contours(glyph, contours: list[Contour]):
    glyph.clearContours()
    pen = glyph.getPointPen()
    for contour in contours:
        pen.beginPath()
        for x, y, kind, smooth in contour:
            pen.addPoint((x, y), segmentType=kind, smooth=smooth)
        pen.endPath()


# -- contour operations -------------------------------------------------------

_CODES = {None: "o", "line": "l", "curve": "c", "qcurve": "q", "move": "m"}


def pattern(contour: Contour) -> str:
    """The contour's structure: one letter per point kind."""
    return "".join(_CODES.get(p[2], "?") for p in contour)


def is_closed(contour: Contour) -> bool:
    return not contour or contour[0][2] != "move"


def on_curve(contour: Contour) -> list[int]:
    return [i for i, p in enumerate(contour) if p[2] is not None]


def rotate(contour: Contour, start: int) -> Contour:
    return contour[start:] + contour[:start]


def reverse(contour: Contour) -> Contour:
    """The contour drawn the other way round, still starting at point 0.
    Point ``i`` moves to ``(n - i) % n``. Each on-curve point takes the segment
    type of the on-curve point after it, since that segment now ends at it."""
    on = on_curve(contour)
    if not is_closed(contour) or not on:
        return list(contour)
    after = {on[k]: on[(k + 1) % len(on)] for k in range(len(on))}
    n = len(contour)
    out = []
    for j in range(n):
        i = (n - j) % n
        x, y, kind, smooth = contour[i]
        if kind is not None:
            kind = contour[after[i]][2]
        out.append((x, y, kind, smooth))
    return out


def signed_area(contour: Contour) -> float:
    """Shoelace area over all points (off-curves included, which is plenty to
    tell the direction): positive is counter-clockwise."""
    total = 0.0
    for (x0, y0, *_), (x1, y1, *_) in zip(contour, contour[1:] + contour[:1]):
        total += x0 * y1 - x1 * y0
    return total / 2


# -- recipes ------------------------------------------------------------------


def identity(raw: list[Contour]) -> dict:
    return {
        "signature": [pattern(c) for c in raw],
        "contours": [{"source": i, "reverse": False, "start": 0} for i in range(len(raw))],
    }


def is_identity(recipe: dict) -> bool:
    return all(
        e["source"] == i and not e["reverse"] and e["start"] == 0 for i, e in enumerate(recipe["contours"])
    )


def fits(raw: list[Contour], recipe: dict | None) -> bool:
    """Whether ``recipe`` was made for a drawing with this structure."""
    if not recipe or recipe.get("signature") != [pattern(c) for c in raw]:
        return False
    entries = recipe.get("contours", [])
    if sorted(e.get("source") for e in entries) != list(range(len(raw))):
        return False
    for e in entries:
        contour = raw[e["source"]]
        if not is_closed(contour) and (e["reverse"] or e["start"]):
            return False
        points = reverse(contour) if e["reverse"] else contour
        if e["start"] and e["start"] not in on_curve(points):
            return False
    return True


def apply(raw: list[Contour], recipe: dict) -> list[Contour] | None:
    """The contours after the recipe, or None when it doesn't fit ``raw``."""
    if not fits(raw, recipe):
        return None
    out = []
    for e in recipe["contours"]:
        contour = raw[e["source"]]
        if e["reverse"]:
            contour = reverse(contour)
        out.append(rotate(contour, e["start"]))
    return out


def edit(raw: list[Contour], recipe: dict | None, op: str, contour: int, value: int = 0) -> dict:
    """A manual change, in terms of the contours as currently shown:

    - ``start``: point ``value`` of contour ``contour`` becomes its first point
    - ``move``: contour ``contour`` moves to position ``value``
    - ``reverse``: contour ``contour`` changes direction, keeping its first point
    """
    recipe = recipe if fits(raw, recipe) else identity(raw)
    entries = [dict(e) for e in recipe["contours"]]
    if not 0 <= contour < len(entries):
        raise ResequenceError(f"There is no contour {contour + 1}")
    e = entries[contour]
    source = raw[e["source"]]
    n = len(source)
    if op == "start":
        current = apply(raw, {**recipe, "contours": entries})[contour]
        if not is_closed(source):
            raise ResequenceError("An open path always starts at its first point")
        if not 0 <= value < n or current[value][2] is None:
            raise ResequenceError("Only an on-curve point can be the start point")
        e["start"] = (e["start"] + value) % n
    elif op == "move":
        if not 0 <= value < len(entries):
            raise ResequenceError(f"There is no position {value + 1}")
        entries.insert(value, entries.pop(contour))
    elif op == "reverse":
        if not is_closed(source):
            raise ResequenceError("Open paths can't be reversed here")
        e["reverse"] = not e["reverse"]
        e["start"] = (n - e["start"]) % n
    else:
        raise ResequenceError(f"Unknown change {op!r}")
    return {"signature": recipe["signature"], "contours": entries}


# -- matching another master --------------------------------------------------


def _bounds(contours: list[Contour]):
    xs = [p[0] for c in contours for p in c] or [0]
    ys = [p[1] for c in contours for p in c] or [0]
    return min(xs), min(ys), max(max(xs) - min(xs), 1), max(max(ys) - min(ys), 1)


def _normalised(points: Contour, box) -> list[tuple[float, float]]:
    x0, y0, w, h = box
    return [((p[0] - x0) / w, (p[1] - y0) / h) for p in points]


def _centre(points) -> tuple[float, float]:
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


def _candidates(target: Contour, contour: Contour) -> tuple[bool, list[int]]:
    """Whether ``contour`` must be reversed to run the same way as ``target``,
    and the start points that give it the same structure."""
    if len(target) != len(contour):
        return False, []
    if not is_closed(target) or not is_closed(contour):
        return False, [0] if pattern(target) == pattern(contour) else []
    flip = (signed_area(target) > 0) != (signed_area(contour) > 0)
    points = reverse(contour) if flip else contour
    want = pattern(target)
    return flip, [s for s in on_curve(points) if pattern(rotate(points, s)) == want]


def _assign(costs: list[list[float]]) -> list[int]:
    """For each row, a distinct column, keeping the total cost low (exact for
    a handful of contours, greedy beyond that)."""
    n = len(costs)
    if n <= BRUTE_FORCE_UP_TO:
        best = min(itertools.permutations(range(n)), key=lambda p: sum(costs[i][p[i]] for i in range(n)))
        return list(best)
    pairs = sorted((costs[i][j], i, j) for i in range(n) for j in range(n))
    rows, cols, out = set(), set(), [0] * n
    for _, i, j in pairs:
        if i not in rows and j not in cols:
            rows.add(i)
            cols.add(j)
            out[i] = j
    return out


def match(reference: list[Contour], raw: list[Contour]) -> dict:
    """A recipe that makes ``raw`` line up with ``reference`` (the default
    master's contours, as shown): same contour order, same direction, and
    each contour starting at the corresponding point."""
    if len(reference) != len(raw):
        raise ResequenceError(
            f"It has {len(raw)} contour{'s' if len(raw) != 1 else ''} and the default has {len(reference)}; "
            "that needs redrawing")
    ref_box, raw_box = _bounds(reference), _bounds(raw)

    # Pair contours by where they sit in the glyph and how big they are.
    costs = []
    options = {}
    for i, target in enumerate(reference):
        t_norm = _normalised(target, ref_box)
        t_box = _bounds([target])
        row = []
        for j, contour in enumerate(raw):
            flip, starts = _candidates(target, contour)
            if not starts:
                row.append(INFINITE)
                continue
            options[i, j] = (flip, starts)
            c_norm = _normalised(contour, raw_box)
            c_box = _bounds([contour])
            (tx, ty), (cx, cy) = _centre(t_norm), _centre(c_norm)
            size = abs(t_box[2] / ref_box[2] - c_box[2] / raw_box[2]) + abs(t_box[3] / ref_box[3] - c_box[3] / raw_box[3])
            row.append(math.hypot(tx - cx, ty - cy) + size)
        costs.append(row)
    order = _assign(costs)
    for i, j in enumerate(order):
        if costs[i][j] >= INFINITE:
            raise ResequenceError(
                f"Contour {i + 1} of the default has no contour with the same points here; that needs redrawing")

    # Within each pair, the start point where the shapes line up best.
    entries = []
    for i, j in enumerate(order):
        target, contour = reference[i], raw[j]
        flip, starts = options[i, j]
        points = reverse(contour) if flip else contour
        t_norm = _normalised(target, _bounds([target]))
        c_box = _bounds([points])
        best, best_cost = None, INFINITE
        for s in sorted(starts, key=lambda s: s != 0):  # keep the drawn start on a tie
            c_norm = _normalised(rotate(points, s), c_box)
            cost = sum((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 for a, b in zip(t_norm, c_norm))
            if cost < best_cost - 1e-9:
                best, best_cost = s, cost
        entries.append({"source": j, "reverse": flip, "start": best})
    return {"signature": [pattern(c) for c in raw], "contours": entries}
