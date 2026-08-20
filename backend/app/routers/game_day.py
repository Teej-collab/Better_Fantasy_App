"""Whether it's currently a live NFL game window — reuses the exact
same detection already gating the live-sync scheduler (app/game_windows.py),
so "is it Game Day" on the homepage always agrees with whether the
backend is actually polling ESPN for fresh scores right now."""
from fastapi import APIRouter

from app.game_windows import is_within_nfl_game_window

router = APIRouter(tags=["game-day"])


@router.get("/game-day")
async def game_day():
    return {"is_game_day": is_within_nfl_game_window()}
