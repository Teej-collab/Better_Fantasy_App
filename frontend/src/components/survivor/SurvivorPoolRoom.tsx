"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ANTON, ELITE, EliteCard, HEX_CLIP, initials } from "@/components/elite/Elite";
import { kickoffText, livesText, LivesPips, pctColor, rulesLine, SURVIVOR_TEAMS, TeamLogo } from "@/components/survivor/SurvivorKit";
import { survivorApi, type SurvivorBoard, type SurvivorBoardTeam, type SurvivorPickView, type SurvivorPlanner, type SurvivorPoolDetail } from "@/lib/survivorApi";

type BoardTeam = SurvivorBoardTeam & { kickoff: string | null };

/**
 * The web's survivor pool room (2026-11-07, canvas "Elite Survivor
 * Pools", Web): this week's pick on the left (the Ladder, with the Hive
 * as a toggle), the Field and how the pool picked on the right, and the
 * week-by-week planner underneath. Same rules as the app: each pick
 * locks at its own kickoff and other people's picks show once it starts.
 */
export function SurvivorPoolRoom({ poolId, entryId }: { poolId: number; entryId: number | null }) {
  const [pool, setPool] = useState<SurvivorPoolDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<number | null>(entryId);

  const refresh = useCallback(async () => setPool(await survivorApi.pool(poolId)), [poolId]);
  useEffect(() => {
    // The setState lands after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch(() => setError("Couldn't load this pool."));
  }, [refresh]);

  if (!pool) return <p className="py-10 text-center text-sm text-white/60">{error ?? "Loading…"}</p>;
  const mine = pool.mine;
  const activeEntry = entry ?? mine.find((m) => m.alive)?.entry_id ?? mine[0]?.entry_id ?? null;
  const field = pool.field;
  const lastPopular = [...field.popularity].reverse().find((w) => w.week < pool.week) ?? field.popularity.at(-1) ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Link href="/survivor" className="text-xs font-bold" style={{ color: ELITE.green }}>
            ‹ Survivor
          </Link>
          <h1 className={`${ANTON} text-4xl leading-none tracking-wide sm:text-5xl`} style={{ color: ELITE.green, textShadow: "0 0 22px rgba(57,255,20,.45)" }}>
            {pool.name.toUpperCase()}
          </h1>
          <p className="text-sm" style={{ color: ELITE.soft }}>
            {pool.league_name ? `${pool.league_name} · ` : ""}
            {rulesLine(pool)}
          </p>
          {pool.prize_note && <p className="text-sm font-semibold" style={{ color: ELITE.peach }}>{pool.prize_note}</p>}
        </div>
        {mine.length > 1 && (
          <nav aria-label="Your entries" className="flex gap-1.5 rounded-xl border border-white/[0.06] bg-[#10151c] p-1">
            {mine.map((m) => (
              <button
                key={m.entry_id}
                type="button"
                onClick={() => setEntry(m.entry_id)}
                aria-pressed={m.entry_id === activeEntry}
                className="rounded-lg px-3.5 py-2 text-sm font-bold"
                style={m.entry_id === activeEntry ? { background: "#1f2833", color: ELITE.cream } : { color: m.alive ? ELITE.soft : ELITE.grey }}
              >
                Entry {m.entry_no}
                {!m.alive ? " · out" : ""}
              </button>
            ))}
          </nav>
        )}
      </div>

      {field.winners.length > 0 && (
        <EliteCard tone="green" className="p-4 text-lg font-extrabold" style={{ color: ELITE.green }}>
          {field.winners.length === 1 ? `${field.winners[0]} is the last one standing` : `${field.winners.join(" and ")} split it`}
        </EliteCard>
      )}

      <div className="flex flex-wrap items-start gap-5">
        <section className="flex min-w-0 flex-col gap-4" style={{ flex: "999 1 560px" }}>
          {activeEntry !== null ? (
            <PickBoard key={activeEntry} entryId={activeEntry} onSaved={() => void refresh()} />
          ) : (
            <JoinCard pool={pool} onJoined={(id) => { setEntry(id); void refresh(); }} />
          )}
        </section>

        <aside className="flex min-w-0 flex-col gap-4" style={{ flex: "1 1 320px" }}>
          <EliteCard className="flex flex-col gap-2.5 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className={`${ANTON} text-[22px]`}>THE FIELD</h2>
              <span className={`${ANTON} text-2xl`}>
                {field.alive}
                <span className="text-[15px]" style={{ color: ELITE.faint }}>/{field.rows.length} alive</span>
              </span>
            </div>
            {pool.week >= pool.start_week && (
              <p className="text-xs" style={{ color: ELITE.faint }}>
                Week {pool.week} picks show as each game kicks off · {field.picked} of {field.alive} have picked
              </p>
            )}
            {field.rows.map((r) => {
              const out = r.eliminated_week !== null;
              const color = out ? "#2a323d" : r.lives_left >= pool.lives ? ELITE.green : ELITE.orange;
              return (
                <div key={r.entry_id} className={`flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 ${r.mine ? "border border-[rgba(57,255,20,.35)] bg-[rgba(57,255,20,.08)]" : ""} ${out ? "opacity-55" : ""}`}>
                  <span className={`${ANTON} flex h-8 w-7 shrink-0 items-center justify-center text-[11px]`} style={{ clipPath: HEX_CLIP, background: color, color: ELITE.deep }}>
                    {initials(r.name)}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-bold">{r.mine ? `${r.name} (you)` : r.name}</span>
                    <span className="text-[11px]" style={{ color: out ? ELITE.grey : r.lives_left >= pool.lives ? ELITE.mint : ELITE.peach }}>
                      {out ? `Out in week ${r.eliminated_week}` : livesText(r.lives_left)}
                    </span>
                  </span>
                  <span className="flex gap-1">
                    {r.picks.slice(-3).map((p, i) => (
                      <PickChip key={i} pick={p} />
                    ))}
                  </span>
                </div>
              );
            })}
          </EliteCard>

          {lastPopular && (
            <EliteCard className="flex flex-col gap-2 p-4">
              <h2 className={`${ANTON} text-lg`}>WEEK {lastPopular.week} · WHO THEY PICKED</h2>
              {lastPopular.teams.slice(0, 5).map((t) => {
                const total = lastPopular.teams.reduce((n, x) => n + x.count, 0) || 1;
                const lost = t.result === "loss" || (t.result === "tie" && pool.tie_counts_as === "loss");
                return (
                  <div key={t.team} className="flex items-center gap-2 text-xs">
                    <TeamLogo team={t.team} size={22} />
                    <span className="w-10 font-bold">{t.team}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded bg-[#222a35]">
                      <span className="block h-full" style={{ width: `${Math.round((t.count / total) * 100)}%`, background: lost ? ELITE.orange : ELITE.green }} />
                    </span>
                    <span className="w-20 text-right" style={{ color: t.result ? (lost ? ELITE.orange : ELITE.mint) : ELITE.faint }}>
                      {t.count} · {t.result ? (lost ? "lost" : t.result === "tie" ? "tied" : "won") : "playing"}
                    </span>
                  </div>
                );
              })}
            </EliteCard>
          )}

          <EliteCard className="flex flex-col gap-2 p-4">
            <h2 className={`${ANTON} text-lg`}>INVITE</h2>
            <p className="text-xs" style={{ color: ELITE.soft }}>
              {pool.league_id ? `Anyone in ${pool.league_name ?? "the league"} can join from their Survivor page, or with this code.` : "Anyone with this code can join."}
            </p>
            <div className="flex items-center justify-between">
              <span className={`${ANTON} text-3xl tracking-[4px]`}>{pool.join_code}</span>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(pool.join_code)}
                className="min-h-9 rounded-full border px-4 text-xs font-bold"
                style={{ borderColor: ELITE.green, color: ELITE.green }}
              >
                Copy
              </button>
            </div>
          </EliteCard>
        </aside>
      </div>

      {activeEntry !== null && <PlannerTable key={`plan-${activeEntry}`} entryId={activeEntry} />}
    </div>
  );
}

