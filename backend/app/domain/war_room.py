"""
The War Room (2026-10-27): My Team's Draft and Keepers tabs as one, a
page that follows the calendar.

- keepers: the deadline, how far each manager has got (who they kept
  stays hidden until keepers lock) and a nudge for the stragglers.
- draft: countdown, your picks, who's likely still there at your next
  pick, your queue, and the keepers already off the board.
- report card: your draft-day grade next to a hindsight grade from what
  every pick has actually scored, each of your picks' standing now, the
  league's best pick and biggest miss, and next year's keeper watch.

get_war_room picks the phase (keepers while the window is open, the
report card once the draft is done, the draft otherwise) and returns
every phase's data, so the tabs switch without another request.
"""
import datetime
from statistics import NormalDist

from app.domain import draft_grades

LIKELY_SHOWN = 5
QUEUE_SHOWN = 5
# A steal or a bust in hindsight: picked this many rounds away from
# where his points so far rank among everyone drafted.
HINDSIGHT_STEAL_ROUNDS = 2
HINDSIGHT_BUST_ROUNDS = 3
BUST_ROUNDS = 5  # only early picks can be the biggest miss


def chance_available(adp: float, pick_number: int, picks_before: int) -> float:
    """Chance a player with this ADP is still there at pick_number,
    when picks_before picks are still to be made ahead of it. ADP
    scatters more the later it is."""
    if picks_before <= 0:
        return 1.0
    spread = max(2.5, adp * 0.22)
    return round(1 - NormalDist(adp, spread).cdf(pick_number - 0.5), 2)


def _iso(value):
    return value.isoformat() if value else None


async def _season_team_count(conn, season: int, league_id: int) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM teams_by_season WHERE season = $1 AND league_id = $2", season, league_id
    ) or 0


async def _names(conn, league_id: int, season: int) -> dict[int, str]:
    rows = await conn.fetch(
        "SELECT t.owner_id, COALESCE(o.goes_by, o.display_name) AS name FROM teams_by_season t "
        "JOIN owners o ON o.owner_id = t.owner_id WHERE t.season = $1 AND t.league_id = $2 ORDER BY t.id",
        season, league_id,
    )
    return {r["owner_id"]: r["name"] for r in rows}


async def keepers_phase(conn, season: int, league_id: int, owner_id: int) -> dict | None:
    rules = await conn.fetchrow(
        "SELECT * FROM league_keeper_rules WHERE season = $1 AND league_id = $2", season, league_id
    )
    if rules is None or not rules["max_keepers"]:
        return None
    now = datetime.datetime.now(datetime.timezone.utc)
    locked = rules["locked_at"] is not None or (rules["keeper_deadline"] is not None and now >= rules["keeper_deadline"])
    names = await _names(conn, league_id, season)
    rows = await conn.fetch(
        "SELECT owner_id, player_name, consecutive_years_kept FROM keeper_selections "
        "WHERE season = $1 AND league_id = $2 ORDER BY owner_id, id",
        season, league_id,
    )
    picked: dict[int, list] = {o: [] for o in names}
    for r in rows:
        picked.setdefault(r["owner_id"], []).append(r)
    managers = [
        {
            "owner_id": o,
            "is_me": o == owner_id,
            "name": names.get(o, "Manager"),
            "count": len(picked.get(o, [])),
            "done": len(picked.get(o, [])) >= rules["max_keepers"],
            # Who someone kept stays secret until everyone's locked in.
            "players": [r["player_name"] for r in picked.get(o, [])] if locked or o == owner_id else None,
        }
        for o in names
    ]
    return {
        "max_keepers": rules["max_keepers"],
        "max_consecutive_years": rules["max_consecutive_years"],
        "deadline": _iso(rules["keeper_deadline"]),
        "locked": locked,
        "is_open": not locked,
        "managers": managers,
        "waiting_on": sum(1 for m in managers if not m["done"]),
    }


async def _adp_board(conn, season: int, league_id: int, snapshot_id: int | None) -> dict[str, float]:
    """The draft's pinned ADP, or before it starts the newest snapshot
    for the league's format."""
    if snapshot_id is None:
        from app.domain import adp as adp_domain

        fmt, teams = await adp_domain.league_adp_format(conn, season, league_id)
        snapshot_id = await conn.fetchval(
            "SELECT id FROM adp_snapshots WHERE season = $1 AND format = $2 AND teams = $3 "
            "ORDER BY fetched_on DESC LIMIT 1",
            season, fmt, teams,
        )
    if snapshot_id is None:
        return {}
    rows = await conn.fetch(
        "SELECT sleeper_player_id, adp FROM adp_entries WHERE snapshot_id = $1 AND sleeper_player_id IS NOT NULL",
        snapshot_id,
    )
    return {r["sleeper_player_id"]: float(r["adp"]) for r in rows}


