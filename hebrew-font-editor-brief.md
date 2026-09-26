# Hebrew Font Editor — Project Brief

## What this is

A FOSS font-editing application — closer to Fontself/Glyphs in spirit than
FontForge, but built around a specific pipeline: **Illustrator draws glyph
outlines, this app owns everything typographic** (metrics, anchors, kerning,
ligatures, compilation). Not a Bezier editor, not an Illustrator plugin.

Grew out of the idea behind a FontForge Python batch-import workflow (SVG
glyphs → Unicode slots, with `salt` alternates and sofit/final letters) — this
app replaces that scripting approach with a purpose-built UI. No script is
carried over: the conventions below are implemented directly in the app.

## Explicit non-goals

- **No Bezier/vector point editor.** Illustrator is the drawing tool, full
  stop. The app never re-implements path editing.
- **No Illustrator plugin/addon.** No CEP, no ExtendScript, no CSInterface
  bridge, no UXP (which Illustrator doesn't expose to third parties as of
  2026 anyway). Illustrator is purely upstream, producing files on disk.
- **No cantillation/trope marks** in the initial scope. Core niqqud (vowel
  points, dagesh, shin/sin dots — roughly 8–10 anchor types) is in scope;
  full Masoretic/biblical cantillation is a much larger, separate tier and
  is out of scope unless liturgical text support becomes an explicit goal.

## Architecture overview

```
Illustrator (.ai)
      │  Save As SVG (Preserve Illustrator Editing Capabilities: ON)
      ▼
Glyph folder — one SVG file per glyph
      │  filesystem watcher (mtime change = re-import)
      ▼
App-owned glyph data (UFO-backed)
   outline  +  metrics  +  anchors  +  kerning  +  ligatures
      │  ufo2ft / fontmake
      ▼
Compiled font binary (OTF/TTF, later CFF2 variable)
      │  harfbuzzjs (WASM), RTL shaping
      ▼
Live in-app preview
```

## Interchange format & naming

- **One SVG file per glyph** (not one master file with multiple artboards).
- Filename = Unicode-slot naming, e.g. `uni05D0.svg`.
- For variable fonts later: extend to one SVG per *(glyph, master)*, e.g.
  `uni05D0.svg` (default) / `uni05D0-Bold.svg`.
- SVG export must have **"Preserve Illustrator Editing Capabilities"** enabled
  in Illustrator's save dialog, or the round-trip below degrades the file on
  every re-open.

## Round-trip "edit in Illustrator" (Smart-Object-style)

No Adobe API needed — same trick Photoshop uses for linked Smart Objects:

1. Each glyph is backed by its own file on disk (the SVG above).
2. "Edit in Illustrator" = a plain OS-level launch of that file with
   Illustrator (`open -a Illustrator path.svg` equivalent).
3. The app runs a filesystem watcher on the glyphs folder; on save, it
   detects the mtime change and re-imports just that glyph.

## Core pipeline components

### 1. Import
Parse the SVG's path data into a UFO glyph object via the fontTools pen
protocol (`defcon`/`fontParts`). Handles Unicode-slot mapping, `salt`
alternates, and sofit (final) letters, which have their own code points.

### 2. Anchors — niqqud (GPOS mark-to-base / mark-to-mark)
- UI: place and name anchor points on each glyph after import (in-app
  canvas, not in Illustrator — SVG has no native anchor-point concept).
