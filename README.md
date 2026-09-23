# Font-tastic

A Hebrew-first font editor. **Illustrator draws the glyph outlines; Font-tastic
owns everything typographic**: metrics, niqqud anchors, kerning, ligatures,
compilation, and a live RTL preview shaped by HarfBuzz.

It isn't a Bezier editor and it isn't an Illustrator plugin. See
[hebrew-font-editor-brief.md](hebrew-font-editor-brief.md) for the full design.

## Setup (Windows)

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
cd frontend; npm install; npm run build; cd ..
```

## Run

```powershell
.\.venv\Scripts\python examples\make_demo.py                 # optional: a small demo project
.\.venv\Scripts\python -m fonttastic examples\demo           # open a project (folder or .fonttastic file)
.\.venv\Scripts\python -m fonttastic                          # reopen the last project (--home: project list)
.\.venv\Scripts\python -m fonttastic examples\demo --browser # in a browser tab instead of a window
```

UI development with hot reload:

```powershell
cd frontend; npm run dev                                     # terminal 1
.\.venv\Scripts\python -m fonttastic examples\demo --dev     # terminal 2
```

Tests: `.\.venv\Scripts\python -m pytest`

## Projects

A project is one self-contained folder, marked by its project file. It's
like a FontForge `.sfd`, but a folder, because Illustrator edits each glyph
as its own file.

```
MyFont/
  MyFont.fonttastic   project file: name, settings (e.g. preview text), relative paths
  glyphs/             one SVG per glyph, saved from Illustrator
  font.ufo/           app-owned data: outlines (imported), widths, anchors, kerning, ligatures
  build/              exported OTFs
  snapshots/          automatic backups taken before destructive operations
```

- **New project…** on the home screen creates this layout, and **Open
  project…** takes the `.fonttastic` file. Recent projects are listed there
  too, and the last one reopens on launch.
- All paths are relative, so the folder can be moved, zipped, synced or put
  under git.
- A folder in the old layout (`glyphs/` + `font.ufo/`, no project file) is
  never changed silently. The app offers to convert it, which only adds the
  `.fonttastic` file. From the command line, use `--convert`.
- **Snapshots** of `font.ufo` (and of any SVGs about to be overwritten) are
  taken before replacing outlines, re-importing everything, or changing
  vertical metrics. The last 30 are kept, and they're listed with **Restore**
  buttons in the **Project** tab. A restore snapshots first, so it can be
  undone too.

`font.ufo` is a standard UFO with `features.fea` and GDEF categories always
regenerated, so `fontmake -u font.ufo` works without the app.

### Naming SVGs

| File | Becomes |
|---|---|
| `uni05D0.svg` | alef, encoded at U+05D0 |
| `uni05D1.salt.svg`, `uni05D1.ss01.svg` | unencoded alternate, substituted by `salt` / `ss01` |
| `uni05D1.alt2.svg` | unencoded alternate, no automatic feature |
| `uni05D0_uni05DC.liga.svg` | ligature glyph plus a `liga` rule (`.dlig` for discretionary) |
| `uni05D0-Bold.svg` | variable-font master (Phase 2, ignored for now) |

Final (sofit) letters have their own code points (`uni05DA.svg` etc.).

### Importing SVGs from anywhere

**Import SVGs…** at the top of the glyph panel (or dropping files onto the
panel) copies SVGs into `glyphs/` under their canonical names. Loose names
are understood: `א.svg`, `U+05D0.svg`, `alef.svg`, `kaf-sofit.svg`,
`kamatz.svg`, `bet.salt.svg`, `alef_lamed.svg` (ligature). For anything
else, the dialog shows the shape and asks what it is: a character, an
alternate of a glyph, or a ligature. If the glyph already exists, it asks
whether to **replace** it (the outline changes; anchors and spacing are
kept) or add it as a **stylistic alternate** (`salt` or `ss01`–`ss20`).
Further alternates in the same feature are numbered (`uni05D1.salt.2`) and
all show up in `salt`'s alternate list. A new alternate starts with its base
glyph's anchors.

### Drawing in Illustrator

- **The artboard is the glyph cell.** The top edge is the ascender, the bottom
  edge is the descender, and the width is the advance width. With the default
  metrics (ascender 800, descender −200) a 1000 pt tall artboard is 1:1, with
  the baseline 800 pt from the top.
- Draw niqqud where they would sit under or over a letter standing on the
  baseline. Their advance width is set to zero automatically.
- Overlapping shapes are fine because they're merged on import. Strokes
  aren't: use *Object › Path › Outline Stroke*. Hidden layers are skipped.
- Save As SVG with **Preserve Illustrator Editing Capabilities** on, so the
  file keeps reopening cleanly in Illustrator.

### Anchors

On first import, Hebrew letters get `top`, `bottom` and `dagesh` anchors
(shin also gets `shindot` and `sindot`), and niqqud get the matching
`_bottom`, `_top` or similar anchor. Drag them into place in the glyph view.
Ghost marks show the attachment live. ufo2ft turns `name` ↔ `_name` pairs
into GPOS mark-to-base, and `namemkmk` ↔ `_namemkmk` into mark-to-mark.

Re-importing an SVG replaces only its outline. Anchors and widths set in the
app are kept.

### Kerning

The **Kerning** tab kerns specific glyph pairs. Type the pair the way you
write it (`בת`) or pick the glyphs from the menus. The pair is stored in
reading order, so the first glyph is the one on the right. Negative values
pull the pair together. The pair view redraws as you adjust, with optional
context letters on both sides, and the HarfBuzz preview below shows the
compiled result. Pairs live in the UFO's `kerning.plist`.

## Status

Phase 1, first slice: SVG import → anchors → widths → pair kerning →
ligatures and alternates → compile → RTL preview, plus project handling
(project files, New/Open/recent, snapshots).

Next:
- Class-based kerning (groups such as "all round-bottomed letters")
- Filesystem watcher and "Edit in Illustrator"
- Porting logic from the existing FontForge script
- Variable fonts (Phase 2)
- Bilingual/multilingual fonts, Hebrew + Latin first (Phase 3, the end
  goal; see the brief)
