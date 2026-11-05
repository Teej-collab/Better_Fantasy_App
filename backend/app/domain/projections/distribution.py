"""
A projected stat line is an average, and averages can't price a
threshold: a back projected for 85 rushing yards earns none of a
100-yard bonus "on average", yet clears 100 about a third of the time.
So each line's game is simulated SIMS times and this returns:

  - probs: the chance of every threshold category a league can score —
    the game bonuses (stat_derivations.GAME_BONUSES) and, for a D/ST,
    each points-allowed and yards-allowed tier. scoring.py prices a
    league's threshold rules with these, and its per-unit rules with
    the averages, which is exact for any mix of the two;
  - floor_ratio / ceiling_ratio: the 10th/90th percentile game over the
    average, under one fixed half-PPR scoring. A league's floor is its
    own projection times the ratio. (A D/ST's points sit near zero, so
    it keeps the spread as points instead: probs "_floor_delta" and
    "_ceiling_delta".)

The game model, per simulation: one volume draw shared by every stat
(a game script that feeds a player more targets also feeds him more
yards and TDs), then targets and carries as Poisson counts, catches as
a binomial off targets, yards as per-play gains summed (normal), TDs as
Poisson counts that grow with the volume. Calibrated to land near real
week-to-week spreads (a 250-yard passer's SD is about 60 yards, a 80-
yard back's about 40). Pure Python, seeded per player so a re-run gives
the same numbers.
"""
import math
import random

from app.domain.roster_slots import fantasy_position
from app.domain.stat_derivations import GAME_BONUSES
from app.providers.nfl_stats.espn_public import _POINTS_ALLOWED_TIERS, _YARDS_ALLOWED_TIERS, _tier_category

SIMS = 1500

# Spread of the shared volume draw (lognormal sigma) — a starting QB's
# dropbacks swing less than a skill player's touches.
_VOLUME_SIGMA = {"QB": 0.15, "RB": 0.28, "WR": 0.25, "TE": 0.28}
_PTS_ALLOW_SD = 9.5
_YDS_ALLOW_SD = 62.0

# The fixed scoring the floor/ceiling ratios are measured under.
CANONICAL_RULES: dict[str, float] = {
    "pass_yd": 0.04, "pass_td": 4, "pass_int": -2, "rush_yd": 0.1, "rush_td": 6,
    "rec": 0.5, "rec_yd": 0.1, "rec_td": 6, "fum_lost": -2,
    "two_pt_pass": 2, "two_pt_rush": 2, "two_pt_rec": 2, "ret_td": 6,
    "fg_made_0_39": 3, "fg_made_40_49": 4, "fg_made_50_plus": 5, "xp_made": 1,
    "fg_miss_0_29": -1, "fg_miss_30_39": -1, "fg_miss_40_49": -1, "fg_miss_50_plus": -1,
    "def_sack": 1, "def_int": 2, "def_fum_rec": 2, "def_return_td": 6, "def_safety": 2, "def_block": 2,
    "pts_allow_0": 5, "pts_allow_1_6": 4, "pts_allow_7_13": 3, "pts_allow_14_17": 1, "pts_allow_18_27": 0,
    "pts_allow_28_34": -1, "pts_allow_35_45": -3, "pts_allow_46_plus": -5,
    "yds_allow_lt100": 5, "yds_allow_100_199": 3, "yds_allow_200_299": 2, "yds_allow_300_349": 0,
    "yds_allow_350_399": -1, "yds_allow_400_449": -3, "yds_allow_450_499": -5, "yds_allow_500_549": -6,
    "yds_allow_550_plus": -7,
}

_TD_KEYS = ("pass_td", "rush_td", "rec_td", "two_pt_pass", "two_pt_rush", "two_pt_rec", "ret_td")
_MINOR_KEYS = ("pass_int", "fum_lost", "pass_td_40", "rush_td_40", "rec_td_40")
_KICK_KEYS = ("fg_made_0_39", "fg_made_40_49", "fg_made_50_plus", "xp_made",
              "fg_miss_0_29", "fg_miss_30_39", "fg_miss_40_49", "fg_miss_50_plus")
_DEF_COUNT_KEYS = ("def_sack", "def_int", "def_fum_rec", "def_return_td", "def_safety", "def_block")


def _poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    if lam > 30:
        return max(0, round(rng.gauss(lam, math.sqrt(lam))))
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def _percentile(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(q * (len(ordered) - 1))))]


def _canonical(stats: dict[str, float]) -> float:
    return sum(CANONICAL_RULES.get(k, 0.0) * v for k, v in stats.items())


