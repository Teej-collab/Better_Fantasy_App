import type { Metadata } from "next";
import { CommishPage } from "@/components/commissioner/CommishPage";
import { ForceEditRosterSection } from "@/components/commissioner/ForceEditRosterSection";

export const metadata: Metadata = { title: "Fix a Lineup — The Weekend" };

// Fix a lineup (2026-10-23 overhaul, mockup 6): was Roster & Keepers'
// "Force-Edit a Roster". ?team= opens one team (from Members).
export default async function CommissionerLineupPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const { team } = await searchParams;
  const teamId = team ? Number(team) : undefined;
  return (
    <CommishPage title="Fix a lineup" subtitle="Moves here work even after kickoff.">
      <ForceEditRosterSection initialTeamId={Number.isFinite(teamId) ? teamId : undefined} />
    </CommishPage>
  );
}
