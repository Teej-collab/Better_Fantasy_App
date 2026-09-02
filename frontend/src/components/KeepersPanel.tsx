"use client";

import { useEffect, useState } from "react";
import {
  getMyKeepers,
  lockKeeperRules,
  setKeeperRules,
  unlockKeeperRules,
  updateMyKeepers,
  type MyKeepers,
} from "@/lib/api";

async function refreshKeepers(onChange: (data: MyKeepers) => void) {
  onChange(await getMyKeepers());
}

const AUTO_LOCK_WINDOW_MS = 60 * 60 * 1000;

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

// Only ever renders once the real backend auto-lock scheduler job
// (backend/app/scheduler.py's _run_keeper_lock_job) is about to fire —
// null outside that 1-hour window, same threshold that job itself
// checks against, so this never claims an auto-lock is imminent when
// it isn't. Client-only (deferred to useEffect, not computed at render
// time) for the same server/client clock-mismatch reason
// DraftCountdownCard.tsx's own countdown is — see that component's
// comment.
function useAutoLockCountdown(scheduledStart: string | null, locked: boolean): string | null {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    // The whole body runs inside setTimeout/setInterval callbacks, never
    // synchronously in the effect body itself — including the "nothing
    // to show" case — same lint-satisfying pattern DraftCountdownCard.tsx's
    // own countdown effect uses (react-hooks/set-state-in-effect).
    function tick() {
      if (!scheduledStart || locked) {
        setText(null);
        return;
      }
      const diff = new Date(scheduledStart).getTime() - Date.now();
      if (diff <= 0 || diff > AUTO_LOCK_WINDOW_MS) {
        setText(null);
        return;
      }
      const totalSeconds = Math.floor(diff / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      setText(`${minutes}:${pad(seconds)}`);
    }

    const kickoff = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [scheduledStart, locked]);

  return text;
}

/**
 * The owner-facing keeper picker (GET/PUT /keepers/me), plus — only
 * for the commissioner — an inline rules editor (PUT /keepers/rules,
 * POST /keepers/rules/lock|unlock). One panel rather than a separate
 * admin page since there's currently only one small commissioner
 * action here; split out if this grows.
 *
 * ESPN write-back does NOT happen anywhere in this component — locking
 * the season here only affects this app's own database. See the
 * project plan / backend/app/routers/keepers.py's module docstring for
 * why (an unverified reverse-engineering spike has to happen first).
 */
