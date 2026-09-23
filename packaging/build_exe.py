"""Build dist/Font-tastic/Font-tastic.exe.

    python packaging/build_exe.py              build the UI, then the exe
    python packaging/build_exe.py --shortcut   ...and put a Font-tastic shortcut on the desktop

Needs the dev tools:  pip install -e ".[build]"   and   npm install  in frontend/.
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
DIST = ROOT / "dist"
APP = DIST / "Font-tastic"
EXE = APP / "Font-tastic.exe"


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
    print(f"\nBuilt {EXE}")

    if args.shortcut:
        make_shortcut()


if __name__ == "__main__":
    main()
