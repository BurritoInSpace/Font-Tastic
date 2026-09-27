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

from . import axes, illustrator, recent, variable
from .build import CompileCache, CompileError, compile_otf, compile_ttf
from .project import NeedsConversion, Project, ProjectError, glyph_preview
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


class RenameRequest(BaseModel):
    newName: str
    swap: bool = False
    moveAlternates: bool = True


class DuplicateRequest(BaseModel):
    unicode: int


class PointOrderRequest(BaseModel):
    """A manual point order change: op is start, move, reverse or reset."""

    op: str
    contour: int = 0
    value: int = 0


class BulkMetricsRequest(BaseModel):
    glyphs: list[str]
    lsb: float | None = None
    rsb: float | None = None
    allMasters: bool = False


class BulkAnchorsRequest(BaseModel):
    anchor: str
    glyphs: list[str] | None = None  # None: every glyph with the anchor
    x: float | str | None = None  # a number, "center", or None to keep
    y: float | None = None
    allMasters: bool = False


class EditorRequest(BaseModel):
    choice: str  # auto, illustrator, inkscape or default


class MetricsRequest(BaseModel):
    lsb: float | None = None
    rsb: float | None = None
    width: float | None = None


class CompositesRequest(BaseModel):
    unicodes: list[int]


class NewWeightRequest(BaseModel):
    name: str
    weight: int | None = None
    copyFrom: str
    location: dict[str, float] | None = None  # axis tag -> value; axes left out stay where copyFrom is


class AxisRequest(BaseModel):
    tag: str
    name: str = ""
    value: float | None = None  # where the existing masters sit on it


class MasterLocationRequest(BaseModel):
    name: str
    location: dict[str, float]


class WeightRequest(BaseModel):
    name: str


class ExportRequest(BaseModel):
    """What to export. Defaults: everything."""

    staticFormats: list[str] = ["otf", "ttf"]
    weights: list[str] | None = None  # None: every weight
    variableFormats: list[str] = ["otf", "ttf"]


