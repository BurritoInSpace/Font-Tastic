Small improvements for working on variable fonts, and an export option. Font-tastic is a free font editor for Hebrew-first and bilingual fonts: you draw the letters in Illustrator or Inkscape, and Font-tastic handles everything typographic and exports the fonts.

Still a beta: please report problems in [Issues](https://github.com/BurritoInSpace/Font-Tastic/issues).

## What's new in 0.9.2

- **Find variable-font problems faster:** in the variable tab, each glyph in the problem list shows its character and name (e.g. "ה hebrew letter he"). Click a problem to open the glyph with its points shown: the contour or segment it's about flashes yellow for a moment. Segment problems now name their end points as the points view numbers them, e.g. "between points 2 and 3".
- **Open the export folder:** tick *Open the folder when done* in the Export dialog and the `build` folder opens in Explorer after exporting.
- **Fixed:** the Export dialog now remembers your choices when you open it again, without restarting the app.

## Download (Windows 10/11, 64-bit)

- **Font-tastic-0.9.2-setup.exe**: installer (recommended). Installs for your user only, no admin rights needed, and replaces an earlier version in place. Adds a Start menu entry, optionally a desktop shortcut, and can open `.fonttastic` project files on double-click. Uninstall from Windows Settings › Apps.
- **Font-tastic-0.9.2-windows.zip**: portable. Extract anywhere and run `Font-tastic.exe`.

**"Windows protected your PC"**: the app isn't code-signed yet, so Windows SmartScreen warns the first time. Click **More info › Run anyway**.

Font-tastic needs Microsoft's **WebView2 Runtime**, which Windows 11 and current Windows 10 already have. The installer tells you if it's missing.

Font-tastic is free software under the GPL-3.0 licence. It's developed with heavy AI assistance ("vibe-coded"); see the README.
