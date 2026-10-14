"""
Bulk player-projection sync — projected_points (season total) and
projected_avg_points (per-game average, used for weekly matchup
projections) on the `players` table. Same domain-orchestrates/
provider-fetches split as app/domain/bye_weeks.py: app/providers/espn/
free_agents.py's get_projections does the read-only ESPN fetch, this
module does the DB write.

Matched onto `players` two ways: first by the existing espn_player_id
crosswalk (app/providers/sleeper/ingest.py's sync_players already
populates this for most, not all, of this league's real draftable
skill-position pool); for anyone still missing a crosswalk, a second
pass resolves one by exact full_name against ESPN's own player-name
index (League.player_map — every real NFL player, independent of
roster status on any particular ESPN league) and persists it back onto
that row (same COALESCE-preserving reasoning as sync_players — a
future sync should never need to re-resolve a name match it's already
found once).

2026-09 fix: this used to read League.free_agents(), which only
returns players ESPN itself considers unrostered on its OWN,
now-disconnected league — once that league had auto-rostered its own
(irrelevant) copies of this app's real draft picks, every actual star
player real owners had drafted here came back with no projection at
all, matched by neither id nor name. League.player_info/player_map
work regardless of ESPN-side roster status, closing that gap for good.

A player this still can't match either way (a real name-formatting
difference, or genuinely absent from ESPN's own index) simply keeps
projected_points/projected_avg_points NULL — this is a best-effort
display enrichment, not something the draft pool or matchup screen
depend on to function.
"""
from app.providers.espn.config import ESPNConfig
from app.providers.espn.free_agents import get_projections, get_weekly_projections

REGULAR_SEASON_WEEKS = 18


async def sync_projected_points(conn, config: ESPNConfig | None = None, season: int | None = None) -> dict:
    """Returns {"matched_by_espn_id", "matched_by_name",
    "espn_players_seen"} — see POST /admin/players/sync-projections
    for the manual trigger."""
    known_rows = await conn.fetch(
        "SELECT sleeper_player_id, espn_player_id FROM players WHERE espn_player_id IS NOT NULL AND is_draftable"
    )
    missing_rows = await conn.fetch(
        "SELECT sleeper_player_id, full_name FROM players WHERE is_draftable AND espn_player_id IS NULL"
    )

    known_ids = [row["espn_player_id"] for row in known_rows]
    unresolved_names = [row["full_name"] for row in missing_rows]
    data = get_projections(known_ids, unresolved_names, config, season)
    by_espn_id = data["by_espn_id"]
    resolved_ids_by_name = data["resolved_ids_by_name"]

    async with conn.transaction():
        id_values = []
        for row in known_rows:
            proj = by_espn_id.get(row["espn_player_id"])
            if proj is not None:
                id_values.append((proj["projected_points"], proj["projected_avg_points"], row["sleeper_player_id"]))
        if id_values:
            await conn.executemany(
                "UPDATE players SET projected_points = ROUND($1::numeric, 2), "
                "projected_avg_points = ROUND($2::numeric, 2) WHERE sleeper_player_id = $3",
                id_values,
            )

        name_values = []
        for row in missing_rows:
            espn_id = resolved_ids_by_name.get(row["full_name"])
            if espn_id is None:
                continue
            proj = by_espn_id.get(espn_id)
            if proj is None:
                continue
            name_values.append(
                (espn_id, proj["projected_points"], proj["projected_avg_points"], row["sleeper_player_id"])
            )
        if name_values:
            await conn.executemany(
                "UPDATE players SET espn_player_id = $1, projected_points = ROUND($2::numeric, 2), "
                "projected_avg_points = ROUND($3::numeric, 2) WHERE sleeper_player_id = $4",
                name_values,
            )

    return {
        "matched_by_espn_id": len(id_values),
        "matched_by_name": len(name_values),
        "espn_players_seen": len(by_espn_id),
    }


async def sync_weekly_projections(conn, config: ESPNConfig | None = None, season: int | None = None) -> dict:
    """Real per-week ESPN projections for the current week through the
    end of the regular season, into player_weekly_projections (the
    table every lineup/matchup query already reads first, falling back
    to players.projected_avg_points). Before this, only weeks that had
    a box score got a row, so looking ahead showed the same season
    average for every week.

    Future weeks are overwritten each run (ESPN keeps revising them).
    The current week only fills gaps: adapter.py's box-score harvest
    owns it for rostered players, and this just covers free agents the
    box scores never see. Past weeks are never touched."""
    config = config or ESPNConfig()
    season = season or config.active_season
    current_week = await conn.fetchval("SELECT current_week FROM league_state WHERE season = $1", season)
    if not current_week or current_week > REGULAR_SEASON_WEEKS:
        return {"weeks": 0, "rows": 0}

    rows = await conn.fetch(
        "SELECT sleeper_player_id, espn_player_id FROM players "
        "WHERE espn_player_id IS NOT NULL AND projected_avg_points > 0"
    )
    if not rows:
        return {"weeks": 0, "rows": 0}
    sleeper_by_espn = {row["espn_player_id"]: row["sleeper_player_id"] for row in rows}

    weeks = list(range(current_week, REGULAR_SEASON_WEEKS + 1))
    by_week = get_weekly_projections(list(sleeper_by_espn), weeks, config, season)

    written = 0
    async with conn.transaction():
        for week, by_id in by_week.items():
            values = [
                (season, week, sleeper_by_espn[espn_id], points)
                for espn_id, points in by_id.items() if espn_id in sleeper_by_espn
            ]
            if not values:
                continue
            on_conflict = (
                "DO NOTHING" if week == current_week
                else "DO UPDATE SET projected_points = EXCLUDED.projected_points, synced_at = now()"
            )
            await conn.executemany(
                "INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points) "
                f"VALUES ($1, $2, $3, ROUND($4::numeric, 2)) ON CONFLICT (season, week, sleeper_player_id) {on_conflict}",
                values,
            )
            written += len(values)
    return {"weeks": len(by_week), "rows": written}
