"""
"Week in 30 seconds" (2026-10-24): one league's week, from the real
results, as a 30-second vertical video ready for TikTok / Reels / Shorts.

    tools/week_video/.venv/bin/python tools/week_video/week_in_30.py --league 1 --week 6

Reads the database read-only (DATABASE_URL from backend/.env unless set),
draws each frame with Pillow and pipes them to ffmpeg. Team names only,
never owners' names. No music: add a trending sound in TikTok itself,
which also helps reach.

The beats, each cut every 3-4 seconds to hold attention:
  hook (the closest finish, giant) → the nail-biter (scores counting up)
  → the blowout → the week's high score → the bench crime → the power
  rankings → next week's marquee game → the plug for the app.
"""
import argparse
import asyncio
import math
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

import asyncpg
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "mobile/node_modules/@expo-google-fonts"
HEAD = str(FONTS / "anton/400Regular/Anton_400Regular.ttf")
BOLD = str(FONTS / "ibm-plex-sans/700Bold/IBMPlexSans_700Bold.ttf")
SEMI = str(FONTS / "ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf")
EMBLEM = ROOT / "mobile/assets/images/the-weekend-emblem.png"

W, H, FPS = 1080, 1920, 30
BG = (13, 16, 22)
SURFACE = (22, 27, 34)
TEXT = (236, 238, 241)
MUTED = (150, 158, 172)
NEON = (57, 255, 20)
BLUE = (56, 189, 248)
ORANGE = (249, 115, 22)
RED = (248, 113, 113)
YELLOW = (250, 204, 21)
SITE = os.environ.get("SITE_URL", "weekend-league-web.vercel.app")


# ---- Data -------------------------------------------------------------------


@dataclass
class Game:
    winner: str
    loser: str
    win_score: float
    lose_score: float

    @property
    def margin(self) -> float:
        return self.win_score - self.lose_score


@dataclass
class Week:
    league: str
    week: int
    games: list[Game]
    closest: Game
    blowout: Game
    high_team: str
    high_score: float
    bench: tuple[str, str, str, float] | None  # team, benched player, started player, points left
    power: list[str]
    next_game: tuple[str, str] | None


def _db_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        for line in (ROOT / "backend/.env").read_text().splitlines():
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip()
    return url.replace("postgresql+asyncpg", "postgresql")


async def load_week(league_id: int, season: int, week: int) -> Week:
    conn = await asyncpg.connect(
        _db_url(), server_settings={"default_transaction_read_only": "on"}, statement_cache_size=0
    )
    try:
        league = await conn.fetchval("SELECT name FROM leagues WHERE id = $1", league_id)
        rows = await conn.fetch(
            """
            SELECT ht.team_name AS home, at.team_name AS away, m.home_score, m.away_score
            FROM matchups m
            JOIN teams_by_season ht ON ht.id = m.home_team_id
            JOIN teams_by_season at ON at.id = m.away_team_id
            WHERE m.league_id = $1 AND m.season = $2 AND m.week = $3
            """,
            league_id, season, week,
        )
        games = []
        for r in rows:
            h, a = float(r["home_score"] or 0), float(r["away_score"] or 0)
            if h == 0 and a == 0:
                continue
            games.append(Game(r["home"], r["away"], h, a) if h >= a else Game(r["away"], r["home"], a, h))
        if not games:
            raise SystemExit(f"No finished games for week {week}.")
        bench = await conn.fetchrow(
            """
            SELECT t.team_name, b.bench_player, b.started_player, b.points_diff
            FROM bench_crimes b JOIN teams_by_season t ON t.id = b.team_id
            WHERE b.league_id = $1 AND b.season = $2 AND b.week = $3
            ORDER BY b.points_diff DESC LIMIT 1
            """,
            league_id, season, week,
        )
        power = [
            r["team_name"]
            for r in await conn.fetch(
                """
                SELECT t.team_name FROM weekly_team_stats w JOIN teams_by_season t ON t.id = w.team_id
                WHERE w.league_id = $1 AND w.season = $2 AND w.week = $3 AND w.power_rank IS NOT NULL
                ORDER BY w.power_rank LIMIT 3
                """,
                league_id, season, week,
            )
        ]
        # Next week's marquee game: the pairing with the best combined power rank.
        nxt = await conn.fetchrow(
            """
            SELECT ht.team_name AS home, at.team_name AS away
            FROM matchups m
            JOIN teams_by_season ht ON ht.id = m.home_team_id
            JOIN teams_by_season at ON at.id = m.away_team_id
            LEFT JOIN weekly_team_stats hw ON hw.team_id = m.home_team_id AND hw.week = $3 AND hw.season = $2
            LEFT JOIN weekly_team_stats aw ON aw.team_id = m.away_team_id AND aw.week = $3 AND aw.season = $2
            WHERE m.league_id = $1 AND m.season = $2 AND m.week = $3 + 1
            ORDER BY COALESCE(hw.power_rank, 99) + COALESCE(aw.power_rank, 99) LIMIT 1
            """,
            league_id, season, week,
        )
    finally:
        await conn.close()

    high = max(((g.winner, g.win_score) for g in games), key=lambda x: x[1])
    return Week(
        league=league or "Your league",
        week=week,
        games=games,
        closest=min(games, key=lambda g: g.margin),
        blowout=max(games, key=lambda g: g.margin),
        high_team=high[0],
        high_score=high[1],
        bench=(bench["team_name"], bench["bench_player"], bench["started_player"], float(bench["points_diff"])) if bench else None,
        power=power,
        next_game=(nxt["home"], nxt["away"]) if nxt else None,
    )


