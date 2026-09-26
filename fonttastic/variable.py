"""Variable fonts: one font file with a weight axis, built from the project's weights.

Each weight is a master placed on the ``wght`` axis at its weight class
(Regular at 400, Bold at 700...). The default master is the one the font shows
when no weight is chosen (normally Regular). Named instances are the
in-between styles apps list by name, e.g. "Medium" at 500.

Two flavours are built from the same masters:
  - CFF2 (``.otf``): cubic curves exactly as drawn in Illustrator
  - TrueType (``.ttf``): curves converted to quadratics, compatibly across masters
"""

from __future__ import annotations

import io

import ufo2ft
import ufoLib2
from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, InstanceDescriptor, SourceDescriptor

from .build import CompileError
from .project import WEIGHT_NAMES, ProjectError


def settings(project) -> dict:
    """The project's variable-font setup, filled in with sensible defaults."""
    weights = sorted(project.weights, key=lambda w: w.weight)
    names = [w.name for w in weights]
    saved = project.settings.get("variable", {})
    default = saved.get("default")
    if default not in names:
        default = min(weights, key=lambda w: abs(w.weight - 400)).name
    lo, hi = weights[0].weight, weights[-1].weight
    instances = saved.get("instances")
    if instances is None:  # the standard weights the axis covers
        instances = [{"name": n, "weight": w} for w, n in sorted(WEIGHT_NAMES.items()) if lo <= w <= hi]
    instances = [i for i in instances if lo <= i["weight"] <= hi]
    return {
        "default": default,
        "min": lo,
        "max": hi,
        "masters": [{"name": w.name, "weight": w.weight} for w in weights],
        "instances": sorted(instances, key=lambda i: i["weight"]),
    }


def save_settings(project, default: str | None = None, instances: list[dict] | None = None) -> dict:
    current = settings(project)
    if default is not None:
        if default not in [m["name"] for m in current["masters"]]:
            raise ProjectError(f"No weight named {default!r}")
        current["default"] = default
    if instances is not None:
        cleaned = []
        for i in instances:
            name, weight = str(i.get("name", "")).strip(), int(i.get("weight", 0))
            if not name or not current["min"] <= weight <= current["max"]:
                raise ProjectError(f"Instance {name or '?'} at {weight} is outside the axis ({current['min']}-{current['max']})")
            cleaned.append({"name": name, "weight": weight})
        current["instances"] = cleaned
    project.save_settings({"variable": {"default": current["default"], "instances": current["instances"]}})
    return settings(project)


def _without(font, glyphs: set[str]):
    """A copy of ``font`` minus some glyphs (a sparse master: those glyphs just
    don't vary). Used for previews while some glyphs don't match yet."""
    copy = ufoLib2.Font(info=font.info, features=font.features, groups=font.groups,
                        kerning=font.kerning, lib=font.lib)
    for glyph in font:
        if glyph.name not in glyphs:
            copy.layers.defaultLayer.insertGlyph(glyph, name=glyph.name, copy=False)
    return copy


def designspace(project, skip_incompatible: bool = False) -> DesignSpaceDocument:
    setup = settings(project)
    if len(setup["masters"]) < 2:
        raise ProjectError("A variable font needs at least two weights")
    fonts = dict(project.weight_fonts())
    skip: set[str] = set()
    if skip_incompatible:
        report = project.compatibility()
        skip = {g for g, problems in report["glyphs"].items() if any(p["severity"] != "warning" for p in problems)}
    default_weight = next(m["weight"] for m in setup["masters"] if m["name"] == setup["default"])

    doc = DesignSpaceDocument()
    axis = AxisDescriptor()
    axis.tag, axis.name = "wght", "Weight"
    axis.minimum, axis.default, axis.maximum = setup["min"], default_weight, setup["max"]
    doc.addAxis(axis)
    family = project.font.info.familyName
    for m in setup["masters"]:
        src = SourceDescriptor()
        src.name = m["name"]
        src.familyName, src.styleName = family, m["name"]
        src.location = {"Weight": m["weight"]}
        font = fonts[m["name"]]
        src.font = font if (m["name"] == setup["default"] or not skip) else _without(font, skip)
        doc.addSource(src)
    for i in setup["instances"]:
        inst = InstanceDescriptor()
        inst.familyName, inst.styleName = family, i["name"]
        inst.location = {"Weight": i["weight"]}
        doc.addInstance(inst)
    return doc


def compile_variable(project, flavor: str = "cff2", preview: bool = False) -> bytes:
    """Build the variable font. ``preview`` holds glyphs that don't match yet at
    the default weight instead of failing, and skips the slow optimisations."""
    if flavor not in ("cff2", "ttf"):
        raise ValueError(flavor)
    with project.lock:
        if not preview:
            report = project.compatibility()
            blocking = sorted(g for g, ps in report["glyphs"].items() if any(p["severity"] != "warning" for p in ps))
            if blocking:
                raise CompileError(
                    f"{len(blocking)} glyph{'s' if len(blocking) != 1 else ''} don't match across weights yet: "
                    + ", ".join(blocking[:12]) + (" ..." if len(blocking) > 12 else "")
                )
        doc = designspace(project, skip_incompatible=preview)
        try:
            if flavor == "cff2":
                vf = ufo2ft.compileVariableCFF2(doc, useProductionNames=False, optimizeCFF=0 if preview else 1)
            else:
                vf = ufo2ft.compileVariableTTF(doc, useProductionNames=False)
        except Exception as exc:
            raise CompileError(f"{type(exc).__name__}: {exc}") from exc
    buf = io.BytesIO()
    vf.save(buf)
    return buf.getvalue()
