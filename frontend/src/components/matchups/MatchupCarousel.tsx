"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WeekMatchupContextItem } from "@/lib/api";
import { MatchupSwitcher } from "@/components/matchups/MatchupSwitcher";
import { MatchupDetailPanel } from "@/components/matchups/MatchupDetailPanel";

/**
 * ESPN-style instant matchup swiper (reference: real ESPN matchup
 * screen, 2026-09 — tapping/swiping the top matchup strip swaps the
 * whole page below with no reload). Every matchup in the week already
 * comes back in one request (getWeekMatchupContext — the exact call
 * the week page itself makes, full rosters included), so switching is
 * a pure client-side scroll between already-rendered panels, never a
 * new page load or fetch.
 *
 * activeIndex is the single source of truth shared by the top
 * MatchupSwitcher strip and the horizontal snap-scroll panel track
 * below: tapping a pill scrolls the track to that panel, and swiping
 * the track directly updates which pill reads as active.
 */
export function MatchupCarousel({
  matchups,
  initialMatchupId,
}: {
  matchups: WeekMatchupContextItem[];
  initialMatchupId: number;
}) {
  const initialIndex = Math.max(
    0,
    matchups.findIndex((m) => m.matchup_id === initialMatchupId)
  );
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const scrollRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef<number | null>(null);
  // Set right before a programmatic (pill-tap) scroll so the scroll
  // listener below doesn't fight it with its own in-flight index guess
  // — cleared once that scroll has had time to settle.
  const programmaticRef = useRef(false);

  // Scrolls the container's own horizontal axis directly (container.
  // scrollTo({left}), not panel.scrollIntoView) — scrollIntoView's
  // block:"nearest" can still nudge the PAGE's vertical scroll too when
  // the target panel isn't already vertically in view (which, for a
  // panel this tall, it usually isn't on first load), fighting the
  // dedicated vertical anchor scroll below. Setting the container's own
  // scroll position touches only this element's horizontal axis, full
  // stop.
  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    const container = scrollRef.current;
    const panel = panelRefs.current[index];
    if (!container || !panel) return;
    programmaticRef.current = true;
    container.scrollTo({ left: panel.offsetLeft, behavior });
    setActiveIndex(index);
    window.setTimeout(() => {
      programmaticRef.current = false;
    }, 500);
  }, []);

  // 2026-09-15 revert: this used to also force the PAGE's own vertical
  // scroll down past the site ticker on mount, and back to that same
  // spot on every matchup switch (real report: this fought the page's
  // own layout while it was still settling — team logos/webfonts
  // loading, the ticker's own content arriving — producing a visible
  // overshoot-then-correct jump instead of a clean load, and a real,
  // explicit ask to just load "like normal pages... seeing the tickers
  // and everything"). Gone entirely now: this component only ever
  // touches the carousel's own horizontal scroll (scrollToIndex above,
  // container.scrollTo({left}) — never window.scrollTo), so the page
  // loads and swipes without moving the user's vertical scroll at all.
  useEffect(() => {
    // Jump (no animation) to whichever matchup the user actually
    // clicked into — everything after this (swiping, tapping another
    // pill) animates instead.
    scrollToIndex(initialIndex, "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      if (programmaticRef.current) return;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const width = el.clientWidth;
        if (width === 0) return;
        const index = Math.round(el.scrollLeft / width);
        setActiveIndex((prev) => (prev === index ? prev : index));
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Keeps the URL pointing at whichever matchup is actually on screen
  // (shareable/bookmarkable, and the back button lands on the right
  // place) without ever going through Next's router — a real route
  // change there would remount this page and refetch server-side,
  // defeating the entire point of an instant, already-loaded swipe.
  useEffect(() => {
    const id = matchups[activeIndex]?.matchup_id;
    if (id === undefined) return;
    const url = `/matchups/${id}`;
    if (window.location.pathname !== url) {
      window.history.replaceState(null, "", url);
    }
  }, [activeIndex, matchups]);

  return (
    <div className="flex flex-col gap-4">
      <MatchupSwitcher matchups={matchups} activeIndex={activeIndex} onSelect={(i) => scrollToIndex(i)} />
      <div
        ref={scrollRef}
        // 2026-09-15 revert: touch-pan-x was meant to stop a little
        // vertical bleed during a horizontal swipe (see git history),
        // but in real use it blocked vertical scrolling on this element
        // ENTIRELY on mobile — this panel is effectively the whole page
        // (score header, lineups, bench), so that made the whole page
        // unscrollable, a far worse regression than the cosmetic jank
        // it was fixing. Back to the browser's default gesture
        // disambiguation. overscroll-x-contain alone (harmless, x-axis
        // only) still stops a swipe that hits either edge from chaining
        // into the browser's own edge-swipe navigation.
        className="-mx-4 flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {matchups.map((m, i) => (
          <div
            key={m.matchup_id}
            ref={(node) => {
              panelRefs.current[i] = node;
            }}
            className="w-full shrink-0 snap-start px-4"
          >
            <MatchupDetailPanel matchup={m} />
          </div>
        ))}
      </div>
    </div>
  );
}
