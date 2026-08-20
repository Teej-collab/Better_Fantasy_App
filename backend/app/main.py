import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import get_pool
from app.routers import admin, admin_lineup, auth, awards, chug, game_day, league, me, nfl, profile
from app.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="Better Fantasy App API", lifespan=lifespan)

allowed_origins = os.getenv("CORS_ALLOWED_ORIGINS", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    # Needed so the browser sends the session cookie on cross-origin
    # requests from the frontend (different port = different origin) to
    # GET /auth/me and POST /auth/logout.
    allow_credentials=True,
)

app.include_router(admin.router)
app.include_router(admin_lineup.router)
app.include_router(auth.router)
app.include_router(awards.router)
app.include_router(chug.router)
app.include_router(game_day.router)
app.include_router(league.router)
app.include_router(me.router)
app.include_router(nfl.router)
app.include_router(profile.router)


@app.get("/health")
async def health(pool=Depends(get_pool)):
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok"}
