Fixes and small improvements found while making test fonts. Font-tastic is a free font editor for Hebrew-first and bilingual fonts: you draw the letters in Illustrator or Inkscape, and Font-tastic handles everything typographic and exports the fonts.

Still a beta: please report problems in [Issues](https://github.com/BurritoInSpace/Font-Tastic/issues).

## What's new in 0.9.1

- **Fewer false mismatches between weights:** a segment with no handles in Illustrator (both handles retracted) is now read as a straight line, even when the SVG saves it as a curve. Before, it could show up as "straight in one weight, curved in the other" in the variable tab. When you open a project, every glyph is re-read once to pick this up.
- **Clearer point numbers:** in Show points, each contour counts its points from 1 at its start point, with the contour's number in a separate tag (C1, C2…). Before, the second contour's first point was labelled "#2" and looked like point 2.
- **Importing many files:** the import dialog can answer all files at once: Replace all, All as alternates, Skip all, and Skip all unrecognized, plus a filter to show only the files that still need an answer.
- **Keyboard shortcuts:** Ctrl+S switches to the master you were on before (and back), Ctrl+I imports SVGs. The Project tab now lists every shortcut.

## Download (Windows 10/11, 64-bit)

- **Font-tastic-0.9.1-setup.exe**: installer (recommended). Installs for your user only, no admin rights needed, and replaces an earlier version in place. Adds a Start menu entry, optionally a desktop shortcut, and can open `.fonttastic` project files on double-click. Uninstall from Windows Settings › Apps.
- **Font-tastic-0.9.1-windows.zip**: portable. Extract anywhere and run `Font-tastic.exe`.

**"Windows protected your PC"**: the app isn't code-signed yet, so Windows SmartScreen warns the first time. Click **More info › Run anyway**.

Font-tastic needs Microsoft's **WebView2 Runtime**, which Windows 11 and current Windows 10 already have. The installer tells you if it's missing.

Font-tastic is free software under the GPL-3.0 licence. It's developed with heavy AI assistance ("vibe-coded"); see the README.
