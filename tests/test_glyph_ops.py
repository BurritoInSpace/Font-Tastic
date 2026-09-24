"""Deleting and reassigning glyphs."""

import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fontTools.ttLib import TTFont

from fonttastic.build import compile_otf
from fonttastic.project import Project, ProjectError
from fonttastic.server import create_app

spec = importlib.util.spec_from_file_location("make_demo", Path(__file__).parent.parent / "examples" / "make_demo.py")
make_demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_demo)


@pytest.fixture
def project(tmp_path):
    make_demo.main(tmp_path)
    p = Project(tmp_path)
    p.import_all()
    return p


def cmap(project):
    import io

    return TTFont(io.BytesIO(compile_otf(project.font)))["cmap"].getBestCmap()


def anchors(project, name):
    return [(a.name, a.x, a.y) for a in project.font[name].anchors]


def test_delete_glyph_removes_references_and_is_restorable(project):
    project.set_kern_group(1, "g", ["uni05D0", "uni05D1"])
    project.set_kerning("uni05D0", "uni05EA", -30)
    project.set_kerning("uni05D1", "uni05EA", -20)
    svg = project.glyphs_dir / "uni05D0.svg"
    original = svg.read_bytes()

    removed = project.delete_glyph("uni05D0")  # alef: also a component of the alef-lamed ligature
    assert removed == {"kerning": 1, "groups": 1, "ligatures": 1}
    assert "uni05D0" not in project.font and not svg.exists()
    assert project.font.kerning == {("uni05D1", "uni05EA"): -20}
    assert project.kern_groups()["1"] == {"g": ["uni05D1"]}
    assert 0x05D0 not in cmap(project)

    (snap,) = project.snapshots()
    assert snap["files"] == ["uni05D0.svg"]
    project.restore(snap["id"])
    assert "uni05D0" in project.font and svg.read_bytes() == original


def test_cannot_delete_automatic_glyphs(project):
    for name in (".notdef", "space"):
        with pytest.raises(ProjectError):
            project.delete_glyph(name)


def test_rename_reassigns_character_and_keeps_anchors(project):
    project.set_anchors("uni05D3", [{"name": "top", "x": 11, "y": 700}])
    project.set_kerning("uni05D3", "uni05D1", -40)
    project.rename_glyph("uni05D3", "uni05E8")  # "that was a resh, not a dalet"

    assert "uni05D3" not in project.font and not (project.glyphs_dir / "uni05D3.svg").exists()
    assert (project.glyphs_dir / "uni05E8.svg").exists()
    glyph = project.font["uni05E8"]
    assert glyph.unicodes == [0x05E8] and glyph.lib["com.fonttastic.source"] == "uni05E8.svg"
    assert anchors(project, "uni05E8") == [("top", 11, 700)]  # letter -> letter: kept
    assert project.font.kerning == {("uni05E8", "uni05D1"): -40}
    table = cmap(project)
    assert table[0x05E8] == "uni05E8" and 0x05D3 not in table
    assert project.import_all()["imported"] == []  # nothing looks changed on disk afterwards


def test_rename_onto_existing_glyph_needs_swap(project):
    dalet = project.glyph_detail("uni05D3")["bounds"]
    he = project.glyph_detail("uni05D4")["bounds"]
    with pytest.raises(ProjectError):
        project.rename_glyph("uni05D3", "uni05D4")
    project.rename_glyph("uni05D3", "uni05D4", swap=True)
    assert project.glyph_detail("uni05D4")["bounds"] == dalet
    assert project.glyph_detail("uni05D3")["bounds"] == he
    assert project.font["uni05D3"].unicodes == [0x05D3]


def test_rename_moves_alternates_along(project):
    project.rename_glyph("uni05D1", "uni05D2")  # bet was really gimel
    assert "uni05D2.salt" in project.font and "uni05D1.salt" not in project.font
    assert (project.glyphs_dir / "uni05D2.salt.svg").exists()
    assert "sub uni05D2 by uni05D2.salt;" in project.font.features.text


def test_role_change_reseeds_anchors(project):
    project.rename_glyph("uni05E0", "uni05B6")  # nun -> segol: letter becomes a mark
    segol = project.font["uni05B6"]
    assert segol.width == 0 and [a.name for a in segol.anchors] == ["_bottom"]

    project.set_anchors("uni05B4", [{"name": "_bottom", "x": 1, "y": 2}])
    project.rename_glyph("uni05B4", "uni05C7")  # hiriq -> qamats qatan: both attach at the bottom
    assert anchors(project, "uni05C7") == [("_bottom", 1, 2)]
    project.rename_glyph("uni05C7", "uni05BF")  # -> rafe: attaches at the top
    assert [a.name for a in project.font["uni05BF"].anchors] == ["_top"]


def test_rename_validation(project):
    for bad in ("uni05D0", "../x", "uni05D0-Bold"):
        with pytest.raises(ProjectError):
            project.rename_glyph("uni05D0", bad)
    with pytest.raises(ProjectError):
        project.rename_glyph("space", "uni00A0")  # automatic


def test_glyph_ops_api(project):
    client = TestClient(create_app(project, watch=False))
    r = client.post("/api/glyphs/uni05D3/rename", json={"newName": "uni05E8"})
    assert r.status_code == 200 and r.json()["renamed"] == {"uni05D3": "uni05E8"}
    assert client.post("/api/glyphs/uni05E8/rename", json={"newName": "uni05D4"}).status_code == 400
    r = client.post("/api/glyphs/uni05E8/delete")
    assert r.status_code == 200 and "uni05E8" not in {g["name"] for g in r.json()["project"]["glyphs"]}


def test_alternates_stay_put_when_base_becomes_an_alternate(project):
    project.rename_glyph("uni05D1", "uni05DB.salt")  # bet was really a kaf alternate
    assert "uni05D1.salt" in project.font and "uni05DB.salt.salt" not in project.font
