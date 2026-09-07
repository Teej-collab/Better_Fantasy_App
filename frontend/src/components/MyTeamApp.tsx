"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  dropPlayer,
  getMyTeam,
  getMyTeamOwnership,
  submitLineupMove,
  submitLineupSwap,
  type MyTeam,
  type OwnershipInfo,
  type RosterEntry,
} from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { nflTeamName } from "@/lib/nfl-teams";
import { BENCH_SLOT_LABEL, isEligibleForSlot, slotDisplayLabel, STARTER_SLOT_ORDER } from "@/lib/rosterSlots";
import { formatGameTime } from "@/lib/gameTime";

// Which starter slots this position is eligible for at all (e.g. an RB
// can go RB or FLEX) — the set of destinations editLineupOptions below
// ever offers alongside the bench.
function eligibleStarterSlotsFor(position: string): string[] {
  return STARTER_SLOT_ORDER.filter((slot) => isEligibleForSlot(position, slot));
}

const BENCH_SLOTS = new Set([BENCH_SLOT_LABEL, "IR"]);

type EditLineupOption = { slot: string; occupant: RosterEntry | null };

// Every real destination `entry` could move to right now — one row per
// open or occupied slot across every eligible starter position plus
// the bench, using the exact same eligibility/capacity rules the
// backend enforces (app/domain/lineup_engine.py's is_eligible_for_slot/
// _find_displacement) so nothing offered here can ever be rejected by
// the real submit. Includes entry's own current slot (so the modal can
// show "already here") — callers filter that one out of what's
// actually clickable.
function editLineupOptions(entry: RosterEntry, roster: RosterEntry[], rosterSlots: Record<string, number>): EditLineupOption[] {
  const options: EditLineupOption[] = [];
  for (const slot of eligibleStarterSlotsFor(entry.position)) {
    const capacity = rosterSlots[slot] ?? 0;
    const occupants = roster.filter((r) => r.lineup_slot === slot);
    for (const occupant of occupants) options.push({ slot, occupant });
    if (occupants.length < capacity) options.push({ slot, occupant: null });
  }
  options.push(entry.lineup_slot === BENCH_SLOT_LABEL ? { slot: BENCH_SLOT_LABEL, occupant: entry } : { slot: BENCH_SLOT_LABEL, occupant: null });
  return options;
}

function RosterRow({
  entry,
  ownership,
  mounted,
  onOpenEdit,
  onViewPlayer,
  onDrop,
}: {
  entry: RosterEntry;
  ownership: OwnershipInfo | undefined;
  mounted: boolean;
  onOpenEdit: (entry: RosterEntry) => void;
  onViewPlayer: (sleeperPlayerId: string) => void;
  onDrop: (entry: RosterEntry) => void;
}) {
  return (
    <li className="flex items-center gap-2.5 border-b border-black/5 py-3 last:border-0 dark:border-white/5">
      <button
        onClick={() => onOpenEdit(entry)}
        title="Edit lineup"
        className="shrink-0 rounded-full border border-black/10 px-2 py-1 text-center text-[10px] font-semibold text-black/60 hover:border-sky-500 hover:text-sky-600 dark:border-white/10 dark:text-white/60 dark:hover:text-sky-400"
      >
        {slotDisplayLabel(entry.lineup_slot)}
      </button>
      <span className="relative inline-flex shrink-0">
        <PlayerHeadshot sleeperPlayerId={entry.player_id} proTeam={entry.pro_team} name={entry.player_name} size={36} />
        {/* Only ever shown during an actual in-progress game (see
            RosterEntry's own comment in api.ts) — red for red zone,
            amber for on offense elsewhere on the field, matching the
            Sleeper reference's own color legend. Never implies live
            status any other time. */}
        {entry.is_redzone ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-[var(--background)]"
            title="In the red zone"
          />
        ) : entry.on_offense ? (
          <span
            className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-[var(--background)]"
            title="On offense"
          />
        ) : null}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          onClick={() => onViewPlayer(entry.player_id)}
          className="truncate text-left text-sm font-medium hover:underline"
        >
          {entry.player_name}
        </button>
        <span className="text-xs text-black/50 dark:text-white/50">
          {entry.position} · {nflTeamName(entry.pro_team ?? undefined) ?? entry.pro_team ?? "—"}
        </span>
        {entry.next_opponent && (
          <span className="text-xs text-black/50 dark:text-white/50">
            {entry.next_opponent}
            {/* Only rendered post-mount: toLocaleDateString/
                toLocaleTimeString format using the runtime's local
                timezone, which for the server process (Railway, UTC)
                will commonly disagree with the visitor's real browser
                timezone. Rendering this during SSR would produce text
                that mismatches what the client renders on first paint,
                forcing React to discard and rebuild this whole row
                during hydration — a visible jump confined to this page
                (2026-09 mobile audit finding). Server and the first
                client paint both render nothing here instead, so
                there's nothing to mismatch; it fills in right after. */}
            {entry.game_time && mounted && ` · ${formatGameTime(entry.game_time)}`}
          </span>
        )}
        {entry.bye_week !== null && (
          <span className="text-xs text-black/50 dark:text-white/50">Bye: Week {entry.bye_week}</span>
        )}
        {ownership?.percent_owned !== null && ownership?.percent_owned !== undefined && (
          <span className="text-xs text-black/50 dark:text-white/50">{ownership.percent_owned.toFixed(0)}% owned</span>
        )}
        {entry.injury_status && entry.injury_status !== "ACTIVE" && (
          <span className="mt-0.5 w-fit rounded-full bg-red-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 uppercase dark:text-red-400">
            {entry.injury_status}
          </span>
        )}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums text-black/80 dark:text-white/80">
          {entry.points !== null ? entry.points.toFixed(1) : "—"}
        </span>
        {entry.points_projected !== null && (
          <span className="text-[11px] tabular-nums text-black/50 dark:text-white/50">
            Proj {entry.points_projected.toFixed(1)}
          </span>
        )}
        <button
          onClick={() => onDrop(entry)}
          className="rounded-full border border-red-500/20 px-2 py-1 text-[11px] font-medium text-red-500/70 hover:bg-red-500/10 hover:text-red-500"
        >
          Drop
        </button>
      </div>
    </li>
  );
}

