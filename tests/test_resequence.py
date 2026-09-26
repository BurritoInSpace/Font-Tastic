"""Point order fixes: contour order, direction and start points across weights."""

import importlib.util
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from fonttastic import resequence
from fonttastic.project import RESEQUENCE, Project, ProjectError
from fonttastic.server import create_app

spec = importlib.util.spec_from_file_location("make_demo", Path(__file__).parent.parent / "examples" / "make_demo.py")
make_demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_demo)


def svg(body, w=600):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 1000">{body}</svg>'.encode()


SQUARE = '<path d="M100,100 H400 V800 H100 Z"/>'
SQUARE_OTHER_START = '<path d="M400,800 H100 V100 H400 Z"/>'
# a hump: two lines and a curve, so segment types matter when reversing
HUMP = [(0, 0, "line", False), (100, 0, "line", False), (100, 60, None, False), (0, 60, None, False),
        (0, 20, "curve", True)]


@pytest.fixture
def project(tmp_path):
    make_demo.main(tmp_path)
    p = Project(tmp_path)
    p.import_all()
    return p


def two_weights(project, regular: str, bold: str, name="uni05D2"):
    project.add_svg(svg(regular), name)
    project.add_weight("Bold", 700, "Regular")  # now editing Bold
    (project.glyphs_dir / f"{name}.svg").write_bytes(svg(bold))
    project.import_all()


def fixable(project, name="uni05D2"):
    return [p["type"] for p in project.compatibility()["glyphs"].get(name, []) if p["severity"] == "fixable"]


# -- contour operations -------------------------------------------------------


def test_reverse_keeps_the_first_point_and_moves_segment_types():
    rev = resequence.reverse(HUMP)
    assert rev[0][:2] == HUMP[0][:2]
    # 0 -> (0,20) is the old closing line, then the curve back to (100,0)
    assert [p[:3] for p in rev] == [(0, 0, "line"), (0, 20, "line"), (0, 60, None), (100, 60, None), (100, 0, "curve")]
    assert resequence.reverse(rev) == HUMP
    assert (resequence.signed_area(rev) > 0) != (resequence.signed_area(HUMP) > 0)


def test_edit_start_move_and_reverse():
    square = [(0, 0, "line", False), (10, 0, "line", False), (10, 10, "line", False), (0, 10, "line", False)]
    dot = [(20, 20, "line", False), (22, 20, "line", False), (22, 22, "line", False), (20, 22, "line", False)]
    raw = [square, dot]
    r = resequence.edit(raw, None, "start", 0, 2)
    assert resequence.apply(raw, r)[0][0][:2] == (10, 10)
    r = resequence.edit(raw, r, "start", 0, 1)  # relative to what's shown now
    assert resequence.apply(raw, r)[0][0][:2] == (0, 10)
    r = resequence.edit(raw, r, "reverse", 0)
    shown = resequence.apply(raw, r)[0]
    assert shown[0][:2] == (0, 10) and shown[1][:2] == (10, 10)  # same start, other way round
    r = resequence.edit(raw, r, "move", 1, 0)
    assert resequence.apply(raw, r)[0] == dot
    with pytest.raises(resequence.ResequenceError):
        resequence.edit(raw, r, "start", 5, 0)


def test_recipe_only_fits_the_same_structure():
    raw = [HUMP]
    recipe = resequence.edit(raw, None, "start", 0, 1)
    assert resequence.apply(raw, recipe) is not None
    moved = [[(x + 5, y, t, s) for x, y, t, s in HUMP]]  # same points, nudged: still fits
    assert resequence.apply(moved, recipe) is not None
    assert resequence.apply([HUMP[:4] + [(0, 0, "line", False)]], recipe) is None


