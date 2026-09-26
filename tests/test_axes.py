"""Several variation axes: width, optical size, slant and custom ones next to weight."""

import importlib.util
import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from fontTools.ttLib import TTFont

from fonttastic import variable
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


def locations(project):
    return {w.name: w.location for w in project.weights}


def test_adding_an_axis_places_every_master_on_it(project):
    project.add_weight("Bold", 700, "Regular")
    project.add_axis("wdth", "", 100)
    assert project.axes == [{"tag": "wght", "name": "Weight"}, {"tag": "wdth", "name": "Width"}]
    assert locations(project) == {"Regular": {"wght": 400, "wdth": 100}, "Bold": {"wght": 700, "wdth": 100}}
    s = variable.settings(project)
    assert [(a["tag"], a["active"]) for a in s["axes"]] == [("wght", True), ("wdth", False)]

    reopened = Project(project.file)
    assert reopened.axes == project.axes and locations(reopened) == locations(project)


def test_master_on_a_second_axis(project):
    project.add_weight("Bold", 700, "Regular")
    project.add_axis("wdth", "Width", 100)
    project.add_weight("Condensed", None, "Regular", {"wdth": 75})
    assert project.active.location == {"wght": 400, "wdth": 75}
    assert project.font.info.openTypeOS2WidthClass == 3  # Condensed
    assert [w.name for w in project.weights] == ["Condensed", "Regular", "Bold"]

    s = variable.settings(project)
    wdth = s["axes"][1]
    assert (wdth["min"], wdth["default"], wdth["max"], wdth["active"]) == (75, 100, 100, True)
    assert s["missingCorners"] == [{"wght": 700, "wdth": 75}]  # no Bold Condensed drawn
    assert {"name": "Condensed", "location": {"wght": 400, "wdth": 75}} in s["instances"]

    font = TTFont(io.BytesIO(variable.compile_variable(project, "cff2")))
    assert [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes] == [
        ("wght", 400, 400, 700), ("wdth", 75, 100, 100)]


def test_locations_must_differ(project):
    project.add_axis("wdth", "Width", 100)
    with pytest.raises(ProjectError, match="Regular is already at 400, wdth 100"):
        project.add_weight("Copy", None, "Regular", {})
    with pytest.raises(ProjectError, match="Width must be between"):
        project.add_weight("Squashed", None, "Regular", {"wdth": 0})


def test_moving_a_master(project):
    project.add_weight("Bold", 700, "Regular")
    project.set_master_location("Bold", {"wght": 800})
    assert project.weight_by_name("Bold").weight == 800
    project.switch_weight("Bold")
    assert project.font.info.openTypeOS2WeightClass == 800
    with pytest.raises(ProjectError, match="already at 400"):
        project.set_master_location("Bold", {"wght": 400})


def test_removing_an_axis(project):
    project.add_axis("wdth", "Width", 100)
    project.add_weight("Condensed", None, "Regular", {"wdth": 75})
    with pytest.raises(ProjectError, match="differ only in Width"):
        project.remove_axis("wdth")
    project.delete_weight("Condensed")
    project.remove_axis("wdth")
    assert project.axes == [{"tag": "wght", "name": "Weight"}]
    assert locations(project) == {"Regular": {"wght": 400}}
    with pytest.raises(ProjectError, match="always an axis"):
        project.remove_axis("wght")


def test_axis_tags(project):
    project.add_axis("SERF", "Serif", 0)
    with pytest.raises(ProjectError, match="isn't an axis tag"):
        project.add_axis("serf", "Serif", 0)
    with pytest.raises(ProjectError, match="already has a SERF"):
        project.add_axis("SERF", "Other", 0)
    with pytest.raises(ProjectError, match="already has an axis called serif"):
        project.add_axis("SRF2", "serif", 0)


def test_slant_sets_italic_angle(project):
    project.add_axis("slnt", "", 0)
    project.add_weight("Oblique", None, "Regular", {"slnt": -12})
    assert project.font.info.italicAngle == -12


def test_endpoints(project):
    client = TestClient(create_app(project, watch=False))
    setup = client.get("/api/variable").json()
    assert setup["available"] is False and "wdth" in setup["presets"]
    res = client.post("/api/axes", json={"tag": "wdth"}).json()
    assert [a["tag"] for a in res["project"]["axes"]] == ["wght", "wdth"]
    res = client.post("/api/weights", json={"name": "Wide", "copyFrom": "Regular", "location": {"wdth": 125}}).json()
    assert res["project"]["weights"][1]["location"] == {"wght": 400, "wdth": 125}
    res = client.post("/api/weights/location", json={"name": "Wide", "location": {"wdth": 150}}).json()
    assert res["variable"]["axes"][1]["max"] == 150
    assert client.post("/api/axes/delete", json={"tag": "wdth"}).status_code == 400
