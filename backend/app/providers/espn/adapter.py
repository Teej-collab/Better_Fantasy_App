"""
ESPN provider adapter — implements FantasyProvider using the espn_api
library, exactly as Fantasy_Helper's scripts/sync_teams.py,
sync_matchups.py, and sync_rosters.py already did (see MIGRATION_MAP.md:
"EXTRACT / PORT — becomes the ESPN provider adapter. Logic stays the
same"). Only the shape changed: one season at a time, behind the
FantasyProvider interface, instead of a standalone script looping over
every season itself.
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

    async def sync_teams(self, pool, season: int) -> int:
        league = self._league(season)

        async with pool.acquire() as conn:
            for team in league.teams:
                owner_info = team.owners[0]
                espn_member_id = owner_info["id"]
                display_name = f"{owner_info['firstName']} {owner_info['lastName']}".strip()

                owner_id = await conn.fetchval(
                    """
                    INSERT INTO owners (espn_member_id, display_name)
                    VALUES ($1, $2)
                    ON CONFLICT (espn_member_id)
                    DO UPDATE SET display_name = EXCLUDED.display_name
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

    async def sync_matchups(self, pool, season: int) -> int:
        league = self._league(season)
        reg_season_weeks = league.settings.reg_season_count
        saved_count = 0

        async with pool.acquire() as conn:
            for week in range(1, MAX_WEEKS_TO_TRY + 1):
                try:
                    matchups = league.scoreboard(week)
                except Exception:
                    break  # no more weeks exist for this season

                if not matchups:
                    break

                is_playoff = week > reg_season_weeks

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

                for bs in box_scores:
                    if bs.away_team == 0:
                        continue

                    home_db_id = await _get_team_db_id(conn, season, bs.home_team.team_id)
                    away_db_id = await _get_team_db_id(conn, season, bs.away_team.team_id)

                    if home_db_id:
                        await self._save_lineup(conn, season, week, home_db_id, bs.home_lineup)
                    if away_db_id:
                        await self._save_lineup(conn, season, week, away_db_id, bs.away_lineup)

                saved_weeks += 1

        return saved_weeks

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
                    (season, week, team_id, player_name, position, lineup_slot, points_scored, points_projected)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                season, week, team_db_id, player.name, player.position,
                player.slot_position,
                Decimal(str(round(player.points, 2))), Decimal(str(round(player.projected_points, 2))),
            )
