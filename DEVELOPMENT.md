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
pip install -r requirements.txt
cp .env.example .env      # then fill in the real DATABASE_URL
uvicorn app.main:app --reload
```

**Windows equivalent:**
```powershell
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env    # then fill in the real DATABASE_URL
uvicorn app.main:app --reload
```

Visit `http://127.0.0.1:8000/health` — it should return `{"status": "ok"}`
once `DATABASE_URL` points at a real, reachable Postgres instance. Auto-generated
API docs are at `http://127.0.0.1:8000/docs`.

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
