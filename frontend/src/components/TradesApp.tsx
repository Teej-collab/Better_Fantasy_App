"use client";

import { useCallback, useEffect, useState } from "react";
import { GroupTitle, inputClass, panelClass } from "@/components/commissioner/CommishBits";
import { trackTap } from "@/lib/analyticsEvents";
import { NAV_ACCENT } from "@/lib/navDestinations";
import {
  acceptTrade,
  addToTradeBlock,
  cancelTrade,
  evaluateTrade,
  getLeagueTeamsForTrades,
  getLeagueTrades,
  getMyTrades,
  getTeamRosterForTrade,
  getTradeBlock,
  getTradeEvaluation,
  getTradePartners,
  proposeTrade,
  rejectTrade,
  removeFromTradeBlock,
  voteToVeto,
  type Trade,
  type TradeBlockPlayer,
  type TradeEvaluation,
  type TradePartner,
  type TradeRosterPlayer,
  type TradeSettings,
  type TradeStatus,
  type TradeTeam,
  type TradeValuePlayer,
} from "@/lib/tradesApi";

// Trades (2026-10-23 overhaul, the approved "Trades" mockups 4–6): the
// inbox (offers to you with a read on whether they're good for you, your
// offers, the trade block, the league's trades), the builder (fairness
// meter, your lineup before → after, a "to even it out" suggestion) and
// an offer (accept with a drop if needed, counter, decline). Values are
// rest-of-season points a week (backend app/domain/trade_values.py). Same
// as the app's trades.tsx, trade-builder.tsx and trade/[id].tsx.

const YOU = "#38bdf8";
const THEM = "#f97316";
const EVEN = "#16a34a";
const YELLOW = "#ca8a04";
const PURPLE = "#a855f7";
const MUTED = "text-black/55 dark:text-white/60";

const STATUS_LABEL: Record<TradeStatus, string> = {
  pending: "Waiting for an answer",
  awaiting_review: "Waiting on the commissioner",
  in_review: "In review",
  accepted: "Went through",
  rejected: "Declined",
  cancelled: "Withdrawn",
  vetoed: "Vetoed",
  expired: "Expired",
  failed: "Couldn't go through",
};

type View = { kind: "hub" } | { kind: "build"; team: number | null; player: string | null; counter: number | null } | { kind: "trade"; id: number };

function when(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function until(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  return h >= 48 ? `${Math.floor(h / 24)} days` : h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60_000))}m`;
}

function pos(p: string | null | undefined): string {
  return p === "DEF" ? "D/ST" : (p ?? "");
}

function pts(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}`;
}

function verdictFor(change: number): { text: string; color: string } {
  if (Math.abs(change) < 1.5) return { text: `Looks even · ${pts(change)} pts a week for you`, color: EVEN };
  if (change > 0) return { text: `Good for you · ${pts(change)} pts a week`, color: YOU };
  return { text: `Favors them · ${pts(change)} pts a week for you`, color: THEM };
}

function getsFor(trade: Trade, teamId: number): string {
  return trade.assets.filter((a) => a.to_team_id === teamId).map((a) => a.player_name).join(", ") || "—";
}

function leanFor(trade: Trade): string | null {
  const v = trade.value;
  if (!v) return null;
  if (v.verdict === "even") return "Looks even";
  if (v.verdict !== "leans") return null;
  return `Leans ${(v.leans_team_id === trade.proposing_team_id ? trade.proposing_team_name : trade.receiving_team_name) ?? "one side"}`;
}

function reviewLine(s: TradeSettings | null): string | null {
  if (!s) return null;
  const hrs = `${s.review_hours} hour${s.review_hours === 1 ? "" : "s"}`;
  switch (s.review_mode) {
    case "none":
      return "Trades go through as soon as they're accepted.";
    case "commissioner":
      return `Accepted trades wait ${hrs} for the commissioner, then go through.`;
    case "league_vote":
      return `Accepted trades wait ${hrs}; ${s.effective_veto_votes_needed} veto votes stop one.`;
    default:
      return "Accepted trades wait for the commissioner to approve them.";
  }
}

const bigButton = "min-h-12 w-full rounded-xl px-5 text-[15px] font-extrabold disabled:opacity-45";
const outlineButton = `${bigButton} border border-black/15 dark:border-white/15`;
const dangerButton = `${bigButton} border border-red-500/50 text-red-500`;

