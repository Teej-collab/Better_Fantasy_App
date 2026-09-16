// "QUESTIONABLE" -> "Q" — the reference layout (real ESPN matchup
// screen, 2026-09) shows a single-letter flag right next to the name
// instead of a separate pill on its own line, which is a big part of
// why it reads as spacious instead of cluttered at the same
// information density. Falls back to the first letter for a status
// this map doesn't know about, rather than silently dropping it.
//
// Extracted from StarterComparisonTable.tsx (Matchup screen, the
// first place this pattern shipped) so every other player row can
// reuse the exact same map instead of re-implementing it — see that
// component's own history for why the single-letter-badge design won
// out over a full-width pill in the first place.
const INJURY_SHORT_CODE: Record<string, string> = {
  QUESTIONABLE: "Q",
  DOUBTFUL: "D",
  OUT: "O",
  IR: "IR",
  PUP: "PUP",
  SUSPENDED: "S",
};

export function injuryShortCode(status: string): string {
  return INJURY_SHORT_CODE[status] ?? status.slice(0, 1);
}

// ACTIVE (and no status at all) means "healthy, don't show a badge" —
// same sentinel every existing injury-pill call site already checks.
export function hasInjuryBadge(status: string | null | undefined): status is string {
  return Boolean(status) && status !== "ACTIVE";
}
