const COLORS = ["#39ff14", "#22d3ee", "#a855f7", "#f59e0b", "#ec4899", "#64748b"];

export type DonutSlice = { label: string; value: number };

/**
 * A plain SVG donut built from stacked stroke-dasharray arcs — no
 * charting library, same reasoning as LineChart.tsx. Slices beyond
 * COLORS.length all share the last ("Others") color, matching how a
 * long tail of small categories is usually grouped visually.
 */
export function DonutChart({ slices, centerLabel }: { slices: DonutSlice[]; centerLabel?: string }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="14" />
        {total > 0 &&
          slices.map((s, i) => {
            const fraction = s.value / total;
            const dash = fraction * circumference;
            const circle = (
              <circle
                key={s.label}
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke={COLORS[Math.min(i, COLORS.length - 1)]}
                strokeWidth="14"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return circle;
          })}
      </svg>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {centerLabel && <span className="text-xs text-black/50 dark:text-white/50">{centerLabel}</span>}
        {slices.length === 0 ? (
          <p className="text-sm text-black/50 dark:text-white/50">No data yet.</p>
        ) : (
          slices.map((s, i) => (
            <div key={s.label} className="flex items-center gap-1.5 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: COLORS[Math.min(i, COLORS.length - 1)] }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{s.label}</span>
              <span className="shrink-0 tabular-nums text-black/50 dark:text-white/50">
                {total > 0 ? `${Math.round((s.value / total) * 100)}%` : "0%"}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
