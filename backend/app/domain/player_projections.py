"""
Bulk player-projection sync — projected_points on the `players` table,
one of the three fields the draft pool now shows inline (see
app/routers/draft.py's GET /draft/pool). Same domain-orchestrates/
provider-fetches split as app/domain/bye_weeks.py: app/providers/espn/
free_agents.py's get_all_projected_points does the read-only ESPN
fetch, this module does the DB write.

Matched onto `players` two ways: first by the existing espn_player_id
crosswalk (app/providers/sleeper/ingest.py's sync_players already
populates this for most, not all, of this league's real draftable
skill-position pool); for anyone still missing a crosswalk, a second
pass matches by exact full_name against this same ESPN response — the
same "exact string match only, a rare same-name mismatch is an
accepted risk" precedent app/providers/espn/player_info.py's own
get_player_info already established for the single-player case,
applied here in bulk instead, and additionally persisting the resolved
espn_player_id back onto that row (same COALESCE-preserving reasoning
as sync_players — a future sync should never need to re-resolve a name
match it's already found once). A player this can't match either way
(a real name-formatting difference, or genuinely absent from ESPN's
free-agent pool) simply keeps projected_points NULL — this is a
best-effort display enrichment, not something the draft pool depends
on to function.
"""
from app.providers.espn.config import ESPNConfig
from app.providers.espn.free_agents import get_all_projected_points


async def sync_projected_points(conn, config: ESPNConfig | None = None, season: int | None = None) -> dict:
    """Returns {"matched_by_espn_id", "matched_by_name",
    "espn_free_agents_seen"} — see POST /admin/players/sync-projections
    for the manual trigger."""
    espn_players = get_all_projected_points(config, season)
    by_espn_id = {p["espn_player_id"]: p["projected_points"] for p in espn_players if p["espn_player_id"]}
    by_name = {p["name"]: p for p in espn_players if p["name"]}

    async with conn.transaction():
        id_rows = await conn.fetch(
            "SELECT sleeper_player_id, espn_player_id FROM players WHERE espn_player_id = ANY($1::int[])",
            list(by_espn_id.keys()),
        )
        id_values = [(by_espn_id[row["espn_player_id"]], row["sleeper_player_id"]) for row in id_rows]
        if id_values:
            # ROUND(...::numeric, 2) here, not just a pre-rounded Python
            # float — espn_api hands back raw IEEE-754 doubles (e.g.
            # 283.3899999999999...), and Python's own round() on a float
            # is still a float with the same representation problem;
            # only rounding on the Postgres side, after the numeric
            # cast, actually lands a clean two-decimal value in this
            # unscaled NUMERIC column.
            await conn.executemany(
                "UPDATE players SET projected_points = ROUND($1::numeric, 2) WHERE sleeper_player_id = $2",
                id_values,
            )

        missing_rows = await conn.fetch(
            "SELECT sleeper_player_id, full_name FROM players WHERE is_draftable AND espn_player_id IS NULL"
        )
        name_values = []
        for row in missing_rows:
            match = by_name.get(row["full_name"])
            if match is not None and match["espn_player_id"] is not None:
                name_values.append((match["espn_player_id"], match["projected_points"], row["sleeper_player_id"]))
        if name_values:
            await conn.executemany(
                "UPDATE players SET espn_player_id = $1, projected_points = ROUND($2::numeric, 2) "
                "WHERE sleeper_player_id = $3",
                name_values,
            )

    return {
        "matched_by_espn_id": len(id_values),
        "matched_by_name": len(name_values),
        "espn_free_agents_seen": len(espn_players),
    }
