"""In-memory "when did each scheduled job last actually finish"
tracker for the admin System Health panel (app/routers/admin.py's GET
/admin/system-health). Deliberately not a DB table: what a real
operator needs from this is "has data stayed fresh since this process
came up," not a permanent audit log — a restart legitimately clearing
this is the correct behavior, not a gap. app/scheduler.py's job
functions call record_job_run(name) at the end of a successful run;
a job that's currently OFF (see that file's own docstring on the
default-off env flags) or that errored before finishing just never
gets an entry, which get_job_statuses() reports as "never run" rather
than guessing.
"""
from datetime import datetime, timezone

_last_run: dict[str, datetime] = {}


def record_job_run(name: str) -> None:
    _last_run[name] = datetime.now(timezone.utc)


def get_job_statuses() -> dict[str, str | None]:
    return {name: dt.isoformat() for name, dt in _last_run.items()}


# Every scheduled job's ticks, successful or not (2026-10-22, for the
# website's live system map): app/scheduler.py's _leader_only wrapper
# records each run by job id, so a job that fails every tick shows up
# as failing instead of just going quiet.
_ticks: dict[str, dict] = {}


def record_tick(job_id: str, ok: bool, error: str | None = None) -> None:
    now = datetime.now(timezone.utc)
    tick = _ticks.setdefault(job_id, {"runs": 0, "failures": 0, "last_ok": None, "last_error": None, "last_error_at": None})
    tick["runs"] += 1
    if ok:
        tick["last_ok"] = now
    else:
        tick["failures"] += 1
        tick["last_error"] = error
        tick["last_error_at"] = now


def get_job_ticks() -> dict[str, dict]:
    return {
        job_id: {**tick, "last_ok": tick["last_ok"] and tick["last_ok"].isoformat(), "last_error_at": tick["last_error_at"] and tick["last_error_at"].isoformat()}
        for job_id, tick in _ticks.items()
    }


PROCESS_STARTED_AT = datetime.now(timezone.utc)
