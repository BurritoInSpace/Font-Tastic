"""Write THIRD_PARTY_NOTICES.txt: the licences of everything the app ships with.

Python packages are found by following fonttastic's dependencies (what the
exe bundles), and each one's own licence files are included. The frontend's
runtime libraries come from node_modules, the UI font's licence from
frontend/public/fonts. Run by build_exe.py; can also be run on its own:

    python packaging/notices.py [output path]
"""

from __future__ import annotations

import json
import re
import sys
from importlib import metadata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
# The UI's runtime libraries (bundled into frontend/dist), not build tools.
NPM_RUNTIME = ["react", "react-dom", "scheduler", "harfbuzzjs", "bidi-js"]
SKIP = {"fonttastic", "pip", "setuptools", "wheel"}
RULE = "=" * 78


def _name(req: str) -> str:
    return re.split(r"[\s;<>=!~\[(]", req, maxsplit=1)[0].lower().replace("_", "-")


def python_packages() -> list[metadata.Distribution]:
    """fonttastic's runtime dependencies, recursively (extras and markers that
    don't apply on this platform are left out)."""
    seen: dict[str, metadata.Distribution] = {}
    todo = ["fonttastic"]
    while todo:
        name = todo.pop()
        try:
            dist = metadata.distribution(name)
        except metadata.PackageNotFoundError:
            continue
        key = dist.metadata["Name"].lower().replace("_", "-")
        if key in seen:
            continue
        seen[key] = dist
        for req in dist.requires or []:
            if "extra ==" in req:
                continue
            marker = req.split(";", 1)[1] if ";" in req else None
            if marker:
                from packaging.markers import Marker  # vendored with pip/setuptools on any build machine

                if not Marker(marker).evaluate():
                    continue
            todo.append(_name(req))
    return [d for k, d in sorted(seen.items()) if k not in SKIP]


def _license_texts(dist: metadata.Distribution) -> list[str]:
    texts = []
    for f in dist.files or []:
        if re.search(r"(LICEN[CS]E|COPYING|NOTICE)", f.name, re.I) and ".dist-info" in str(f):
            try:
                texts.append(Path(dist.locate_file(f)).read_text(encoding="utf-8", errors="replace").strip())
            except OSError:
                pass
    return texts


def _license_name(dist: metadata.Distribution) -> str:
    m = dist.metadata
    expr = m.get("License-Expression")
    if expr:
        return expr
    classifiers = [c.split("::")[-1].strip() for c in m.get_all("Classifier") or [] if c.startswith("License ::")]
    lic = (m.get("License") or "").strip()
    return ", ".join(classifiers) or (lic if lic and len(lic) < 80 else "see below")


def build() -> str:
    parts = [
        "Font-tastic third-party notices",
        "",
        "Font-tastic is licensed under the GNU General Public License v3.0 or later (see LICENSE).",
        "It includes the following software and fonts, under their own licences.",
        "",
    ]

    def section(title: str, licence: str, texts: list[str]):
        parts.extend([RULE, f"{title}  —  {licence}", RULE, ""])
        parts.extend(t + "\n" for t in texts)

    py_license = Path(sys.base_prefix) / "LICENSE.txt"
    section(f"Python {sys.version.split()[0]}", "PSF License",
            [py_license.read_text(encoding="utf-8", errors="replace").strip()] if py_license.is_file() else [])
    section("PyInstaller bootloader", "GPL-2.0-or-later with the PyInstaller bootloader exception",
            ["The executable's startup code comes from PyInstaller (https://pyinstaller.org)."])
    for dist in python_packages():
        section(f"{dist.metadata['Name']} {dist.version}", _license_name(dist), _license_texts(dist))
    section("Adobe Font Development Kit tx (inside cffsubr)", "Apache-2.0",
            ["cffsubr runs Adobe's tx tool, from the AFDKO (https://github.com/adobe-type-tools/afdko),\n"
             "licensed under the Apache License 2.0 (http://www.apache.org/licenses/LICENSE-2.0)."])

    for pkg in NPM_RUNTIME:
        folder = FRONTEND / "node_modules" / pkg
        manifest = folder / "package.json"
        if not manifest.is_file():
            continue
        info = json.loads(manifest.read_text(encoding="utf-8"))
        texts = [p.read_text(encoding="utf-8", errors="replace").strip()
                 for p in sorted(folder.glob("*")) if re.match(r"(LICEN[CS]E|COPYING)", p.name, re.I)]
        section(f"{pkg} {info.get('version', '')} (user interface)", str(info.get("license", "see below")), texts)

    ofl = FRONTEND / "public" / "fonts" / "OFL.txt"
    if ofl.is_file():
        section("Google Sans (user interface font)", "SIL Open Font License 1.1",
                [ofl.read_text(encoding="utf-8", errors="replace").strip()])
    return "\n".join(parts)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "THIRD_PARTY_NOTICES.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(build(), encoding="utf-8")
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
