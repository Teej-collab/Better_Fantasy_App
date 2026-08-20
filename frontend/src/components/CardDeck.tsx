"use client";

import { useEffect, useRef } from "react";
import { TeamProfileCard } from "@/components/TeamProfileCard";
import type { CareerProfile, Owner, OwnerBadges } from "@/lib/api";

type CardData = { owner: Owner; career: CareerProfile; badges: OwnerBadges };

/**
 * Infinite-loop horizontal card deck. The cards render twice back to
 * back ([...cards, ...cards]) so there's always more content to scroll
 * into in either direction; a scroll listener silently jumps the
 * scroll position back by exactly one full set width whenever it nears
 * either edge. Since both copies are pixel-identical, the jump is
 * invisible — the deck just appears to loop forever. Free/continuous
 * scrolling (no scroll-snap) per the ask, not the previous
 * stops-on-each-card version.
 */
export function CardDeck({ cards }: { cards: CardData[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const setWidthRef = useRef(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || cards.length === 0) return;

    const setWidth = el.scrollWidth / 2;
    setWidthRef.current = setWidth;
    // Start at the boundary between the two copies, so there's a full
    // set width of scroll room in both directions before a wrap is needed.
    el.scrollLeft = setWidth;

    const onScroll = () => {
      const node = scrollRef.current;
      if (!node) return;
      const sw = setWidthRef.current;
      if (node.scrollLeft <= 0) {
        node.scrollLeft += sw;
      } else if (node.scrollLeft >= sw * 2 - node.clientWidth) {
        node.scrollLeft -= sw;
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [cards.length]);

  return (
    <div
      ref={scrollRef}
      // overscroll-x-contain stops the swipe gesture from "leaking"
      // into the page itself once the inner scroller hits a bound —
      // without it, mobile browsers can chain the gesture into
      // scrolling the whole page or triggering edge-swipe navigation,
      // which is what made the header/tabs appear to slide too.
      className="-mx-4 flex touch-pan-x gap-4 overflow-x-auto overscroll-x-contain px-4 pb-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
    >
      {[...cards, ...cards].map(({ owner, career, badges }, i) => (
        // Percentage width, not vw — vw can exceed the true visual
        // viewport on mobile browsers (address bar/scrollbar quirks),
        // which was the other contributor to the whole page scrolling.
        <div key={`${owner.owner_id}-${i}`} className="w-[90%] shrink-0 sm:w-[420px]">
          <TeamProfileCard owner={owner} initialCareer={career} initialBadges={badges} />
        </div>
      ))}
    </div>
  );
}
