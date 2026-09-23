# PyInstaller spec for Font-tastic.exe. Build with:  python packaging/build_exe.py
# Output: dist/Font-tastic/Font-tastic.exe (a folder build: starts faster than a one-file exe)

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ROOT = Path(SPECPATH).parent

hiddenimports = (
    collect_submodules("fontTools")  # table and feature modules are imported by name at runtime
    + collect_submodules("ufo2ft")
    + collect_submodules("ufoLib2")
)

a = Analysis(
    [str(ROOT / "packaging" / "launch.py")],
    pathex=[str(ROOT)],
    datas=[
        # server.py serves the UI from <app>/frontend/dist
        (str(ROOT / "frontend" / "dist"), "frontend/dist"),
        # cffsubr runs its bundled tx.exe for CFF subroutinization on export
        *collect_data_files("cffsubr"),
    ],
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "uharfbuzz", "PIL", "PyInstaller"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Font-tastic",
    icon=str(ROOT / "packaging" / "fonttastic.ico"),
    console=False,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Font-tastic", upx=False)
