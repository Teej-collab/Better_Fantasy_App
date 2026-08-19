from fastapi import Depends, FastAPI

from app.db import get_pool

app = FastAPI(title="Better Fantasy App API")


@app.get("/health")
async def health(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok"}