async def draft_phase(conn, season: int, league_id: int, owner_id: int) -> dict:
    config = await conn.fetchrow("SELECT * FROM draft_config WHERE season = $1 AND league_id = $2", season, league_id)
    scheduled = await conn.fetchval(
        "SELECT scheduled_start FROM league_draft_schedule WHERE season = $1 AND league_id = $2", season, league_id
    )
    picks = await conn.fetch(
        "SELECT dp.pick_number, dp.round, dp.round_pick, dp.owner_id, dp.is_keeper, dp.sleeper_player_id, "
        "p.full_name, p.position FROM draft_picks dp LEFT JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id "
        "WHERE dp.season = $1 AND dp.league_id = $2 ORDER BY dp.pick_number",
        season, league_id,
    )
    adp = await _adp_board(conn, season, league_id, config["adp_snapshot_id"] if config else None)
    taken = {p["sleeper_player_id"] for p in picks if p["sleeper_player_id"]}

    mine = [p for p in picks if p["owner_id"] == owner_id]
    current = config["current_pick_number"] if config else 1
    next_pick = next((p for p in mine if p["sleeper_player_id"] is None and p["pick_number"] >= current), None)

    likely = []
    if next_pick and adp:
        ahead = sum(1 for p in picks if current <= p["pick_number"] < next_pick["pick_number"] and not p["sleeper_player_id"])
        candidates = sorted((a, pid) for pid, a in adp.items() if pid not in taken)
        scored = [(pid, a, chance_available(a, next_pick["pick_number"], ahead)) for a, pid in candidates[:80]]
        scored = [s for s in scored if 0.15 <= s[2] <= 0.97]
        players = await _players(conn, [s[0] for s in scored[:LIKELY_SHOWN]])
        likely = [
            {**players.get(pid, {"name": pid, "position": None, "team": None}), "sleeper_player_id": pid,
             "adp": round(a, 1), "chance": chance}
            for pid, a, chance in scored[:LIKELY_SHOWN]
        ]

    queue_rows = await conn.fetch(
        "SELECT q.sleeper_player_id, p.full_name, p.position FROM draft_queue_items q "
        "LEFT JOIN players p ON p.sleeper_player_id = q.sleeper_player_id "
        "WHERE q.season = $1 AND q.league_id = $2 AND q.owner_id = $3 AND NOT (q.sleeper_player_id = ANY($4::text[])) "
        "ORDER BY q.rank LIMIT $5",
        season, league_id, owner_id, list(taken), QUEUE_SHOWN,
    )
    names = await _names(conn, league_id, season)
    keepers: dict[int, list[str]] = {}
    for p in picks:
        if p["is_keeper"] and p["full_name"]:
            keepers.setdefault(p["owner_id"], []).append(p["full_name"])
    team_count = len(config["draft_order"]) if config else await _season_team_count(conn, season, league_id)
    rounds = max((p["round"] for p in picks), default=None)
    order = list(config["draft_order"]) if config else []
    return {
        "status": config["status"] if config else "not_set",
        "draft_type": config["draft_type"] if config else None,
        "scheduled_start": _iso((config and config.get("scheduled_start")) or scheduled),
        "pick_seconds": config["pick_time_limit_seconds"] if config else None,
        "team_count": team_count,
        "rounds": rounds,
        "my_slot": order.index(owner_id) + 1 if owner_id in order else None,
        "order": [{"owner_id": o, "name": names.get(o, "Manager")} for o in order],
        "my_picks": [
            {"pick_number": p["pick_number"], "round": p["round"], "round_pick": p["round_pick"],
             "is_keeper": p["is_keeper"], "player_name": p["full_name"], "position": p["position"]}
            for p in mine
        ],
        "next_pick": next_pick["pick_number"] if next_pick else None,
        "likely_available": likely,
        "queue": [
            {"sleeper_player_id": q["sleeper_player_id"], "name": q["full_name"], "position": q["position"],
             "adp": round(adp[q["sleeper_player_id"]], 1) if q["sleeper_player_id"] in adp else None}
            for q in queue_rows
        ],
        "keepers_off_board": [
            {"owner_id": o, "name": names.get(o, "Manager"), "players": ps} for o, ps in keepers.items()
        ],
    }


