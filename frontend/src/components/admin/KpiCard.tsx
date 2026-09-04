import type { CSSProperties } from "react";

export function KpiCard({ label, value, live = false }: { label: string; value: number; live?: boolean }) {
  return (
    <div
      className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-3 dark:bg-white/[0.03]"
      style={{ "--ring-color": "var(--admin-accent)" } as CSSProperties}
    >
      <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        {live && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />}
        {label}
      </span>
      <span className="font-display text-2xl font-semibold tabular-nums">{value.toLocaleString()}</span>
    </div>
  );
}
