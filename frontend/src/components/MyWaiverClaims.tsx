"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  cancelWaiverClaim,
  listMyWaiverClaims,
  reorderWaiverClaims,
  type MyWaiverClaims as MyWaiverClaimsData,
  type WaiverClaim,
} from "@/lib/api";

const OUTCOME: Record<Exclude<WaiverClaim["status"], "pending">, { label: string; className: string }> = {
  successful: { label: "Won", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  failed: { label: "Missed", className: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  cancelled: { label: "Cancelled", className: "bg-black/5 text-black/50 dark:bg-white/5 dark:text-white/50" },
};

type Filter = "all" | "successful" | "failed";

// "Wed 3:00 AM" (this week) or "Wed, Oct 14 3:00 AM", in the viewer's own time zone.
function shortWhen(iso: string): string {
  const when = new Date(iso);
  const soon = when.getTime() - Date.now() < 6 * 24 * 60 * 60 * 1000;
  const day = when.toLocaleDateString(undefined, soon ? { weekday: "short" } : { weekday: "short", month: "short", day: "numeric" });
  return `${day} ${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function settledAt(c: WaiverClaim): string {
  return c.processed_at ?? c.created_at;
}

/**
 * This team's waiver claims (Option B, 2026-10-13): the claims still in
 * line up top — drag the grip to rank them, like ESPN's Waiver Claims >
 * Edit — then how the last waiver run went, with every older claim
 * folded away under "All past claims". Self-fetching, so FreeAgentsList's
 * own claim-submit flow doesn't have to thread state up to the page;
 * refetches after a cancel, not live when the scheduler settles a claim.
 */
export function MyWaiverClaims() {
  const [data, setData] = useState<MyWaiverClaimsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    listMyWaiverClaims()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load your waiver claims"));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  if (error) return <p className="text-xs text-red-500">{error}</p>;
  if (data === null) return <p className="text-xs text-black/50 dark:text-white/50">Loading your claims…</p>;
  if (data.claims.length === 0) return null;

  const pending = data.claims.filter((c) => c.status === "pending");
  const past = data.claims
    .filter((c) => c.status !== "pending")
    .sort((a, b) => settledAt(b).localeCompare(settledAt(a)));
  // The latest run: won or missed claims settled within an hour of the newest one.
  const settled = past.filter((c) => c.status !== "cancelled" && c.processed_at);
  const newest = settled[0] ? new Date(settled[0].processed_at!).getTime() : 0;
  const lastRun = settled.filter((c) => newest - new Date(c.processed_at!).getTime() < 60 * 60 * 1000);
  const nextClear = pending.map((c) => c.clears_at).filter((x): x is string => x !== null).sort()[0] ?? null;

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!data || !over || active.id === over.id) return;
    const ids = pending.map((c) => c.id);
    const next = arrayMove(ids, ids.indexOf(active.id as number), ids.indexOf(over.id as number));
    const byId = new Map(data.claims.map((c) => [c.id, c]));
    const previous = data;
    setData({ ...data, claims: [...next.map((id) => byId.get(id)!), ...past] });
    try {
      await reorderWaiverClaims(next);
    } catch (e) {
      setData(previous);
      setError(e instanceof Error ? e.message : "Couldn't save your claim order");
    }
  }

  async function cancel(claimId: number) {
    setCancellingId(claimId);
    try {
      await cancelWaiverClaim(claimId);
      setData(await listMyWaiverClaims());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setCancellingId(null);
    }
  }

  const won = past.filter((c) => c.status === "successful").length;
  const missed = past.filter((c) => c.status === "failed").length;
  const shownPast = filter === "all" ? past : past.filter((c) => c.status === filter);
  const pastByDay: { day: string; claims: WaiverClaim[] }[] = [];
  for (const c of shownPast) {
    const day = new Date(settledAt(c)).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const last = pastByDay[pastByDay.length - 1];
    if (last?.day === day) last.claims.push(c);
    else pastByDay.push({ day, claims: [c] });
  }

  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="claims-up-next" className="neon-panel flex flex-col rounded-lg bg-black/[0.015] dark:bg-white/[0.03]">
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-3 pb-2">
          <div className="flex flex-col">
            <span className="text-[11px] font-semibold tracking-wide text-[var(--wl-accent)] uppercase">
              {nextClear ? `Up next · ${shortWhen(nextClear)}` : "Up next"}
            </span>
            <h2 id="claims-up-next" className="text-base font-semibold">
              {pending.length === 0 ? "No claims in line" : `${pending.length} claim${pending.length === 1 ? "" : "s"} in line`}
            </h2>
          </div>
          {data.priority && (
            <span className="rounded-full bg-[var(--wl-accent-dim)] px-2.5 py-1 text-xs font-semibold">
              Waiver priority #{data.priority.rank} of {data.priority.of}
            </span>
          )}
        </div>
        {pending.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={pending.map((c) => c.id)} strategy={verticalListSortingStrategy}>
              <ul className="flex flex-col divide-y divide-black/5 border-t border-black/5 dark:divide-white/5 dark:border-white/5">
                {pending.map((c, i) => (
                  <PendingRow
                    key={c.id}
                    claim={c}
                    rank={i + 1}
                    draggable={pending.length > 1}
                    laterClear={c.clears_at && c.clears_at !== nextClear ? shortWhen(c.clears_at) : null}
                    cancelling={cancellingId === c.id}
                    onCancel={() => cancel(c.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
        {pending.length > 1 && (
          <p className="px-4 py-2 text-xs text-black/50 dark:text-white/50">
            Drag ⠿ to rank (or focus it and use the arrow keys). Your #1 goes first on your turn; the order saves as soon as you drop.
          </p>
        )}
      </section>

      {lastRun.length > 0 && (
        <section aria-label="Last waiver run" className="neon-panel flex flex-col gap-1.5 rounded-lg bg-black/[0.015] px-4 py-3 dark:bg-white/[0.03]">
          <span className="text-[11px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
            Last run · {shortWhen(lastRun[0].processed_at!)}
          </span>
          {lastRun.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                {c.add_player_name}
                {c.status === "failed" && c.failure_reason && (
                  <span className="text-xs text-black/50 dark:text-white/50"> · {c.failure_reason}</span>
                )}
              </span>
              <OutcomeChip status={c.status} />
            </div>
          ))}
        </section>
      )}

      {past.length > 0 && (
        <section className="neon-panel flex flex-col rounded-lg bg-black/[0.015] dark:bg-white/[0.03]">
          <button
            type="button"
            onClick={() => setShowPast(!showPast)}
            aria-expanded={showPast}
            className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-left text-sm font-semibold"
          >
            <span>
              All past claims <span className="font-normal text-black/50 dark:text-white/50">· {past.length}</span>
            </span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`transition-transform ${showPast ? "rotate-180" : ""}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          {showPast && (
            <div className="flex flex-col gap-3 border-t border-black/5 px-4 py-3 dark:border-white/5">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["all", "All"],
                    ["successful", `Won · ${won}`],
                    ["failed", `Missed · ${missed}`],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setFilter(key)}
                    aria-pressed={filter === key}
                    className={`min-h-9 rounded-full border px-3.5 text-xs font-semibold ${
                      filter === key
                        ? "border-transparent bg-black text-white dark:bg-white dark:text-black"
                        : "border-black/10 text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {pastByDay.length === 0 && <p className="text-xs text-black/50 dark:text-white/50">Nothing here yet.</p>}
              {pastByDay.map((group) => (
                <div key={group.day} className="flex flex-col">
                  <span className="pb-1 text-[11px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{group.day}</span>
                  <ul className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
                    {group.claims.map((c) => (
                      <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <span className="flex min-w-0 flex-col">
                          <span className="wrap-break-word">{c.add_player_name}</span>
                          <span className="text-xs text-black/50 dark:text-white/50">
                            {c.status === "failed"
                              ? c.failure_reason
                              : c.status === "cancelled"
                                ? "You cancelled it"
                                : c.drop_player_name
                                  ? `Dropped ${c.drop_player_name}`
                                  : null}
                          </span>
                        </span>
                        <OutcomeChip status={c.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function OutcomeChip({ status }: { status: WaiverClaim["status"] }) {
  if (status === "pending") return null;
  const { label, className } = OUTCOME[status];
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${className}`}>{label}</span>;
}

function PendingRow({
  claim,
  rank,
  draggable,
  laterClear,
  cancelling,
  onCancel,
}: {
  claim: WaiverClaim;
  rank: number;
  draggable: boolean;
  laterClear: string | null;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: claim.id });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 py-2 pr-4 pl-1 text-sm ${
        isDragging ? "rounded-lg bg-white shadow-xl ring-2 ring-[var(--wl-accent)] dark:bg-neutral-900" : ""
      }`}
    >
      {draggable ? (
        <button
          type="button"
          aria-label={`Drag to reorder ${claim.add_player_name}, currently #${rank}`}
          className="flex h-11 w-9 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-black/40 hover:bg-black/5 active:cursor-grabbing dark:text-white/40 dark:hover:bg-white/10"
          {...attributes}
          {...listeners}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden>
            <circle cx="7" cy="5" r="1.4" />
            <circle cx="7" cy="10" r="1.4" />
            <circle cx="7" cy="15" r="1.4" />
            <circle cx="13" cy="5" r="1.4" />
            <circle cx="13" cy="10" r="1.4" />
            <circle cx="13" cy="15" r="1.4" />
          </svg>
        </button>
      ) : (
        <span className="w-9 shrink-0" aria-hidden />
      )}
      <span className={`w-5 shrink-0 text-center text-lg font-extrabold tabular-nums ${rank === 1 ? "text-[var(--wl-accent)]" : ""}`}>{rank}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="wrap-break-word font-semibold">
          {claim.add_player_name}
          {claim.add_player_position && (
            <span className="ml-1.5 text-xs font-normal text-black/50 dark:text-white/50">
              {claim.add_player_position}
              {claim.add_player_pro_team ? ` · ${claim.add_player_pro_team}` : ""}
            </span>
          )}
        </span>
        <span className="text-xs text-black/50 dark:text-white/50">
          {claim.drop_player_name ? `Drop ${claim.drop_player_name}` : "No drop"}
          {laterClear && <span className="text-amber-600 dark:text-amber-400"> · clears {laterClear}</span>}
        </span>
      </span>
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        className="min-h-9 shrink-0 rounded-full border border-black/10 px-3 text-xs font-medium text-black/60 hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
      >
        {cancelling ? "Cancelling…" : "Cancel"}
      </button>
    </li>
  );
}
