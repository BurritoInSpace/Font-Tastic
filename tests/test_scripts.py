"""Several scripts in one font: Hebrew with Latin (and Greek, Cyrillic)."""

import importlib.util
from pathlib import Path

import pytest
import uharfbuzz as hb

from fonttastic import scripts
from fonttastic.build import compile_otf
from fonttastic.project import Project

spec = importlib.util.spec_from_file_location("make_demo", Path(__file__).parent.parent / "examples" / "make_demo.py")
make_demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_demo)


def svg(body, w=600):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 1000">{body}</svg>'.encode()


# Artboard top = ascender (800), so SVG y = 800 - font y.
N_LOWER = '<path d="M100,300 H400 V800 H100 Z"/>'  # 500 tall: x-height letter
H_UPPER = '<path d="M100,100 H500 V800 H100 Z"/>'  # 700 tall: cap height
ACUTE = '<path d="M250,150 L350,150 L300,250 Z"/>'  # drawn above an x-height letter


@pytest.fixture
def project(tmp_path):
    make_demo.main(tmp_path)
    p = Project(tmp_path)
    p.import_all()
    return p


def test_script_of_glyphs():
    assert scripts.script_of("uni05D0") == "Hebr"
    assert scripts.script_of("a") == "Latn" and scripts.script_of("uni0041") == "Latn"
    assert scripts.script_of("uni03A9") == "Grek" and scripts.script_of("uni0416") == "Cyrl"
    assert scripts.script_of("one") == "Zyyy" and scripts.script_of("uni0301") == "Zinh"
    assert scripts.script_of("uni05D0.salt") == "Hebr"
    assert scripts.script_of("f_i.liga") == "Latn"
    assert scripts.direction("Hebr") == "rtl" and scripts.direction("Latn") == "ltr"
    assert scripts.direction("Zyyy") is None


def test_latin_anchors_are_seeded(project):
    project.add_svg(svg(N_LOWER), "n")
    project.add_svg(svg(H_UPPER), "H")
    project.add_svg(svg(ACUTE), "uni0301")
    anchors = lambda g: {a.name: (a.x, a.y) for a in project.font[g].anchors}
    assert anchors("n") == {"top": (250, 500), "bottom": (250, 0)}
    assert anchors("H") == {"top": (300, 700), "bottom": (300, 0)}
    assert anchors("uni0301") == {"_top": (300, 500)}
    assert project.font["uni0301"].width == 0


def test_language_systems_follow_the_scripts(project):
    assert scripts.language_systems(project.font) == [("DFLT", "dflt"), ("hebr", "dflt")]
    project.add_svg(svg(N_LOWER), "n")
    assert scripts.language_systems(project.font) == [("DFLT", "dflt"), ("hebr", "dflt"), ("latn", "dflt")]
    assert "languagesystem latn dflt;" in project.font.features.text
    summary = project.summary()
    assert [s["code"] for s in summary["scripts"]] == ["Hebr", "Latn"]
    assert next(g for g in summary["glyphs"] if g["name"] == "n")["script"] == "Latn"


def test_latin_accent_is_positioned_by_anchors(project):
    project.add_svg(svg(N_LOWER), "n")
    project.add_svg(svg(ACUTE), "uni0301")
    data = compile_otf(project.font)
    font = hb.Font(hb.Face(data))
    buf = hb.Buffer()
    buf.add_str("ń")
    buf.guess_segment_properties()
    hb.shape(font, buf, {})
    names = [font.glyph_to_string(i.codepoint) for i in buf.glyph_infos]
    assert names == ["n", "uni0301"]
    assert buf.direction == "ltr"
    # n's top anchor is at (250, 500), the accent's _top at (300, 500): after
    # n's 600 advance, the accent moves back 650 to sit on the anchor.
    mark = buf.glyph_positions[1]
    assert (mark.x_offset, mark.y_offset, mark.x_advance) == (-650, 0, 0)


def test_case_accent_anchor_sits_at_cap_height(project):
    project.add_svg(svg('<path d="M250,20 L350,20 L300,80 Z"/>'), "uni0301.case")
    assert {a.name: (a.x, a.y) for a in project.font["uni0301.case"].anchors} == {"_top": (300, 700)}