function PickChip({ pick }: { pick: SurvivorPickView }) {
  if (pick.hidden) {
    return (
      <span className="flex h-7 w-8 items-center justify-center text-xs" style={{ color: ELITE.mint }} aria-label="Picked, hidden until kickoff">
        ●
      </span>
    );
  }
  const lost = pick.result === "loss" || pick.result === "missed";
  return (
    <span className="flex h-7 w-8 items-center justify-center rounded-md" style={{ background: lost ? "rgba(255,122,26,.2)" : undefined }} title={`Week ${pick.week}: ${pick.team ?? "no pick"}`}>
      {pick.team ? <TeamLogo team={pick.team} size={20} /> : <span className="text-xs" style={{ color: ELITE.grey }}>✕</span>}
    </span>
  );
}

function JoinCard({ pool, onJoined }: { pool: SurvivorPoolDetail; onJoined: (entryId: number) => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <EliteCard className="flex flex-col gap-3 p-5">
      <h2 className={`${ANTON} text-2xl`}>{pool.can_add_entry ? "JOIN THIS POOL" : "THIS POOL ALREADY STARTED"}</h2>
      <p className="text-sm" style={{ color: ELITE.soft }}>{pool.can_add_entry ? `It starts in week ${pool.start_week}.` : "You can still follow the Field."}</p>
      {error && <p className="text-sm" style={{ color: ELITE.orange }}>{error}</p>}
      {pool.can_add_entry && (
        <button
          type="button"
          onClick={() =>
            survivorApi
              .join(pool.league_id ? { pool_id: pool.id } : { code: pool.join_code })
              .then((r) => onJoined(r.entry_id))
              .catch((e: Error) => setError(e.message))
          }
          className="min-h-12 rounded-[14px] text-sm font-extrabold"
          style={{ background: ELITE.green, color: ELITE.deep }}
        >
          Join
        </button>
      )}
    </EliteCard>
  );
}

