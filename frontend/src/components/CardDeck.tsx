"use client";

import { useCallback, useEffect, useRef } from "react";
import { TeamProfileCard } from "@/components/TeamProfileCard";
import type { CareerProfile, Owner, OwnerBadges } from "@/lib/api";

type CardData = { owner: Owner; career: CareerProfile; badges: OwnerBadges };

// Coverflow tuning — how far a card leans/recedes/dims/shrinks per unit
// of index distance from the centered (focused) card, in the spirit of
// the Apple Cover Flow-style reference the project owner shared. All
// three clamp at |d| >= 1 — the very next card over is already at full
// tilt/depth, cards further out don't keep receding forever.
const MAX_ROTATION_DEG = 42;
const MAX_DEPTH_PX = 180;
const MIN_SCALE = 0.8;
const MIN_OPACITY = 0.55;

/**
 * Infinite-loop horizontal card deck, now with a Cover Flow-style 3D
 * lean: as you scroll/swipe, whichever card sits centered in the
 * viewport renders flat and full-size, while every other card rotates
 * on its Y axis, recedes in Z, shrinks, and dims in proportion to how
 * far its index sits from that center — continuously, in lockstep with
 * the actual scroll position (no separate drag/tween state to keep in
 * sync with the browser's own native touch scrolling underneath it).
 *
 * Deliberately reads/writes each card's transform imperatively via
 * refs (cardRefs) inside a scroll-driven, rAF-throttled loop rather
 * than through React state — `scroll` fires far too often for a state
 * update + re-render per event to keep up with a finger dragging the
 * deck.
 *
 * The cards still render twice back to back ([...cards, ...cards]) for
 * the same seamless-loop trick as before: a scroll listener silently
 * jumps scrollLeft back by one full set width near either edge, which
 * is invisible since both copies are pixel-identical — the coverflow
 * math above just keeps running through that jump unaffected, since it
 * only ever looks at the *current* scrollLeft, never a remembered one.
 */
export function CardDeck({ cards }: { cards: CardData[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const setWidthRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  const applyCoverflow = useCallback(() => {
    const el = scrollRef.current;
    const first = cardRefs.current[0];
    const second = cardRefs.current[1];
    if (!el || !first || !second) return;

    const step = second.offsetLeft - first.offsetLeft;
    if (step <= 0) return;
    const cardWidth = first.offsetWidth;
    // Fractional index of whichever card is currently centered in the
    // viewport — not necessarily a whole number while mid-scroll.
    const p = (el.scrollLeft + el.clientWidth / 2 - cardWidth / 2) / step;

    cardRefs.current.forEach((card, i) => {
      if (!card) return;
      const d = i - p;
      const clamped = Math.max(-1, Math.min(1, d));
      const ad = Math.abs(clamped);
      const rotation = -clamped * MAX_ROTATION_DEG;
      const depth = -ad * MAX_DEPTH_PX;
      const scale = 1 - ad * (1 - MIN_SCALE);
      const opacity = 1 - ad * (1 - MIN_OPACITY);
      card.style.transform = `translateZ(${depth}px) rotateY(${rotation}deg) scale(${scale})`;
      card.style.opacity = String(opacity);
      card.style.zIndex = String(1000 - Math.round(ad * 100));
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || cards.length === 0) return;

    const setWidth = el.scrollWidth / 2;
    setWidthRef.current = setWidth;
    // Start at the boundary between the two copies, so there's a full
    // set width of scroll room in both directions before a wrap is needed.
    el.scrollLeft = setWidth;
    applyCoverflow();

    const onScroll = () => {
      const node = scrollRef.current;
      if (!node) return;
      const sw = setWidthRef.current;
      if (node.scrollLeft <= 0) {
        node.scrollLeft += sw;
      } else if (node.scrollLeft >= sw * 2 - node.clientWidth) {
        node.scrollLeft -= sw;
      }
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        applyCoverflow();
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", applyCoverflow);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", applyCoverflow);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [cards.length, applyCoverflow]);

  return (
    <div
      ref={scrollRef}
      // overscroll-x-contain stops the swipe gesture from "leaking"
      // into the page itself once the inner scroller hits a bound —
      // without it, mobile browsers can chain the gesture into
      // scrolling the whole page or triggering edge-swipe navigation,
      // which is what made the header/tabs appear to slide too.
      // `perspective` is what gives every card's individual rotateY/
      // translateZ below an actual vanishing point to lean into.
      className="-mx-4 flex touch-pan-x gap-4 overflow-x-auto overscroll-x-contain px-4 pb-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden"
      style={{ perspective: "1600px" }}
    >
      {[...cards, ...cards].map(({ owner, career, badges }, i) => (
        // Percentage width, not vw — vw can exceed the true visual
        // viewport on mobile browsers (address bar/scrollbar quirks),
        // which was the other contributor to the whole page scrolling.
        <div
          key={`${owner.owner_id}-${i}`}
          ref={(node) => {
            cardRefs.current[i] = node;
          }}
          className="w-[90%] shrink-0 sm:w-[420px]"
          style={{ willChange: "transform, opacity" }}
        >
          <TeamProfileCard owner={owner} initialCareer={career} initialBadges={badges} />
        </div>
      ))}
    </div>
  );
}