// Live offense/red-zone status only ever matters during an actual
// live window — polling any other time would just be background
// requests for data that can't change (same "only during a live
// window, nothing otherwise" discipline GameDayRefresher.tsx already
// established for the homepage/ticker). This component owns its own
// client-side fetch already (unlike a server component), so a
// conditional interval here does the same job router.refresh() does
// there.
const LIVE_POLL_INTERVAL_MS = 15 * 1000;

export function MyTeamApp({
  isGameDay,
  initialTeam,
  initialOwnership,
}: {
  isGameDay: boolean;
  initialTeam: MyTeam | null;
  initialOwnership: Record<string, OwnershipInfo> | null;
}) {
  const [team, setTeam] = useState<MyTeam | null>(initialTeam);
  const [ownership, setOwnership] = useState<Record<string, OwnershipInfo>>(initialOwnership ?? {});
  const [error, setError] = useState<string | null>(null);
  // Gates client-locale-dependent formatting (see formatGameTime's call
  // site in RosterRow) — false during SSR and the first client render
  // (identical on both sides, no hydration mismatch), true immediately
  // after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // setTimeout(0), not a direct setState call in the effect body —
    // same lint-satisfying pattern used across this app's other mount
    // effects (see settings/FeedbackSection.tsx's RecentFeedback).
    const id = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(id);
  }, []);
  // The one player currently being edited — opens a bottom-sheet
  // listing every real destination for them (see editLineupOptions).
  // Tapping a destination submits immediately, no separate preview/
  // confirm step — matches the reference ESPN flow this was modeled
  // on (2026-09): tap a player's slot pill, tap where they're going,
  // done.
  const [editingEntry, setEditingEntry] = useState<RosterEntry | null>(null);
  const [actioning, setActioning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<RosterEntry | null>(null);
  const [dropping, setDropping] = useState(false);
  const { openPlayerCard } = usePlayerCard();

  useEffect(() => {
    // team/page.tsx server-fetches the roster and passes it as
    // initialTeam so the common case never needs this at all — this is
    // only a fallback for the rare case the server-side fetch itself
    // came back empty (e.g. a session that expired between page render
    // and this component mounting).
    if (initialTeam) return;
    getMyTeam()
      .then(setTeam)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load your team"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // team/page.tsx server-fetches this alongside the roster and passes it
  // as initialOwnership so the common case never needs this at all — a
  // "% owned" line (see RosterRow) appearing on every covered row only
  // after this resolved was the dominant cause of a reported layout
  // shift on this page (2026-09 mobile audit). This is only a fallback
  // for the rare case the server-side fetch itself came back empty (see
  // getMyTeamOwnershipServer's own comment on the null-vs-{} distinction).
  // A real, multi-second live ESPN call — only covers the ~22% of
  // players Sleeper's crosswalk can resolve to an ESPN id (see api.ts's
  // getMyTeamOwnership); silently absent for the rest rather than
  // erroring the whole page over a partial-coverage feature.
  useEffect(() => {
    if (initialOwnership !== null) return;
    getMyTeamOwnership()
      .then(setOwnership)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetches the roster (which carries on_offense/is_redzone) on an
  // interval, but only while a real NFL game is live — see
  // LIVE_POLL_INTERVAL_MS's own comment.
  useEffect(() => {
    if (!isGameDay) return;
    const id = setInterval(() => {
      getMyTeam()
        .then(setTeam)
        .catch(() => {});
    }, LIVE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isGameDay]);

  function openEdit(entry: RosterEntry) {
    setActionError(null);
    setSubmitted(null);
    setEditingEntry(entry);
  }

  function moveTo(entry: RosterEntry, toSlot: string) {
    setActioning(true);
    setActionError(null);
    submitLineupMove(entry.player_id, toSlot)
      .then((result) => {
        setSubmitted(`Moved ${entry.player_name} to ${slotDisplayLabel(toSlot)}.`);
        setEditingEntry(null);
        setTeam((prev) => (prev ? { ...prev, roster: result.roster } : prev));
      })
      .catch((e) => setActionError(e instanceof Error ? e.message : "Move failed"))
      .finally(() => setActioning(false));
  }

  function swapWith(entry: RosterEntry, other: RosterEntry) {
    setActioning(true);
    setActionError(null);
    submitLineupSwap(entry.player_id, other.player_id)
      .then((result) => {
        setSubmitted(`Swapped ${entry.player_name} and ${other.player_name}.`);
        setEditingEntry(null);
        setTeam((prev) => (prev ? { ...prev, roster: result.roster } : prev));
      })
      .catch((e) => setActionError(e instanceof Error ? e.message : "Swap failed"))
      .finally(() => setActioning(false));
  }

  function startDrop(entry: RosterEntry) {
    setEditingEntry(null);
    setActionError(null);
    setSubmitted(null);
    setDropTarget(entry);
  }

  function confirmDrop() {
    if (!dropTarget) return;
    setDropping(true);
    setActionError(null);
    dropPlayer(dropTarget.player_id)
      .then((result) => {
        setSubmitted(`Dropped ${dropTarget.player_name} — back to free agency.`);
        setDropTarget(null);
        setTeam((prev) => (prev ? { ...prev, roster: result.roster } : prev));
      })
      .catch((e) => setActionError(e instanceof Error ? e.message : "Drop failed"))
      .finally(() => setDropping(false));
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }
  if (!team) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading your team…</p>;
  }

  const starters = team.roster
    .filter((e) => !BENCH_SLOTS.has(e.lineup_slot))
    .sort((a, b) => STARTER_SLOT_ORDER.indexOf(a.lineup_slot) - STARTER_SLOT_ORDER.indexOf(b.lineup_slot));
  const bench = team.roster.filter((e) => BENCH_SLOTS.has(e.lineup_slot));

  // Real state right now, not a hypothetical edge case: the actual
  // draft hasn't happened yet, so current_rosters is genuinely empty
  // for every owner — without this, the page below just renders two
  // empty boxes with no explanation (mobile audit finding, Aug 2026).
  if (team.roster.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
        <section className="neon-panel flex flex-col items-center gap-2 rounded-xl p-6 text-center">
          <p className="text-sm font-medium">Your roster is empty — the draft hasn&apos;t happened yet.</p>
          <p className="max-w-sm text-xs text-black/50 dark:text-white/50">
            Once the commissioner starts the real draft, players you pick will show up here.
          </p>
          <Link
            href="/draft"
            className="mt-1 rounded-full bg-[var(--wl-accent-dim)] px-4 py-1.5 text-xs font-semibold text-white hover:brightness-110"
          >
            Go to Draft
          </Link>
        </section>
      </div>
    );
  }

  const options = editingEntry ? editLineupOptions(editingEntry, team.roster, team.roster_slots ?? {}) : [];
  const starterOptions = options.filter((o) => o.slot !== BENCH_SLOT_LABEL);
  const benchOptions = options.filter((o) => o.slot === BENCH_SLOT_LABEL);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
      </div>

      {actioning && <p className="text-xs text-black/50 dark:text-white/50">Saving…</p>}
      {submitted && <p className="text-xs text-emerald-600 dark:text-emerald-400">{submitted}</p>}

      {dropTarget && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3 text-sm">
          <p>
            Drop <strong>{dropTarget.player_name}</strong> back to free agency? Anyone else can pick them up.
          </p>
          {actionError && <p className="mt-1 text-xs text-red-500">{actionError}</p>}
          <div className="mt-2 flex gap-2">
            <button
              onClick={confirmDrop}
              disabled={dropping}
              className="rounded-full bg-red-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {dropping ? "Dropping…" : "Confirm drop"}
            </button>
            <button
              onClick={() => setDropTarget(null)}
              disabled={dropping}
              className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/60 disabled:opacity-50 dark:border-white/10 dark:text-white/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Starters</h2>
        <ul className="neon-panel rounded-lg bg-black/[0.015] px-4 dark:bg-white/[0.03]">
          {starters.map((e) => (
            <RosterRow
              key={e.player_id}
              entry={e}
              ownership={ownership[e.player_id]}
              mounted={mounted}
              onOpenEdit={openEdit}
              onViewPlayer={openPlayerCard}
              onDrop={startDrop}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Bench</h2>
        <ul className="neon-panel rounded-lg bg-black/[0.015] px-4 dark:bg-white/[0.03]">
          {bench.map((e) => (
            <RosterRow
              key={e.player_id}
              entry={e}
              ownership={ownership[e.player_id]}
              mounted={mounted}
              onOpenEdit={openEdit}
              onViewPlayer={openPlayerCard}
              onDrop={startDrop}
            />
          ))}
        </ul>
      </section>

      {editingEntry && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setEditingEntry(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-2xl border-t border-black/10 bg-[var(--background)] p-4 sm:rounded-2xl sm:border dark:border-white/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-wide uppercase">Edit Lineup</h3>
              <button
                onClick={() => setEditingEntry(null)}
                aria-label="Close"
                className="text-lg text-black/50 hover:text-black/80 dark:text-white/50 dark:hover:text-white/80"
              >
                ✕
              </button>
            </div>
            <p className="mb-3 text-xs text-black/50 dark:text-white/50">
              Moving <strong className="text-black/80 dark:text-white/80">{editingEntry.player_name}</strong> — tap where
              they should go.
            </p>
            {actionError && <p className="mb-2 text-xs text-red-500">{actionError}</p>}

            <h4 className="mb-1 text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
              Starters
            </h4>
            <ul className="mb-3 flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {starterOptions.map((opt, i) => (
                <EditLineupOptionRow
                  key={`${opt.slot}-${i}`}
                  option={opt}
                  editingEntry={editingEntry}
                  actioning={actioning}
                  onMoveTo={moveTo}
                  onSwapWith={swapWith}
                />
              ))}
            </ul>

            <h4 className="mb-1 text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
              Bench
            </h4>
            <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
              {benchOptions.map((opt, i) => (
                <EditLineupOptionRow
                  key={`${opt.slot}-${i}`}
                  option={opt}
                  editingEntry={editingEntry}
                  actioning={actioning}
                  onMoveTo={moveTo}
                  onSwapWith={swapWith}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function EditLineupOptionRow({
  option,
  editingEntry,
  actioning,
  onMoveTo,
  onSwapWith,
}: {
  option: EditLineupOption;
  editingEntry: RosterEntry;
  actioning: boolean;
  onMoveTo: (entry: RosterEntry, toSlot: string) => void;
  onSwapWith: (entry: RosterEntry, other: RosterEntry) => void;
}) {
  const isCurrent = option.occupant?.player_id === editingEntry.player_id;

  function handleClick() {
    if (isCurrent || actioning) return;
    if (option.occupant) onSwapWith(editingEntry, option.occupant);
    else onMoveTo(editingEntry, option.slot);
  }

  return (
    <li>
      <button
        onClick={handleClick}
        disabled={isCurrent || actioning}
        className={`flex w-full items-center gap-2.5 py-2.5 text-left disabled:cursor-default ${
          isCurrent ? "" : "hover:bg-sky-500/[0.06]"
        }`}
      >
        <span
          className={`shrink-0 rounded-full border px-2 py-1 text-center text-[10px] font-semibold ${
            isCurrent
              ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
              : "border-black/10 text-black/60 dark:border-white/10 dark:text-white/60"
          }`}
        >
          {slotDisplayLabel(option.slot)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm">
          {option.occupant ? option.occupant.player_name : <span className="text-black/40 dark:text-white/40">Empty</span>}
        </span>
      </button>
    </li>
  );
}
