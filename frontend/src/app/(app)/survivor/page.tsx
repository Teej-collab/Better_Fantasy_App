"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ANTON, ELITE, EliteCard, EliteTitle, HEX_CLIP } from "@/components/elite/Elite";
import { kickoffText, LivesPips, TeamLogo } from "@/components/survivor/SurvivorKit";
import { survivorApi, type SurvivorHub, type SurvivorPoolSummary } from "@/lib/survivorApi";

/**
 * The Survivor hub (2026-11-07, canvas "Elite Survivor Pools"): every
 * pool you're in or can join from your leagues and where each of your
 * entries stands, plus making a pool and joining one with a code. Same
 * screen as the app's mobile/src/app/survivor/index.tsx.
 */
export default function SurvivorHubPage() {
  const router = useRouter();
  const [hub, setHub] = useState<SurvivorHub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => setHub(await survivorApi.pools()), []);
  useEffect(() => {
    // The setState lands after the fetch.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().catch(() => setError("Couldn't load your pools. Are you signed in?"));
  }, [refresh]);
  useEffect(() => {
    // Straight from Create a League's "Just a survivor pool".
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get("create")) setCreating(true);
  }, []);

  async function join(body: { code?: string; pool_id?: number }) {
    setBusy(true);
    setError(null);
    try {
      const res = await survivorApi.join(body);
      router.push(`/survivor/${res.pool_id}?entry=${res.entry_id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't join that pool.");
    } finally {
      setBusy(false);
    }
  }

  if (!hub) {
    return (
      <div className="flex flex-col gap-4">
        <EliteTitle title="Survivor" />
        <p className="text-center text-sm text-white/60">{error ?? "Loading…"}</p>
      </div>
    );
  }
  const needing = hub.pools.reduce((n, p) => n + p.mine.filter((m) => m.needs_pick).length, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <EliteTitle kicker={`Week ${hub.week}`} title="Survivor" subtitle={hub.next_lock ? `Next lock ${kickoffText(hub.next_lock)}` : "Pick one NFL team to win each week. Lose and you're out."} />

      {needing > 0 && (
        <p className="rounded-xl border px-3 py-2.5 text-sm font-semibold" style={{ borderColor: "rgba(255,122,26,.45)", background: "rgba(255,122,26,.12)", color: ELITE.peach }}>
          {needing} {needing === 1 ? "entry still needs" : "entries still need"} a week {hub.week} pick
        </p>
      )}
      {error && <p className="text-sm" style={{ color: ELITE.orange }}>{error}</p>}

      {hub.pools.length === 0 && !creating && (
        <EliteCard className="p-4">
          <p className="font-extrabold">No pools yet</p>
          <p className="mt-1 text-sm" style={{ color: ELITE.soft }}>
            Pick one NFL team to win each week. Lose and you&apos;re out, and you can only use each team once. Start a pool or join one with its code.
          </p>
        </EliteCard>
      )}

      <div className="flex flex-col gap-3">
        {hub.pools.map((p) => (
          <PoolCard key={p.id} pool={p} busy={busy} onJoin={() => void join({ pool_id: p.id })} />
        ))}
      </div>

      {creating ? (
        <CreatePool hub={hub} onCancel={() => setCreating(false)} onCreated={(id) => router.push(`/survivor/${id}?created=1`)} />
      ) : (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex min-h-12 flex-1 items-center justify-center rounded-[14px] border bg-[#141a22] px-4 text-sm font-extrabold"
            style={{ borderColor: "rgba(57,255,20,.5)", color: ELITE.green }}
          >
            + Create a pool
          </button>
          <form
            className="flex min-h-12 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void join({ code: code.trim() });
            }}
          >
            <label className="sr-only" htmlFor="survivor-code">
              Pool code
            </label>
            <input
              id="survivor-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="Code"
              className={`${ANTON} min-w-0 flex-1 rounded-[14px] border border-white/10 bg-[#10151c] px-3 text-lg tracking-[4px] text-[#f5f4ec] placeholder:text-white/40`}
            />
            <button type="submit" disabled={!code.trim() || busy} className="rounded-[14px] border border-white/15 bg-[#141a22] px-4 text-sm font-bold text-[#f5f4ec] disabled:opacity-50">
              Join
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function PoolCard({ pool, busy, onJoin }: { pool: SurvivorPoolSummary; busy: boolean; onJoin: () => void }) {
  const mine = pool.mine;
  const alive = mine.some((m) => m.alive);
  const label = mine.length === 0 ? "JOIN" : mine.length > 1 ? `${mine.filter((m) => m.alive).length}/${mine.length}` : alive ? "ALIVE" : "OUT";
  const lit = alive || mine.length === 0;
  return (
    <EliteCard tone={alive && mine.some((m) => m.needs_pick) ? "green" : "plain"} className={`flex flex-col gap-3 p-4 ${mine.length > 0 && !alive ? "opacity-70" : ""}`}>
      <Link href={`/survivor/${pool.id}`} className="flex items-center gap-3">
        <span className="flex h-[53px] w-[46px] shrink-0 items-center justify-center" style={{ clipPath: HEX_CLIP, background: lit ? ELITE.green : "#3a414b" }}>
          <span className={`${ANTON} flex h-[46px] w-[40px] items-center justify-center text-[13px]`} style={{ clipPath: HEX_CLIP, background: lit ? "#0d1a0b" : "#161b22", color: lit ? ELITE.green : "#a3aab4" }}>
            {label}
          </span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-base font-extrabold">{pool.name}</span>
          <span className="flex flex-wrap items-center gap-1.5 text-xs" style={{ color: ELITE.soft }}>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide" style={pool.league_id ? { color: ELITE.blue, background: "rgba(125,211,252,.14)" } : { color: ELITE.peach, background: "rgba(255,178,122,.14)" }}>
              {pool.league_id ? "LEAGUE" : "STANDALONE"}
            </span>
            {pool.alive} of {pool.entries} alive
            {mine.length === 1 && mine[0].alive && <LivesPips left={mine[0].lives_left} total={mine[0].lives_total} />}
          </span>
        </span>
      </Link>
      {pool.winners.length > 0 && <p className="text-sm font-bold" style={{ color: ELITE.green }}>Winner: {pool.winners.join(", ")}</p>}
      {mine.length === 0 ? (
        <div className="flex items-center justify-between border-t border-white/[0.07] pt-2.5 text-sm">
          <span style={{ color: ELITE.soft }}>{pool.can_add_entry ? `Starts week ${pool.start_week}` : "This pool already started"}</span>
          {pool.can_add_entry && (
            <button type="button" disabled={busy} onClick={onJoin} className="min-h-9 rounded-full border px-4 text-xs font-bold" style={{ borderColor: ELITE.green, color: ELITE.green }}>
              Join
            </button>
          )}
        </div>
      ) : (
        mine.map((m) => {
          const pick = m.picks.find((p) => !p.hidden && p.team);
          return (
            <div key={m.entry_id} className="flex items-center gap-2.5 border-t border-white/[0.07] pt-2.5 text-sm">
              {mine.length > 1 && <span className="w-14 text-xs" style={{ color: ELITE.faint }}>Entry {m.entry_no}</span>}
              <span className="flex min-w-0 flex-1 items-center gap-2">
                {!m.alive ? (
                  <span style={{ color: ELITE.soft }}>Out in week {m.eliminated_week}</span>
                ) : pick && !pick.hidden ? (
                  <>
                    <TeamLogo team={pick.team} size={24} />
                    <span className="font-bold">
                      {pick.team} <span className="font-normal" style={{ color: ELITE.soft }}>{pick.home ? "vs" : "@"} {pick.opponent}</span>
                    </span>
                  </>
                ) : m.needs_pick ? (
                  <span className="font-semibold" style={{ color: ELITE.peach }}>No week {pool.week} pick yet</span>
                ) : (
                  <span style={{ color: ELITE.soft }}>Starts week {pool.start_week}</span>
                )}
              </span>
              {m.alive && pool.week >= pool.start_week && (
                <Link
                  href={`/survivor/${pool.id}?entry=${m.entry_id}`}
                  className="flex min-h-9 items-center rounded-full px-4 text-xs font-extrabold"
                  style={m.needs_pick ? { background: ELITE.green, color: ELITE.deep } : { border: `1px solid ${ELITE.green}`, color: ELITE.green }}
                >
                  {m.needs_pick ? "Make pick" : "Change"}
                </Link>
              )}
            </div>
          );
        })
      )}
    </EliteCard>
  );
}

function Seg<T>({ options, value, onChange, label }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-[3px] rounded-lg bg-[#07090c] p-[2px]">
      {options.map((o) => (
        <button
          key={o.label}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className="min-h-8 min-w-9 rounded-md px-2 text-[11px] font-bold"
          style={o.value === value ? { background: ELITE.green, color: ELITE.deep } : { color: ELITE.soft }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CreatePool({ hub, onCancel, onCreated }: { hub: SurvivorHub; onCancel: () => void; onCreated: (id: number) => void }) {
  const league = hub.league;
  const canLeague = Boolean(league?.is_commissioner);
  const [name, setName] = useState("");
  const [forLeague, setForLeague] = useState(canLeague);
  const [lives, setLives] = useState(1);
  const [tie, setTie] = useState<"win" | "loss">("loss");
  const [buyback, setBuyback] = useState<number | null>(null);
  const [double, setDouble] = useState<number | null>(null);
  const [missed, setMissed] = useState<"auto" | "loss">("auto");
  const [entries, setEntries] = useState(1);
  const [prize, setPrize] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = hub.week;
  const doubleOptions = [16, 14].filter((w) => w > start);
  const buybackOptions = [start + 2, start + 4].filter((w) => w <= 18);

  async function create() {
    setSaving(true);
    setError(null);
    try {
      const res = await survivorApi.create({
        name: name.trim() || (forLeague && league ? `${league.name} Survivor` : "Survivor Pool"),
        for_league: forLeague,
        lives,
        tie_counts_as: tie,
        buyback_until_week: buyback,
        double_from_week: double,
        missed_pick: missed,
        max_entries: entries,
        prize_note: prize.trim() || null,
      });
      onCreated(res.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the pool.");
      setSaving(false);
    }
  }

  const rules: { title: string; sub: string; control: React.ReactNode }[] = [
    { title: "Lives", sub: "Losses you can take before you're out", control: <Seg label="Lives" options={[1, 2, 3].map((n) => ({ label: String(n), value: n }))} value={lives} onChange={setLives} /> },
    { title: "A tie counts as", sub: "For the team you picked", control: <Seg label="A tie counts as" options={[{ label: "Win", value: "win" as const }, { label: "Loss", value: "loss" as const }]} value={tie} onChange={setTie} /> },
    { title: "Buyback", sub: "One re-entry with one life after you're out", control: <Seg label="Buyback" options={[{ label: "Off", value: null }, ...buybackOptions.map((w) => ({ label: `Thru W${w}`, value: w as number | null }))]} value={buyback} onChange={setBuyback} /> },
    ...(doubleOptions.length
      ? [{ title: "Two picks a week", sub: "Speeds up the endgame. Uses teams fast", control: <Seg label="Two picks a week" options={[{ label: "Off", value: null }, ...doubleOptions.map((w) => ({ label: `W${w}+`, value: w as number | null }))]} value={double} onChange={setDouble} /> }]
      : []),
    { title: "Missed pick", sub: missed === "auto" ? "We pick the biggest favorite you have left" : "No pick counts as a loss", control: <Seg label="Missed pick" options={[{ label: "Auto", value: "auto" as const }, { label: "Loss", value: "loss" as const }]} value={missed} onChange={setMissed} /> },
    { title: "Entries per person", sub: "Each entry picks on its own", control: <Seg label="Entries per person" options={[1, 2, 3].map((n) => ({ label: String(n), value: n }))} value={entries} onChange={setEntries} /> },
  ];

  return (
    <EliteCard className="flex flex-col gap-3 p-4">
      <h2 className={`${ANTON} text-2xl`} style={{ color: ELITE.green }}>
        NEW POOL
      </h2>
      <label className="flex flex-col gap-1 text-[11px] font-bold tracking-wide" style={{ color: ELITE.faint }}>
        POOL NAME
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          placeholder={forLeague && league ? `${league.name} Survivor` : "Office Eliminator"}
          className="min-h-11 rounded-[10px] border border-white/10 bg-[#141a22] px-3 text-sm font-semibold text-[#f5f4ec] placeholder:text-white/40"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canLeague}
          onClick={() => setForLeague(true)}
          aria-pressed={forLeague}
          className="flex flex-col items-start gap-0.5 rounded-xl border-[1.5px] p-3 text-left disabled:opacity-50"
          style={forLeague ? { borderColor: ELITE.green, background: "rgba(57,255,20,.1)" } : { borderColor: "rgba(255,255,255,.08)", background: ELITE.card }}
        >
          <span className="text-sm font-extrabold">My league</span>
          <span className="text-[11px]" style={{ color: ELITE.faint }}>{canLeague ? `${league?.name} members` : league ? "Only the commissioner can" : "No league yet"}</span>
        </button>
        <button
          type="button"
          onClick={() => setForLeague(false)}
          aria-pressed={!forLeague}
          className="flex flex-col items-start gap-0.5 rounded-xl border-[1.5px] p-3 text-left"
          style={!forLeague ? { borderColor: ELITE.green, background: "rgba(57,255,20,.1)" } : { borderColor: "rgba(255,255,255,.08)", background: ELITE.card }}
        >
          <span className="text-sm font-extrabold">Anyone with code</span>
          <span className="text-[11px]" style={{ color: ELITE.faint }}>Invite friends outside it</span>
        </button>
      </div>
      <div className="rounded-[14px] border border-white/[0.06] bg-[#10151c] px-3">
        {rules.map((r) => (
          <div key={r.title} className="flex flex-wrap items-center gap-2 border-b border-white/[0.05] py-2.5 last:border-b-0">
            <span className="flex min-w-40 flex-1 flex-col">
              <span className="text-sm font-bold">{r.title}</span>
              <span className="text-[11px]" style={{ color: ELITE.faint }}>{r.sub}</span>
            </span>
            {r.control}
          </div>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-[11px] font-bold tracking-wide" style={{ color: ELITE.faint }}>
        PRIZE NOTE (OPTIONAL)
        <input
          value={prize}
          onChange={(e) => setPrize(e.target.value)}
          maxLength={140}
          placeholder="e.g. Last one standing picks the draft order"
          className="min-h-11 rounded-[10px] border border-white/10 bg-[#141a22] px-3 text-sm text-[#f5f4ec] placeholder:text-white/40"
        />
      </label>
      {error && <p className="text-sm" style={{ color: ELITE.orange }}>{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => void create()} disabled={saving} className="min-h-12 flex-1 rounded-[14px] text-sm font-extrabold disabled:opacity-50" style={{ background: ELITE.green, color: ELITE.deep }}>
          {saving ? "Creating…" : `Create pool · starts week ${start}`}
        </button>
        <button type="button" onClick={onCancel} className="min-h-12 rounded-[14px] border border-white/15 px-4 text-sm font-bold">
          Cancel
        </button>
      </div>
    </EliteCard>
  );
}
