"""
ESPN provider adapter — implements FantasyProvider using the espn_api
library, exactly as Fantasy_Helper's scripts/sync_teams.py,
sync_matchups.py, and sync_rosters.py already did (see MIGRATION_MAP.md:
"EXTRACT / PORT — becomes the ESPN provider adapter. Logic stays the
same"). Only the shape changed: one season at a time, behind the
FantasyProvider interface, instead of a standalone script looping over
every season itself.

sync_matchups_for_week/sync_rosters_for_week and get_current_week were
added for live in-game sync (see app/providers/sync.py's
run_live_sync) — fetching one specific week directly instead of looping
1..17 "does this week exist yet" checks, so they're fast enough to poll
frequently during live games without re-scanning full history.
"""
from decimal import Decimal

from espn_api.football import League

from app.providers.base import FantasyProvider
from app.providers.espn.config import ESPNConfig

MAX_WEEKS_TO_TRY = 17  # covers regular season + playoffs; we stop early if a week has no data


async def _get_team_db_id(conn, season: int, espn_team_id: int):
    return await conn.fetchval(
        "SELECT id FROM teams_by_season WHERE season = $1 AND espn_team_id = $2",
        season, espn_team_id,
    )


class ESPNProvider(FantasyProvider):
    def __init__(self, config: ESPNConfig | None = None):
        self.config = config or ESPNConfig()

    def _league(self, season: int) -> League:
        return League(
            league_id=self.config.league_id,
            year=season,
            espn_s2=self.config.espn_s2,
            swid=self.config.swid,
        )

    async def get_current_week(self, season: int) -> int:
        """Ported from Fantasy_Helper's bot/ingestion/espn_client.py, unchanged."""
        return self._league(season).current_week

    async def sync_teams(self, pool, season: int) -> int:
        league = self._league(season)

        async with pool.acquire() as conn:
            for team in league.teams:
                owner_info = team.owners[0]
                espn_member_id = owner_info["id"]
                display_name = f"{owner_info['firstName']} {owner_info['lastName']}".strip()

                # display_name_is_custom: once an owner sets a self-serve
                # display name (app/routers/settings.py), it survives
                # every future sync instead of being overwritten back to
                # the real ESPN name on the next full/live sync — see
                # migration 893534025217 for the full reasoning.
                owner_id = await conn.fetchval(
                    """
                    INSERT INTO owners (espn_member_id, display_name)
                    VALUES ($1, $2)
                    ON CONFLICT (espn_member_id)
                    DO UPDATE SET display_name = CASE
                        WHEN owners.display_name_is_custom THEN owners.display_name
                        ELSE EXCLUDED.display_name
                    END
                    RETURNING owner_id
                    """,
                    espn_member_id, display_name,
                )

                await conn.execute(
                    """
                    INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (season, espn_team_id)
                    DO UPDATE SET owner_id = EXCLUDED.owner_id, team_name = EXCLUDED.team_name
                    """,
                    season, team.team_id, owner_id, team.team_name,
                )

        return len(league.teams)

    async def _sync_matchup_week(self, conn, matchups, season: int, week: int, reg_season_weeks: int) -> int:
        if not matchups:
            return 0

        is_playoff = week > reg_season_weeks
        saved_count = 0

        for m in matchups:
            if m.away_team == 0:  # bye week, no real opponent
                continue

            home_db_id = await _get_team_db_id(conn, season, m.home_team.team_id)
            away_db_id = await _get_team_db_id(conn, season, m.away_team.team_id)

            if home_db_id is None or away_db_id is None:
                continue  # team not found, skip rather than crash

            await conn.execute(
                """
                INSERT INTO matchups
                    (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff)
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (season, week, home_team_id, away_team_id)
                DO UPDATE SET home_score = EXCLUDED.home_score,
                              away_score = EXCLUDED.away_score,
                              is_playoff = EXCLUDED.is_playoff
                """,
                season, week, home_db_id, away_db_id,
                Decimal(str(round(m.home_score, 2))), Decimal(str(round(m.away_score, 2))), is_playoff,
            )
            saved_count += 1

        return saved_count

    async def sync_matchups(self, pool, season: int) -> int:
        league = self._league(season)
        reg_season_weeks = league.settings.reg_season_count
        saved_count = 0

        async with pool.acquire() as conn:
            for week in range(1, MAX_WEEKS_TO_TRY + 1):
                try:
                    week_matchups = league.scoreboard(week)
                except Exception:
                    break  # no more weeks exist for this season

                if not week_matchups:
                    break

                saved_count += await self._sync_matchup_week(conn, week_matchups, season, week, reg_season_weeks)

        return saved_count

    async def sync_matchups_for_week(self, pool, season: int, week: int) -> int:
        league = self._league(season)
        reg_season_weeks = league.settings.reg_season_count
        matchups = league.scoreboard(week)
        async with pool.acquire() as conn:
            return await self._sync_matchup_week(conn, matchups, season, week, reg_season_weeks)

    async def _save_roster_week(self, conn, box_scores, season: int, week: int) -> bool:
        """Just the write — no "has this week really started" judgment.
        That gate matters for the full historical scan (below), where it's
        the signal to stop looking at further weeks, but not for a live
        sync of a week we already know is current: pre-kickoff lineups
        (0 points scored so far) are still real roster data worth saving,
        e.g. to reflect a waiver add before games lock."""
        if not box_scores:
            return False

        for bs in box_scores:
            if bs.away_team == 0:
                continue

            home_db_id = await _get_team_db_id(conn, season, bs.home_team.team_id)
            away_db_id = await _get_team_db_id(conn, season, bs.away_team.team_id)

            if home_db_id:
                await self._save_lineup(conn, season, week, home_db_id, bs.home_lineup)
            if away_db_id:
                await self._save_lineup(conn, season, week, away_db_id, bs.away_lineup)

        return True

    async def sync_rosters(self, pool, season: int) -> int:
        league = self._league(season)
        saved_weeks = 0

        async with pool.acquire() as conn:
            for week in range(1, MAX_WEEKS_TO_TRY + 1):
                try:
                    box_scores = league.box_scores(week)
                except Exception:
                    break

                if not box_scores:
                    break

                # A week with all-zero points across the board means it hasn't
                # actually been played yet — stop here rather than saving empty data.
                any_real_points = any(
                    p.points for bs in box_scores for p in (bs.home_lineup + bs.away_lineup)
                )
                if not any_real_points:
                    break

                await self._save_roster_week(conn, box_scores, season, week)
                saved_weeks += 1

        return saved_weeks

    async def sync_rosters_for_week(self, pool, season: int, week: int) -> int:
        league = self._league(season)
        box_scores = league.box_scores(week)
        async with pool.acquire() as conn:
            saved = await self._save_roster_week(conn, box_scores, season, week)
        return 1 if saved else 0

    async def sync_final_standings(self, pool, season: int) -> int:
        league = self._league(season)
        saved = 0

        async with pool.acquire() as conn:
            for team in league.standings():
                if team.final_standing == 0:
                    continue  # season still in progress — no real final rank yet

                team_db_id = await _get_team_db_id(conn, season, team.team_id)
                if team_db_id is None:
                    continue

                await conn.execute(
                    """
                    INSERT INTO final_standings (season, team_id, final_rank)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (season, team_id)
                    DO UPDATE SET final_rank = EXCLUDED.final_rank
                    """,
                    season, team_db_id, team.final_standing,
                )
                saved += 1

        return saved

    @staticmethod
    async def _save_lineup(conn, season, week, team_db_id, lineup):
        await conn.execute(
            "DELETE FROM rosters WHERE season = $1 AND week = $2 AND team_id = $3",
            season, week, team_db_id,
        )
        for player in lineup:
            await conn.execute(
                """
                INSERT INTO rosters
                    (season, week, team_id, player_name, position, lineup_slot, points_scored,
                     points_projected, espn_player_id, pro_team)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                season, week, team_db_id, player.name, player.position,
                player.slot_position,
                Decimal(str(round(player.points, 2))), Decimal(str(round(player.projected_points, 2))),
                player.playerId, player.proTeam,
            )
