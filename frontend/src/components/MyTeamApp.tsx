"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getMyTeam,
  getMyTeamOwnership,
  submitLineupMove,
  submitLineupSwap,
  type MyTeam,
  type OwnershipInfo,
  type RosterEntry,
} from "@/lib/api";
import { createCoOwnerInvite } from "@/lib/leaguesApi";
import { PlayerHeadshot } from "@/components/PlayerHeadshot";
import { usePlayerCard } from "@/components/players/PlayerCardProvider";
import { nflTeamName } from "@/lib/nfl-teams";
import { BENCH_SLOT_LABEL, IR_SLOT_LABEL, isEligibleForSlot, isIrEligible, slotDisplayLabel, STARTER_SLOT_ORDER } from "@/lib/rosterSlots";
import { formatGameTime } from "@/lib/gameTime";
import { positionColor } from "@/lib/positionColors";
import { hasInjuryBadge, injuryShortCode } from "@/lib/injuryStatus";
import { formatPositionRank, rankColorVar } from "@/lib/positionRank";

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
// A move/swap response's roster entries leave every GET /me/team-only
// field (matchup, kickoff, bye, projection, points) null — replacing
// the roster with them wholesale blanked all of that out after every
// lineup edit (real report, 2026-09-23). A move/swap only ever changes
// lineup_slot, so keep each player's full entry and take just that.
function applyLineupSlots(prev: RosterEntry[], next: RosterEntry[]): RosterEntry[] {
  const prevById = new Map(prev.map((e) => [e.player_id, e]));
  return next.map((e) => {
    const full = prevById.get(e.player_id);
    return full ? { ...full, lineup_slot: e.lineup_slot } : e;
  });
}

function editLineupOptions(entry: RosterEntry, roster: RosterEntry[], rosterSlots: Record<string, number>): EditLineupOption[] {
  const options: EditLineupOption[] = [];
  for (const slot of eligibleStarterSlotsFor(entry.position)) {
    const capacity = rosterSlots[slot] ?? 0;
    const occupants = roster.filter((r) => r.lineup_slot === slot);
    // A swap with a locked occupant would always be rejected server-side
    // (their game already started — see lineup_engine.py's plan_move/
    // plan_swap) — don't offer a destination the backend can only 409.
    for (const occupant of occupants) if (!occupant.is_locked) options.push({ slot, occupant });
    if (occupants.length < capacity) options.push({ slot, occupant: null });
  }
  options.push(entry.lineup_slot === BENCH_SLOT_LABEL ? { slot: BENCH_SLOT_LABEL, occupant: entry } : { slot: BENCH_SLOT_LABEL, occupant: null });
  if (isIrEligible(entry.injury_status)) {
    const irCapacity = rosterSlots[IR_SLOT_LABEL] ?? 0;
    const irOccupants = roster.filter((r) => r.lineup_slot === IR_SLOT_LABEL);
    for (const occupant of irOccupants) if (!occupant.is_locked) options.push({ slot: IR_SLOT_LABEL, occupant });
    if (irOccupants.length < irCapacity) options.push({ slot: IR_SLOT_LABEL, occupant: null });
  }
  return options;
}

