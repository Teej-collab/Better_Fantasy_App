"""
Bringing a connected league's rules over from ESPN or Sleeper
(2026-10-24): scoring, roster slots, playoffs and waivers, translated
into this app's own settings so its points match the source in mirror
mode and nothing about how the league plays changes when it switches.

Each translator returns the settings plus `notes`: anything that could
only be matched approximately or not at all (a stat this app doesn't
score, a points-allowed band split differently), in plain words for the
commissioner's switch screen.

Sleeper names most stats the way this app does (app/domain/
scoring_catalog.py). ESPN's are numbered; espn_api's own
SETTINGS_SCORING_FORMAT_MAP gives each an abbreviation.
"""
import json

from app.domain.scoring_catalog import CATALOG

# ---- Lineup slots ------------------------------------------------------------

# Source slot name -> this app's slot label (app/domain/roster_slots.py).
SLEEPER_SLOTS = {
    "QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K", "DEF": "D/ST",
    "FLEX": "RB/WR/TE", "WRRB_FLEX": "RB/WR/TE", "REC_FLEX": "RB/WR/TE", "SUPER_FLEX": "QB/RB/WR/TE",
    "DL": "DL", "LB": "LB", "DB": "DB", "IDP_FLEX": "IDP", "BN": "BE", "IR": "IR", "TAXI": "TAXI",
}
ESPN_SLOTS = {
    "QB": "QB", "RB": "RB", "WR": "WR", "TE": "TE", "K": "K", "D/ST": "D/ST",
    "RB/WR/TE": "RB/WR/TE", "RB/WR": "RB/WR/TE", "WR/TE": "RB/WR/TE", "OP": "QB/RB/WR/TE",
    "DT": "DL", "DE": "DL", "DL": "DL", "LB": "LB", "CB": "DB", "S": "DB", "DB": "DB", "DP": "IDP",
    "BE": "BE", "IR": "IR",
}
_NARROW_FLEX = {"WRRB_FLEX": "RB/WR flex", "REC_FLEX": "WR/TE flex", "RB/WR": "RB/WR flex", "WR/TE": "WR/TE flex"}


def slot_label(platform: str, source_slot: str) -> str:
    table = SLEEPER_SLOTS if platform == "sleeper" else ESPN_SLOTS
    return table.get(source_slot, "BE")


