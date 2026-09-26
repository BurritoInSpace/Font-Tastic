<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="images/fontastic%20logo%20dark%20bg.png">
    <img src="images/fontastic%20logo.png" alt="Font-tastic logo" width="160">
  </picture>
</p>

# Font-tastic

A Hebrew-first font editor. **Illustrator draws the glyph outlines; Font-tastic
owns everything typographic**: metrics, niqqud anchors, kerning, ligatures,
compilation, and a live RTL preview shaped by HarfBuzz.

It isn't a Bezier editor and it isn't an Illustrator plugin. See
[hebrew-font-editor-brief.md](hebrew-font-editor-brief.md) for the full design.

> **Disclaimer: this project is vibe-coded.** Most of the code is written by
> an AI coding assistant (Claude, via Claude Code), with the project's author
> directing the design, deciding what gets built, and testing the results.
> Commits co-written by the AI say so in a `Co-Authored-By` line. The code
> has automated tests, but it hasn't had the line-by-line human review a
> traditionally written project would get. Please judge it with that in
> mind, and bug reports are welcome.

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

### Desktop app (Font-tastic.exe)

```powershell
.\.venv\Scripts\python -m pip install -e ".[build]"
.\.venv\Scripts\python packaging\build_exe.py              # add --shortcut for a desktop shortcut
```

This builds `dist\Font-tastic\Font-tastic.exe`, a self-contained folder
(about 40 MB) with Python, all libraries and the UI bundled, so it runs
without the venv. Double-click it to reopen your last project, or pass a
`.fonttastic` file. The whole `Font-tastic` folder can be copied anywhere.
It doesn't update itself: rebuild after pulling new code. It has no console,
so errors go to `%APPDATA%\Font-tastic\fonttastic.log`.

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

### Weights

A project can hold several weights (Light, Regular, Bold…). The menu at the
top left switches between them, and **+ New weight…** adds one. You pick its
weight class (100–900), name, and which existing weight it starts as a copy
of: its SVGs, anchors, widths and kerning. You then redraw its SVGs heavier
or lighter in Illustrator. Editing copies also keeps the outlines
point-compatible, which variable fonts will need later.

- **Per weight:** outlines (SVGs), advance widths, anchor positions, kerning
  values.
- **Shared by all weights:** the glyph set, kerning groups, ligature rules,
  family name and vertical metrics. Deleting or reassigning a glyph, or
  changing a group, applies to every weight.
- **Layout:** each weight gets its own folder and font data, e.g.
  `glyphs/Bold/` and `masters/Bold.ufo`. A single-weight project keeps the
  flat `glyphs/` + `font.ufo`; adding a second weight moves the current one
  into `glyphs/Regular/` and `masters/Regular.ufo`.
- The Illustrator watcher follows the weight you're editing. SVGs changed in
  another weight's folder are picked up when you switch to it.
- **Export** opens a dialog to choose what goes into `build/`: single weights
  as OTF and/or TTF (all weights or just some), and the variable font as OTF
  and/or TTF when the weights match (see below). The choice is remembered per
  project.
- Removing a weight (Project tab) moves its files into
  `snapshots/removed-weights/` instead of deleting them.

### Variable fonts

With two or more weights, the **variable** tab turns them into one variable
font with a weight axis:

- **Weight axis:** each weight sits on the axis at its weight class; pick
  the default weight (what the font shows when no weight is chosen).
- **Named instances:** the in-between styles apps list by name (Medium 500,
  SemiBold 600, and so on). Edit, add or remove them.
- **Interpolation preview:** a weight slider (and one button per instance)
  showing the real variable font, shaped by HarfBuzz.
- **Compatibility:** weights interpolate point by point, so every glyph needs
  the same contours, segments, segment kinds (straight or curved), start
  points and anchors in every weight. Mismatches are reported in plain
  words, e.g. "Contour 2 has 1 more segment in Bold than in Regular", in the
  variable tab, sorted into *needs redrawing*, *fixable in the app* (a
  different start point or contour order) and *may look off in between*
  (warnings). In the glyph list, a red **≠** or orange **↻** badge marks the
  glyphs concerned.
- **Point order fixes:** **Fix** (one glyph) or **Fix all** in the variable
  tab reorders contours, direction and start points in every weight to follow
  the default weight. For a closer look, **Show points** in the glyph panel
  numbers the points on the canvas: `#n` marks where contour n starts, an
  arrow shows its direction, and the default weight is shown alongside for
  comparison. Click a point to start its contour there, or reorder and
  reverse contours from the list. Fixes are stored with the glyph and
  reapplied whenever its SVG is re-imported, so the SVG can keep being edited
  in Illustrator. If a redrawing changes the points, the fix is dropped with a
  warning.
- **Export** can write `build/MyFont-VF.otf` (CFF2: cubic curves exactly as
  drawn) and `build/MyFont-VF.ttf` (TrueType: curves converted compatibly
  across weights). These options stay disabled, with the reason, until
  nothing needs redrawing or fixing. The preview still works meanwhile, with the
  mismatched glyphs held at the default weight.
- Contours are imported exactly as drawn (overlaps are kept), because merging
  overlapping shapes gives each weight a different point structure. Static
  exports merge the overlaps; variable fonts keep them, as they should.

Each `.ufo` is a standard UFO with `features.fea` and GDEF categories always
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

### Fixing and removing glyphs

