"""Variable fonts: one font file with every axis the project varies along,
built from its masters.

Each master sits at a location on the axes (Regular at wght 400, Bold
Condensed at wght 700 + wdth 75...). The default master is the one the font
shows when nothing is chosen (normally Regular). An axis only goes into the
font once masters differ along it. Named instances are the in-between styles
apps list by name, e.g. "Medium" at wght 500.

Two flavours are built from the same masters:
  - CFF2 (``.otf``): cubic curves exactly as drawn in Illustrator
  - TrueType (``.ttf``): curves converted to quadratics, compatibly across masters
"""

from __future__ import annotations

import io
import itertools

import ufo2ft
import ufoLib2
from fontTools.designspaceLib import AxisDescriptor, DesignSpaceDocument, InstanceDescriptor, SourceDescriptor

from . import axes as axis_info
from .build import CompileError
from .project import WEIGHT_NAMES, ProjectError


def _axes(project, default_location: dict) -> list[dict]:
    out = []
    for a in project.axes:
        values = [w.location[a["tag"]] for w in project.weights]
        preset = axis_info.PRESETS.get(a["tag"], {})
        out.append({
            "tag": a["tag"], "name": a["name"], "unit": preset.get("unit", ""),
            "min": min(values), "max": max(values), "default": default_location[a["tag"]],
            "active": min(values) != max(values),
        })
    return out


def _clean_instance(inst: dict, axis_list: list[dict]) -> dict:
    """An instance with a value on every axis: old saves had just a weight;
    axes that don't vary take their one value."""
    location = dict(inst.get("location") or {})
    if "weight" in inst and "wght" not in location:
        location["wght"] = inst["weight"]
    for a in axis_list:
        if not a["active"] or a["tag"] not in location:
            location[a["tag"]] = a["default"]
    return {"name": str(inst.get("name", "")).strip(), "location": {a["tag"]: location[a["tag"]] for a in axis_list}}


def _inside(inst: dict, axis_list: list[dict]) -> bool:
    return all(a["min"] <= inst["location"][a["tag"]] <= a["max"] for a in axis_list)


def settings(project) -> dict:
    """The project's variable-font setup, filled in with sensible defaults."""
    masters = project.weights
    saved = project.settings.get("variable", {})
    default = saved.get("default")
    if default not in [w.name for w in masters]:
        # Regular-ish: nearest to 400, then nearest to every other axis's usual default
        def distance(w):
            others = sum(abs(w.location[a["tag"]] - axis_info.PRESETS.get(a["tag"], {}).get("default", 0))
                         for a in project.axes if a["tag"] != "wght")
            return (abs(w.weight - 400), others)
        default = min(masters, key=distance).name
    default_location = next(w.location for w in masters if w.name == default)
    axis_list = _axes(project, default_location)

    instances = saved.get("instances")
    if instances is None:
        instances = _standard_instances(project, axis_list, default_location)
    instances = [_clean_instance(i, axis_list) for i in instances]
    instances = [i for i in instances if i["name"] and _inside(i, axis_list)]
    order = [a["tag"] for a in axis_list]
    return {
        "axes": axis_list,
        "default": default,
        "masters": [{"name": w.name, "weight": w.weight, "location": w.location} for w in masters],
        "instances": sorted(instances, key=lambda i: tuple(i["location"][t] for t in order)),
        "missingCorners": _missing_corners(project, axis_list),
    }


def _standard_instances(project, axis_list: list[dict], default_location: dict) -> list[dict]:
    """The usual weights along the weight axis (at the default of the other
    axes), plus one instance per master, named after it."""
    wght = next(a for a in axis_list if a["tag"] == "wght")
    out = [{"name": n, "location": {**default_location, "wght": w}}
           for w, n in sorted(WEIGHT_NAMES.items()) if wght["min"] <= w <= wght["max"]]
    taken = {tuple(sorted(i["location"].items())) for i in out}
    for w in project.weights:
        if tuple(sorted(w.location.items())) not in taken:
            out.append({"name": w.name, "location": dict(w.location)})
    return out


def _missing_corners(project, axis_list: list[dict]) -> list[dict]:
    """With two or more axes, the extremes nobody drew (e.g. Bold Condensed
    when there's a Bold and a Condensed). The font still works there, adding
    up the changes of the masters around it, but it can look off."""
    active = [a for a in axis_list if a["active"]]
    if len(active) < 2:
        return []
    drawn = {tuple(w.location[a["tag"]] for a in active) for w in project.weights}
    corners = itertools.product(*[(a["min"], a["max"]) for a in active])
    return [dict(zip([a["tag"] for a in active], c)) for c in corners if c not in drawn]


def save_settings(project, default: str | None = None, instances: list[dict] | None = None) -> dict:
    current = settings(project)
    if default is not None:
        if default not in [m["name"] for m in current["masters"]]:
            raise ProjectError(f"No master named {default!r}")
        current["default"] = default
    if instances is not None:
        cleaned = []
        for raw in instances:
            inst = _clean_instance(raw, current["axes"])
            if not inst["name"]:
                raise ProjectError("Every instance needs a name")
            for a in current["axes"]:
                value = inst["location"][a["tag"]]
                if not isinstance(value, (int, float)) or not a["min"] <= value <= a["max"]:
                    raise ProjectError(
                        f"Instance {inst['name']}: {a['name']} {value} is outside the axis ({a['min']:g}-{a['max']:g})")
            cleaned.append(inst)
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
        raise ProjectError("A variable font needs at least two masters")
    active = [a for a in setup["axes"] if a["active"]]
    fonts = dict(project.weight_fonts())
    skip: set[str] = set()
    if skip_incompatible:
        report = project.compatibility()
        skip = {g for g, problems in report["glyphs"].items() if any(p["severity"] != "warning" for p in problems)}

    doc = DesignSpaceDocument()
    for a in active:
        axis = AxisDescriptor()
        axis.tag, axis.name = a["tag"], a["name"]
        axis.minimum, axis.default, axis.maximum = a["min"], a["default"], a["max"]
        doc.addAxis(axis)
    family = project.font.info.familyName
    for m in setup["masters"]:
        src = SourceDescriptor()
        src.name = m["name"]
        src.familyName, src.styleName = family, m["name"]
        src.location = {a["name"]: m["location"][a["tag"]] for a in active}
        font = fonts[m["name"]]
        src.font = font if (m["name"] == setup["default"] or not skip) else _without(font, skip)
        doc.addSource(src)
    for i in setup["instances"]:
        inst = InstanceDescriptor()
        inst.familyName, inst.styleName = family, i["name"]
        inst.location = {a["name"]: i["location"][a["tag"]] for a in active}
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
