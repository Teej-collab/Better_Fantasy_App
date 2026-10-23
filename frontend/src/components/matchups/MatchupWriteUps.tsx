"use client";

import { useState } from "react";
import { DESTINATIONS } from "@/lib/navDestinations";
import { panelGlowStyle } from "@/lib/sectionColors";

// A matchup's write-ups (2026-10-22): `narrative` is the current one
// (the preview before kickoff, the recap once the week is final, none
// mid-game) and `preview` is the pre-game one, kept for good. Before
// kickoff the preview shows in full; after, it folds into a slim
// "Pre-game write-up" card like Home's "Missed the recap?". Same as the
// app's mobile/src/components/matchup/WriteUps.tsx.

const PREVIEW = DESTINATIONS.matchups.color;
const RECAP = DESTINATIONS.awards.color;

export function MatchupWriteUps({
  narrative,
  preview,
  week,
}: {
  narrative: string | null;
  preview: string | null | undefined;
  week: number;
}) {
  const previewIsCurrent = !!narrative && narrative === preview;
  const color = previewIsCurrent ? PREVIEW : RECAP;
  return (
    <>
      {narrative && (
        <section className="neon-panel flex flex-col gap-2 rounded-xl px-4 py-3" style={panelGlowStyle(color)}>
          <h2 className="text-xs font-bold tracking-wide uppercase" style={{ color }}>
            {previewIsCurrent ? "🎙️ Pre-game write-up" : `📰 Week ${week} recap`}
          </h2>
          <p className="text-[15px] leading-relaxed whitespace-pre-line text-black/80 dark:text-white/80">{narrative.trim()}</p>
        </section>
      )}
      {preview && !previewIsCurrent && <PreGameCard text={preview} />}
    </>
  );
}

function PreGameCard({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="neon-panel flex flex-col gap-2 rounded-xl px-4 py-3" style={panelGlowStyle(PREVIEW)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-xs font-bold tracking-wide uppercase" style={{ color: PREVIEW }}>
            🎙️ Pre-game write-up
          </h2>
          <span className="truncate text-sm text-black/60 dark:text-white/60">How it looked before kickoff</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="shrink-0 rounded-full px-3 py-1 text-sm font-semibold text-black dark:text-white"
          style={{ backgroundColor: `color-mix(in srgb, ${PREVIEW} 18%, transparent)` }}
        >
          {open ? "Hide ↑" : "Read it →"}
        </button>
      </div>
      {open && <p className="text-[15px] leading-relaxed whitespace-pre-line text-black/80 dark:text-white/80">{text.trim()}</p>}
    </section>
  );
}
