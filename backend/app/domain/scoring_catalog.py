"""
Every stat a league can score, for the commissioner's scoring editor
(2026-10): grouped the way the editor tabs them, with the plain-English
label the editor shows and whether we actually record it.

`tracked` is the honest part. A stat we don't record yet can still
carry a value in league_scoring_rules (League #1 has had 2-point
conversion rules from day one), but it never earns anything until a
stat source exists, so the editor marks it "not tracked yet" rather
than pretending. See SCORING_ENGINE_SOURCE.md's known gaps, and the
rule to wait for a real occurrence before building a rare-event stat.

`idp`: only means something in a league with IDP roster slots.
"""

GROUPS = ("passing", "rushing", "receiving", "kicking", "dst", "defenders", "bonuses", "other")
GROUP_LABELS = {
    "passing": "Passing",
    "rushing": "Rushing",
    "receiving": "Receiving",
    "kicking": "Kicking",
    "dst": "D/ST",
    "defenders": "Defenders",
    "bonuses": "Bonuses",
    "other": "Other",
}

# (key, group, label, unit hint, tracked, idp)
_STATS: tuple[tuple[str, str, str, str, bool, bool], ...] = (
    ("pass_yd", "passing", "Passing yards", "per yard", True, False),
    ("pass_td", "passing", "Passing TD", "per touchdown", True, False),
    ("pass_int", "passing", "Interception thrown", "per interception", True, False),
    ("pass_cmp", "passing", "Completion", "per completion", True, False),
    ("qb_tackle", "passing", "QB tackle", "any tackle by a QB", True, False),
    ("two_pt_pass", "passing", "2-point conversion pass", "per conversion", True, False),

    ("rush_yd", "rushing", "Rushing yards", "per yard", True, False),
    ("rush_td", "rushing", "Rushing TD", "per touchdown", True, False),
    ("rush_att", "rushing", "Carry", "per rushing attempt", True, False),
    ("two_pt_rush", "rushing", "2-point conversion run", "per conversion", True, False),

    ("rec", "receiving", "Reception", "per catch (PPR)", True, False),
    ("te_rec", "receiving", "TE premium", "extra per catch by a TE", True, False),
    ("rec_yd", "receiving", "Receiving yards", "per yard", True, False),
    ("rec_td", "receiving", "Receiving TD", "per touchdown", True, False),
    ("two_pt_rec", "receiving", "2-point conversion catch", "per conversion", True, False),

    ("fg_yds", "kicking", "FG made, per yard", "per yard of each made kick", True, False),
    ("fg_made_0_39", "kicking", "FG made, 0–39 yds", "per field goal", True, False),
    ("fg_made_40_49", "kicking", "FG made, 40–49 yds", "per field goal", True, False),
    ("fg_made_50_plus", "kicking", "FG made, 50+ yds", "per field goal", True, False),
    ("fg_miss_0_29", "kicking", "FG missed, 0–29 yds", "per miss or block", True, False),
    ("fg_miss_30_39", "kicking", "FG missed, 30–39 yds", "per miss or block", True, False),
    ("fg_miss_40_49", "kicking", "FG missed, 40–49 yds", "per miss or block", True, False),
    ("fg_miss_50_plus", "kicking", "FG missed, 50+ yds", "per miss or block", True, False),
    ("xp_made", "kicking", "Extra point made", "per kick", True, False),
    ("k_tackle", "kicking", "Kicker tackle", "any tackle by a K", True, False),

    ("def_sack", "dst", "Sack", "per sack", True, False),
    ("def_int", "dst", "Interception", "per interception", True, False),
    ("def_fum_rec", "dst", "Fumble recovery", "per recovery", True, False),
    ("def_return_td", "dst", "Defensive or return TD", "per touchdown", True, False),
    ("def_block", "dst", "Blocked kick", "per block", True, False),
    ("def_safety", "dst", "Safety", "per safety", True, False),
    ("two_pt_return", "dst", "2-point return", "a blocked kick or failed try run back for 2", True, False),
    ("pts_allow_0", "dst", "0 points allowed", "per game", True, False),
    ("pts_allow_1_6", "dst", "1–6 points allowed", "per game", True, False),
    ("pts_allow_7_13", "dst", "7–13 points allowed", "per game", True, False),
    ("pts_allow_14_17", "dst", "14–17 points allowed", "per game", True, False),
    ("pts_allow_18_27", "dst", "18–27 points allowed", "per game", True, False),
    ("pts_allow_28_34", "dst", "28–34 points allowed", "per game", True, False),
    ("pts_allow_35_45", "dst", "35–45 points allowed", "per game", True, False),
    ("pts_allow_46_plus", "dst", "46+ points allowed", "per game", True, False),
    ("yds_allow_lt100", "dst", "Under 100 yards allowed", "per game", True, False),
    ("yds_allow_100_199", "dst", "100–199 yards allowed", "per game", True, False),
    ("yds_allow_200_299", "dst", "200–299 yards allowed", "per game", True, False),
    ("yds_allow_300_349", "dst", "300–349 yards allowed", "per game", True, False),
    ("yds_allow_350_399", "dst", "350–399 yards allowed", "per game", True, False),
    ("yds_allow_400_449", "dst", "400–449 yards allowed", "per game", True, False),
    ("yds_allow_450_499", "dst", "450–499 yards allowed", "per game", True, False),
    ("yds_allow_500_549", "dst", "500–549 yards allowed", "per game", True, False),
    ("yds_allow_550_plus", "dst", "550+ yards allowed", "per game", True, False),

    ("idp_tackle", "defenders", "Tackle", "per tackle by a DL, LB or DB", True, True),
    ("idp_sack", "defenders", "Sack", "per sack", True, True),
    ("idp_int", "defenders", "Interception", "per interception", True, True),
    ("idp_pass_def", "defenders", "Pass defended", "per pass broken up", True, True),
    ("idp_tfl", "defenders", "Tackle for loss", "per tackle for loss", True, True),
    ("idp_qb_hit", "defenders", "QB hit", "per hit", True, True),
    ("idp_td", "defenders", "Defensive TD", "per touchdown", True, True),

    ("bonus_pass_300", "bonuses", "300+ passing yards", "once per game", True, False),
    ("bonus_pass_400", "bonuses", "400+ passing yards", "once per game, on top of 300+", True, False),
    ("bonus_rush_100", "bonuses", "100+ rushing yards", "once per game", True, False),
    ("bonus_rush_200", "bonuses", "200+ rushing yards", "once per game, on top of 100+", True, False),
    ("bonus_rec_100", "bonuses", "100+ receiving yards", "once per game", True, False),
    ("bonus_rec_200", "bonuses", "200+ receiving yards", "once per game, on top of 100+", True, False),
    ("pass_td_40", "bonuses", "40+ yard TD pass", "extra per touchdown", True, False),
    ("rush_td_40", "bonuses", "40+ yard TD run", "extra per touchdown", True, False),
    ("rec_td_40", "bonuses", "40+ yard TD catch", "extra per touchdown", True, False),

    ("fum_lost", "other", "Fumble lost", "per fumble", True, False),
    ("ret_td", "other", "Kick or punt return TD", "per touchdown, to the returner", True, False),
    ("safety_1pt", "other", "1-point safety", "a safety during an extra-point or 2-point try (very rare)", False, False),
)

