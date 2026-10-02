"""Renders The Weekend's logos (normal, Halloween, winter) to every PNG
the app and website ship, from one SVG drawing — the design approved on
the "The Weekend — Rebrand Mockups" canvas. Uses headless Google Chrome
(for the real Anton/Satisfy webfonts) and Pillow for the .ico.

    python3 mobile/scripts/the-weekend-logo.py

Writes into mobile/assets/images and frontend/public/images (+ the web's
apple-icon.png / favicon.ico)."""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

PALETTES = {
    "normal": dict(ringA="#39ff14", ringB="#2fd0ff", ringC="#2a6bff", theFill="#eaf6ff", wordFill="#39ff14", skyInner="#0d1a24"),
    "halloween": dict(ringA="#39ff14", ringB="#ff8a1f", ringC="#8b3dff", theFill="#ffb066", wordFill="#39ff14", skyInner="#1a1022"),
    "winter": dict(ringA="#ffffff", ringB="#8fdcff", ringC="#2f7bff", theFill="#ff5a66", wordFill="#e9f8ff", skyInner="#0c1a2e"),
}
STARS = [[96,140],[132,96],[188,70],[324,64],[392,92],[430,150],[456,236],[440,318],[404,388],[350,436],[276,456],[196,446],[128,404],[84,330],[66,250],[240,110],[300,404],[170,380],[380,200],[150,300],[360,330],[230,420]]
FLAKES = [[96,150,1.1],[150,88,0.8],[360,84,1],[420,140,0.7],[452,260,1.1],[418,380,0.8],[300,438,0.9],[200,440,0.7],[78,300,0.9],[250,124,0.6]]
LEG_PATHS = ["M-6 0 L-26 -14 L-38 4", "M-6 4 L-30 -2 L-40 18", "M-6 8 L-28 12 L-36 32", "M-6 12 L-22 24 L-26 42",
             "M6 0 L26 -14 L38 4", "M6 4 L30 -2 L40 18", "M6 8 L28 12 L36 32", "M6 12 L22 24 L26 42"]


def spider(x, y, s):
    legs = "".join(f'<path d="{d}"/>' for d in LEG_PATHS)
    return (
        f'<g transform="translate({x} {y}) scale({s})">'
        f'<g stroke="#ff7a1a" stroke-width="7" stroke-linecap="round" fill="none">{legs}</g>'
        f'<g stroke="#0f0c14" stroke-width="3.4" stroke-linecap="round" fill="none">{legs}</g>'
        '<ellipse cx="0" cy="12" rx="15" ry="19" fill="#0f0c14" stroke="#ff7a1a" stroke-width="3"/>'
        '<circle cx="0" cy="-10" r="10" fill="#0f0c14" stroke="#ff7a1a" stroke-width="2.6"/>'
        '<circle cx="-4" cy="-11" r="2.6" fill="#ff7a1a"/><circle cx="4" cy="-11" r="2.6" fill="#ff7a1a"/></g>'
    )


