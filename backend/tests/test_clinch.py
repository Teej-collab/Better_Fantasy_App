"""Clinch marks (app/domain/clinch.py): a mark must never be wrong. The
random tests check every mark against brute force, playing out every
way the remaining games can go."""
import itertools
import random

from app.domain.clinch import ELIMINATED, PLAYOFFS, TOP_SEED, BYE, bye_count, clinch_marks


def _game(h, a, hs=None, as_=None):
    return {"home_team_id": h, "away_team_id": a, "home_score": hs or 0.0, "away_score": as_ or 0.0, "played": hs is not None}


def _truth(team_ids, schedule, spots, byes):
    """Brute force: each team's worst place (level teams counted ahead)
    and best place (level teams counted behind) over every outcome."""
    wins = {t: 0.0 for t in team_ids}
    remaining = []
    for g in schedule:
        if g["played"]:
            if g["home_score"] > g["away_score"]:
                wins[g["home_team_id"]] += 1
            else:
                wins[g["away_team_id"]] += 1
        else:
            remaining.append((g["home_team_id"], g["away_team_id"]))
    worst = {t: 0 for t in team_ids}
    best = {t: len(team_ids) for t in team_ids}
    for outcome in itertools.product((0, 1), repeat=len(remaining)):
        w = dict(wins)
        for (h, a), home_won in zip(remaining, outcome):
            w[h if home_won else a] += 1
        for t in team_ids:
            worst[t] = max(worst[t], 1 + sum(1 for o in team_ids if o != t and w[o] >= w[t]))
            best[t] = min(best[t], 1 + sum(1 for o in team_ids if o != t and w[o] > w[t]))
    marks = {}
    for t in team_ids:
        got = []
        if worst[t] <= spots:
            got.append(PLAYOFFS)
            if byes and worst[t] <= byes:
                got.append(BYE)
            if worst[t] == 1:
                got.append(TOP_SEED)
        elif best[t] > spots:
            got.append(ELIMINATED)
        if got:
            marks[t] = got
    return marks


def _random_league(rng, teams, weeks_played, weeks_left):
    ids = list(range(1, teams + 1))
    schedule = []
    for week in range(weeks_played + weeks_left):
        order = ids[:]
        rng.shuffle(order)
        for i in range(0, teams, 2):
            if week < weeks_played:
                hs, as_ = rng.uniform(60, 160), rng.uniform(60, 160)
                schedule.append(_game(order[i], order[i + 1], hs, as_))
            else:
                schedule.append(_game(order[i], order[i + 1]))
    return ids, schedule


def test_marks_match_brute_force_on_random_leagues():
    rng = random.Random(20261117)
    for _ in range(300):
        teams = rng.choice([4, 6, 8])
        spots = rng.choice([2, 3, 4]) if teams > 4 else 2
        played = rng.randint(2, 9)
        left = rng.randint(1, 3 if teams == 8 else 4)
        ids, schedule = _random_league(rng, teams, played, left)
        byes = bye_count(spots)
        assert clinch_marks(ids, schedule, spots, byes, by_points=False) == _truth(ids, schedule, spots, byes)


def test_a_leader_who_can_still_be_caught_has_the_spot_but_not_the_top_seed():
    ids = [1, 2, 3, 4]
    schedule = [_game(1, 2, 120, 90), _game(3, 4, 100, 99), _game(1, 3, 130, 80), _game(2, 4, 100, 90), _game(1, 4, 110, 70), _game(2, 3, 90, 95)]
    schedule += [_game(1, 2), _game(3, 4)]
    marks = clinch_marks(ids, schedule, spots=2, byes=0, by_points=False)
    # 3-0 v 2-1 with them still to play: 2 can draw level, so not the 1 seed yet.
    assert marks[1] == [PLAYOFFS]
    assert marks[4] == [ELIMINATED]


def test_nobody_is_marked_while_it_could_still_go_either_way():
    ids = [1, 2, 3, 4]
    schedule = [_game(1, 2, 120, 90), _game(3, 4, 100, 99)] + [_game(1, 3), _game(2, 4), _game(1, 4), _game(2, 3)]
    assert clinch_marks(ids, schedule, spots=2, byes=0, by_points=False) == {}


def test_a_points_league_waits_for_the_end():
    ids = [1, 2, 3, 4]
    schedule = [_game(1, 2, 200, 50), _game(3, 4, 60, 55), _game(1, 3)]
    assert clinch_marks(ids, schedule, spots=2, byes=0, by_points=True) == {}


def test_a_tie_this_season_waits_for_the_end():
    ids = [1, 2, 3, 4]
    schedule = [_game(1, 2, 100, 100), _game(3, 4, 120, 60), _game(1, 3, 150, 60), _game(2, 4, 150, 60), _game(1, 4), _game(2, 3)]
    assert clinch_marks(ids, schedule, spots=2, byes=0, by_points=False) == {}


def test_after_the_regular_season_the_order_decides():
    ids = [1, 2, 3, 4, 5, 6]
    schedule = [_game(1, 2, 130, 90), _game(3, 4, 100, 99), _game(5, 6, 120, 80), _game(1, 3, 110, 100), _game(2, 5, 95, 90), _game(4, 6, 101, 88)]
    marks = clinch_marks(ids, schedule, spots=3, byes=1, by_points=False)
    assert marks[1] == [PLAYOFFS, BYE, TOP_SEED]
    assert ELIMINATED in marks[6]


def test_byes_follow_the_bracket():
    assert bye_count(6) == 2
    assert bye_count(4) == 0
    assert bye_count(5) == 3
