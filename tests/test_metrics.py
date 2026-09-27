"""Side bearings and width, set by moving the edges of the SVG's artboard."""

import importlib.util
from pathlib import Path

import pytest

from fonttastic.project import Project, ProjectError
from fonttastic.svg_import import artboard

spec = importlib.util.spec_from_file_location("make_demo", Path(__file__).parent.parent / "examples" / "make_demo.py")
make_demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_demo)


def svg(body, box="0 0 600 1000"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}">{body}</svg>'.encode()


SQUARE = '<path d="M100,100 H400 V800 H100 Z"/>'  # ink x 100-400 on a 600 wide artboard


@pytest.fixture
def project(tmp_path):
    make_demo.main(tmp_path)
    p = Project(tmp_path)
    p.import_all()
    p.add_svg(svg(SQUARE), "uni05D2")
    return p


def sidebearings(project, name="uni05D2"):
    g = project.glyph_detail(name)
    return round(g["bounds"][0]), g["width"], round(g["width"] - g["bounds"][2])


def test_left_side_bearing_moves_the_artboard(project):
    assert sidebearings(project) == (100, 600, 200)
    top = next(a for a in project.font["uni05D2"].anchors if a.name == "top")
    x_before = top.x
    project.set_metrics("uni05D2", lsb=50)
    assert sidebearings(project) == (50, 550, 200)  # the right side bearing stays
    assert next(a for a in project.font["uni05D2"].anchors if a.name == "top").x == x_before - 50
    svg_file = project.glyphs_dir / "uni05D2.svg"
    assert artboard(svg_file.read_bytes()) == (50, 0, 550, 1000)
    assert b"M100,100 H400 V800 H100 Z" in svg_file.read_bytes()  # the drawing itself is untouched


def test_right_side_bearing_and_width(project):
    project.set_metrics("uni05D2", rsb=80)
    assert sidebearings(project) == (100, 480, 80)
    project.set_metrics("uni05D2", width=500)
    assert sidebearings(project) == (100, 500, 100)  # width keeps the left side bearing


def test_survives_reimport(project):
    project.set_metrics("uni05D2", lsb=60, rsb=60)
    project.import_all(force=True)
    assert sidebearings(project) == (60, 420, 60)


def test_small_artboard(project):
    # A 10 px tall artboard: 1 SVG unit = 100 font units.
    project.add_svg(svg('<path d="M1,1 H4 V8 H1 Z"/>', "0 0 6 10"), "uni05D6")
    assert sidebearings(project, "uni05D6") == (100, 600, 200)
    project.set_metrics("uni05D6", lsb=40, rsb=40)
    assert sidebearings(project, "uni05D6") == (40, 380, 40)
    assert artboard((project.glyphs_dir / "uni05D6.svg").read_bytes()) == (0.6, 0, 3.8, 10)


def test_glyph_without_svg(project):
    project.set_metrics("space", width=300)
    assert project.font["space"].width == 300
    with pytest.raises(ProjectError, match="no SVG"):
        project.set_metrics("space", lsb=10)


def test_width_must_stay_positive(project):
    with pytest.raises(ProjectError, match="zero or less"):
        project.set_metrics("uni05D2", lsb=-200, rsb=-200)


# -- bulk actions ---------------------------------------------------------------------


def test_bulk_side_bearings(project):
    letters = ["uni05D0", "uni05D1", "uni05D2"]
    before = len(project.snapshots())
    result = project.bulk_metrics([*letters, "uni05B7", "space"], lsb=30, rsb=40)
    assert result["changed"] == letters
    assert result["skipped"] == {"uni05B7": "a mark", "space": "no SVG"}
    for name in letters:
        lsb, _, rsb = sidebearings(project, name)
        assert (lsb, rsb) == (30, 40)
    assert len(project.snapshots()) == before + 1


def test_bulk_side_bearings_in_every_master(project):
    project.add_weight("Bold", 700, "Regular")
    project.bulk_metrics(["uni05D2"], rsb=10, all_masters=True)
    assert sidebearings(project)[2] == 10
    project.switch_weight("Regular")
    assert sidebearings(project)[2] == 10
    with pytest.raises(ProjectError, match="Give a left or right"):
        project.bulk_metrics(["uni05D2"])


def test_bulk_anchors(project):
    marks = [g.name for g in project.font if any(a.name == "_bottom" for a in g.anchors)]
    result = project.bulk_anchors("_bottom", y=-40, x="center")
    assert result["changed"] == sorted(marks)
    for name in marks:
        g = project.font[name]
        (a,) = [a for a in g.anchors if a.name == "_bottom"]
        bounds = project.glyph_detail(name)["bounds"]
        assert a.y == -40 and a.x == round((bounds[0] + bounds[2]) / 2)
    project.bulk_anchors("top", names=["uni05D0"], y=720)
    assert next(a.y for a in project.font["uni05D0"].anchors if a.name == "top") == 720
    assert next(a.y for a in project.font["uni05D1"].anchors if a.name == "top") != 720
