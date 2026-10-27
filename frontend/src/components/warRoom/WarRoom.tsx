"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { KeepersPanel } from "@/components/KeepersPanel";
import { PositionBadge } from "@/components/draft/PositionBadge";
import { formatCountdown } from "@/lib/api";
import {
  getWarRoom,
  nudgeKeepers,
  type WarRoom as WarRoomData,
  type WarRoomHeadline,
  type WarRoomKeepers,
  type WarRoomPhase,
  type WarRoomReportCard,
  type WarRoomDraft,
} from "@/lib/warRoomApi";

// My Team's War Room (2026-10-27): keepers, draft day and the draft's
// report card in one tab. It opens on whatever the calendar says
// (the backend's `phase`); the other tabs stay one tap away.

const PHASES: { key: WarRoomPhase; label: string }[] = [
  { key: "keepers", label: "Keepers" },
  { key: "draft", label: "Draft" },
  { key: "report_card", label: "Report Card" },
];

const muted = "text-black/55 dark:text-white/55";

function useMinuteTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);
}

function Card({ title, aside, children, highlight }: { title?: string; aside?: ReactNode; children: ReactNode; highlight?: boolean }) {
  return (
    <section
      className="neon-panel flex flex-col gap-3 rounded-xl p-4"
      style={highlight ? { borderColor: "color-mix(in srgb, var(--wl-accent) 45%, transparent)" } : undefined}
    >
      {(title || aside) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h2 className={`text-xs font-semibold tracking-wide uppercase ${muted}`}>{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

function pickLabel(round: number, roundPick: number, isKeeper: boolean) {
  return isKeeper ? "K" : `${round}.${String(roundPick).padStart(2, "0")}`;
}

export function WarRoom({ isCommissioner }: { isCommissioner: boolean }) {
  const [data, setData] = useState<WarRoomData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<WarRoomPhase | null>(null);

  useEffect(() => {
    getWarRoom()
      .then((d) => {
        setData(d);
        setPhase((p) => p ?? d.phase);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load the War Room"));
  }, []);

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!data || !phase) return <p className={`text-sm ${muted}`}>Loading…</p>;

  const tabs = PHASES.filter((p) => p.key !== "keepers" || data.keepers);
  const done: Record<WarRoomPhase, boolean> = {
    keepers: Boolean(data.keepers?.locked),
    draft: data.draft.status === "complete",
    report_card: false,
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="War Room"
        className="grid gap-1 rounded-xl border border-black/10 p-1 dark:border-white/10"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={phase === t.key}
            onClick={() => setPhase(t.key)}
            className={`min-h-10 rounded-lg text-sm font-semibold ${
              phase === t.key ? "bg-[var(--wl-accent)] text-black" : muted
            }`}
          >
            {t.label}
            {done[t.key] && phase !== t.key ? " ✓" : ""}
          </button>
        ))}
      </div>
      {phase === "keepers" && data.keepers && <KeepersTab keepers={data.keepers} isCommissioner={isCommissioner} />}
      {phase === "draft" && <DraftTab draft={data.draft} />}
      {phase === "report_card" &&
        (data.report_card ? (
          <ReportCardTab card={data.report_card} />
        ) : (
          <Card>
            <p className={`text-sm ${muted}`}>Your report card shows up here once the draft is done.</p>
          </Card>
        ))}
    </div>
  );
}

function KeepersTab({ keepers, isCommissioner }: { keepers: WarRoomKeepers; isCommissioner: boolean }) {
  useMinuteTick();
  const [nudge, setNudge] = useState<string | null>(null);
  const me = keepers.managers.find((m) => m.is_me);
  const myCount = me?.count ?? 0;

  async function sendNudge() {
    try {
      const { nudged } = await nudgeKeepers();
      setNudge(`Nudged ${nudged} manager${nudged === 1 ? "" : "s"}.`);
    } catch (e) {
      setNudge(e instanceof Error ? e.message : "Couldn't send the nudge");
    }
  }

  return (
    <>
      {keepers.is_open && (
        <Card highlight title={keepers.deadline ? "Keepers lock" : "Keepers are open"}>
          {keepers.deadline && (
            <p className="text-3xl font-extrabold tabular-nums">{formatCountdown(keepers.deadline)}</p>
          )}
          <p className={`text-sm ${muted}`}>
            {keepers.deadline
              ? `${new Date(keepers.deadline).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Then everyone's keepers are revealed at once.`
              : "Your commissioner hasn't set a deadline yet."}
          </p>
          {me && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-xs">
                <span className="font-semibold">
                  {myCount} of {keepers.max_keepers} keepers picked
                </span>
                {keepers.max_consecutive_years && (
                  <span className={muted}>Up to {keepers.max_consecutive_years} years per player</span>
                )}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div
                  className="h-full bg-[var(--wl-accent)]"
                  style={{ width: `${Math.min(100, (myCount / keepers.max_keepers) * 100)}%` }}
                />
              </div>
            </div>
          )}
        </Card>
      )}

      <KeepersPanel isCommissioner={isCommissioner} />

      <Card
        title="League keeper board"
        aside={<span className={`text-xs ${muted}`}>{keepers.locked ? "Locked" : "Hidden until lock"}</span>}
      >
        {!keepers.locked && <p className={`text-sm ${muted}`}>See who&apos;s done without seeing who they kept.</p>}
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {keepers.managers.map((m) => (
            <li key={m.owner_id} className="flex flex-col gap-1 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold">{m.name}</span>
                <span
                  className="text-xs font-bold tabular-nums"
                  style={{ color: m.done ? "var(--wl-accent)" : m.count > 0 ? "#f59e0b" : "#f87171" }}
                >
                  {m.count}/{keepers.max_keepers}
                  {m.done ? " ✓" : ""}
                </span>
              </div>
              {m.players && m.players.length > 0 && <span className={`text-xs ${muted}`}>{m.players.join(" · ")}</span>}
            </li>
          ))}
        </ul>
        {keepers.is_open && keepers.waiting_on > 0 && (
          <button
            type="button"
            onClick={() => void sendNudge()}
            className="min-h-11 rounded-full border border-black/10 px-4 text-sm font-semibold dark:border-white/15"
          >
            Nudge the {keepers.waiting_on} who aren&apos;t done
          </button>
        )}
        {nudge && <p className={`text-sm ${muted}`} role="status">{nudge}</p>}
      </Card>
    </>
  );
}

function DraftTab({ draft }: { draft: WarRoomDraft }) {
  useMinuteTick();
  const live = draft.status === "in_progress" || draft.status === "paused";
  const facts = [
    draft.draft_type ? draft.draft_type[0].toUpperCase() + draft.draft_type.slice(1) : null,
    draft.team_count ? `${draft.team_count} teams` : null,
    draft.rounds ? `${draft.rounds} rounds` : null,
    draft.pick_seconds ? `${draft.pick_seconds}s per pick` : null,
  ].filter(Boolean);

  return (
    <>
      <Card highlight title={live ? "The draft is live" : draft.status === "complete" ? "Draft's done" : "Draft starts"}>
        {!live && draft.status !== "complete" && (
          <p className="text-3xl font-extrabold tabular-nums">
            {draft.scheduled_start ? formatCountdown(draft.scheduled_start) : "Date not set yet"}
          </p>
        )}
        {draft.scheduled_start && !live && draft.status !== "complete" && (
          <p className={`text-sm ${muted}`}>
            {new Date(draft.scheduled_start).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          </p>
        )}
        {facts.length > 0 && <p className={`text-xs font-semibold tracking-wide uppercase ${muted}`}>{facts.join(" · ")}</p>}
        <Link href="/draft" className="flex min-h-11 items-center justify-center rounded-full bg-[var(--wl-accent)] px-4 text-sm font-bold text-black">
          {draft.status === "complete" ? "See the full draft board" : "Enter the draft room"}
        </Link>
      </Card>

      {draft.my_picks.length > 0 && (
        <Card
          title={draft.my_slot ? `Your picks · slot ${draft.my_slot}` : "Your picks"}
          aside={
            draft.my_picks.some((p) => p.is_keeper) ? (
              <span className={`text-xs ${muted}`}>Struck-through rounds went to keepers</span>
            ) : undefined
          }
        >
          <div className="flex flex-wrap gap-1.5">
            {draft.my_picks.map((p) => {
              const next = p.pick_number === draft.next_pick;
              return (
                <span
                  key={p.pick_number}
                  title={p.player_name ?? undefined}
                  className={`rounded-md px-2 py-1 text-xs font-bold tabular-nums ${
                    next ? "bg-[color-mix(in_srgb,var(--wl-accent)_18%,transparent)] text-[var(--wl-accent)]" : "bg-black/5 dark:bg-white/5"
                  } ${p.is_keeper ? `line-through ${muted}` : ""}`}
                >
                  {p.round}.{String(p.round_pick).padStart(2, "0")}
                </span>
              );
            })}
          </div>
          {draft.next_pick && (
            <p className={`text-sm ${muted}`}>
              Your next pick is <b className="text-[var(--wl-text)]">#{draft.next_pick} overall</b>.
            </p>
          )}
        </Card>
      )}

      {draft.likely_available.length > 0 && draft.next_pick && (
        <Card title={`Likely still there at #${draft.next_pick}`}>
          <ul className="flex flex-col gap-2">
            {draft.likely_available.map((p) => (
              <li key={p.sleeper_player_id} className="flex items-center gap-3">
                <PositionBadge position={p.position} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{p.name}</span>
                  <span className={`text-xs ${muted}`}>
                    {p.team ? `${p.team} · ` : ""}ADP {p.adp}
                  </span>
                </span>
                <span className="text-xs font-bold tabular-nums" style={{ color: p.chance >= 0.6 ? "var(--wl-accent)" : "#f59e0b" }}>
                  {Math.round(p.chance * 100)}%
                </span>
              </li>
            ))}
          </ul>
          <p className={`text-xs ${muted}`}>The chance he&apos;s still on the board, from market ADP and the picks ahead of you.</p>
        </Card>
      )}

      {draft.status !== "complete" && (
        <Card title="Your queue" aside={<Link href="/draft" className="text-sm font-semibold text-[var(--wl-accent)]">Edit</Link>}>
          {draft.queue.length === 0 ? (
            <p className={`text-sm ${muted}`}>Nobody queued yet. Build it in the draft room.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {draft.queue.map((p, i) => (
                <li key={p.sleeper_player_id} className="flex items-center gap-3 text-sm">
                  <span className={`w-4 text-xs tabular-nums ${muted}`}>{i + 1}</span>
                  <PositionBadge position={p.position} />
                  <span className="flex-1 truncate font-semibold">{p.name}</span>
                  {p.adp !== null && <span className={`text-xs tabular-nums ${muted}`}>ADP {p.adp}</span>}
                </li>
              ))}
            </ol>
          )}
          <p className={`text-xs ${muted}`}>Miss your pick and autopick takes the top of your queue, then the best ADP left.</p>
        </Card>
      )}

      {draft.keepers_off_board.length > 0 && (
        <Card title="Already off the board">
          <ul className="flex flex-col gap-2">
            {draft.keepers_off_board.map((k) => (
              <li key={k.owner_id} className="flex gap-3 rounded-lg bg-black/5 px-3 py-2 text-sm dark:bg-white/5">
                <span className="w-24 shrink-0 font-semibold">{k.name}</span>
                <span className={muted}>{k.players.join(" · ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {draft.order.length > 0 && (
        <Card title="Draft order">
          <ol className="flex flex-wrap gap-1.5 text-xs">
            {draft.order.map((o, i) => (
              <li key={o.owner_id} className="rounded-md bg-black/5 px-2 py-1 dark:bg-white/5">
                <span className={`tabular-nums ${muted}`}>{i + 1}.</span> {o.name}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}

const STATUS_TAG: Record<string, { label: string; color: string }> = {
  starter: { label: "STARTER", color: "#22c55e" },
  bench: { label: "BENCH", color: "#8790a0" },
  ir: { label: "IR", color: "#f87171" },
  gone: { label: "GONE", color: "#8790a0" },
};

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function Headline({ label, h, tone }: { label: string; h: WarRoomHeadline; tone: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-black/5 px-3 py-2.5 dark:bg-white/5">
      <span className="text-xs font-bold tracking-wide uppercase" style={{ color: tone }}>
        {label}
      </span>
      <span className="text-sm font-semibold">
        {h.owner_name} · Rd {h.round} · {h.player_name}
      </span>
      <span className={`text-xs ${muted}`}>
        {h.position && h.position_rank ? `${h.position}${h.position_rank} so far · ` : ""}
        {h.points} pts
      </span>
    </div>
  );
}

function ReportCardTab({ card }: { card: WarRoomReportCard }) {
  const [showAll, setShowAll] = useState(false);
  const picks = showAll ? card.picks : card.picks.slice(0, 8);
  const moved = card.hindsight && card.draft_day.rank ? card.draft_day.rank - card.hindsight.rank : 0;

  return (
    <>
      <Card highlight>
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center">
            <span className={`text-[10px] font-bold tracking-wide uppercase ${muted}`}>Draft day</span>
            <span className={`text-5xl leading-none font-black ${muted}`}>{card.draft_day.letter ?? "—"}</span>
          </div>
          {card.hindsight && (
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold tracking-wide text-[var(--wl-accent)] uppercase">
                {card.through_week ? `After Week ${card.through_week}` : "Now"}
              </span>
              <span className="text-5xl leading-none font-black text-[var(--wl-accent)]">{card.hindsight.letter}</span>
            </div>
          )}
          {card.hindsight && (
            <div className="ml-auto flex flex-col items-end">
              <span className="text-xl font-extrabold">{ordinal(card.hindsight.rank)}</span>
              <span className={`text-xs ${muted}`}>of {card.team_count} drafts</span>
              {moved !== 0 && (
                <span className="text-xs font-bold" style={{ color: moved > 0 ? "var(--wl-accent)" : "#f87171" }}>
                  {moved > 0 ? "up" : "down"} {Math.abs(moved)} spot{Math.abs(moved) === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
        </div>
        {card.narrative && <p className="text-sm leading-relaxed italic opacity-85">&ldquo;{card.narrative}&rdquo;</p>}
        <p className={`text-xs ${muted}`}>Re-graded each week on what every pick has actually scored.</p>
      </Card>

      <Card
        title="Your picks, so far"
        aside={card.through_week ? <span className={`text-xs ${muted}`}>Pts through Wk {card.through_week}</span> : undefined}
      >
        <ul className="flex flex-col gap-2">
          {picks.map((p) => {
            const status = STATUS_TAG[p.status];
            return (
              <li key={p.pick_number} className={`flex items-center gap-2 ${p.status === "gone" ? "opacity-60" : ""}`}>
                <span className={`w-9 text-xs tabular-nums ${muted}`}>{pickLabel(p.round, p.round_pick, p.is_keeper)}</span>
                <PositionBadge position={p.position} />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{p.player_name}</span>
                {p.tag && (
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-extrabold"
                    style={{
                      color: p.tag === "steal" ? "var(--wl-accent)" : "#f87171",
                      background: p.tag === "steal" ? "color-mix(in srgb, var(--wl-accent) 15%, transparent)" : "rgba(248,113,113,0.15)",
                    }}
                  >
                    {p.tag === "steal" ? "STEAL" : "BUST"}
                  </span>
                )}
                <span className="rounded px-1.5 py-0.5 text-[10px] font-extrabold" style={{ color: status.color, background: `color-mix(in srgb, ${status.color} 15%, transparent)` }}>
                  {status.label}
                </span>
                <span className="w-12 text-right text-sm font-bold tabular-nums">{p.points}</span>
              </li>
            );
          })}
        </ul>
        {card.picks.length > 8 && (
          <button type="button" onClick={() => setShowAll((s) => !s)} className="w-fit text-sm font-semibold text-[var(--wl-accent)]">
            {showAll ? "Show fewer" : `All ${card.picks.length} picks`}
          </button>
        )}
      </Card>

      {(card.best_pick || card.biggest_miss) && (
        <Card title="Hindsight">
          {card.best_pick && <Headline label="Best pick in the league" h={card.best_pick} tone="var(--wl-accent)" />}
          {card.biggest_miss && <Headline label="Biggest miss" h={card.biggest_miss} tone="#f87171" />}
        </Card>
      )}

      {card.keeper_watch && (
        <Card title="Next year's keeper watch" aside={<span className={`text-xs ${muted}`}>{card.keeper_watch.slots} slots</span>}>
          <ul className="flex flex-col gap-2">
            {card.keeper_watch.players.map((p) => (
              <li key={p.sleeper_player_id} className={`flex items-center gap-3 text-sm ${p.eligible ? "" : "opacity-55"}`}>
                <PositionBadge position={p.position} />
                <span className="flex-1 truncate font-semibold">{p.name}</span>
                <span className={`text-xs ${p.eligible && p.next_year === 1 ? "text-[var(--wl-accent)]" : muted}`}>
                  {!p.eligible
                    ? "Maxed out"
                    : p.next_year === 1
                      ? "Fresh keeper"
                      : p.max_years
                        ? `Year ${p.next_year} of ${p.max_years}`
                        : `Year ${p.next_year}`}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Link href="/draft" className="flex min-h-11 items-center justify-center rounded-full border border-black/10 text-sm font-semibold dark:border-white/15">
        Full draft board and league grades
      </Link>
    </>
  );
}
