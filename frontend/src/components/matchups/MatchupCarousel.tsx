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

  const scrollToIndex = useCallback((index: number, behavior: ScrollBehavior = "smooth") => {
    const panel = panelRefs.current[index];
    if (!panel) return;
    programmaticRef.current = true;
    panel.scrollIntoView({ behavior, inline: "start", block: "nearest" });
    setActiveIndex(index);
    window.setTimeout(() => {
      programmaticRef.current = false;
    }, 500);
  }, []);

  useEffect(() => {
    // Jump (no animation) to whichever matchup the user actually
    // clicked into from the week page — everything after this
    // (swiping, tapping another pill) animates.
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
        // overscroll-x-contain stops a swipe that hits either edge from
        // chaining into the browser's own edge-swipe navigation.
        // Deliberately no touch-action override (unlike CardDeck.tsx's
        // touch-pan-x): each panel here is tall, real, vertically-
        // scrolling page content, not a fixed-height card, so the
        // browser's own default gesture disambiguation (drag direction
        // decides horizontal-swipe-this vs. vertical-scroll-the-page)
        // has to stay intact.
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
