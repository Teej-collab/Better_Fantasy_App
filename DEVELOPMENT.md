# DEVELOPMENT.md

Local dev setup for `Better_Fantasy_App`. Two independent projects in this
repo: `backend/` (FastAPI) and `frontend/` (Next.js). Run them in separate
terminals during development.

The backend connects to the same Supabase Postgres project `Fantasy_Helper`
already uses. Schema changes (migrations) against that production database
still need your explicit go-ahead — see Migrations below. As of Phase 3,
the backend does write data (ESPN sync populates teams/matchups/rosters),
but only when deliberately triggered: `POST /admin/sync`, or the scheduled
job if `ENABLE_ESPN_SYNC_SCHEDULER=true` is set (off by default). Nothing
syncs automatically just from running the backend.

### Connecting to Supabase — two gotchas that will otherwise waste an hour

1. **Use the connection *pooler* string, not the direct one.** Supabase's
   direct host (`db.<project-ref>.supabase.co`) is IPv6-only. If your
   network has no IPv6 route (common on home ISPs), it fails DNS
   resolution outright. Use the pooler string instead — dashboard →
   Project Settings → Database → Connection string → "Transaction" or
   "Session" pooler mode. It looks like
   `postgresql://postgres.<project-ref>:[password]@aws-0-<region>.pooler.supabase.com:6543/postgres`
   — note the username becomes `postgres.<project-ref>`, not just `postgres`.
2. **Transaction-mode pgbouncer breaks asyncpg's prepared statements** —
   you'll see `DuplicatePreparedStatementError`. `app/db.py` already
   passes `statement_cache_size=0` to `asyncpg.create_pool(...)` to work
   around this; if you're writing a one-off script that connects directly
   with `asyncpg.connect(...)` instead of going through `get_pool()`,
   pass that same argument or you'll hit the same error.

---

## Backend (FastAPI)

**Mac (what was actually used to set this up):**
```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt   # runtime deps + pytest/httpx
cp .env.example .env      # then fill in the real DATABASE_URL
uvicorn app.main:app --reload
```

**Windows equivalent:**
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env    # then fill in the real DATABASE_URL
uvicorn app.main:app --reload
```

(`requirements.txt` alone has only runtime deps, for production installs.)

Visit `http://127.0.0.1:8000/health` — it should return `{"status": "ok"}`
once `DATABASE_URL` points at a real, reachable Postgres instance. Auto-generated
API docs are at `http://127.0.0.1:8000/docs`.

### Chug Analyzer's second Python environment

`app/chug_analyzer/` (the CV pipeline behind `POST /chug/upload`) depends
on mediapipe, which has no working build for the main backend's Python
3.13 — same constraint Fantasy_Helper's `venv311` exists for. It needs
its own Python 3.11 environment, set up once, separate from `.venv`:

```bash
cd backend
python3.11 -m venv venv311   # brew install python@3.11 first if you don't have it
source venv311/bin/activate
pip install -r requirements-chug-analyzer.txt
deactivate
```

The main backend (running in `.venv`, Python 3.13) shells out to
`venv311/bin/python` as a subprocess for each upload
(`app/providers/chug_analyzer_bridge.py`) — it never imports
`app.chug_analyzer` directly. `CHUG_ANALYZER_PYTHON` overrides the
interpreter path if `venv311` lives somewhere other than
`backend/venv311`. Without this environment set up, `/chug/upload`
fails with "Chug analyzer subprocess failed" (venv311/bin/python not
found) — every other endpoint is unaffected.

**Version pins matter more than usual here** — see the comment at the
top of `requirements-chug-analyzer.txt`: the latest mediapipe (1.0.x)
dropped the legacy `mp.solutions` API this pipeline is built on
entirely, in favor of a new Tasks API. `0.10.21` is confirmed to still
install cleanly and work on Python 3.11 / Apple Silicon; don't bump it
without re-verifying `mp.solutions.hands.Hands()` still instantiates.

### Migrations (Alembic)

Migrations are hand-written raw SQL (`op.execute(...)`), not ORM
autogenerate — this project has no ORM, matching Fantasy_Helper's
asyncpg-only style. `DATABASE_URL` (from `.env` / the environment) is what
Alembic connects to, same as the app itself.

