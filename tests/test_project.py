"""Project files, conversion, portability, snapshots, recent projects."""

import json
import shutil

import pytest
from fastapi.testclient import TestClient

from fonttastic import recent
from fonttastic.project import NeedsConversion, Project, ProjectError
from fonttastic.server import create_app

SQUARE = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 1000"><rect x="50" y="100" width="400" height="700"/></svg>'
TALL = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 1000"><rect x="50" y="0" width="200" height="800"/></svg>'


def test_create_makes_self_contained_layout(tmp_path):
    p = Project.create(tmp_path / "My Font", "My Font")
    root = tmp_path / "My Font"
    assert p.file == root / "My Font.fonttastic"
    assert (root / "glyphs").is_dir() and (root / "build").is_dir() and (root / "font.ufo").is_dir()
    data = json.loads(p.file.read_text(encoding="utf-8"))
    assert data["format"] == "fonttastic-project" and data["paths"]["glyphs"] == "glyphs"
    assert p.font.info.familyName == "My Font"


def test_open_by_file_or_folder(tmp_path):
    p = Project.create(tmp_path / "A", "A")
    assert Project(p.file).root == Project(tmp_path / "A").root


def test_create_refuses_non_empty_folder(tmp_path):
    (tmp_path / "stuff.txt").write_text("x")
    with pytest.raises(ProjectError):
        Project.create(tmp_path, "X")


def test_random_folder_is_not_touched(tmp_path):
    with pytest.raises(ProjectError):
        Project(tmp_path)
    assert list(tmp_path.iterdir()) == []


def test_legacy_folder_needs_explicit_conversion(tmp_path):
    (tmp_path / "glyphs").mkdir()
    (tmp_path / "glyphs" / "uni05D0.svg").write_bytes(SQUARE)
    with pytest.raises(NeedsConversion):
        Project(tmp_path)
    assert not list(tmp_path.glob("*.fonttastic"))  # nothing written by the failed open
    p = Project.convert(tmp_path)
    p.import_all()
    assert p.file.parent == tmp_path and "uni05D0" in p.font


def test_project_folder_is_portable(tmp_path):
    p = Project.create(tmp_path / "a" / "Proj", "Proj")
    (p.glyphs_dir / "uni05D0.svg").write_bytes(SQUARE)
    p.import_all()
    p.set_anchors("uni05D0", [{"name": "top", "x": 1, "y": 2}])
    shutil.move(str(tmp_path / "a" / "Proj"), str(tmp_path / "b"))
    moved = Project(tmp_path / "b")
    assert moved.import_all()["unchanged"] == 1  # nothing looks changed after the move
    assert [a.name for a in moved.font["uni05D0"].anchors] == ["top"]


def test_settings_persist(tmp_path):
    p = Project.create(tmp_path / "P", "P")
    p.save_settings({"previewText": "שלום"})
    assert Project(p.file).settings == {"previewText": "שלום"}


def test_replace_is_undoable_via_snapshot(tmp_path):
    p = Project.create(tmp_path / "P", "P")
    p.add_svgs([(SQUARE, "uni05D0", False)])
    p.set_anchors("uni05D0", [{"name": "top", "x": 5, "y": 5}])
    assert p.snapshots() == []  # adding new glyphs isn't destructive

    p.add_svgs([(TALL, "uni05D0", True)])
    assert p.font["uni05D0"].width == 300
    (snap,) = p.snapshots()
    assert "uni05D0" in snap["reason"] and snap["files"] == ["uni05D0.svg"]

    p.restore(snap["id"])
    assert p.font["uni05D0"].width == 500
    assert (p.glyphs_dir / "uni05D0.svg").read_bytes() == SQUARE  # the SVG comes back too
    assert p.import_all()["unchanged"] >= 1  # and it doesn't look modified afterwards
    assert len(p.snapshots()) == 2  # the restore itself can be undone


def test_metric_change_snapshots(tmp_path):
    p = Project.create(tmp_path / "P", "P")
    p.set_info({"familyName": "Renamed"})
    assert p.snapshots() == []
    p.set_info({"ascender": 900})
    assert len(p.snapshots()) == 1


def test_restore_rejects_bad_ids(tmp_path):
    p = Project.create(tmp_path / "P", "P")
    with pytest.raises(ProjectError):
        p.restore("../../etc")


def test_recent_projects(tmp_path):
    a = Project.create(tmp_path / "A", "A")
    b = Project.create(tmp_path / "B", "B")
    recent.touch(a.file, "A")
    recent.touch(b.file, "B")
    recent.touch(a.file, "A")
    assert [e["name"] for e in recent.load()] == ["A", "B"]
    shutil.rmtree(tmp_path / "A")
    assert [e["exists"] for e in recent.load()] == [False, True]
    assert recent.last_existing() == b.file
    recent.remove(str(b.file))
    assert [e["name"] for e in recent.load()] == ["A"]


def test_project_api(tmp_path):
    client = TestClient(create_app())
    assert client.get("/api/project").json() == {"project": None}

    r = client.post("/api/project/new", json={"parent": str(tmp_path), "name": "Web"})
    assert r.status_code == 200 and r.json()["project"]["name"] == "Web"
    assert client.get("/api/recent").json()["recent"][0]["name"] == "Web"
    assert client.post("/api/project/new", json={"parent": str(tmp_path), "name": "Web"}).status_code == 400

    client.post("/api/project/close")
    assert client.get("/api/project").json() == {"project": None}

    legacy = tmp_path / "old"
    (legacy / "glyphs").mkdir(parents=True)
    r = client.post("/api/project/open", json={"path": str(legacy)})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "needs-conversion"
    r = client.post("/api/project/convert", json={"path": str(legacy)})
    assert r.status_code == 200 and r.json()["project"]["file"].endswith(".fonttastic")

    r = client.put("/api/project/settings", json={"previewText": "אב"})
    assert r.json()["settings"]["previewText"] == "אב"
    assert client.get("/api/snapshots").json() == {"snapshots": []}
