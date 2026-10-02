"""Draws the Halloween decoration (corner spider web, two hanging spiders)
onto a logo image. How the seasonal logos were made:

    python halloween-logo.py assets/images/app-icon.png assets/images/app-icon-halloween.png
    python halloween-logo.py assets/images/weekend-league-emblem.png assets/images/weekend-league-emblem-halloween.png rgba

Needs Pillow. The third argument keeps transparency (for the emblem)."""
import math, sys
from PIL import Image, ImageDraw, ImageFilter

SRC, OUT = sys.argv[1], sys.argv[2]
base = Image.open(SRC).convert("RGBA")
W = base.width
s = W / 1024

layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
d = ImageDraw.Draw(layer)

WEB = (235, 235, 245, 235)
ORANGE = (255, 122, 26, 255)
# Corner web, anchored at the top-right corner: spokes fanning out, with
# sagging threads between them (like Snapchat's).
cx, cy = W, 0
spokes = [math.radians(a) for a in (168, 149, 130, 111, 96)]
R = 420 * s
def pt(a, r):
    return (cx + r * math.cos(a), cy + r * math.sin(a))
for a in spokes:
    d.line([pt(a, 0), pt(a, R)], fill=WEB, width=int(7 * s))
for r in (105, 195, 285, 375):
    r *= s
    for a1, a2 in zip(spokes, spokes[1:]):
        p1, p2 = pt(a1, r), pt(a2, r)
        mid = ((p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2)
        # sag toward the corner
        sag = 0.16
        ctrl = (mid[0] + (cx - mid[0]) * sag, mid[1] + (cy - mid[1]) * sag)
        pts = []
        for i in range(21):
            t = i / 20
            x = (1 - t) ** 2 * p1[0] + 2 * (1 - t) * t * ctrl[0] + t * t * p2[0]
            y = (1 - t) ** 2 * p1[1] + 2 * (1 - t) * t * ctrl[1] + t * t * p2[1]
            pts.append((x, y))
        d.line(pts, fill=WEB, width=int(6 * s), joint="curve")

def spider(x, top, y, size):
    size *= s
    d.line([(x, top), (x, y - size * 0.9)], fill=WEB, width=int(5 * s))
    # legs: 4 per side, bent
    for side in (-1, 1):
        for i, (ang, bend) in enumerate(((-40, 30), (-12, 18), (12, -10), (38, -30))):
            a = math.radians(ang)
            kx = x + side * size * 1.25 * math.cos(a)
            ky = y + size * 1.25 * math.sin(a) - size * 0.35
            fx = kx + side * size * 0.75
            fy = ky + size * (0.9 + i * 0.12)
            leg = [(x + side * size * 0.3, y), (kx, ky), (fx, fy)]
            # Orange underneath, dark on top: an outline, so the legs
            # still read on the dark starfield.
            d.line(leg, fill=ORANGE, width=int(size * 0.42), joint="curve")
            d.line(leg, fill=(15, 12, 20, 255), width=int(size * 0.2), joint="curve")
    # abdomen + head
    d.ellipse([x - size * 0.62, y - size * 0.25, x + size * 0.62, y + size * 1.05], fill=(15, 12, 20, 255), outline=ORANGE, width=int(size * 0.12))
    d.ellipse([x - size * 0.4, y - size * 0.85, x + size * 0.4, y - size * 0.1], fill=(15, 12, 20, 255), outline=ORANGE, width=int(size * 0.1))
    for ex in (-0.16, 0.16):
        d.ellipse([x + ex * size - size * 0.08, y - size * 0.55, x + ex * size + size * 0.08, y - size * 0.4], fill=ORANGE)

spider(150 * s, 0, 215 * s, 50)
spider(875 * s, 330 * s, 760 * s, 46)

# A soft orange glow under everything so it reads on the dark starfield.
glow = layer.copy().filter(ImageFilter.GaussianBlur(10 * s))
tint = Image.new("RGBA", base.size, (255, 120, 20, 0))
tint.putalpha(glow.getchannel("A").point(lambda v: int(v * 0.18)))
out = Image.alpha_composite(base, tint)
out = Image.alpha_composite(out, layer)
(out if len(sys.argv) > 3 and sys.argv[3] == "rgba" else out.convert("RGB")).save(OUT)
print("ok", OUT)