export function TradesApp({
  myOwnerId,
  initialTeamId,
  initialPlayerId,
  counterId = null,
  tradeId = null,
}: {
  myOwnerId: number;
  initialTeamId: number | null;
  initialPlayerId: string | null;
  counterId?: number | null;
  tradeId?: number | null;
}) {
  const [view, setView] = useState<View>(
    tradeId
      ? { kind: "trade", id: tradeId }
      : initialTeamId || counterId
        ? { kind: "build", team: initialTeamId, player: initialPlayerId, counter: counterId }
        : { kind: "hub" }
  );
  const [teams, setTeams] = useState<TradeTeam[] | null>(null);
  const [mine, setMine] = useState<Trade[]>([]);
  const [league, setLeague] = useState<{ trades: Trade[]; settings: TradeSettings } | null>(null);
  const [block, setBlock] = useState<TradeBlockPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getLeagueTeamsForTrades().then(setTeams).catch((e) => setError(e instanceof Error ? e.message : "Couldn't load trades."));
    getMyTrades().then(setMine).catch(() => setMine([]));
    getLeagueTrades().then(setLeague).catch(() => setLeague(null));
    getTradeBlock().then(setBlock).catch(() => setBlock([]));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const myTeam = teams?.find((t) => t.owner_id === myOwnerId) ?? null;
  const go = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0 });
  };
  const done = () => {
    load();
    go({ kind: "hub" });
  };

  if (error) return <p className="text-sm text-red-500">{error}</p>;
  if (!teams) return <p className={`text-sm ${MUTED}`}>Loading…</p>;
  if (!myTeam) return <p className={`text-sm ${MUTED}`}>You need a team in this league to trade.</p>;

  if (view.kind === "build") {
    const counter = view.counter ? (mine.find((t) => t.id === view.counter) ?? null) : null;
    return (
      <Builder
        key={`${view.team}-${view.player}-${counter?.id ?? ""}`}
        myTeamId={myTeam.team_id}
        teams={teams.filter((t) => t.team_id !== myTeam.team_id)}
        counter={counter}
        initialTeam={counter ? counter.proposing_team_id : view.team}
        initialPlayer={view.player}
        onBack={() => go({ kind: "hub" })}
        onSent={done}
      />
    );
  }
  if (view.kind === "trade") {
    const trade = [...mine, ...(league?.trades ?? [])].find((t) => t.id === view.id) ?? null;
    return (
      <Detail
        trade={trade}
        myTeamId={myTeam.team_id}
        onBack={() => go({ kind: "hub" })}
        onDone={done}
        onCounter={(id) => {
          trackTap("trades.counter");
          go({ kind: "build", team: null, player: null, counter: id });
        }}
      />
    );
  }
  return (
    <Hub
      myTeamId={myTeam.team_id}
      mine={mine}
      league={league}
      block={block}
      onOpen={(id) => go({ kind: "trade", id })}
      onBuild={(team, player) => {
        trackTap("trades.build");
        go({ kind: "build", team, player, counter: null });
      }}
      onChanged={load}
    />
  );
}

// ---- Inbox ------------------------------------------------------------------