- Typical anchors: `bottom` (most vowel points), `top` (shin/sin dot,
  cholam), `dagesh` (centered in the letter's bowl — genuinely per-glyph,
  since a bet's dagesh sits differently than a kaf's or mem's).
- Naming convention (`ufo2ft`'s `markFeatureWriter` reads this automatically,
  no `.fea` hand-authoring needed):
  - Base anchor `top` ↔ mark anchor `_top` → mark-to-base pairing.
  - Stacking (mark-to-mark): base-mark anchor `topmkmk` ↔ attaching-mark
    anchor `_topmkmk`.

### 3. Kerning (GPOS pair positioning)
- Class-based kerning table (group finals, group regulars, etc. — not flat
  pair lists) managed in-app, compiled via `fontTools.otlLib`/`feaLib`.
- Direction-agnostic at the data level — RTL is a shaping-time concern, not
  a font-data concern.

### 4. Ligatures (GSUB type 4)
- UI: pick an input glyph sequence → pick/import an output glyph → assign a
  feature tag (`liga` if always-on, `dlig`/`ss01`–`ss20` if optional/brand
  ligatures).
- Compiles to a straightforward one-to-one substitution lookup.

### 5. Compilation
`ufo2ft` / `fontmake` compile the UFO (outlines + metrics + anchors +
kerning + ligatures) to OTF/TTF. Mark, mkmk, and kern feature writers
generate GSUB/GPOS automatically from the structured data above — no
`.fea` files to hand-maintain for the common cases.

### 6. Live preview (RTL-aware)
Naive left-to-right glyph placement won't show kerning/ligatures/mark
positioning correctly for Hebrew. Run the in-progress compiled font through
**harfbuzzjs** (WASM build of HarfBuzz, npm-installable) with direction set
to RTL — same shaping engine every browser/OS uses, so what's shown while
editing matches real-world rendering.

## Variable fonts (Phase 2, not Phase 1)

*Groundwork done:* projects already hold several weights (static masters),
each with its own SVG folder (`glyphs/<Weight>/`) and UFO
(`masters/<Weight>.ufo`), sharing the glyph set, kerning groups, ligature
rules and metrics. New weights start as copies of an existing one, so their
outlines stay point-compatible. That replaces the earlier idea of
`uni05D0-Bold.svg` suffixes in one folder. What's left for variable fonts is
the compatibility checking, the designspace/axis setup and the variable
build.

The hard part is **interpolation compatibility**, not the axis math —
`fontTools.varLib` interpolates fine once inputs match. Since masters
arrive as independent Illustrator exports, nothing enforces matching
contour count / point count / point order across them.

- Use **CFF2**, not glyf/gvar — Illustrator/SVG produce cubic curves
  natively, and CFF2 keeps them cubic end-to-end (gvar would require
  `cu2qu` cubic→quadratic conversion, one more place compatibility breaks).
- Wire `varLib.interpolatable` into the import step as soon as a glyph has
  a second master, surfacing structural mismatches (e.g. "Bold alef has 14
  points, Regular has 12") in-app rather than as a cryptic compile failure.
- File convention: one SVG per (glyph, master) as above, plus a
  `.designspace` file mapping axes/masters, consumed directly by
  `fontmake`/`varLib`.
- Anchors/kerning/ligatures mostly carry over for free — `ufo2ft`'s feature
  writers generate variable GSUB/GPOS directly from per-master data rather
  than needing a separate variable-specific system.

## Project folders & file handling

**Goal:** the app has its own project format and handling. A project is one
self-contained folder that the app creates, recognizes and manages. You
operate a project by opening its folder, and everything the project needs
lives inside it.

- **A project file marks the folder**, e.g. `MyFont.fonttastic` (JSON) at the
  root: project name, format version, and project settings (default metrics,
  preview text, export targets, which subfolders hold sources). Only folders
  with this file open as projects; a folder in the old layout
  (`glyphs/` + `font.ufo/`) is offered a one-click conversion instead of being
  modified silently.
- **Standard layout, created by "New project":**
  ```
  MyFont/
    MyFont.fonttastic   project file
    glyphs/             Illustrator SVGs (the source folder can also be set to another location)
    font.ufo/           app-owned font data
    build/              exports
  ```
  Later phases add `masters/` + a `.designspace` (Phase 2) and per-script
  source folders (Phase 3) to the same structure.
- **Portable:** all paths inside the project are relative, so the folder can
  be moved, zipped, synced or put under git and still open.
- **Open screen:** "New project…", "Open project…", a recent-projects list,
  and reopening the last project on launch.
- **Safety:** snapshots of `font.ufo` before destructive operations (replacing
  outlines, mass re-import), so they can be undone.
- **Later:** Windows file association, so double-clicking `MyFont.fonttastic`
  opens the app on that project.

## UI overhaul (designed in Figma)

**Goal:** replace the current functional-but-plain UI with a proper design.
The project's author designs it in Figma, then hands it over for
implementation. Until then, UI work stays functional and doesn't invest in
visual polish that the redesign will replace.

- **Handoff:** Figma frames for each screen (home, glyph editor, kerning,
  ligatures, project, import dialog) and their states (empty, error,
  selected, dragging). The design is either read directly through the Figma
  connector or exported as images plus Dev Mode specs.
- **Design tokens first:** colours, type, spacing and radii as Figma
  variables. They map one-to-one onto the CSS custom properties the UI
  already uses (`frontend/src/index.css`), so a reskin is mostly a token
  swap. Light and dark themes can both be defined there.
- **Scope:** the redesign changes the look and layout, not the architecture.
  Components (glyph grid, editor canvas, inspector, preview, panels) keep
  their data flow, so features built before the redesign carry over.
- Hebrew/RTL is a first-class concern of the design: RTL text inputs,
  mixed-direction labels, and previews that read right to left.
- **Replace native browser dialogs.** Confirmations (delete glyph, delete
  kerning group, restore snapshot) currently use `window.confirm()`. That
  looks generic and can be mistaken for a system or browser warning, so it
  should become an in-app dialog in the app's own style.

## Bilingual / multilingual fonts (Phase 3, not urgent)

**The end goal:** use the app to build bilingual and eventually multilingual
fonts, with Hebrew as the first script. The typical target is Hebrew + Latin
in one font family, with other scripts possible later. Phases 1–2 stay
Hebrew-first, but they shouldn't make choices that block this.

What it involves:
- **Per-script awareness throughout:** glyph grid sections per script,
  default anchor seeding per script (e.g. Latin accents: `top`/`bottom` on
  base letters, `_top`/`_bottom` on combining marks), and `languagesystem`
  statements generated from the scripts actually present, not hard-coded
  `hebr`.
- **Cross-script harmony:** shared vertical metrics (Hebrew letter height vs.
  Latin cap height/x-height), matched stem weights and color, and tools to
  compare the scripts side by side.
- **Mixed-direction preview:** mixed Hebrew/Latin text needs bidi
  itemization (split into LTR/RTL runs, each shaped separately by HarfBuzz)
  before shaping. Today the preview shapes each line as a single run.
- **Kerning within and across scripts:** most kerning stays within one
  script, but spaces, punctuation and numerals are shared between scripts
  and get kerned against both.
- **Shared glyphs:** digits, punctuation, currency (₪, $, €) and the space
  are shared. Directionally mirrored punctuation (parentheses, brackets)
  relies on the OS's bidi mirroring, not separate glyphs.

Already compatible: glyph naming (`uni0061.svg`, `a.svg` and AGL names are
already understood), the UFO data model, ufo2ft's feature writers (they
split kern/mark lookups by script automatically), and HarfBuzz shaping.

## Recommended stack

| Layer | Tool |
|---|---|
| Glyph object model, UFO I/O | `fontTools`, `defcon` / `fontParts` (Python) |
| Font compilation | `ufo2ft`, `fontmake` |
| Mark/kern/ligature feature generation | `ufo2ft` feature writers (`markFeatureWriter`, `kernFeatureWriter`) |
| Variable font compatibility checking | `fontTools.varLib.interpolatable` |
| Variable font build | `fontTools.varLib`, CFF2 |
| Live RTL shaping preview | `harfbuzzjs` (WASM HarfBuzz for JS) |

## Reference projects (study, don't fork)

- **Fontra** — FOSS (GPLv3), browser-based, JS client + Python server, built
  on fontTools. Closest existing thing to "less abstract than FontForge,
  FOSS." Its glyph-naming conventions lean Latin/CJK/Indic; RTL/Hebrew
  mark-stacking isn't a first-class focus there — a real gap this project
  can fill.
- **Fontself** — proprietary Illustrator/Photoshop plugin; the UX pattern of
  artboard/file-name-as-glyph-name is worth mirroring, the plugin
  architecture is explicitly *not* being copied (see non-goals).

## Suggested build sequence

1. **Static font, end to end first:** SVG import → metrics → niqqud anchors
   → kerning → ligatures → compile → RTL preview. This exercises the whole
   pipeline minus the interpolation-compatibility layer.
2. **Round-trip editing:** filesystem watcher + "open in Illustrator."
   **Project handling** fits here too: project file, New/Open/recent
   projects, portable folder layout, snapshots (see "Project folders & file
   handling").
3. **Variable fonts, additive:** multi-master import, `varLib.interpolatable`
   compatibility checking, designspace UI. Nothing from step 1 gets rebuilt.
4. **Bilingual / multilingual (Phase 3):** per-script grid, anchors and
   `languagesystem`s; bidi-aware preview; cross-script metrics and kerning.
   Hebrew + Latin first.