function PickBoard({ entryId, onSaved }: { entryId: number; onSaved: () => void }) {
  const [board, setBoard] = useState<SurvivorBoard | null>(null);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [view, setView] = useState<"ladder" | "hive">("ladder");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    survivorApi
      .board(entryId)
      .then((b) => live && setBoard(b))
      .catch(() => live && setError("Couldn't load this week's games."));
    return () => {
      live = false;
    };
  }, [entryId]);

  if (!board) return <EliteCard className="p-5 text-sm text-white/60">{error ?? "Loading this week's games…"}</EliteCard>;
  const teams: BoardTeam[] = board.games.flatMap((g) => g.teams.map((t) => ({ ...t, kickoff: g.kickoff })));
  const byTeam = new Map(teams.map((t) => [t.team, t]));
  const saved = board.picks.flatMap((p) => (!p.hidden && p.team ? [p.team] : []));
  const lockedPicks = board.picks.flatMap((p) => (!p.hidden && p.team && p.locked ? [p.team] : []));
  const picks = chosen ?? saved;
  const out = board.eliminated_week !== null;
  const canPick = board.can_pick && !out;
  const dirty = chosen !== null && (chosen.length !== saved.length || chosen.some((t) => !saved.includes(t)));

  function toggle(team: string) {
    const t = byTeam.get(team);
    if (!t || t.locked || t.used_week !== null || !canPick) return;
    if (picks.includes(team)) {
      if (!lockedPicks.includes(team)) setChosen(picks.filter((x) => x !== team));
      return;
    }
    const game = board!.games.find((g) => g.teams.some((x) => x.team === team));
    const sameGame = picks.find((x) => game?.teams.some((g) => g.team === x));
    let next = sameGame && !lockedPicks.includes(sameGame) ? picks.filter((x) => x !== sameGame) : picks;
    if (next.length >= board!.slots) {
      const replaceable = next.filter((x) => !lockedPicks.includes(x));
      if (!replaceable.length) return;
      next = next.filter((x) => x !== replaceable[replaceable.length - 1]);
    }
    setChosen([...next, team]);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      setBoard(await survivorApi.setPicks(entryId, picks));
      setChosen(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your pick.");
    } finally {
      setSaving(false);
    }
  }

  async function buyBack() {
    try {
      await survivorApi.buyBack(entryId);
      setBoard(await survivorApi.board(entryId));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't buy back in.");
    }
  }

  const available = teams.filter((t) => t.used_week === null).sort((a, b) => (b.win_pct ?? -1) - (a.win_pct ?? -1));
  const usedPlaying = teams.filter((t) => t.used_week !== null);
  const first = picks.map((t) => byTeam.get(t)).filter((t): t is BoardTeam => Boolean(t));

  return (
    <EliteCard className="flex flex-col gap-3.5 p-5" style={{ border: "1px solid rgba(57,255,20,.25)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h2 className={`${ANTON} text-[26px] tracking-wide`}>
          {canPick ? `MAKE YOUR WEEK ${board.week} PICK` : `WEEK ${board.week}`}
          {board.slots === 2 ? " · TWO PICKS" : ""}
        </h2>
        {!out && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: ELITE.soft }}>
            <LivesPips left={board.lives_left} total={board.lives_total} />
            {livesText(board.lives_left)} · used teams are dimmed
          </span>
        )}
      </div>
      {out && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3" style={{ borderColor: "rgba(255,122,26,.45)", background: "rgba(255,122,26,.1)" }}>
          <span className="font-bold">You&apos;re out (week {board.eliminated_week})</span>
          {board.can_buy_back && (
            <button type="button" onClick={() => void buyBack()} className="min-h-10 rounded-xl px-4 text-sm font-extrabold" style={{ background: ELITE.green, color: ELITE.deep }}>
              Buy back in with one life
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-[10px] border border-white/[0.06] bg-[#10151c] p-[3px]" role="tablist">
          {(["ladder", "hive"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className="min-h-8 rounded-lg px-3.5 text-xs font-bold" style={view === v ? { background: "#1f2833", color: ELITE.cream } : { color: ELITE.soft }}>
              {v === "ladder" ? "Best odds" : "Hive"}
            </button>
          ))}
        </div>
        <span className="text-xs" style={{ color: ELITE.faint }}>Each pick locks at its own kickoff.</span>
      </div>

      {view === "ladder" ? (
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))" }}>
          {available.map((t, i) => {
            const on = picks.includes(t.team);
            const color = pctColor(t.win_pct);
            return (
              <button
                key={t.team}
                type="button"
                onClick={() => toggle(t.team)}
                disabled={(t.locked && !on) || !canPick}
                aria-pressed={on}
                aria-label={`${t.team} ${t.home ? "versus" : "at"} ${t.opponent}, ${t.win_pct === null ? "no line yet" : `${t.win_pct}% to win`}${t.locked ? ", locked" : ""}`}
                className="flex items-center gap-2.5 rounded-xl border-[1.5px] px-3 py-2 text-left disabled:cursor-default"
                style={{
                  background: on ? "rgba(57,255,20,.12)" : "#161c25",
                  borderColor: on ? ELITE.green : "transparent",
                  boxShadow: on ? "0 0 14px rgba(57,255,20,.2)" : undefined,
                  opacity: t.locked && !on ? 0.5 : 1,
                }}
              >
                <span className={`${ANTON} w-5 text-center text-sm`} style={{ color: ELITE.grey }}>{i + 1}</span>
                <TeamLogo team={t.team} size={30} />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-sm font-extrabold">
                    {t.team} <span className="text-xs font-medium" style={{ color: ELITE.soft }}>{t.home ? "vs" : "@"} {t.opponent}</span>
                  </span>
                  <span className="block h-[5px] overflow-hidden rounded bg-[#222a35]">
                    <span className="block h-full" style={{ width: `${t.win_pct ?? 0}%`, background: color }} />
                  </span>
                </span>
                <span className="flex w-16 flex-col items-end">
                  <span className={`${ANTON} text-lg`} style={{ color }}>{t.win_pct === null ? "—" : `${t.win_pct}%`}</span>
                  <span className="text-[10px]" style={{ color: ELITE.faint }}>{t.locked ? "Locked" : kickoffText(t.kickoff)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Hive board={board} byTeam={byTeam} picks={picks} onPick={toggle} />
      )}

      {usedPlaying.length > 0 && view === "ladder" && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: ELITE.faint }}>
          {usedPlaying.map((t) => (
            <TeamLogo key={t.team} team={t.team} size={16} dim />
          ))}
          {usedPlaying.length} {usedPlaying.length === 1 ? "team" : "teams"} you&apos;ve used play this week
        </p>
      )}
      {error && <p className="text-sm" style={{ color: ELITE.orange }}>{error}</p>}

      {canPick && (
        <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.07] pt-3">
          {first.map((t) => (
            <TeamLogo key={t.team} team={t.team} size={36} />
          ))}
          <span className="min-w-48 flex-1 text-sm" style={{ color: ELITE.soft }}>
            {first.length ? (
              <>
                <b className="text-[#f5f4ec]">{first.map((t) => `${t.team} ${t.home ? "vs" : "@"} ${t.opponent}`).join(" + ")}</b>
                {first[0]?.kickoff ? ` · locks ${kickoffText(first[0].kickoff)}` : ""}
              </>
            ) : (
              "Pick a team to win."
            )}
          </span>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving || picks.length === 0}
            className="min-h-12 rounded-xl px-6 text-[15px] font-extrabold disabled:opacity-55"
            style={{ background: ELITE.green, color: ELITE.deep, boxShadow: "0 0 22px rgba(57,255,20,.35)" }}
          >
            {saving
              ? "Saving…"
              : !dirty && saved.length
                ? `Locked in: ${saved.join(" + ")}`
                : first.length === 1 && first[0].win_pct !== null
                  ? `Lock in ${first[0].team} · ${first[0].win_pct}%`
                  : `Lock in ${picks.join(" + ") || "your pick"}`}
          </button>
        </div>
      )}
    </EliteCard>
  );
}

