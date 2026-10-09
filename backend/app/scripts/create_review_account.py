"""
The App Store reviewer's demo account (2026-10). Apple needs a sign-in
that skips Discord/Google/Apple and lands on a league with real-looking
data — so it's an email/password account given one bot team in a Sandbox
league, never anywhere near League #1's members or chat.

    python -m app.scripts.create_review_account                 # dry run
    python -m app.scripts.create_review_account --apply         # do it

Re-running with --apply resets the password (a new one is printed), so
it's also how to rotate it. Runs against DATABASE_URL.
"""
import argparse
import asyncio
import json
import secrets

import asyncpg

from app import config
from app.auth.passwords import hash_password
from app.queries import auth as auth_queries
from app.queries import leagues as league_queries

DEFAULT_EMAIL = "theweekend.admin+appreview@gmail.com"
DEFAULT_LEAGUE_ID = 5994  # Sandbox · Redraft Superflex
DISPLAY_NAME = "App Review"
TEAM_NAME = "App Review Team"


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", default=DEFAULT_EMAIL)
    parser.add_argument("--league", type=int, default=DEFAULT_LEAGUE_ID)
    parser.add_argument("--apply", action="store_true", help="Create/update the account (default is a dry run)")
    args = parser.parse_args()
    email = args.email.strip().lower()

    conn = await asyncpg.connect(config.DATABASE_URL, statement_cache_size=0)
    try:
        league = await conn.fetchrow("SELECT id, name FROM leagues WHERE id = $1", args.league)
        if league is None:
            raise SystemExit(f"No league {args.league}")
        if args.league == 1:
            raise SystemExit("Not League #1 — the reviewer would see its members and chat.")
        season = int(config._require("ACTIVE_SEASON"))
        user = await auth_queries.get_user_by_email(conn, email)
        linked_owner = await auth_queries.get_owner_id_for_user(conn, user["id"]) if user else None
        # The team to hand over: one already linked to this account, else a
        # bot team (an owner no account is linked to) in the league.
        team = await conn.fetchrow(
            """
            SELECT t.id, t.team_name, t.owner_id, o.display_name
            FROM teams_by_season t JOIN owners o ON o.owner_id = t.owner_id
            WHERE t.league_id = $1 AND t.season = $2
              AND ($3::int IS NOT NULL AND t.owner_id = $3
                   OR $3::int IS NULL AND NOT EXISTS (SELECT 1 FROM owner_users ou WHERE ou.owner_id = t.owner_id)
                      AND o.display_name LIKE 'Bot %')
            ORDER BY t.id LIMIT 1
            """,
            args.league, season, linked_owner,
        )
        if team is None:
            raise SystemExit(f"No free bot team in league {args.league} for {season}")

        plan = {
            "email": email,
            "account": "exists — password will be reset" if user else "new",
            "league": f"{league['id']} {league['name']}",
            "team": f"{team['id']} {team['team_name']} (owner {team['owner_id']} {team['display_name']}) → {TEAM_NAME}",
        }
        if not args.apply:
            print(json.dumps(plan, indent=2))
            print("Dry run only — nothing changed. Add --apply to create it.")
            return

        password = secrets.token_urlsafe(12)
        async with conn.transaction():
            if user:
                user_id = user["id"]
                await auth_queries.reset_password(conn, user_id, hash_password(password))
            else:
                user_id = await auth_queries.create_user_with_password(conn, email, hash_password(password), DISPLAY_NAME)
            await conn.execute(
                "INSERT INTO owner_users (owner_id, user_id) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING",
                team["owner_id"], user_id,
            )
            await conn.execute("UPDATE owners SET display_name = $1 WHERE owner_id = $2", DISPLAY_NAME, team["owner_id"])
            await conn.execute("UPDATE teams_by_season SET team_name = $1 WHERE id = $2", TEAM_NAME, team["id"])
            await league_queries.add_member(conn, args.league, user_id, "member")
            await conn.execute("UPDATE users SET active_league_id = $1 WHERE id = $2", args.league, user_id)
    finally:
        await conn.close()

    print(json.dumps(plan, indent=2))
    print("\nDone. Give these to App Store Connect → TestFlight → Beta App Review Information → Sign-in required:")
    print(f"  User name: {email}")
    print(f"  Password:  {password}")
    print("Sign in with Email on the sign-in screen. Rerun with --apply to change the password.")


if __name__ == "__main__":
    asyncio.run(main())
