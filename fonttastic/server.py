"""Local HTTP API the UI talks to. Single user, single open project."""

from __future__ import annotations

import asyncio
import base64
import binascii
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import illustrator, recent
from .build import CompileCache, CompileError, compile_otf
from .project import NeedsConversion, Project, ProjectError
from .watcher import GlyphWatcher

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


class OpenRequest(BaseModel):
    path: str


class NewProjectRequest(BaseModel):
    parent: str
    name: str


class ImportRequest(BaseModel):
    force: bool = False


class Anchor(BaseModel):
    name: str
    x: float
    y: float


class AnchorsRequest(BaseModel):
    anchors: list[Anchor]


class WidthRequest(BaseModel):
    width: float | None


class LigatureRule(BaseModel):
    components: list[str]
    glyph: str
    feature: str = "liga"


class LigaturesRequest(BaseModel):
    rules: list[LigatureRule]


class UploadFile(BaseModel):
    filename: str
    data: str  # base64


class AnalyzeRequest(BaseModel):
    files: list[UploadFile]


class AddFile(BaseModel):
    data: str  # base64
    glyphName: str
    replace: bool = False


class AddRequest(BaseModel):
    files: list[AddFile]


def _decode(data: str) -> bytes:
    try:
        return base64.b64decode(data, validate=True)
    except binascii.Error:
        raise HTTPException(400, "File data is not valid base64")


class KernRequest(BaseModel):
    first: str
    second: str
    value: float


class KernGroupRequest(BaseModel):
    side: int
    name: str
    glyphs: list[str] = []
    renameFrom: str | None = None


class State:
    def __init__(self, project: Project | None, watch: bool):
        self.watch = watch
        self.project = None
        self.watcher: GlyphWatcher | None = None
        self.cache = CompileCache()
        self.set_project(project)

    def set_project(self, project: Project | None):
        if self.watcher:
            self.watcher.stop()
        self.project, self.cache, self.watcher = project, CompileCache(), None
        if project is not None and self.watch:
            self.watcher = GlyphWatcher(project).start()

    def require(self) -> Project:
        if self.project is None:
            raise HTTPException(409, "No project is open")
        return self.project