function Hive({ board, byTeam, picks, onPick }: { board: SurvivorBoard; byTeam: Map<string, BoardTeam>; picks: string[]; onPick: (t: string) => void }) {
  const rank = (t: string) => {
    const b = byTeam.get(t);
    if (!b) return 3000 + SURVIVOR_TEAMS.indexOf(t);
    if (b.used_week !== null) return 2000 + SURVIVOR_TEAMS.indexOf(t);
    return 1000 - (b.win_pct ?? 50);
  };
  const order = [...SURVIVOR_TEAMS].sort((a, b) => rank(a) - rank(b));
  const rows: string[][] = [];
  let i = 0;
  for (const n of [8, 7, 8, 7, 2]) {
    rows.push(order.slice(i, i + n));
    i += n;
  }
  return (
    <div className="flex flex-col items-center overflow-x-auto py-1">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-1" style={{ marginTop: r ? -17 : 0 }}>
          {row.map((team) => {
            const b = byTeam.get(team);
            const on = picks.includes(team);
            const dim = !b || b.used_week !== null || (b.locked && !on) || !board.can_pick;
            const rim = !b || b.used_week !== null || (b.locked && !on) ? "#3a414b" : on ? ELITE.cream : pctColor(b.win_pct);
            const tag = !b ? "BYE" : b.used_week !== null ? `W${b.used_week}` : b.win_pct === null ? "—" : `${b.win_pct}%`;
            return (
              <button
                key={team}
                type="button"
                onClick={() => onPick(team)}
                disabled={dim}
                aria-pressed={on}
                aria-label={`${team}, ${!b ? "bye" : b.used_week !== null ? `used in week ${b.used_week}` : b.win_pct === null ? "no line yet" : `${b.win_pct}% to win`}`}
                className="flex h-[67px] w-[58px] items-center justify-center"
                style={{ clipPath: HEX_CLIP, background: rim, filter: on ? "drop-shadow(0 0 10px rgba(57,255,20,.8))" : undefined }}
              >
                <span className="flex h-[61px] w-[53px] flex-col items-center justify-center gap-px" style={{ clipPath: HEX_CLIP, background: on ? "#16290f" : rim === "#3a414b" ? "#12161c" : ELITE.card }}>
                  <TeamLogo team={team} size={28} dim={rim === "#3a414b"} />
                  <span className={`${ANTON} text-[11px] leading-none`} style={{ color: rim === "#3a414b" ? ELITE.grey : rim }}>{tag}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
      <p className="mt-2 text-xs" style={{ color: ELITE.faint }}>Brighter rims are bigger favorites. Used and bye teams are dimmed.</p>
    </div>
  );
}

function PlannerTable({ entryId }: { entryId: number }) {
  const [data, setData] = useState<SurvivorPlanner | null>(null);
  const [plan, setPlan] = useState<Record<string, true>>({});
  useEffect(() => {
    let live = true;
    survivorApi
      .planner(entryId)
      .then((d) => live && setData(d))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [entryId]);
  if (!data || data.rows.length === 0) return null;
  const keys = Object.keys(plan);
  let odds = 1;
  for (const key of keys) {
    const [team, week] = key.split("-");
    const c = data.rows.find((r) => r.team === team)?.weeks[data.weeks.indexOf(Number(week))];
    if (c?.win_pct) odds *= c.win_pct / 100;
  }
  return (
    <section className="flex flex-col gap-2.5 rounded-[18px] border border-white/[0.06] bg-[#10151c] p-4 text-[#f5f4ec]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={`${ANTON} text-[22px]`}>THE ROAD AHEAD</h2>
        <span className="text-xs" style={{ color: ELITE.faint }}>
          Win % for your unused teams · this week from Vegas, later weeks projected from our ratings until lines post
          {data.double_weeks.length ? ` · two picks a week from week ${data.double_weeks[0]}` : ""} · click cells to sketch a path
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="border-separate text-xs" style={{ borderSpacing: 4, minWidth: 640 }}>
          <thead>
            <tr>
              <th scope="col" className="px-1 text-left text-[10px]" style={{ color: ELITE.faint }}>TEAM</th>
              {data.weeks.map((w) => (
                <th key={w} scope="col" className="w-14 text-[10px]" style={{ color: ELITE.soft }}>
                  W{w}
                  {data.double_weeks.includes(w) ? " ×2" : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.team}>
                <th scope="row" className="whitespace-nowrap px-1 text-left">
                  <span className="flex items-center gap-1.5">
                    <TeamLogo team={r.team} size={20} />
                    {r.team}
                  </span>
                </th>
                {r.weeks.map((c, i) => {
                  const key = `${r.team}-${data.weeks[i]}`;
                  const on = Boolean(plan[key]);
                  const pct = c?.win_pct ?? null;
                  const bg = !c ? "#0b0e12" : pct === null ? "#1b222c" : pct >= 70 ? "rgba(57,255,20,.55)" : pct >= 62 ? "rgba(57,255,20,.32)" : pct >= 55 ? "rgba(157,255,134,.16)" : pct >= 50 ? "#1b222c" : "rgba(255,122,26,.16)";
                  return (
                    <td key={key} className="p-0">
                      <button
                        type="button"
                        disabled={!c}
                        aria-pressed={on}
                        aria-label={`${r.team} week ${data.weeks[i]}: ${!c ? "bye" : `${c.home ? "vs" : "at"} ${c.opponent}${pct === null ? "" : `, ${pct}%`}`}`}
                        title={c ? `${c.home ? "vs" : "@"} ${c.opponent}` : "Bye"}
                        onClick={() =>
                          setPlan((p) => {
                            const next = { ...p };
                            if (next[key]) delete next[key];
                            else next[key] = true;
                            return next;
                          })
                        }
                        className="h-[30px] w-full rounded-md text-center font-bold"
                        style={{ background: bg, color: !c ? ELITE.grey : ELITE.cream, outline: on ? `2px solid ${ELITE.green}` : undefined, outlineOffset: -2 }}
                      >
                        {!c ? "BYE" : pct === null ? "·" : `${pct}%`}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {keys.length > 0 && (
        <p className="text-sm" style={{ color: ELITE.soft }}>
          Your path ({keys.length} picks): chance every one of them wins <b style={{ color: ELITE.green }}>{Math.round(odds * 100)}%</b>
        </p>
      )}
    </section>
  );
}
