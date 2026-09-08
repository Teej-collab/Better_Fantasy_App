"use client";

import type { DraftGrade } from "@/lib/api";

const GRADE_COLOR: Record<string, string> = {
  A: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  B: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  C: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  D: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  F: "bg-red-500/15 text-red-600 dark:text-red-400",
};

/**
 * The real, impossible-to-miss home for draft grades — 2026-09 fix: the
 * original version of this feature only exposed grades via a small
 * letter badge inside the dense draft board's column headers, reported
 * as "I don't see it at all anywhere" by the one person who needed to
 * find it. Shared by the live /draft page (DraftRoom.tsx, shown once
 * the draft is complete) and the season-archive page
 * (DraftGradesView.tsx), so both surfaces look and behave identically.
 */
export function DraftGradesLeaderboard({
  grades,
  narratives,
  teamNameByOwner,
  openOwnerId,
  onToggle,
}: {
  grades: DraftGrade[];
  narratives: Record<string, string | null> | undefined;
  teamNameByOwner: Map<number, string>;
  openOwnerId: number | null;
  onToggle: (ownerId: number) => void;
}) {
  const sortedGrades = [...grades].sort((a, b) => b.percentile - a.percentile);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        Draft Grades
      </h2>
      <ul className="neon-panel flex flex-col divide-y divide-black/5 rounded-lg bg-black/[0.015] px-4 dark:divide-white/5 dark:bg-white/[0.03]">
        {sortedGrades.map((g) => {
          const isOpen = openOwnerId === g.owner_id;
          const narrative = narratives?.[String(g.owner_id)];
          return (
            <li key={g.owner_id} className="py-3">
              <button onClick={() => onToggle(g.owner_id)} className="flex w-full items-center gap-3 text-left">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ${GRADE_COLOR[g.letter_grade] ?? "bg-black/10 dark:bg-white/10"}`}
                >
                  {g.letter_grade}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {teamNameByOwner.get(g.owner_id) ?? g.owner_name}
                  </span>
                  <span className="block text-xs text-black/50 dark:text-white/50">
                    {Math.round(g.percentile)}th percentile · {g.total_projected_points.toFixed(1)} pts drafted
                  </span>
                </span>
                <span className="shrink-0 text-xs text-black/40 dark:text-white/40">
                  {isOpen ? "Hide recap ▲" : "Read recap ▼"}
                </span>
              </button>
              {isOpen && (
                <div className="mt-3 rounded-lg bg-black/[0.03] p-3 text-sm dark:bg-white/[0.05]">
                  {narrative ?? (
                    <span className="text-black/50 dark:text-white/50">No write-up generated yet for this team.</span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
