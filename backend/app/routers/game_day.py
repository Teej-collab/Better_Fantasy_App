"""Whether a real NFL game is live right now — reuses the exact same
scoreboard fetch and detection now also gating the live-sync scheduler
(app/providers/nfl_scoreboard.py, app/scheduler.py), so "is it Game Day"
always agrees with whether the backend is actually polling ESPN for
fresh scores right now. Replaced the old day-of-week/hour heuristic
(app/game_windows.py, removed) — see TODO.md, Aug 19 2026."""
from fastapi import APIRouter

from app.providers.nfl_scoreboard import get_nfl_scoreboard, is_nfl_game_live

router = APIRouter(tags=["game-day"])


@router.get("/game-day")
async def game_day():
    games = await get_nfl_scoreboard()
    return {"is_game_day": is_nfl_game_live(games)}
