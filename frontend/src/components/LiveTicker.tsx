"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { TickerItem } from "@/lib/api";

// How long to wait after the visitor stops interacting before the
// auto-scroll picks back up. animation-play-state: paused/running
// preserves the animation's own timeline natively, so resuming just
// continues from wherever it was at the same speed — no jump, no
// restart.
const RESUME_AFTER_IDLE_MS = 2000;

/**
 * Auto-scrolling ticker strip, at its base a CSS-only marquee
 * (globals.css's .live-ticker-track) — but a real client component
 * now, not the plain server-renderable version this used to be: a
 * visitor can drag/scroll it to find a specific game, which pauses
 * the animation for real interaction (touch drag, pointer down, a
 * manual scroll — none of which fire the desktop-only :hover rule
 * that already paused it for mouse users) and lets it resume on its
 * own once they stop. Items render twice back to back so the loop is
 * seamless (same technique as CardDeck's infinite scroll, just
 * CSS-driven instead of scroll-position-driven since this one
 * auto-plays).
 *
 * Each item is a run of segments (lib/api.ts's TickerItem) rather than
 * a plain string — a team-name segment carries that team's own color
 * (see buildNflTickerItems), everything else renders in the ticker's
 * default white. A plain-text item is just one uncolored segment.
 * Colored segments get a thin white outline + soft glow (.ticker-team)
 * so a team's own dark color (several teams' real primary is a deep
 * navy/purple/brown) still pops against the ticker's black background
 * instead of nearly disappearing into it — the team's color stays the
 * fill, the white is purely an outline around it.
 */
export function LiveTicker({ items, fast = false, bare = false }: { items: TickerItem[]; fast?: boolean; bare?: boolean }) {
  const [paused, setPaused] = useState(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pauseThenScheduleResume() {
    setPaused(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setPaused(false), RESUME_AFTER_IDLE_MS);
  }

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div
      className={
        bare
          ? "min-w-0 flex-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          : `ticker-shell overflow-x-auto overflow-y-hidden rounded-lg border border-black/10 bg-black [scrollbar-width:none] dark:border-white/10 [&::-webkit-scrollbar]:hidden ${
              fast ? "ticker-shell--live" : ""
            }`
      }
      onPointerDown={pauseThenScheduleResume}
      onTouchStart={pauseThenScheduleResume}
      onScroll={pauseThenScheduleResume}
    >
      <div
        className={`live-ticker-track py-1.5 ${fast ? "live-ticker-track--fast" : ""} ${
          paused ? "live-ticker-track--paused" : ""
        }`}
      >
        {[...items, ...items].map((item, i) => {
          const content = item.segments.map((seg, j) =>
            seg.color ? (
              <span key={j} className="ticker-team" style={{ color: seg.color }}>
                {seg.text}
              </span>
            ) : (
              <span key={j}>{seg.text}</span>
            )
          );
          return item.href ? (
            <Link
              key={`${item.key}-${i}`}
              href={item.href}
              className={`shrink-0 whitespace-nowrap text-white/90 hover:text-white ${bare ? "mx-4 text-[12.5px]" : "mx-6 text-[13px]"}`}
            >
              {content}
            </Link>
          ) : (
            <span
              key={`${item.key}-${i}`}
              className={`shrink-0 whitespace-nowrap text-white/90 ${bare ? "mx-4 text-[12.5px]" : "mx-6 text-[13px]"}`}
            >
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The Lounge's look, everywhere (2026-10): slim strips labelled NFL and
 * LEAGUE, one above the other — each still the full LiveTicker
 * underneath, so it auto-scrolls, can be dragged to find a game, and
 * its items stay tappable.
 */
export function TickerStrip({
  label,
  labelColor,
  items,
  fast = false,
  tint,
}: {
  label: string;
  labelColor: string;
  items: TickerItem[];
  fast?: boolean;
  tint: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex min-h-[34px] items-center gap-3 border-t border-white/[0.06] pl-3.5 first:border-t-0" style={{ background: tint }}>
      <span className="font-display shrink-0 text-[11px] font-bold tracking-[1.4px]" style={{ color: labelColor }}>
        {label}
      </span>
      <LiveTicker items={items} fast={fast} bare />
    </div>
  );
}

/** NFL above, this week's league games below, in one dark box. */
export function TickerStrips({
  nfl,
  league,
  fast = false,
  leagueFast = fast,
}: {
  nfl: TickerItem[];
  league: TickerItem[] | null;
  fast?: boolean;
  leagueFast?: boolean;
}) {
  if (nfl.length === 0 && !league?.length) return null;
  return (
    <div className={`overflow-hidden rounded-xl border bg-[#0d1016] ${fast ? "border-red-500/50" : "border-white/10"}`}>
      <TickerStrip label="NFL" labelColor="#9aa3b2" items={nfl} fast={fast} tint="rgba(255,255,255,0.03)" />
      {league && league.length > 0 && (
        <TickerStrip label="LEAGUE" labelColor="var(--user-accent, var(--wl-accent))" items={league} fast={leagueFast} tint="rgba(57,255,20,0.04)" />
      )}
    </div>
  );
}

