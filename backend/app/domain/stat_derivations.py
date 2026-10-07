"""
Stats a league can score that aren't read straight off ESPN's box
score but follow from it (the scoring editor, 2026-10):

- IDP: a DL/LB/DB's own sacks, interceptions, passes defended, tackles
  for loss, QB hits and TDs become idp_*; nobody else's count.
- Tackles by position. ESPN's "defensive"/totalTackles isn't position-
  scoped, so a tackle becomes qb_tackle / k_tackle by who made it
  (anyone else's is dropped: a RB chasing down a turnover isn't scored).
  IDP defenders keep theirs as idp_tackle.
- Position extras: te_rec, a catch by a tight end (TE premium).
- Game bonuses: bonus_pass_300 etc., 1 when a player reaches the mark.
  Each is its own rule, so a 400-yard passer earns both the 300 and
  the 400 bonus if the league prices both.

Pure: weekly_stats.py (final stats), gamecast/last_play.py (a single
play) and the scoring preview all run the same stat line through here
before scoring_engine.compute_player_points, so a rule means the same
thing everywhere. Never applied twice: derived categories are always
recomputed from the base stats, not added on top of an earlier pass.
"""
from app.domain.roster_slots import IDP_POSITIONS, fantasy_position

_POSITION_TACKLE = {"QB": "qb_tackle", "K": "k_tackle"}

# A defender's own box-score stats (espn_public.py's raw names) -> the
# IDP categories a league scores. Anyone else's are dropped.
_IDP_STATS = {
    "def_sack_ind": "idp_sack",
    "def_int_ind": "idp_int",
    "def_pd": "idp_pass_def",
    "def_tfl": "idp_tfl",
    "def_qb_hit": "idp_qb_hit",
    "def_td_ind": "idp_td",
}

# (stat, mark, bonus category)
GAME_BONUSES: tuple[tuple[str, float, str], ...] = (
    ("pass_yd", 300, "bonus_pass_300"),
    ("pass_yd", 400, "bonus_pass_400"),
    ("rush_yd", 100, "bonus_rush_100"),
    ("rush_yd", 200, "bonus_rush_200"),
    ("rec_yd", 100, "bonus_rec_100"),
    ("rec_yd", 200, "bonus_rec_200"),
)
_DERIVED = {"te_rec", *(b for _, _, b in GAME_BONUSES)}


def tackle_category(position: str | None) -> str | None:
    """Where a tackle by this position is scored, or None (not scored)."""
    group = fantasy_position(position)
    if group in IDP_POSITIONS:
        return "idp_tackle"
    return _POSITION_TACKLE.get(group or "")


def derive_stat_line(stat_line: dict[str, float], position: str | None, *, bonuses: bool = True) -> dict[str, float]:
    """A copy of `stat_line` with the position-dependent and derived
    categories filled in. `bonuses=False` for a single play's stat
    delta (last_play.py): a game bonus is about the whole game, so it's
    left to the full stat line."""
    line = {k: v for k, v in stat_line.items() if k not in _DERIVED}
    if "def_tackle" in line:
        count = line.pop("def_tackle")
        category = tackle_category(position)
        if category:
            line[category] = line.get(category, 0) + count
    is_idp = fantasy_position(position) in IDP_POSITIONS
    for raw, category in _IDP_STATS.items():
        if raw in line:
            count = line.pop(raw)
            if is_idp:
                line[category] = line.get(category, 0) + count
    if fantasy_position(position) == "TE" and line.get("rec"):
        line["te_rec"] = line["rec"]
    if bonuses:
        for stat, mark, category in GAME_BONUSES:
            if line.get(stat, 0) >= mark:
                line[category] = 1
    return line
