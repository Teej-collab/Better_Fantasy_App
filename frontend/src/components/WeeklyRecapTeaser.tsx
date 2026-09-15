"use client";

import { useState } from "react";
import type { WeeklyNarrative } from "@/lib/api";

// A short teaser for the week that just wrapped's whole-week recap
// (app/domain/narrative_engine.py's WEEKLY_RECAP_PROMPT), right under
// This Week's Awards — the owner's own call on where it belongs, once
// there's actually one to show (null until the scheduler's week-
// settlement job has auto-generated it; see getWeeklyRecap's own
// comment in app/(home)/page.tsx).
//
// 2026-09-15 change, real ask: this used to truncate and link out to
// the week's own page for the rest — that page (the old /seasons/
// [season]/weeks/[week] route) is gone now, and the ask was for the
// full text to expand right here instead of navigating anywhere. A
// plain client-side toggle — no route, no fetch, the full text is
// already in `recap` — replaces the truncate-and-link-out behavior.
const RECAP_TEASER_MAX_CHARS = 220;

export function WeeklyRecapTeaser({ recap, week }: { recap: WeeklyNarrative; week: number }) {
  const [expanded, setExpanded] = useState(false);
  const flat = recap.text.replace(/\s+/g, " ").trim();
  const truncatable = flat.length > RECAP_TEASER_MAX_CHARS;
  const snippet = truncatable ? flat.slice(0, RECAP_TEASER_MAX_CHARS).replace(/\s+\S*$/, "") : flat;

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className="flex flex-col gap-1 rounded-lg border border-black/10 bg-black/[0.015] p-3 text-left shadow-sm transition-transform active:scale-[0.98] dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none"
    >
      <span className="text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        Week {week} Recap
      </span>
      <span className="text-sm whitespace-pre-line text-black/70 dark:text-white/70">
        {expanded ? flat : snippet}
        {!expanded && truncatable && "… "}
      </span>
      {truncatable && (
        <span className="text-sm font-medium text-black dark:text-white">
          {expanded ? "Show less ↑" : "Read the full recap ↓"}
        </span>
      )}
    </button>
  );
}
