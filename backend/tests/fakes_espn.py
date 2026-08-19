"""
Lightweight stand-ins for espn_api's League/Team/BoxScore objects, used to
test ESPNProvider without real ESPN credentials or network access. Shaped
to match only the attributes app/providers/espn/adapter.py actually reads.
"""
from types import SimpleNamespace


def make_fake_team(team_id, name, owner_member_id, first, last, final_standing=0):
    return SimpleNamespace(
        team_id=team_id,
        team_name=name,
        owners=[{"id": owner_member_id, "firstName": first, "lastName": last}],
        final_standing=final_standing,  # 0 = season still in progress, matches real ESPN behavior
    )


def make_fake_matchup(home_team_id, away_team_id, home_score, away_score):
    return SimpleNamespace(
        home_team=SimpleNamespace(team_id=home_team_id),
        away_team=SimpleNamespace(team_id=away_team_id) if away_team_id != 0 else 0,
        home_score=home_score,
        away_score=away_score,
    )


def make_fake_player(name, position, slot, points, projected):
    return SimpleNamespace(
        name=name, position=position, slot_position=slot,
        points=points, projected_points=projected,
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
                 scoreboard_by_week=None, box_scores_by_week=None, current_week=1):
        self.teams = teams or []
        self.settings = SimpleNamespace(reg_season_count=reg_season_count)
        self._scoreboard_by_week = scoreboard_by_week or {}
        self._box_scores_by_week = box_scores_by_week or {}
        self.current_week = current_week

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