def _sim_offense(rng: random.Random, line: dict[str, float], group: str) -> dict[str, float]:
    sigma = _VOLUME_SIGMA.get(group, 0.25)
    volume = rng.lognormvariate(-sigma * sigma / 2, sigma)
    out: dict[str, float] = {}

    rec = line.get("rec", 0.0)
    targets = line.get("_tgt") or (rec / 0.65 if rec else 0.0)
    if targets > 0:
        catch = min(0.95, rec / targets) if rec else 0.0
        per_catch = line.get("rec_yd", 0.0) / rec if rec else 0.0
        n_targets = _poisson(rng, targets * volume)
        catches = rng.binomialvariate(n_targets, catch) if n_targets and catch > 0 else 0
        out["rec"] = catches
        out["rec_yd"] = rng.gauss(catches * per_catch, math.sqrt(catches) * per_catch * 0.95) if catches else 0.0

    carries_mean = line.get("rush_att", 0.0)
    if carries_mean > 0:
        per_carry = line.get("rush_yd", 0.0) / carries_mean
        carries = _poisson(rng, carries_mean * volume)
        out["rush_att"] = carries
        spread = max(4.0, 1.25 * abs(per_carry))
        out["rush_yd"] = rng.gauss(carries * per_carry, math.sqrt(carries) * spread) if carries else 0.0
    elif line.get("rush_yd"):
        out["rush_yd"] = line["rush_yd"]

    cmp_mean = line.get("pass_cmp", 0.0)
    if cmp_mean > 0:
        attempts_mean = line.get("_pass_att") or cmp_mean / 0.64
        rate = min(0.9, cmp_mean / attempts_mean)
        per_cmp = line.get("pass_yd", 0.0) / cmp_mean
        attempts = max(0, round(rng.gauss(attempts_mean * volume, 3.5)))
        completions = rng.binomialvariate(attempts, rate) if attempts else 0
        out["pass_cmp"] = completions
        out["pass_yd"] = rng.gauss(completions * per_cmp, math.sqrt(completions) * 7.0) if completions else 0.0

    td_scale = volume ** 0.7
    for key in _TD_KEYS:
        if line.get(key):
            out[key] = _poisson(rng, line[key] * td_scale)
    for key in _MINOR_KEYS:
        if line.get(key):
            out[key] = _poisson(rng, line[key])
    return out


def _sim_kicker(rng: random.Random, line: dict[str, float]) -> dict[str, float]:
    return {key: _poisson(rng, line[key]) for key in _KICK_KEYS if line.get(key)}


def _sim_defense(rng: random.Random, line: dict[str, float]) -> tuple[dict[str, float], str, str]:
    out = {key: _poisson(rng, line[key]) for key in _DEF_COUNT_KEYS if line.get(key)}
    points = max(0, round(rng.gauss(line.get("_pts_allow", 22.0), _PTS_ALLOW_SD)))
    yards = max(0, round(rng.gauss(line.get("_yds_allow", 330.0), _YDS_ALLOW_SD)))
    pts_tier = _tier_category(points, _POINTS_ALLOWED_TIERS)
    yds_tier = _tier_category(yards, _YARDS_ALLOWED_TIERS)
    out[pts_tier] = 1
    out[yds_tier] = 1
    return out, pts_tier, yds_tier


def simulate(line: dict[str, float], position: str, seed: str) -> dict:
    """{"probs": {category: chance}, "floor_ratio", "ceiling_ratio"}."""
    rng = random.Random(seed)
    group = "DEF" if position == "DEF" else fantasy_position(position)
    hits: dict[str, int] = {}
    canon: list[float] = []
    for _ in range(SIMS):
        if group == "DEF":
            stats, pts_tier, yds_tier = _sim_defense(rng, line)
            hits[pts_tier] = hits.get(pts_tier, 0) + 1
            hits[yds_tier] = hits.get(yds_tier, 0) + 1
        elif group == "K":
            stats = _sim_kicker(rng, line)
        else:
            stats = _sim_offense(rng, line, group or "")
            for stat, mark, category in GAME_BONUSES:
                if stats.get(stat, 0.0) >= mark:
                    hits[category] = hits.get(category, 0) + 1
        canon.append(_canonical(stats))

    probs = {category: round(n / SIMS, 4) for category, n in hits.items()}
    mean = sum(canon) / SIMS
    low, high = _percentile(canon, 0.10), _percentile(canon, 0.90)
    if group == "DEF":
        probs["_floor_delta"] = round(low - mean, 2)
        probs["_ceiling_delta"] = round(high - mean, 2)
        return {"probs": probs, "floor_ratio": None, "ceiling_ratio": None}
    if mean < 0.5:
        return {"probs": probs, "floor_ratio": 0.0, "ceiling_ratio": None}
    return {"probs": probs, "floor_ratio": round(max(0.0, low) / mean, 3), "ceiling_ratio": round(high / mean, 3)}
