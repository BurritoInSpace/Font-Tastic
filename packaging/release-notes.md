The first public release of Font-tastic, a free font editor for Hebrew-first and bilingual fonts. You draw the letters in Illustrator or Inkscape; Font-tastic handles everything typographic and exports the fonts.

This is a beta: it's been used on real fonts, but expect rough edges. Please report problems in [Issues](https://github.com/BurritoInSpace/Font-Tastic/issues).

## Download (Windows 10/11, 64-bit)

- **Font-tastic-0.9.0-setup.exe**: installer (recommended). Installs for your user only, no admin rights needed. Adds a Start menu entry, optionally a desktop shortcut, and can open `.fonttastic` project files on double-click. Uninstall from Windows Settings › Apps.
- **Font-tastic-0.9.0-windows.zip**: portable. Extract anywhere and run `Font-tastic.exe`.

**"Windows protected your PC"**: the app isn't code-signed yet, so Windows SmartScreen warns the first time. Click **More info › Run anyway**.

Font-tastic needs Microsoft's **WebView2 Runtime**, which Windows 11 and current Windows 10 already have. The installer tells you if it's missing.

## What's in it

- **Your drawing app for the letters:** one SVG per glyph, from Illustrator or Inkscape (no Adobe needed). Saves update the app live; Edit opens a glyph in your drawing app.
- **Hebrew done properly:** niqqud placed by anchors (including dagesh and shin/sin dots), final letters, right-to-left preview shaped by HarfBuzz.
- **Bilingual fonts:** Hebrew with Latin, Greek or Cyrillic in one font, with accented letters (é, ü, ñ…) built from the letters and accents you draw, and a mixed-direction preview.
- **Spacing and kerning:** side bearings set by moving the artboard, pair and class kerning with gap markers for consistent spacing.
- **Ligatures and stylistic alternates.**
- **Variable fonts:** weight, width, optical size, slant, italic, grade or custom axes, with compatibility checks and point order fixes between masters.
- **Bulk actions** from the logo menu: side bearings, anchors, point order for many glyphs at once.
- **Export** static OTF/TTF and variable OTF (CFF2) / TTF.

Font-tastic is free software under the GPL-3.0 licence. It's developed with heavy AI assistance ("vibe-coded"); see the README.