function Hub({
  myTeamId,
  mine,
  league,
  block,
  onOpen,
  onBuild,
  onChanged,
}: {
  myTeamId: number;
  mine: Trade[];
  league: { trades: Trade[]; settings: TradeSettings } | null;
  block: TradeBlockPlayer[];
  onOpen: (id: number) => void;
  onBuild: (team: number | null, player: string | null) => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settings = league?.settings ?? null;
  const toMe = mine.filter((t) => t.status === "pending" && t.receiving_team_id === myTeamId);
  const fromMe = mine.filter((t) => t.status === "pending" && t.proposing_team_id === myTeamId);
  const inReview = mine.filter((t) => t.status === "in_review" || t.status === "awaiting_review");
  const past = mine.filter((t) => !["pending", "in_review", "awaiting_review"].includes(t.status)).slice(0, 8);
  const around = (league?.trades ?? []).filter((t) => t.proposing_team_id !== myTeamId && t.receiving_team_id !== myTeamId);
  const deadline = settings?.trade_deadline;
  const deadlineText = !settings
    ? null
    : !deadline
      ? "No trade deadline this season"
      : until(deadline)
        ? `Deadline in ${until(deadline)} · ${when(deadline)}`
        : "The trade deadline has passed";

  async function run(id: number, action: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {deadlineText && <p className="text-sm font-semibold" style={{ color: YELLOW }}>{deadlineText}</p>}
      <button type="button" onClick={() => onBuild(null, null)} className={`${bigButton} text-black`} style={{ backgroundColor: NAV_ACCENT }}>
        Build a trade
      </button>
      {reviewLine(settings) && <p className={`text-sm ${MUTED}`}>{reviewLine(settings)}</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {toMe.length > 0 && (
        <section className="flex flex-col gap-3">
          <GroupTitle title={`Offers to you · ${toMe.length}`} color={NAV_ACCENT} />
          {toMe.map((t) => {
            const v = t.value ? verdictFor(t.value.value_change) : null;
            return (
              <button key={t.id} type="button" onClick={() => onOpen(t.id)} className={`${panelClass} flex flex-col gap-3 p-4 text-left`}>
                <span className={`flex justify-between gap-2 text-xs ${MUTED}`}>
                  <span>From {t.proposing_team_name}</span>
                  {until(t.expires_at) && <span className="font-bold" style={{ color: YELLOW }}>Expires in {until(t.expires_at)}</span>}
                </span>
                <span className="grid grid-cols-2 gap-3">
                  <span className="flex flex-col gap-1">
                    <span className={`text-[11px] font-extrabold tracking-wider uppercase ${MUTED}`}>You get</span>
                    <span className="text-sm font-bold">{getsFor(t, myTeamId)}</span>
                  </span>
                  <span className="flex flex-col gap-1">
                    <span className={`text-[11px] font-extrabold tracking-wider uppercase ${MUTED}`}>You give</span>
                    <span className="text-sm font-bold">{getsFor(t, t.proposing_team_id)}</span>
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  {v ? <span className="text-sm font-extrabold" style={{ color: v.color }}>{v.text}</span> : <span />}
                  <span className="text-sm font-bold">Review ›</span>
                </span>
              </button>
            );
          })}
        </section>
      )}

      {fromMe.length > 0 && (
        <section className="flex flex-col gap-3">
          <GroupTitle title={`Your offers · ${fromMe.length}`} color={YOU} />
          {fromMe.map((t) => (
            <div key={t.id} className={`${panelClass} flex items-center gap-3 p-4`}>
              <button type="button" onClick={() => onOpen(t.id)} className="flex flex-1 flex-col text-left">
                <span className="text-sm font-bold">
                  {getsFor(t, t.receiving_team_id)} for {getsFor(t, myTeamId)}
                </span>
                <span className={`text-xs ${MUTED}`}>
                  To {t.receiving_team_name}
                  {until(t.expires_at) ? ` · expires in ${until(t.expires_at)}` : ""}
                </span>
              </button>
              <button
                type="button"
                disabled={busyId === t.id}
                onClick={() => run(t.id, () => cancelTrade(t.id))}
                className="min-h-10 rounded-full px-4 text-sm font-bold disabled:opacity-50"
                style={{ backgroundColor: `${THEM}2e` }}
              >
                {busyId === t.id ? "Working…" : "Withdraw"}
              </button>
            </div>
          ))}
        </section>
      )}

      {inReview.length > 0 && (
        <section className="flex flex-col gap-3">
          <GroupTitle title="Accepted, in review" color={YELLOW} />
          {inReview.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpen(t.id)} className={`${panelClass} flex flex-col gap-1 p-4 text-left`}>
              <span className="text-sm font-bold">
                {t.proposing_team_name} ↔ {t.receiving_team_name}
              </span>
              <span className={`text-xs ${MUTED}`}>
                {t.status === "in_review" && t.review_ends_at ? `Goes through ${when(t.review_ends_at)} unless vetoed` : STATUS_LABEL[t.status]}
              </span>
            </button>
          ))}
        </section>
      )}

      <BlockSection myTeamId={myTeamId} block={block} onPick={(team, player) => onBuild(team, player)} onChanged={onChanged} />

      {around.length > 0 && (
        <section className="flex flex-col gap-1">
          <GroupTitle title="Around the league" color="#8790a0" />
          {around.map((t) => {
            const canVote = t.status === "in_review" && settings?.review_mode === "league_vote";
            const lean = leanFor(t);
            return (
              <div key={t.id} className="flex flex-col gap-1 border-b border-black/5 py-3 dark:border-white/[0.08]">
                <span className="text-sm font-semibold">
                  {t.proposing_team_name} get {getsFor(t, t.proposing_team_id)} · {t.receiving_team_name} get {getsFor(t, t.receiving_team_id)}
                </span>
                <span className={`text-xs ${MUTED}`}>
                  {t.status === "in_review" && t.review_ends_at ? `In review · goes through ${when(t.review_ends_at)}` : STATUS_LABEL[t.status]}
                  {lean ? ` · ${lean}` : ""}
                  {canVote ? ` · ${t.veto_votes ?? 0} of ${settings?.effective_veto_votes_needed} veto votes` : ""}
                </span>
                {canVote && (
                  <button
                    type="button"
                    disabled={busyId === t.id}
                    onClick={() => run(t.id, () => voteToVeto(t.id, !t.my_veto_vote))}
                    className="mt-1 min-h-10 self-start rounded-full bg-red-500/10 px-4 text-sm font-bold text-red-500 disabled:opacity-50"
                  >
                    {busyId === t.id ? "Working…" : t.my_veto_vote ? "Take back veto vote" : "Vote to veto"}
                  </button>
                )}
              </div>
            );
          })}
        </section>
      )}

      {past.length > 0 && (
        <section className="flex flex-col gap-1">
          <GroupTitle title="Your past trades" color="#8790a0" />
          {past.map((t) => (
            <button key={t.id} type="button" onClick={() => onOpen(t.id)} className="flex flex-col gap-0.5 border-b border-black/5 py-3 text-left dark:border-white/[0.08]">
              <span className="text-sm font-semibold">
                With {t.proposing_team_id === myTeamId ? t.receiving_team_name : t.proposing_team_name}: got {getsFor(t, myTeamId)}
              </span>
              <span className={`text-xs ${MUTED}`}>
                {STATUS_LABEL[t.status]}
                {t.resolved_at ? ` · ${when(t.resolved_at)}` : ""}
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function BlockSection({
  myTeamId,
  block,
  onPick,
  onChanged,
}: {
  myTeamId: number;
  block: TradeBlockPlayer[];
  onPick: (team: number, player: string) => void;
  onChanged: () => void;
}) {
  const [listing, setListing] = useState(false);
  const [roster, setRoster] = useState<TradeRosterPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const others = block.filter((b) => b.team_id !== myTeamId);
  const mineListed = block.filter((b) => b.team_id === myTeamId);
  const listed = new Set(mineListed.map((b) => b.sleeper_player_id));

  useEffect(() => {
    if (listing) getTeamRosterForTrade(myTeamId).then(setRoster).catch(() => setRoster([]));
  }, [listing, myTeamId]);

  async function toggle(id: string, on: boolean) {
    setError(null);
    try {
      if (on) await removeFromTradeBlock(id);
      else await addToTradeBlock(id);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    }
  }

  const chip = "flex min-h-11 flex-col justify-center rounded-xl border border-black/10 px-3 py-1.5 text-left dark:border-white/10";
  return (
    <section className="flex flex-col gap-3">
      <GroupTitle title="Trade block" color={PURPLE} />
      <p className={`-mt-1 text-sm ${MUTED}`}>Players their owners say they&apos;d move. Click one to start a trade.</p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {others.map((b) => (
          <button key={`${b.team_id}-${b.sleeper_player_id}`} type="button" onClick={() => onPick(b.team_id, b.sleeper_player_id)} className={chip}>
            <span className="text-sm font-bold">{b.player_name}</span>
            <span className={`text-[11px] ${MUTED}`}>
              {pos(b.position)} · {b.per_week.toFixed(1)}/wk · {b.team_name}
            </span>
          </button>
        ))}
        {mineListed.map((b) => (
          <button key={`mine-${b.sleeper_player_id}`} type="button" onClick={() => toggle(b.sleeper_player_id, true)} className={chip} style={{ borderColor: `${PURPLE}88` }}>
            <span className="text-sm font-bold">{b.player_name} ✕</span>
            <span className={`text-[11px] ${MUTED}`}>Yours · click to take off</span>
          </button>
        ))}
        <button type="button" onClick={() => setListing((v) => !v)} className="min-h-11 rounded-xl border border-dashed px-3 text-sm font-bold" style={{ borderColor: PURPLE, color: PURPLE }}>
          {listing ? "Done" : "+ List one of yours"}
        </button>
      </div>
      {others.length === 0 && mineListed.length === 0 && !listing && <p className={`text-xs ${MUTED}`}>Nobody has listed anyone yet.</p>}
      {listing && (
        <div className="flex flex-wrap gap-2">
          {roster
            .filter((p) => !listed.has(p.sleeper_player_id))
            .map((p) => (
              <button key={p.sleeper_player_id} type="button" onClick={() => toggle(p.sleeper_player_id, false)} className={chip}>
                <span className="text-sm font-bold">{p.player_name}</span>
                <span className={`text-[11px] ${MUTED}`}>
                  {pos(p.position)} · {(p.per_week ?? 0).toFixed(1)}/wk
                </span>
              </button>
            ))}
        </div>
      )}
    </section>
  );
}

// ---- Shared pieces -----------------------------------------------------------

function ValueMeter({ change, empty }: { change: number; empty: boolean }) {
  const needle = Math.max(4, Math.min(96, 50 + change * 4));
  const v = verdictFor(change);
  return (
    <div className={`${panelClass} flex flex-col gap-2 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-xs font-extrabold tracking-widest uppercase ${MUTED}`}>Trade value</span>
        <span className="text-[15px] font-extrabold" style={{ color: empty ? undefined : v.color }}>
          {empty ? "Pick players on both sides" : v.text.split(" · ")[0]}
        </span>
      </div>
      <div className="relative flex h-3 rounded-full" role={empty ? undefined : "img"} aria-label={empty ? undefined : v.text}>
        <span className="h-3 flex-[2] rounded-l-full" style={{ backgroundColor: `${THEM}55` }} />
        <span className="h-3 flex-1 bg-black/10 dark:bg-white/10" />
        <span className="h-3 flex-[2] rounded-r-full" style={{ backgroundColor: `${YOU}55` }} />
        {!empty && <span className="absolute -top-1 h-5 w-1.5 -translate-x-1/2 rounded bg-black dark:bg-white" style={{ left: `${needle}%` }} />}
      </div>
      <div className={`flex justify-between text-[11px] ${MUTED}`}>
        <span>Better for them</span>
        <span>{empty ? "Even" : `${pts(change)} / wk`}</span>
        <span>Better for you</span>
      </div>
    </div>
  );
}

function LineupChange({ lineup, title }: { lineup: TradeEvaluation["my_lineup"]; title: string }) {
  const color = Math.abs(lineup.change) < 0.5 ? undefined : lineup.change > 0 ? YOU : THEM;
  return (
    <div className={`${panelClass} flex flex-col gap-2 p-4`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-xs font-extrabold tracking-widest uppercase ${MUTED}`}>{title}</span>
        <span className="text-sm font-extrabold" style={{ color }}>
          {pts(lineup.change)} / wk
        </span>
      </div>
      {lineup.slots.length === 0 ? (
        <p className={`text-sm ${MUTED}`}>Your starters stay the same.</p>
      ) : (
        lineup.slots.map((s, i) => (
          <div key={`${s.slot}-${i}`} className="grid grid-cols-[48px_minmax(0,1fr)_52px] items-center gap-2 border-t border-black/5 pt-2 text-sm dark:border-white/[0.08]">
            <span className={`text-xs font-extrabold ${MUTED}`}>{s.slot}</span>
            <span>
              {s.before ?? "Empty"} <span className={MUTED}>→</span> <b>{s.after ?? "Empty"}</b>
            </span>
            <span className="text-right font-extrabold" style={{ color: s.delta >= 0 ? YOU : THEM }}>
              {pts(s.delta)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

function DropPicker({
  needed,
  candidates,
  selected,
  onToggle,
}: {
  needed: number;
  candidates: TradeValuePlayer[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  if (needed <= 0) return null;
  return (
    <div className={`${panelClass} flex flex-col gap-2 p-4`} style={{ borderColor: `${YELLOW}88` }}>
      <span className="text-sm font-bold">
        {needed === 1 ? "Your roster is full: pick someone to drop" : `Your roster is full: pick ${needed} players to drop`}
      </span>
      <span className={`text-xs ${MUTED}`}>They&apos;re dropped only when the trade goes through.</span>
      <div className="flex flex-wrap gap-2">
        {candidates.map((c) => {
          const on = selected.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(c.id)}
              className="flex min-h-11 flex-col justify-center rounded-xl border px-3 py-1.5 text-left"
              style={on ? { borderColor: YELLOW, backgroundColor: `${YELLOW}22` } : { borderColor: "rgba(127,127,127,0.3)" }}
            >
              <span className="text-sm font-bold">{c.name}</span>
              <span className={`text-[11px] ${MUTED}`}>
                {pos(c.position)} · {c.per_week.toFixed(1)}/wk
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toggleIn(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

// ---- Builder -----------------------------------------------------------------

function Builder({
  myTeamId,
  teams,
  counter,
  initialTeam,
  initialPlayer,
  onBack,
  onSent,
}: {
  myTeamId: number;
  teams: TradeTeam[];
  counter: Trade | null;
  initialTeam: number | null;
  initialPlayer: string | null;
  onBack: () => void;
  onSent: () => void;
}) {
  const [partner, setPartner] = useState<number | null>(initialTeam);
  const [give, setGive] = useState<string[]>(counter ? counter.assets.filter((a) => a.from_team_id === myTeamId).map((a) => a.sleeper_player_id) : []);
  const [receive, setReceive] = useState<string[]>(
    counter ? counter.assets.filter((a) => a.from_team_id === counter.proposing_team_id).map((a) => a.sleeper_player_id) : initialPlayer ? [initialPlayer] : []
  );
  const [drops, setDrops] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [mine, setMine] = useState<TradeRosterPlayer[]>([]);
  const [theirs, setTheirs] = useState<TradeRosterPlayer[]>([]);
  const [ev, setEv] = useState<TradeEvaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partners, setPartners] = useState<TradePartner[] | null>(null);
  const partnerName = teams.find((t) => t.team_id === partner)?.team_name ?? "";
  const partnerInfo = partners?.find((t) => t.team_id === partner) ?? null;

  useEffect(() => {
    getTeamRosterForTrade(myTeamId).then(setMine).catch(() => setMine([]));
    getTradePartners().then(setPartners).catch(() => setPartners([]));
  }, [myTeamId]);
  useEffect(() => {
    if (partner !== null) getTeamRosterForTrade(partner).then(setTheirs).catch(() => setTheirs([]));
  }, [partner]);
  useEffect(() => {
    if (partner === null || (give.length === 0 && receive.length === 0)) return;
    let live = true;
    evaluateTrade(partner, give, receive, drops)
      .then((r) => live && setEv(r))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [partner, give, receive, drops]);

  const ready = partner !== null && give.length > 0 && receive.length > 0;
  const needed = ev?.my_drops_needed ?? 0;
  const dropsOk = drops.filter((d) => !give.includes(d)).length >= needed;

  function takeSuggestion() {
    const s = ev?.suggestion;
    if (!s) return;
    trackTap("trades.suggestion");
    if (s.side === "give") setGive((g) => (g.includes(s.player.id) ? g : [...g, s.player.id]));
    else setReceive((r) => (r.includes(s.player.id) ? r : [...r, s.player.id]));
  }

  async function send() {
    if (!ready || partner === null) return;
    setBusy(true);
    setError(null);
    try {
      await proposeTrade(partner, give, receive, note.trim(), { drops, counterOf: counter?.id ?? null });
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send that offer.");
    } finally {
      setBusy(false);
    }
  }

  const column = (title: string, color: string, players: TradeRosterPlayer[], selected: string[], onPick: (id: string) => void) => (
    <div className="flex flex-col gap-1.5">
      <GroupTitle title={title} color={color} />
      {players.map((p) => {
        const on = selected.includes(p.sleeper_player_id);
        return (
          <button
            key={p.sleeper_player_id}
            type="button"
            aria-pressed={on}
            onClick={() => onPick(p.sleeper_player_id)}
            className="flex min-h-12 flex-col justify-center rounded-xl border px-3 py-1.5 text-left"
            style={on ? { borderColor: color, backgroundColor: `${color}22` } : { borderColor: "rgba(127,127,127,0.25)" }}
          >
            <span className="truncate text-sm font-bold">{p.player_name}</span>
            <span className={`truncate text-[11px] ${MUTED}`}>
              {pos(p.position)} · {(p.per_week ?? 0).toFixed(1)}/wk{p.injury_status ? ` · ${p.injury_status}` : ""}
              {p.on_block ? " · on the block" : ""}
            </span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <button type="button" onClick={onBack} className="self-start text-sm font-semibold">
        ‹ Trades
      </button>
      <div>
        <h2 className="font-display text-2xl font-semibold uppercase">{counter ? "Counter offer" : "Build a trade"}</h2>
        {partner === null && <p className={`text-sm ${MUTED}`}>Who do you want to trade with?</p>}
      </div>

      {partner === null ? (
        <PartnerList
          partners={partners}
          onPick={(id) => {
            setPartner(id);
            setReceive([]);
            setDrops([]);
            setEv(null);
          }}
        />
      ) : (
        <>
          <div className={`${panelClass} flex items-center gap-3 p-3`} style={{ borderColor: `${THEM}66` }}>
            <Avatar name={partnerName} url={partnerInfo?.logo_url ?? null} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={`text-[11px] font-extrabold tracking-wider uppercase ${MUTED}`}>Trading with</span>
              <span className="truncate font-bold">{partnerName}</span>
            </span>
            {counter === null && (
              <button type="button" onClick={() => setPartner(null)} className="min-h-10 rounded-full px-4 text-sm font-bold" style={{ backgroundColor: `color-mix(in srgb, ${NAV_ACCENT} 20%, transparent)` }}>
                Change
              </button>
            )}
          </div>
          <ValueMeter change={ev?.value_change ?? 0} empty={!ready || !ev} />
          <div className="grid grid-cols-2 gap-3">
            {column("You give", YOU, mine, give, (id) => {
              setGive((g) => toggleIn(g, id));
              setDrops((d) => d.filter((x) => x !== id));
            })}
            {column("You get", THEM, theirs, receive, (id) => setReceive((r) => toggleIn(r, id)))}
          </div>
          {ready && ev && <LineupChange lineup={ev.my_lineup} title="Your starting lineup after" />}
          {ready && ev?.suggestion && (
            <div className="flex flex-col items-start gap-2 rounded-2xl border p-4" style={{ borderColor: `${YELLOW}88`, backgroundColor: `${YELLOW}14` }}>
              <p className="text-sm">
                {ev.value_change > 0
                  ? `${partnerName} is unlikely to take this. Adding ${ev.suggestion.player.name} from your side makes it close to even.`
                  : `You're giving up more. Asking for ${ev.suggestion.player.name} too evens it out.`}
              </p>
              <button type="button" onClick={takeSuggestion} className="min-h-10 rounded-full px-4 text-sm font-bold" style={{ backgroundColor: `${YELLOW}33` }}>
                Add {ev.suggestion.player.name}
              </button>
            </div>
          )}
          {ev && <DropPicker needed={needed} candidates={ev.drop_candidates} selected={drops} onToggle={(id) => setDrops((d) => toggleIn(d, id))} />}
          <label className={`flex flex-col gap-1 text-sm ${MUTED}`}>
            Add a note (optional)
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} placeholder="Why this works for both of you" className={inputClass} />
          </label>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <button type="button" disabled={!ready || !dropsOk || busy} onClick={send} className={`${bigButton} text-black`} style={{ backgroundColor: NAV_ACCENT }}>
            {busy ? "Sending…" : counter ? "Send counter" : "Send offer"}
          </button>
          {ready && !dropsOk && <p className={`text-center text-xs ${MUTED}`}>Pick who you&apos;d drop first.</p>}
        </>
      )}
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Blob URL
    return <img src={url} alt="" className="size-10 shrink-0 rounded-full object-cover" />;
  }
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black/10 text-sm font-extrabold dark:bg-white/10">
      {initials}
    </span>
  );
}

// Every other team as a row, best trade partners for you first: their
// record, what they're thin at and deep at, and why they fit (backend
// GET /trades/partners).
function PartnerList({ partners, onPick }: { partners: TradePartner[] | null; onPick: (teamId: number) => void }) {
  if (!partners) return <p className={`text-sm ${MUTED}`}>Loading…</p>;
  if (partners.length === 0) return <p className={`text-sm ${MUTED}`}>No other teams in this league yet.</p>;
  return (
    <div className={`${panelClass} flex flex-col divide-y divide-black/5 overflow-hidden dark:divide-white/[0.08]`}>
      {partners.map((t) => {
        const record = `${t.wins}–${t.losses}${t.ties ? `–${t.ties}` : ""}`;
        const shape = [t.needs.length ? `Needs ${t.needs.join(", ")}` : null, t.deep_at.length ? `Deep at ${t.deep_at.join(", ")}` : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <button key={t.team_id} type="button" onClick={() => onPick(t.team_id)} className="flex min-h-16 items-center gap-3 p-3 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
            <Avatar name={t.team_name} url={t.logo_url} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-baseline gap-2">
                <span className="truncate font-bold">{t.team_name}</span>
                <span className={`ml-auto shrink-0 text-sm font-bold ${MUTED}`}>{record}</span>
              </span>
              <span className={`text-xs ${MUTED}`}>{shape || t.owner_name || ""}</span>
              {t.fit_reason && <span className="text-xs font-bold text-green-600 dark:text-green-400">{t.fit_reason}</span>}
            </span>
            <span aria-hidden className={`text-xl ${MUTED}`}>
              ›
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---- One trade -----------------------------------------------------------------

function Detail({
  trade,
  myTeamId,
  onBack,
  onDone,
  onCounter,
}: {
  trade: Trade | null;
  myTeamId: number;
  onBack: () => void;
  onDone: () => void;
  onCounter: (id: number) => void;
}) {
  const [ev, setEv] = useState<TradeEvaluation | null>(null);
  const [drops, setDrops] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const involved = trade !== null && (trade.proposing_team_id === myTeamId || trade.receiving_team_id === myTeamId);

  useEffect(() => {
    if (trade && involved) getTradeEvaluation(trade.id).then(setEv).catch(() => setEv(null));
  }, [trade, involved]);

  if (!trade) {
    return (
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onBack} className="self-start text-sm font-semibold">
          ‹ Trades
        </button>
        <p className={`text-sm ${MUTED}`}>That trade isn&apos;t around any more.</p>
      </div>
    );
  }

  const toMe = trade.receiving_team_id === myTeamId;
  const fromMe = trade.proposing_team_id === myTeamId;
  const other = toMe ? trade.proposing_team_name : trade.receiving_team_name;
  const pending = trade.status === "pending";
  const needed = ev?.my_drops_needed ?? 0;
  const myDrops = (trade.drops ?? []).filter((d) => d.team_id === myTeamId);
  const left = toMe || fromMe ? myTeamId : trade.proposing_team_id;
  const right = left === trade.proposing_team_id ? trade.receiving_team_id : trade.proposing_team_id;
  const valueOf = (pid: string) => [...(ev?.give ?? []), ...(ev?.receive ?? [])].find((p) => p.id === pid)?.per_week ?? null;
  const v = ev ? verdictFor(ev.value_change) : null;
  const subtitle = pending
    ? `Sent ${when(trade.proposed_at)}${trade.expires_at ? ` · expires ${when(trade.expires_at)}` : ""}`
    : trade.status === "in_review" && trade.review_ends_at
      ? `In review · goes through ${when(trade.review_ends_at)} unless vetoed`
      : STATUS_LABEL[trade.status];

  async function act(action: "accept" | "reject" | "cancel") {
    if (!trade) return;
    setBusy(action);
    setError(null);
    try {
      if (action === "accept") await acceptTrade(trade.id, drops);
      else if (action === "reject") await rejectTrade(trade.id);
      else await cancelTrade(trade.id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <button type="button" onClick={onBack} className="self-start text-sm font-semibold">
        ‹ Trades
      </button>
      <div>
        <h2 className="font-display text-2xl font-semibold uppercase">
          {toMe ? `Offer from ${other}` : fromMe ? `Your offer to ${other}` : `${trade.proposing_team_name} ↔ ${trade.receiving_team_name}`}
        </h2>
        <p className={`text-sm ${MUTED}`}>{subtitle}</p>
      </div>
      {trade.note && (
        <div className={`${panelClass} p-4`}>
          <span className={`block text-[11px] font-extrabold tracking-wider uppercase ${MUTED}`}>Their note</span>
          <span className="text-sm">&ldquo;{trade.note}&rdquo;</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {[left, right].map((teamId, i) => {
          const color = i === 0 ? YOU : THEM;
          const label = toMe || fromMe ? (i === 0 ? "You get" : "You give") : `${teamId === trade.proposing_team_id ? trade.proposing_team_name : trade.receiving_team_name} get`;
          return (
            <div key={teamId} className={`${panelClass} flex flex-col gap-1.5 p-4`} style={{ borderColor: `${color}66` }}>
              <span className="text-[11px] font-extrabold tracking-wider uppercase" style={{ color }}>
                {label}
              </span>
              {trade.assets
                .filter((a) => a.to_team_id === teamId)
                .map((a) => {
                  const value = valueOf(a.sleeper_player_id);
                  return (
                    <span key={a.sleeper_player_id} className="flex flex-col">
                      <span className="text-[15px] font-bold">{a.player_name}</span>
                      <span className={`text-xs ${MUTED}`}>
                        {pos(a.position)}
                        {value !== null ? ` · ${value.toFixed(1)}/wk` : ""}
                      </span>
                    </span>
                  );
                })}
            </div>
          );
        })}
      </div>
      {v && (
        <p className="text-[15px] font-extrabold" style={{ color: v.color }}>
          {v.text}
        </p>
      )}
      {ev && <LineupChange lineup={ev.my_lineup} title="Your starting lineup, before → after" />}
      {myDrops.length > 0 && <p className={`text-xs ${MUTED}`}>You&apos;ll drop {myDrops.map((d) => d.player_name).join(", ")} when it goes through.</p>}
      {pending && toMe && ev && (
        <DropPicker needed={needed} candidates={ev.drop_candidates} selected={drops} onToggle={(id) => setDrops((d) => toggleIn(d, id))} />
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
      {pending && toMe && (
        <div className="flex flex-col gap-2">
          <button type="button" disabled={busy !== null || drops.length < needed} onClick={() => act("accept")} className={`${bigButton} text-black`} style={{ backgroundColor: NAV_ACCENT }}>
            {busy === "accept" ? "Accepting…" : "Accept"}
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={busy !== null} onClick={() => onCounter(trade.id)} className={outlineButton}>
              Counter
            </button>
            <button type="button" disabled={busy !== null} onClick={() => act("reject")} className={dangerButton}>
              {busy === "reject" ? "Declining…" : "Decline"}
            </button>
          </div>
        </div>
      )}
      {pending && fromMe && (
        <button type="button" disabled={busy !== null} onClick={() => act("cancel")} className={dangerButton}>
          {busy === "cancel" ? "Withdrawing…" : "Withdraw offer"}
        </button>
      )}
    </div>
  );
}