function RosterRow({
  entry,
  ownership,
  mounted,
  editable,
  beta = false,
  onOpenEdit,
  onViewPlayer,
}: {
  entry: RosterEntry;
  ownership: OwnershipInfo | undefined;
  mounted: boolean;
  editable: boolean;
  // Settings > Labs > "Try the new look" — see MyTeamApp's own comment
  // on why this is a prop on the existing component rather than a
  // forked one: the edit/swap logic below must never have two copies
  // to drift apart on a page that moves real roster state. Only
  // presentation/density changes under this flag (Documentation/
  // UX/04_Mobile_Strategy.md section 7 — cap status pills, combine
  // secondary lines) plus position-color-coding (01_Design_System.md
  // section 2, already built for Draft but never wired in here).
  beta?: boolean;
  onOpenEdit: (entry: RosterEntry) => void;
  onViewPlayer: (sleeperPlayerId: string) => void;
}) {
  if (beta) {
    // Three secondary lines (position/team, opponent/time, bye+
    // ownership+matchup-rank), never truncated — a single combined
    // line here used to overflow and hide whatever didn't fit (real
    // report: bye week, ownership%, and the matchup rank were all
    // getting cut off behind a "…" on real rosters). Splitting by
    // logical grouping instead of cramming everything onto one line
    // is what actually fixes that, not a smaller font or tighter
    // truncation.
    const opponentLine =
      entry.next_opponent && entry.game_time && mounted
        ? `${entry.next_opponent} · ${formatGameTime(entry.game_time)}`
        : entry.next_opponent;
    const detailParts: string[] = [];
    if (entry.bye_week !== null) detailParts.push(`Bye Wk ${entry.bye_week}`);
    if (ownership?.percent_owned !== null && ownership?.percent_owned !== undefined) {
      detailParts.push(`${ownership.percent_owned.toFixed(0)}% owned`);
    }
    const hasInjury = hasInjuryBadge(entry.injury_status);
    const positionRankText = formatPositionRank(entry.opponent_position_rank, entry.position);

    return (
      <li className="flex items-stretch gap-2.5 border-b border-black/5 py-3 last:border-0 dark:border-white/5">
        <span
          className="w-1 shrink-0 self-stretch rounded-full"
          style={{ backgroundColor: positionColor(entry.position) }}
          aria-hidden
        />
        {editable ? (
          <button
            onClick={() => onOpenEdit(entry)}
            title="Edit lineup"
            className="flex min-h-11 shrink-0 items-center rounded-full border border-black/10 px-2.5 text-center text-[10px] font-semibold text-black/60 hover:border-sky-500 hover:text-sky-600 dark:border-white/10 dark:text-white/60 dark:hover:text-sky-400"
          >
            {slotDisplayLabel(entry.lineup_slot)}
          </button>
        ) : (
          <span className="flex min-h-11 shrink-0 items-center rounded-full border border-black/10 px-2.5 text-center text-[10px] font-semibold text-black/40 dark:border-white/10 dark:text-white/40">
            {slotDisplayLabel(entry.lineup_slot)}
          </span>
        )}
        <span className="relative inline-flex shrink-0 items-center">
          <PlayerHeadshot sleeperPlayerId={entry.player_id} proTeam={entry.pro_team} name={entry.player_name} size={36} />
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
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <button
            onClick={() => onViewPlayer(entry.player_id)}
            className="truncate text-left text-sm font-medium hover:underline"
          >
            {entry.player_name}
            {/* Name-adjacent single-letter flag, not a full-width pill
                on its own line — see lib/injuryStatus.ts's comment.
                Frees the row's vertical space for information instead
                of status chrome. */}
            {hasInjury && (
              <span
                className="ml-1.5 text-xs font-bold text-red-500 dark:text-red-400"
                title={entry.injury_status ?? undefined}
              >
                {injuryShortCode(entry.injury_status as string)}
              </span>
            )}
          </button>
          <span className="text-xs text-black/50 dark:text-white/50">
            {entry.position} · {nflTeamName(entry.pro_team ?? undefined) ?? entry.pro_team ?? "—"}
          </span>
          {(opponentLine || positionRankText) && (
            <span className="text-xs text-black/50 dark:text-white/50">
              {opponentLine}
              {opponentLine && positionRankText && " · "}
              {positionRankText && (
                <span style={{ color: rankColorVar(entry.opponent_position_rank!.rank) }}>{positionRankText}</span>
              )}
            </span>
          )}
          {detailParts.length > 0 && (
            <span className="text-xs text-black/50 dark:text-white/50">{detailParts.join(" · ")}</span>
          )}
          {entry.is_locked && (
            <span className="mt-0.5 flex flex-wrap items-center gap-1">
              {entry.is_locked && (
                <span
                  className="w-fit rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold text-black/60 uppercase dark:bg-white/10 dark:text-white/60"
                  title="This player's game has already started — their lineup slot is locked for the week"
                >
                  Locked
                </span>
              )}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end justify-center gap-1">
          <span className="text-sm font-semibold tabular-nums text-black/80 dark:text-white/80">
            {entry.points !== null ? entry.points.toFixed(1) : "—"}
          </span>
          {entry.points_projected !== null && (
            <span className="text-[11px] tabular-nums text-black/50 dark:text-white/50">
              Proj {entry.points_projected.toFixed(1)}
            </span>
          )}
        </div>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2.5 border-b border-black/5 py-3 last:border-0 dark:border-white/5">
      {editable ? (
        <button
          onClick={() => onOpenEdit(entry)}
          title="Edit lineup"
          className="shrink-0 rounded-full border border-black/10 px-2 py-1 text-center text-[10px] font-semibold text-black/60 hover:border-sky-500 hover:text-sky-600 dark:border-white/10 dark:text-white/60 dark:hover:text-sky-400"
        >
          {slotDisplayLabel(entry.lineup_slot)}
        </button>
      ) : (
        <span className="shrink-0 rounded-full border border-black/10 px-2 py-1 text-center text-[10px] font-semibold text-black/40 dark:border-white/10 dark:text-white/40">
          {slotDisplayLabel(entry.lineup_slot)}
        </span>
      )}
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
          {hasInjuryBadge(entry.injury_status) && (
            <span
              className="ml-1.5 text-xs font-bold text-red-500 dark:text-red-400"
              title={entry.injury_status ?? undefined}
            >
              {injuryShortCode(entry.injury_status as string)}
            </span>
          )}
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
            {formatPositionRank(entry.opponent_position_rank, entry.position) && (
              <>
                {" · "}
                <span style={{ color: rankColorVar(entry.opponent_position_rank!.rank) }}>
                  {formatPositionRank(entry.opponent_position_rank, entry.position)}
                </span>
              </>
            )}
          </span>
        )}
        {entry.bye_week !== null && (
          <span className="text-xs text-black/50 dark:text-white/50">Bye: Week {entry.bye_week}</span>
        )}
        {ownership?.percent_owned !== null && ownership?.percent_owned !== undefined && (
          <span className="text-xs text-black/50 dark:text-white/50">{ownership.percent_owned.toFixed(0)}% owned</span>
        )}
        {entry.is_locked && (
          <span
            className="mt-0.5 w-fit rounded-full bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold text-black/60 uppercase dark:bg-white/10 dark:text-white/60"
            title="This player's game has already started — their lineup slot is locked for the week"
          >
            Locked
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
  beta = false,
}: {
  isGameDay: boolean;
  initialTeam: MyTeam | null;
  initialOwnership: Record<string, OwnershipInfo> | null;
  // Settings > Labs > "Try the new look" — see RosterRow's own comment.
  beta?: boolean;
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
  const [weekLoading, setWeekLoading] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const { openPlayerCard } = usePlayerCard();

  async function handleInviteCoOwner() {
    setInviting(true);
    setInviteError(null);
    try {
      const code = await createCoOwnerInvite();
      setInviteLink(`${window.location.origin}/join-co-owner?code=${code}`);
    } catch (e) {
      setInviteError(e instanceof Error ? e.message : "Couldn't generate an invite link");
    } finally {
      setInviting(false);
    }
  }

  function copyInviteLink() {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink).then(() => {
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    });
  }

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
  // interval, but only while a real NFL game is live AND the owner is
  // actually looking at the live/editable week — see
  // LIVE_POLL_INTERVAL_MS's own comment. Re-fetching the current week
  // while they've navigated to a past week's read-only view would
  // silently snap them back to "now" out from under them every 15s.
  //
  // Also paused whenever the tab/PWA isn't visible — a backgrounded
  // app during a live game shouldn't keep polling the roster every
  // 15s for however long the game runs (2026-09 battery audit, P0-2).
  // Re-fetches once immediately on return to visible.
  useEffect(() => {
    if (!isGameDay || team?.is_editable === false) return;
    let id: ReturnType<typeof setInterval> | null = null;

    function poll() {
      getMyTeam()
        .then(setTeam)
        .catch(() => {});
    }
    function startOrStop() {
      if (document.visibilityState === "visible") {
        if (id === null) {
          poll();
          id = setInterval(poll, LIVE_POLL_INTERVAL_MS);
        }
      } else if (id !== null) {
        clearInterval(id);
        id = null;
      }
    }

    startOrStop();
    document.addEventListener("visibilitychange", startOrStop);
    return () => {
      document.removeEventListener("visibilitychange", startOrStop);
      if (id !== null) clearInterval(id);
    };
  }, [isGameDay, team?.is_editable]);

  function goToWeek(week: number) {
    setWeekLoading(true);
    setActionError(null);
    getMyTeam(week)
      .then(setTeam)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load that week"))
      .finally(() => setWeekLoading(false));
  }

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
        setTeam((prev) => (prev ? { ...prev, roster: applyLineupSlots(prev.roster, result.roster) } : prev));
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
        setTeam((prev) => (prev ? { ...prev, roster: applyLineupSlots(prev.roster, result.roster) } : prev));
      })
      .catch((e) => setActionError(e instanceof Error ? e.message : "Swap failed"))
      .finally(() => setActioning(false));
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
  const bench = team.roster.filter((e) => e.lineup_slot === BENCH_SLOT_LABEL);
  const ir = team.roster.filter((e) => e.lineup_slot === IR_SLOT_LABEL);

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
  const starterOptions = options.filter((o) => o.slot !== BENCH_SLOT_LABEL && o.slot !== IR_SLOT_LABEL);
  const benchOptions = options.filter((o) => o.slot === BENCH_SLOT_LABEL);
  const irOptions = options.filter((o) => o.slot === IR_SLOT_LABEL);

  const week = team.week ?? 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">{team.team_name}</h1>
        <button
          onClick={handleInviteCoOwner}
          disabled={inviting}
          className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/[0.05]"
        >
          {inviting ? "Generating…" : "Invite Co-Owner"}
        </button>
      </div>

      {inviteError && <p className="text-xs text-red-500">{inviteError}</p>}
      {inviteLink && (
        <div className="flex flex-col gap-1 rounded-xl bg-black/[0.03] p-3 text-xs dark:bg-white/[0.05]">
          <p className="text-black/60 dark:text-white/60">
            Send this link to your friend — once they sign up and open it, they&apos;ll be able to manage this team
            with you.
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono">{inviteLink}</code>
            <button
              onClick={copyInviteLink}
              className="shrink-0 rounded-full border border-black/10 px-2 py-0.5 text-[11px] hover:bg-black/[0.03] dark:border-white/10 dark:hover:bg-white/[0.05]"
            >
              {inviteCopied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* ESPN-style "< Week N >" arrow navigation (2026-09) — the
          current/live week stays fully editable; any other week is a
          real, read-only historical or future snapshot (see
          backend/app/routers/me.py's my_team docstring for why editing
          only ever makes sense for is_editable weeks). Bounded 1-17
          (regular season + playoffs), same range the team-detail
          page's own week picker uses. */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={() => goToWeek(week - 1)}
          disabled={week <= 1 || weekLoading}
          className="text-lg text-black/40 disabled:opacity-30 dark:text-white/40"
          aria-label="Previous week"
        >
          ‹
        </button>
        <span className="text-sm font-semibold">Week {week}</span>
        <button
          onClick={() => goToWeek(week + 1)}
          disabled={week >= 17 || weekLoading}
          className="text-lg text-black/40 disabled:opacity-30 dark:text-white/40"
          aria-label="Next week"
        >
          ›
        </button>
      </div>
      {!team.is_editable && (
        <p className="text-center text-xs text-black/50 dark:text-white/50">
          {team.current_week !== null && week < team.current_week
            ? "Past week — read only."
            : "Not the current week yet — read only."}
        </p>
      )}

      {actioning && <p className="text-xs text-black/50 dark:text-white/50">Saving…</p>}
      {submitted && <p className="text-xs text-emerald-600 dark:text-emerald-400">{submitted}</p>}

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Starters</h2>
        <ul className={`rounded-lg px-4 ${beta ? "wl-card" : "neon-panel bg-black/[0.015] dark:bg-white/[0.03]"}`}>
          {starters.map((e) => (
            <RosterRow
              key={e.player_id}
              entry={e}
              ownership={ownership[e.player_id]}
              mounted={mounted}
              editable={team.is_editable}
              beta={beta}
              onOpenEdit={openEdit}
              onViewPlayer={openPlayerCard}
            />
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">Bench</h2>
        <ul className={`rounded-lg px-4 ${beta ? "wl-card" : "neon-panel bg-black/[0.015] dark:bg-white/[0.03]"}`}>
          {bench.map((e) => (
            <RosterRow
              key={e.player_id}
              entry={e}
              ownership={ownership[e.player_id]}
              mounted={mounted}
              editable={team.is_editable}
              beta={beta}
              onOpenEdit={openEdit}
              onViewPlayer={openPlayerCard}
            />
          ))}
        </ul>
      </section>

      {ir.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Injured Reserve
          </h2>
          <ul className={`rounded-lg px-4 ${beta ? "wl-card" : "neon-panel bg-black/[0.015] dark:bg-white/[0.03]"}`}>
            {ir.map((e) => (
              <RosterRow
                key={e.player_id}
                entry={e}
                ownership={ownership[e.player_id]}
                mounted={mounted}
                editable={team.is_editable}
                beta={beta}
                onOpenEdit={openEdit}
                onViewPlayer={openPlayerCard}
              />
            ))}
          </ul>
        </section>
      )}

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
            {editingEntry.is_locked ? (
              <p className="text-xs text-black/60 dark:text-white/60">
                <strong className="text-black/80 dark:text-white/80">{editingEntry.player_name}</strong>&rsquo;s game
                has already started this week — their lineup slot is locked until next week.
              </p>
            ) : (
              <>
                <p className="mb-3 text-xs text-black/50 dark:text-white/50">
                  Moving <strong className="text-black/80 dark:text-white/80">{editingEntry.player_name}</strong> — tap
                  where they should go.
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
                <ul
                  className={
                    irOptions.length > 0
                      ? "mb-3 flex flex-col divide-y divide-black/5 dark:divide-white/5"
                      : "flex flex-col divide-y divide-black/5 dark:divide-white/5"
                  }
                >
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

                {irOptions.length > 0 && (
                  <>
                    <h4 className="mb-1 text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
                      Injured Reserve
                    </h4>
                    <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
                      {irOptions.map((opt, i) => (
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
                  </>
                )}
              </>
            )}
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
