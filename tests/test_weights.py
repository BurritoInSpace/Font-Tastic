"""Multiple weights in one project."""

import importlib.util
import io
import json
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

TALL = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 1000"><rect x="50" y="0" width="200" height="800"/></svg>'


@pytest.fixture
def project(tmp_path):
    make_demo.main(tmp_path)
    p = Project(tmp_path)
    p.import_all()
    return p


def test_first_extra_weight_moves_to_folder_layout(project):
    root = project.root
    svg_count = len(list((root / "glyphs").glob("*.svg")))
    project.set_anchors("uni05D1", [{"name": "top", "x": 5, "y": 700}])
    project.add_weight("Bold", 700, "Regular")

    assert [(w.name, w.weight, w.glyphs, w.font) for w in project.weights] == [
        ("Regular", 400, "glyphs/Regular", "masters/Regular.ufo"),
        ("Bold", 700, "glyphs/Bold", "masters/Bold.ufo"),
    ]
    assert not (root / "font.ufo").exists() and not list((root / "glyphs").glob("*.svg"))
    assert len(list((root / "glyphs" / "Regular").glob("*.svg"))) == svg_count
    assert len(list((root / "glyphs" / "Bold").glob("*.svg"))) == svg_count

    # the new weight is active and is a real copy
    assert project.active.name == "Bold"
    assert project.font.info.styleName == "Bold" and project.font.info.openTypeOS2WeightClass == 700
    assert [(a.name, a.x) for a in project.font["uni05D1"].anchors] == [("top", 5)]
    assert project.import_all()["imported"] == []  # copies keep mtimes: nothing to re-import

    data = json.loads(project.file.read_text(encoding="utf-8"))
    assert [w["name"] for w in data["weights"]] == ["Regular", "Bold"]
    assert data["settings"]["currentWeight"] == "Bold"
    reopened = Project(project.root)
    assert reopened.active.name == "Bold"  # reopens on the last weight


def test_weights_are_independent_where_they_should_be(project):
    project.add_weight("Bold", 700, "Regular")
    (project.glyphs_dir / "uni05D1.svg").write_bytes(TALL)  # redraw bet heavier (here: different)
    project.import_all()
    project.set_anchors("uni05D1", [{"name": "top", "x": 1, "y": 700}])
    project.set_kerning("uni05D1", "uni05EA", -50)

    project.switch_weight("Regular")
    assert project.font["uni05D1"].width == 600  # Regular's outline untouched
    assert [(a.name, a.x) for a in project.font["uni05D1"].anchors][0] != ("top", 1)
    assert ("uni05D1", "uni05EA") not in project.font.kerning


def test_shared_structure_applies_to_every_weight(project):
    project.add_weight("Bold", 700, "Regular")
    project.set_kern_group(1, "flat", ["uni05D1", "uni05DB"])
    project.set_ligatures([{"components": ["uni05D0", "uni05DC"], "glyph": "uni05D0_uni05DC.liga", "feature": "dlig"}])
    project.set_info({"familyName": "Shalom", "capHeight": 720})
    project.delete_glyph("uni05D3")
    project.rename_glyph("uni05D4", "uni05D7")  # he -> het

    for name in ("Regular", "Bold"):
        project.switch_weight(name)
        f = project.font
        assert f.groups["public.kern1.flat"] == ["uni05D1", "uni05DB"]
        assert f.lib["com.fonttastic.ligatures"][0]["feature"] == "dlig"
        assert (f.info.familyName, f.info.capHeight) == ("Shalom", 720)
        assert f.info.styleName == name  # style name stays per weight
        assert "uni05D3" not in f and not (project.glyphs_dir / "uni05D3.svg").exists()
        assert "uni05D7" in f and (project.glyphs_dir / "uni05D7.svg").exists()


def test_export_writes_every_weight(project):
    project.add_weight("Light", 300, "Regular")
    paths = project.export_all(lambda font: compile_otf(font, preview=False))
    family = project.font.info.familyName
    assert sorted(p.name for p in paths) == [f"{family}-Light.otf", f"{family}-Regular.otf"]
    weights = {TTFont(io.BytesIO(p.read_bytes()))["OS/2"].usWeightClass for p in paths}
    assert weights == {300, 400}


def test_snapshot_restores_into_its_own_weight(project):
    project.add_weight("Bold", 700, "Regular")
    project.set_kern_group(2, "g", ["uni05EA"])
    project.set_kerning("uni05D1", "public.kern2.g", -20)
    project.delete_kern_group(2, "g")  # snapshots each weight that used it (only Bold has the pair)
    bold_snap = next(s for s in project.snapshots() if s["weight"] == "Bold" and "@g" in s["reason"])
    project.switch_weight("Regular")
    project.restore(bold_snap["id"])
    assert project.active.name == "Regular"  # restoring didn't switch weights
    project.switch_weight("Bold")
    assert project.font.kerning[("uni05D1", "public.kern2.g")] == -20


def test_add_weight_validation(project):
    with pytest.raises(ProjectError):
        project.add_weight("Regular", 700, "Regular")  # name taken
    with pytest.raises(ProjectError):
        project.add_weight("Book", 400, "Regular")  # weight taken
    with pytest.raises(ProjectError):
        project.add_weight("Extra Bold", 800, "Regular")  # not a usable folder name
    with pytest.raises(ProjectError):
        project.add_weight("Bold", 700, "Nope")


def test_delete_weight_keeps_files_aside(project):
    project.add_weight("Bold", 700, "Regular")
    with pytest.raises(ProjectError):
        Project(project.root).delete_weight("Nope")
    project.delete_weight("Bold")
    assert [w.name for w in project.weights] == ["Regular"] and project.active.name == "Regular"
    kept = list((project.snapshots_dir / "removed-weights").iterdir())
    assert len(kept) == 1 and (kept[0] / "Bold").is_dir() and (kept[0] / "Bold.ufo").is_dir()
    with pytest.raises(ProjectError):
        project.delete_weight("Regular")  # the last one stays


def test_version_1_project_opens_as_one_weight(tmp_path):
    make_demo.main(tmp_path)
    data = json.loads(next(tmp_path.glob("*.fonttastic")).read_text(encoding="utf-8"))
    v1 = {"format": "fonttastic-project", "version": 1, "name": data["name"],
          "paths": {"glyphs": "glyphs", "font": "font.ufo", "build": "build", "snapshots": "snapshots"}, "settings": {}}
    next(tmp_path.glob("*.fonttastic")).write_text(json.dumps(v1), encoding="utf-8")
    p = Project(tmp_path)
    assert [(w.name, w.weight, w.glyphs) for w in p.weights] == [("Regular", 400, "glyphs")]
    p.import_all()
    assert "uni05D0" in p.font


def test_weights_api(project):
    client = TestClient(create_app(project, watch=False))
    r = client.post("/api/weights", json={"name": "Bold", "weight": 700, "copyFrom": "Regular"})
    assert r.status_code == 200
    body = r.json()["project"]
    assert body["weight"] == "Bold" and [w["name"] for w in body["weights"]] == ["Regular", "Bold"]
    assert not body["flatLayout"]
    r = client.post("/api/weights/switch", json={"name": "Regular"})
    assert r.json()["project"]["weight"] == "Regular"
    assert client.post("/api/weights/switch", json={"name": "Nope"}).status_code == 400
    r = client.post("/api/weights/delete", json={"name": "Bold"})
    assert [w["name"] for w in r.json()["project"]["weights"]] == ["Regular"]
