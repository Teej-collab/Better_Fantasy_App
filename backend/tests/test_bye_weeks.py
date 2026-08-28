from app.domain import bye_weeks
from tests.conftest import TEST_SEASON


def _fake_week_scoreboard(teams_by_week: dict[int, list[str]]):
    """teams_by_week: {week: [team_abbr, ...]} — paired up two at a time
    into fake home/away games, matching get_week_scoreboard's real
    per-game shape closely enough for compute_bye_weeks (which only
    reads home_team/away_team)."""

    async def fake(week: int, year: int, season_type=None):
        teams = teams_by_week.get(week, [])
        games = []
        for i in range(0, len(teams) - 1, 2):
            games.append({"home_team": teams[i], "away_team": teams[i + 1]})
        return games

    return fake


async def test_compute_bye_weeks_finds_the_one_missing_week(monkeypatch):
    # KC misses week 2 (a real bye) — absent from that week's team list
    # entirely, present every other week in this fixture.
    teams_by_week = {
        1: ["KC", "SF", "BUF", "MIA"],
        2: ["SF", "MIA", "BUF", "NYJ"],
        3: ["KC", "BUF", "SF", "MIA"],
    }
    monkeypatch.setattr(bye_weeks, "get_week_scoreboard", _fake_week_scoreboard(teams_by_week))
    monkeypatch.setattr(bye_weeks, "REGULAR_SEASON_WEEKS", 3)

    result = await bye_weeks.compute_bye_weeks(TEST_SEASON)

    assert result.get("KC") == 2


async def test_compute_bye_weeks_skips_teams_seen_every_week(monkeypatch):
    teams_by_week = {1: ["KC", "SF"], 2: ["KC", "SF"], 3: ["KC", "SF"]}
    monkeypatch.setattr(bye_weeks, "get_week_scoreboard", _fake_week_scoreboard(teams_by_week))
    monkeypatch.setattr(bye_weeks, "REGULAR_SEASON_WEEKS", 3)

    result = await bye_weeks.compute_bye_weeks(TEST_SEASON)

    assert "KC" not in result
    assert "SF" not in result


async def test_compute_bye_weeks_skips_teams_missing_more_than_one_week(monkeypatch):
    # A real data gap (partial scoreboard fetch failure), not a real
    # bye — don't guess which of the missing weeks is the actual bye.
    teams_by_week = {1: ["KC", "SF"], 2: ["SF", "BUF"], 3: ["SF", "BUF"]}
    monkeypatch.setattr(bye_weeks, "get_week_scoreboard", _fake_week_scoreboard(teams_by_week))
    monkeypatch.setattr(bye_weeks, "REGULAR_SEASON_WEEKS", 3)

    result = await bye_weeks.compute_bye_weeks(TEST_SEASON)

    assert "KC" not in result


async def test_sync_bye_weeks_upserts_into_team_bye_weeks(pool, monkeypatch):
    # "ZZZ" isn't a real NFL team (not in TEAM_NAMES) — a harmless
    # filler opponent for week 2 so KC's week-1 opponent (SF) can stay
    # present in both weeks without introducing a second real team
    # that would itself register a false one-week "bye".
    teams_by_week = {1: ["KC", "SF"], 2: ["ZZZ", "SF"]}
    monkeypatch.setattr(bye_weeks, "get_week_scoreboard", _fake_week_scoreboard(teams_by_week))
    monkeypatch.setattr(bye_weeks, "REGULAR_SEASON_WEEKS", 2)

    async with pool.acquire() as conn:
        count = await bye_weeks.sync_bye_weeks(conn, TEST_SEASON)
        row = await conn.fetchrow(
            "SELECT bye_week FROM team_bye_weeks WHERE season = $1 AND pro_team = 'KC'", TEST_SEASON
        )

    assert count == 1  # only KC has exactly one missing week in this fixture
    assert row["bye_week"] == 2


async def test_sync_bye_weeks_is_idempotent_on_rerun(pool, monkeypatch):
    teams_by_week = {1: ["KC", "SF"], 2: ["SF", "BUF"]}
    monkeypatch.setattr(bye_weeks, "get_week_scoreboard", _fake_week_scoreboard(teams_by_week))
    monkeypatch.setattr(bye_weeks, "REGULAR_SEASON_WEEKS", 2)

    async with pool.acquire() as conn:
        await bye_weeks.sync_bye_weeks(conn, TEST_SEASON)
        await bye_weeks.sync_bye_weeks(conn, TEST_SEASON)
        count = await conn.fetchval(
            "SELECT count(*) FROM team_bye_weeks WHERE season = $1 AND pro_team = 'KC'", TEST_SEASON
        )

    assert count == 1
