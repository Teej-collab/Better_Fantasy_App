"use client";

import { useState } from "react";
import type { DraftConfig, DraftPick } from "@/lib/draftApi";
import type { DraftGrade } from "@/lib/api";
import { DraftBoard } from "@/components/draft/DraftBoard";
import { DraftGradesLeaderboard } from "@/components/draft/DraftGradesLeaderboard";

/**
 * Read-only view of a completed (past or current) season's draft
 * grades/recaps plus the full board — distinct from DraftRoom.tsx,
 * which is the live pick-clock experience. Leads with a real,
 * impossible-to-miss leaderboard (2026-09 fix: the original version of
 * this page led with the dense pick-by-pick board and only exposed
 * grades via a small letter badge in a column header — reported as
 * "I don't see it at all anywhere" by the one person who needed to find
 * it). The full board (with the same small per-column badges, now a
 * secondary/bonus affordance) still follows below for anyone who wants
 * to see every individual pick.
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

  return (
    <div className="flex flex-col gap-6">
      <DraftGradesLeaderboard
        grades={grades}
        narratives={narratives}
        teamNameByOwner={teamNameByOwner}
        openOwnerId={openOwnerId}
        onToggle={(ownerId) => setOpenOwnerId(openOwnerId === ownerId ? null : ownerId)}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
          Full Draft Board
        </h2>
        <DraftBoard
          config={config}
          picks={picks}
          teamNameByOwner={teamNameByOwner}
          currentPickNumber={config.current_pick_number}
          gradesByOwner={gradesByOwner}
          onOpenGrade={setOpenOwnerId}
        />
      </section>
    </div>
  );
}
