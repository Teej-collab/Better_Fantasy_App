"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { generateWeeklyRecap, type WeeklyNarrative } from "@/lib/api";

// Renders the whole-week narrative (app/domain/narrative_engine.py's
// WEEKLY_RECAP_PROMPT/WEEKLY_PREVIEW_PROMPT output) at the top of a
// week's page, plus — commissioner-only — the button that bulk-fills
// it and every real matchup's own narrative below in one request. See
// that module's docstrings for why this has to be a deliberate click
// rather than automatic on page load.
export function WeekRecapSection({
  season,
  week,
  narrative,
  canGenerate,
}: {
  season: number;
  week: number;
  narrative: WeeklyNarrative | null;
  canGenerate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!narrative && !canGenerate) return null;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      const result = await generateWeeklyRecap(season, week);
      // Re-fetches this whole-week narrative AND every matchup's own
      // narrative (MatchupCard already renders matchup.narrative) in
      // one server round-trip, rather than prop-drilling the
      // generate-endpoint's result into two different components. Do
      // this even when nothing new was generated below — matchup
      // narratives can still have been filled from cache.
      router.refresh();
      if (result.status === "not_eligible") {
        setError("This week isn't over yet — the recap unlocks once the NFL rolls over to next week.");
      } else if (result.status === "not_configured") {
        setError("The AI recap feature isn't set up yet (missing API key).");
      } else if (result.status === "no_matchups") {
        setError("Nothing scheduled this week — there's no recap to generate.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the recap");
    } finally {
      setBusy(false);
    }
  }

  const heading = narrative ? `Week ${week} ${narrative.kind === "preview" ? "Preview" : "Recap"}` : `Week ${week} Story`;

  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{heading}</h2>
        {canGenerate && (
          <button
            onClick={generate}
            disabled={busy}
            className="shrink-0 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Generating…" : narrative ? "Regenerate" : "Generate This Week's Recap"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {narrative ? (
        <p className="whitespace-pre-line text-sm leading-relaxed">{narrative.text}</p>
      ) : (
        <p className="text-xs text-black/50 dark:text-white/50">Nothing generated yet for this week.</p>
      )}
    </section>
  );
}
