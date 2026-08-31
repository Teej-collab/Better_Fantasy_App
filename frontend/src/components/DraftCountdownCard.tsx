"use client";

import { useEffect, useState } from "react";

// "2026-09-05T20:00:00+00:00" -> "Sat, Sep 5 · 3:00 PM" — real ISO8601
// with a real offset from the backend, formatted in the visitor's own
// local time zone (toLocaleDateString/toLocaleTimeString with no
// explicit locale/timeZone use the runtime's own default) — same
// convention already used for game times elsewhere (see MyTeamApp.tsx's
// formatGameTime).
function formatScheduledStart(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

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
 * Replaces the homepage's "No matchup yet" empty state once a real
 * draft date is set (see app/(home)/page.tsx) — the pre-draft/pre-
 * season moment is real and current right now, not a hypothetical
 * edge case, so it's worth more than a bland placeholder. Reference:
 * a Sleeper app screenshot the project owner shared, adapted to this
 * app's own neon-panel card language rather than cloned pixel-for-
 * pixel (same treatment the roster-row redesign already got).
 *
 * Both the countdown and the formatted date/time start out as "not
 * computed yet" and only fill in inside useEffect (client-only) —
 * this is a client component, but Next still server-renders it once
 * for the initial HTML using the server's own clock/timezone, which
 * would otherwise mismatch the browser's on hydration (a different
 * Date.now() reading, and toLocaleString defaults to the runtime's own
 * timezone, which differs between server and visitor). Deferring both
 * to a client-only effect avoids that mismatch entirely rather than
 * fighting it.
 */
export function DraftCountdownCard({ teamName, scheduledStart }: { teamName: string; scheduledStart: string }) {
  const targetMs = new Date(scheduledStart).getTime();
  const [remaining, setRemaining] = useState<Remaining | null>(null);
  const [reached, setReached] = useState(false);
  const [formattedDate, setFormattedDate] = useState<string | null>(null);

  useEffect(() => {
    function tick() {
      setFormattedDate(formatScheduledStart(scheduledStart));
      const next = computeRemaining(targetMs);
      setRemaining(next);
      setReached(next === null);
    }
    // The very first tick has to run before the 1s interval's first
    // callback fires, or the card would sit on its placeholder "--"
    // for a full second after every mount. setTimeout(0) still counts
    // as a callback to the lint rule below (unlike calling tick()
    // directly in the effect body), while running effectively
    // immediately.
    const kickoff = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(id);
    };
  }, [targetMs, scheduledStart]);

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl bg-gradient-to-br from-neutral-900 via-black to-black p-4 text-white">
      <span className="text-xs font-semibold tracking-wide text-white/50 uppercase">Draft Countdown</span>
      <div className="flex flex-col gap-0.5">
        <span className="font-medium">{teamName}</span>
        <span className="text-sm text-white/50">Snake Draft{formattedDate ? ` · ${formattedDate}` : ""}</span>
      </div>

      {reached ? (
        <div className="rounded-lg bg-white/5 py-3 text-center text-lg font-bold">Draft time! 🏈</div>
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
            <div key={label} className="flex flex-col items-center gap-0.5 rounded-lg bg-white/5 py-3">
              <span className="text-2xl font-bold tabular-nums">{value}</span>
              <span className="text-xs text-white/50">{label}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