- **Reassign…** (in the glyph's inspector) is for a glyph that was named or
  imported as the wrong character. Say what it really is: a character, an
  alternate of another glyph, or a ligature. The glyph and its SVG move to
  the new name, and kerning, groups and ligature rules follow. If the target
  already exists you can **swap** the two (e.g. dalet and resh got each
  other's files). A base glyph's alternates (`uni05D3.salt`) move along. If
  the glyph's role changes (letter ↔ niqqud, or a mark that attaches
  elsewhere), its anchors are reset for the new role; otherwise they're kept.
- **Delete glyph** removes the glyph, its SVG, and any kerning pairs, group
  memberships and ligature rules that use it. `.notdef` and the automatic
  `space` can't be deleted, since they'd just come back.
- Both take a snapshot first (including the SVG files), so they can be
  undone from the Project tab.

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

### Editing in Illustrator (live round trip)

Select a glyph and click **Edit in Illustrator** (or press Ctrl+E). Its SVG
opens in your newest installed Illustrator, and each time you save there,
the glyph updates in Font-tastic within a second or two. There's no
re-import step: the app watches `glyphs/`, re-reads only the changed files,
and keeps your anchors and widths. Files added to or edited in `glyphs/` by
any other program are picked up the same way. The **Live** dot in the
toolbar shows the watcher is running.

- A glyph without an SVG (the auto-made `space`, or a glyph whose file was
  deleted) gets one written from its current outline, on an artboard of the
  right size, so you can start from what's there. A deleted source is
  marked with a red **?** in the glyph list.
- **Show file** reveals the glyph's SVG in Explorer.
- To use a specific Illustrator, set `FONTTASTIC_ILLUSTRATOR` to its
  `Illustrator.exe`. With no Illustrator installed, the file opens in the
  default app for `.svg`.
- When Illustrator asks for SVG options on save, keep **Preserve Illustrator
  Editing Capabilities** on.

### Anchors

On first import, Hebrew letters get `top`, `bottom` and `dagesh` anchors
(shin also gets `shindot` and `sindot`), and niqqud get the matching
`_bottom`, `_top` or similar anchor. Drag them into place in the glyph view.
Ghost marks show the attachment live. ufo2ft turns `name` ↔ `_name` pairs
into GPOS mark-to-base, and `namemkmk` ↔ `_namemkmk` into mark-to-mark.

In a mark's view, the mark is shown on a letter (pick which under **Preview
on base**): the letter stays put and you drag the mark itself into place,
or nudge it with the arrow keys. The anchor value is worked out for you.

A mark attaches through exactly one anchor, so the **+ _top / + _bottom…**
choices only appear while it has none. To reuse a drawing for another mark
(e.g. the dagesh dot as a holam), use **Duplicate as**. It makes the other
mark as its own glyph with its own copy of the SVG, and gives it the right
anchor, placed so it sits just above or below the letter. After that the two
are independent.

Re-importing an SVG replaces only its outline. Anchors and widths set in the
app are kept.

### Kerning

The **Kerning** tab kerns pairs of letters, or whole **groups** of letters
that share an edge shape. Type the pair the way you write it (`בת`) or pick
the letters from the menus. Pairs are stored in reading order, so the first
letter is the one on the right. Negative values pull the pair together. The
pair view redraws as you adjust, with optional context letters on both
sides, and the HarfBuzz preview below shows the compiled result.

- **Groups come in two kinds.** **Right-hand letter groups** collect letters
  whose *left* edge looks alike: the edge facing the next letter. **Left-hand
  letter groups** collect letters whose *right* edge looks alike. A letter
  can be in one group of each kind. In the UFO these are `public.kern1.*`
  and `public.kern2.*` groups.
- Each side of the pair editor switches between **letter** and **@group**,
  so one value can cover every combination (the caption says how many), and
  **+ group** starts a new group from a letter.
- **Exceptions:** a single letter pair overrides its groups. The most
  specific value wins: letter+letter, then letter+group, group+letter,
  group+group. The editor says when a pair's value comes from somewhere
  else, with a link to it.
- Deleting a group also removes the pairs that use it (a snapshot is taken
  first).
- **↑ / ↓** step through the pair list, for going over pairs quickly.
- **Gap markers** keep spacing consistent across pairs. Each letter of the
  pair has one: a coloured band starting at that letter's ink edge facing
  its partner, measured on the letter body (baseline to cap height, so a
  lamed's ascender doesn't count). Set its **width** (your target gap) and
  **shift** it left or right. The readout says how far the partner is from
  it, it turns green when they touch, and **Fit** sets the kerning so they
  touch exactly. Marker settings are shared by every pair and saved with the
  project.

## Status

Phase 1, first slice: SVG import → anchors → widths → pair and group kerning →
ligatures and alternates → compile → RTL preview, plus project handling
(project files, New/Open/recent, snapshots) and the live Illustrator round
trip (folder watcher, Edit in Illustrator).

Next:
- Variable fonts (Phase 2): weight axis, compatibility checks, point order
  fixes and variable export are done; next are multiple axes (width, optical
  size, slant, custom)
- Bilingual/multilingual fonts, Hebrew + Latin first (Phase 3, the end
  goal; see the brief)

## License

Font-tastic is free software, licensed under the
[GNU General Public License v3.0 or later](LICENSE). You may use, study,
share and modify it; if you distribute modified versions, they must be
released under the same license.

The UI is set in [Google Sans](https://fonts.google.com/specimen/Google+Sans),
bundled with the app (Latin and Hebrew subsets) so it works offline. It is
licensed separately under the SIL Open Font License 1.1; see
`frontend/public/fonts/OFL.txt`.
