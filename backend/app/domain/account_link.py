"""
Moving a new login onto someone's original account (2026-10).

League #1's members started out signing in with Discord, so their
history (owners rows) hangs off their Discord-created accounts. When one
of them opens the app now and signs in with Apple, Google or email, that
makes a brand-new, empty account — and the "Who are you here?" picker
can't offer their history, because their Discord account already claimed
it (the real case: Niko, 2026-10-07).

link_login_into moves the new login's sign-in methods (Apple, Google,
email and password) onto the original account, moves anything else the
new account touched (league memberships, feedback…), and deletes the now
empty new account. From then on, Sign in with Apple opens the original
account, history and all. It refuses when the new account has claimed a
team of its own, so two real histories are never folded together.

Run self-serve from the app ("Played here before with Discord? Verify
with Discord" — app/routers/auth.py's discord_callback with a link
ticket), or by hand with app/scripts/link_accounts.py.
"""

IDENTITY_COLUMNS = ("apple_user_id", "google_user_id", "email", "password_hash", "apple_refresh_token")


class AccountLinkError(Exception):
    pass


async def link_login_into(conn, source_user_id: int, target_user_id: int, *, apply: bool = True) -> dict:
    if source_user_id == target_user_id:
        raise AccountLinkError("That's already the same account")
    report: dict = {"moved_identities": [], "moved": {}, "dropped_duplicates": {}}

    tx = conn.transaction()
    await tx.start()
    try:
        source = await conn.fetchrow("SELECT * FROM users WHERE id = $1", source_user_id)
        target = await conn.fetchrow("SELECT * FROM users WHERE id = $1", target_user_id)
        if source is None or target is None:
            raise AccountLinkError("Both accounts must exist")
        if await conn.fetchval("SELECT 1 FROM owner_users WHERE user_id = $1", source_user_id):
            raise AccountLinkError("This account already has a team of its own")

        # Sign-in methods: the original account keeps any it already has.
        moving = {c: source[c] for c in IDENTITY_COLUMNS if source[c] is not None and target[c] is None}
        if moving:
            await conn.execute(
                f"UPDATE users SET {', '.join(f'{c} = NULL' for c in moving)} WHERE id = $1", source_user_id
            )
            await conn.execute(
                f"UPDATE users SET {', '.join(f'{c} = ${i + 2}' for i, c in enumerate(moving))} WHERE id = $1",
                target_user_id, *moving.values(),
            )
            report["moved_identities"] = [c for c in moving if c not in ("password_hash", "apple_refresh_token")]
        if target["active_league_id"] is None and source["active_league_id"] is not None:
            await conn.execute("UPDATE users SET active_league_id = $2 WHERE id = $1", target_user_id, source["active_league_id"])

        # Everything else that points at the new account.
        refs = await conn.fetch(
            """
            SELECT cl.relname AS table_name, att.attname AS column_name
            FROM pg_constraint con
            JOIN pg_class cl ON cl.oid = con.conrelid
            JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
            WHERE con.contype = 'f' AND con.confrelid = 'users'::regclass AND cl.relname <> 'users'
            """
        )
        for ref in refs:
            table, column = ref["table_name"], ref["column_name"]
            t, c = f'"{table}"', f'"{column}"'
            uniques = await conn.fetch(
                """
                SELECT array_agg(att.attname) AS cols
                FROM pg_index ix
                JOIN pg_class cl ON cl.oid = ix.indrelid
                JOIN pg_attribute att ON att.attrelid = ix.indrelid AND att.attnum = ANY(ix.indkey)
                WHERE cl.relname = $1 AND ix.indisunique
                GROUP BY ix.indexrelid
                """,
                table,
            )
            for u in uniques:
                cols = list(u["cols"])
                if column not in cols:
                    continue
                others = [x for x in cols if x != column]
                match = " AND ".join(f's."{o}" IS NOT DISTINCT FROM k."{o}"' for o in others) or "TRUE"
                # Here the ORIGINAL account's row wins (it's the real one).
                status = await conn.execute(
                    f"DELETE FROM {t} AS s USING {t} AS k WHERE s.{c} = $1 AND k.{c} = $2 AND {match}",
                    source_user_id, target_user_id,
                )
                n = int(status.split()[-1])
                if n:
                    report["dropped_duplicates"][f"{table}.{column}"] = n
            status = await conn.execute(f"UPDATE {t} SET {c} = $1 WHERE {c} = $2", target_user_id, source_user_id)
            n = int(status.split()[-1])
            if n:
                report["moved"][f"{table}.{column}"] = n

        await conn.execute("DELETE FROM users WHERE id = $1", source_user_id)
    except BaseException:
        await tx.rollback()
        raise
    if apply:
        await tx.commit()
    else:
        await tx.rollback()
    report["applied"] = apply
    return report
