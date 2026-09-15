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
export function ChugCountdownCard({ deadline, isPast }: { deadline: string; isPast: boolean }) {
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
      <span className="text-xs font-semibold tracking-wide text-white/50 uppercase">Chug Countdown</span>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">🍺 Jeffrey&apos;s Rule</span>
        <span className="text-sm text-white/50">Chugs due by Monday Night Football kickoff</span>
      </div>

      {reached ? (
        // 2026-09-15 ask: "love the chug time button, make it smaller
        // and have it link to uploading your video" — /chug renders
        // ChugUpload right at the top of the page for a signed-in
        // member, so this lands directly on the upload flow.
        <Link
          href="/chug"
          className="rounded-lg bg-white/5 py-2 text-center text-sm font-bold transition-colors hover:bg-white/10 active:bg-white/15"
        >
          Chug time! 🍺 Upload your video →
        </Link>
      ) : (
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
