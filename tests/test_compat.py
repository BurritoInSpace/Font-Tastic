"""Compatibility of weights for a variable font."""

import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fonttastic.project import Project
from fonttastic.server import create_app

spec = importlib.util.spec_from_file_location("make_demo", Path(__file__).parent.parent / "examples" / "make_demo.py")
make_demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_demo)


def svg(body, w=600):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 1000">{body}</svg>'.encode()


SQUARE = '<path d="M100,100 H400 V800 H100 Z"/>'


@pytest.fixture
def project(tmp_path):
    make_demo.main(tmp_path)
    p = Project(tmp_path)
    p.import_all()
    return p


def two_weights(project, regular: str, bold: str, name="uni05D2"):
    """Put a glyph drawn one way in Regular and another way in Bold."""
    project.add_svg(svg(regular), name)
    project.add_weight("Bold", 700, "Regular")
    (project.glyphs_dir / f"{name}.svg").write_bytes(svg(bold))
    project.import_all()
    return project.compatibility()["glyphs"].get(name, [])


def test_copied_weight_is_compatible(project):
    project.add_weight("Bold", 700, "Regular")
    report = project.compatibility()
    assert report["errors"] == 0 and report["fixable"] == 0


def test_single_weight_has_nothing_to_check(project):
    assert project.compatibility() == {"glyphs": {}, "errors": 0, "fixable": 0, "warnings": 0}


def test_extra_point_is_an_error(project):
    problems = two_weights(project, SQUARE, '<path d="M100,100 H250 H400 V800 H100 Z"/>')
    (p,) = [p for p in problems if p["type"] == "node_count"]
    assert p["severity"] == "error"
    assert p["message"] == "Contour 1 has 1 more segment in Bold than in Regular: add or remove a point in Illustrator"


def test_straight_vs_curved(project):
    problems = two_weights(project, SQUARE, '<path d="M100,100 H400 C450,300 450,600 400,800 H100 Z"/>')
    assert any(p["type"] == "node_incompatibility" and "straight in Regular but curved in Bold" in p["message"]
               for p in problems)


def test_start_point_is_fixable(project):
    problems = two_weights(project, SQUARE, '<path d="M400,800 H100 V100 H400 Z"/>')
    (p,) = [p for p in problems if p["type"] == "wrong_start_point"]
    assert p["severity"] == "fixable" and p["message"].startswith("Contour 1 starts at a different point in Bold")


def test_missing_glyph_and_anchors(project):
    project.add_weight("Bold", 700, "Regular")
    project.delete_glyph("uni05D3")  # deletes in every weight: still compatible
    project.set_anchors("uni05D1", [{"name": "top", "x": 1, "y": 2}])  # Bold's bet loses bottom/dagesh
    del project.font["uni05D5"]  # vav gone from Bold only
    project._commit()
    glyphs = project.compatibility()["glyphs"]
    assert "uni05D3" not in glyphs
    assert glyphs["uni05D5"][0]["message"] == "Missing in Bold: import its SVG there too"
    assert glyphs["uni05D1"][0]["type"] == "anchors" and "missing bottom, dagesh" in glyphs["uni05D1"][0]["message"]


def test_compat_api(project):
    project.add_weight("Bold", 700, "Regular")
    r = TestClient(create_app(project, watch=False)).get("/api/compat")
    assert r.status_code == 200 and r.json()["errors"] == 0


# -- variable font ------------------------------------------------------------------

import io

from fontTools.ttLib import TTFont

from fonttastic import variable
from fonttastic.build import CompileError

HEAVY = '<path d="M60,100 H440 V800 H60 Z"/>'


def test_variable_font_interpolates(project):
    two_weights(project, SQUARE, HEAVY)  # a gimel that's wider in Bold
    for flavor, table in (("cff2", "CFF2"), ("ttf", "gvar")):
        font = TTFont(io.BytesIO(variable.compile_variable(project, flavor)))
        assert table in font and [a.axisTag for a in font["fvar"].axes] == ["wght"]
        axis = font["fvar"].axes[0]
        assert (axis.minValue, axis.defaultValue, axis.maxValue) == (400, 400, 700)
        names = [font["name"].getDebugName(i.subfamilyNameID) for i in font["fvar"].instances]
        assert names == ["Regular", "Medium", "SemiBold", "Bold"]

    import uharfbuzz as hb

    face = hb.Face(variable.compile_variable(project, "cff2"))
    widths = []
    for wght in (400, 550, 700):
        font = hb.Font(face)
        font.set_variations({"wght": wght})
        buf = hb.Buffer()
        buf.add_str("\u05d2")
        buf.guess_segment_properties()
        hb.shape(font, buf, {})
        extents = font.get_glyph_extents(buf.glyph_infos[0].codepoint)
        widths.append(extents.width)
    assert widths[0] == 300 and widths[2] == 380 and widths[0] < widths[1] < widths[2]


def test_variable_build_refuses_mismatches_but_previews(project):
    two_weights(project, SQUARE, '<path d="M100,100 H250 H400 V800 H100 Z"/>')
    with pytest.raises(CompileError, match="don't match"):
        variable.compile_variable(project, "cff2")
    assert TTFont(io.BytesIO(variable.compile_variable(project, "cff2", preview=True)))["fvar"]


def test_variable_settings(project):
    project.add_weight("Light", 300, "Regular")
    project.add_weight("Bold", 700, "Regular")
    s = variable.settings(project)
    assert (s["default"], s["min"], s["max"]) == ("Regular", 300, 700)
    assert [i["weight"] for i in s["instances"]] == [300, 400, 500, 600, 700]
    s = variable.save_settings(project, default="Light", instances=[{"name": "Book", "weight": 350}])
    assert s["default"] == "Light" and s["instances"] == [{"name": "Book", "weight": 350}]
    with pytest.raises(Exception):
        variable.save_settings(project, instances=[{"name": "Heavy", "weight": 900}])


def test_export_writes_every_format(project):
    two_weights(project, SQUARE, HEAVY)
    r = TestClient(create_app(project, watch=False)).post("/api/export").json()
    names = sorted(Path(p).name for p in r["paths"])
    family = project.font.info.familyName
    assert names == sorted([f"{family}-Regular.otf", f"{family}-Regular.ttf", f"{family}-Bold.otf",
                            f"{family}-Bold.ttf", f"{family}-VF.otf", f"{family}-VF.ttf"])
    assert r["variableNote"] is None


def test_export_only_what_is_chosen(project):
    two_weights(project, SQUARE, HEAVY)
    client = TestClient(create_app(project, watch=False))
    family = project.font.info.familyName
    r = client.post("/api/export", json={"staticFormats": ["ttf"], "weights": ["Bold"], "variableFormats": []}).json()
    assert [Path(p).name for p in r["paths"]] == [f"{family}-Bold.ttf"]
    r = client.post("/api/export", json={"staticFormats": [], "variableFormats": ["otf"]}).json()
    assert [Path(p).name for p in r["paths"]] == [f"{family}-VF.otf"]
    assert client.post("/api/export", json={"staticFormats": [], "variableFormats": []}).status_code == 400
    assert client.post("/api/export", json={"weights": ["Nope"]}).status_code == 400