def test_match_finds_order_and_start():
    a = [(0, 0, "line", False), (10, 0, "line", False), (10, 10, "line", False), (0, 10, "line", False)]
    b = [(50, 0, "line", False), (80, 0, "line", False), (80, 30, "line", False), (50, 30, "line", False)]
    bold_b = resequence.rotate([(48, 0, "line", False), (84, 0, "line", False), (84, 30, "line", False),
                                (48, 30, "line", False)], 2)
    bold_a = [(0, 0, "line", False), (14, 0, "line", False), (14, 10, "line", False), (0, 10, "line", False)]
    recipe = resequence.match([a, b], [bold_b, bold_a])
    fixed = resequence.apply([bold_b, bold_a], recipe)
    assert fixed[0][0][:2] == (0, 0) and fixed[1][0][:2] == (48, 0)


def test_match_refuses_different_contour_counts():
    with pytest.raises(resequence.ResequenceError, match="needs redrawing"):
        resequence.match([HUMP], [HUMP, HUMP])


# -- in a project -------------------------------------------------------------


def test_match_fixes_start_point_and_survives_reimport(project):
    two_weights(project, SQUARE, SQUARE_OTHER_START)
    assert fixable(project) == ["wrong_start_point"]
    result = project.match_to_default("uni05D2")
    assert result == {"changed": ["Bold"], "errors": {}}
    assert fixable(project) == []
    assert RESEQUENCE in project.font["uni05D2"].lib

    # Edited in Illustrator (same points, moved): the fix is applied again.
    (project.glyphs_dir / "uni05D2.svg").write_bytes(svg('<path d="M420,820 H80 V100 H420 Z"/>'))
    project.import_all(force=True)
    assert fixable(project) == []

    # Redrawn with another point: the fix no longer fits and is dropped, with a warning.
    (project.glyphs_dir / "uni05D2.svg").write_bytes(svg('<path d="M420,820 H250 H80 V100 H420 Z"/>'))
    project.import_all(force=True)
    glyph = project.font["uni05D2"]
    assert RESEQUENCE not in glyph.lib
    assert any("no longer fits" in w for w in glyph.lib["com.fonttastic.warnings"])


def test_match_fixes_contour_order(project):
    left, right = '<path d="M50,100 H150 V300 H50 Z"/>', '<path d="M300,100 H550 V800 H300 Z"/>'
    two_weights(project, left + right, right.replace("300", "280") + left)
    assert "contour_order" in fixable(project)
    project.match_all_to_default()
    assert fixable(project) == []


def test_match_all_reports_what_needs_redrawing(project):
    two_weights(project, SQUARE, SQUARE_OTHER_START)
    assert project.match_all_to_default() == {"fixed": ["uni05D2"], "errors": {}}
    assert project.match_all_to_default() == {"fixed": [], "errors": {}}


def test_manual_start_point_and_reset(project):
    two_weights(project, SQUARE, SQUARE)
    first = lambda: project.point_order("uni05D2")["contours"][0]["points"][0][:2]
    start = first()
    project.edit_point_order("uni05D2", "start", 0, 2)
    assert first() != start
    assert project.point_order("uni05D2")["fixed"]
    assert fixable(project) == ["wrong_start_point"]
    project.edit_point_order("uni05D2", "reset")
    assert first() == start and not project.point_order("uni05D2")["fixed"]
    with pytest.raises(ProjectError):
        project.edit_point_order("uni05D2", "move", 0, 3)


def test_point_order_shows_the_default_for_comparison(project):
    two_weights(project, SQUARE, SQUARE_OTHER_START)
    view = project.point_order("uni05D2")
    assert view["defaultWeight"] == "Regular"
    assert view["reference"]["contours"][0]["points"][0][:2] != view["contours"][0]["points"][0][:2]
    project.switch_weight("Regular")
    assert project.point_order("uni05D2")["reference"] is None


def test_endpoints(project):
    two_weights(project, SQUARE, SQUARE_OTHER_START)
    client = TestClient(create_app(project, watch=False))
    assert client.get("/api/glyphs/uni05D2/points").json()["defaultWeight"] == "Regular"
    res = client.post("/api/compat/fix").json()
    assert res["fixed"] == ["uni05D2"] and res["compat"]["fixable"] == 0
    res = client.post("/api/glyphs/uni05D2/points", json={"op": "start", "contour": 0, "value": 99})
    assert res.status_code == 400
