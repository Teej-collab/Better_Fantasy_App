"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GroupTitle, panelClass } from "@/components/commissioner/CommishBits";
import { cancelLeagueSwitch, getLeagueSwitch, requestLeagueSwitch, type LeagueSwitchStatus } from "@/lib/leaguesApi";
import { NAV_ACCENT } from "@/lib/navDestinations";

// Moving the league to The Weekend for good (2026-10-24, backend
// app/domain/league_switch.py): the hub's card and the full page. Same as
// the app's SwitchCard (commissioner/index.tsx) and commissioner/switch.tsx.

const BLUE = "#38bdf8";
const YELLOW = "#ca8a04";
const ORANGE = "#f97316";

export function SwitchCard() {
  const [s, setS] = useState<LeagueSwitchStatus | null>(null);
  useEffect(() => {
    getLeagueSwitch()
      .then(setS)
      .catch(() => setS(null));
  }, []);
  if (!s?.mirrored) return null;
  const allIn = s.claimed >= s.teams && s.teams > 0;
  const color = allIn ? NAV_ACCENT : BLUE;
  return (
    <section className={`${panelClass} flex flex-col gap-2 p-4`} style={{ borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}>
      <span className="text-xs font-extrabold tracking-widest uppercase" style={{ color }}>
        {allIn ? "Everyone's here" : `Running on ${s.platform_name}`}
      </span>
      <span className="font-semibold">
        {s.pending
          ? `Moving to The Weekend in Week ${s.pending.effective_week}`
          : allIn
            ? `${s.claimed} of ${s.teams} teams are here. Loving The Weekend? Move your league over.`
            : `${s.claimed} of ${s.teams} teams are here. Once everyone is, move the league over for good.`}
      </span>
      <Link href="/commissioner/switch" className="self-start rounded-full px-4 py-2 text-sm font-bold" style={{ backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)` }}>
        {allIn ? "Move us over" : "See what moving does"}
      </Link>
    </section>
  );
}

export function LeagueSwitchPage() {
  const [s, setS] = useState<LeagueSwitchStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    getLeagueSwitch()
      .then(setS)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load this."));
  }, []);

  if (error && !s) return <p className="text-sm text-red-500">{error}</p>;
  if (!s) return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;
  if (!s.mirrored) {
    return (
      <div className="flex flex-col gap-2">
        <h2 className="font-display text-2xl font-semibold uppercase">You&apos;re on The Weekend</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          {s.switched_from ? `Moved over from ${s.switched_from === "espn" ? "ESPN" : "Sleeper"}. ` : ""}Every roster move happens here now.
        </p>
        {done && <p className="text-sm text-emerald-500">{done}</p>}
      </div>
    );
  }

  const allIn = s.claimed >= s.teams && s.teams > 0;
  const waiting = s.teams - s.claimed;

  async function go() {
    if (!s) return;
    const warning = allIn ? "" : `${waiting} team${waiting === 1 ? "" : "s"} haven't joined yet. They can still claim their team after.\n\n`;
    if (
      !window.confirm(
        `${warning}From then on, lineups, adds, drops, waivers and trades happen here, and moves on ${s.platform_name} stop counting. This can't be undone. Move the league over?`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const r = await requestLeagueSwitch();
      setS(r.status);
      setDone(
        r.switched
          ? "You're on The Weekend. Roster moves are unlocked and everyone has been told."
          : `This week's games have started, so the move happens when Week ${r.effective_week} begins.`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await cancelLeagueSwitch();
      setS(await getLeagueSwitch());
      setDone(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h2 className="font-display text-2xl font-semibold uppercase">{allIn ? "Loving The Weekend?" : "Move to The Weekend"}</h2>
        <p className="text-sm text-black/60 dark:text-white/60">
          Right now your league runs on {s.platform_name}: rosters copy over from there and moves are locked here.
        </p>
      </div>

      <section className={`${panelClass} flex flex-col gap-2 p-4`} style={{ borderColor: `color-mix(in srgb, ${allIn ? NAV_ACCENT : YELLOW} 50%, transparent)` }}>
        <span className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold">
            {s.claimed} of {s.teams}
          </span>
          <span className="text-sm text-black/60 dark:text-white/60">teams are here</span>
        </span>
        <span className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
          <span className="block h-2" style={{ width: `${Math.max(4, (s.claimed / Math.max(1, s.teams)) * 100)}%`, backgroundColor: allIn ? NAV_ACCENT : YELLOW }} />
        </span>
        {s.unclaimed.length > 0 && <span className="text-sm text-black/60 dark:text-white/60">Still waiting on: {s.unclaimed.join(", ")}</span>}
      </section>

      <section className="flex flex-col gap-2">
        <GroupTitle title="What moving over does" color={BLUE} />
        <ul className="flex flex-col gap-1.5 text-sm">
          <li>• One last sync from {s.platform_name}: every result, roster and lineup.</li>
          <li>• Your scoring rules, roster spots, playoffs and waivers (FAAB budgets included) come with it.</li>
          <li>• The rest of the schedule stays the same.</li>
          <li>• Lineups, adds, drops, waivers and trades unlock here, and everyone gets a notification.</li>
          <li>• Never mid-week: once this week&apos;s games have started, it happens when the next week begins.</li>
          <li>• Tell your league to stop making moves on {s.platform_name} after this.</li>
        </ul>
      </section>

      {s.notes.length > 0 && (
        <section className="flex flex-col gap-2">
          <GroupTitle title="Close, but not exact" color={ORANGE} />
          <ul className="flex flex-col gap-1.5 text-sm">
            {s.notes.map((n, i) => (
              <li key={i}>• {n}</li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
      {done && <p className="text-sm text-emerald-500">{done}</p>}
      {s.pending ? (
        <div className="flex flex-col gap-2">
          <p className="font-bold" style={{ color: YELLOW }}>
            Set to move over at the start of Week {s.pending.effective_week}.
          </p>
          <button type="button" disabled={busy} onClick={cancel} className="min-h-12 self-start rounded-xl border border-black/15 px-5 font-bold disabled:opacity-50 dark:border-white/15">
            Cancel the move
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={go}
          className="min-h-12 self-start rounded-xl px-6 font-extrabold text-black disabled:opacity-50"
          style={{ backgroundColor: NAV_ACCENT }}
        >
          {busy ? "Moving…" : allIn ? "We're all in: move us over" : "Move us over anyway"}
        </button>
      )}
    </div>
  );
}
