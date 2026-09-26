// ESPN-style split bar (2026-09-25 redesign, reference: real ESPN
// matchup screen) — each side gets its own track, filled toward the
// center from its own outer edge, with its percentage on the outside.
// The left side's bar fills from the left, the right side's from the
// right, so the two read as mirror images. Only ever rendered once both
// sides have a real, non-null win_probability — the caller is
// responsible for that gate (a matchup that hasn't started yet has no
// meaningful 50/50 worth showing, see app/domain/win_probability.py).
export function WinProbabilityBar({
  leftWinProbability,
  rightWinProbability,
  label,
  tone = "default",
}: {
  leftWinProbability: number;
  rightWinProbability: number;
  // Centered between the two tracks (the matchup screen's "Win
  // Probability"); omitted, the tracks just meet in the middle.
  label?: string;
  // "dark" for surfaces that are always dark (the Your Week card),
  // regardless of the site theme.
  tone?: "default" | "dark";
}) {
  const track = tone === "dark" ? "bg-white/10" : "bg-black/10 dark:bg-white/10";
  const labelColor = tone === "dark" ? "text-white/80" : "text-black/70 dark:text-white/80";
  const fill = { backgroundColor: "var(--wl-accent)" };

  return (
    <div className="flex items-center gap-2 text-sm tabular-nums">
      <span className="w-10 shrink-0">{Math.round(leftWinProbability)}%</span>
      <div className={`h-2 flex-1 overflow-hidden rounded-full ${track}`}>
        <div className="h-full rounded-full" style={{ ...fill, width: `${leftWinProbability}%` }} />
      </div>
      {label && <span className={`shrink-0 px-1 ${labelColor}`}>{label}</span>}
      {!label && <span className="w-2 shrink-0" />}
      <div className={`flex h-2 flex-1 justify-end overflow-hidden rounded-full ${track}`}>
        <div className="h-full rounded-full" style={{ ...fill, width: `${rightWinProbability}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right">{Math.round(rightWinProbability)}%</span>
    </div>
  );
}
