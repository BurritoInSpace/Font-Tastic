"""Accented letters built from parts: é = e + ◌́, placed by anchors.

A precomposed letter whose Unicode decomposition is a base letter plus
combining marks (é, ü, ñ, ş, ǘ, ά, й...) can be built from glyphs the font
already has. The result is a glyph made of *components* (references to the
base and the marks, not copies), so redrawing e or the acute changes é too.
Each mark sits where its attachment anchor (``_top``) meets the matching
anchor on the base (``top``); a second mark stacks on the first.

Refinements designers expect:
  - i and j take a top accent on the dotless forms (ı, ȷ) when the font has them
  - capitals use a ``.case`` variant of the mark (``uni0301.case``) when one exists

The recipe (base + marks) is kept in the glyph's lib and re-placed on every
save, so moving an anchor moves the accent in every letter that uses it.
"""

from __future__ import annotations

import unicodedata

from fontTools.pens.boundsPen import BoundsPen

from . import naming, scripts

COMPOSITE = "com.fonttastic.composite"  # glyph lib: {"base": glyph, "marks": [glyphs]}
STACK_GAP = 40  # units between stacked marks when the lower one has no anchor to stack on

# Where precomposed letters live: Latin, Greek, Cyrillic.
RANGES = [(0x00C0, 0x024F), (0x1E00, 0x1EFF), (0x0370, 0x03FF), (0x1F00, 0x1FFF), (0x0400, 0x04FF)]
DOTLESS = {0x69: 0x131, 0x6A: 0x237}  # i -> ı, j -> ȷ


class CompositeError(ValueError):
    pass


def _cmap(font) -> dict[int, str]:
    out = {}
    for glyph in font:
        for cp in glyph.unicodes:
            out.setdefault(cp, glyph.name)
    return out


def decompose(cp: int) -> tuple[int, list[int]] | None:
    """(base, marks) if ``cp`` is a letter plus combining marks, else None."""
    parts = unicodedata.normalize("NFD", chr(cp))
    if len(parts) < 2 or any(unicodedata.category(c) != "Mn" for c in parts[1:]):
        return None
    return ord(parts[0]), [ord(c) for c in parts[1:]]


def recipe_for(font, cp: int, cmap: dict[int, str] | None = None) -> dict:
    """``{"base": glyph, "marks": [glyphs]}`` for building ``cp``, or a
    CompositeError saying what's missing."""
    cmap = cmap if cmap is not None else _cmap(font)
    found = decompose(cp)
    if found is None:
        raise CompositeError(f"{chr(cp)} isn't a letter with accents")
    base_cp, mark_cps = found
    if base_cp in DOTLESS and DOTLESS[base_cp] in cmap and any(scripts.mark_anchor_class(m) == "top" for m in mark_cps):
        base_cp = DOTLESS[base_cp]
    missing = [c for c in [base_cp, *mark_cps] if c not in cmap]
    if missing:
        raise CompositeError("Needs " + " and ".join(naming.display_char(naming.canonical_name(c)) or chr(c)
                                                     for c in missing))
    upper = unicodedata.category(chr(cp)) == "Lu"
    marks = []
    for m in mark_cps:
        name = cmap[m]
        if upper and f"{name}.case" in font:
            name = f"{name}.case"
        marks.append(name)
    return {"base": cmap[base_cp], "marks": marks}


def _top_bottom(glyph, layer):
    pen = BoundsPen(layer)
    glyph.draw(pen)
    return pen.bounds


def place(font, recipe: dict) -> list[tuple[str, tuple[float, float]]]:
    """The components (glyph, offset) that make the letter, or a
    CompositeError when an anchor is missing."""
    base = font[recipe["base"]]
    components = [(base.name, (0, 0))]
    attach = {a.name: (a.x, a.y) for a in base.anchors}  # where the next mark of each class goes
    for name in recipe["marks"]:
        if name not in font:
            raise CompositeError(f"{name} is gone")
        mark = font[name]
        anchor = next((a for a in mark.anchors if a.name.startswith("_")), None)
        if anchor is None:
            raise CompositeError(f"{name} has no attachment anchor (like _top)")
        cls = anchor.name[1:]
        if cls not in attach:
            raise CompositeError(f"{base.name} has no {cls} anchor for {name}")
        bx, by = attach[cls]
        dx, dy = bx - anchor.x, by - anchor.y
        components.append((name, (dx, dy)))
        # A further mark of the same class stacks on this one: on its own
        # anchor of that name if it has one (as for mark-to-mark), else just
        # past its edge.
        own = next((a for a in mark.anchors if a.name == cls), None)
        if own is not None:
            attach[cls] = (own.x + dx, own.y + dy)
        else:
            bounds = _top_bottom(mark, font)
            if bounds:
                if cls == "bottom":
                    attach[cls] = (bx, bounds[1] + dy - STACK_GAP)
                else:
                    attach[cls] = (bx, bounds[3] + dy + STACK_GAP)
    return components


def build(font, name: str, cp: int, recipe: dict):
    """Create or update the composite glyph ``name`` for ``cp``."""
    components = place(font, recipe)
    glyph = font.get(name)
    if glyph is None:
        glyph = font.newGlyph(name)
    glyph.clearContours()
    glyph.clearComponents()
    glyph.clearAnchors()
    pen = glyph.getPen()
    for comp, (dx, dy) in components:
        pen.addComponent(comp, (1, 0, 0, 1, round(dx), round(dy)))
    glyph.width = font[recipe["base"]].width
    glyph.unicodes = [cp]
    glyph.lib[COMPOSITE] = dict(recipe)
    return glyph


def refresh(font) -> dict[str, str]:
    """Re-place every composite from the current anchors and widths.
    Returns {glyph: problem} for the ones that couldn't be placed (they keep
    their last good placement)."""
    problems = {}
    for glyph in list(font):
        recipe = glyph.lib.get(COMPOSITE)
        if not recipe or not glyph.unicodes:
            continue
        gone = [n for n in [recipe["base"], *recipe["marks"]] if n not in font]
        if gone:
            # never leave a reference to a missing glyph: that would break compiling
            glyph.clearComponents()
            problems[glyph.name] = f"Built from {', '.join(gone)}, which was deleted: draw it or delete it"
            continue
        try:
            build(font, glyph.name, glyph.unicodes[0], recipe)
        except CompositeError as exc:
            problems[glyph.name] = str(exc)
    return problems


def candidates(font) -> list[dict]:
    """Accented letters the font could build: those whose base letter it
    has and that it doesn't have yet, each with what's missing (if anything)."""
    cmap = _cmap(font)
    out = []
    for lo, hi in RANGES:
        for cp in range(lo, hi + 1):
            if cp in cmap:
                continue
            found = decompose(cp)
            if found is None or found[0] not in cmap:
                continue
            base_cp, mark_cps = found
            entry = {
                "unicode": cp,
                "char": chr(cp),
                "name": naming.canonical_name(cp),
                "base": chr(base_cp),
                "marks": [chr(m) for m in mark_cps],
                "problem": None,
            }
            try:
                place(font, recipe_for(font, cp, cmap))
            except CompositeError as exc:
                entry["problem"] = str(exc)
            out.append(entry)
    return out