def create_app(project: Project | None = None, watch: bool = True) -> FastAPI:
    """``watch``: re-import SVGs automatically when they change on disk."""
    app = FastAPI(title="Font-tastic")
    state = State(project, watch)
    app.state.fonttastic = state

    def guard(fn, *args):
        try:
            return fn(*args)
        except NeedsConversion as exc:
            raise HTTPException(409, {"code": exc.code, "message": str(exc)})
        except ProjectError as exc:
            raise HTTPException(400, str(exc))

    def activate(project: Project):
        state.set_project(project)
        recent.touch(project.file, project.name)
        report = project.import_all()
        return {"project": project.summary(), "import": report}

    @app.get("/api/project")
    def get_project():
        if state.project is None:
            return {"project": None}
        return {"project": state.project.summary()}

    @app.post("/api/project/open")
    def open_project(req: OpenRequest):
        return activate(guard(Project, req.path))

    @app.post("/api/project/convert")
    def convert_project(req: OpenRequest):
        return activate(guard(Project.convert, req.path))

    @app.post("/api/project/new")
    def new_project(req: NewProjectRequest):
        name = req.name.strip()
        if not name:
            raise HTTPException(400, "Give the project a name")
        return activate(guard(Project.create, Path(req.parent) / name, name))

    @app.post("/api/project/close")
    def close_project():
        state.set_project(None)
        return {"project": None}

    @app.get("/api/events")
    async def events():
        """Server-sent events: one ``change`` event whenever the project's
        revision moves, with the watcher's import report when it caused it."""

        async def stream():
            project = state.project
            sent = project.revision if project else None
            idle = 0.0
            yield f"event: hello\ndata: {json.dumps({'watching': bool(state.watcher and state.watcher.running)})}\n\n"
            while state.project is project and project is not None:
                await asyncio.sleep(0.25)
                idle += 0.25
                if project.revision != sent:
                    sent = project.revision
                    report = state.watcher.last_report if state.watcher else None
                    payload = {"revision": sent, "external": bool(report and report["revision"] == sent)}
                    if payload["external"]:
                        payload.update(imported=report["imported"], errors=report["errors"],
                                       missingSource=report["missingSource"])
                    yield f"event: change\ndata: {json.dumps(payload)}\n\n"
                    idle = 0.0
                elif idle >= 15:
                    yield ": keep-alive\n\n"
                    idle = 0.0

        return StreamingResponse(stream(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @app.put("/api/project/settings")
    def put_settings(values: dict):
        project = state.require()
        project.save_settings(values)
        return {"settings": project.settings}

    @app.get("/api/recent")
    def get_recent():
        return {"recent": recent.load()}

    @app.post("/api/recent/remove")
    def remove_recent(req: OpenRequest):
        recent.remove(req.path)
        return {"recent": recent.load()}

    @app.get("/api/snapshots")
    def get_snapshots():
        return {"snapshots": state.require().snapshots()}

    @app.post("/api/snapshots/{snap_id}/restore")
    def restore_snapshot(snap_id: str):
        project = state.require()
        guard(project.restore, snap_id)
        return {"project": project.summary(), "snapshots": project.snapshots()}

    @app.post("/api/project/import")
    def reimport(req: ImportRequest):
        project = state.require()
        report = project.import_all(force=req.force)
        return {"project": project.summary(), "import": report}

    @app.post("/api/import/analyze")
    def analyze(req: AnalyzeRequest):
        project = state.require()
        return {"files": [project.analyze_upload(f.filename, _decode(f.data)) for f in req.files]}

    @app.post("/api/import/add")
    def add_files(req: AddRequest):
        project = state.require()
        added, errors = project.add_svgs([(_decode(f.data), f.glyphName, f.replace) for f in req.files])
        return {"project": project.summary(), "added": added, "errors": errors}

    @app.post("/api/glyphs/{name}/edit")
    def edit_glyph(name: str):
        """Open the glyph's SVG in Illustrator; saving there re-imports it."""
        project = state.require()
        created = not guard(project.has_source, name)
        path = guard(project.source_svg, name)
        try:
            app_name = illustrator.open_in_illustrator(path)
        except OSError as exc:
            raise HTTPException(500, f"Couldn't start Illustrator: {exc}")
        return {"path": str(path), "app": app_name, "created": created, "project": project.summary()}

    @app.post("/api/glyphs/{name}/reveal")
    def reveal_glyph(name: str):
        project = state.require()
        path = guard(project.source_svg, name, False)
        illustrator.reveal_in_file_manager(path)
        return {"path": str(path)}

    @app.get("/api/illustrator")
    def which_illustrator():
        found = illustrator.find_illustrator()
        return {"name": found.name if found else None}

    @app.get("/api/glyphs/{name}")
    def get_glyph(name: str):
        return guard(state.require().glyph_detail, name)

    @app.put("/api/glyphs/{name}/anchors")
    def put_anchors(name: str, req: AnchorsRequest):
        project = state.require()
        guard(project.set_anchors, name, [a.model_dump() for a in req.anchors])
        return project.glyph_detail(name)

    @app.put("/api/glyphs/{name}/width")
    def put_width(name: str, req: WidthRequest):
        project = state.require()
        guard(project.set_width, name, req.width)
        return project.glyph_detail(name)

    @app.put("/api/info")
    def put_info(values: dict):
        project = state.require()
        guard(project.set_info, values)
        return project.summary()

    @app.put("/api/ligatures")
    def put_ligatures(req: LigaturesRequest):
        project = state.require()
        project.set_ligatures([r.model_dump() for r in req.rules])
        return project.summary()

    @app.put("/api/kerning")
    def put_kerning(req: KernRequest):
        project = state.require()
        guard(project.set_kerning, req.first, req.second, req.value)
        return project.summary()

    @app.put("/api/kerning/groups")
    def put_kern_group(req: KernGroupRequest):
        project = state.require()
        guard(project.set_kern_group, req.side, req.name, req.glyphs, req.renameFrom)
        return project.summary()

    @app.post("/api/kerning/groups/delete")
    def delete_kern_group(req: KernGroupRequest):
        project = state.require()
        guard(project.delete_kern_group, req.side, req.name)
        return project.summary()

    @app.get("/api/font.otf")
    def font_binary():
        project = state.require()
        try:
            data = state.cache.get(project)
        except CompileError as exc:
            raise HTTPException(422, str(exc))
        return Response(
            data,
            media_type="font/otf",
            headers={"X-Revision": str(project.revision), "Cache-Control": "no-store"},
        )

    @app.post("/api/export")
    def export():
        project = state.require()
        with project.lock:
            try:
                data = compile_otf(project.font, preview=False)
            except CompileError as exc:
                raise HTTPException(422, str(exc))
            info = project.font.info
            name = f"{info.familyName}-{info.styleName}".replace(" ", "")
        project.build_dir.mkdir(exist_ok=True)
        out = project.build_dir / f"{name}.otf"
        out.write_bytes(data)
        return {"path": str(out), "bytes": len(data)}

    if FRONTEND_DIST.is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{path:path}")
        def spa(path: str):
            file = FRONTEND_DIST / path
            if path and file.is_file() and FRONTEND_DIST in file.resolve().parents:
                return FileResponse(file)
            return FileResponse(FRONTEND_DIST / "index.html")

    return app
