"""
League Bets: every bet shared in your league, who placed it, and how
it's doing.

- GET /bets/league: the feed. The league's shared bets this season,
  newest first, each with who placed it, its tails and reactions, and
  whether it's one leg away or a bad beat. Also The Sweat (this week's
  live summary) and the league consensus.
- GET /bets/league/board: Sharps & Squares. Records, units, streaks,
  trophies and the league's tendencies, for the season or this week.
- GET /bets/league/games, /games/{event_id}: this week's games with
  league money on them, and every leg riding on one game.
- GET /bets/league/members/{user_id}: one person's betting card.
- POST /bets/league/bets/{id}/tail: saves a copy of the picks as your
  own bet. PUT/DELETE .../reactions/{fade|sweat|rip}, and PUT/DELETE
  /members/{id}/follow (a push when they share a bet).

Only shared bets are ever shown, only to members of the bet's league,
and never with the wager or payout. Units count every bet as one unit
at its odds (app/domain/league_bets.py).
"""
import datetime
import logging
from collections import Counter, defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.auth.league_context import _decode_session_or_401, resolve_owner_id
from app.config import _require
from app.db import get_pool
from app.domain import league_bets as ld
from app.queries import bets as bet_queries
from app.queries import league_bets as lq
from app.queries import leagues as league_queries
from app.routers.bets import _build, _enabled, _public

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bets/league", tags=["league-bets"])

_FEED_LIMIT = 60
_REACTIONS = {"fade", "sweat", "rip"}


# ---- Who's asking, and the league's bets ----

def _season() -> int:
    return int(_require("ACTIVE_SEASON"))


def _season_start(season: int) -> datetime.datetime:
    return datetime.datetime(season, 8, 1, tzinfo=datetime.timezone.utc)


def week_start(now: datetime.datetime | None = None) -> datetime.datetime:
    """This NFL week: since the most recent Tuesday, 4 AM Eastern (8 AM
    UTC is close enough all season)."""
    now = now or datetime.datetime.now(datetime.timezone.utc)
    start = (now - datetime.timedelta(days=(now.weekday() - 1) % 7)).replace(hour=8, minute=0, second=0, microsecond=0)
    return start if start <= now else start - datetime.timedelta(days=7)


async def _league(conn, payload: dict) -> int:
    league_id = await league_queries.get_active_league_id(conn, payload["user_id"])
    if not league_id or not await league_queries.get_membership(conn, league_id, payload["user_id"]):
        raise HTTPException(status_code=409, detail="Join a league to see its bets")
    return league_id


async def _load(conn, league_id: int, since: datetime.datetime) -> list[dict]:
    """The league's shared bets since `since`, graded, oldest first, each
    with its bettor's user_id and when it was placed (internal fields
    starting with _ never leave this module)."""
    rows = await lq.shared_bets(conn, league_id, since)
    built = await _build(conn, rows, persist=True)
    for row, bet in zip(rows, built):
        bet["_user_id"] = row["user_id"]
        bet["_created"] = row["created_at"]
    return built


def _strip(bet: dict) -> dict:
    return {k: v for k, v in _public(bet).items() if not k.startswith("_")}


def _member(members: dict, user_id: int) -> dict:
    m = members.get(user_id) or {"user_id": user_id, "name": "Someone", "team_name": None, "logo_url": None, "color": None}
    return {k: m.get(k) for k in ("user_id", "name", "team_name", "logo_url", "color")}