async def _players(conn, ids: list[str]) -> dict[str, dict]:
    rows = await conn.fetch(
        "SELECT sleeper_player_id, full_name, position, pro_team FROM players WHERE sleeper_player_id = ANY($1::text[])",
        ids,
    )
    return {r["sleeper_player_id"]: {"name": r["full_name"], "position": r["position"], "team": r["pro_team"]} for r in rows}


def hindsight_grades(points_by_owner: dict[int, float]) -> dict[int, dict]:
    """owner_id → letter and rank from what their picks have scored."""
    owners = list(points_by_owner)
    ranked = sorted(owners, key=lambda o: -points_by_owner[o])
    out = {}
    for o in owners:
        pct = sum(1 for other in owners if points_by_owner[other] <= points_by_owner[o]) / len(owners) * 100
        out[o] = {"letter": draft_grades._letter_for_percentile(pct), "rank": ranked.index(o) + 1}
    return out


def _position_ranks(points: dict[str, float], positions: dict[str, str]) -> dict[str, int]:
    by_pos: dict[str, list[str]] = {}
    for pid, pos in positions.items():
        by_pos.setdefault(pos, []).append(pid)
    ranks = {}
    for pids in by_pos.values():
        for i, pid in enumerate(sorted(pids, key=lambda p: -points.get(p, 0)), start=1):
            ranks[pid] = i
    return ranks


async def report_card_phase(conn, season: int, league_id: int, owner_id: int) -> dict | None:
    picks = await conn.fetch(
        "SELECT dp.pick_number, dp.round, dp.round_pick, dp.owner_id, dp.is_keeper, dp.sleeper_player_id, "
        "p.full_name, p.position FROM draft_picks dp JOIN players p ON p.sleeper_player_id = dp.sleeper_player_id "
        "WHERE dp.season = $1 AND dp.league_id = $2 ORDER BY dp.pick_number",
        season, league_id,
    )
    if not picks:
        return None
    team_count = len({p["owner_id"] for p in picks}) or 1
    stats = await conn.fetch(
        "SELECT pws.sleeper_player_id, sum(pws.fantasy_points) AS pts, max(pws.week) AS week, p.position "
        "FROM player_week_stats pws JOIN players p ON p.sleeper_player_id = pws.sleeper_player_id "
        "WHERE pws.season = $1 AND pws.league_id = $2 GROUP BY pws.sleeper_player_id, p.position",
        season, league_id,
    )
    points = {r["sleeper_player_id"]: float(r["pts"] or 0) for r in stats}
    through_week = max((r["week"] for r in stats), default=None)
    pos_rank = _position_ranks(points, {r["sleeper_player_id"]: r["position"] for r in stats})

    drafted = sorted(picks, key=lambda p: -points.get(p["sleeper_player_id"], 0))
    points_rank = {p["sleeper_player_id"]: i for i, p in enumerate(drafted, start=1)}
    by_owner: dict[int, float] = {}
    for p in picks:
        by_owner[p["owner_id"]] = by_owner.get(p["owner_id"], 0) + points.get(p["sleeper_player_id"], 0)
    hindsight = hindsight_grades(by_owner)

    grades = await draft_grades.get_draft_grades_for_season(conn, season, league_id)
    draft_day_rank = {g["owner_id"]: i for i, g in enumerate(grades, start=1)}
    mine_grade = next((g for g in grades if g["owner_id"] == owner_id), None)

    roster = await conn.fetch(
        "SELECT cr.sleeper_player_id, cr.lineup_slot FROM current_rosters cr "
        "JOIN teams_by_season t ON t.id = cr.team_id "
        "WHERE cr.season = $1 AND t.league_id = $2 AND t.owner_id = $3",
        season, league_id, owner_id,
    )
    slots = {r["sleeper_player_id"]: r["lineup_slot"] for r in roster}

    def gained(p) -> float:
        return (p["pick_number"] - points_rank[p["sleeper_player_id"]]) / team_count

    def status(pid: str) -> str:
        slot = slots.get(pid)
        if slot is None:
            return "gone"
        return {"IR": "ir", "BE": "bench", "TAXI": "bench"}.get(slot, "starter")

    def tag(p) -> str | None:
        if p["is_keeper"] or not points:
            return None
        if gained(p) >= HINDSIGHT_STEAL_ROUNDS:
            return "steal"
        if p["round"] <= BUST_ROUNDS and -gained(p) >= HINDSIGHT_BUST_ROUNDS:
            return "bust"
        return None

    names = await _names(conn, league_id, season)

    def headline(p) -> dict:
        pid = p["sleeper_player_id"]
        return {
            "owner_name": names.get(p["owner_id"], "Manager"), "owner_id": p["owner_id"], "round": p["round"],
            "player_name": p["full_name"], "position": p["position"], "position_rank": pos_rank.get(pid),
            "points": round(points.get(pid, 0), 1),
        }

    live = [p for p in picks if not p["is_keeper"]]
    best = max(live, key=gained, default=None) if points else None
    early = [p for p in live if p["round"] <= BUST_ROUNDS]
    miss = min(early, key=gained, default=None) if points else None

    return {
        "through_week": through_week,
        "draft_day": {
            "letter": mine_grade["letter_grade"] if mine_grade else None,
            "rank": draft_day_rank.get(owner_id),
        },
        "hindsight": hindsight.get(owner_id) if points else None,
        "team_count": team_count,
        "narrative": await conn.fetchval(
            "SELECT text FROM draft_narratives WHERE season = $1 AND league_id = $2 AND owner_id = $3",
            season, league_id, owner_id,
        ),
        "picks": [
            {"pick_number": p["pick_number"], "round": p["round"], "round_pick": p["round_pick"],
             "is_keeper": p["is_keeper"], "sleeper_player_id": p["sleeper_player_id"], "player_name": p["full_name"],
             "position": p["position"], "points": round(points.get(p["sleeper_player_id"], 0), 1),
             "status": status(p["sleeper_player_id"]), "tag": tag(p)}
            for p in picks if p["owner_id"] == owner_id
        ],
        "best_pick": headline(best) if best and gained(best) > 0 else None,
        "biggest_miss": headline(miss) if miss and gained(miss) < 0 else None,
        "keeper_watch": await _keeper_watch(conn, season, league_id, owner_id, slots, points),
    }


