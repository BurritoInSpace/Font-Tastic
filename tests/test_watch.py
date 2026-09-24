"""Filesystem watcher, glyph -> SVG export, Illustrator discovery and the edit endpoint."""

import os
import time

import pytest
from fastapi.testclient import TestClient

from fonttastic import illustrator
from fonttastic.project import Project
from fonttastic.server import create_app
from fonttastic.watcher import GlyphWatcher

SQUARE = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 1000"><rect x="50" y="100" width="400" height="700"/></svg>'
TALL = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 1000"><rect x="50" y="0" width="200" height="800"/></svg>'


@pytest.fixture
def project(tmp_path):
    p = Project.create(tmp_path / "P", "P")
    (p.glyphs_dir / "uni05D0.svg").write_bytes(SQUARE)
    p.import_all()
    return p


def wait_for(condition, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.1)
    return False


def test_unchanged_import_does_not_bump_revision(project):
    rev = project.revision
    project.import_all()
    assert project.revision == rev


def test_watcher_reimports_saved_and_new_files(project):
    reports = []
    watcher = GlyphWatcher(project, reports.append).start()
    try:
        time.sleep(0.5)  # let the OS watch start
        (project.glyphs_dir / "uni05D0.svg").write_bytes(TALL)  # "saved in Illustrator"
        assert wait_for(lambda: project.font["uni05D0"].width == 300), "edit was not picked up"
        (project.glyphs_dir / "uni05D1.svg").write_bytes(SQUARE)
        assert wait_for(lambda: "uni05D1" in project.font), "new file was not picked up"
        assert any("uni05D0" in r["imported"] for r in reports)
    finally:
        watcher.stop()


def test_source_svg_round_trips_outline(project):
    before = project.glyph_detail("uni05D0")["bounds"]
    (project.glyphs_dir / "uni05D0.svg").unlink()
    assert project.glyph_detail("uni05D0")["sourceMissing"]
    path = project.source_svg("uni05D0")  # rewritten from the stored outline
    assert path.name == "uni05D0.svg"
    after = project.glyph_detail("uni05D0")
    assert after["bounds"] == pytest.approx(before, abs=0.01)
    assert after["width"] == 500 and not after["sourceMissing"]


def test_source_svg_for_auto_space(project):
    path = project.source_svg("space")
    assert path.name == "space.svg"
    g = project.font["space"]
    assert g.width == 250 and g.unicodes == [0x20]
    assert project.has_source("space")


def test_find_illustrator_prefers_newest_release(tmp_path, monkeypatch):
    monkeypatch.delenv("FONTTASTIC_ILLUSTRATOR", raising=False)
    adobe = tmp_path / "Adobe"
    for name in ("Adobe Illustrator 2025", "Adobe Illustrator 2026", "Adobe Illustrator (Beta)"):
        exe = adobe / name / illustrator.EXE_IN_INSTALL
        exe.parent.mkdir(parents=True)
        exe.write_bytes(b"")
    assert illustrator.find_illustrator([adobe]).name == "Adobe Illustrator 2026"
    for name in ("Adobe Illustrator 2025", "Adobe Illustrator 2026"):
        os.remove(adobe / name / illustrator.EXE_IN_INSTALL)
    assert illustrator.find_illustrator([adobe]).name == "Adobe Illustrator (Beta)"
    assert illustrator.find_illustrator([tmp_path / "nothing"]) is None


def test_illustrator_override(tmp_path, monkeypatch):
    exe = tmp_path / "Custom" / "Illustrator.exe"
    exe.parent.mkdir()
    exe.write_bytes(b"")
    monkeypatch.setenv("FONTTASTIC_ILLUSTRATOR", str(exe))
    assert illustrator.find_illustrator().path == exe


def test_edit_endpoint(project, monkeypatch):
    opened = []
    monkeypatch.setattr(illustrator, "open_in_illustrator", lambda p: opened.append(p) or "Adobe Illustrator 2026")
    client = TestClient(create_app(project, watch=False))

    r = client.post("/api/glyphs/uni05D0/edit").json()
    assert (r["app"], r["created"]) == ("Adobe Illustrator 2026", False)
    assert opened[-1] == project.glyphs_dir / "uni05D0.svg"

    r = client.post("/api/glyphs/space/edit").json()
    assert r["created"] is True and opened[-1].name == "space.svg"

    assert client.post("/api/glyphs/nope/edit").status_code == 400
    monkeypatch.setattr(illustrator, "reveal_in_file_manager", lambda p: opened.append(("reveal", p)))
    assert client.post("/api/glyphs/uni05D0/reveal").status_code == 200
