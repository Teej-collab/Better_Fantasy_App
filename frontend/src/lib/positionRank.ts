import type { PositionRank } from "@/lib/api";

// "17th"/"3rd"/"22nd" — standard English ordinal suffix rules (11-13
// are always "th" regardless of their last digit, the one common
// off-by-one mistake this guards against).
export function formatOrdinal(rank: number): string {
  const remainder100 = rank % 100;
  if (remainder100 >= 11 && remainder100 <= 13) return `${rank}th`;
  switch (rank % 10) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

// rank 1 = fewest fantasy points allowed to this position = toughest
// matchup (red); rank 32 = most allowed = easiest/favorable (green) —
// confirmed against real live ESPN data, not assumed (see the backend
// migration this feature shipped with). Simple thirds, not a per-rank
// gradient, per the product decision locked in when this was planned.
export function rankColorVar(rank: number): string {
  if (rank <= 10) return "var(--wl-live)";
  if (rank <= 22) return "var(--wl-text-secondary)";
  return "var(--wl-success)";
}

// "17th vs QB" — appended to the existing opponent/time line rather
// than a new line of its own (the product decision this shipped
// with). null in, null out: every call site already guards its own
// next_opponent line the same way.
export function formatPositionRank(rank: PositionRank, position: string): string | null {
  if (!rank) return null;
  return `${formatOrdinal(rank.rank)} vs ${position}`;
}
