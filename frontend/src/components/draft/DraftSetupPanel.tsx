"use client";

import { useEffect, useState } from "react";
import {
  getDraftSchedule,
  pauseDraft,
  resetDraft,
  resumeDraft,
  seedKeepersIntoDraft,
  SeedKeepersError,
  setDraftSchedule,
  setupDraft,
  startDraft,
  undoLastPick,
  type DraftConfig,
  type SeededKeeper,
  type UnresolvedKeeper,
} from "@/lib/draftApi";
import type { Team } from "@/lib/api";

// This league's real ESPN roster shape (confirmed from the
// commissioner's own league settings — see the project plan): 1 QB, 2
// RB, 2 WR, 1 TE, 1 FLEX, 1 D/ST, 1 K, 7 bench. IR isn't included —
// this league's IR spot is never filled by the initial draft, only
// later via waivers.
const DEFAULT_ROSTER_SLOTS = { QB: 1, RB: 2, WR: 2, TE: 1, "RB/WR/TE": 1, "D/ST": 1, K: 1, BE: 7, IR: 1 };
const DEFAULT_PICK_SECONDS = 90; // matches this league's real ESPN draft setting

// Real ISO 8601 with offset -> the "YYYY-MM-DDTHH:mm" shape
// <input type="datetime-local"> needs, in the browser's own local time
// (not UTC — toISOString() would be wrong here, it's always UTC).
// Built by hand from the Date object's own local getters rather than
// any locale-formatting API, since this needs to round-trip exactly
// back into the same input, not be human-readable.
function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "Pacific Daylight Time (PDT)" — so the commissioner can see, right
// next to the input, which zone "8:00 PM" is about to mean before they
// save it. The value that actually gets sent (setDraftSchedule, above)
// already correctly uses whatever zone the browser is in regardless of
// this label; this is purely a confirmation, not something the save
// logic depends on. Computed via Intl, not written anywhere — Node
// (used for this component's initial server render, since it has no
// "use client"-only APIs otherwise) resolves Intl against the SERVER's
// own zone, not the visitor's, which would silently show the wrong
// zone name to the visitor until hydration; deferred to a client-only
// effect instead, same reasoning as DraftCountdownCard.tsx's own
// countdown.
function detectTimezoneLabel(): string {
  try {
    const now = new Date();
    const long = new Intl.DateTimeFormat(undefined, { timeZoneName: "long" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;
    const short = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;
    if (long && short && long !== short) return `${long} (${short})`;
    return long ?? short ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "your device's local time zone";
  }
}

function ScheduleEditor({
  scheduleInput,
  onScheduleInputChange,
  onSave,
  busy,
  saved,
  timezoneLabel,
}: {
  scheduleInput: string;
  onScheduleInputChange: (value: string) => void;
  onSave: () => void;
  busy: boolean;
  saved: boolean;
  timezoneLabel: string | null;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-t border-black/5 pt-2 dark:border-white/5">
      <label className="text-xs text-black/50 dark:text-white/50">
        Draft date/time
        <input
          type="datetime-local"
          value={scheduleInput}
          onChange={(e) => onScheduleInputChange(e.target.value)}
          className="ml-2 rounded-md border border-black/10 bg-transparent px-2 py-1 text-sm dark:border-white/10"
        />
      </label>
      <button
        onClick={onSave}
        disabled={busy || !scheduleInput}
        className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium disabled:opacity-40 dark:border-white/10"
      >
        Save date
      </button>
      {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved.</span>}
      {timezoneLabel && (
        <span className="w-full text-[11px] text-black/40 dark:text-white/40">Setting in {timezoneLabel}.</span>
      )}
    </div>
  );
}

export function DraftSetupPanel({
  teams,
  config,
  onDraftCreated,
}: {
  teams: Team[];
  config?: DraftConfig;
  onDraftCreated: () => void;
}) {
  const [order, setOrder] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<SeededKeeper[] | null>(null);
  const [unresolved, setUnresolved] = useState<UnresolvedKeeper[] | null>(null);
  const [scheduleInput, setScheduleInput] = useState(() =>
    config?.scheduled_start ? toDatetimeLocalValue(config.scheduled_start) : ""
  );
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [timezoneLabel, setTimezoneLabel] = useState<string | null>(null);

  useEffect(() => {
    // setTimeout(0), not a direct setState call in the effect body —
    // same lint-satisfying pattern DraftCountdownCard.tsx's own
    // countdown effect uses (react-hooks/set-state-in-effect).
    const id = setTimeout(() => setTimezoneLabel(detectTimezoneLabel()), 0);
    return () => clearTimeout(id);
  }, []);

  // No real draft exists yet (config is undefined) — a previously-set
  // date lives in league_draft_schedule, not on any config this
  // component was handed, so it needs its own fetch to pre-fill the
  // input (see backend/app/routers/draft.py's GET /draft/schedule).
  // Skipped entirely once a real draft exists: config.scheduled_start
  // (read by the useState initializer above) is already the single
  // source of truth at that point.
  useEffect(() => {
    if (config) return;
    let cancelled = false;
    getDraftSchedule()
      .then(({ scheduled_start }) => {
        if (!cancelled && scheduled_start) setScheduleInput(toDatetimeLocalValue(scheduled_start));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleOwner(ownerId: number) {
    setOrder((prev) => (prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : [...prev, ownerId]));
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDraftCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function seedKeepers() {
    setBusy(true);
    setError(null);
    setSeeded(null);
    setUnresolved(null);
    try {
      const result = await seedKeepersIntoDraft();
      setSeeded(result);
      onDraftCreated();
    } catch (e) {
      if (e instanceof SeedKeepersError) {
        setUnresolved(e.unresolved);
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : "Seeding keepers failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveSchedule() {
    if (!scheduleInput) return;
    setBusy(true);
    setError(null);
    setScheduleSaved(false);
    try {
      await setDraftSchedule(scheduleInput);
      setScheduleSaved(true);
      onDraftCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the draft date");
    } finally {
      setBusy(false);
    }
  }

  function confirmReset() {
    const message =
      config?.status === "complete" || config?.status === "in_progress"
        ? "This wipes every pick and roster this draft has made — for real, not just a mock. Reset anyway?"
        : "This deletes the current draft order and setup. Reset?";
    if (window.confirm(message)) run(resetDraft);
  }

  if (!config) {
    return (
      <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
        <h2 className="text-sm font-semibold">Commissioner: set up the draft</h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          Click teams below in the order they should pick (round 1 order — later rounds snake automatically).
        </p>
        <div className="flex flex-wrap gap-2">
          {teams.map((t) => {
            const position = order.indexOf(t.owner_id);
            return (
              <button
                key={t.owner_id}
                onClick={() => toggleOwner(t.owner_id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${
                  position >= 0
                    ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    : "border-black/10 text-black/60 dark:border-white/10 dark:text-white/60"
                }`}
              >
                {position >= 0 && `${position + 1}. `}
                {t.team_name}
              </button>
            );
          })}
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          onClick={() => run(() => setupDraft(order, DEFAULT_ROSTER_SLOTS, DEFAULT_PICK_SECONDS))}
          disabled={busy || order.length !== teams.length}
          className="w-fit rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {order.length !== teams.length
            ? `Select all ${teams.length} teams (${order.length}/${teams.length})`
            : "Create draft"}
        </button>
        {/* Settable independently of the order above — a commissioner
            can nail down the real date first and decide the order
            later; PUT /draft/schedule holds it until a real draft
            exists (see backend/app/domain/draft_engine.py's
            create_draft, which carries it over automatically once this
            form's "Create draft" button is used). */}
        <ScheduleEditor
          scheduleInput={scheduleInput}
          onScheduleInputChange={(value) => {
            setScheduleInput(value);
            setScheduleSaved(false);
          }}
          onSave={saveSchedule}
          busy={busy}
          saved={scheduleSaved}
          timezoneLabel={timezoneLabel}
        />
      </section>
    );
  }

  const teamNameByOwner = new Map(teams.map((t) => [t.owner_id, t.team_name]));

  return (
    <section className="neon-panel flex flex-wrap items-center gap-2 rounded-xl p-4">
      {error && <p className="w-full text-xs text-red-500">{error}</p>}
      <p className="w-full text-xs text-black/50 dark:text-white/50">
        Draft order: {config.draft_order.map((id, i) => `${i + 1}. ${teamNameByOwner.get(id) ?? id}`).join(" · ")}
      </p>
      {/* Separate from Setup/Reset above on purpose — the real date can
          be nailed down or adjusted independently, without touching
          the order/roster shape. Drives the homepage's countdown card
          (DraftCountdownCard.tsx) once set. */}
      <ScheduleEditor
        scheduleInput={scheduleInput}
        onScheduleInputChange={(value) => {
          setScheduleInput(value);
          setScheduleSaved(false);
        }}
        onSave={saveSchedule}
        busy={busy}
        saved={scheduleSaved}
        timezoneLabel={timezoneLabel}
      />
      {seeded && seeded.length > 0 && (
        <p className="w-full text-xs text-emerald-600 dark:text-emerald-400">
          Seeded {seeded.length} keeper{seeded.length === 1 ? "" : "s"} into round {seeded[0].round}:{" "}
          {seeded.map((s) => `${teamNameByOwner.get(s.owner_id) ?? s.owner_id} (${s.player_name})`).join(", ")}
        </p>
      )}
      {seeded && seeded.length === 0 && !unresolved && (
        <p className="w-full text-xs text-black/50 dark:text-white/50">
          Nothing to seed — no locked keeper selections found, or every owner was already seeded.
        </p>
      )}
      {unresolved && unresolved.length > 0 && (
        <div className="w-full rounded-lg border border-red-500/30 bg-red-500/[0.06] p-2 text-xs text-red-500">
          <p className="font-medium">Couldn&apos;t match these keepers to a player in our database — nothing was seeded:</p>
          <ul className="mt-1 list-disc pl-4">
            {unresolved.map((u) => (
              <li key={`${u.owner_id}-${u.espn_player_id}`}>
                {teamNameByOwner.get(u.owner_id) ?? u.owner_id}: {u.player_name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {config.status === "not_started" && (
        <>
          <button
            onClick={seedKeepers}
            disabled={busy}
            className="rounded-full border border-emerald-500/40 px-3 py-1 text-xs font-medium text-emerald-600 disabled:opacity-40 dark:text-emerald-400"
          >
            Seed keepers
          </button>
          <button
            onClick={() => run(startDraft)}
            disabled={busy}
            className="rounded-full bg-sky-500 px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            Start draft
          </button>
        </>
      )}
      {config.status === "in_progress" && (
        <>
          <button
            onClick={() => run(pauseDraft)}
            disabled={busy}
            className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium dark:border-white/10"
          >
            Pause
          </button>
          <button
            onClick={() => run(undoLastPick)}
            disabled={busy}
            className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium dark:border-white/10"
          >
            Undo last pick
          </button>
        </>
      )}
      {config.status === "paused" && (
        <button
          onClick={() => run(resumeDraft)}
          disabled={busy}
          className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
        >
          Resume
        </button>
      )}
      {config.status === "complete" && <span className="text-xs text-black/50 dark:text-white/50">Draft complete.</span>}
      <button
        onClick={confirmReset}
        disabled={busy}
        className="rounded-full border border-red-500/30 px-3 py-1 text-xs font-medium text-red-500 disabled:opacity-40"
      >
        Reset draft
      </button>
    </section>
  );
}