async def _keeper_watch(conn, season: int, league_id: int, owner_id: int, slots: dict, points: dict) -> dict | None:
    """Next season's keeper picture from today's roster, for keeper
    leagues: the best players on it and how many more years each can
    be kept."""
    rules = await conn.fetchrow(
        "SELECT max_keepers, max_consecutive_years FROM league_keeper_rules WHERE season = $1 AND league_id = $2",
        season, league_id,
    )
    if rules is None or not rules["max_keepers"] or not slots:
        return None
    kept = await conn.fetch(
        "SELECT p.sleeper_player_id, ks.consecutive_years_kept FROM keeper_selections ks "
        "JOIN players p ON p.espn_player_id = ks.espn_player_id "
        "WHERE ks.season = $1 AND ks.league_id = $2 AND ks.owner_id = $3",
        season, league_id, owner_id,
    )
    years = {r["sleeper_player_id"]: r["consecutive_years_kept"] for r in kept}
    cap = rules["max_consecutive_years"]
    best = sorted(slots, key=lambda pid: -points.get(pid, 0))[: rules["max_keepers"] + 2]
    players = await _players(conn, best)
    out = []
    for pid in best:
        next_year = years.get(pid, 0) + 1
        out.append({
            **players.get(pid, {"name": pid, "position": None, "team": None}),
            "sleeper_player_id": pid, "points": round(points.get(pid, 0), 1),
            "next_year": next_year, "eligible": cap is None or next_year <= cap, "max_years": cap,
        })
    return {"slots": rules["max_keepers"], "players": out}


async def get_war_room(conn, season: int, league_id: int, owner_id: int) -> dict:
    keepers = await keepers_phase(conn, season, league_id, owner_id)
    draft = await draft_phase(conn, season, league_id, owner_id)
    report = await report_card_phase(conn, season, league_id, owner_id) if draft["status"] == "complete" else None
    if report:
        phase = "report_card"
    elif draft["status"] in ("in_progress", "paused"):
        phase = "draft"
    elif keepers and keepers["is_open"]:
        phase = "keepers"
    else:
        phase = "draft"
    return {"season": season, "phase": phase, "keepers": keepers, "draft": draft, "report_card": report}


async def nudge_keepers(conn, season: int, league_id: int, sender_owner_id: int) -> list[int]:
    """Owners still short of their keepers, once per league per day."""
    keepers = await keepers_phase(conn, season, league_id, sender_owner_id)
    if not keepers or not keepers["is_open"]:
        return []
    return [m["owner_id"] for m in keepers["managers"] if not m["done"] and m["owner_id"] != sender_owner_id]
