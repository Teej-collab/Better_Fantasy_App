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

  // Scrolls the page's own vertical scroll (not this carousel's
  // horizontal one) so #matchup-top — the BackButton/heading just above
  // this component, see page.tsx — sits right below the sticky site
  // header, instead of the page starting above the site-wide ticker.
  // Measures the header's real rendered height rather than a hardcoded
  // pixel guess (it's hidden entirely on the beta mobile layout, where
  // this correctly resolves to 0).
  const scrollAnchorIntoView = useCallback((behavior: ScrollBehavior) => {
    const anchor = document.getElementById("matchup-top");
    if (!anchor) return;
    const headerHeight = document.getElementById("site-nav")?.getBoundingClientRect().height ?? 0;
    const anchorTop = anchor.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, anchorTop - headerHeight), behavior });
  }, []);

  useEffect(() => {
    // Jump (no animation) to whichever matchup the user actually
    // clicked into, and past the site ticker down to the matchup
    // content itself — everything after this (swiping, tapping another
    // pill) animates instead, via the activeIndex effect below.
    scrollToIndex(initialIndex, "auto");
    scrollAnchorIntoView("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every SUBSEQUENT matchup switch (tap or swipe) resets the vertical
  // scroll back to the same anchor — the real ESPN reference does this
  // too (swiping to another game always lands back at the top of its
  // score header, never wherever you'd scrolled down to on the last
  // one). Skips its very first run since the mount effect above already
  // placed it, instantly, before this would otherwise animate it again.
  const skippedFirstRun = useRef(false);
  useEffect(() => {
    if (!skippedFirstRun.current) {
      skippedFirstRun.current = true;
      return;
    }
    scrollAnchorIntoView("smooth");
  }, [activeIndex, scrollAnchorIntoView]);

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
        // touch-pan-x (2026-09 fix, real report: swiping between
        // matchups visibly "dropped" the page down slightly mid-swipe):
        // the browser's default touch-action ("auto") tries to guess
        // horizontal-swipe-this vs. vertical-scroll-the-page from the
        // gesture's initial movement, and that guess isn't clean — a
        // mostly-horizontal drag still let a little vertical scroll
        // bleed through. pan-x tells it up front that THIS element only
        // ever claims horizontal drags; a vertical drag starting on it
        // is handed straight to the page's own vertical scroll, never
        // partially both. overscroll-x-contain separately stops a
        // swipe that hits either edge from chaining into the browser's
        // own edge-swipe navigation.
        className="-mx-4 flex touch-pan-x snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
