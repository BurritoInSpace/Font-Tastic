"""Render packaging/fonttastic.ico (the app icon) from the favicon's design.

Only needed when the icon changes; the .ico is committed.
Requires Pillow:  python packaging/make_icon.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

BG = (30, 30, 36, 255)
GOLD = (242, 193, 78, 255)
# The favicon's bet, on a 32-unit grid: M8 9 h13 v14 h4 v3 H7 v-3 h11 V12 H8 z
BET = [(8, 9), (21, 9), (21, 23), (25, 23), (25, 26), (7, 26), (7, 23), (18, 23), (18, 12), (8, 12)]


def render(size: int) -> Image.Image:
    scale = 8  # draw large, then downsample for smooth edges
    big = size * scale
    k = big / 32
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, big - 1, big - 1), radius=round(7 * k), fill=BG)
    d.polygon([(x * k, y * k) for x, y in BET], fill=GOLD)
    return img.resize((size, size), Image.LANCZOS)


def main():
    out = Path(__file__).with_name("fonttastic.ico")
    sizes = [16, 24, 32, 48, 64, 128, 256]
    images = [render(s) for s in sizes]
    images[-1].save(out, sizes=[(s, s) for s in sizes], append_images=images[:-1])
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
