"use client";

import { useState } from "react";
import { trackTap } from "@/lib/analyticsEvents";
import { DESTINATIONS } from "@/lib/navDestinations";
import { panelGlowStyle } from "@/lib/sectionColors";
import { ELITE, EliteCard, SATISFY } from "@/components/elite/Elite";

// A matchup's write-ups (2026-10-22), right under the score card:
// `narrative` is the current one (the preview before kickoff, the recap
// once the week is final, none mid-game) and `preview` is the pre-game
// one, kept for good. Each is a slim card like Home's "Missed the
// recap?" that opens in place, and opening one is counted (Admin > Taps).
// Same as the app's mobile/src/components/matchup/WriteUps.tsx.

const PREVIEW = DESTINATIONS.matchups.color;
const RECAP = DESTINATIONS.awards.color;

export function MatchupWriteUps({
  narrative,
  preview,
  week,
  elite = false,
}: {
  narrative: string | null;
  preview: string | null | undefined;
  week: number;
  // The matchup page's elite look (2026-10-31): a script title on a
  // glass card. Home's matchup card keeps the neon panel.
  elite?: boolean;
}) {
  const previewIsCurrent = !!narrative && narrative === preview;
  const pregame = preview ?? (previewIsCurrent ? narrative : null);
  const recap = narrative && !previewIsCurrent ? narrative : null;
  return (
    <>
      {pregame && (
        <WriteUpCard
          color={PREVIEW}
          kicker="🎙️ Pre-game write-up"
          sub={previewIsCurrent ? "The hype before kickoff" : "How it looked before kickoff"}
          text={pregame}
          target="matchup.pregame_open"
          elite={elite ? "The Preview" : undefined}
        />
      )}
      {recap && (
        <WriteUpCard
          color={RECAP}
          kicker={`📰 Week ${week} recap`}
          sub="How it went down"
          text={recap}
          target="matchup.recap_open"
          elite={elite ? `The Week ${week} Recap` : undefined}
        />
      )}
    </>
  );
}

function WriteUpCard({ color, kicker, sub, text, target, elite }: { color: string; kicker: string; sub: string; text: string; target: string; elite?: string }) {
  const [open, setOpen] = useState(false);
  if (elite) {
    return (
      <EliteCard className="flex flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            <h2 className={`${SATISFY} text-2xl leading-tight`} style={{ color: ELITE.peach }}>
              {elite}
            </h2>
            <span className="truncate text-xs" style={{ color: ELITE.soft }}>
              {sub}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!open) trackTap(target);
              setOpen((v) => !v);
            }}
            aria-expanded={open}
            className="min-h-9 shrink-0 rounded-full border border-[rgba(57,255,20,.45)] bg-[rgba(57,255,20,.08)] px-3 text-sm font-bold text-[#39ff14]"
          >
            {open ? "Hide ↑" : "Read it →"}
          </button>
        </div>
        {open && <p className="text-[15px] leading-relaxed whitespace-pre-line text-[#f5f4ec]/85">{text.trim()}</p>}
      </EliteCard>
    );
  }
  return (
    <section className="neon-panel flex flex-col gap-2 rounded-xl px-4 py-3" style={panelGlowStyle(color)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h2 className="text-xs font-bold tracking-wide uppercase" style={{ color }}>
            {kicker}
          </h2>
          <span className="truncate text-sm text-black/60 dark:text-white/60">{sub}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            if (!open) trackTap(target);
            setOpen((v) => !v);
          }}
          aria-expanded={open}
          className="shrink-0 rounded-full px-3 py-1 text-sm font-semibold text-black dark:text-white"
          style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}
        >
          {open ? "Hide ↑" : "Read it →"}
        </button>
      </div>
      {open && <p className="text-[15px] leading-relaxed whitespace-pre-line text-black/80 dark:text-white/80">{text.trim()}</p>}
    </section>
  );
}
