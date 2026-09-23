"""End to end: demo SVGs -> UFO -> OTF -> HarfBuzz shaping, plus the HTTP API."""

import importlib.util
import os
from pathlib import Path

import pytest
import uharfbuzz as hb
from fastapi.testclient import TestClient

from fonttastic.build import compile_otf
from fonttastic.project import Project
from fonttastic.server import create_app

spec = importlib.util.spec_from_file_location("make_demo", Path(__file__).parent.parent / "examples" / "make_demo.py")
make_demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_demo)


@pytest.fixture
def project(tmp_path):
    make_demo.main(tmp_path)
    p = Project(tmp_path)
    report = p.import_all()
    assert not report["errors"]
    return p


def shape(data, text, features=None):
    font = hb.Font(hb.Face(data))
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(font, buf, features or {})
    return buf.direction, [
        (font.glyph_to_string(i.codepoint), p.x_offset, p.y_offset)
        for i, p in zip(buf.glyph_infos, buf.glyph_positions)
    ]


def test_seeded_anchors(project):
    shin = {a.name for a in project.font["uni05E9"].anchors}
    assert shin == {"top", "bottom", "dagesh", "shindot", "sindot"}
    assert [a.name for a in project.font["uni05B7"].anchors] == ["_bottom"]
    assert project.font["uni05B7"].width == 0


def test_marks_attach_to_anchors(project):
    project.set_anchors("uni05D1", [{"name": "bottom", "x": 123, "y": 0}, {"name": "dagesh", "x": 300, "y": 350}])
    direction, glyphs = shape(compile_otf(project.font), "בַ")  # bet + patah
    assert direction == "rtl"
    offsets = dict((name, (dx, dy)) for name, dx, dy in glyphs)
    assert offsets["uni05B7"] == (123 - 300, 0)  # base anchor minus mark's _bottom anchor


def test_ligature_and_alternate(project):
    data = compile_otf(project.font)
    assert [g[0] for g in shape(data, "אל")[1]] == ["uni05D0_uni05DC.liga"]
    assert [g[0] for g in shape(data, "ב", {"salt": True})[1]] == ["uni05D1.salt"]
    assert [g[0] for g in shape(data, "ב")[1]] == ["uni05D1"]


def test_reimport_keeps_app_owned_data(project):
    project.set_anchors("uni05D1", [{"name": "bottom", "x": 111, "y": 0}])
    project.set_width("uni05D1", 640)
    svg = project.glyphs_dir / "uni05D1.svg"
    os.utime(svg, (svg.stat().st_atime, svg.stat().st_mtime + 10))  # "saved in Illustrator"

    report = project.import_all()
    assert report["imported"] == ["uni05D1"]
    reloaded = Project(project.root)  # and it all round-trips through the UFO on disk
    glyph = reloaded.font["uni05D1"]
    assert [(a.name, a.x) for a in glyph.anchors] == [("bottom", 111)]
    assert glyph.width == 640


def test_reset_width_rereads_artboard(project):
    project.set_width("uni05D1", 640)
    project.set_width("uni05D1", None)
    assert project.font["uni05D1"].width == 600


def test_api(project):
    client = TestClient(create_app(project))
    summary = client.get("/api/project").json()["project"]
    assert {g["name"] for g in summary["glyphs"]} >= {"uni05D0", "uni05B7", ".notdef", "space"}

    r = client.put("/api/glyphs/uni05D1/anchors", json={"anchors": [{"name": "top", "x": 1, "y": 2}]})
    assert r.status_code == 200 and r.json()["anchors"] == [{"name": "top", "x": 1, "y": 2}]

    r = client.get("/api/font.otf")
    assert r.status_code == 200 and r.content[:4] == b"OTTO"
    assert client.get("/api/glyphs/nope").status_code == 400

    r = client.post("/api/export")
    assert r.status_code == 200 and Path(r.json()["path"]).exists()


