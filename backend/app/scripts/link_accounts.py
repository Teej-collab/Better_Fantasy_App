"""
Move a new login onto someone's original account (app/domain/account_link.py).

    python -m app.scripts.link_accounts --from 23422 --into 59            # dry run
    python -m app.scripts.link_accounts --from 23422 --into 59 --apply    # do it

--from is the new, empty account (e.g. made with Sign in with Apple);
--into is the original one that holds their history (Discord-created).
"""
import argparse
import asyncio
import json

import asyncpg

from app import config
from app.domain.account_link import link_login_into


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="source", type=int, required=True)
    parser.add_argument("--into", dest="target", type=int, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    conn = await asyncpg.connect(config.DATABASE_URL, statement_cache_size=0)
    try:
        report = await link_login_into(conn, args.source, args.target, apply=args.apply)
    finally:
        await conn.close()
    print(json.dumps(report, indent=2, default=str))
    print("Linked." if args.apply else "Dry run only — nothing changed. Add --apply to link.")


if __name__ == "__main__":
    asyncio.run(main())
