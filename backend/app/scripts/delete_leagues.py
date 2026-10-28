"""
Delete whole leagues (e.g. the Oct 2026 "Sandbox ·" test leagues), and/or
take one user out of others without deleting them.

    python -m app.scripts.delete_leagues --delete 5995 5996 5997 5998 5999 --leave 5994 --user 1          # dry run
    python -m app.scripts.delete_leagues --delete 5995 5996 5997 5998 5999 --leave 5994 --user 1 --apply  # do it

There's no delete-league feature, and league data spans dozens of tables,
so this finds them from the live schema instead of a hand-kept list:
every table with a league_id column loses those leagues' rows, and every
row that points at a deleted row (by foreign key) goes first, recursively.
users and owners are never deleted — a nullable reference from them is
cleared instead (users.active_league_id moves to another league the user
is still in), and a non-null one stops the run. Bot owners are left in
place, attached to nothing.

--leave removes --user's membership and their chat participation in
those leagues (pushes go to owners, not members), so that league stops
notifying them; it's not deleted (5994 holds the App Review account).

Everything runs in one transaction; without --apply it's rolled back
after printing what would change. Runs against DATABASE_URL.
"""
import argparse
import asyncio
import json

import asyncpg

from app import config

PROTECTED = {"users", "owners"}
MAX_DEPTH = 10


async def _references_to(conn, table: str):
    """Foreign keys pointing at `table` that the database won't handle
    itself (ON DELETE CASCADE / SET NULL / SET DEFAULT already do)."""
    return await conn.fetch(
        """
        SELECT c.conrelid::regclass::text AS child,
               array(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(n, o)
                     JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.n ORDER BY k.o) AS child_cols,
               array(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(n, o)
                     JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.n ORDER BY k.o) AS parent_cols,
               bool_and(NOT a.attnotnull) AS nullable
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'f' AND c.confrelid = $1::regclass AND c.confdeltype NOT IN ('c', 'n', 'd')
        GROUP BY c.oid, c.conrelid, c.conkey, c.confkey
        """,
        table,
    )


def _cols(cols) -> str:
    return ", ".join(f'"{c}"' for c in cols)


async def _purge(conn, table: str, where: str, params, counts: dict, depth: int = 0) -> None:
    """Deletes `table` rows matching `where`, after first dealing with
    every row elsewhere that references them."""
    if depth > MAX_DEPTH:
        raise SystemExit(f"Foreign keys nest deeper than {MAX_DEPTH} under {table}; stopping.")
    for fk in await _references_to(conn, table):
        child, child_cols, parent_cols = fk["child"], fk["child_cols"], fk["parent_cols"]
        match = f"({_cols(child_cols)}) IN (SELECT {_cols(parent_cols)} FROM {table} WHERE {where})"
        if child == table or child in PROTECTED:
            if not fk["nullable"]:
                if child == table:
                    continue  # deleted in the same statement below
                raise SystemExit(f"{child}.{child_cols} must point at {table} rows being deleted; stopping.")
            sets = ", ".join(f'"{c}" = NULL' for c in child_cols)
            result = await conn.execute(f"UPDATE {child} SET {sets} WHERE {match}", *params)
            key = f"{child}.{'/'.join(child_cols)} cleared"
            counts[key] = counts.get(key, 0) + int(result.split()[-1])
        else:
            await _purge(conn, child, match, params, counts, depth + 1)
    result = await conn.execute(f"DELETE FROM {table} WHERE {where}", *params)
    n = int(result.split()[-1])
    if n:
        counts[table] = counts.get(table, 0) + n


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--delete", type=int, nargs="*", default=[], help="League ids to delete entirely")
    parser.add_argument("--leave", type=int, nargs="*", default=[], help="League ids to take --user out of")
    parser.add_argument("--user", type=int, help="The user leaving the --leave leagues")
    parser.add_argument("--apply", action="store_true", help="Commit (default is a dry run)")
    args = parser.parse_args()
    if 1 in args.delete or 1 in args.leave:
        raise SystemExit("Not League #1.")
    if args.leave and args.user is None:
        raise SystemExit("--leave needs --user.")
    if set(args.delete) & set(args.leave):
        raise SystemExit("A league can't be in both --delete and --leave.")

    conn = await asyncpg.connect(config.DATABASE_URL, statement_cache_size=0)
    report: dict = {}
    try:
        tx = conn.transaction()
        await tx.start()
        try:
            leagues = await conn.fetch(
                "SELECT id, name FROM leagues WHERE id = ANY($1::int[]) ORDER BY id", args.delete + args.leave
            )
            report["leagues"] = [f"{r['id']} {r['name']}" for r in leagues]
            missing = set(args.delete + args.leave) - {r["id"] for r in leagues}
            if missing:
                raise SystemExit(f"No such league(s): {sorted(missing)}")

            if args.leave:
                owner_ids = [r["owner_id"] for r in await conn.fetch("SELECT owner_id FROM owner_users WHERE user_id = $1", args.user)]
                report["leave"] = {
                    "league_members": await conn.execute(
                        "DELETE FROM league_members WHERE league_id = ANY($1::int[]) AND user_id = $2", args.leave, args.user
                    ),
                    "conversation_participants": await conn.execute(
                        "DELETE FROM conversation_participants WHERE owner_id = ANY($2::int[]) "
                        "AND conversation_id IN (SELECT id FROM conversations WHERE league_id = ANY($1::int[]))",
                        args.leave, owner_ids,
                    ),
                    "teams_still_theirs": [
                        f"league {r['league_id']} {r['season']}: {r['team_name']}"
                        for r in await conn.fetch(
                            "SELECT league_id, season, team_name FROM teams_by_season "
                            "WHERE league_id = ANY($1::int[]) AND owner_id = ANY($2::int[]) ORDER BY league_id, season",
                            args.leave, owner_ids,
                        )
                    ],
                }

            if args.delete:
                params = (args.delete,)
                # Anyone whose current league is going away lands in
                # another league they're still in (or none).
                report["active_league_moved"] = await conn.execute(
                    """
                    UPDATE users u SET active_league_id = (
                        SELECT min(m.league_id) FROM league_members m
                        WHERE m.user_id = u.id AND NOT m.league_id = ANY($1::int[]))
                    WHERE u.active_league_id = ANY($1::int[])
                    """,
                    args.delete,
                )
                counts: dict = {}
                tables = await conn.fetch(
                    """
                    SELECT c.table_name FROM information_schema.columns c
                    JOIN information_schema.tables t USING (table_schema, table_name)
                    WHERE c.table_schema = 'public' AND c.column_name = 'league_id'
                      AND t.table_type = 'BASE TABLE' AND c.table_name <> 'leagues'
                    ORDER BY c.table_name
                    """
                )
                for row in tables:
                    if row["table_name"] in PROTECTED:
                        report.setdefault("skipped_protected", []).append(row["table_name"])
                        continue
                    await _purge(conn, row["table_name"], "league_id = ANY($1::int[])", params, counts)
                await _purge(conn, "leagues", "id = ANY($1::int[])", params, counts)
                report["deleted_rows"] = dict(sorted(counts.items()))
        except BaseException:
            await tx.rollback()
            raise
        if args.apply:
            await tx.commit()
        else:
            await tx.rollback()
    finally:
        await conn.close()
    print(json.dumps(report, indent=2, default=str))
    print("Done." if args.apply else "Dry run only — rolled back, nothing changed. Add --apply to do it.")


if __name__ == "__main__":
    asyncio.run(main())