def test_kerning_pair_in_reading_order(project):
    def advances(data):
        font = hb.Font(hb.Face(data))
        buf = hb.Buffer()
        buf.add_str("בת")  # bet, tav — bet on the right
        buf.guess_segment_properties()
        hb.shape(font, buf, {})
        return sum(p.x_advance for p in buf.glyph_positions)

    before = advances(compile_otf(project.font))
    project.set_kerning("uni05D1", "uni05EA", -80)
    assert advances(compile_otf(project.font)) == before - 80
    assert Project(project.root).font.kerning[("uni05D1", "uni05EA")] == -80

    project.set_kerning("uni05D1", "uni05EA", 0)  # zero removes the pair
    assert ("uni05D1", "uni05EA") not in project.font.kerning


def test_kerning_api(project):
    client = TestClient(create_app(project))
    r = client.put("/api/kerning", json={"first": "uni05D1", "second": "uni05EA", "value": -40})
    assert r.status_code == 200
    assert r.json()["kerning"] == [{"first": "uni05D1", "second": "uni05EA", "value": -40}]
    assert client.put("/api/kerning", json={"first": "nope", "second": "uni05EA", "value": 1}).status_code == 400


# -- "Import SVGs" button -------------------------------------------------------

SQUARE = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 1000"><rect x="50" y="100" width="400" height="700"/></svg>'


def test_analyze_upload_classifies_files(project):
    assert project.analyze_upload("alef.svg", SQUARE)["status"] == "duplicate"
    new = project.analyze_upload("ג.svg", SQUARE)  # gimel, not in the demo
    assert (new["status"], new["glyphName"], new["unicode"]) == ("new", "uni05D2", 0x05D2)
    assert new["path"]
    assert project.analyze_upload("Artboard 1.svg", SQUARE)["status"] == "unknown"
    assert project.analyze_upload("kaf-sofit.svg", SQUARE)["glyphName"] == "uni05DA"
    assert project.analyze_upload("broken.svg", b"<svg")["status"] == "invalid"


def test_add_svg_new_glyph_is_saved_canonically(project):
    project.add_svg(SQUARE, "uni05D2")
    assert (project.glyphs_dir / "uni05D2.svg").read_bytes() == SQUARE
    glyph = project.font["uni05D2"]
    assert glyph.unicodes == [0x05D2] and glyph.width == 500
    assert {a.name for a in glyph.anchors} == {"top", "bottom", "dagesh"}


def test_add_svg_replace_keeps_anchors(project):
    project.set_anchors("uni05D1", [{"name": "bottom", "x": 7, "y": 0}])
    with pytest.raises(Exception):
        project.add_svg(SQUARE, "uni05D1")  # exists, not replacing
    project.add_svg(SQUARE, "uni05D1", replace=True)
    assert (project.glyphs_dir / "uni05D1.svg").read_bytes() == SQUARE
    assert [(a.name, a.x) for a in project.font["uni05D1"].anchors] == [("bottom", 7)]


def test_numbered_alternates_inherit_anchors_and_compile(project):
    project.add_svg(SQUARE, "uni05D1.salt.2")  # the demo already has uni05D1.salt
    alt = project.font["uni05D1.salt.2"]
    assert alt.unicodes == []
    assert {a.name for a in alt.anchors} == {a.name for a in project.font["uni05D1"].anchors}
    assert "sub uni05D1 from [uni05D1.salt uni05D1.salt.2];" in project.font.features.text
    data = compile_otf(project.font)
    assert [g[0] for g in shape(data, "ב", {"salt": 2})[1]] == ["uni05D1.salt.2"]


def test_add_svg_rejects_unsafe_names(project):
    for bad in ("../evil", "a/b", ".hidden", "uni05D0-Bold"):
        with pytest.raises(Exception):
            project.add_svg(SQUARE, bad)


def test_import_api(project):
    import base64

    client = TestClient(create_app(project))
    data = base64.b64encode(SQUARE).decode()
    r = client.post("/api/import/analyze", json={"files": [{"filename": "gimel.svg", "data": data}]})
    assert r.json()["files"][0]["glyphName"] == "uni05D2"
    r = client.post("/api/import/add", json={"files": [
        {"data": data, "glyphName": "uni05D2"},
        {"data": data, "glyphName": "uni05D0"},  # exists, replace not asked -> reported
    ]})
    body = r.json()
    assert body["added"] == ["uni05D2"] and "uni05D0" in body["errors"]
