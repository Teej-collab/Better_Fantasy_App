"""
All-time award leaderboards for the All-Time Records tab (Awards page) —
"who's won this yearly award the most times, across the league's whole
history" for every award type app/domain/season_awards.py's
determine_and_save_season_awards can hand out, plus Season Champion
(season_champions, a separate table/concept — see that module's
docstring). Companion to app/domain/records.py's numeric record book;
these are about *who keeps winning*, not raw stat lines.

_AWARD_TYPES is the canonical list this page promises to show — every
yearly award the league offers, not just the ones with a winner in the
database yet. A brand-new award type (or a fresh league with no season
awards computed yet) still gets its own card with an empty/placeholder
state rather than silently disappearing, unlike records.py's categories
(which do hide when empty) — the point here is showing the complete
set of awards the league runs, not just the ones already won.
"""
from app.config import DEFAULT_LEAGUE_ID
from app.queries import awards as queries

_TOP_N = 3

# (award_type, emoji, label) — label is award_type itself for every one
# of these (season_awards.py's own strings already read as display
# labels), kept as an explicit tuple anyway so a future award type with a
# more machine-shaped internal name isn't forced to double as its own
# display text.
_AWARD_TYPES = [
    ("Clutch Performer", "💪"),
    ("Choke Artist", "😬"),
    ("Overachiever", "📈"),
    ("Underachiever", "📉"),
    ("Boom Week", "💣"),
    ("Bust Week", "🧊"),
    ("Snakebit Award", "🐍"),
    ("Luckiest Win", "🍀"),
    ("Heater", "🌡️"),
    ("Cold Streak", "🥶"),
    ("Bullseye Award", "🎯"),
    ("Highway Robbery", "🕵️"),
]


def _winner(row):
    return {"owner_id": row["owner_id"], "owner_name": row["owner_name"], "wins": row["wins"]}


async def get_award_leaderboards(conn, league_id: int = DEFAULT_LEAGUE_ID):
    win_rows = await queries.award_win_counts(conn, league_id)
    by_type: dict[str, list] = {}
    for r in win_rows:
        by_type.setdefault(r["award_type"], []).append(r)

    champion_rows = await queries.championship_win_counts(conn, league_id)

    categories = [
        {
            "key": "season_champion",
            "label": "Season Champion",
            "emoji": "🏆",
            "winners": [_winner(r) for r in champion_rows[:_TOP_N]],
        }
    ]
    for award_type, emoji in _AWARD_TYPES:
        categories.append(
            {
                "key": award_type,
                "label": award_type,
                "emoji": emoji,
                "winners": [_winner(r) for r in by_type.get(award_type, [])[:_TOP_N]],
            }
        )

    return {"categories": categories}