def _roster_slots(platform: str, counts: dict[str, int], notes: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    table = SLEEPER_SLOTS if platform == "sleeper" else ESPN_SLOTS
    for slot, n in counts.items():
        if not n:
            continue
        label = table.get(slot)
        if label is None:
            notes.append(f"{slot} lineup spot ({n}) isn't used here; those players sit on the bench.")
            continue
        if slot in _NARROW_FLEX:
            notes.append(f"The {_NARROW_FLEX[slot]} becomes a regular RB/WR/TE flex here.")
        out[label] = out.get(label, 0) + n
    return out


# ---- Scoring ------------------------------------------------------------------

# Sleeper key -> this app's key, where the names differ.
_SLEEPER_RENAME = {
    "pass_2pt": "two_pt_pass", "rush_2pt": "two_pt_rush", "rec_2pt": "two_pt_rec", "bonus_rec_te": "te_rec",
    "xpm": "xp_made", "fgm_40_49": "fg_made_40_49", "fgm_50p": "fg_made_50_plus", "fgm_yds": "fg_yds",
    "fgmiss_30_39": "fg_miss_30_39", "fgmiss_40_49": "fg_miss_40_49", "fgmiss_50p": "fg_miss_50_plus",
    "sack": "def_sack", "int": "def_int", "fum_rec": "def_fum_rec", "def_td": "def_return_td",
    "blk_kick": "def_block", "safe": "def_safety", "def_2pt": "two_pt_return",
    "pts_allow_0": "pts_allow_0", "pts_allow_1_6": "pts_allow_1_6", "pts_allow_7_13": "pts_allow_7_13",
    "pts_allow_28_34": "pts_allow_28_34",
    "yds_allow_0_100": "yds_allow_lt100", "yds_allow_100_199": "yds_allow_100_199",
    "yds_allow_200_299": "yds_allow_200_299", "yds_allow_300_349": "yds_allow_300_349",
    "yds_allow_350_399": "yds_allow_350_399", "yds_allow_400_449": "yds_allow_400_449",
    "yds_allow_450_499": "yds_allow_450_499", "yds_allow_500_549": "yds_allow_500_549",
    "yds_allow_550p": "yds_allow_550_plus",
    "bonus_pass_yd_300": "bonus_pass_300", "bonus_pass_yd_400": "bonus_pass_400",
    "bonus_rush_yd_100": "bonus_rush_100", "bonus_rush_yd_200": "bonus_rush_200",
    "bonus_rec_yd_100": "bonus_rec_100", "bonus_rec_yd_200": "bonus_rec_200",
    "pass_td_40p": "pass_td_40", "rush_td_40p": "rush_td_40", "rec_td_40p": "rec_td_40",
    "st_td": "ret_td", "kr_td": "ret_td", "pr_td": "ret_td",
    "idp_tkl": "idp_tackle", "idp_sack": "idp_sack", "idp_int": "idp_int", "idp_pass_def": "idp_pass_def",
    "idp_tkl_loss": "idp_tfl", "idp_qb_hit": "idp_qb_hit", "idp_def_td": "idp_td",
}
# Sleeper keys covered by a band below, or that mean nothing on their own.
_SLEEPER_BANDS = {"fgm_0_19", "fgm_20_29", "fgm_30_39", "fgmiss_0_19", "fgmiss_20_29",
                  "pts_allow_14_20", "pts_allow_21_27", "pts_allow_35p", "fgm_50_59", "fgm_60p"}


def _band(rules: dict, notes: list, target: str, values: list[float], label: str) -> None:
    present = [v for v in values if v is not None]
    if not present:
        return
    rules[target] = present[-1]
    if len(set(present)) > 1:
        notes.append(f"{label} has different values on the source; using {present[-1]:g} for all of it here.")


def translate_sleeper_scoring(settings: dict) -> tuple[dict[str, float], list[str]]:
    rules: dict[str, float] = {}
    notes: list[str] = []
    for key, value in (settings or {}).items():
        value = float(value)
        if key in _SLEEPER_BANDS:
            continue
        ours = key if key in CATALOG else _SLEEPER_RENAME.get(key)
        if ours and ours in CATALOG:
            rules[ours] = value
        elif value:
            notes.append(f"Sleeper's “{key}” ({value:g}) isn't scored here.")
    s = settings or {}
    _band(rules, notes, "fg_made_0_39", [s.get("fgm_0_19"), s.get("fgm_20_29"), s.get("fgm_30_39")], "A made field goal under 40 yards")
    _band(rules, notes, "fg_miss_0_29", [s.get("fgmiss_0_19"), s.get("fgmiss_20_29")], "A missed field goal under 30 yards")
    if s.get("fgm_50_59") is not None or s.get("fgm_60p") is not None:
        _band(rules, notes, "fg_made_50_plus", [s.get("fgm_50p"), s.get("fgm_50_59"), s.get("fgm_60p")], "A made field goal of 50+ yards")
    if s.get("pts_allow_14_20") is not None:
        rules["pts_allow_14_17"] = float(s["pts_allow_14_20"])
    if s.get("pts_allow_21_27") is not None:
        rules["pts_allow_18_27"] = float(s["pts_allow_21_27"])
    if s.get("pts_allow_14_20") is not None and s.get("pts_allow_21_27") is not None and float(s["pts_allow_14_20"]) != float(s["pts_allow_21_27"]):
        notes.append("A defense allowing 18–20 points scores like 21–27 here (Sleeper groups it with 14–20).")
    if s.get("pts_allow_35p") is not None:
        rules["pts_allow_35_45"] = rules["pts_allow_46_plus"] = float(s["pts_allow_35p"])
    return rules, notes


# ESPN abbreviation -> (this app's key, divide the points by this to get per-unit).
_ESPN = {
    "PY": ("pass_yd", 1), "PY5": ("pass_yd", 5), "PY10": ("pass_yd", 10), "PY20": ("pass_yd", 20),
    "PY25": ("pass_yd", 25), "PY50": ("pass_yd", 50), "PY100": ("pass_yd", 100),
    "PTD": ("pass_td", 1), "INTT": ("pass_int", 1), "PC": ("pass_cmp", 1), "2PC": ("two_pt_pass", 1),
    "RY": ("rush_yd", 1), "RY5": ("rush_yd", 5), "RY10": ("rush_yd", 10), "RY20": ("rush_yd", 20),
    "RY25": ("rush_yd", 25), "RY50": ("rush_yd", 50), "R100": ("rush_yd", 100),
    "RTD": ("rush_td", 1), "RA": ("rush_att", 1), "2PR": ("two_pt_rush", 1),
    "REC": ("rec", 1), "REY": ("rec_yd", 1), "REY5": ("rec_yd", 5), "REY10": ("rec_yd", 10),
    "REY20": ("rec_yd", 20), "REY25": ("rec_yd", 25), "REY50": ("rec_yd", 50), "RE100": ("rec_yd", 100),
    "RETD": ("rec_td", 1), "2PRE": ("two_pt_rec", 1), "FUML": ("fum_lost", 1),
    "PAT": ("xp_made", 1), "FG0": ("fg_made_0_39", 1), "FG40": ("fg_made_40_49", 1), "FG50P": ("fg_made_50_plus", 1),
    "FGM40": ("fg_miss_40_49", 1), "FGM50P": ("fg_miss_50_plus", 1),
    "SK": ("def_sack", 1), "INT": ("def_int", 1), "FR": ("def_fum_rec", 1), "BLKK": ("def_block", 1),
    "SF": ("def_safety", 1), "INTTD": ("def_return_td", 1), "FRTD": ("def_return_td", 1),
    "DEFRETTD": ("def_return_td", 1), "BLKKRTD": ("def_return_td", 1),
    "PA0": ("pts_allow_0", 1), "PA1": ("pts_allow_1_6", 1), "PA7": ("pts_allow_7_13", 1), "PA14": ("pts_allow_14_17", 1),
    "PA28": ("pts_allow_28_34", 1), "PA35": ("pts_allow_35_45", 1), "PA46": ("pts_allow_46_plus", 1),
    "YA100": ("yds_allow_lt100", 1), "YA199": ("yds_allow_100_199", 1), "YA299": ("yds_allow_200_299", 1),
    "YA349": ("yds_allow_300_349", 1), "YA399": ("yds_allow_350_399", 1), "YA449": ("yds_allow_400_449", 1),
    "YA499": ("yds_allow_450_499", 1), "YA549": ("yds_allow_500_549", 1), "YA550": ("yds_allow_550_plus", 1),
    "PTD40": ("pass_td_40", 1), "RTD40": ("rush_td_40", 1), "RETD40": ("rec_td_40", 1),
    "KRTD": ("ret_td", 1), "PRTD": ("ret_td", 1),
    "TK": ("idp_tackle", 1), "PD": ("idp_pass_def", 1),
}
# Read separately: miss bands, the 18–27 band and the yardage-game bonuses.
_ESPN_SPECIAL = {"FGM0", "FGM", "PA18", "PA22", "P300", "P400", "RY100", "RY200", "REY100", "REY200"}


def translate_espn_scoring(scoring_format: list[dict]) -> tuple[dict[str, float], list[str]]:
    rules: dict[str, float] = {}
    notes: list[str] = []
    by_abbr = {item.get("abbr"): float(item.get("points") or 0) for item in scoring_format or []}
    for abbr, points in by_abbr.items():
        if abbr in _ESPN_SPECIAL:
            continue
        mapped = _ESPN.get(abbr)
        if mapped:
            key, per = mapped
            value = points / per
            # Every return-TD kind lands on one rule here; they're normally the same value.
            if key in rules and key in ("def_return_td", "ret_td") and rules[key] != value:
                notes.append("ESPN scores some return touchdowns differently; one value is used for all of them here.")
            rules[key] = value
        elif points:
            notes.append(f"ESPN's “{abbr}” ({points:g}) isn't scored here.")
    miss_0_39 = by_abbr.get("FGM0", by_abbr.get("FGM"))
    if miss_0_39 is not None:
        rules["fg_miss_0_29"] = rules["fg_miss_30_39"] = miss_0_39
    if "FGM" in by_abbr:
        rules.setdefault("fg_miss_40_49", by_abbr["FGM"])
        rules.setdefault("fg_miss_50_plus", by_abbr["FGM"])
    _band(rules, notes, "pts_allow_18_27", [by_abbr.get("PA18"), by_abbr.get("PA22")], "Allowing 18–27 points")
    # ESPN's yardage-game bonuses are "300–399" and "400+"; here 400+ is on
    # top of 300+, so it's the difference.
    for low, high, k300, k400 in (("P300", "P400", "bonus_pass_300", "bonus_pass_400"),
                                  ("RY100", "RY200", "bonus_rush_100", "bonus_rush_200"),
                                  ("REY100", "REY200", "bonus_rec_100", "bonus_rec_200")):
        if low in by_abbr:
            rules[k300] = by_abbr[low]
        if high in by_abbr:
            rules[k400] = by_abbr[high] - by_abbr.get(low, 0)
    return rules, notes


# ---- Whole-league translation ---------------------------------------------------


def translate_sleeper(league: dict) -> dict:
    notes: list[str] = []
    rules, scoring_notes = translate_sleeper_scoring(league.get("scoring_settings") or {})
    notes += scoring_notes
    counts: dict[str, int] = {}
    for slot in league.get("roster_positions") or []:
        counts[slot] = counts.get(slot, 0) + 1
    settings = league.get("settings") or {}
    if settings.get("reserve_slots"):
        counts["IR"] = int(settings["reserve_slots"])
    if settings.get("taxi_slots"):
        counts["TAXI"] = int(settings["taxi_slots"])
    return {
        "rules": rules,
        "roster_slots": _roster_slots("sleeper", counts, notes),
        "playoff_teams": int(settings.get("playoff_teams") or 0) or None,
        "playoff_start_week": int(settings.get("playoff_week_start") or 0) or None,
        "waiver_type": "faab" if int(settings.get("waiver_type") or 0) == 2 else None,
        "faab_budget": int(settings.get("waiver_budget") or 0) or None,
        # Keepers (2026-10-28): Sleeper's count, only for a keeper league
        # (settings.type 1); a redraft league keeps nobody.
        "max_keepers": int(settings.get("max_keepers") or 0) if int(settings.get("type") or 0) == 1 else 0,
        "notes": notes,
    }


def translate_espn(league) -> dict:
    notes: list[str] = []
    rules, scoring_notes = translate_espn_scoring(getattr(league.settings, "scoring_format", []) or [])
    notes += scoring_notes
    reg_weeks = getattr(league.settings, "reg_season_count", None)
    faab = bool(getattr(league.settings, "faab", False))
    return {
        "rules": rules,
        "roster_slots": _roster_slots("espn", dict(getattr(league.settings, "position_slot_counts", {}) or {}), notes),
        "playoff_teams": getattr(league.settings, "playoff_team_count", None),
        "playoff_start_week": (reg_weeks + 1) if reg_weeks else None,
        "waiver_type": "faab" if faab else None,
        "faab_budget": int(getattr(league.settings, "acquisition_budget", 0) or 0) if faab else None,
        # ESPN's keeper count (draftSettings.keeperCount; 0 in a redraft league).
        "max_keepers": int(getattr(league.settings, "keeper_count", 0) or 0),
        "notes": notes,
    }


async def apply(conn, league_id: int, season: int, translated: dict) -> None:
    """Writes the translated settings: scoring (every rule the source
    doesn't score set to 0, so totals match), roster slots and playoffs.
    Waivers are only applied at the switch (app/domain/league_switch.py),
    since nothing claims waivers in mirror mode."""
    from app.queries import draft as draft_queries
    from app.queries import leagues as league_queries

    rules = dict(translated["rules"])
    existing = {
        r["stat_category"]
        for r in await conn.fetch(
            "SELECT stat_category FROM league_scoring_rules WHERE league_id = $1 AND season = $2", league_id, season
        )
    }
    for key in existing - set(rules):
        rules[key] = 0.0
    if rules:
        await league_queries.upsert_scoring_rules(conn, league_id, season, rules)

    slots = translated.get("roster_slots") or {}
    if slots:
        await draft_queries.upsert_roster_slots_setting(conn, season, slots, league_id)
        # The roster shape lineups and trades read; marked complete so no
        # draft is ever started for a league that drafted elsewhere.
        await conn.execute(
            """
            INSERT INTO draft_config (season, league_id, draft_order, roster_slots, status, completed_at)
            VALUES ($1, $2, '{}', $3::jsonb, 'complete', now())
            ON CONFLICT (season, league_id) DO UPDATE SET roster_slots = EXCLUDED.roster_slots
            """,
            season, league_id, json.dumps(slots),
        )
    await _apply_keepers(conn, league_id, season, translated.get("max_keepers"))
    if translated.get("playoff_teams"):
        await league_queries.set_playoff_team_count(
            conn, league_id, season, int(translated["playoff_teams"]), start_week=translated.get("playoff_start_week")
        )


async def _apply_keepers(conn, league_id: int, season: int, max_keepers: int | None) -> None:
    """A synced league keeps as many players as it does on ESPN or
    Sleeper (2026-10-28). Neither platform caps how many years in a row
    someone can be kept, so that stays open, and a deadline the
    commissioner set here is left alone. Locked keepers aren't touched."""
    if max_keepers is None:
        return
    existing = await conn.fetchrow(
        "SELECT max_keepers, locked_at FROM league_keeper_rules WHERE season = $1 AND league_id = $2", season, league_id
    )
    if existing is None:
        if max_keepers > 0:
            await conn.execute(
                "INSERT INTO league_keeper_rules (season, league_id, max_keepers) VALUES ($1, $2, $3)",
                season, league_id, max_keepers,
            )
    elif existing["locked_at"] is None and existing["max_keepers"] != max_keepers:
        await conn.execute(
            "UPDATE league_keeper_rules SET max_keepers = $3 WHERE season = $1 AND league_id = $2",
            season, league_id, max_keepers,
        )
