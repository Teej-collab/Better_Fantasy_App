"use client";

import { useState } from "react";
import Link from "next/link";
import { getChugVideoUrl, type ChugFeedEntry } from "@/lib/api";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

// One chug's row: collapsed to a single compact line by default (owner,
// week, grade) — tapping it expands a capped-height video player below,
// and tapping again collapses it back down. Keeps a whole feed of
// videos from turning into an ever-growing stack of large open players;
// only one row's worth of video space is ever "spent" per open row, and
// the presigned URL is fetched once (cached in state) rather than
// re-fetched every time a row is reopened.
function ChugCard({ chug }: { chug: ChugFeedEntry }) {
  const [open, setOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    if (!chug.has_video) return;
    const next = !open;
    setOpen(next);
    if (next && !videoUrl && status !== "loading") {
      setStatus("loading");
      try {
        const { url } = await getChugVideoUrl(chug.id);
        setVideoUrl(url);
        setStatus("idle");
      } catch {
        setStatus("error");
      }
    }
  }

  return (
    <li className="text-sm">
      <div
        onClick={toggle}
        role={chug.has_video ? "button" : undefined}
        tabIndex={chug.has_video ? 0 : undefined}
        onKeyDown={(e) => {
          if (chug.has_video && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggle();
          }
        }}
        className={`flex items-center justify-between gap-3 px-4 py-3 ${
          chug.has_video ? "cursor-pointer hover:bg-black/5 dark:hover:bg-white/5" : ""
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {chug.has_video && (
            <span
              className={`shrink-0 text-black/40 transition-transform dark:text-white/40 ${open ? "rotate-90" : ""}`}
              aria-hidden
            >
              ▶
            </span>
          )}
          <Link
            href={`/owners/${chug.owner_id}`}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 wrap-break-word font-medium hover:underline"
          >
            {chug.owner_name}
          </Link>
          {chug.week !== null && <span className="text-xs text-black/50 dark:text-white/50">Wk {chug.week}</span>}
          {!chug.has_video && <span className="text-xs text-black/30 dark:text-white/30">no video</span>}
        </span>
        <span className="shrink-0 tabular-nums text-black/70 dark:text-white/70">{chug.final_score}/10</span>
      </div>
      {chug.roast && (
        <p className="-mt-1.5 px-4 pb-3 text-[13px] leading-snug text-black/60 dark:text-white/60">{chug.roast}</p>
      )}

      {open && (
        <div className="px-4 pb-3">
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              playsInline
              autoPlay
              className="max-h-80 w-full rounded-lg bg-black"
            />
          ) : status === "error" ? (
            <span className="text-xs text-red-500">Couldn&apos;t load the video — try again.</span>
          ) : (
            <span className="text-xs text-black/50 dark:text-white/50">Loading…</span>
          )}
        </div>
      )}
    </li>
  );
}

// The newest few show; the rest wait behind "Show more" (2026-10 — the
// list kept growing down the home page).
const SHOWN = 4;

export function ChugFeed({ chugs }: { chugs: ChugFeedEntry[] }) {
  const [all, setAll] = useState(false);
  if (chugs.length === 0) return null;
  const shown = all ? chugs : chugs.slice(0, SHOWN);

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Recent Chugs</h2>
      <ol
        className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] dark:divide-white/5 dark:bg-white/[0.03]"
        style={panelGlowStyle(SECTION_COLORS.chug)}
      >
        {shown.map((chug) => (
          <ChugCard key={chug.id} chug={chug} />
        ))}
      </ol>
      {chugs.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          aria-expanded={all}
          className="flex min-h-11 items-center justify-center gap-1.5 self-center rounded-full border border-black/10 px-4 text-sm font-medium text-black/60 hover:bg-black/5 dark:border-white/10 dark:text-white/60 dark:hover:bg-white/10"
        >
          {all ? "Show fewer" : `Show ${chugs.length - SHOWN} more`}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={all ? "rotate-180" : ""}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}
