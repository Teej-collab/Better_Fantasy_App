"""
Every source's stats -> one projected stat line in this app's scoring
categories (the keys league_scoring_rules uses).

A line also carries a few volume keys starting with "_" that no rule
scores but the simulation needs to shape the game: "_tgt" (targets) and
"_pass_att" (pass attempts). D/ST lines carry "_pts_allow" and
"_yds_allow" means instead of tier counts — the tiers are odds, which
distribution.py works out.

Sleeper's keys were read off its public stats/projections feeds; ESPN's
numeric stat ids were matched against real box scores (Mahomes and
McCaffrey, 2026 weeks 7–8, both feeds side by side).
"""

SLEEPER_TO_CATEGORY: dict[str, str] = {
    "pass_att": "_pass_att", "pass_cmp": "pass_cmp", "pass_yd": "pass_yd", "pass_td": "pass_td",
    "pass_td_40p": "pass_td_40", "pass_int": "pass_int", "pass_2pt": "two_pt_pass",
    "rush_att": "rush_att", "rush_yd": "rush_yd", "rush_td": "rush_td", "rush_td_40p": "rush_td_40",
    "rush_2pt": "two_pt_rush",
    "rec_tgt": "_tgt", "rec": "rec", "rec_yd": "rec_yd", "rec_td": "rec_td", "rec_td_40p": "rec_td_40",
    "rec_2pt": "two_pt_rec",
    "fum_lost": "fum_lost", "kr_td": "ret_td", "pr_td": "ret_td",
    "xpm": "xp_made", "fgm_yds": "fg_yds",
    "fgm_0_19": "fg_made_0_39", "fgm_20_29": "fg_made_0_39", "fgm_30_39": "fg_made_0_39",
    "fgm_40_49": "fg_made_40_49", "fgm_50p": "fg_made_50_plus",
    "fgmiss_0_19": "fg_miss_0_29", "fgmiss_20_29": "fg_miss_0_29", "fgmiss_30_39": "fg_miss_30_39",
    "fgmiss_40_49": "fg_miss_40_49", "fgmiss_50p": "fg_miss_50_plus",
}
SLEEPER_DEF_TO_CATEGORY: dict[str, str] = {
    "sack": "def_sack", "int": "def_int", "fum_rec": "def_fum_rec", "safe": "def_safety",
    "blk_kick": "def_block", "def_td": "def_return_td", "def_st_td": "def_return_td",
    "pts_allow": "_pts_allow", "yds_allow": "_yds_allow",
}

ESPN_TO_CATEGORY: dict[int, str] = {
    0: "_pass_att", 1: "pass_cmp", 3: "pass_yd", 4: "pass_td", 15: "pass_td_40", 19: "two_pt_pass", 20: "pass_int",
    23: "rush_att", 24: "rush_yd", 25: "rush_td", 26: "two_pt_rush", 35: "rush_td_40",
    42: "rec_yd", 43: "rec_td", 44: "two_pt_rec", 45: "rec_td_40", 53: "rec", 58: "_tgt",
    72: "fum_lost",
    # ESPN splits kicks at 40 and 50; its under-40 misses land in this
    # app's 30–39 bucket (most misses that short are 30+).
    74: "fg_made_50_plus", 77: "fg_made_40_49", 80: "fg_made_0_39",
    76: "fg_miss_50_plus", 79: "fg_miss_40_49", 82: "fg_miss_30_39", 86: "xp_made",
}
ESPN_DEF_TO_CATEGORY: dict[int, str] = {
    99: "def_sack", 95: "def_int", 96: "def_fum_rec", 97: "def_block", 98: "def_safety",
    # 94 = interception + fumble return TDs, 93 = blocked kick return
    # TDs, 101/102 = kick/punt return TDs: all one category here.
    94: "def_return_td", 93: "def_return_td", 101: "def_return_td", 102: "def_return_td",
    120: "_pts_allow", 127: "_yds_allow",
}

# A made FG's typical distance per bucket, for leagues that score per
# FG yard when a source gives only bucket counts.
FG_BUCKET_YARDS = {"fg_made_0_39": 31.0, "fg_made_40_49": 44.5, "fg_made_50_plus": 53.0}


def _add(line: dict[str, float], key: str, value) -> None:
    if value:
        line[key] = line.get(key, 0.0) + float(value)


def _fill_fg_yards(line: dict[str, float]) -> None:
    if "fg_yds" not in line:
        yards = sum(line.get(k, 0.0) * d for k, d in FG_BUCKET_YARDS.items())
        if yards:
            line["fg_yds"] = yards


def from_sleeper(stats: dict, position: str) -> dict[str, float]:
    line: dict[str, float] = {}
    mapping = SLEEPER_DEF_TO_CATEGORY if position == "DEF" else SLEEPER_TO_CATEGORY
    for key, category in mapping.items():
        _add(line, category, stats.get(key))
    if position == "K":
        _fill_fg_yards(line)
    return line


def from_espn(stats: dict, position: str) -> dict[str, float]:
    line: dict[str, float] = {}
    mapping = ESPN_DEF_TO_CATEGORY if position == "DEF" else ESPN_TO_CATEGORY
    for key, value in stats.items():
        category = mapping.get(int(key))
        if category:
            _add(line, category, value)
    if position == "K":
        _fill_fg_yards(line)
    return line