def emblem_svg(theme):
    p = PALETTES[theme]
    stars = "".join(
        f'<circle cx="{x}" cy="{y}" r="{2.6 if i % 5 == 0 else 1.5}" fill="{"#ffb347" if i % 4 == 0 else "#9fe6ff" if i % 3 == 0 else "#ffffff"}" opacity="{0.95 if i % 3 == 0 else 0.55}"/>'
        for i, (x, y) in enumerate(STARS)
    )
    extra = ""
    if theme == "winter":
        flakes = "".join(
            f'<g transform="translate({x} {y}) scale({s})" stroke="#e8f6ff" stroke-width="2.4" stroke-linecap="round" filter="url(#soft)">'
            '<line x1="0" y1="-9" x2="0" y2="9"/><line x1="-7.8" y1="-4.5" x2="7.8" y2="4.5"/><line x1="-7.8" y1="4.5" x2="7.8" y2="-4.5"/></g>'
            for x, y, s in FLAKES
        )
        extra = (
            '<path d="M100 249 q 10 -14 22 -4 q 8 -12 20 -3 q 10 -13 22 -2 q 9 -12 21 -2 q 10 -13 22 -3 q 9 -12 21 -2 q 10 -13 22 -3 q 9 -12 21 -2 q 10 -13 22 -3 q 9 -12 21 -2 q 10 -13 22 -3 q 9 -12 21 -2 q 10 -13 22 -3 q 8 -11 18 -2 l 0 7 l -314 0 z" fill="#f7fbff" filter="url(#soft)"/>'
            + flakes
            + '<g transform="translate(118 404) rotate(-24)">'
            '<path d="M0 0 C 14 -16, 36 -16, 46 0 C 36 8, 30 0, 23 10 C 16 0, 10 8, 0 0 Z" fill="#1f8a3a"/>'
            '<path d="M0 0 C -14 -16, -36 -16, -46 0 C -36 8, -30 0, -23 10 C -16 0, -10 8, 0 0 Z" fill="#26a046"/>'
            '<circle cx="-6" cy="-8" r="7" fill="#ff3b4a"/><circle cx="7" cy="-9" r="7" fill="#e5283a"/><circle cx="0" cy="3" r="7" fill="#ff5260"/></g>'
        )
    if theme == "halloween":
        extra = (
            '<g stroke="#ececf5" stroke-width="3.4" fill="none" stroke-linecap="round" opacity="0.95">'
            '<line x1="512" y1="0" x2="300" y2="30"/><line x1="512" y1="0" x2="340" y2="104"/><line x1="512" y1="0" x2="400" y2="160"/>'
            '<line x1="512" y1="0" x2="462" y2="196"/><line x1="512" y1="0" x2="508" y2="206"/>'
            '<path d="M444 10 Q 455 32 462 46 Q 474 60 482 86 Q 494 92 507 104"/>'
            '<path d="M386 18 Q 404 54 418 72 Q 434 98 446 126 Q 470 136 507 150"/>'
            '<path d="M330 26 Q 356 78 378 96 Q 400 132 424 158 Q 458 176 508 186"/></g>'
            '<line x1="78" y1="0" x2="78" y2="128" stroke="#ececf5" stroke-width="2.2"/>'
            '<line x1="444" y1="176" x2="444" y2="378" stroke="#ececf5" stroke-width="2.2"/>'
            + spider(78, 140, 1.05) + spider(444, 390, 0.95)
        )
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%" style="overflow:visible">
<defs>
<radialGradient id="sky" cx="50%" cy="45%" r="60%"><stop offset="0" stop-color="{p["skyInner"]}"/><stop offset="1" stop-color="#05070c"/></radialGradient>
<linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{p["ringA"]}"/><stop offset="0.55" stop-color="{p["ringB"]}"/><stop offset="1" stop-color="{p["ringC"]}"/></linearGradient>
<linearGradient id="swoosh" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="{p["ringB"]}" stop-opacity="0"/><stop offset="0.5" stop-color="{p["ringB"]}"/><stop offset="1" stop-color="{p["ringA"]}" stop-opacity="0"/></linearGradient>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<circle cx="256" cy="256" r="248" fill="url(#sky)"/>{stars}
<circle cx="256" cy="256" r="196" fill="none" stroke="url(#ring)" stroke-width="9" filter="url(#glow)"/>
<circle cx="256" cy="256" r="182" fill="none" stroke="url(#ring)" stroke-width="2" opacity="0.55"/>
<text x="168" y="218" font-family="Satisfy" font-size="82" fill="{p["theFill"]}" filter="url(#glow)" transform="rotate(-7 168 218)">The</text>
<text x="256" y="322" text-anchor="middle" font-family="Anton" font-size="104" letter-spacing="3" textLength="318" lengthAdjust="spacingAndGlyphs" fill="{p["wordFill"]}" filter="url(#glow)">WEEKEND</text>
<path d="M118 352 C 200 336, 312 336, 394 352" fill="none" stroke="url(#swoosh)" stroke-width="6" stroke-linecap="round" filter="url(#soft)"/>
{extra}
</svg>'''


def page(svg, size, bg, inner_pct):
    return f'''<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Anton&family=Satisfy&display=block" rel="stylesheet">
<style>html,body{{margin:0;background:{bg};}}#t{{width:{size}px;height:{size}px;display:flex;align-items:center;justify-content:center;overflow:hidden}}#e{{width:{inner_pct}%;height:{inner_pct}%}}</style>
</head><body><div id="t"><div id="e">{svg}</div></div></body></html>'''


def render(theme, size, bg, inner_pct, out):
    html = page(emblem_svg(theme), size, bg, inner_pct)
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False) as f:
        f.write(html)
        path = f.name
    args = [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--window-size={size},{size}",
            "--force-device-scale-factor=1", "--virtual-time-budget=6000", f"--screenshot={out}", f"file://{path}"]
    if bg == "transparent":
        args.insert(1, "--default-background-color=00000000")
    subprocess.run(args, check=True, capture_output=True)
    os.unlink(path)
    print("wrote", os.path.relpath(out, ROOT))


TILE = "#0d1016"
M = os.path.join(ROOT, "mobile/assets/images")
W = os.path.join(ROOT, "frontend/public/images")

for theme in ("normal", "halloween", "winter"):
    sfx = "" if theme == "normal" else f"-{theme}"
    # In-app emblem (transparent circle) — native and web.
    render(theme, 512, "transparent", 100, f"{M}/the-weekend-emblem{sfx}.png")
    render(theme, 512, "transparent", 100, f"{W}/the-weekend-emblem{sfx}.png")
    # iOS app icon: full-bleed square, no transparency (iOS rounds the corners).
    render(theme, 1024, TILE, 92, f"{M}/app-icon{sfx}.png")
    # Android adaptive foreground: the emblem inside the mask's safe zone.
    render(theme, 1024, "transparent", 62, f"{M}/android-icon-foreground{sfx}.png")
    # Web install icons.
    render(theme, 512, TILE, 92, f"{W}/icon-512{sfx}.png")
    render(theme, 192, TILE, 92, f"{W}/icon-192{sfx}.png")
    render(theme, 512, TILE, 72, f"{W}/icon-512-maskable{sfx}.png")
    render(theme, 192, TILE, 72, f"{W}/icon-192-maskable{sfx}.png")
    render(theme, 180, TILE, 92, f"{W}/apple-icon{sfx}.png")

# The web's default apple-touch-icon and favicon, and the native favicon/icon.
import shutil
shutil.copy(f"{W}/apple-icon.png", os.path.join(ROOT, "frontend/src/app/apple-icon.png"))
os.remove(f"{W}/apple-icon.png")
shutil.copy(f"{M}/app-icon.png", f"{M}/icon.png")
try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is needed for the favicons")
em = Image.open(f"{M}/the-weekend-emblem.png").convert("RGBA")
em.resize((48, 48), Image.LANCZOS).save(f"{M}/favicon.png")
em.save(os.path.join(ROOT, "frontend/src/app/favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
print("favicons done")
