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


PROCESS_STARTED_AT = datetime.now(timezone.utc)
