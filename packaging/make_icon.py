"""Render the app icons from the logo in images/.

Writes packaging/fonttastic.ico (the .exe / taskbar icon) and
frontend/public/favicon.png (the UI's favicon). The white logo sits on a dark
rounded tile so it reads on both light and dark taskbars.

Only needed when the logo changes; the outputs are committed.
Requires Pillow:  python packaging/make_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
LOGO = ROOT / "images" / "fontastic logo dark bg.png"  # the white variant, for dark backgrounds
TILE = (30, 30, 36, 255)  # the app's panel colour
PADDING = 0.14  # share of the tile left empty around the logo
RADIUS = 0.22  # corner radius, as a share of the tile


def render(size: int, logo: Image.Image) -> Image.Image:
    scale = 4  # draw large, then downsample for smooth edges
    big = size * scale
    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, big - 1, big - 1), radius=round(big * RADIUS), fill=TILE)
    inner = round(big * (1 - 2 * PADDING))
    art = logo.copy()
    art.thumbnail((inner, inner), Image.LANCZOS)
    tile.alpha_composite(art, ((big - art.width) // 2, (big - art.height) // 2))
    return tile.resize((size, size), Image.LANCZOS)


def main():
    logo = Image.open(LOGO).convert("RGBA")
    logo = logo.crop(logo.getchannel("A").getbbox())  # trim the transparent margin

    ico = ROOT / "packaging" / "fonttastic.ico"
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [render(s, logo) for s in sizes]
    images[-1].save(ico, sizes=[(s, s) for s in sizes], append_images=images[:-1])
    print(f"Wrote {ico}")

    favicon = ROOT / "frontend" / "public" / "favicon.png"
    render(64, logo).save(favicon)
    print(f"Wrote {favicon}")


if __name__ == "__main__":
    main()
