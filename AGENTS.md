# Base44 Dev Environment

## Stack
- **Backend**: Python 3.13, FastAPI + uvicorn (`--reload`), asyncpg (no ORM), Alembic migrations (hand-written raw SQL). Lives in `backend/`.
- **Frontend**: Next.js 16 (Turbopack), React 19, Tailwind 4. Lives in `frontend/`.
- **Database**: PostgreSQL 16 (compose service `db`, user/db `bfa`).

## Running
```
docker compose -f docker-compose.base44.yml up -d
```
- Frontend (port 3000) → public preview entry point.
- Backend (port 8000) → internal only, reached by the frontend via docker DNS (`http://backend:8000`).
- DB → internal only.

## Architecture notes
- **Single-origin wiring**: only port 3000 is public. The frontend's `/api/backend/[...path]` route proxies authenticated client-side calls to the backend (reads the first-party session cookie server-side, forwards it). `NEXT_PUBLIC_API_BASE_URL=http://backend:8000` is used for SSR fetches only — client-side code must not call it directly (the hostname doesn't resolve in a browser).
- **No external credentials needed to boot**: all secrets (ESPN S2/SWID, Discord OAuth, Anthropic, Sportradar, VAPID) are lazy — only loaded when the relevant route/config is instantiated, not at import time. The only required-at-boot env is `DATABASE_URL` (provided by compose). The logged-out home page renders via ESPN's **public, unauthenticated** scoreboard API.
- **All schedulers off by default** (`ENABLE_*` env vars default false in `.env.base44-defaults`).
- **Migrations** run automatically on backend startup (`alembic upgrade head` chained in the command).
- **Chug analyzer** (`requirements-chug-analyzer.txt`) needs a separate Python 3.11 venv with mediapipe — not included in compose; optional CV pipeline.

## Next.js dev origins
`frontend/next.config.ts` derives `allowedDevOrigins` from `BASE44_PUBLIC_HOST_SUFFIX` (the preview proxy hostname) and `NEXT_PUBLIC_API_BASE_URL` (LAN testing). Next.js 16 blocks dev assets/HMR for unknown origins — a bare `'*'` does not match.

## Optional secrets (set via dashboard if needed)
`ESPN_LEAGUE_ID`, `ESPN_S2`, `ESPN_SWID` (sync), `DISCORD_CLIENT_ID`/`SECRET` (login), `ANTHROPIC_API_KEY` (narrative engine), `SPORTRADAR_API_KEY` (gamecast), `VAPID_*` (web push). None are required to boot or view the preview.