# ---- Drawing helpers ----------------------------------------------------------

_fonts: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    key = (path, size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(path, size)
    return _fonts[key]


def fit(draw: ImageDraw.ImageDraw, text: str, path: str, size: int, max_w: int) -> ImageFont.FreeTypeFont:
    """The biggest font up to `size` that fits `max_w`."""
    while size > 20 and draw.textlength(text, font=font(path, size)) > max_w:
        size -= 4
    return font(path, size)


def ease_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - (1 - t) ** 3


def ease_back(t: float) -> float:
    t = max(0.0, min(1.0, t))
    c = 1.7
    return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2


def mix(a: tuple, b: tuple, t: float) -> tuple:
    return tuple(int(x + (y - x) * t) for x, y in zip(a, b))


def centered(draw, y, text, fnt, fill, alpha=1.0, dy=0):
    w = draw.textlength(text, font=fnt)
    draw.text(((W - w) / 2, y + dy), text, font=fnt, fill=mix(BG, fill, alpha))


def background(t_total: float) -> Image.Image:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # A slow drifting glow, so the frame is never dead still.
    gx = int(W * (0.2 + 0.15 * math.sin(t_total * 0.6)))
    gy = int(H * (0.25 + 0.1 * math.cos(t_total * 0.4)))
    # Drawn at 1/8 size and scaled up: a full-size blur per frame is far too slow.
    s = 8
    glow = Image.new("RGB", (W // s, H // s), BG)
    gd = ImageDraw.Draw(glow)
    gd.ellipse(((gx - 520) / s, (gy - 520) / s, (gx + 520) / s, (gy + 520) / s), fill=(18, 42, 20))
    gd.ellipse(((W - gx - 420) / s, (H - gy - 420) / s, (W - gx + 420) / s, (H - gy + 420) / s), fill=(14, 30, 44))
    glow = glow.filter(ImageFilter.GaussianBlur(20)).resize((W, H), Image.BILINEAR)
    img = Image.blend(img, glow, 0.9)
    d = ImageDraw.Draw(img)
    # Subtle hex grid lines.
    for x in range(-60, W + 60, 120):
        d.line([(x, 0), (x + 240, H)], fill=(19, 23, 30), width=2)
    return img


def chrome(img: Image.Image, week: Week, t_total: float, total: float, kicker: str):
    d = ImageDraw.Draw(img)
    # Inside TikTok's safe area: its tabs cover the top ~180px, its caption
    # and buttons the bottom ~420px and the right edge.
    # Progress bar: people stay when they can see it's short.
    d.rounded_rectangle((60, 200, W - 160, 212), radius=6, fill=(38, 43, 51))
    d.rounded_rectangle((60, 200, 60 + int((W - 220) * min(1, t_total / total)), 212), radius=6, fill=NEON)
    brand = "THE WEEKEND"
    d.text((60, 232), brand, font=font(HEAD, 40), fill=NEON)
    bw = d.textlength(brand + "  ", font=font(HEAD, 40))
    d.text((60 + bw, 240), f"{week.league} · Week {week.week}", font=font(BOLD, 32), fill=MUTED)


def score_card(img, y, name, score, color, appear, count_t, winner):
    d = ImageDraw.Draw(img)
    slide = (1 - ease_out(appear)) * 200
    x0 = 60 + slide
    box = (x0, y, x0 + W - 120, y + 230)
    d.rounded_rectangle(box, radius=36, fill=SURFACE, outline=color if winner else (45, 50, 60), width=6 if winner else 3)
    nf = fit(d, name, BOLD, 64, W - 520)
    d.text((x0 + 44, y + 40), name, font=nf, fill=TEXT)
    d.text((x0 + 44, y + 130), "WINNER" if winner else "", font=font(BOLD, 34), fill=color)
    shown = score * ease_out(count_t)
    s = f"{shown:.2f}"
    sf = font(HEAD, 130)
    sw = d.textlength(s, font=sf)
    d.text((x0 + W - 120 - 44 - sw, y + 40), s, font=sf, fill=color if winner else MUTED)


# ---- Scenes ---------------------------------------------------------------------


def scene_hook(img, wk: Week, t):
    d = ImageDraw.Draw(img)
    centered(d, 520, "WEEK %d IN 30 SECONDS" % wk.week, font(BOLD, 52), MUTED, ease_out(t * 3))
    margin = f"{wk.closest.margin:.2f}"
    scale = ease_back(t * 2.2)
    size = max(20, int(250 * scale))
    centered(d, 700, "DECIDED BY", font(HEAD, 120), TEXT, ease_out(t * 3))
    big = font(HEAD, size)
    w = d.textlength(margin, font=big)
    d.text(((W - w) / 2, 860 + (250 - size) / 2), margin, font=big, fill=NEON)
    if t > 0.45:
        centered(d, 1180, "POINTS.", font(HEAD, 120), TEXT, ease_out((t - 0.45) * 4))


def scene_closest(img, wk: Week, t):
    g = wk.closest
    d = ImageDraw.Draw(img)
    centered(d, 330, "THE NAIL-BITER", font(HEAD, 110), TEXT, ease_out(t * 4))
    score_card(img, 560, g.winner, g.win_score, BLUE, t * 3, (t - 0.1) * 1.6, True)
    score_card(img, 840, g.loser, g.lose_score, ORANGE, (t - 0.08) * 3, (t - 0.1) * 1.6, False)
    if t > 0.65:
        centered(d, 1160, f"by {g.margin:.2f}. Brutal.", font(BOLD, 64), YELLOW, ease_out((t - 0.65) * 4))


def scene_blowout(img, wk: Week, t):
    g = wk.blowout
    d = ImageDraw.Draw(img)
    centered(d, 330, "MEANWHILE…", font(HEAD, 110), TEXT, ease_out(t * 4))
    score_card(img, 560, g.winner, g.win_score, BLUE, t * 3, (t - 0.05) * 1.8, True)
    score_card(img, 840, g.loser, g.lose_score, ORANGE, (t - 0.08) * 3, (t - 0.05) * 1.8, False)
    if t > 0.55:
        stamp = ease_back((t - 0.55) * 3)
        size = max(20, int(150 * stamp))
        f = font(HEAD, size)
        txt = f"-{g.margin:.1f}"
        w = d.textlength(txt, font=f)
        d.text(((W - w) / 2, 1160), txt, font=f, fill=RED)
        centered(d, 1360, "That one's going in the group chat.", font(SEMI, 46), MUTED, ease_out((t - 0.6) * 3))


def scene_high(img, wk: Week, t):
    d = ImageDraw.Draw(img)
    centered(d, 420, "HIGH SCORE OF THE WEEK", font(HEAD, 92), TEXT, ease_out(t * 4))
    f = fit(d, wk.high_team, BOLD, 80, W - 140)
    centered(d, 600, wk.high_team, f, BLUE, ease_out((t - 0.05) * 3))
    val = wk.high_score * ease_out((t - 0.1) * 1.4)
    centered(d, 760, f"{val:.2f}", font(HEAD, 300), NEON, ease_out((t - 0.1) * 3))
    if t > 0.6:
        centered(d, 1150, "points. in one week.", font(SEMI, 54), MUTED, ease_out((t - 0.6) * 3))


def scene_bench(img, wk: Week, t):
    d = ImageDraw.Draw(img)
    team, benched, started, diff = wk.bench
    flash = 1 if int(t * 8) % 2 == 0 and t < 0.35 else 0
    centered(d, 330, "BENCH CRIME", font(HEAD, 140), RED if flash else TEXT, ease_out(t * 4))
    f = fit(d, team, BOLD, 70, W - 140)
    centered(d, 540, team, f, TEXT, ease_out((t - 0.05) * 3))
    centered(d, 680, "benched", font(SEMI, 50), MUTED, ease_out((t - 0.12) * 3))
    centered(d, 750, benched, fit(d, benched, HEAD, 120, W - 140), YELLOW, ease_out((t - 0.18) * 3))
    centered(d, 920, f"for {started}", fit(d, f"for {started}", SEMI, 54, W - 140), MUTED, ease_out((t - 0.25) * 3))
    if t > 0.5:
        centered(d, 1060, f"{diff:.1f} points", font(HEAD, 170), RED, ease_out((t - 0.5) * 3))
        centered(d, 1310, "left on the bench", font(SEMI, 54), MUTED, ease_out((t - 0.55) * 3))


def scene_power(img, wk: Week, t):
    d = ImageDraw.Draw(img)
    centered(d, 330, "POWER RANKINGS", font(HEAD, 120), TEXT, ease_out(t * 4))
    colors = [NEON, BLUE, ORANGE]
    for i, team in enumerate(wk.power):
        a = ease_out((t - 0.12 - i * 0.12) * 3)
        if a <= 0:
            continue
        y = 560 + i * 250
        x0 = 60 + (1 - a) * 300
        d.rounded_rectangle((x0, y, x0 + W - 120, y + 200), radius=32, fill=SURFACE, outline=colors[i], width=4)
        d.text((x0 + 40, y + 30), f"#{i + 1}", font=font(HEAD, 130), fill=colors[i])
        d.text((x0 + 250, y + 62), team, font=fit(d, team, BOLD, 64, W - 120 - 290), fill=TEXT)


def scene_next(img, wk: Week, t):
    d = ImageDraw.Draw(img)
    home, away = wk.next_game
    centered(d, 420, f"WEEK {wk.week + 1}'S MUST-WATCH", font(HEAD, 100), TEXT, ease_out(t * 4))
    centered(d, 650, home, fit(d, home, HEAD, 120, W - 140), BLUE, ease_out((t - 0.08) * 3))
    pulse = 1 + 0.08 * math.sin(t * 20)
    centered(d, 830, "VS", font(HEAD, int(110 * pulse)), YELLOW, ease_out((t - 0.15) * 3))
    centered(d, 1000, away, fit(d, away, HEAD, 120, W - 140), ORANGE, ease_out((t - 0.22) * 3))
    if t > 0.55:
        centered(d, 1230, "the app already wrote the trash talk", font(SEMI, 46), MUTED, ease_out((t - 0.55) * 3))


_emblem: Image.Image | None = None


def scene_plug(img, wk: Week, t):
    global _emblem
    d = ImageDraw.Draw(img)
    if _emblem is None and EMBLEM.exists():
        _emblem = Image.open(EMBLEM).convert("RGBA").resize((420, 420))
    if _emblem is not None:
        a = ease_back(t * 2.5)
        size = max(10, int(420 * a))
        em = _emblem.resize((size, size))
        img.paste(em, ((W - size) // 2, 300 + (380 - size) // 2), em)
    centered(d, 720, "GET THIS FOR", font(HEAD, 120), TEXT, ease_out((t - 0.15) * 3))
    centered(d, 850, "YOUR LEAGUE", font(HEAD, 140), NEON, ease_out((t - 0.22) * 3))
    if t > 0.35:
        lines = ["Keep playing on ESPN or Sleeper.", "Recaps, write-ups and live scores", "for your group chat, every week."]
        for i, line in enumerate(lines):
            centered(d, 1050 + i * 66, line, font(SEMI, 48), TEXT, ease_out((t - 0.35 - i * 0.06) * 3))
    if t > 0.55:
        pill = f"{SITE}/waitlist"
        f = fit(d, pill, BOLD, 50, W - 260)
        w = d.textlength(pill, font=f)
        x = (W - w) / 2
        d.rounded_rectangle((x - 36, 1280, x + w + 36, 1380), radius=50, fill=NEON)
        d.text((x, 1300), pill, font=f, fill=BG)
        centered(d, 1410, "link in bio", font(SEMI, 40), MUTED, ease_out((t - 0.6) * 3))


# ---- Render -------------------------------------------------------------------------


def build_timeline(wk: Week):
    beats = [("", scene_hook, 3.0), ("", scene_closest, 4.2), ("", scene_blowout, 4.0), ("", scene_high, 3.6)]
    if wk.bench:
        beats.append(("", scene_bench, 4.2))
    if wk.power:
        beats.append(("", scene_power, 3.6))
    if wk.next_game:
        beats.append(("", scene_next, 3.4))
    beats.append(("", scene_plug, 4.5))
    return beats


def render(wk: Week, out: Path):
    beats = build_timeline(wk)
    total = sum(b[2] for b in beats)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS),
        "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
        "-movflags", "+faststart", str(out),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    elapsed = 0.0
    for _, scene, dur in beats:
        frames = int(dur * FPS)
        for i in range(frames):
            t = i / frames
            t_total = elapsed + i / FPS
            img = background(t_total)
            chrome(img, wk, t_total, total, "")
            scene(img, wk, t)
            # A quick white flash on every cut.
            if i < 3:
                img = Image.blend(img, Image.new("RGB", (W, H), (255, 255, 255)), 0.25 * (3 - i) / 3)
            proc.stdin.write(img.tobytes())
        elapsed += dur
    proc.stdin.close()
    proc.wait()
    return total


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--league", type=int, default=1)
    p.add_argument("--season", type=int, default=2026)
    p.add_argument("--week", type=int, required=True)
    p.add_argument("--out", type=Path, default=None)
    args = p.parse_args()
    wk = asyncio.run(load_week(args.league, args.season, args.week))
    out = args.out or Path(f"week-{args.week}-in-30.mp4")
    seconds = render(wk, out)
    print(f"Wrote {out} ({seconds:.1f}s)")


if __name__ == "__main__":
    main()
