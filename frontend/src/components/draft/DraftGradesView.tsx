"use client";

import { useState } from "react";
import type { DraftConfig, DraftPick } from "@/lib/draftApi";
import type { DraftGrade } from "@/lib/api";
import { DraftBoard } from "@/components/draft/DraftBoard";

/**
 * Read-only view of a completed (past or current) season's draft board
 * plus real grades and AI recaps — distinct from DraftRoom.tsx, which
 * is the live pick-clock experience. Reuses DraftBoard unchanged via
 * its optional gradesByOwner/onOpenGrade props (undefined during a
 * live draft, populated here since grades only exist once a draft is
 * complete).
 */
export function DraftGradesView({
  config,
  picks,
  grades,
  narratives,
}: {
  config: DraftConfig;
  picks: DraftPick[];
  grades: DraftGrade[];
  narratives: Record<string, string | null>;
}) {
  const [openOwnerId, setOpenOwnerId] = useState<number | null>(null);

  const teamNameByOwner = new Map<number, string>();
  for (const p of picks) teamNameByOwner.set(p.owner_id, p.owner_name);

  const gradesByOwner = new Map(grades.map((g) => [g.owner_id, g]));
  const openGrade = openOwnerId !== null ? gradesByOwner.get(openOwnerId) : null;
  const openNarrative = openOwnerId !== null ? narratives[String(openOwnerId)] : null;

  return (
    <div className="flex flex-col gap-3">
      <DraftBoard
        config={config}
        picks={picks}
        teamNameByOwner={teamNameByOwner}
        currentPickNumber={config.current_pick_number}
        gradesByOwner={gradesByOwner}
        onOpenGrade={setOpenOwnerId}
      />
      {openGrade && (
        <div className="neon-panel flex flex-col gap-2 rounded-lg bg-black/[0.015] p-4 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold">
              {teamNameByOwner.get(openGrade.owner_id)} — Grade {openGrade.letter_grade}
            </p>
            <button
              onClick={() => setOpenOwnerId(null)}
              className="text-sm text-black/50 hover:underline dark:text-white/50"
            >
              Close
            </button>
          </div>
          <p className="text-xs text-black/50 dark:text-white/50">
            {Math.round(openGrade.percentile)}th percentile · {openGrade.total_projected_points.toFixed(1)} projected
            points drafted (league avg {openGrade.league_avg_projected_points.toFixed(1)})
          </p>
          {openNarrative ? (
            <p className="text-sm">{openNarrative}</p>
          ) : (
            <p className="text-sm text-black/50 dark:text-white/50">
              No write-up generated yet for this team.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
