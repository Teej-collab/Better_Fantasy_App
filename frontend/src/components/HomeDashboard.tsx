"use client";

import type { ReactNode } from "react";
import { useIsDesktop } from "@/lib/useIsDesktop";
import { HomeCardDeck } from "@/components/HomeCardDeck";
import { HomeGridDesktop } from "@/components/HomeGridDesktop";
import type { HomeGridLayoutItem } from "@/lib/api";

/**
 * Picks which interactive shell wraps the home dashboard's cards —
 * HomeCardDeck's reorder-only vertical list on mobile, HomeGridDesktop's
 * resizable grid on desktop — since (home)/page.tsx is a Server
 * Component and can't call the breakpoint hook itself. Both shells get
 * exactly the same server-built `cards` map; only the interactive
 * container differs. `dashboardKey` forces both shells to remount
 * (instead of trying to reconcile stale internal state against new
 * props) whenever the visible card set changes — see HomeCardDeck.tsx's
 * own comment for why that matters after "Add Box" triggers a refresh.
 */
export function HomeDashboard({
  dashboardKey,
  initialOrder,
  cards,
  hiddenCards,
  cardLabels,
  savedDesktopLayout,
}: {
  dashboardKey: string;
  initialOrder: string[];
  cards: Record<string, ReactNode>;
  hiddenCards: string[];
  cardLabels: Record<string, string>;
  savedDesktopLayout: HomeGridLayoutItem[] | null;
}) {
  const isDesktop = useIsDesktop();

  if (isDesktop) {
    return (
      <HomeGridDesktop
        key={dashboardKey}
        cards={cards}
        hiddenCards={hiddenCards}
        cardLabels={cardLabels}
        savedLayout={savedDesktopLayout}
      />
    );
  }

  return (
    <HomeCardDeck
      key={dashboardKey}
      initialOrder={initialOrder}
      cards={cards}
      hiddenCards={hiddenCards}
      cardLabels={cardLabels}
    />
  );
}
