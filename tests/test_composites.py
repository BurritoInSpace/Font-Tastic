"""Accented letters built from a base letter and marks (components placed by anchors)."""

import importlib.util
from pathlib import Path

import pytest
import uharfbuzz as hb

from fonttastic.build import compile_otf
from fonttastic.composites import COMPOSITE
from fonttastic.project import Project

spec = importlib.util.spec_from_file_location("make_demo", Path(__file__).parent.parent / "examples" / "make_demo.py")
make_demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_demo)


def svg(body, w=600):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 1000">{body}</svg>'.encode()


# Artboard top = ascender (800): SVG y = 800 - font y.
LOWER = '<path d="M100,300 H400 V800 H100 Z"/>'  # x-height letter, 500 tall, centred at 250
UPPER = '<path d="M100,100 H500 V800 H100 Z"/>'  # cap-height letter, centred at 300
STEM = '<path d="M250,300 H350 V800 H250 Z"/>'  # dotless-i-like stem, centred at 300
ACUTE = '<path d="M250,150 L350,150 L300,250 Z"/>'  # drawn just above x-height, centred at 300
DIAERESIS = '<path d="M220,200 H280 V260 H220 Z M320,200 H380 V260 H320 Z"/>'
CASE_ACUTE = '<path d="M250,20 L350,20 L300,80 Z"/>'


@pytest.fixture
def project(tmp_path):
    make_demo.main(tmp_path)
    p = Project(tmp_path)
    p.import_all()
    p.add_svgs([(svg(LOWER), "e", False), (svg(UPPER), "E", False), (svg(LOWER), "u", False),
                (svg(ACUTE), "uni0301", False), (svg(DIAERESIS), "uni0308", False)])
    return p


def offsets(project, name):
    return [(c.baseGlyph, c.transformation[4], c.transformation[5]) for c in project.font[name].components]


def test_build_accented_letter(project):
    result = project.add_composites([0xE9])  # é
    assert result == {"added": ["uni00E9"], "errors": {}}
    g = project.font["uni00E9"]
    assert g.unicodes == [0xE9] and g.width == project.font["e"].width
    # e's top anchor (250, 500) meets the acute's _top (300, 500)
    assert offsets(project, "uni00E9") == [("e", 0, 0), ("uni0301", -50, 0)]
    summary = next(x for x in project.summary()["glyphs"] if x["name"] == "uni00E9")
    assert summary["composite"] == {"base": "e", "marks": ["uni0301"]} and summary["path"]
    assert summary["script"] == "Latn"

    font = hb.Font(hb.Face(compile_otf(project.font)))
    assert font.get_nominal_glyph(0xE9)  # in the compiled font's character map


def test_moving_an_anchor_moves_the_accent(project):
    project.add_composites([0xE9])
    anchors = [dict(name=a.name, x=a.x, y=a.y) for a in project.font["e"].anchors]
    for a in anchors:
        if a["name"] == "top":
            a["x"], a["y"] = 270, 520
    project.set_anchors("e", anchors)
    assert offsets(project, "uni00E9")[1] == ("uni0301", -30, 20)


def test_candidates(project):
    found = {c["char"]: c for c in project.composite_candidates()}
    assert found["é"]["problem"] is None and found["ü"]["problem"] is None
    assert found["ẽ"]["problem"] == "Needs ◌̃"  # ẽ: no tilde drawn yet
    assert "í" not in found  # no i in the font


def test_dotless_i_and_case_accents(project):
    project.add_svgs([(svg(STEM), "i", False), (svg(STEM), "uni0131", False), (svg(CASE_ACUTE), "uni0301.case", False)])
    project.add_composites([0xED, 0xC9])  # í, É
    assert project.font["uni00ED"].lib[COMPOSITE]["base"] == "uni0131"
    assert project.font["uni00C9"].lib[COMPOSITE] == {"base": "E", "marks": ["uni0301.case"]}


def test_stacked_marks(project):
    project.add_composites([0x1D8])  # ǘ = u + diaeresis + acute
    (_, _, _), (_, _, dy1), (_, _, dy2) = offsets(project, "uni01D8")
    assert dy2 > dy1  # the acute sits above the diaeresis


def test_deleting_a_part_empties_the_letter_but_keeps_compiling(project):
    project.add_composites([0xE9])
    project.delete_glyph("uni0301")
    g = project.font["uni00E9"]
    assert not g.components and "was deleted" in g.lib["com.fonttastic.warnings"][0]
    compile_otf(project.font)


def test_joins_the_base_letters_kerning_groups(project):
    project.set_kern_group(1, "round", ["e"])
    project.add_composites([0xE9])
    assert "uni00E9" in project.font.groups["public.kern1.round"]


def test_draw_instead(project):
    project.add_composites([0xE9])
    path = project.draw_instead("uni00E9")
    g = project.font["uni00E9"]
    assert path.is_file() and not g.components and len(g) >= 2 and COMPOSITE not in g.lib


def test_every_weight_uses_its_own_anchors(project):
    project.add_weight("Bold", 700, "Regular")
    anchors = [dict(name=a.name, x=a.x, y=a.y) for a in project.font["e"].anchors]
    for a in anchors:
        if a["name"] == "top":
            a["y"] = 540
    project.set_anchors("e", anchors)  # in Bold only
    project.add_composites([0xE9])
    assert offsets(project, "uni00E9")[1] == ("uni0301", -50, 40)
    project.switch_weight("Regular")
    assert offsets(project, "uni00E9")[1] == ("uni0301", -50, 0)


def test_renaming_a_part(project):
    project.add_composites([0xE9])
    project.rename_glyph("uni0301", "uni0300")  # it was really a grave
    assert project.font["uni00E9"].lib[COMPOSITE]["marks"] == ["uni0300"]
    assert offsets(project, "uni00E9")[1][0] == "uni0300"
