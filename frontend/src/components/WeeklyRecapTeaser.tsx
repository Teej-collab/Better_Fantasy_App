"use client";

import { useState } from "react";
import type { WeeklyNarrative } from "@/lib/api";
import { DESTINATIONS } from "@/lib/navDestinations";
import { panelGlowStyle } from "@/lib/sectionColors";

// A teaser for the week that just wrapped's whole-week recap
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
//
// 2026-09-15 follow-up, real ask ("make it feel like a centerpiece,
// we WANT users to click on this... format into paragraphs"): two real
// bugs in the first version — it read as just another small tile
// (same size/weight as the Awards grid above it) instead of the one
// thing on the page worth stopping for, and it flattened the LLM's own
// three-to-five-paragraph write-up (WEEKLY_RECAP_PROMPT explicitly
// asks for real paragraph breaks) into one run-on line before
// rendering it, throwing away that structure. Fixed by giving this its
// own bigger, section-colored treatment (same panelGlowStyle every
// other content card on this app already uses, borrowing Awards' own
// hue since this lives right under that section) and, once expanded,
// rendering `recap.text` untouched — its real blank-line paragraph
// breaks survive through `whitespace-pre-line`, the exact technique
// WeekRecapSection.tsx already uses for this same text elsewhere. Only
// the collapsed PREVIEW snippet still flattens whitespace, since a
// one-line teaser has nowhere to put a paragraph break anyway.
const RECAP_TEASER_MAX_CHARS = 220;

export function WeeklyRecapTeaser({ recap, week }: { recap: WeeklyNarrative; week: number }) {
  const [expanded, setExpanded] = useState(false);
  const fullText = recap.text.trim();
  const flatPreview = fullText.replace(/\s+/g, " ");
  const truncatable = flatPreview.length > RECAP_TEASER_MAX_CHARS;
  const snippet = truncatable ? flatPreview.slice(0, RECAP_TEASER_MAX_CHARS).replace(/\s+\S*$/, "") : flatPreview;

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      className="neon-panel flex flex-col gap-2 rounded-xl border border-black/10 bg-gradient-to-br from-black/[0.03] to-transparent p-4 text-left shadow-sm transition-transform active:scale-[0.99] dark:border-white/10 dark:from-white/[0.06] dark:shadow-none"
      style={panelGlowStyle(DESTINATIONS.awards.color)}
    >
      <span
        className="flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase"
        style={{ color: DESTINATIONS.awards.color }}
      >
        📰 Week {week} Recap
      </span>

      {expanded ? (
        <p className="text-base leading-relaxed whitespace-pre-line text-black/80 dark:text-white/80">{fullText}</p>
      ) : (
        <p className="text-base leading-relaxed text-black/80 dark:text-white/80">
          {snippet}
          {truncatable && "…"}
        </p>
      )}

      <span
        className="mt-1 inline-flex w-fit items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold text-black dark:text-white"
        style={{ backgroundColor: `color-mix(in srgb, ${DESTINATIONS.awards.color} 18%, transparent)` }}
      >
        {expanded ? "Show less ↑" : "Read the full recap →"}
      </span>
    </button>
  );
}
