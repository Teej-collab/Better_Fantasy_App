"""
"Fantasy Crime Report" (2026-10-24): the week as one story instead of a
stat reel, for TikTok / Reels / Shorts. A week's story is a small JSON
file (tools/week_video/stories/) — the scenes, the roast line for each
and the numbers — so each week is a new story file, not new code.

    tools/week_video/.venv/bin/python tools/week_video/crime_report.py \
        tools/week_video/stories/week6_crime_report.json --out ~/Downloads/week-6-crime-report

Writes two videos: `<out>.mp4` (sound effects, for your own voice or
TikTok's text-to-speech) and `<out>-voiced.mp4` (plus a demo voice from
this Mac's `say`). Captions are burned in word by word, because most
people watch with the sound off.

What holds attention: a siren cold open, a cut on every scene with a
punch-in zoom and a whoosh, stamps that slam down with a thud, scores
that roll like a slot machine, a shake on the blowout, a clip of the
app itself, and a cliffhanger that asks for comments.
"""
import argparse
import json
import math
import random
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

import week_in_30 as base
from week_in_30 import BG, BLUE, H, HEAD, BOLD, MUTED, NEON, ORANGE, RED, SEMI, SURFACE, TEXT, W, YELLOW, FPS
from week_in_30 import centered, ease_back, ease_out, fit, font

random.seed(7)
STAMP_AT = 0.55  # how far into a scene its stamp slams down


# ---- Pieces -----------------------------------------------------------------------


