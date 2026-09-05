"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  dropPlayer,
  getMyTeam,
  getMyTeamOwnership,
  previewLineupMove,
  previewLineupSwap,
  submitLineupMove,
  submitLineupSwap,
  type LineupMovePreview,
  type LineupSwapPreview,
  type MyTeam,
  type OwnershipInfo,
  type RosterEntry,
} from "@/lib/api";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { nflTeamName } from "@/lib/nfl-teams";
import {
  BENCH_SLOT_LABEL,
  canSwapSlots,
  isEligibleForSlot,
  slotDisplayLabel,
  STARTER_SLOT_ORDER,
  starterSortIndex,
} from "@/lib/rosterSlots";

// Which starter slots a bench player could move straight into — a
// brand-new, all-bench roster (right after a draft — see MyTeamApp's
// own empty-roster case below) has zero occupied starter rows to swap
// with, so this is the only path that can ever get someone into their
// FIRST starting lineup; it stays available afterward too, as a
// quicker one-click alternative to select-then-swap.
function eligibleStarterSlotsFor(position: string): string[] {
  return STARTER_SLOT_ORDER.filter((slot) => isEligibleForSlot(position, slot));
}

const BENCH_SLOTS = new Set([BENCH_SLOT_LABEL, "IR"]);

// "2026-09-21T20:00Z" -> "Sun 3:00 PM" — real ISO8601 from the backend
// (app/providers/nfl_scoreboard.py), formatted client-side so it
// renders in the visitor's own local time zone.
function formatGameTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${weekday} ${time}`;
}

function RosterRow({
  entry,
  ownership,
  selectedForSwap,
  swapDisabled,
  isBenchRow,
  swapSelectionActive,
  mounted,
  onToggleSwapSelect,
  onStartAtSlot,
  onViewPlayer,
  onDrop,
}: {
  entry: RosterEntry;
  ownership: OwnershipInfo | undefined;
  selectedForSwap: boolean;
  swapDisabled: boolean;
  // Only changes the button's idle-state label (see swapButtonLabel
  // below) — the actual swap logic doesn't care which list a row is
  // in, only its lineup_slot.
  isBenchRow: boolean;
  // Whether some OTHER row is mid-swap-selection right now — a bench
  // row shows its normal one-click "Start {slot}" buttons by default,
  // but switches to the same Swap-select button a starter row always
  // has while a swap is in progress, so completing "select a starter,
  // then pick who replaces them" still works (see toggleSwapSelect).
  swapSelectionActive: boolean;
  mounted: boolean;
  onToggleSwapSelect: (entry: RosterEntry) => void;
  onStartAtSlot: (entry: RosterEntry, slot: string) => void;
  onViewPlayer: (sleeperPlayerId: string) => void;
  onDrop: (entry: RosterEntry) => void;
}) {
  return (
    <li className="flex items-center gap-2.5 border-b border-black/5 py-3 last:border-0 dark:border-white/5">
      <span className="shrink-0 rounded-full border border-black/10 px-2 py-1 text-center text-[10px] font-semibold text-black/60 dark:border-white/10 dark:text-white/60">
        {slotDisplayLabel(entry.lineup_slot)}
      </span>
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
        <div className="flex flex-wrap items-center justify-end gap-1.5 text-right text-xs tabular-nums text-black/60 dark:text-white/60">
          {isBenchRow && !swapSelectionActive ? (
            // One-click straight into a starting slot — works whether
            // that slot is currently empty (the only path that does,
            // right after a draft) or occupied (auto-benches whoever's
            // there, same outcome a select-then-swap would reach).
            eligibleStarterSlotsFor(entry.position).map((slot) => (
              <button
                key={slot}
                onClick={() => onStartAtSlot(entry, slot)}
                className="rounded-full border border-black/10 px-2 py-1 text-[11px] font-medium text-black/50 hover:border-sky-500 hover:text-sky-600 dark:border-white/10 dark:text-white/50 dark:hover:text-sky-400"
              >
                Start {slotDisplayLabel(slot)}
              </button>
            ))
          ) : (
            <button
              onClick={() => onToggleSwapSelect(entry)}
              disabled={swapDisabled}
              title={swapDisabled ? "Doesn't qualify for a swap with the selected player" : undefined}
              className={`rounded-full border px-2 py-1 text-[11px] font-medium disabled:opacity-30 ${
                selectedForSwap
                  ? "border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                  : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
              }`}
            >
              {selectedForSwap ? "Selected" : "Swap"}
            </button>
          )}
          <button
            onClick={() => onDrop(entry)}
            className="rounded-full border border-red-500/20 px-2 py-1 text-[11px] font-medium text-red-500/70 hover:bg-red-500/10 hover:text-red-500"
          >
            Drop
          </button>
        </div>
      </div>
    </li>
  );
}

// A swap needs a `selected` player and is otherwise valid per
// canSwapSlots, but bench<->bench is deliberately excluded here even
// though it's technically eligible (both slots accept any position) —
// it's a real no-op for what anyone actually wants ("get this guy
// into my starting lineup"), and with a full bench, leaving every
// other bench row lit up as "clickable" buried the one or two starter
// rows that were the actual point (2026-09 reported: "difficult...
// to put them in the starter position").
function isSwapDisabled(selected: RosterEntry | null, entry: RosterEntry): boolean {
  if (selected === null || selected.player_id === entry.player_id) return false;
  if (selected.lineup_slot === BENCH_SLOT_LABEL && entry.lineup_slot === BENCH_SLOT_LABEL) return true;
  return !canSwapSlots(selected.position, selected.lineup_slot, entry.position, entry.lineup_slot);
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
  const [swapPreview, setSwapPreview] = useState<LineupSwapPreview | null>(null);
  const [movePreview, setMovePreview] = useState<LineupMovePreview | null>(null);
  // At most one selected at a time — swap is strictly pick-a-player,
  // then pick a qualifying partner, not "select any two."
  const [selected, setSelected] = useState<RosterEntry | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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

  function confirmSwap() {
    if (!swapPreview) return;
    setSubmitting(true);
    setSubmitError(null);
    submitLineupSwap(swapPreview.player_a.player_id, swapPreview.player_b.player_id)
      .then((result) => {
        setSubmitted(`Swapped ${swapPreview.player_a.player_name} and ${swapPreview.player_b.player_name}.`);
        setSwapPreview(null);
        setTeam((prev) => (prev ? { ...prev, roster: result.roster } : prev));
      })
      .catch((e) => setSubmitError(e instanceof Error ? e.message : "Swap failed"))
      .finally(() => setSubmitting(false));
  }

  function confirmMove() {
    if (!movePreview) return;
    setSubmitting(true);
    setSubmitError(null);
    submitLineupMove(movePreview.player.player_id, movePreview.to_slot)
      .then((result) => {
        setSubmitted(
          movePreview.displaced_player
            ? `Started ${movePreview.player.player_name} at ${slotDisplayLabel(movePreview.to_slot)} — ${movePreview.displaced_player.player_name} moved to the bench.`
            : `Started ${movePreview.player.player_name} at ${slotDisplayLabel(movePreview.to_slot)}.`
        );
        setMovePreview(null);
        setTeam((prev) => (prev ? { ...prev, roster: result.roster } : prev));
      })
      .catch((e) => setSubmitError(e instanceof Error ? e.message : "Move failed"))
      .finally(() => setSubmitting(false));
  }

  function startMove(entry: RosterEntry, toSlot: string) {
    setSwapPreview(null);
    setSelected(null);
    setPreviewError(null);
    setSubmitError(null);
    setSubmitted(null);

    setPreviewing(true);
    previewLineupMove(entry.player_id, toSlot)
      .then(setMovePreview)
      .catch((e) => setPreviewError(e instanceof Error ? e.message : "Preview failed"))
      .finally(() => setPreviewing(false));
  }

  function toggleSwapSelect(entry: RosterEntry) {
    setSwapPreview(null);
    setMovePreview(null);
    setPreviewError(null);
    setSubmitError(null);
    setSubmitted(null);

    if (selected === null) {
      setSelected(entry);
      return;
    }
    if (selected.player_id === entry.player_id) {
      setSelected(null); // clicking the already-selected player deselects it
      return;
    }
    // Any other row rendered as clickable is already a qualifying
    // partner (see swapDisabled below) — this defensively no-ops if
    // it somehow isn't, rather than firing an invalid preview.
    if (!canSwapSlots(selected.position, selected.lineup_slot, entry.position, entry.lineup_slot)) return;

    setPreviewing(true);
    previewLineupSwap(selected.player_id, entry.player_id)
      .then((result) => {
        setSwapPreview(result);
        setSelected(null);
      })
      .catch((e) => {
        setPreviewError(e instanceof Error ? e.message : "Preview failed");
        setSelected(null);
      })
      .finally(() => setPreviewing(false));
  }

  function startDrop(entry: RosterEntry) {
    setSwapPreview(null);
    setMovePreview(null);
    setSelected(null);
    setSubmitError(null);
    setSubmitted(null);
    setDropTarget(entry);
  }

  function confirmDrop() {
    if (!dropTarget) return;
    setDropping(true);
    setSubmitError(null);
    dropPlayer(dropTarget.player_id)
      .then((result) => {
        setSubmitted(`Dropped ${dropTarget.player_name} — back to free agency.`);
        setDropTarget(null);
        setTeam((prev) => (prev ? { ...prev, roster: result.roster } : prev));
      })
      .catch((e) => setSubmitError(e instanceof Error ? e.message : "Drop failed"))
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
    .sort((a, b) => starterSortIndex(a.lineup_slot) - starterSortIndex(b.lineup_slot));
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
      </div>

      {previewing && <p className="text-xs text-black/50 dark:text-white/50">Checking…</p>}
      {previewError && <p className="text-xs text-red-500">{previewError}</p>}
      {submitError && <p className="text-xs text-red-500">{submitError}</p>}
      {submitted && <p className="text-xs text-emerald-600 dark:text-emerald-400">{submitted}</p>}

      {swapPreview && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-3 text-sm">
          <p>
            Swap <strong>{swapPreview.player_a.player_name}</strong> ({swapPreview.player_a.lineup_slot})
            with <strong>{swapPreview.player_b.player_name}</strong> ({swapPreview.player_b.lineup_slot})?
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={confirmSwap}
              disabled={submitting}
              className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Confirm swap"}
            </button>
            <button
              onClick={() => setSwapPreview(null)}
              disabled={submitting}
              className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/60 disabled:opacity-50 dark:border-white/10 dark:text-white/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {movePreview && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/[0.06] p-3 text-sm">
          <p>
            Start <strong>{movePreview.player.player_name}</strong> at {slotDisplayLabel(movePreview.to_slot)}?
            {movePreview.displaced_player && (
              <>
                {" "}
                <strong>{movePreview.displaced_player.player_name}</strong> will move to the bench.
              </>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={confirmMove}
              disabled={submitting}
              className="rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Confirm"}
            </button>
            <button
              onClick={() => setMovePreview(null)}
              disabled={submitting}
              className="rounded-full border border-black/10 px-3 py-1 text-xs font-medium text-black/60 disabled:opacity-50 dark:border-white/10 dark:text-white/60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {selected && (
        <p className="text-xs text-black/50 dark:text-white/50">
          Selected {selected.player_name} for a swap — pick a player who qualifies for their slot (and vice versa).
        </p>
      )}

      {dropTarget && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/[0.06] p-3 text-sm">
          <p>
            Drop <strong>{dropTarget.player_name}</strong> back to free agency? Anyone else can pick them up.
          </p>
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
              selectedForSwap={selected?.player_id === e.player_id}
              swapDisabled={isSwapDisabled(selected, e)}
              isBenchRow={false}
              swapSelectionActive={selected !== null}
              mounted={mounted}
              onToggleSwapSelect={toggleSwapSelect}
              onStartAtSlot={startMove}
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
              selectedForSwap={selected?.player_id === e.player_id}
              swapDisabled={isSwapDisabled(selected, e)}
              isBenchRow={true}
              swapSelectionActive={selected !== null}
              mounted={mounted}
              onToggleSwapSelect={toggleSwapSelect}
              onStartAtSlot={startMove}
              onViewPlayer={openPlayerCard}
              onDrop={startDrop}
            />
          ))}
        </ul>
      </section>

    </div>
  );
}
