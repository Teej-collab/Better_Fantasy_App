from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.db import get_pool
from app.routers import admin
from app.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Better Fantasy App API", lifespan=lifespan)
app.include_router(admin.router)


@app.get("/health")
async def health(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok"}
