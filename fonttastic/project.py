"""A Font-tastic project: one self-contained folder, marked by a project file.

    MyFont/
      MyFont.fonttastic   project file (JSON): name, settings, relative paths
      glyphs/             one SVG per glyph, named by Unicode slot (uni05D0.svg)
      font.ufo/           outlines (imported) + metrics, anchors, kerning, ligatures
      build/              compiled fonts
      snapshots/          copies of font.ufo taken before destructive operations

All paths in the project file are relative to it, so the folder can be moved,
zipped, synced or put under git.

The SVGs are the source of truth for outlines only. Everything typographic
lives in the UFO and survives re-import. The UFO on disk is always complete
(features.fea and GDEF categories regenerated on save), so it compiles with
plain ``fontmake`` too.
"""

from __future__ import annotations

import json
import re
import shutil
import threading
from datetime import datetime
from pathlib import Path

import ufoLib2
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen

from . import features, hebrew, naming
from .svg_import import outline_to_svg, parse_svg, read_svg

LIB = "com.fonttastic"
SOURCE = f"{LIB}.source"
SOURCE_MTIME = f"{LIB}.sourceMtime"
WARNINGS = f"{LIB}.warnings"
WIDTH_OVERRIDE = f"{LIB}.widthOverride"
AUTO = f"{LIB}.auto"

DEFAULT_INFO = dict(unitsPerEm=1000, ascender=800, descender=-200, capHeight=700, xHeight=500)

PROJECT_SUFFIX = ".fonttastic"
PROJECT_FORMAT = "fonttastic-project"
PROJECT_VERSION = 1
DEFAULT_PATHS = {"glyphs": "glyphs", "font": "font.ufo", "build": "build", "snapshots": "snapshots"}
KEEP_SNAPSHOTS = 30

SAFE_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.]*$")


class ProjectError(Exception):
    code = "error"


class NeedsConversion(ProjectError):
    """The folder has the pre-project-file layout (glyphs/ + font.ufo/)."""

    code = "needs-conversion"


def find_project_file(folder: Path) -> Path | None:
    found = sorted(folder.glob(f"*{PROJECT_SUFFIX}"))
    if len(found) > 1:
        raise ProjectError(f"{folder} has more than one project file: {', '.join(p.name for p in found)}")
    return found[0] if found else None


def is_legacy_folder(folder: Path) -> bool:
    return (folder / "glyphs").is_dir() or (folder / "font.ufo").is_dir()


def _file_name(name: str) -> str:
    cleaned = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return (cleaned or "Untitled") + PROJECT_SUFFIX


def _write_project_file(path: Path, name: str, settings: dict | None = None):
    data = {
        "format": PROJECT_FORMAT,
        "version": PROJECT_VERSION,
        "name": name,
        "paths": dict(DEFAULT_PATHS),
        "settings": settings or {},
    }
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


