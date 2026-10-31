"use client";

import { useState, type ReactNode } from "react";
import { SEG_OFF, SEG_ON, SEG_WRAP } from "@/components/elite/Elite";

const TABS = ["Scoreboard", "Standings", "Playoffs"] as const;
type Tab = (typeof TABS)[number];

// Real ESPN League tab's own segmented control (reference video,
// 2026-09-15) — plain client-side show/hide, not URL-driven, since
// which of these three someone's looking at isn't something worth a
// real navigation or a bookmarkable state. All three panels' data is
// already fetched server-side up front (each is cheap — this league's
// own already-computed standings/current week's matchups/bracket), so
// switching tabs is instant with no loading state of its own.
export function StandingsViewTabs({
  standings,
  scoreboard,
  playoffs,
  initialTab = "Standings",
}: {
  standings: ReactNode;
  scoreboard: ReactNode;
  playoffs: ReactNode | null;
  /** Standings unless a link asked for another (?view=playoffs). */
  initialTab?: Tab;
}) {
  const [active, setActive] = useState<Tab>(initialTab);
  const tabs = playoffs !== null ? TABS : TABS.filter((t) => t !== "Playoffs");

  return (
    <div className="flex flex-col gap-4">
      <div className={SEG_WRAP} role="tablist">
        {tabs.map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={active === tab} onClick={() => setActive(tab)} className={active === tab ? SEG_ON : SEG_OFF}>
            {tab}
          </button>
        ))}
      </div>

      {active === "Standings" && standings}
      {active === "Scoreboard" && scoreboard}
      {active === "Playoffs" && playoffs}
    </div>
  );
}
