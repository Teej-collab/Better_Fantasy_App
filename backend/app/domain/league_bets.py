"""
League Bets' numbers (app/routers/league_bets.py): records, units,
streaks, bad beats and the like, worked out from bets that are already
graded (app/routers/bets.py's _build). Pure functions, no database.

Units: every bet counts as one unit at its odds, whatever was really
wagered, so the board ranks picks, not bankrolls, and nobody's stake can
be worked out from it. A win pays the odds (+450 → +4.5u, −110 →
+0.91u), a loss is −1u, a push or void is 0.
"""
from collections import Counter

_SETTLED = {"won", "lost", "push", "void", "cashed_out"}
_OVER = {"over", "yes"}


def bet_odds(bet: dict) -> int | None:
    """The slip's odds, else the one leg's odds on a straight bet."""
    if bet.get("odds_american"):
        return bet["odds_american"]
    legs = bet.get("legs") or []
    if len(legs) == 1 and legs[0].get("odds_american"):
        return legs[0]["odds_american"]
    return None


def win_units(odds: int | None) -> float:
    if not odds:
        return 1.0
    return odds / 100 if odds > 0 else 100 / abs(odds)


def bet_units(bet: dict) -> float | None:
    """Units won or lost; None while it's open."""
    status = bet["status"]
    if status == "won":
        return round(win_units(bet_odds(bet)), 2)
    if status == "lost":
        return -1.0
    if status in ("push", "void", "cashed_out"):
        return 0.0
    return None


def is_settled(bet: dict) -> bool:
    return bet["status"] in _SETTLED


def one_leg_away(bet: dict) -> dict | None:
    """The last open leg of a parlay whose every other leg has hit."""
    legs = bet.get("legs") or []
    if bet["status"] != "open" or len(legs) < 2:
        return None
    open_legs = [l for l in legs if l["status"] == "open"]
    if len(open_legs) != 1:
        return None
    if any(l["status"] not in ("won", "push", "void") for l in legs if l is not open_legs[0]):
        return None
    return open_legs[0]


def needs_more(leg: dict) -> float | None:
    """How far an over/yes prop still has to go, if it's being tracked."""
    if leg.get("market") != "player_prop" or leg.get("direction") not in _OVER:
        return None
    if leg.get("current") is None or leg.get("target") is None:
        return None
    return max(0.0, round(leg["target"] - leg["current"], 1))


def bad_beat(bet: dict) -> dict | None:
    """A parlay lost on exactly one leg, every other leg a hit:
    {"leg", "missed_by"} (missed_by only for a prop with a number)."""
    legs = bet.get("legs") or []
    if bet["status"] != "lost" or len(legs) < 2:
        return None
    lost = [l for l in legs if l["status"] == "lost"]
    if len(lost) != 1 or any(l["status"] not in ("won", "push", "void") for l in legs if l is not lost[0]):
        return None
    leg = lost[0]
    missed_by = None
    if leg.get("market") == "player_prop" and leg.get("current") is not None and leg.get("target") is not None:
        missed_by = round(abs(leg["target"] - leg["current"]), 1)
    return {"leg": leg, "missed_by": missed_by}


def record(bets: list[dict]) -> dict:
    """W–L–P, hit rate, units and the current streak, oldest bet first in
    `bets` (only settled ones count)."""
    settled = [b for b in bets if is_settled(b)]
    wins = sum(1 for b in settled if b["status"] == "won")
    losses = sum(1 for b in settled if b["status"] == "lost")
    pushes = len(settled) - wins - losses
    units = round(sum(bet_units(b) or 0.0 for b in settled), 2)
    streak_kind, streak = None, 0
    for b in reversed(settled):
        kind = "W" if b["status"] == "won" else "L" if b["status"] == "lost" else None
        if kind is None:
            continue
        if streak_kind in (None, kind):
            streak_kind, streak = kind, streak + 1
        else:
            break
    decided = wins + losses
    return {
        "wins": wins,
        "losses": losses,
        "pushes": pushes,
        "hit_rate": round(wins / decided, 3) if decided else None,
        "units": units,
        "streak": f"{streak_kind}{streak}" if streak_kind else None,
        "open": sum(1 for b in bets if b["status"] == "open"),
    }


def form(bets: list[dict], count: int = 13) -> list[str]:
    """The last `count` bets' results, oldest first: won/lost/push/open."""
    out = []
    for b in bets[-count:]:
        s = b["status"]
        out.append("push" if s in ("void", "cashed_out") else s)
    return out


def style(bets: list[dict]) -> dict:
    """How someone bets: favorite player (and their record on him), go-to
    stat, parlay rate, share of overs."""
    legs = [l for b in bets for l in b.get("legs") or []]
    players = Counter(l["player_name"] for l in legs if l.get("player_name"))
    favorite = None
    if players:
        name, n = players.most_common(1)[0]
        on_him = [l for l in legs if l.get("player_name") == name]
        favorite = {
            "player_name": name,
            "legs": n,
            "wins": sum(1 for l in on_him if l["status"] == "won"),
            "losses": sum(1 for l in on_him if l["status"] == "lost"),
        }
    stats = Counter(l["stat_label"] for l in legs if l.get("stat_label"))
    go_to = None
    if stats:
        label, n = stats.most_common(1)[0]
        go_to = {"label": label, "share": round(n / len(legs), 3)}
    sided = [l for l in legs if l.get("direction")]
    parlays = [b for b in bets if len(b.get("legs") or []) > 1]
    return {
        "favorite_player": favorite,
        "go_to_stat": go_to,
        "parlay_rate": round(len(parlays) / len(bets), 3) if bets else None,
        "avg_parlay_legs": round(sum(len(b["legs"]) for b in parlays) / len(parlays), 1) if parlays else None,
        "overs_share": round(sum(1 for l in sided if l["direction"] in _OVER) / len(sided), 3) if sided else None,
    }


def tendencies(bets: list[dict]) -> dict:
    """The whole league's habits: overs vs unders (and how each did),
    and how often parlays hit."""
    legs = [l for b in bets for l in b.get("legs") or [] if l.get("direction")]
    overs = [l for l in legs if l["direction"] in _OVER]
    unders = [l for l in legs if l["direction"] not in _OVER]

    def wl(ls):
        return {"wins": sum(1 for l in ls if l["status"] == "won"), "losses": sum(1 for l in ls if l["status"] == "lost")}

    parlays = [b for b in bets if len(b.get("legs") or []) > 1 and b["status"] in ("won", "lost")]
    return {
        "overs_share": round(len(overs) / len(legs), 3) if legs else None,
        "overs": wl(overs),
        "unders": wl(unders),
        "parlay_hit_rate": round(sum(1 for b in parlays if b["status"] == "won") / len(parlays), 3) if parlays else None,
    }