export function KeepersPanel({ isCommissioner }: { isCommissioner: boolean }) {
  const [data, setData] = useState<MyKeepers | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  // Called unconditionally (before the loading/error early returns
  // below) per the Rules of Hooks — data?.rules is undefined during
  // those states, so this just returns null then, same as always.
  const autoLockCountdown = useAutoLockCountdown(
    data?.rules.draft_scheduled_start ?? null,
    Boolean(data?.rules.locked_at)
  );

  useEffect(() => {
    getMyKeepers()
      .then((d) => {
        setData(d);
        setSelected(new Set(d.selections.map((s) => s.espn_player_id)));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load keepers"))
      .finally(() => setLoading(false));
  }, []);

  function toggle(playerId: number) {
    if (!data) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else if (next.size < data.rules.max_keepers) {
        next.add(playerId);
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await updateMyKeepers([...selected]);
      const fresh = await getMyKeepers();
      setData(fresh);
      setSelected(new Set(fresh.selections.map((s) => s.espn_player_id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your keepers");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;
  if (!data) return <p className="text-sm text-red-500">{error ?? "Couldn't load keepers."}</p>;

  const { rules, roster_pool: rosterPool } = data;

  return (
    <div className="flex flex-col gap-4">
      {isCommissioner && <CommissionerRules rules={rules} onChange={setData} />}

      <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
        {rules.max_keepers === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            Keeper selection hasn&apos;t been opened for this season yet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-black/60 dark:text-white/60">
                Pick up to <strong>{rules.max_keepers}</strong> keeper{rules.max_keepers === 1 ? "" : "s"} from
                last season&apos;s roster.
                {rules.keeper_deadline && (
                  <> Deadline: {new Date(rules.keeper_deadline).toLocaleString()}.</>
                )}
              </p>
              <span className="text-sm font-medium text-black/70 dark:text-white/70">
                {selected.size} / {rules.max_keepers} selected
              </span>
            </div>

            {!rules.is_open && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-2 text-xs text-black/70 dark:text-white/70">
                {rules.locked_at
                  ? "Keepers are locked in for this season — selections are read-only."
                  : "The keeper deadline has passed — selections are read-only."}
              </p>
            )}

            {rules.is_open && autoLockCountdown && (
              <p
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-2 text-xs font-medium text-red-600 tabular-nums dark:text-red-400"
              >
                Draft starts soon — keepers lock automatically in {autoLockCountdown}.
              </p>
            )}

            <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {rosterPool.length === 0 && (
                <p className="py-2 text-sm text-black/50 dark:text-white/50">
                  No roster found from last season to pick keepers from.
                </p>
              )}
              {rosterPool.map((p) => {
                const isSelected = selected.has(p.espn_player_id);
                const disabled = !rules.is_open || (!isSelected && (!p.eligible || selected.size >= rules.max_keepers));
                return (
                  <label
                    key={p.espn_player_id}
                    className={`flex items-center justify-between gap-2 py-2 text-sm ${disabled && !isSelected ? "opacity-40" : ""}`}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate font-medium">{p.player_name}</span>
                      <span className="text-xs text-black/50 dark:text-white/50">
                        {p.position ?? "—"} {p.pro_team ? `· ${p.pro_team}` : ""}
                        {!p.eligible && " · max years kept reached"}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={disabled}
                      onChange={() => toggle(p.espn_player_id)}
                      className="h-5 w-5 shrink-0"
                    />
                  </label>
                );
              })}
            </div>

            {rules.is_open && (
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="w-fit rounded-full bg-[var(--wl-accent)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save keepers"}
              </button>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

function CommissionerRules({
  rules,
  onChange,
}: {
  rules: MyKeepers["rules"];
  onChange: (data: MyKeepers) => void;
}) {
  const [maxKeepers, setMaxKeepers] = useState(String(rules.max_keepers || 1));
  const [maxYears, setMaxYears] = useState(rules.max_consecutive_years ? String(rules.max_consecutive_years) : "");
  const [deadline, setDeadline] = useState(rules.keeper_deadline ? rules.keeper_deadline.slice(0, 16) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await setKeeperRules({
        season: rules.season,
        max_keepers: Number(maxKeepers) || 0,
        max_consecutive_years: maxYears ? Number(maxYears) : null,
        keeper_deadline: deadline ? new Date(deadline).toISOString() : null,
      });
      await refreshKeepers(onChange);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save keeper rules");
    } finally {
      setBusy(false);
    }
  }

  async function toggleLock() {
    setBusy(true);
    setError(null);
    try {
      if (rules.locked_at) {
        await unlockKeeperRules(rules.season);
      } else {
        await lockKeeperRules(rules.season);
      }
      await refreshKeepers(onChange);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the lock");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
      <h2 className="text-sm font-semibold text-black/70 dark:text-white/70">
        Keeper rules for {rules.season} (Commissioner)
      </h2>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-black/50 dark:text-white/50">
          Max keepers
          <input
            type="number"
            min={0}
            value={maxKeepers}
            onChange={(e) => setMaxKeepers(e.target.value)}
            className="w-24 rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-black/50 dark:text-white/50">
          Max consecutive years (blank = no cap)
          <input
            type="number"
            min={1}
            value={maxYears}
            onChange={(e) => setMaxYears(e.target.value)}
            className="w-24 rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-black/50 dark:text-white/50">
          Deadline (blank = none)
          <input
            type="datetime-local"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={busy || Boolean(rules.locked_at)}
          className="rounded-full border border-black/10 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-white/10"
        >
          Save rules
        </button>
        <button
          type="button"
          onClick={toggleLock}
          disabled={busy}
          className="rounded-full border border-black/10 px-3 py-1.5 text-sm font-medium disabled:opacity-40 dark:border-white/10"
        >
          {rules.locked_at ? "Unlock keepers" : "Lock keepers"}
        </button>
        {rules.locked_at && (
          <span className="text-xs text-black/50 dark:text-white/50">
            Locked {new Date(rules.locked_at).toLocaleString()}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
    </section>
  );
}