class Project:
    def __init__(self, path: str | Path):
        """Open a project from its ``.fonttastic`` file or the folder holding it."""
        path = Path(path).resolve()
        if path.is_dir():
            file = find_project_file(path)
            if file is None:
                if is_legacy_folder(path):
                    raise NeedsConversion(
                        f"{path.name} uses the old layout without a project file. Convert it to a Font-tastic project?"
                    )
                raise ProjectError(f"{path} is not a Font-tastic project (no {PROJECT_SUFFIX} file)")
            path = file
        elif path.suffix != PROJECT_SUFFIX or not path.is_file():
            raise ProjectError(f"{path} is not a Font-tastic project file")

        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ProjectError(f"Can't read {path.name}: {exc}") from exc
        if data.get("format") != PROJECT_FORMAT:
            raise ProjectError(f"{path.name} is not a Font-tastic project file")
        if data.get("version", 0) > PROJECT_VERSION:
            raise ProjectError(f"{path.name} was made by a newer Font-tastic (format {data['version']})")

        self.file = path
        self.root = path.parent
        self.name = data.get("name") or path.stem
        self.settings: dict = data.get("settings", {})
        self._paths = {**DEFAULT_PATHS, **data.get("paths", {})}
        self.glyphs_dir = (self.root / self._paths["glyphs"]).resolve()
        self.ufo_path = self.root / self._paths["font"]
        self.build_dir = self.root / self._paths["build"]
        self.snapshots_dir = self.root / self._paths["snapshots"]
        self.lock = threading.RLock()
        self.revision = 0

        self.glyphs_dir.mkdir(parents=True, exist_ok=True)
        if self.ufo_path.exists():
            self.font = ufoLib2.Font.open(self.ufo_path, lazy=False)
        else:
            self.font = self._new_font()

    @classmethod
    def create(cls, folder: str | Path, name: str) -> "Project":
        """Make a new project in ``folder``, which must not exist yet or be empty."""
        folder = Path(folder).resolve()
        if folder.exists() and (not folder.is_dir() or any(folder.iterdir())):
            raise ProjectError(f"{folder} already exists and isn't empty")
        folder.mkdir(parents=True, exist_ok=True)
        for sub in ("glyphs", "build"):
            (folder / DEFAULT_PATHS[sub]).mkdir()
        file = folder / _file_name(name)
        _write_project_file(file, name)
        project = cls(file)
        project._ensure_auto_glyphs()
        project._commit()
        return project

    @classmethod
    def convert(cls, folder: str | Path) -> "Project":
        """Add a project file to a folder in the old glyphs/ + font.ufo/ layout.
        Nothing else in the folder changes."""
        folder = Path(folder).resolve()
        if find_project_file(folder):
            return cls(folder)
        if not is_legacy_folder(folder):
            raise ProjectError(f"{folder} has neither glyphs/ nor font.ufo/")
        name = folder.name
        ufo = folder / DEFAULT_PATHS["font"]
        if ufo.is_dir():
            family = ufoLib2.Font.open(ufo, lazy=True).info.familyName
            name = family or name
        _write_project_file(folder / _file_name(name), name)
        return cls(folder)

    def save_settings(self, values: dict):
        with self.lock:
            self.settings.update(values)
            data = json.loads(self.file.read_text(encoding="utf-8"))
            data["settings"] = self.settings
            self.file.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def _new_font(self):
        font = ufoLib2.Font()
        info = font.info
        info.familyName = self.name
        info.styleName = "Regular"
        for key, value in DEFAULT_INFO.items():
            setattr(info, key, value)
        return font

    # -- import -------------------------------------------------------------

    def svg_files(self) -> list[Path]:
        return sorted(p for p in self.glyphs_dir.glob("*.svg") if p.is_file())

    def import_all(self, force: bool = False) -> dict:
        """(Re)import every SVG whose mtime changed. Returns a report."""
        with self.lock:
            if force and self.ufo_path.exists():
                self.snapshot("Before re-importing all SVGs")
            report = {"imported": [], "unchanged": 0, "errors": {}, "missingSource": []}
            seen = set()
            for path in self.svg_files():
                parsed = naming.parse_filename(path.stem)
                if parsed.master:
                    continue  # variable-font masters: Phase 2
                seen.add(parsed.glyph_name)
                glyph = self.font.get(parsed.glyph_name)
                mtime = path.stat().st_mtime
                if not force and glyph is not None and glyph.lib.get(SOURCE_MTIME) == mtime:
                    report["unchanged"] += 1
                    continue
                try:
                    self._import_glyph(path, parsed)
                    report["imported"].append(parsed.glyph_name)
                except Exception as exc:  # report per glyph, keep going
                    report["errors"][path.name] = str(exc)

            for glyph in self.font:
                if glyph.lib.get(SOURCE) and glyph.name not in seen:
                    report["missingSource"].append(glyph.name)
            added_auto = self._ensure_auto_glyphs()
            # Only save when something changed: the watcher calls this for
            # every burst of file events, including the app's own writes.
            if report["imported"] or added_auto or force or not self.ufo_path.exists():
                self._commit()
            return report

    def has_source(self, name: str) -> bool:
        source = self.glyph(name).lib.get(SOURCE)
        return bool(source) and (self.glyphs_dir / source).is_file()

    def source_svg(self, name: str, create: bool = True) -> Path:
        """The SVG behind a glyph. With ``create``, a glyph that has none (an
        auto-made space, or one whose file was deleted) gets one written from
        its current outline, on an artboard of the right size, so it can be
        opened in Illustrator."""
        with self.lock:
            glyph = self.glyph(name)
            source = glyph.lib.get(SOURCE)
            if self.has_source(name):
                return self.glyphs_dir / source
            if not create:
                raise ProjectError(f"{name} has no SVG file")
            if not SAFE_NAME.match(name) and name != ".notdef":
                raise ProjectError(f"{name!r} can't be used as a file name")
            info = self.font.info
            bounds = _bounds(glyph)
            width = glyph.width
            if width <= 0:  # marks: the artboard only needs to hold the drawing
                width = max(round(bounds[2]) + 100 if bounds else 0, round(info.unitsPerEm * 0.6))
            path = self.glyphs_dir / (source or f"{name}.svg")
            path.write_text(outline_to_svg(glyph, width, info.ascender, info.descender), encoding="utf-8")
            self._import_glyph(path, naming.parse_filename(path.stem))
            self._commit()
            return path

    def _import_glyph(self, path: Path, parsed: naming.GlyphFileName):
        info = self.font.info
        outline = read_svg(path, info.ascender, info.descender)
        is_new = parsed.glyph_name not in self.font
        glyph = self.font.get(parsed.glyph_name)
        if glyph is None:  # not `or`: a glyph with no contours is falsy
            glyph = self.font.newGlyph(parsed.glyph_name)

        glyph.clearContours()
        outline.draw_points(glyph.getPointPen())
        glyph.unicodes = [parsed.unicode] if parsed.unicode is not None else []
        glyph.lib.pop(AUTO, None)
        glyph.lib[SOURCE] = path.name
        glyph.lib[SOURCE_MTIME] = path.stat().st_mtime
        glyph.lib[WARNINGS] = outline.warnings

        category = naming.category_for(parsed)
        if not glyph.lib.get(WIDTH_OVERRIDE):
            glyph.width = 0 if category == "mark" else round(outline.advance)

        if is_new:
            base = self.font.get(parsed.base_name) if parsed.suffix and not parsed.components else None
            if base is not None and base.name != glyph.name:
                for a in base.anchors:  # an alternate starts from its base's anchors
                    glyph.appendAnchor({"name": a.name, "x": a.x, "y": a.y})
            else:
                self._seed_anchors(glyph, parsed, category)
            if parsed.components:
                self._add_ligature_rule(parsed)

    def _seed_anchors(self, glyph, parsed, category):
        info = self.font.info
        bounds = _bounds(glyph)
        cp = parsed.unicode
        if category == "mark":
            anchor_class = hebrew.mark_anchor_class(naming.unicode_of_base(parsed.base_name))
            pos = anchor_class and hebrew.default_mark_anchor(anchor_class, bounds, info.capHeight)
            if pos:
                glyph.appendAnchor({"name": f"_{anchor_class}", "x": pos[0], "y": pos[1]})
        elif hebrew.is_hebrew_letter(cp):
            for name, x, y in hebrew.default_base_anchors(cp, glyph.width, bounds, info.capHeight):
                glyph.appendAnchor({"name": name, "x": x, "y": y})

    def _add_ligature_rule(self, parsed):
        rules = self.font.lib.setdefault(features.LIGATURES_KEY, [])
        if any(r["glyph"] == parsed.glyph_name for r in rules):
            return
        feature = parsed.suffix if parsed.suffix and naming.LIGATURE_FEATURES.match(parsed.suffix) else "liga"
        rules.append({"components": list(parsed.components), "glyph": parsed.glyph_name, "feature": feature})

    def _ensure_auto_glyphs(self) -> bool:
        info = self.font.info
        added = False
        if ".notdef" not in self.font:
            added = True
            g = self.font.newGlyph(".notdef")
            g.width = round(info.unitsPerEm * 0.5)
            pen = g.getPen()
            m, top, w, t = 50, info.capHeight, g.width, 50
            for pts in (
                [(m, 0), (w - m, 0), (w - m, top), (m, top)],
                [(m + t, t), (m + t, top - t), (w - m - t, top - t), (w - m - t, t)],
            ):
                pen.moveTo(pts[0])
                for p in pts[1:]:
                    pen.lineTo(p)
                pen.closePath()
            g.lib[AUTO] = True
        if not any(0x20 in g.unicodes for g in self.font):
            g = self.font.newGlyph("space")
            g.unicodes = [0x20]
            g.width = round(info.unitsPerEm * 0.25)
            g.lib[AUTO] = True
            added = True
        return added

    # -- importing individual files (the "Import SVGs" button) ---------------

    def analyze_upload(self, filename: str, data: bytes) -> dict:
        """Describe an uploaded SVG before it is added: which glyph its name
        points at (if any), whether that glyph exists, and what it looks like."""
        stem = Path(filename).stem
        with self.lock:
            cmap = {g.unicodes[0]: g.name for g in self.font if g.unicodes}
            existing = set(self.font.keys())
            info = self.font.info
            try:
                outline = parse_svg(data, info.ascender, info.descender)
            except Exception as exc:
                return {"filename": filename, "status": "invalid", "error": str(exc)}

            pen = SVGPathPen(None)
            outline.draw(pen)
            result = {
                "filename": filename,
                "path": pen.getCommands(),
                "advance": outline.advance,
                "warnings": outline.warnings,
                "glyphName": None,
                "unicode": None,
            }
            found = naming.recognize(stem, cmap, existing)
            if found is None:
                result["status"] = "unknown"
                return result
            result.update(glyphName=found.glyph_name, unicode=found.unicode)
            result["status"] = "duplicate" if found.glyph_name in existing else "new"
            return result

    def add_svgs(self, files: list[tuple[bytes, str, bool]]) -> tuple[list[str], dict[str, str]]:
        """Add several uploads (data, glyph name, replace?). Snapshots first if
        any existing outline is about to be replaced."""
        with self.lock:
            replacing = [name for _, name, replace in files if replace and name in self.font]
            if replacing:
                sources = [self.glyphs_dir / s for n in replacing if (s := self.font[n].lib.get(SOURCE))]
                self.snapshot(f"Before replacing {', '.join(replacing)}", sources)
            added, errors = [], {}
            for data, name, replace in files:
                try:
                    added.append(self.add_svg(data, name, replace))
                except (ProjectError, ValueError) as exc:
                    errors[name] = str(exc)
            return added, errors

    def add_svg(self, data: bytes, glyph_name: str, replace: bool = False) -> str:
        """Store an uploaded SVG in glyphs/ under the glyph's canonical file
        name and import it. Replacing keeps the glyph's anchors and metrics."""
        if not SAFE_NAME.match(glyph_name) or "-" in glyph_name:
            raise ProjectError(f"{glyph_name!r} is not a usable glyph name")
        with self.lock:
            existing = self.font.get(glyph_name)
            if existing is not None and not replace:
                raise ProjectError(f"{glyph_name} already exists")
            info = self.font.info
            parse_svg(data, info.ascender, info.descender)  # refuse unreadable files up front

            source = existing.lib.get(SOURCE) if existing is not None else None
            path = self.glyphs_dir / (source or f"{glyph_name}.svg")
            self.glyphs_dir.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            self._import_glyph(path, naming.parse_filename(path.stem))
            self._ensure_auto_glyphs()
            self._commit()
            return glyph_name

    # -- edits ----------------------------------------------------------------

    def glyph(self, name: str):
        if name not in self.font:
            raise ProjectError(f"No glyph named {name!r}")
        return self.font[name]

    def set_anchors(self, name: str, anchors: list[dict]):
        with self.lock:
            glyph = self.glyph(name)
            glyph.clearAnchors()
            for a in anchors:
                glyph.appendAnchor({"name": a["name"], "x": round(a["x"]), "y": round(a["y"])})
            self._commit()

    def set_width(self, name: str, width: float | None):
        """Override the advance width; ``None`` goes back to the artboard width."""
        with self.lock:
            glyph = self.glyph(name)
            if width is None:
                glyph.lib.pop(WIDTH_OVERRIDE, None)
                source = glyph.lib.get(SOURCE)
                if source and (self.glyphs_dir / source).exists():
                    path = self.glyphs_dir / source
                    self._import_glyph(path, naming.parse_filename(path.stem))
            else:
                glyph.width = round(width)
                glyph.lib[WIDTH_OVERRIDE] = True
            self._commit()

    def set_info(self, values: dict):
        allowed = {"familyName", "styleName", "unitsPerEm", "ascender", "descender", "capHeight", "xHeight"}
        with self.lock:
            info = self.font.info
            if any(k in values and values[k] != getattr(info, k) for k in ("ascender", "descender", "unitsPerEm")):
                self.snapshot("Before changing vertical metrics")
            for key, value in values.items():
                if key not in allowed:
                    raise ProjectError(f"Unknown font info field {key!r}")
                setattr(self.font.info, key, value)
            self._commit()

    def set_kerning(self, first: str, second: str, value: float):
        """Kern a glyph pair, given in reading order (for Hebrew: the right-hand
        glyph first). Negative tightens; 0 removes the pair."""
        with self.lock:
            self.glyph(first), self.glyph(second)
            if round(value) == 0:
                self.font.kerning.pop((first, second), None)
            else:
                self.font.kerning[(first, second)] = round(value)
            self._commit()

    def set_ligatures(self, rules: list[dict]):
        with self.lock:
            self.font.lib[features.LIGATURES_KEY] = [
                {"components": list(r["components"]), "glyph": r["glyph"], "feature": r.get("feature", "liga")}
                for r in rules
            ]
            self._commit()

    # -- snapshots --------------------------------------------------------------

    def snapshot(self, reason: str, files=()) -> str | None:
        """Copy font.ufo (and the given source SVGs) aside so an operation can be undone."""
        with self.lock:
            if not self.ufo_path.exists():
                return None
            snap_id = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
            target = self.snapshots_dir / snap_id
            shutil.copytree(self.ufo_path, target / "font.ufo")
            saved = []
            for f in files:
                f = Path(f)
                if f.is_file():
                    (target / "glyphs").mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, target / "glyphs" / f.name)
                    saved.append(f.name)
            meta = {"id": snap_id, "reason": reason, "created": datetime.now().isoformat(timespec="seconds"),
                    "files": saved}
            (target / "snapshot.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
            for old in self.snapshots()[KEEP_SNAPSHOTS:]:
                shutil.rmtree(self.snapshots_dir / old["id"], ignore_errors=True)
            return snap_id

    def snapshots(self) -> list[dict]:
        if not self.snapshots_dir.is_dir():
            return []
        out = []
        for meta in self.snapshots_dir.glob("*/snapshot.json"):
            try:
                out.append(json.loads(meta.read_text(encoding="utf-8")))
            except (OSError, ValueError):
                continue
        return sorted(out, key=lambda m: m["id"], reverse=True)

    def restore(self, snap_id: str):
        """Put a snapshot back. The current state is snapshotted first, so a
        restore can itself be undone."""
        with self.lock:
            source = self.snapshots_dir / snap_id
            if not re.fullmatch(r"[\d-]+", snap_id) or not (source / "font.ufo").is_dir():
                raise ProjectError(f"No snapshot {snap_id!r}")
            meta = json.loads((source / "snapshot.json").read_text(encoding="utf-8"))
            current_files = [self.glyphs_dir / f for f in meta.get("files", [])]
            self.snapshot(f"Before restoring \u201c{meta['reason']}\u201d", current_files)
            shutil.rmtree(self.ufo_path)
            shutil.copytree(source / "font.ufo", self.ufo_path)
            for f in meta.get("files", []):
                shutil.copy2(source / "glyphs" / f, self.glyphs_dir / f)
            self.font = ufoLib2.Font.open(self.ufo_path, lazy=False)
            self.revision += 1

    # -- persistence ----------------------------------------------------------

    def _commit(self):
        self._update_derived()
        self.font.save(self.ufo_path, overwrite=True)
        self.revision += 1

    def _update_derived(self):
        font = self.font
        categories, alternates = {}, {}
        for glyph in font:
            if glyph.lib.get(AUTO) and glyph.name == ".notdef":
                continue
            parsed = naming.parse_filename(glyph.name)
            categories[glyph.name] = naming.category_for(parsed)
            if any(a.name.startswith("_") for a in glyph.anchors):
                categories[glyph.name] = "mark"
            tag = parsed.alternate_feature
            if tag:
                alternates.setdefault(tag, []).append((parsed.base_name, glyph.name))
        font.lib["public.openTypeCategories"] = categories
        font.lib["public.glyphOrder"] = sorted(font.keys(), key=_order_key(font))
        font.features.text = features.build_features(font, alternates)

    # -- views ----------------------------------------------------------------

    def summary(self) -> dict:
        with self.lock:
            info = self.font.info
            order = self.font.lib.get("public.glyphOrder") or sorted(self.font.keys())
            categories = self.font.lib.get("public.openTypeCategories", {})
            return {
                "root": str(self.root),
                "file": str(self.file),
                "name": self.name,
                "settings": self.settings,
                "revision": self.revision,
                "info": {
                    "familyName": info.familyName,
                    "styleName": info.styleName,
                    "unitsPerEm": info.unitsPerEm,
                    "ascender": info.ascender,
                    "descender": info.descender,
                    "capHeight": info.capHeight,
                    "xHeight": info.xHeight,
                },
                "glyphs": [self._glyph_summary(self.font[n], categories) for n in order if n in self.font],
                "ligatures": self.font.lib.get(features.LIGATURES_KEY, []),
                "kerning": [
                    {"first": first, "second": second, "value": value}
                    for (first, second), value in sorted(self.font.kerning.items())
                ],
            }

    def _glyph_summary(self, glyph, categories) -> dict:
        return {
            "name": glyph.name,
            "unicode": glyph.unicodes[0] if glyph.unicodes else None,
            "char": naming.display_char(glyph.name),
            "category": categories.get(glyph.name, "base"),
            "width": glyph.width,
            "source": glyph.lib.get(SOURCE),
            "sourceMissing": bool(glyph.lib.get(SOURCE)) and not self.has_source(glyph.name),
            "auto": bool(glyph.lib.get(AUTO)),
            "warnings": glyph.lib.get(WARNINGS, []),
            "widthOverride": bool(glyph.lib.get(WIDTH_OVERRIDE)),
            "anchors": [{"name": a.name, "x": a.x, "y": a.y} for a in glyph.anchors],
            "path": glyph_svg_path(glyph),
            "bounds": _bounds(glyph),
        }

    def glyph_detail(self, name: str) -> dict:
        with self.lock:
            categories = self.font.lib.get("public.openTypeCategories", {})
            return self._glyph_summary(self.glyph(name), categories)


def glyph_svg_path(glyph) -> str:
    pen = SVGPathPen(None)
    glyph.draw(pen)
    return pen.getCommands()


def _bounds(glyph):
    pen = BoundsPen(None)
    glyph.draw(pen)
    return list(pen.bounds) if pen.bounds else None


def _order_key(font):
    def key(name):
        if name == ".notdef":
            return (0, 0, name)
        cp = naming.unicode_of_base(name)
        return (1, cp if cp is not None else 0x110000, name)

    return key
