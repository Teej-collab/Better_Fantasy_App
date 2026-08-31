// Sleeper-style two-segment bar — home's own share of the estimate in
// the app's accent color, away's share in a plain neutral fill (not a
// second brand color; see app/domain/win_probability.py for how the
// estimate itself is computed). Only ever rendered once both sides
// have a real, non-null win_probability — the caller is responsible
// for that gate (a matchup that hasn't started yet has no meaningful
// 50/50 worth showing, same call the homepage's "Your Week" hero
// already makes).
export function WinProbabilityBar({ homeWinProbability, awayWinProbability }: { homeWinProbability: number; awayWinProbability: number }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs font-medium">
        <span style={{ color: "var(--user-accent, var(--wl-accent))" }}>{homeWinProbability}% win</span>
        <span className="text-black/50 dark:text-white/50">{awayWinProbability}% win</span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
        <div
          className="h-full"
          style={{ width: `${homeWinProbability}%`, backgroundColor: "var(--user-accent, var(--wl-accent))" }}
        />
      </div>
    </div>
  );
}
