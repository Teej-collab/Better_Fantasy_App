"""
Merge a duplicate owner into the real one (app/domain/owner_merge.py).

    python -m app.scripts.merge_owners --from 36651 --into 20            # dry run
    python -m app.scripts.merge_owners --from 36651 --into 20 --apply    # do it

Runs against DATABASE_URL. A dry run shows exactly what would move and
changes nothing.
"""
import argparse
import asyncio
import json

import asyncpg

from app import config
from app.domain.owner_merge import merge_owners


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="from_owner", type=int, required=True, help="The duplicate owner_id to remove")
    parser.add_argument("--into", dest="into_owner", type=int, required=True, help="The real owner_id to keep")
    parser.add_argument("--apply", action="store_true", help="Actually merge (default is a dry run)")
    args = parser.parse_args()

    conn = await asyncpg.connect(config.DATABASE_URL, statement_cache_size=0)
    try:
        report = await merge_owners(conn, args.from_owner, args.into_owner, apply=args.apply)
    finally:
        await conn.close()
    print(json.dumps(report, indent=2))
    print("Merged." if args.apply else "Dry run only — nothing changed. Add --apply to merge.")


if __name__ == "__main__":
    asyncio.run(main())