```bash
alembic upgrade head        # apply all migrations
alembic downgrade base      # tear back down to nothing
alembic revision -m "..."   # start a new migration
```

**Do not run `alembic upgrade` against the production Supabase database.**
Its tables already exist (created by hand, before Alembic existed in this
project). The baseline migration (`f8b66c486a5e_baseline_schema.py`) is
only meant to bring up a *fresh* database — local, test, or CI — to match
what's already live. Bringing the real production DB under Alembic's
management is a one-time, deliberate step (`alembic stamp f8b66c486a5e`,
then `alembic upgrade head` for anything after that) that should happen
with your explicit go-ahead, not automatically.

**`db/schema.sql` (in Fantasy_Helper) turned out to be stale.** A
read-only introspection of the real production database on Aug 19 2026
found 6 tables (`bench_crimes`, `chug_debts`, `season_champions`,
`season_awards`, `owner_nicknames`, `chug_weekly_status`) and several
columns (`rosters.is_boom`/`is_bust`, `weekly_team_stats.team_points_projected`,
`rivalries.name`/`emoji`/`tagline`/`description`/`tier`,
`chug_scores.season`/`week`) that exist live but were never in
`schema.sql`. The baseline migration here has been corrected to match
what's actually live, not what the file said — if you're ever comparing
this project's schema against Fantasy_Helper's `db/schema.sql` again,
know that file is out of date and the migration in this repo is the more
current reference.

### Running tests

Tests hit a real local Postgres (not Supabase) — `/health` genuinely
exercises the DB connection, so mocking it would test less than the code
actually does. You need a disposable local Postgres instance and a test
database, separate from the production Supabase project entirely:

**Mac:**
```bash
brew install postgresql@16
pg_ctl -D /opt/homebrew/var/postgresql@16 -l /tmp/pg16.log start
createdb better_fantasy_app_test

cd backend
source .venv/bin/activate
export DATABASE_URL="postgresql://$(whoami)@localhost:5432/better_fantasy_app_test"
alembic upgrade head
pytest -v

pg_ctl -D /opt/homebrew/var/postgresql@16 stop   # when done
```

**Windows equivalent:** install PostgreSQL from
[postgresql.org](https://www.postgresql.org/download/windows/) (or
`winget install PostgreSQL.PostgreSQL`), which registers it as a Windows
service, then:
```powershell
createdb better_fantasy_app_test
cd backend
.venv\Scripts\activate
set DATABASE_URL=postgresql://postgres:<password>@localhost:5432/better_fantasy_app_test
alembic upgrade head
pytest -v
```

### ESPN sync

`app/providers/espn/adapter.py` ports Fantasy_Helper's
`sync_teams.py`/`sync_matchups.py`/`sync_rosters.py` behind the
`FantasyProvider` interface (`app/providers/base.py`), unchanged logic —
see MIGRATION_MAP.md. It's covered by `tests/test_espn_adapter.py` using
fake ESPN API responses (`tests/fakes_espn.py`), so the upsert/skip/stop
logic is verified without needing real ESPN credentials or a live network
call.

Running it against **real** ESPN data — locally or in production — is a
separate, deliberate step:

1. Fill in `ESPN_LEAGUE_ID`, `ESPN_S2`, `ESPN_SWID`, `ACTIVE_SEASON`, and
   `LEAGUE_START_SEASON` in `backend/.env` (your own values — never paste
   these into chat; see Notes below). `ADMIN_SYNC_TOKEN` too, if using the
   HTTP endpoint.
2. Trigger it manually, either:
   - `POST /admin/sync` with header `X-Admin-Token: <your ADMIN_SYNC_TOKEN>`
     while the backend is running, or
   - a small script that constructs `ESPNProvider()` and calls
     `app.providers.sync.run_full_sync(...)` directly.
3. Point `DATABASE_URL` at whichever database you actually want written to.
   **Pointing it at production Supabase is the moment this stops being a
   dev exercise** — confirm that's actually intended first, same as any
   other production write.

