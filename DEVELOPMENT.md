# DEVELOPMENT.md

Local dev setup for `Better_Fantasy_App`. Two independent projects in this
repo: `backend/` (FastAPI) and `frontend/` (Next.js). Run them in separate
terminals during development.

The backend connects to the same Supabase Postgres project `Fantasy_Helper`
already uses. Per the Phase 1 decision in TODO.md, the backend is **read-only**
against that database until schema changes are explicitly approved — don't
add write queries without checking that's still the plan.

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
Its tables already exist (created by hand from the original `schema.sql`,
before Alembic existed in this project). The baseline migration
(`f8b66c486a5e_baseline_schema.py`) is only meant to bring up a *fresh*
database — local, test, or CI — to match what's already live. Bringing the
real production DB under Alembic's management is a one-time, deliberate
step (`alembic stamp f8b66c486a5e`, then `alembic upgrade head` for
anything after that) that should happen with your explicit go-ahead, not
automatically.

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
npm install
npm run dev
```

Visit `http://localhost:3000`.

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
