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
from espn_api.football.constant import PRO_TEAM_MAP

from app.config import DEFAULT_LEAGUE_ID
from app.providers.base import FantasyProvider
from app.providers.espn.config import ESPNConfig
from app.queries import team_position_rankings as position_rankings_queries

MAX_WEEKS_TO_TRY = 17  # covers regular season + playoffs; we stop early if a week has no data

# ESPN's own position keys for the mPositionalRatings view (defense-vs-
# position matchup ranks) — NOT the same numbering as espn_api's own
# POSITION_MAP constant (which models lineup-slot IDs, a different ESPN
# enum). Confirmed live against this league's real rostered players
# during planning: Jared Goff (QB) -> key "1", Brian Robinson Jr. (RB)
# -> "2", CeeDee Lamb (WR) -> "3", Dalton Schultz (TE) -> "4", Eddy
# Pineiro (K) -> "5". Key "16" (D/ST) also exists in the raw response
# but is deliberately excluded — see migration 465f0b1ffe3f.
_POSITION_KEY_MAP = {"1": "QB", "2": "RB", "3": "WR", "4": "TE", "5": "K"}


async def _get_team_db_id(conn, season: int, espn_team_id: int, league_id: int = DEFAULT_LEAGUE_ID):
    return await conn.fetchval(
        "SELECT id FROM teams_by_season WHERE season = $1 AND espn_team_id = $2 AND league_id = $3",
        season, espn_team_id, league_id,
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

    async def sync_teams(self, pool, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
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

                # team_name_is_custom: same idea as display_name_is_custom
                # above — once an owner sets a self-serve team name
                # (app/routers/settings.py), it survives every future
                # sync instead of being overwritten back to the real ESPN
                # name on the next full/live sync.
                await conn.execute(
                    """
                    INSERT INTO teams_by_season (season, espn_team_id, owner_id, team_name, league_id)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (season, espn_team_id, league_id)
                    DO UPDATE SET owner_id = EXCLUDED.owner_id, team_name = CASE
                        WHEN teams_by_season.team_name_is_custom THEN teams_by_season.team_name
                        ELSE EXCLUDED.team_name
                    END
                    """,
                    season, team.team_id, owner_id, team.team_name, league_id,
                )

        return len(league.teams)

    async def _sync_matchup_week(
        self, conn, matchups, season: int, week: int, reg_season_weeks: int, league_id: int = DEFAULT_LEAGUE_ID
    ) -> int:
        if not matchups:
            return 0

        is_playoff = week > reg_season_weeks
        if is_playoff:
            # Once this app has generated its own in-app playoff bracket
            # (app/domain/playoffs.py) for this season, that bracket is
            # authoritative — syncing ESPN's own separately-computed
            # shadow-league playoff pairings on top of it would silently
            # create a second, conflicting "truth" for who played whom
            # in the postseason. Exactly the structural risk the
            # competitive audit named; regular-season weeks (is_playoff
            # False) are unaffected and keep syncing from ESPN as
            # before — app/domain/schedule.py's own generator only ever
            # applies to a season that hasn't been scheduled yet
            # (ScheduleAlreadyExistsError otherwise), so it can't
            # retroactively replace this season's real, already-synced,
            # partly-played regular season anyway.
            has_in_app_bracket = await conn.fetchval(
                "SELECT 1 FROM playoff_bracket_matchups WHERE season = $1 AND league_id = $2 LIMIT 1",
                season, league_id,
            )
            if has_in_app_bracket:
                return 0
        saved_count = 0

        # 2026-09-09 fix, real incident (Week 1 2026 kickoff): a season
        # with real current_rosters (this app's own in-app draft, not
        # ESPN's) has its matchup *scores* computed by this app's own
        # engine (app/domain/matchup_scoring.py, driven by the weekly-
        # compute job) from those real rosters — ESPN's own shadow
        # league for that season is frozen/disconnected as of the Aug
        # 26 draft/roster pivot, but this function (driven by the
        # separate, more-frequent live-sync job) was still overwriting
        # home_score/away_score from it every ~60 seconds, racing the
        # in-app engine's own ~120-second tick for control of the same
        # columns. That's what was actually flickering standings/the
        # live ticker between two different, uncoordinated scores.
        # PAIRING (who plays whom) still legitimately comes from ESPN
        # either way — matchup_scoring.py's own docstring already
        # documented "this module only overwrites the score fields"
        # as the intended split; this is what makes that split real.
        # A season with no in-app rosters (2023-2025, synced before
        # this app had its own draft/scoring) is unaffected — ESPN is
        # still the only real source those seasons ever had.
        has_in_app_scoring = await conn.fetchval(
            "SELECT 1 FROM current_rosters WHERE season = $1 AND league_id = $2 LIMIT 1",
            season, league_id,
        )

        for m in matchups:
            if m.away_team == 0:  # bye week, no real opponent
                continue

            home_db_id = await _get_team_db_id(conn, season, m.home_team.team_id, league_id)
            away_db_id = await _get_team_db_id(conn, season, m.away_team.team_id, league_id)

            if home_db_id is None or away_db_id is None:
                continue  # team not found, skip rather than crash

            if has_in_app_scoring:
                await conn.execute(
                    """
                    INSERT INTO matchups
                        (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff, league_id)
                    VALUES ($1, $2, $3, $4, 0, 0, $5, $6)
                    ON CONFLICT (season, week, home_team_id, away_team_id)
                    DO UPDATE SET is_playoff = EXCLUDED.is_playoff
                    """,
                    season, week, home_db_id, away_db_id, is_playoff, league_id,
                )
                saved_count += 1
                continue

            await conn.execute(
                """
                INSERT INTO matchups
                    (season, week, home_team_id, away_team_id, home_score, away_score, is_playoff, league_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (season, week, home_team_id, away_team_id)
                DO UPDATE SET home_score = EXCLUDED.home_score,
                              away_score = EXCLUDED.away_score,
                              is_playoff = EXCLUDED.is_playoff
                """,
                season, week, home_db_id, away_db_id,
                Decimal(str(round(m.home_score, 2))), Decimal(str(round(m.away_score, 2))), is_playoff, league_id,
            )
            saved_count += 1

        return saved_count

    async def sync_matchups(self, pool, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
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

                saved_count += await self._sync_matchup_week(
                    conn, week_matchups, season, week, reg_season_weeks, league_id
                )

        return saved_count

    async def sync_matchups_for_week(self, pool, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
        league = self._league(season)
        reg_season_weeks = league.settings.reg_season_count
        matchups = league.scoreboard(week)
        async with pool.acquire() as conn:
            return await self._sync_matchup_week(conn, matchups, season, week, reg_season_weeks, league_id)

    async def _save_roster_week(
        self, conn, box_scores, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID
    ) -> bool:
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

            home_db_id = await _get_team_db_id(conn, season, bs.home_team.team_id, league_id)
            away_db_id = await _get_team_db_id(conn, season, bs.away_team.team_id, league_id)

            if home_db_id:
                await self._save_lineup(conn, season, week, home_db_id, bs.home_lineup, league_id)
            if away_db_id:
                await self._save_lineup(conn, season, week, away_db_id, bs.away_lineup, league_id)

        return True

    async def sync_rosters(self, pool, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
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

                await self._save_roster_week(conn, box_scores, season, week, league_id)
                await self._save_position_rankings(conn, league, season, week)
                saved_weeks += 1

        return saved_weeks

    async def sync_rosters_for_week(self, pool, season: int, week: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
        league = self._league(season)
        box_scores = league.box_scores(week)
        async with pool.acquire() as conn:
            saved = await self._save_roster_week(conn, box_scores, season, week, league_id)
            await self._save_position_rankings(conn, league, season, week)
        return 1 if saved else 0

    @staticmethod
    async def _save_position_rankings(conn, league: League, season: int, week: int) -> None:
        """Defense-vs-position matchup ranks ("MIN (22nd) vs RB") — ESPN's
        own mPositionalRatings view. espn_api's own League._get_
        positional_ratings already hits this same view internally every
        time box_scores()/free_agents() run, but its wrapper only keeps
        `rank`, discarding `average` — requesting it directly here keeps
        both (see team_position_rankings.py for why average_allowed is
        worth keeping). Best-effort: this is a real, already-verified
        addition, but never worth failing the roster sync it rides
        along with over — same "one unmatched thing never blocks the
        rest" discipline as _save_lineup's player_weekly_projections
        harvest above.
        """
        try:
            data = league.espn_request.league_get(params={"view": "mPositionalRatings", "scoringPeriodId": week})
            ratings = data.get("positionAgainstOpponent", {}).get("positionalRatings", {})

            rows = []
            for pos_key, position in _POSITION_KEY_MAP.items():
                entry = ratings.get(pos_key)
                if not entry:
                    continue
                for team_id_str, rating in entry.get("ratingsByOpponent", {}).items():
                    pro_team = PRO_TEAM_MAP.get(int(team_id_str))
                    if not pro_team:
                        continue
                    rows.append(
                        {
                            "pro_team": pro_team,
                            "position": position,
                            "rank": rating["rank"],
                            "average_allowed": rating["average"],
                        }
                    )
            await position_rankings_queries.upsert_rankings(conn, season, week, rows)
        except Exception:
            pass

    async def sync_final_standings(self, pool, season: int, league_id: int = DEFAULT_LEAGUE_ID) -> int:
        league = self._league(season)
        saved = 0

        async with pool.acquire() as conn:
            for team in league.standings():
                if team.final_standing == 0:
                    continue  # season still in progress — no real final rank yet

                team_db_id = await _get_team_db_id(conn, season, team.team_id, league_id)
                if team_db_id is None:
                    continue

                await conn.execute(
                    """
                    INSERT INTO final_standings (season, team_id, final_rank, league_id)
                    VALUES ($1, $2, $3, $4)
                    ON CONFLICT (season, team_id)
                    DO UPDATE SET final_rank = EXCLUDED.final_rank
                    """,
                    season, team_db_id, team.final_standing, league_id,
                )
                saved += 1

        return saved

    @staticmethod
    async def _save_lineup(conn, season, week, team_db_id, lineup, league_id: int = DEFAULT_LEAGUE_ID):
        await conn.execute(
            "DELETE FROM rosters WHERE season = $1 AND week = $2 AND team_id = $3",
            season, week, team_db_id,
        )
        for player in lineup:
            await conn.execute(
                """
                INSERT INTO rosters
                    (season, week, team_id, player_name, position, lineup_slot, points_scored,
                     points_projected, espn_player_id, pro_team, league_id)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                """,
                season, week, team_db_id, player.name, player.position,
                player.slot_position,
                Decimal(str(round(player.points, 2))), Decimal(str(round(player.projected_points, 2))),
                player.playerId, player.proTeam, league_id,
            )
            # Harvest this same real, per-week ESPN projection into
            # player_weekly_projections, matched via this app's real
            # players.espn_player_id crosswalk — completely independent
            # of the legacy `rosters` row above (which is ESPN's own,
            # disconnected league's roster/team). A player with no
            # crosswalk match (never drafted in this app) is a no-op —
            # this table only needs to hold projections for players
            # this app actually knows about. Best-effort per player, not
            # per whole sync: one unmatched player never blocks the rest.
            await conn.execute(
                """
                INSERT INTO player_weekly_projections (season, week, sleeper_player_id, projected_points)
                SELECT $1, $2, p.sleeper_player_id, $3
                FROM players p WHERE p.espn_player_id = $4
                ON CONFLICT (season, week, sleeper_player_id)
                DO UPDATE SET projected_points = EXCLUDED.projected_points, synced_at = now()
                """,
                season, week, Decimal(str(round(player.projected_points, 2))), player.playerId,
            )