# What a league created in the app starts with (2026-10-28): ESPN's
# standard PPR scoring. New leagues used to copy League #1's own house
# rules (15 points for a QB tackle, FGs by the yard, harsh miss
# penalties), so a brand-new league inherited another league's quirks.
# A commissioner changes any of it in the scoring editor; a league
# brought in from ESPN or Sleeper takes that platform's real rules.
STANDARD_RULES: dict[str, float] = {
    "pass_yd": 0.04, "pass_td": 4, "pass_int": -2, "two_pt_pass": 2,
    "rush_yd": 0.1, "rush_td": 6, "two_pt_rush": 2,
    "rec": 1, "rec_yd": 0.1, "rec_td": 6, "two_pt_rec": 2,
    "fg_made_0_39": 3, "fg_made_40_49": 4, "fg_made_50_plus": 5,
    "fg_miss_0_29": -1, "fg_miss_30_39": -1, "fg_miss_40_49": -1, "fg_miss_50_plus": -1,
    "xp_made": 1,
    "def_sack": 1, "def_int": 2, "def_fum_rec": 2, "def_return_td": 6, "def_block": 2, "def_safety": 2,
    "two_pt_return": 2,
    "pts_allow_0": 5, "pts_allow_1_6": 4, "pts_allow_7_13": 3, "pts_allow_14_17": 1,
    "pts_allow_18_27": 0, "pts_allow_28_34": -1, "pts_allow_35_45": -3, "pts_allow_46_plus": -5,
    "yds_allow_lt100": 5, "yds_allow_100_199": 3, "yds_allow_200_299": 2, "yds_allow_300_349": 0,
    "yds_allow_350_399": -1, "yds_allow_400_449": -3, "yds_allow_450_499": -5,
    "yds_allow_500_549": -6, "yds_allow_550_plus": -7,
    "fum_lost": -2, "ret_td": 6,
}

CATALOG: dict[str, dict] = {
    key: {"key": key, "group": group, "label": label, "hint": hint, "tracked": tracked, "idp": idp}
    for key, group, label, hint, tracked, idp in _STATS
}


def catalog_with_rules(rules: dict[str, float]) -> list[dict]:
    """The editor's view: every stat in catalog order, with this
    league's value (None when the league doesn't score it) and whether
    it's on (a non-zero value). A rule for a stat outside the catalog
    still shows, under Other, so nothing a league scores is hidden."""
    out = [{**entry, "value": rules.get(key)} for key, entry in CATALOG.items()]
    for key, value in rules.items():
        if key not in CATALOG:
            out.append({"key": key, "group": "other", "label": key, "hint": "", "tracked": True, "idp": False, "value": value})
    return out