def stamp(img: Image.Image, text: str, t: float, color=RED, y: int = 1000, angle: float = -11):
    """Slams in from twice the size, rotated, like a rubber stamp."""
    if t < STAMP_AT:
        return
    k = ease_out((t - STAMP_AT) / 0.08)
    scale = 2.0 - k
    f = font(HEAD, 120)
    d0 = ImageDraw.Draw(img)
    tw = int(d0.textlength(text, font=f)) + 80
    layer = Image.new("RGBA", (tw, 190), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((6, 6, tw - 6, 184), radius=22, outline=color + (255,), width=12)
    d.text((40, 18), text, font=f, fill=color + (255,))
    layer = layer.rotate(angle, expand=True, resample=Image.BICUBIC)
    lw, lh = int(layer.width * scale), int(layer.height * scale)
    layer = layer.resize((max(1, lw), max(1, lh)), Image.BICUBIC)
    alpha = min(1.0, k * 1.5)
    if alpha < 1:
        layer.putalpha(layer.getchannel("A").point(lambda a: int(a * alpha)))
    img.paste(layer, ((W - lw) // 2, y - lh // 2), layer)


def roll(value: float, t: float, land: float = 0.5) -> str:
    """A slot-machine number: random digits, then it lands."""
    if t >= land:
        return f"{value:.2f}"
    return f"{random.uniform(10, 199):.2f}"


def captions(img: Image.Image, text: str, t: float, seconds: float):
    """Three words at a time, the one being said in yellow."""
    words = text.split()
    if not words:
        return
    speak = max(0.5, seconds - 0.35)
    idx = min(len(words) - 1, int((t * seconds) / speak * len(words)))
    start = (idx // 3) * 3
    chunk = words[start:start + 3]
    d = ImageDraw.Draw(img)
    f = fit(d, " ".join(chunk).upper(), HEAD, 92, W - 140)
    total = d.textlength(" ".join(chunk).upper(), font=f)
    x = (W - total) / 2
    for i, w in enumerate(chunk):
        word = w.upper() + (" " if i < len(chunk) - 1 else "")
        color = YELLOW if start + i == idx else (255, 255, 255)
        d.text((x, 1290), word, font=f, fill=color, stroke_width=8, stroke_fill=(0, 0, 0))
        x += d.textlength(word, font=f)


def card_row(img, y, name, score_text, color, winner):
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((60, y, W - 60, y + 210), radius=34, fill=SURFACE, outline=color if winner else (45, 50, 60), width=6)
    d.text((100, y + 40), name, font=fit(d, name, BOLD, 62, W - 520), fill=TEXT)
    sf = font(HEAD, 130)
    sw = d.textlength(score_text, font=sf)
    d.text((W - 100 - sw, y + 30), score_text, font=sf, fill=color if winner else MUTED)


# ---- Scenes -----------------------------------------------------------------------


def s_hook(img, sc, t):
    d = ImageDraw.Draw(img)
    # Police lights across the top for the cold open.
    on_red = int(t * sc["seconds"] * 4) % 2 == 0
    glow = Image.new("RGB", (W, 700), (200, 30, 40) if on_red else (30, 80, 220))
    img.paste(Image.blend(img.crop((0, 0, W, 700)), glow, 0.28), (0, 0))
    centered(d, 420, sc["kicker"], fit(d, sc["kicker"], HEAD, 120, W - 120), TEXT, ease_out(t * 5))
    size = max(20, int(300 * ease_back(t * 3)))
    big = font(HEAD, size)
    w = d.textlength(sc["headline"], font=big)
    d.text(((W - w) / 2, 600 + (300 - size) / 2), sc["headline"], font=big, fill=NEON)


def s_mugshot(img, sc, t):
    d = ImageDraw.Draw(img)
    # A mugshot board: height lines and the name plate.
    d.rounded_rectangle((90, 300, W - 90, 1120), radius=30, fill=(18, 21, 27), outline=(60, 66, 76), width=4)
    for i, y in enumerate(range(360, 1100, 90)):
        d.line([(110, y), (190, y)], fill=(70, 76, 88), width=3)
        d.text((200, y - 18), f"{7 - i // 2}'{(i % 2) * 6}\"", font=font(SEMI, 26), fill=(90, 96, 108))
    d.rectangle((140, 420, W - 140, 560), fill=(236, 238, 241))
    d.text((170, 440), sc["suspect"], font=fit(d, sc["suspect"], HEAD, 96, W - 340), fill=BG)
    d.text((300, 600), "CHARGED WITH", font=font(BOLD, 34), fill=RED)
    for i, charge in enumerate(sc["charges"]):
        a = ease_out((t - 0.1 - i * 0.12) * 5)
        if a > 0:
            d.text((300, 660 + i * 100), "• " + charge, font=fit(d, "• " + charge, BOLD, 52, W - 420), fill=TEXT)
    stamp(img, sc["stamp"], t, RED, y=1010)


def s_scoreline(img, sc, t):
    d = ImageDraw.Draw(img)
    centered(d, 300, sc["kicker"], font(HEAD, 120), YELLOW, ease_out(t * 5))
    land = 0.45
    card_row(img, 520, sc["left"], roll(sc["left_score"], t, land), BLUE, True)
    card_row(img, 770, sc["right"], roll(sc["right_score"], t, land), ORANGE, False)
    if t > land:
        margin = sc["left_score"] - sc["right_score"]
        centered(d, 975, f"by {margin:.2f}", font(HEAD, 90), TEXT, ease_out((t - land) * 5))
    stamp(img, sc["stamp"], t, RED, y=1200, angle=9)


def s_verdict(img, sc, t):
    d = ImageDraw.Draw(img)
    centered(d, 300, sc["kicker"], font(HEAD, 120), RED, ease_out(t * 5))
    centered(d, 470, sc["who"], fit(d, sc["who"], HEAD, 120, W - 140), TEXT, ease_out((t - 0.05) * 4))
    centered(d, 630, sc["line"], fit(d, sc["line"], BOLD, 64, W - 140), MUTED, ease_out((t - 0.12) * 4))
    if t > 0.2:
        size = max(20, int(230 * ease_back((t - 0.2) * 4)))
        f = font(HEAD, size)
        w = d.textlength(sc["big"], font=f)
        d.text(((W - w) / 2, 690 + (230 - size) / 2), sc["big"], font=f, fill=YELLOW)
        centered(d, 1000, sc["big_label"], font(SEMI, 48), MUTED, ease_out((t - 0.3) * 4))
    stamp(img, sc["stamp"], t, RED, y=1185, angle=-8)


def s_phone(img, sc, t):
    d = ImageDraw.Draw(img)
    # The app itself: the recap card, scrolling, with the best line lit up.
    px, py, pw, ph = 190, 290, W - 380, 960
    d.rounded_rectangle((px - 14, py - 14, px + pw + 14, py + ph + 14), radius=70, fill=(40, 44, 52))
    d.rounded_rectangle((px, py, px + pw, py + ph), radius=58, fill=(13, 16, 22))
    d.text((px + 50, py + 60), sc["kicker"], font=font(BOLD, 26), fill=NEON)
    f = font(SEMI, 36)
    words = sc["text"].split()
    hl = sc.get("highlight", "").split()
    lit = set()
    for i in range(len(words) - len(hl) + 1):
        if hl and [w.strip(".,") for w in words[i:i + len(hl)]] == [w.strip(".,") for w in hl]:
            lit = set(range(i, i + len(hl)))
            break
    # Lay the words out in lines, each remembering whether it's in the quoted line.
    lines, line, width = [], [], 0.0
    space = d.textlength(" ", font=f)
    for i, w in enumerate(words):
        wl = d.textlength(w, font=f)
        if line and width + space + wl > pw - 100:
            lines.append(line)
            line, width = [], 0.0
        line.append((w, i in lit))
        width += (space if width else 0) + wl
    lines.append(line)
    scroll = int(ease_out(t * 1.2) * max(0, len(lines) * 52 - 700))
    region = Image.new("RGB", (pw - 60, ph - 170), (13, 16, 22))
    rd = ImageDraw.Draw(region)
    for n, ln in enumerate(lines):
        y = 10 + n * 52 - scroll
        x = 20.0
        for w, is_lit in ln:
            rd.text((x, y), w, font=f, fill=YELLOW if is_lit and t > 0.35 else (220, 224, 230))
            x += rd.textlength(w + " ", font=f)
    img.paste(region, (px + 30, py + 120))


def s_cliffhanger(img, sc, t):
    d = ImageDraw.Draw(img)
    centered(d, 300, sc["kicker"], font(HEAD, 110), YELLOW, ease_out(t * 5))
    centered(d, 470, sc["left"], fit(d, sc["left"], HEAD, 120, W - 140), BLUE, ease_out((t - 0.05) * 4))
    pulse = 1 + 0.12 * math.sin(t * sc["seconds"] * 10)
    centered(d, 640, "VS", font(HEAD, int(120 * pulse)), TEXT, ease_out((t - 0.1) * 4))
    centered(d, 810, sc["right"], fit(d, sc["right"], HEAD, 120, W - 140), ORANGE, ease_out((t - 0.15) * 4))
    if t > 0.45:
        centered(d, 1010, sc["ask"], fit(d, sc["ask"], BOLD, 64, W - 140), NEON, ease_out((t - 0.45) * 4))


def s_plug(img, sc, t, site):
    d = ImageDraw.Draw(img)
    if base.EMBLEM.exists():
        em = Image.open(base.EMBLEM).convert("RGBA")
        size = max(10, int(360 * ease_back(t * 3)))
        em = em.resize((size, size))
        img.paste(em, ((W - size) // 2, 300 + (360 - size) // 2), em)
    centered(d, 720, sc["line1"], font(HEAD, 120), TEXT, ease_out((t - 0.1) * 4))
    centered(d, 850, sc["line2"], font(HEAD, 150), NEON, ease_out((t - 0.18) * 4))
    if t > 0.35:
        f = fit(d, site, BOLD, 48, W - 260)
        w = d.textlength(site, font=f)
        x = (W - w) / 2
        d.rounded_rectangle((x - 34, 1050, x + w + 34, 1146), radius=48, fill=NEON)
        d.text((x, 1068), site, font=f, fill=BG)
        centered(d, 1180, sc["sub"], font(SEMI, 44), MUTED, ease_out((t - 0.45) * 4))


SCENES = {"hook": s_hook, "mugshot": s_mugshot, "scoreline": s_scoreline, "verdict": s_verdict,
          "phone": s_phone, "cliffhanger": s_cliffhanger}


# ---- Sound ----------------------------------------------------------------------------


SFX = {
    "siren": ("aevalsrc=0.25*sin(2*PI*(650+250*sin(2*PI*2.2*t))*t):d=2.6", 2.6),
    "whoosh": ("anoisesrc=d=0.35:c=pink:a=0.5,highpass=f=900,afade=t=in:d=0.12,afade=t=out:st=0.15:d=0.2", 0.35),
    "thud": ("aevalsrc=0.95*sin(2*PI*70*t)*exp(-9*t)+0.4*sin(2*PI*140*t)*exp(-20*t):d=0.6", 0.6),
    "tick": ("aevalsrc=0.3*sin(2*PI*1500*t)*exp(-60*t):d=0.06", 0.06),
    "horn": ("aevalsrc=0.18*(sin(2*PI*233*t)+sin(2*PI*294*t)+sin(2*PI*349*t)):d=0.9,afade=t=out:st=0.6:d=0.3", 0.9),
}


def build_audio(story: dict, tmp: Path, voiced: bool) -> Path:
    """Sound effects on the cuts, stamps and rolls; optionally the demo voice."""
    for name, (expr, _) in SFX.items():
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", expr, str(tmp / f"{name}.wav")], check=True)
    events = [("siren", 0.0)]
    start = 0.0
    for i, sc in enumerate(story["scenes"]):
        if i:
            events.append(("whoosh", start))
        if sc.get("stamp"):
            events.append(("thud", start + sc["seconds"] * STAMP_AT))
        if sc["type"] == "scoreline":
            events += [("tick", start + k * 0.08) for k in range(int(sc["seconds"] * 0.45 / 0.08))]
        if sc.get("shake") or sc["type"] == "plug":
            events.append(("horn", start + (sc["seconds"] * STAMP_AT if sc.get("shake") else 0.1)))
        start += sc["seconds"]
    inputs, filters = [], []
    for n, (name, at) in enumerate(events):
        inputs += ["-i", str(tmp / f"{name}.wav")]
        ms = int(at * 1000)
        filters.append(f"[{n}:a]adelay={ms}|{ms}[e{n}]")
    labels = [f"[e{n}]" for n in range(len(events))]
    if voiced:
        start = 0.0
        for k, sc in enumerate(story["scenes"]):
            wav = tmp / f"say{k}.aiff"
            subprocess.run(["say", "-v", "Reed (English (US))", "-r", "215", "-o", str(wav), sc["say"]], check=True)
            length = float(subprocess.check_output(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(wav)]).strip())
            tempo = max(1.0, min(1.5, length / max(0.5, sc["seconds"] - 0.3)))
            idx = len(events) + k
            inputs += ["-i", str(wav)]
            ms = int((start + 0.12) * 1000)
            filters.append(f"[{idx}:a]atempo={tempo:.3f},adelay={ms}|{ms},volume=2.2[v{k}]")
            labels.append(f"[v{k}]")
            start += sc["seconds"]
    out = tmp / ("mix-voiced.m4a" if voiced else "mix.m4a")
    graph = ";".join(filters) + ";" + "".join(labels) + f"amix=inputs={len(labels)}:normalize=0,alimiter=limit=0.95,apad[a]"
    subprocess.run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", graph, "-map", "[a]", "-t", str(sum(sc["seconds"] for sc in story["scenes"])), "-c:a", "aac", "-b:a", "160k", str(out)], check=True)
    return out


# ---- Render -------------------------------------------------------------------------------


def render(story: dict, silent_video: Path):
    total = sum(sc["seconds"] for sc in story["scenes"])
    wk = type("Wk", (), {"league": story["league"], "week": story["week"]})()
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
           "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", str(silent_video)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    elapsed = 0.0
    for sc in story["scenes"]:
        frames = int(sc["seconds"] * FPS)
        for i in range(frames):
            t = i / frames
            secs = i / FPS
            img = base.background(elapsed + secs)
            base.chrome(img, wk, elapsed + secs, total, "")
            if sc["type"] == "plug":
                s_plug(img, sc, t, story["site"])
            else:
                SCENES[sc["type"]](img, sc, t)
            captions(img, sc["say"], t, sc["seconds"])
            # Punch-in on every cut, and a shake when a stamp lands (or all through a blowout).
            zoom = 1 + 0.09 * max(0.0, 1 - secs * 5)
            shake = 0
            stamp_secs = secs - sc["seconds"] * STAMP_AT
            if sc.get("stamp") and 0 <= stamp_secs < 0.25:
                shake = 18 * (1 - stamp_secs / 0.25)
            if sc.get("shake") and secs < sc["seconds"]:
                shake = max(shake, 10)
            if zoom > 1.001 or shake:
                cw, ch = int(W / zoom), int(H / zoom)
                dx = random.randint(-int(shake), int(shake)) if shake else 0
                dy = random.randint(-int(shake), int(shake)) if shake else 0
                x0 = max(0, min(W - cw, (W - cw) // 2 + dx))
                y0 = max(0, min(H - ch, (H - ch) // 2 + dy))
                img = img.crop((x0, y0, x0 + cw, y0 + ch)).resize((W, H), Image.BILINEAR)
            if i < 2:
                img = Image.blend(img, Image.new("RGB", (W, H), (255, 255, 255)), 0.35 * (2 - i) / 2)
            proc.stdin.write(img.tobytes())
        elapsed += sc["seconds"]
    proc.stdin.close()
    proc.wait()
    return total


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("story", type=Path)
    p.add_argument("--out", type=Path, required=True, help="Output path without .mp4")
    args = p.parse_args()
    story = json.loads(args.story.read_text())
    out = args.out.expanduser()
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        silent = tmp / "silent.mp4"
        seconds = render(story, silent)
        for voiced, path in ((False, out.with_suffix(".mp4")), (True, out.parent / f"{out.name}-voiced.mp4")):
            audio = build_audio(story, tmp, voiced)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(silent), "-i", str(audio), "-map", "0:v", "-map", "1:a",
                            "-c:v", "copy", "-c:a", "copy", "-shortest", str(path)], check=True)
            print(f"Wrote {path} ({seconds:.1f}s)")


if __name__ == "__main__":
    main()
