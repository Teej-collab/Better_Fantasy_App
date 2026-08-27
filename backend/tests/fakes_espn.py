"""
Lightweight stand-ins for espn_api's League/Team/BoxScore objects, used to
test ESPNProvider without real ESPN credentials or network access. Shaped
to match only the attributes app/providers/espn/adapter.py actually reads.
"""
from types import SimpleNamespace


def make_fake_team(team_id, name, owner_member_id, first, last, final_standing=0, roster=None):
    return SimpleNamespace(
        team_id=team_id,
        team_name=name,
        owners=[{"id": owner_member_id, "firstName": first, "lastName": last}],
        final_standing=final_standing,  # 0 = season still in progress, matches real ESPN behavior
        roster=roster or [],
    )


def make_fake_lineup_player(
    player_id, name, lineup_slot, eligible_slots, pro_team="KC", injury_status="ACTIVE", schedule=None, stats=None
):
    """Stands in for espn_api.football.Player as used by
    app/providers/espn/lineup_client.py. `lineup_slot` and
    `eligible_slots` are espn_api's own label strings (e.g. "BE",
    "RB/WR/TE"), matching what Player.lineupSlot/eligibleSlots actually
    hold — NOT raw slot IDs, since that's the real (asymmetric)
    POSITION_MAP shape the client has to work with. `stats` mirrors the
    real Player.stats shape: {week: {"points": ..., "projected_points": ...}}."""
    return SimpleNamespace(
        playerId=player_id,
        name=name,
        lineupSlot=lineup_slot,
        eligibleSlots=eligible_slots,
        proTeam=pro_team,
        injuryStatus=injury_status,
        schedule=schedule or {},
        stats=stats or {},
    )


def make_fake_matchup(home_team_id, away_team_id, home_score, away_score):
    return SimpleNamespace(
        home_team=SimpleNamespace(team_id=home_team_id),
        away_team=SimpleNamespace(team_id=away_team_id) if away_team_id != 0 else 0,
        home_score=home_score,
        away_score=away_score,
    )


def make_fake_player(name, position, slot, points, projected, player_id=1, pro_team="KC"):
    return SimpleNamespace(
        name=name, position=position, slot_position=slot,
        points=points, projected_points=projected,
        playerId=player_id, proTeam=pro_team,
    )


def make_fake_free_agent(
    player_id, name, position, pro_team="KC", injury_status="ACTIVE",
    percent_owned=0.0, percent_started=0.0, points=0.0, projected_points=0.0,
):
    """Stands in for the BoxPlayer objects League.free_agents() returns
    (app/providers/espn/free_agents.py) — flat points/projected_points
    attributes, unlike plain Player (see make_fake_lineup_player's note
    on why roster players carry a nested .stats dict instead)."""
    return SimpleNamespace(
        playerId=player_id, name=name, position=position, proTeam=pro_team,
        injuryStatus=injury_status, percent_owned=percent_owned, percent_started=percent_started,
        points=points, projected_points=projected_points,
    )


def make_fake_player_card_player(
    espn_player_id, projected_total_points=0.0, projected_avg_points=0.0,
    percent_owned=0.0, percent_started=0.0, schedule=None,
):
    """Stands in for the Player object League.player_info() returns
    (app/providers/espn/player_info.py). `schedule` mirrors a real live
    call's actual shape: STRING week keys ("1", "2", ...), a missing key
    for the bye week — see that module's docstring for why the string
    typing matters."""
    return SimpleNamespace(
        playerId=espn_player_id,
        projected_total_points=projected_total_points,
        projected_avg_points=projected_avg_points,
        percent_owned=percent_owned,
        percent_started=percent_started,
        schedule=schedule or {},
    )


def make_fake_box_score(home_team_id, away_team_id, home_lineup, away_lineup):
    return SimpleNamespace(
        home_team=SimpleNamespace(team_id=home_team_id),
        away_team=SimpleNamespace(team_id=away_team_id) if away_team_id != 0 else 0,
        home_lineup=home_lineup,
        away_lineup=away_lineup,
    )


class FakeLeague:
    """Stands in for espn_api.football.League. scoreboard()/box_scores()
    raise once `week` runs past what's configured, mirroring how the real
    League behaves for weeks that don't exist yet — the adapter relies on
    that to know when to stop."""

    def __init__(self, teams=None, reg_season_count=13,
                 scoreboard_by_week=None, box_scores_by_week=None, current_week=1,
                 position_slot_counts=None, free_agent_players=None, faab=False, acquisition_budget=100,
                 player_info_by_id=None):
        self.teams = teams or []
        self.settings = SimpleNamespace(
            reg_season_count=reg_season_count,
            position_slot_counts=position_slot_counts or {},
            faab=faab,
            acquisition_budget=acquisition_budget,
        )
        self._scoreboard_by_week = scoreboard_by_week or {}
        self._box_scores_by_week = box_scores_by_week or {}
        self.current_week = current_week
        self._free_agent_players = free_agent_players or []
        self._player_info_by_id = player_info_by_id or {}

    def free_agents(self, week=None, size=50, position=None, position_id=None):
        players = self._free_agent_players
        if position:
            players = [p for p in players if p.position == position]
        return players[:size]

    def player_info(self, name=None, playerId=None):
        return self._player_info_by_id.get(playerId)

    def scoreboard(self, week):
        if week not in self._scoreboard_by_week:
            raise Exception(f"no data for week {week}")
        return self._scoreboard_by_week[week]

    def box_scores(self, week):
        if week not in self._box_scores_by_week:
            raise Exception(f"no data for week {week}")
        return self._box_scores_by_week[week]

    def standings(self):
        # Mirrors the real League.standings(): sorted by final_standing
        # (falling back to a team's regular `standing` if final is 0).
        return sorted(self.teams, key=lambda t: t.final_standing or getattr(t, "standing", 0))
