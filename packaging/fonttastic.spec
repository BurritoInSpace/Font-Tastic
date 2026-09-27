# PyInstaller spec for Font-tastic.exe. Build with:  python packaging/build_exe.py
# Output: dist/Font-tastic/Font-tastic.exe (a folder build: starts faster than a one-file exe)

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules
from PyInstaller.utils.win32.versioninfo import (
    FixedFileInfo, StringFileInfo, StringStruct, StringTable, VarFileInfo, VarStruct, VSVersionInfo,
)

ROOT = Path(SPECPATH).parent
sys.path.insert(0, str(ROOT))
from fonttastic import __version__  # noqa: E402

# Shown in the exe's Properties › Details in Windows.
_nums = tuple(int(n) for n in __version__.split(".")[:3]) + (0,)
VERSION_INFO = VSVersionInfo(
    ffi=FixedFileInfo(filevers=_nums, prodvers=_nums),
    kids=[
        StringFileInfo([StringTable("040904B0", [
            StringStruct("ProductName", "Font-tastic"),
            StringStruct("FileDescription", "Font-tastic font editor"),
            StringStruct("FileVersion", __version__),
            StringStruct("ProductVersion", __version__),
            StringStruct("LegalCopyright", "GPL-3.0-or-later"),
            StringStruct("OriginalFilename", "Font-tastic.exe"),
        ])]),
        VarFileInfo([VarStruct("Translation", [0x0409, 0x04B0])]),
    ],
)

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
    version=VERSION_INFO,
    console=False,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="Font-tastic", upx=False)
