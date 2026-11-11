"""
Who's he and who's she, for the AI writers (2026-11-10). The recaps
called the league's women "he" because nothing told the model
otherwise. Owners answer male, female or Prefer not to say in the About
you step (users.gender); every writer gets RULE in its system prompt
(app/providers/anthropic_narrative.py) and a PEOPLE line in its facts
listing the ones who answered. Anyone not listed is called by name.

An owner with co-owners who answered differently isn't listed.
"""

RULE = (
    "Pronouns: use he or she only for a manager the facts' PEOPLE line lists that way. Anyone it "
    "doesn't list, call by name (or they). Never assume someone is a man, and never call the group "
    '"guys", "boys" or "gentlemen".'
)

_PRONOUN = {"male": "he/him", "female": "she/her"}


async def owner_genders(conn, owner_ids) -> dict[int, str]:
    """owner_id -> 'male' / 'female', for owners whose every linked
    account gave the same answer."""
    ids = [i for i in set(owner_ids) if i is not None]
    if not ids:
        return {}
    rows = await conn.fetch(
        """
        SELECT ou.owner_id, array_agg(DISTINCT u.gender) AS genders, bool_and(u.gender IS NOT NULL) AS all_answered
        FROM owner_users ou JOIN users u ON u.id = ou.user_id
        WHERE ou.owner_id = ANY($1::int[])
        GROUP BY ou.owner_id
        """,
        ids,
    )
    return {r["owner_id"]: r["genders"][0] for r in rows if r["all_answered"] and len(r["genders"]) == 1}


def people_line(names: dict[int, str], genders: dict[int, str]) -> str:
    """"PEOPLE: Kim she/her; Eric he/him" for the owners in `names`
    (owner_id -> the name the facts use) who answered, or "" if none."""
    parts = [f"{name} {_PRONOUN[genders[oid]]}" for oid, name in names.items() if genders.get(oid) in _PRONOUN]
    return "PEOPLE: " + "; ".join(parts) if parts else ""


async def people_for(conn, names: dict[int, str]) -> str:
    return people_line(names, await owner_genders(conn, names.keys()))
