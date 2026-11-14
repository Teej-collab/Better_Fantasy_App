# Data Flow — The Weekend TV

**Status: PROPOSED.** Existing steps are marked (exists); new steps are marked (new).

## Live scores (Sunday)

```
ESPN public summary API ──(1 poll/game, scheduler, exists)──▶ gamecast/service
   normalize → LiveGame (plays, drive, clock, possession)        (exists)
   raw stat lines → scoring_engine per league → player_week_stats (exists)
   diff fantasy_points → fantasy-impact events                    (exists)
        │
        ├──▶ /gamecast/ws  per-game fan-out (phone, web, TV Gamecast) (exists)
        └──▶ tv/live_hub  per-league fan-out to paired TVs            (new)
               payload: {league_id, seq, at, matchups:[{id, home, away,
                         win_prob}], events:[{player, pts_delta, play_id}]}
```

Rules:

- Only the backend calls third-party feeds. The number of TVs never changes the
  number of upstream calls.
- `seq` increases by 1 per league per change. The TV ignores `seq` values at or below
  the last one it saw. On a gap it calls `GET /tv/v1/broadcast` to resync.
- Every payload carries `at` (server time) and `source_status` (`live`, `delayed`,
  `stale`). The TV shows "Last updated hh:mm:ss". After 90 seconds with no message
  during live games, it switches to a STALE banner and keeps the last values.
- The TV reconnects with backoff of 1, 2, 4, 8 and then 30 seconds with jitter, and
  falls back to polling `broadcast` every 30 seconds while the WS is down.

## Pairing

```
TV                      Backend                       Phone / website
POST /tv/v1/pair/start ─▶ code ABCD-2345, device_code,
                          expires 10 min, poll interval 5 s
show code + QR (ownersbox.app/tv?c=ABCD2345)
poll /pair/token (device_code) ◀─ pending
                                     ◀── user signed in, opens /tv,
                                         enters code, picks league,
                                         approves (POST /tv/v1/pair/approve)
poll /pair/token ─────────▶ code redeemed once → access + refresh tokens
```

## Screens

| Screen | Endpoint (new aggregate) | Built from (existing) |
|---|---|---|
| Broadcast | `/tv/v1/leagues/{id}/broadcast` | matchups, win prob, standings top, playoff odds, Commish Corner latest, game-day |
| Gamecast | `/tv/v1/gamecast/{game_id}` + game WS | gamecast service, boxscore, fantasy-impact |
| League Center | `/tv/v1/leagues/{id}/league-center` | standings, bracket, playoffs/odds + clinch flags, records, champions, streaks |
| League Lounge | `/tv/v1/leagues/{id}/lounge` | recap, previews, power rankings, activity, trades, league bets board, rivalries |
| Settings | `/tv/v1/me`, `/tv/v1/devices/self` | new device tables |

## AI content

The flow is: verified facts → fact payload → model → cache table → API. The TV only
ever receives cached text plus a `kind` label (`recap`, `preview`, `commentary`) and
a `projection` flag.
