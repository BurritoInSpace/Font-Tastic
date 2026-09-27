"""Build dist/Font-tastic/Font-tastic.exe, and optionally the release files.

    python packaging/build_exe.py                build the UI, then the exe
    python packaging/build_exe.py --zip          ...and dist/Font-tastic-<version>-windows.zip
    python packaging/build_exe.py --installer    ...and dist/Font-tastic-<version>-setup.exe (Inno Setup)
    python packaging/build_exe.py --shortcut     ...and put a Font-tastic shortcut on the desktop

Needs the dev tools:  pip install -e ".[build]"   and   npm install  in frontend/.
The installer needs Inno Setup 6 (ISCC.exe; set ISCC to its path if it isn't found).
"""

import argparse
import os
import shutil
import zipfile
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DIST = ROOT / "dist"
APP = DIST / "Font-tastic"
EXE = APP / "Font-tastic.exe"
sys.path.insert(0, str(ROOT))
from fonttastic import __version__  # noqa: E402


def find_iscc() -> Path | None:
    candidates = [os.environ.get("ISCC"), shutil.which("iscc")]
    for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"),
                 os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs")):
        if base:
            candidates.append(os.path.join(base, "Inno Setup 6", "ISCC.exe"))
    return next((Path(c) for c in candidates if c and Path(c).is_file()), None)


def make_zip() -> Path:
    """The app folder zipped as Font-tastic/..., to extract anywhere and run."""
    out = DIST / f"Font-tastic-{__version__}-windows.zip"
    out.unlink(missing_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in sorted(APP.rglob("*")):
            if f.is_file():
                z.write(f, Path("Font-tastic") / f.relative_to(APP))
    return out


def make_installer() -> Path:
    iscc = find_iscc()
    if iscc is None:
        sys.exit("Inno Setup's ISCC.exe not found; install Inno Setup 6 or set ISCC to its path")
    run([str(iscc), f"/DAppVersion={__version__}", f"/DSourceDir={APP}", f"/DOutputDir={DIST}",
         str(ROOT / "packaging" / "installer.iss")])
    return DIST / f"Font-tastic-{__version__}-setup.exe"


def run(cmd, **kwargs):
    print(">", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, **kwargs)


def make_shortcut():
    desktop = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    link = Path(desktop) / "Font-tastic.lnk"
    script = (
        "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:FT_LINK); "
        "$s.TargetPath = $env:FT_EXE; $s.WorkingDirectory = $env:FT_DIR; "
        "$s.IconLocation = $env:FT_EXE; $s.Description = 'Font-tastic font editor'; $s.Save()"
    )
    env = {**__import__("os").environ, "FT_LINK": str(link), "FT_EXE": str(EXE), "FT_DIR": str(APP)}
    run(["powershell", "-NoProfile", "-Command", script], env=env)
    print(f"Shortcut: {link}")


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--shortcut", action="store_true", help="also create a desktop shortcut")
    parser.add_argument("--skip-ui", action="store_true", help="reuse the existing frontend/dist")
    parser.add_argument("--zip", action="store_true", help="also make the portable zip")
    parser.add_argument("--installer", action="store_true", help="also make the installer (needs Inno Setup)")
    args = parser.parse_args()

    if not args.skip_ui:
        npm = shutil.which("npm")
        if not npm:
            sys.exit("npm not found; install Node.js or pass --skip-ui")
        run([npm, "run", "build"], cwd=FRONTEND)
    if not (FRONTEND / "dist" / "index.html").is_file():
        sys.exit("frontend/dist is missing; build the UI first")

    run([sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
         "--distpath", str(DIST), "--workpath", str(ROOT / "build" / "pyinstaller"),
         str(ROOT / "packaging" / "fonttastic.spec")])
    # The licence and third-party notices travel with the app.
    shutil.copy2(ROOT / "LICENSE", APP / "LICENSE.txt")
    run([sys.executable, str(ROOT / "packaging" / "notices.py"), str(APP / "THIRD_PARTY_NOTICES.txt")])
    print(f"\nBuilt {EXE} (version {__version__})")

    if args.zip:
        print(f"Zip: {make_zip()}")
    if args.installer:
        print(f"Installer: {make_installer()}")

    if args.shortcut:
        make_shortcut()


if __name__ == "__main__":
    main()