async def _decorate(conn, bets: list[dict], members: dict, viewer: int, week_from: datetime.datetime) -> list[dict]:
    """Feed cards: the public bet plus who placed it, tails, reactions,
    one-leg-away and bad-beat details."""
    ids = [b["id"] for b in bets]
    tails = defaultdict(list)
    for t in await lq.tails_for(conn, ids):
        tails[t["bet_id"]].append(t["user_id"])
    reactions = defaultdict(lambda: defaultdict(list))
    for r in await lq.reactions_for(conn, ids):
        reactions[r["bet_id"]][r["kind"]].append(r["user_id"])
    by_user = defaultdict(list)
    for b in bets:
        by_user[b["_user_id"]].append(b)
    records = {u: ld.record(bs) for u, bs in by_user.items()}

    out = []
    for b in bets:
        away = ld.one_leg_away(b)
        beat = ld.bad_beat(b)
        rec = records[b["_user_id"]]
        out.append(
            _strip(b)
            | {
                "member": _member(members, b["_user_id"]),
                "mine": b["_user_id"] == viewer,
                "this_week": b["_created"] >= week_from,
                "member_record": f"{rec['wins']}–{rec['losses']}",
                "units": ld.bet_units(b),
                "one_leg_away": {"leg_id": away["id"], "needs_more": ld.needs_more(away)} if away else None,
                "bad_beat": {"leg_id": beat["leg"]["id"], "missed_by": beat["missed_by"]} if beat else None,
                "tails": {
                    "count": len(tails[b["id"]]),
                    "names": [_member(members, u)["name"] for u in tails[b["id"]][:3]],
                    "mine": viewer in tails[b["id"]],
                },
                "reactions": {
                    kind: {"count": len(reactions[b["id"]][kind]), "mine": viewer in reactions[b["id"]][kind]}
                    for kind in sorted(_REACTIONS)
                },
            }
        )
    return out


def _pick(leg: dict) -> dict:
    return {k: leg.get(k) for k in ("player_name", "market", "stat_key", "stat_label", "line", "direction", "team_abbr", "description")}


# ---- The feed ----

