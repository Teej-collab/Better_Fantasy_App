"""
One-time upload of League #1's player-card photos into the private
bucket (app/providers/card_photo_storage.py). They used to be bundled in
the app and public on the website.

    railway run python -m app.scripts.seed_card_photos

Needs the bucket settings (CHUG_BUCKET_*) and DATABASE_URL, which
`railway run` provides from the backend service. Reads the photos from
backend/private/owner-photos/ (git-ignored). Safe to run again: it
replaces each owner's photo.
"""
import asyncio
import os
from pathlib import Path

import asyncpg

from app import config
from app.providers import card_photo_storage

LEAGUE_ID = 1
PHOTO_DIR = Path(__file__).resolve().parents[2] / "private" / "owner-photos"
# owner_id → photo file, the same mapping the app and website used.
PHOTOS = {
    5: "clay-felice.jpg", 44: "brian-thomas.jpg", 12: "ian-parkinson.jpg", 3: "bailey-hawn.jpg",
    11: "bowmen-solari.jpg", 10: "jeffrey-horak.jpg", 8: "aaron-wylie.jpg", 15: "aaron-roberts.jpg",
    20: "tyler-dailey.jpg", 9: "james-hogan.jpg", 2: "lorenzo-cachia.jpg", 1: "niko.jpg", 4: "tj.jpg",
    7: "ryan-horak.jpg", 6: "grant-pomerenk.jpg",
}


async def main() -> None:
    if not card_photo_storage.configured():
        raise SystemExit("Bucket settings missing — run this with `railway run`.")
    conn = await asyncpg.connect(os.getenv("DATABASE_URL") or config.DATABASE_URL, statement_cache_size=0)
    try:
        for owner_id, filename in PHOTOS.items():
            path = PHOTO_DIR / filename
            if not path.exists():
                print(f"skip {owner_id}: {filename} not found")
                continue
            if not await conn.fetchval("SELECT 1 FROM owners WHERE owner_id = $1", owner_id):
                print(f"skip {owner_id}: no such owner")
                continue
            key = card_photo_storage.object_key(LEAGUE_ID, owner_id, "image/jpeg")
            await asyncio.to_thread(card_photo_storage.upload, path.read_bytes(), key, "image/jpeg")
            old = await conn.fetchval(
                "SELECT object_key FROM owner_card_photos WHERE owner_id = $1 AND league_id = $2", owner_id, LEAGUE_ID
            )
            await conn.execute(
                """
                INSERT INTO owner_card_photos (owner_id, league_id, object_key) VALUES ($1, $2, $3)
                ON CONFLICT (owner_id, league_id) DO UPDATE SET object_key = EXCLUDED.object_key, updated_at = now()
                """,
                owner_id, LEAGUE_ID, key,
            )
            if old and old != key:
                await asyncio.to_thread(card_photo_storage.delete, old)
            print(f"uploaded {owner_id}: {filename}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
