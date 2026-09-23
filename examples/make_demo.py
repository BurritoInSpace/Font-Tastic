"""Generate a small demo project with crude, blocky Hebrew glyphs.

The SVGs imitate what Illustrator writes with "Preserve Illustrator Editing
Capabilities" on (DOCTYPE entities, <switch>/<foreignObject>, private
namespace data, CSS classes), so the importer is exercised on realistic input.

Artboards are 1000 units tall: y=0 is the ascender (800), y=800 the
baseline, y=1000 the descender (-200). Cap height 700 -> y=100.

    python examples/make_demo.py [target-dir]

Creates a Font-tastic project there (or reuses / converts an existing one).
"""

import sys
from pathlib import Path

TEMPLATE = """<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 30.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [
	<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
	<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
	<!ENTITY ns_graphs "http://ns.adobe.com/Graphs/1.0/">
	<!ENTITY ns_vars "http://ns.adobe.com/Variables/1.0/">
	<!ENTITY ns_imrep "http://ns.adobe.com/ImageReplacement/1.0/">
	<!ENTITY ns_sfw "http://ns.adobe.com/SaveForWeb/1.0/">
	<!ENTITY ns_custom "http://ns.adobe.com/GenericCustomNamespace/1.0/">
	<!ENTITY ns_adobe_xpath "http://ns.adobe.com/XPath/1.0/">
]>
<svg version="1.1" id="Layer_1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns:graph="&ns_graphs;"
	 xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" x="0px" y="0px"
	 viewBox="0 0 {w} 1000" style="enable-background:new 0 0 {w} 1000;" xml:space="preserve">
<style type="text/css">
	.st0{{fill:#1A1A1A;}}
	.st1{{fill-rule:evenodd;clip-rule:evenodd;fill:#1A1A1A;}}
</style>
<metadata>
	<sfw  xmlns="&ns_sfw;">
		<slices></slices>
		<sliceSourceBounds  bottomLeftOrigin="true" height="1000" width="{w}" x="0" y="0"></sliceSourceBounds>
	</sfw>
</metadata>
<switch>
	<foreignObject requiredExtensions="&ns_ai;" x="0" y="0" width="1" height="1">
		<i:aipgfRef  xlink:href="#adobe_illustrator_pgf">
		</i:aipgfRef>
	</foreignObject>
	<g i:extraneous="self">
{body}
	</g>
</switch>
<i:aipgf  id="adobe_illustrator_pgf"  i:pgfEncoding="zstd/base64" i:pgfVersion="24">
	KLUv/QBYnQ0AZhwOKZBVPH/Z+2kDyxsP7aigrDmqnFA8CQrK... (editing data, ignored)
</i:aipgf>
</svg>
"""


def rect(x0, y0, x1, y1, cls="st0"):
    return f'\t\t<rect x="{x0}" y="{y0}" class="{cls}" width="{x1 - x0}" height="{y1 - y0}"/>'


def circle(cx, cy, r):
    return f'\t\t<circle class="st0" cx="{cx}" cy="{cy}" r="{r}"/>'


def path(d, cls="st0"):
    return f'\t\t<path class="{cls}" d="{d}"/>'


T, B, S = 100, 800, 80  # cap-height line, baseline, stroke thickness

GLYPHS = {
    # --- letters (U+05D0..U+05EA) ---
    "uni05D0": (620, [  # alef
        path("M80,100 L200,100 L540,800 L420,800 Z"),
        rect(400, 100, 480, 420),
        path("M140,480 L220,480 L220,800 L140,800 Z"),
    ]),
    "uni05D1": (600, [rect(80, T, 480, T + S), rect(400, T, 480, B), rect(60, B - S, 540, B)]),  # bet
    "uni05D3": (560, [rect(60, T, 520, T + S), rect(380, T, 460, B)]),  # dalet
    "uni05D4": (560, [rect(60, T, 500, T + S), rect(420, T, 500, B), rect(80, 320, 160, B)]),  # he
    "uni05D5": (340, [rect(80, T, 260, T + S), rect(180, T, 260, B)]),  # vav
    "uni05DB": (560, [rect(80, T, 400, T + S), rect(400 - S, T, 480, B), rect(80, B - S, 480, B)]),  # kaf
    "uni05DC": (560, [rect(100, 0, 180, 380), rect(100, 300, 480, 380), rect(400, 300, 480, 620),
                      path("M400,560 L480,620 L260,800 L180,740 Z")]),  # lamed (ascender)
    "uni05DD": (620, [path("M60,100 H560 V800 H60 Z M140,180 V720 H480 V180 Z", cls="st1")]),  # final mem
    "uni05DE": (640, [rect(60, T, 580, T + S), rect(500, T, 580, B), rect(200, B - S, 580, B),
                      rect(60, T, 140, 560)]),  # mem
    "uni05DF": (320, [rect(60, T, 240, T + S), rect(160, T, 240, 980)]),  # final nun
    "uni05E0": (400, [rect(60, T, 320, T + S), rect(240, T, 320, B), rect(60, B - S, 320, B)]),  # nun
    "uni05E9": (660, [rect(60, T, 140, B), rect(290, T, 370, B), rect(520, T, 600, B),
                      rect(60, B - S, 600, B)]),  # shin
    "uni05EA": (620, [rect(60, T, 560, T + S), rect(480, T, 560, B), rect(120, T, 200, B),
                      rect(60, B - S, 200, B)]),  # tav
    # --- stylistic alternate: bet with a rounded corner ---
    "uni05D1.salt": (600, [path("M80,100 H300 C420,100 480,160 480,280 V720 H540 V800 H60 V720 H400"
                                " V280 C400,210 370,180 300,180 H80 Z")]),
    # --- ligature: alef + lamed ---
    # (RTL: alef, read first, sits on the right; lamed on the left)
    "uni05D0_uni05DC.liga": (980, [rect(60, 0, 140, 380), rect(60, 300, 420, 380), rect(340, 300, 420, B),
                                   path("M440,100 L560,100 L900,800 L780,800 Z"),
                                   rect(760, 100, 840, 420), rect(500, 480, 580, B)]),
    # --- niqqud: drawn where they sit relative to a letter on the baseline ---
    "uni05B0": (600, [circle(300, 860, 28), circle(300, 950, 28)]),  # sheva
    "uni05B4": (600, [circle(300, 880, 30)]),  # hiriq
    "uni05B7": (600, [rect(180, 850, 420, 900)]),  # patah
    "uni05B8": (600, [rect(180, 850, 420, 900), rect(275, 850, 325, 960)]),  # qamats
    "uni05B9": (600, [circle(300, 40, 30)]),  # holam
    "uni05BC": (600, [circle(300, 450, 34)]),  # dagesh
    "uni05C1": (600, [circle(300, 40, 30)]),  # shin dot
    "uni05C2": (600, [circle(300, 40, 30)]),  # sin dot
}


def main(target):
    """Create (or reuse / convert) a Font-tastic project at `target` and fill its glyphs/."""
    from fonttastic.project import Project, find_project_file, is_legacy_folder

    target = Path(target)
    if target.is_dir() and find_project_file(target):
        project = Project(target)
    elif target.is_dir() and is_legacy_folder(target):
        project = Project.convert(target)
    else:
        project = Project.create(target, "Demo")
    for name, (width, shapes) in GLYPHS.items():
        svg = TEMPLATE.format(w=width, body="\n".join(shapes))
        (project.glyphs_dir / f"{name}.svg").write_text(svg, encoding="utf-8")
    print(f"Wrote {len(GLYPHS)} SVGs to {project.glyphs_dir} ({project.file.name})")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent / "demo")
