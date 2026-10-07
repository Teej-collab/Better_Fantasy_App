"""
Merging two owners who are really one person (2026-10).

The real case: Tyler Dailey's 2025 team came in from a second ESPN
account, so ESPN's sync made it a separate owner, "Ligmuh Bauhs" — a
second trading card, split career stats, split chug history. An earlier
hand fix didn't stick because every ESPN sync re-created that owner from
the second account's member id and moved the 2025 team back to it.

merge_owners moves everything that points at the duplicate onto the real
owner, records the duplicate's ESPN member id in owner_espn_aliases (so
the sync maps it to the real owner from now on — see
app/providers/espn/adapter.py's sync_teams), and deletes the duplicate.

Every column that refers to an owner is found from the database itself
(foreign keys to owners, plus owner-id columns without one), so tables
added later are covered too. Where both owners have a row that a unique
key says can only exist once (the same season/week of chug debt, say),
the duplicate's row wins — it's the one the merged team actually played
under — and the real owner's copy is dropped. Runs in one transaction.
"""

OWNER_COLUMN_NAMES = ("owner_id", "owner_a_id", "owner_b_id")


async def _owner_columns(conn) -> list[tuple[str, str]]:
    rows = await conn.fetch(
        """
        SELECT DISTINCT cl.relname AS table_name, att.attname AS column_name
        FROM pg_constraint con
        JOIN pg_class cl ON cl.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
        WHERE con.contype = 'f' AND con.confrelid = 'owners'::regclass AND ns.nspname = 'public'
        UNION
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND c.data_type IN ('integer', 'bigint')
          AND (c.column_name = ANY($1::text[]) OR c.column_name LIKE '%\\_owner\\_id')
        """,
        list(OWNER_COLUMN_NAMES),
    )
    return sorted((r["table_name"], r["column_name"]) for r in rows if r["table_name"] != "owners")


async def _unique_keys_with(conn, table: str, column: str) -> list[list[str]]:
    """Every unique index on `table` that includes `column`, as the
    list of its OTHER columns."""
    rows = await conn.fetch(
        """
        SELECT array_agg(att.attname ORDER BY att.attnum) AS cols
        FROM pg_index ix
        JOIN pg_class cl ON cl.oid = ix.indrelid
        JOIN pg_attribute att ON att.attrelid = ix.indrelid AND att.attnum = ANY(ix.indkey)
        WHERE cl.relname = $1 AND ix.indisunique
        GROUP BY ix.indexrelid
        """,
        table,
    )
    keys = []
    for r in rows:
        cols = list(r["cols"])
        if column in cols:
            keys.append([c for c in cols if c != column])
    return keys


def _q(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


async def merge_owners(conn, from_owner_id: int, into_owner_id: int, *, apply: bool = True) -> dict:
    """Moves owner `from_owner_id` into `into_owner_id`. With apply=False,
    reports what would move and rolls everything back."""
    if from_owner_id == into_owner_id:
        raise ValueError("Can't merge an owner into itself")
    report: dict = {"moved": {}, "dropped_duplicates": {}}

    tx = conn.transaction()
    await tx.start()
    try:
        source = await conn.fetchrow("SELECT * FROM owners WHERE owner_id = $1", from_owner_id)
        target = await conn.fetchrow("SELECT * FROM owners WHERE owner_id = $1", into_owner_id)
        if source is None or target is None:
            raise ValueError("Both owners must exist")
        report["from"] = source["display_name"]
        report["into"] = target["display_name"]

        for table, column in await _owner_columns(conn):
            t, c = _q(table), _q(column)
            for others in await _unique_keys_with(conn, table, column):
                match = " AND ".join(f"i.{_q(o)} IS NOT DISTINCT FROM f.{_q(o)}" for o in others) or "TRUE"
                dropped = await conn.execute(
                    f"DELETE FROM {t} AS i USING {t} AS f WHERE i.{c} = $1 AND f.{c} = $2 AND {match}",
                    into_owner_id, from_owner_id,
                )
                n = int(dropped.split()[-1])
                if n:
                    report["dropped_duplicates"][f"{table}.{column}"] = (
                        report["dropped_duplicates"].get(f"{table}.{column}", 0) + n
                    )
            moved = await conn.execute(f"UPDATE {t} SET {c} = $1 WHERE {c} = $2", into_owner_id, from_owner_id)
            n = int(moved.split()[-1])
            if n:
                report["moved"][f"{table}.{column}"] = n

        if source["espn_member_id"]:
            await conn.execute(
                """
                INSERT INTO owner_espn_aliases (espn_member_id, owner_id) VALUES ($1, $2)
                ON CONFLICT (espn_member_id) DO UPDATE SET owner_id = EXCLUDED.owner_id
                """,
                source["espn_member_id"], into_owner_id,
            )
            report["espn_alias"] = source["espn_member_id"]
        await conn.execute("DELETE FROM owners WHERE owner_id = $1", from_owner_id)
    except BaseException:
        await tx.rollback()
        raise
    if apply:
        await tx.commit()
    else:
        await tx.rollback()
    report["applied"] = apply
    return report
