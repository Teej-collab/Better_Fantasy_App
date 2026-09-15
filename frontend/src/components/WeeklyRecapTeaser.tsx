"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { generateWeeklyRecap, type WeeklyNarrative } from "@/lib/api";
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
//
// 2026-09-15 second follow-up, real report: deleting the old week-list
// route (WeekRecapSection.tsx's own "Regenerate" button lived there)
// left NO way at all to fix a bad already-cached recap — like the
// truncated one that surfaced the WEEKLY_MAX_TOKENS bug in the first
// place — once one existed, since this component only ever rendered
// read-only. A small commissioner-only Regenerate control here closes
// that gap, using the real `force` flag (see generateWeeklyRecap /
// backend generate_weekly_recap's own docstrings) so it actually
// re-generates instead of just re-showing the same cached text.
const RECAP_TEASER_MAX_CHARS = 220;

export function WeeklyRecapTeaser({
  recap,
  season,
  week,
  isCommissioner,
}: {
  recap: WeeklyNarrative;
  season: number;
  week: number;
  isCommissioner: boolean;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fullText = recap.text.trim();
  const flatPreview = fullText.replace(/\s+/g, " ");
  const truncatable = flatPreview.length > RECAP_TEASER_MAX_CHARS;
  const snippet = truncatable ? flatPreview.slice(0, RECAP_TEASER_MAX_CHARS).replace(/\s+\S*$/, "") : flatPreview;

  async function handleRegenerate() {
    setRegenerating(true);
    setError(null);
    try {
      await generateWeeklyRecap(season, week, true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't regenerate the recap");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <div
      className="neon-panel flex flex-col gap-2 rounded-xl border border-black/10 bg-gradient-to-br from-black/[0.03] to-transparent p-4 dark:border-white/10 dark:from-white/[0.06]"
      style={panelGlowStyle(DESTINATIONS.awards.color)}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase"
          style={{ color: DESTINATIONS.awards.color }}
        >
          📰 Week {week} Recap
        </span>
        {isCommissioner && (
          <button
            type="button"
            onClick={handleRegenerate}
            disabled={regenerating}
            className="shrink-0 rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium text-black/60 transition-colors hover:bg-black/5 disabled:opacity-50 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
          >
            {regenerating ? "Regenerating…" : "Regenerate"}
          </button>
        )}
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex flex-col gap-2 text-left transition-transform active:scale-[0.99]"
      >
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
    </div>
  );
}
