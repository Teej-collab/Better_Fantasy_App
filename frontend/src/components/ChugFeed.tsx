"use client";

import { useState } from "react";
import Link from "next/link";
import { getChugVideoUrl, type ChugFeedEntry } from "@/lib/api";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

// One chug's card: a play button that only fetches (and only pays the
// presigned-URL round-trip for) the actual video once someone opens
// it, rather than pre-loading a URL per card for a whole feed most
// viewers will just scroll past.
function ChugCard({ chug }: { chug: ChugFeedEntry }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function play() {
    setStatus("loading");
    try {
      const { url } = await getChugVideoUrl(chug.id);
      setVideoUrl(url);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <Link href={`/owners/${chug.owner_id}`} className="truncate font-medium hover:underline">
            {chug.owner_name}
          </Link>
          {chug.week !== null && <span className="text-xs text-black/50 dark:text-white/50">Wk {chug.week}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-black/70 dark:text-white/70">{chug.final_score}/10</span>
      </div>

      {chug.has_video ? (
        videoUrl ? (
          <video src={videoUrl} controls playsInline className="w-full rounded-lg bg-black" />
        ) : (
          <button
            onClick={play}
            disabled={status === "loading"}
            className="w-fit rounded-full bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {status === "loading" ? "Loading…" : "▶ Watch"}
          </button>
        )
      ) : (
        <span className="text-xs text-black/40 dark:text-white/40">No video for this one.</span>
      )}
      {status === "error" && <span className="text-xs text-red-500">Couldn&apos;t load the video — try again.</span>}
    </li>
  );
}

export function ChugFeed({ chugs }: { chugs: ChugFeedEntry[] }) {
  if (chugs.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Recent Chugs</h2>
      <ol
        className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
        style={panelGlowStyle(SECTION_COLORS.chug)}
      >
        {chugs.map((chug) => (
          <ChugCard key={chug.id} chug={chug} />
        ))}
      </ol>
    </div>
  );
}
