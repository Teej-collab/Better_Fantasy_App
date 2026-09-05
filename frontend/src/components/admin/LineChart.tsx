"use client";

import { useId, useState } from "react";

export type LineSeries = { label: string; color: string; values: number[] };

/**
 * A plain, dependency-free SVG line chart — no charting library, same
 * "don't add a dependency for something this small" reasoning as every
 * other hand-built visual in this app (LiveTicker, the countdown
 * tiles). Renders 1+ series over a shared set of x-axis labels, with a
 * hover tooltip showing every series' value at that x position.
 */
export function LineChart({
  labels,
  series,
  height = 160,
}: {
  labels: string[];
  series: LineSeries[];
  height?: number;
}) {
  const gradientId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const width = 600;
  const padding = 8;
  const maxValue = Math.max(1, ...series.flatMap((s) => s.values));
  const n = labels.length;
  const stepX = n > 1 ? (width - padding * 2) / (n - 1) : 0;

  function xFor(i: number) {
    return padding + i * stepX;
  }
  function yFor(v: number) {
    return height - padding - (v / maxValue) * (height - padding * 2);
  }

  function pointsFor(values: number[]) {
    return values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
  }

  function handleMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relativeX = ((e.clientX - rect.left) / rect.width) * width;
    const index = Math.round((relativeX - padding) / (stepX || 1));
    setHoverIndex(Math.max(0, Math.min(n - 1, index)));
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-40 w-full"
        preserveAspectRatio="none"
        onPointerMove={handleMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.label} id={`${gradientId}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>
        {series.map((s, i) => (
          <g key={s.label}>
            <polygon
              points={`${padding},${height - padding} ${pointsFor(s.values)} ${xFor(n - 1)},${height - padding}`}
              fill={`url(#${gradientId}-${i})`}
              stroke="none"
            />
            <polyline points={pointsFor(s.values)} fill="none" stroke={s.color} strokeWidth={2} />
          </g>
        ))}
        {hoverIndex !== null && (
          <line x1={xFor(hoverIndex)} y1={padding} x2={xFor(hoverIndex)} y2={height - padding} stroke="currentColor" strokeOpacity="0.15" />
        )}
        {hoverIndex !== null &&
          series.map((s) => (
            <circle key={s.label} cx={xFor(hoverIndex)} cy={yFor(s.values[hoverIndex] ?? 0)} r={3} fill={s.color} />
          ))}
      </svg>
      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute top-0 flex flex-col gap-0.5 rounded-lg border border-black/10 bg-[var(--background)] px-2 py-1 text-[11px] shadow-lg dark:border-white/10"
          style={{
            left: `${(xFor(hoverIndex) / width) * 100}%`,
            transform: `translateX(${hoverIndex > n / 2 ? "-100%" : "0"})`,
          }}
        >
          <span className="font-medium text-black/70 dark:text-white/70">{labels[hoverIndex]}</span>
          {series.map((s) => (
            <span key={s.label} className="flex items-center gap-1 tabular-nums">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
              {s.label}: {s.values[hoverIndex] ?? 0}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
