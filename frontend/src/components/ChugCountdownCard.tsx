"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Remaining = { days: number; hours: number; minutes: number; seconds: number };

function computeRemaining(targetMs: number): Remaining | null {
  const diff = targetMs - Date.now();
  if (diff <= 0) return null;
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * Takes over the Draft Countdown's homepage slot once the draft is
 * done (see app/(home)/page.tsx) — Jeffrey's Rule says chugs are due
 * by this week's real Monday Night Football kickoff
 * (backend/app/domain/chug_deadline.py computes the actual deadline
 * from ESPN's own schedule, not a guessed fixed time), so this stays
 * relevant every single week of the season rather than being a one-time
 * pre-draft card. Same hydration-safe pattern as DraftCountdownCard:
 * the countdown only fills in inside a client-only effect, since the
 * server and browser clocks/timezones can otherwise mismatch on the
 * first render.
 */
export function ChugCountdownCard({
  deadline,
  isPast,
  mine,
}: {
  deadline: string;
  isPast: boolean;
  // Your own balance (backend /chug/deadline's "mine"), so you can see at
  // a glance how many you owe without opening the Chug page.
  mine?: { outstanding_owed: number; fined_owed: number; fine_amount: number } | null;
}) {
  const targetMs = new Date(deadline).getTime();
  const [remaining, setRemaining] = useState<Remaining | null>(null);
  const [reached, setReached] = useState(isPast);

  useEffect(() => {
    function tick() {
      const next = computeRemaining(targetMs);
      setRemaining(next);
      setReached(next === null);
    }
    const kickoff = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [targetMs]);

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl bg-gradient-to-br from-neutral-900 via-black to-black p-4 text-white">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wide text-white/50 uppercase">Chug Countdown</span>
        {/* 2026-09-15 ask: "the Chug Time button should be in the top
            right of the chug countdown" — always here now, not only
            once the deadline actually passes (a real chug can be
            posted any time, "for funsies" even with nothing owed —
            see record_completed_chug's own docstring), just relabeled
            once it's genuinely chug time. /chug renders ChugUpload
            right at the top of the page for a signed-in member, so
            this lands directly on the upload flow either way. */}
        <Link
          href="/chug"
          className="shrink-0 rounded-full bg-amber-400 px-3 py-1 text-xs font-bold text-black transition-colors hover:bg-amber-300 active:bg-amber-500"
        >
          {reached ? "Chug Time! 🍺" : "Upload 🍺"}
        </Link>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">🍺 Jeffrey&apos;s Rule</span>
        <span className="text-sm text-white/50">Chugs due by Monday Night Football kickoff</span>
      </div>

      {mine && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold ${
              mine.outstanding_owed > 0 ? "bg-amber-400/15 text-amber-300" : "bg-emerald-500/15 text-emerald-400"
            }`}
          >
            {mine.outstanding_owed > 0
              ? `You owe ${mine.outstanding_owed} chug${mine.outstanding_owed === 1 ? "" : "s"}`
              : "You're all square 🍻"}
          </span>
          {mine.fined_owed > 0 && (
            <span className="rounded-full bg-red-500/15 px-3 py-1 text-sm font-bold text-red-400">
              ${mine.fine_amount} fine
            </span>
          )}
        </div>
      )}

      {!reached && (
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ["Days", remaining ? pad(remaining.days) : "--"],
              ["Hours", remaining ? pad(remaining.hours) : "--"],
              ["Minutes", remaining ? pad(remaining.minutes) : "--"],
              ["Seconds", remaining ? pad(remaining.seconds) : "--"],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="countdown-tile flex flex-col items-center gap-0.5 rounded-lg bg-white/5 py-3">
              <span className="text-2xl font-bold tabular-nums">{value}</span>
              <span className="text-xs text-white/50">{label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
