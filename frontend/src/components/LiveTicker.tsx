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
export function LiveTicker({ items, fast = false }: { items: TickerItem[]; fast?: boolean }) {
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
      className={`ticker-shell overflow-x-auto overflow-y-hidden rounded-lg border border-black/10 bg-black [scrollbar-width:none] dark:border-white/10 [&::-webkit-scrollbar]:hidden ${
        fast ? "ticker-shell--live" : ""
      }`}
      onPointerDown={pauseThenScheduleResume}
      onTouchStart={pauseThenScheduleResume}
      onScroll={pauseThenScheduleResume}
    >
      <div
        className={`live-ticker-track py-2.5 ${fast ? "live-ticker-track--fast" : ""} ${
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
              className="mx-5 shrink-0 text-sm whitespace-nowrap text-white/90 hover:text-white"
            >
              {content}
            </Link>
          ) : (
            <span key={`${item.key}-${i}`} className="mx-5 shrink-0 text-sm whitespace-nowrap text-white/90">
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}