class VariableRequest(BaseModel):
    default: str | None = None
    instances: list[dict] | None = None


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
        report = project.import_weights()  # every weight: SVGs may have changed while closed
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

    @app.get("/api/recent/preview")
    def recent_preview(path: str):
        """A letter from a recent project, for its thumbnail (recent projects only)."""
        if not any(e["path"] == path for e in recent.load()):
            raise HTTPException(404, "Not a recent project")
        return {"preview": glyph_preview(path)}

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
        report = project.import_weights(force=req.force)
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
        """Open the glyph's SVG in the drawing app; saving there re-imports it."""
        project = state.require()
        created = not guard(project.has_source, name)
        path = guard(project.source_svg, name)
        try:
            app_name = illustrator.open_svg(path)
        except OSError as exc:
            raise HTTPException(500, f"Couldn't start the drawing app: {exc}")
        return {"path": str(path), "app": app_name, "created": created, "project": project.summary()}

    @app.post("/api/glyphs/{name}/delete")
    def delete_glyph(name: str):
        project = state.require()
        removed = guard(project.delete_glyph, name)
        return {"removed": removed, "project": project.summary()}

    @app.post("/api/glyphs/{name}/rename")
    def rename_glyph(name: str, req: RenameRequest):
        """Reassign a glyph to another character/name (optionally swapping)."""
        project = state.require()
        mapping = guard(project.rename_glyph, name, req.newName, req.swap, req.moveAlternates)
        return {"renamed": mapping, "project": project.summary()}

    @app.get("/api/glyphs/{name}/points")
    def glyph_points(name: str):
        """Points in order, for the numbered points view."""
        return guard(state.require().point_order, name)

    @app.post("/api/glyphs/{name}/points")
    def edit_points(name: str, req: PointOrderRequest):
        """Change the start point, contour order or direction in this weight."""
        project = state.require()
        guard(project.edit_point_order, name, req.op, req.contour, req.value)
        return {"points": project.point_order(name), "project": project.summary()}

    @app.post("/api/glyphs/{name}/match")
    def match_glyph(name: str):
        """Line this glyph up with the default weight in every other weight."""
        project = state.require()
        result = guard(project.match_to_default, name)
        return {**result, "points": project.point_order(name), "project": project.summary()}

    @app.post("/api/compat/fix")
    def fix_all():
        """Match every glyph with fixable point order problems to the default weight."""
        project = state.require()
        result = guard(project.match_all_to_default)
        return {**result, "compat": project.compatibility(), "project": project.summary()}

    @app.get("/api/composites")
    def composite_candidates():
        """Accented letters that could be built from the base letters and marks the font has."""
        return {"candidates": state.require().composite_candidates()}

    @app.post("/api/composites")
    def add_composites(req: CompositesRequest):
        project = state.require()
        result = guard(project.add_composites, req.unicodes)
        return {**result, "project": project.summary()}

    @app.post("/api/glyphs/{name}/draw-instead")
    def draw_instead(name: str):
        """A built accented letter becomes an SVG to draw, then opens in the drawing app."""
        project = state.require()
        path = guard(project.draw_instead, name)
        app_name = illustrator.open_svg(path)
        return {"path": str(path), "app": app_name, "project": project.summary()}

    @app.post("/api/glyphs/{name}/duplicate")
    def duplicate_glyph(name: str, req: DuplicateRequest):
        """Duplicate a niqqud mark as another one (e.g. dagesh -> holam)."""
        project = state.require()
        created = guard(project.duplicate_mark, name, req.unicode)
        return {"name": created, "project": project.summary()}

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

    def editors_info():
        chosen = illustrator.preferences().get("editor", "auto")
        active = illustrator.resolve()
        have = illustrator.installed()
        return {"choice": chosen, "installed": have, "active": active,
                "label": "Illustrator" if active == "illustrator" else "Inkscape" if active == "inkscape" else "default app"}

    @app.get("/api/editors")
    def get_editors():
        """The drawing apps installed, the user's choice and the one that will open."""
        return editors_info()

    @app.put("/api/editors")
    def put_editors(req: EditorRequest):
        try:
            illustrator.set_editor(req.choice)
        except ValueError as exc:
            raise HTTPException(400, str(exc))
        return editors_info()

    @app.get("/api/glyphs/{name}")
    def get_glyph(name: str):
        return guard(state.require().glyph_detail, name)

    @app.put("/api/glyphs/{name}/anchors")
    def put_anchors(name: str, req: AnchorsRequest):
        project = state.require()
        guard(project.set_anchors, name, [a.model_dump() for a in req.anchors])
        return project.glyph_detail(name)

    @app.put("/api/glyphs/{name}/metrics")
    def put_metrics(name: str, req: MetricsRequest):
        """Side bearings / width, by moving the SVG artboard's edges."""
        project = state.require()
        return guard(project.set_metrics, name, req.lsb, req.rsb, req.width)

    @app.post("/api/bulk/metrics")
    def bulk_metrics(req: BulkMetricsRequest):
        project = state.require()
        result = guard(project.bulk_metrics, req.glyphs, req.lsb, req.rsb, req.allMasters)
        return {**result, "project": project.summary()}

    @app.post("/api/bulk/anchors")
    def bulk_anchors(req: BulkAnchorsRequest):
        project = state.require()
        result = guard(project.bulk_anchors, req.anchor, req.glyphs, req.x, req.y, req.allMasters)
        return {**result, "project": project.summary()}

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

    # -- weights ----------------------------------------------------------

    def weight_changed(project: Project):
        """A different weight is active: new font to compile, new folder to watch."""
        state.set_project(project)
        return {"project": project.summary(), "import": project.import_all()}

    @app.get("/api/compat")
    def compatibility():
        """Can the weights interpolate? Per-glyph problems for the variable font."""
        return state.require().compatibility()

    @app.post("/api/weights")
    def add_weight(req: NewWeightRequest):
        project = state.require()
        guard(project.add_weight, req.name.strip(), req.weight, req.copyFrom, req.location)
        return weight_changed(project)

    @app.post("/api/weights/location")
    def move_master(req: MasterLocationRequest):
        project = state.require()
        guard(project.set_master_location, req.name, req.location)
        return {"project": project.summary(), "variable": variable_setup(project)}

    @app.post("/api/axes")
    def add_axis(req: AxisRequest):
        project = state.require()
        preset = axes.PRESETS.get(req.tag.strip(), {})
        value = req.value if req.value is not None else preset.get("default", 0)
        guard(project.add_axis, req.tag, req.name, value)
        return {"project": project.summary(), "variable": variable_setup(project)}

    @app.post("/api/axes/delete")
    def delete_axis(req: AxisRequest):
        project = state.require()
        guard(project.remove_axis, req.tag)
        return {"project": project.summary(), "variable": variable_setup(project)}

    @app.post("/api/weights/switch")
    def switch_weight(req: WeightRequest):
        project = state.require()
        guard(project.switch_weight, req.name)
        return weight_changed(project)

    @app.post("/api/weights/delete")
    def delete_weight(req: WeightRequest):
        project = state.require()
        guard(project.delete_weight, req.name)
        return weight_changed(project)

    # -- variable font ------------------------------------------------------

    def variable_setup(project):
        """Axes, masters and instances; ``available`` once there are two masters."""
        return {"available": len(project.weights) > 1, "presets": axes.PRESETS, **variable.settings(project)}

    @app.get("/api/variable")
    def get_variable():
        return variable_setup(state.require())

    @app.put("/api/variable")
    def put_variable(req: VariableRequest):
        project = state.require()
        guard(variable.save_settings, project, req.default, req.instances)
        return variable_setup(project)

    preview_cache: dict = {}

    @app.get("/api/variable.otf")
    def variable_preview():
        """The variable font for the live preview: glyphs that don't match
        across weights yet stay at the default weight instead of failing."""
        project = state.require()
        key = (id(project), project.revision)
        if preview_cache.get("key") != key:
            try:
                preview_cache.update(key=key, data=guard(variable.compile_variable, project, "cff2", True), error=None)
            except CompileError as exc:
                preview_cache.update(key=key, data=None, error=str(exc))
        if preview_cache["error"]:
            raise HTTPException(422, preview_cache["error"])
        return Response(preview_cache["data"], media_type="font/otf", headers={"Cache-Control": "no-store"})

    @app.post("/api/export")
    def export(req: ExportRequest | None = None):
        """The chosen static formats for the chosen weights, and the variable
        font in the chosen flavours (when the weights are compatible)."""
        req = req or ExportRequest()
        project = state.require()
        unknown = [f for f in req.staticFormats + req.variableFormats if f not in ("otf", "ttf")]
        if unknown:
            raise HTTPException(400, f"Unknown format {unknown[0]!r}")
        if req.weights is not None:
            for name in req.weights:
                guard(project.weight_by_name, name)
        if not req.staticFormats and not req.variableFormats:
            raise HTTPException(400, "Nothing to export: pick at least one format")
        paths = []
        try:
            if "otf" in req.staticFormats:
                paths += project.export_all(lambda font: compile_otf(font, preview=False), ".otf", req.weights)
            if "ttf" in req.staticFormats:
                paths += project.export_all(compile_ttf, ".ttf", req.weights)
        except CompileError as exc:
            raise HTTPException(422, str(exc))
        variable_note = None
        if req.variableFormats:
            family = project.font.info.familyName.replace(" ", "")
            try:
                for fmt in req.variableFormats:
                    data = variable.compile_variable(project, "cff2" if fmt == "otf" else "ttf")
                    path = project.build_dir / f"{family}-VF.{fmt}"
                    project.build_dir.mkdir(exist_ok=True)
                    path.write_bytes(data)
                    paths.append(path)
            except (CompileError, ProjectError) as exc:
                variable_note = f"Variable font skipped: {exc}"
        return {"paths": [str(p) for p in paths], "bytes": sum(p.stat().st_size for p in paths),
                "variableNote": variable_note}

    if FRONTEND_DIST.is_dir():
        app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{path:path}")
        def spa(path: str):
            file = FRONTEND_DIST / path
            if path and file.is_file() and FRONTEND_DIST in file.resolve().parents:
                return FileResponse(file)
            return FileResponse(FRONTEND_DIST / "index.html")

    return app
