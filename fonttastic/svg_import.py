"""Illustrator SVG -> glyph outlines.

The artboard (SVG viewBox) is the glyph's em box: its top edge is the font's
ascender, its bottom edge the descender, and its width the advance width.
So in Illustrator the artboard *is* the glyph cell — sidebearings are drawn,
not typed (they can still be adjusted in-app afterwards).

fontTools' own ``SVGPath`` only understands ``matrix()`` on the drawn element
itself, so this module walks the tree itself to get group transforms, CSS
classes, hidden layers and fill rules right, and reuses fontTools only for
turning individual shapes into path data.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from xml.etree import ElementTree as ET

from booleanOperations.booleanGlyph import BooleanGlyph
from fontTools.misc.transform import Identity, Transform
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.pointInsidePen import PointInsidePen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path.parser import parse_path
from fontTools.svgLib.path.shapes import PathBuilder

SHAPES = {"path", "rect", "circle", "ellipse", "polygon", "polyline", "line"}
SKIP = {
    "defs", "clipPath", "mask", "symbol", "pattern", "marker", "metadata",
    "title", "desc", "style", "linearGradient", "radialGradient", "filter",
    "foreignObject",  # Illustrator's PGF reference; the artwork is its <switch> sibling
}
UNSUPPORTED = {"text", "image", "use"}
INHERITED = ("fill", "fill-rule", "stroke", "display", "visibility")


@dataclass
class ImportedOutline:
    contours: list[list[tuple]]  # each contour is a list of RecordingPen ops
    advance: float
    warnings: list[str] = field(default_factory=list)

    def draw(self, pen):
        for contour in self.contours:
            _replay(contour, pen)

    def draw_points(self, point_pen):
        from fontTools.pens.pointPen import SegmentToPointPen

        self.draw(SegmentToPointPen(point_pen))


def read_svg(path: str | Path, ascender: float, descender: float) -> ImportedOutline:
    return parse_svg(Path(path).read_bytes(), ascender, descender)


def parse_svg(data: bytes, ascender: float, descender: float) -> ImportedOutline:
    root = ET.fromstring(data)
    warnings: list[str] = []

    vb_x, vb_y, vb_w, vb_h = _viewbox(root)
    scale = (ascender - descender) / vb_h
    # SVG is y-down from the artboard's top-left; fonts are y-up from the
    # baseline. Artboard top -> ascender.
    to_font = Transform(scale, 0, 0, -scale, -vb_x * scale, ascender + vb_y * scale)

    css = _parse_css(root)
    elements: list[tuple[list[list[tuple]], str]] = []
    seen_unsupported: set[str] = set()
    stroked = False

    def walk(el, ctm, inherited):
        nonlocal stroked
        if not isinstance(el.tag, str):
            return
        tag = _local(el.tag)
        if tag in SKIP or el.tag.startswith("{") and not el.tag.startswith("{http://www.w3.org/2000/svg}"):
            return  # also skips Illustrator's private-namespace editing data
        style = _cascade(el, css, inherited)
        if style.get("display") == "none" or style.get("visibility") == "hidden":
            return
        if "transform" in el.attrib:
            ctm = ctm.transform(_parse_transform(el.attrib["transform"]))
        if tag in UNSUPPORTED:
            seen_unsupported.add(tag)
            return
        if tag in SHAPES:
            fill = style.get("fill", "black")
            has_stroke = style.get("stroke", "none") not in ("none", "")
            if fill == "none":
                if has_stroke:
                    warnings.append(
                        "Stroke-only path ignored — use Object › Path › Outline Stroke in Illustrator."
                    )
                return
            if has_stroke:
                stroked = True
            contours = _shape_contours(el, to_font.transform(ctm))
            if contours:
                elements.append((contours, style.get("fill-rule", "nonzero")))
            return
        for child in el:
            walk(child, ctm, style)

    walk(root, Identity, {})

    if stroked:
        warnings.append("Some filled shapes also have strokes; strokes are ignored.")
    for tag in sorted(seen_unsupported):
        warnings.append(f"<{tag}> elements are not supported and were skipped.")

    all_contours: list[list[tuple]] = []
    for contours, rule in elements:
        if rule == "evenodd":
            contours = _orient_by_depth(contours)
        all_contours.extend(contours)

    contours = _remove_overlap(all_contours)
    if not contours:
        warnings.append("No filled shapes found.")
    return ImportedOutline(contours, vb_w * scale, _dedupe(warnings))


def outline_to_svg(glyph, width: float, ascender: float, descender: float) -> str:
    """The inverse of ``parse_svg``: a glyph's outline on an artboard that maps
    back onto the same em box (1 font unit = 1 pt in Illustrator)."""
    height = ascender - descender
    pen = SVGPathPen(None, ntos=lambda v: f"{v:.2f}".rstrip("0").rstrip("."))
    glyph.draw(TransformPen(pen, Transform(1, 0, 0, -1, 0, ascender)))
    d = pen.getCommands()
    shape = f'\n  <path d="{d}"/>' if d else ""
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:g} {height:g}" '
        f'width="{width:g}px" height="{height:g}px">{shape}\n</svg>\n'
    )


# -- geometry ---------------------------------------------------------------


def _shape_contours(el, transform) -> list[list[tuple]]:
    # Transforms are already folded into `transform`; PathBuilder would choke
    # on anything but matrix(), so hand it the shape without one.
    shape = ET.Element(el.tag, {k: v for k, v in el.attrib.items() if k != "transform"})
    pb = PathBuilder()
    if not pb.add_path_from_element(shape) or not pb.paths[-1]:
        return []
    rec = RecordingPen()
    parse_path(pb.paths[-1], TransformPen(rec, transform))
    return _split_contours(rec.value)


def _split_contours(ops) -> list[list[tuple]]:
    contours, current = [], []
    for op, args in ops:
        if op == "moveTo" and current:
            contours.append(_closed(current))
            current = []
        current.append((op, args))
        if op in ("closePath", "endPath"):
            contours.append(_closed(current))
            current = []
    if current:
        contours.append(_closed(current))
    # a filled SVG subpath is implicitly closed; drop degenerate ones
    return [c for c in contours if sum(1 for op, _ in c if op not in ("moveTo", "closePath")) >= 2]


def _closed(contour):
    if contour[-1][0] in ("closePath", "endPath"):
        contour = contour[:-1]
    return contour + [("closePath", ())]


def _replay(contour, pen):
    for op, args in contour:
        getattr(pen, op)(*args)


def _signed_area(contour) -> float:
    pen = AreaPen()
    _replay(contour, pen)
    return pen.value


def _reversed(contour):
    rec = RecordingPen()
    _replay(contour, ReverseContourPen(rec))
    return rec.value


def _inside(point, contour) -> bool:
    pen = PointInsidePen(None, point, evenOdd=True)
    _replay(contour, pen)
    return pen.getResult()


def _orient_by_depth(contours):
    """Wind contours nested at even depth counter-clockwise and odd depth
    clockwise. Applied to an even-odd shape, this makes nonzero filling give
    the same result; applied to final outlines, it is the PostScript convention."""
    out = []
    for i, contour in enumerate(contours):
        start = contour[0][1][0]
        depth = sum(1 for j, other in enumerate(contours) if j != i and _inside(start, other))
        want_positive = depth % 2 == 0
        if (_signed_area(contour) > 0) != want_positive:
            contour = _reversed(contour)
        out.append(contour)
    return out


def _remove_overlap(contours):
    """Union all shapes (Illustrator glyphs are often overlapping pieces) and
    normalise winding to PostScript convention: outer contours counter-clockwise."""
    if not contours:
        return []
    glyph = BooleanGlyph()
    pen = glyph.getPen()
    for contour in contours:
        _replay(contour, pen)
    result = glyph.removeOverlap()
    rec = RecordingPen()
    result.draw(rec)
    return _orient_by_depth(_split_contours(rec.value))


# -- SVG plumbing -----------------------------------------------------------


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


_NUM = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")


def _length(value: str | None) -> float | None:
    if not value:
        return None
    m = _NUM.match(value.strip())
    return float(m.group()) if m else None


def _viewbox(root):
    if "viewBox" in root.attrib:
        nums = [float(n) for n in _NUM.findall(root.attrib["viewBox"])]
        if len(nums) == 4 and nums[2] > 0 and nums[3] > 0:
            return tuple(nums)
    w, h = _length(root.get("width")), _length(root.get("height"))
    if w and h:
        return (0.0, 0.0, w, h)
    raise ValueError("SVG has no viewBox or width/height — cannot map the artboard to the em box.")


def _parse_transform(value: str) -> Transform:
    t = Identity
    for name, args in re.findall(r"(\w+)\s*\(([^)]*)\)", value):
        a = [float(n) for n in _NUM.findall(args)]
        if name == "matrix" and len(a) == 6:
            t = t.transform(a)
        elif name == "translate":
            t = t.translate(a[0], a[1] if len(a) > 1 else 0)
        elif name == "scale":
            t = t.scale(a[0], a[1] if len(a) > 1 else a[0])
        elif name == "rotate":
            if len(a) == 3:
                t = t.translate(a[1], a[2]).rotate(math.radians(a[0])).translate(-a[1], -a[2])
            else:
                t = t.rotate(math.radians(a[0]))
        elif name == "skewX":
            t = t.skew(math.radians(a[0]), 0)
        elif name == "skewY":
            t = t.skew(0, math.radians(a[0]))
    return t


def _parse_declarations(text: str) -> dict[str, str]:
    out = {}
    for decl in text.split(";"):
        if ":" in decl:
            k, v = decl.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def _parse_css(root) -> dict[str, dict[str, str]]:
    """Class rules from <style> blocks (Illustrator's "Style Elements" CSS)."""
    rules: dict[str, dict[str, str]] = {}
    for el in root.iter():
        if isinstance(el.tag, str) and _local(el.tag) == "style" and el.text:
            text = re.sub(r"/\*.*?\*/", "", el.text, flags=re.S)
            for selectors, body in re.findall(r"([^{}]+)\{([^}]*)\}", text):
                decls = _parse_declarations(body)
                for sel in selectors.split(","):
                    sel = sel.strip()
                    if sel.startswith("."):
                        rules.setdefault(sel[1:], {}).update(decls)
    return rules


def _cascade(el, css, inherited) -> dict[str, str]:
    style = {k: v for k, v in inherited.items() if k in INHERITED}
    for k in INHERITED:
        if k in el.attrib:
            style[k] = el.attrib[k]
    for cls in el.attrib.get("class", "").split():
        style.update(css.get(cls, {}))
    if "style" in el.attrib:
        style.update(_parse_declarations(el.attrib["style"]))
    return style


def _dedupe(items):
    return list(dict.fromkeys(items))
