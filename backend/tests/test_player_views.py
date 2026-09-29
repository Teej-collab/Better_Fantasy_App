"""Sleeper stat -> league scoring conversion behind the stats Views
(app/domain/player_views.py). Pure — no DB or network."""
from app.domain.player_views import _rank_within_position, _stat_values, league_points, league_stat_line

RULES = {
    "pass_yd": 0.04, "pass_td": 4, "pass_int": -2, "rush_yd": 0.1, "rush_td": 6, "rec": 1, "rec_yd": 0.1,
    "rec_td": 6, "fum_lost": -2, "xp_made": 1, "fg_yds": 0.1, "fg_miss_0_29": -5, "fg_miss_40_49": -1,
    "def_sack": 1, "def_int": 2, "def_fum_rec": 2, "pts_allow_18_27": 0, "pts_allow_7_13": 3,
    "yds_allow_300_349": 0, "yds_allow_200_299": 2,
}


def test_offense_maps_straight_across():
    stats = {"rec": 6, "rec_yd": 80, "rec_td": 1, "rush_yd": 10, "fum_lost": 1}
    assert league_points(stats, "WR", RULES) == 6 + 8 + 6 + 1 - 2


def test_kicker_uses_fg_yards_and_miss_tiers():
    stats = {"fgm_yds": 120, "xpm": 3, "fgmiss_20_29": 1, "fgmiss_40_49": 1}
    assert league_stat_line(stats, "K") == {"fg_yds": 120, "xp_made": 3, "fg_miss_0_29": 1, "fg_miss_40_49": 1}


def test_defense_tiers_apply_to_the_per_game_average():
    # 3 games, 60 points allowed (20/game -> 18-27 tier), 750 yards (250/game -> 200-299 tier).
    stats = {"gp": 3, "sack": 9, "int": 2, "pts_allow": 60, "yds_allow": 750}
    line = league_stat_line(stats, "DEF")
    assert line["pts_allow_18_27"] == 3
    assert line["yds_allow_200_299"] == 3
    assert league_points(stats, "DEF", RULES) == 9 + 4 + 0 + 6


def test_missing_stats_score_nothing():
    assert league_points({}, "QB", RULES) is None


def test_projection_ratio_without_attempts():
    assert _stat_values({"xpm": 45})["xp"] == "45"
    assert _stat_values({"pass_cmp": 20, "pass_att": 31})["pass_ca"] == "20/31"


def test_rank_within_position_ignores_missing_values():
    ranks = _rank_within_position({"a": ("QB", 20.0), "b": ("QB", 25.0), "c": ("RB", 5.0), "d": ("QB", None)})
    assert ranks == {"b": 1, "a": 2, "c": 1}


def test_projected_field_goals_sum_the_distance_buckets():
    # Sleeper's season projections carry no fgm total, only buckets.
    assert _stat_values({"fgm_30_39": 9, "fgm_40_49": 8, "fgm_50p": 4, "xpm": 42})["fg"] == "21"
    assert _stat_values({"fgm": 27, "fga": 34})["fg"] == "27/34"