@router.get("")
async def league_feed(request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        owner_id = await resolve_owner_id(conn, payload)
        if not await _enabled(conn, owner_id):
            return {"enabled": False}
        league_id = await _league(conn, payload)
        season = _season()
        bets = await _load(conn, league_id, _season_start(season))
        members = await lq.members(conn, league_id, season)
        week_from = week_start()
        week = [b for b in bets if b["_created"] >= week_from]

        # The Sweat: this week's bets still alive.
        alive = [b for b in week if b["status"] == "open"]
        close = [(b, ld.one_leg_away(b)) for b in alive]
        close = [(b, leg) for b, leg in close if leg]
        closest = None
        if close:
            b, leg = max(close, key=lambda c: (ld.needs_more(c[1]) is not None, ld.bet_odds(c[0]) or 0))
            closest = {
                "bet_id": b["id"],
                "member": _member(members, b["_user_id"]),
                "odds_american": ld.bet_odds(b),
                "legs": len(b["legs"]),
                "leg": _pick(leg) | {"current": leg.get("current"), "target": leg.get("target"), "game": leg.get("game")},
                "needs_more": ld.needs_more(leg),
            }

        # League consensus: the player the most people are on this week.
        backers = defaultdict(set)
        picks = defaultdict(Counter)
        for b in week:
            for leg in b["legs"]:
                if leg.get("player_name"):
                    backers[leg["player_name"]].add(b["_user_id"])
                    picks[leg["player_name"]][(leg.get("direction"), leg.get("line"), leg.get("stat_label") or leg.get("description"))] += 1
        consensus = None
        if backers:
            name, users = max(backers.items(), key=lambda kv: len(kv[1]))
            if len(users) >= 2:
                consensus = {
                    "player_name": name,
                    "count": len(users),
                    "of": len(members),
                    "members": [_member(members, u) for u in list(users)[:4]],
                    "top_picks": [
                        {"direction": d, "line": line, "stat_label": label, "count": n}
                        for (d, line, label), n in picks[name].most_common(2)
                    ],
                }

        feed = list(reversed(bets))[:_FEED_LIMIT]
        return {
            "enabled": True,
            "week_start": week_from.isoformat(),
            "sweat": {
                "alive": len(alive),
                "one_leg_away": len(close),
                "riding_units": round(sum(ld.win_units(ld.bet_odds(b)) for b in alive), 1),
                "closest": closest,
            },
            "consensus": consensus,
            "bets": await _decorate(conn, feed, members, payload["user_id"], week_from),
        }


# ---- The Board ----

@router.get("/board")
async def league_board(request: Request, period: str = Query("season", alias="range"), parlays: bool = False, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        league_id = await _league(conn, payload)
        season = _season()
        since = week_start() if period == "week" else _season_start(season)
        bets = await _load(conn, league_id, since)
        if parlays:
            bets = [b for b in bets if len(b["legs"]) > 1]
        members = await lq.members(conn, league_id, season)
        by_user = defaultdict(list)
        for b in bets:
            by_user[b["_user_id"]].append(b)

        ids = [b["id"] for b in bets]
        tail_rows = await lq.tails_for(conn, ids)
        reaction_rows = await lq.reactions_for(conn, ids)
        owner_of = {b["id"]: b["_user_id"] for b in bets}
        status_of = {b["id"]: b["status"] for b in bets}

        rows = []
        for user_id, user_bets in by_user.items():
            rec = ld.record(user_bets)
            rows.append(
                _member(members, user_id)
                | rec
                | {"me": user_id == payload["user_id"], "bets": len(user_bets), "bad_beats": sum(1 for b in user_bets if ld.bad_beat(b))}
            )
        rows.sort(key=lambda r: (-r["units"], -r["wins"], r["losses"]))
        for i, r in enumerate(rows):
            r["rank"] = i + 1

        # Trophies.
        won = [b for b in bets if b["status"] == "won" and ld.bet_odds(b)]
        longest = max(won, key=lambda b: ld.bet_odds(b), default=None)
        beats = Counter(b["_user_id"] for b in bets if ld.bad_beat(b))
        tailed = Counter(owner_of[t["bet_id"]] for t in tail_rows)
        fades = defaultdict(lambda: [0, 0])
        for r in reaction_rows:
            if r["kind"] == "fade" and status_of[r["bet_id"]] in ("won", "lost"):
                fades[r["user_id"]][0 if status_of[r["bet_id"]] == "lost" else 1] += 1
        best_fade = max(fades.items(), key=lambda kv: (kv[1][0] - kv[1][1], kv[1][0]), default=None)

        def top(counter):
            if not counter:
                return None
            user_id, n = counter.most_common(1)[0]
            return {"member": _member(members, user_id), "count": n}

        return {
            "range": "week" if period == "week" else "season",
            "season": season,
            "rows": rows,
            "trophies": {
                "longest_shot": (
                    {"member": _member(members, longest["_user_id"]), "odds_american": ld.bet_odds(longest), "legs": len(longest["legs"]), "bet_id": longest["id"]}
                    if longest
                    else None
                ),
                "bad_beat_king": top(beats),
                "most_tailed": top(tailed),
                "best_fade": (
                    {"member": _member(members, best_fade[0]), "wins": best_fade[1][0], "losses": best_fade[1][1]}
                    if best_fade and best_fade[1][0] > 0
                    else None
                ),
            },
            "tendencies": ld.tendencies(bets),
        }


# ---- By game ----

def _game_key_state(game: dict | None) -> int:
    return {"in": 0, "pre": 1, "post": 2}.get((game or {}).get("state"), 3)


@router.get("/games")
async def league_games(request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        league_id = await _league(conn, payload)
        members = await lq.members(conn, league_id, _season())
        bets = await _load(conn, league_id, week_start())
        games: dict[str, dict] = {}
        for b in bets:
            for leg in b["legs"]:
                event = leg.get("espn_event_id")
                if not event:
                    continue
                g = games.setdefault(event, {"event_id": event, "game": None, "legs": 0, "users": set(), "alive": 0})
                g["game"] = g["game"] or leg.get("game")
                g["legs"] += 1
                g["users"].add(b["_user_id"])
                g["alive"] += leg["status"] == "open"
        out = [
            {k: v for k, v in g.items() if k != "users"} | {"members": [_member(members, u) for u in list(g["users"])[:5]], "member_count": len(g["users"])}
            for g in games.values()
        ]
        out.sort(key=lambda g: (_game_key_state(g["game"]), -g["legs"]))
        return {"games": out}


@router.get("/games/{event_id}")
async def league_game(event_id: str, request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    async with pool.acquire() as conn:
        league_id = await _league(conn, payload)
        members = await lq.members(conn, league_id, _season())
        bets = await _load(conn, league_id, week_start())
        props: dict[tuple, dict] = {}
        lines: dict[tuple, dict] = {}
        rooting = Counter()
        game = None
        users = set()
        leg_count = 0
        for b in bets:
            for leg in b["legs"]:
                if leg.get("espn_event_id") != event_id:
                    continue
                leg_count += 1
                users.add(b["_user_id"])
                game = game or leg.get("game")
                entry = {
                    "member": _member(members, b["_user_id"]),
                    "bet_id": b["id"],
                    "line": leg.get("line"),
                    "direction": leg.get("direction"),
                    "status": leg["status"],
                    "parlay_legs": len(b["legs"]),
                }
                if leg["market"] == "player_prop" and leg.get("player_name"):
                    key = (leg["player_name"], leg.get("stat_key"))
                    p = props.setdefault(
                        key,
                        {
                            "player_name": leg["player_name"],
                            "sleeper_player_id": leg.get("sleeper_player_id"),
                            "team_abbr": leg.get("team_abbr"),
                            "stat_key": leg.get("stat_key"),
                            "stat_label": leg.get("stat_label"),
                            "current": None,
                            "entries": [],
                        },
                    )
                    if leg.get("current") is not None:
                        p["current"] = max(p["current"] or 0, leg["current"])
                    p["entries"].append(entry)
                    if leg.get("direction") in ("over", "yes") and leg.get("team_abbr"):
                        rooting[leg["team_abbr"]] += 1
                else:
                    key = (leg["market"], leg.get("team_abbr"), leg.get("line"), leg.get("direction"))
                    lines.setdefault(key, _pick(leg) | {"status": leg["status"], "entries": []})["entries"].append(entry)
                    if leg["market"] in ("spread", "moneyline") and leg.get("team_abbr"):
                        rooting[leg["team_abbr"]] += 1
        if not leg_count:
            raise HTTPException(status_code=404, detail="No league bets on this game")
        for p in props.values():
            p["entries"].sort(key=lambda e: (e["line"] is None, e["line"] or 0))
        total = sum(rooting.values())
        return {
            "event_id": event_id,
            "game": game,
            "legs": leg_count,
            "member_count": len(users),
            "props": sorted(props.values(), key=lambda p: -len(p["entries"])),
            "lines": list(lines.values()),
            "rooting": [{"team": t, "share": round(n / total, 3)} for t, n in rooting.most_common()] if total else [],
        }


# ---- A member's betting card ----

@router.get("/members/{user_id}")
async def league_member(user_id: int, request: Request, pool=Depends(get_pool)):
    payload = _decode_session_or_401(request)
    viewer = payload["user_id"]
    async with pool.acquire() as conn:
        league_id = await _league(conn, payload)
        season = _season()
        members = await lq.members(conn, league_id, season)
        if user_id not in members:
            raise HTTPException(status_code=404, detail="They're not in your league")
        bets = await _load(conn, league_id, _season_start(season))
        by_user = defaultdict(list)
        for b in bets:
            by_user[b["_user_id"]].append(b)
        theirs = by_user.get(user_id, [])
        board = sorted(by_user, key=lambda u: -ld.record(by_user[u])["units"])
        won = [b for b in theirs if b["status"] == "won" and ld.bet_odds(b)]
        best = max(won, key=lambda b: ld.bet_odds(b), default=None)
        tails = await lq.tails_for(conn, [best["id"]]) if best else []

        vs = None
        if user_id != viewer:
            mine = by_user.get(viewer, [])
            their_players = {l["player_name"] for b in theirs for l in b["legs"] if l.get("player_name")}
            shared_players = {l["player_name"] for b in mine for l in b["legs"] if l.get("player_name")} & their_players
            vs = {
                "you": ld.record(mine),
                "them": ld.record(theirs),
                "shared_players": sorted(shared_players)[:5],
            }

        recent = list(reversed(theirs))[:10]
        return {
            "member": _member(members, user_id),
            "me": user_id == viewer,
            "rank": board.index(user_id) + 1 if user_id in board else None,
            "of": len(board),
            "record": ld.record(theirs),
            "form": ld.form(theirs),
            "style": ld.style(theirs),
            "biggest_hit": (
                {"bet_id": best["id"], "odds_american": ld.bet_odds(best), "legs": [_pick(l) for l in best["legs"]], "tails": len(tails), "created_at": best["created_at"]}
                if best
                else None
            ),
            "vs": vs,
            "following": await lq.is_following(conn, viewer, user_id) if user_id != viewer else False,
            "bets": await _decorate(conn, recent, members, viewer, week_start()),
        }


# ---- Tail, react, follow ----

async def _league_bet(conn, payload: dict, bet_id: int):
    league_id = await _league(conn, payload)
    bet = await bet_queries.get_shared_bet(conn, bet_id)
    if bet is None or bet["league_id"] != league_id:
        raise HTTPException(status_code=404, detail="This bet isn't shared anymore")
    return bet, league_id


@router.post("/bets/{bet_id}/tail")
async def tail_bet(bet_id: int, request: Request, pool=Depends(get_pool)):
    """Saves a copy of the picks as your own bet (no wager; private until
    you share it) and counts the tail on theirs."""
    payload = _decode_session_or_401(request)
    viewer = payload["user_id"]
    async with pool.acquire() as conn:
        bet, league_id = await _league_bet(conn, payload, bet_id)
        if bet["user_id"] == viewer:
            raise HTTPException(status_code=409, detail="That's your own bet")
        existing = await lq.existing_tail(conn, bet_id, viewer)
        if existing:
            return {"tailed": True, "bet_id": existing["tail_bet_id"]}
        legs = (await bet_queries.legs_for_bets(conn, [bet_id])).get(bet_id, [])
        owner_id = await resolve_owner_id(conn, payload)
        name = (await bet_queries.bet_owner_names(conn, [bet["user_id"]])).get(bet["user_id"], "a league-mate")
        async with conn.transaction():
            copy_id = await bet_queries.insert_bet(
                conn, viewer, owner_id, league_id,
                {"sportsbook": None, "odds_american": bet["odds_american"], "source": "manual", "note": f"Tailed {name}"[:280]},
                [dict(l) for l in legs],
            )
            await lq.add_tail(conn, bet_id, viewer, copy_id)
            await lq.set_reaction(conn, bet_id, viewer, "fade", False)
        return {"tailed": True, "bet_id": copy_id}


@router.put("/bets/{bet_id}/reactions/{kind}")
async def add_reaction(bet_id: int, kind: str, request: Request, pool=Depends(get_pool)):
    return await _react(bet_id, kind, True, request, pool)


@router.delete("/bets/{bet_id}/reactions/{kind}")
async def remove_reaction(bet_id: int, kind: str, request: Request, pool=Depends(get_pool)):
    return await _react(bet_id, kind, False, request, pool)


async def _react(bet_id: int, kind: str, on: bool, request: Request, pool) -> dict:
    payload = _decode_session_or_401(request)
    viewer = payload["user_id"]
    if kind not in _REACTIONS:
        raise HTTPException(status_code=404, detail="Unknown reaction")
    async with pool.acquire() as conn:
        bet, _ = await _league_bet(conn, payload, bet_id)
        if on and kind == "fade":
            if bet["user_id"] == viewer:
                raise HTTPException(status_code=409, detail="You can't fade your own bet")
            if await lq.existing_tail(conn, bet_id, viewer):
                raise HTTPException(status_code=409, detail="You tailed this one")
        await lq.set_reaction(conn, bet_id, viewer, kind, on)
        rows = await lq.reactions_for(conn, [bet_id])
        return {
            k: {"count": sum(1 for r in rows if r["kind"] == k), "mine": any(r["kind"] == k and r["user_id"] == viewer for r in rows)}
            for k in sorted(_REACTIONS)
        }


@router.put("/members/{user_id}/follow")
async def follow(user_id: int, request: Request, pool=Depends(get_pool)):
    return await _follow(user_id, True, request, pool)


@router.delete("/members/{user_id}/follow")
async def unfollow(user_id: int, request: Request, pool=Depends(get_pool)):
    return await _follow(user_id, False, request, pool)


async def _follow(user_id: int, on: bool, request: Request, pool) -> dict:
    payload = _decode_session_or_401(request)
    if user_id == payload["user_id"]:
        raise HTTPException(status_code=409, detail="That's you")
    async with pool.acquire() as conn:
        league_id = await _league(conn, payload)
        if not await league_queries.get_membership(conn, league_id, user_id):
            raise HTTPException(status_code=404, detail="They're not in your league")
        await lq.set_follow(conn, payload["user_id"], user_id, on)
    return {"following": on}