The scheduled job (`app/scheduler.py`) does the same thing on a timer
(`SYNC_INTERVAL_HOURS`, default 24) but only if `ENABLE_ESPN_SYNC_SCHEDULER`
is explicitly set truthy — left off by default so no one's local dev
backend starts quietly syncing real league data on a schedule.

### Live sync (in-game updates)

The full sync above re-scans *all* history every run — fine daily, too
slow and wasteful to poll every few minutes. `run_live_sync` (in
`app/providers/sync.py`) is a separate, narrow path: re-syncs only the
*current* week's matchups and rosters (one ESPN call each, not a 1-17
week scan), then recomputes boom/bust for just that week. Re-running it
naturally picks up roster/lineup changes too, since roster sync always
replaces that week's data wholesale.

- **Manual trigger:** `POST /admin/sync/live` (same `X-Admin-Token`
  header as `/admin/sync`). Ignores the game-window gate — if you're
  asking for it directly, it runs.
- **Scheduled:** off by default (`ENABLE_LIVE_SYNC_SCHEDULER=true` to
  turn on). When on, it ticks every `LIVE_SYNC_INTERVAL_MINUTES`
  (default 5) but only actually calls ESPN during an NFL game window
  (`app/game_windows.py`: Thursday/Sunday/Monday evenings, generously
  bounded — doesn't cover the rare Saturday-only late-season slate).
  This gating was a deliberate choice, not an oversight: ESPN's API is
  unofficial (see ARCHITECTURE.md) and there's no reason to poll it at
  3am on a Tuesday.

**Not yet verified against a real live game** — as of this writing the
2026 season hasn't started (`get_current_week` correctly returns 0), so
there's nothing in progress to test the "does this actually track a
live-scoring game" behavior against. The mechanism itself is tested
(`tests/test_espn_adapter.py`, `tests/test_game_windows.py`) and
`get_current_week` has been confirmed working against real ESPN — the
end-to-end "watch a real Sunday" check has to wait for an actual Sunday.

### Discord login (Phase 5)

Sign-in is "Sign in with Discord," verified against `owners.discord_user_id`
(real league membership, already synced from ESPN) — see TODO.md's Phase 5
notes for why this approach was chosen over email/password or a (nonexistent)
"Sign in with ESPN." Covered by mocked tests (`tests/test_auth.py`,
`tests/test_session.py`) — Discord's OAuth endpoints aren't hit in tests,
so this hasn't been verified against a real login yet.

**One-time setup — registering a Discord application** (only you can do
this, it needs your Discord account):

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) →
   **New Application** → name it anything (e.g. "Better Fantasy App").
2. **OAuth2** tab → **Redirects** → add `http://localhost:8000/auth/discord/callback`
   exactly (must match `DISCORD_REDIRECT_URI` below character-for-character).
3. Same tab: copy the **Client ID**, and click **Reset Secret** to get a
   **Client Secret**.
4. Add to `backend/.env` (not `.env.example` — see the note about that
   mistake earlier in this project):
   ```
   DISCORD_CLIENT_ID=<from step 3>
   DISCORD_CLIENT_SECRET=<from step 3>
   DISCORD_REDIRECT_URI=http://localhost:8000/auth/discord/callback
   ```
   `SESSION_SECRET` is already set (a random value was generated for you
   when this feature was built) — don't need to touch it. Optionally set
   `COMMISSIONER_DISCORD_ID` to your own Discord user ID (right-click your
   name in Discord with Developer Mode on → Copy User ID) to get the
   `is_commissioner` flag on your session.
5. For someone to actually be able to log in, their real Discord user ID
   needs to already be in `owners.discord_user_id` for some owner row —
   this should already be true for anyone whose ESPN-linked Discord account
   was captured during a sync; check with `SELECT display_name,
   discord_user_id FROM owners` if unsure.

Once set, visiting `http://localhost:8000/auth/discord/login` in a browser
(or clicking "Sign in with Discord" in the app nav) should redirect to a
real Discord consent screen and back.

---

## Frontend (Next.js)

Requires Node.js (LTS). This project was set up using `nvm` to manage Node
versions:

**Mac:**
```bash
brew install nvm
mkdir -p ~/.nvm
# add to ~/.zshrc:
#   export NVM_DIR="$HOME/.nvm"
#   [ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && \. "/opt/homebrew/opt/nvm/nvm.sh"
nvm install --lts
nvm alias default 'lts/*'
```

**Windows equivalent:** install [nvm-windows](https://github.com/coreybutler/nvm-windows),
then:
```powershell
nvm install lts
nvm use lts
```

Then, on either platform:
```bash
cd frontend
cp .env.local.example .env.local   # points at http://localhost:8000 by default
npm install
npm run dev
```

Visit `http://localhost:3000`. The backend must be running too (see above)
— every page fetches real data server-side at request time (no caching),
so an unreachable backend means every page 500s.

### Testing on your phone (same WiFi network)

Three separate things all have to point at your Mac's LAN IP, not
`localhost` — `localhost` on your phone means the phone itself:

1. Find your Mac's LAN IP: `ipconfig getifaddr en0` (or `en1`).
2. `frontend/.env.local` — set `NEXT_PUBLIC_API_BASE_URL` to
   `http://<that-ip>:8000`. This one's easy to miss because the site
   still *loads* fine without it (server-rendered pages fetch from the
   Mac itself, not the phone) — it's specifically the client-side
   interactive bits (dropdowns, toggles, anything with an onClick) that
   silently fail without it, since those fetches happen in the phone's
   own browser.
3. `backend/.env` — add `http://<that-ip>:3000` to
   `CORS_ALLOWED_ORIGINS` (comma-separated), or the browser will block
   those same client-side requests.

`next.config.ts`'s `allowedDevOrigins` is derived automatically from
step 2's `NEXT_PUBLIC_API_BASE_URL`, so there's no separate IP to keep
in sync there — but it's worth knowing what it's for: Next.js 16's dev
server blocks serving its own JS bundle (including hot-reload) to any
origin except `localhost` by default. Without it, the page looks like
it loaded but **nothing is actually interactive** — React never
hydrates, so every click/change handler is just dead HTML. That's the
failure mode that's easy to miss, since there's no error on screen,
only a warning in the terminal running `npm run dev`.

Restart both `uvicorn` and `next dev` after changing either `.env` —
they're only read at process start. Then visit `http://<that-ip>:3000`
from your phone. If the IP ever changes (router reassigns the lease),
update `NEXT_PUBLIC_API_BASE_URL` and `CORS_ALLOWED_ORIGINS` and
restart both again.

### Phase 4 pages

Dashboard (`/`), Standings (`/standings`), League (`/league`), Team roster
(`/teams/[teamId]`), a week's matchups (`/seasons/[season]/weeks/[week]`),
and a single matchup box score (`/matchups/[matchupId]`) — all server
components, all reading `app/queries/league.py`'s plain SQL aggregation
(not the stats_engine ports, which are Phase 6). No auth yet, so "Team"
is browsable by ID rather than a personalized "My Team" — that becomes
free once Phase 5 links a logged-in user to their owner record. No design
pass was done here (plain Tailwind, functional over polished) — worth a
proper look once the page set stabilizes.

---

## Notes

- `backend/.env` and `frontend/.env*` are gitignored — never commit real
  credentials. Copy from the `.env.example` files and fill in locally.
- The backend's `DATABASE_URL` is a real production connection string
  (Supabase). Treat it with the same care as any other production secret —
  it is not safe to paste into chat, screenshots, or issue trackers.
- The local Postgres instance used for testing (`better_fantasy_app_test`)
  is completely separate from the production Supabase database — different
  server, different `DATABASE_URL`. Never point `pytest` at the real
  Supabase connection string.
- `pytest` currently prints a `StarletteDeprecationWarning` about `httpx`
  being deprecated in favor of something called `httpx2`. That's not a
  typo — Starlette (1.6.0) and FastAPI (0.141.1) here are newer than
  Claude's training data covers, so some specifics (like this) may be
  unfamiliar. It doesn't fail the test run; worth a quick check of current
  FastAPI/Starlette docs before relying on assumptions about this stack
  from an older knowledge base.
