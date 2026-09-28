import type { ReactNode } from "react";

// Shared building blocks for the admin pages — the same card, header,
// window picker, and stat tile everywhere, so each page only has its
// own content.

export const WINDOW_OPTIONS = [7, 30, 90] as const;

export function AdminSection({
  title,
  hint,
  action,
  children,
  className = "",
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`neon-panel flex min-w-0 flex-col gap-2 rounded-xl bg-black/[0.015] p-4 dark:bg-white/[0.03] ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">{title}</h2>
        {action}
      </div>
      {hint && <p className="-mt-1 text-xs text-black/50 dark:text-white/50">{hint}</p>}
      {children}
    </section>
  );
}

export function WindowPicker({
  value,
  onChange,
  disabled,
  options = WINDOW_OPTIONS,
}: {
  value: number;
  onChange: (days: number) => void;
  disabled?: boolean;
  options?: readonly number[];
}) {
  return (
    <div className="flex shrink-0 gap-1">
      {options.map((d) => (
        <button
          key={d}
          onClick={() => onChange(d)}
          disabled={disabled}
          className={`rounded-full border px-2 py-0.5 text-xs font-medium disabled:opacity-50 ${
            value === d
              ? "border-[var(--admin-accent)] bg-[color-mix(in_srgb,var(--admin-accent)_12%,transparent)] text-[var(--admin-accent)]"
              : "border-black/10 text-black/50 dark:border-white/10 dark:text-white/50"
          }`}
        >
          {d === 1 ? "24h" : `${d}d`}
        </button>
      ))}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
  live = false,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "good" | "warn" | "bad";
  live?: boolean;
}) {
  const toneClass = {
    default: "",
    good: "text-emerald-500",
    warn: "text-amber-500",
    bad: "text-red-500",
  }[tone];
  return (
    <div className="neon-panel flex min-w-0 flex-col gap-1 rounded-xl bg-black/[0.015] p-3 dark:bg-white/[0.03]">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:text-white/50">
        {live && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />}
        {label}
      </span>
      <span className={`font-display text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</span>
      {hint && <span className="text-[11px] text-black/45 dark:text-white/45">{hint}</span>}
    </div>
  );
}

// A labeled horizontal bar, sized relative to `max`.
export function BarRow({
  label,
  value,
  max,
  right,
  color = "var(--admin-accent)",
}: {
  label: ReactNode;
  value: number;
  max: number;
  right?: ReactNode;
  color?: string;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 min-w-0 shrink-0 text-sm wrap-break-word sm:w-36">{label}</span>
      <div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="shrink-0 text-right text-xs tabular-nums text-black/50 dark:text-white/50">
        {right ?? value.toLocaleString()}
      </span>
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-black/50 dark:text-white/50">{children}</p>;
}

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "bad" | "warn" | "good" }) {
  const toneClass = {
    default: "bg-black/5 text-black/60 dark:bg-white/10 dark:text-white/60",
    bad: "bg-red-500/15 text-red-500",
    warn: "bg-amber-500/15 text-amber-500",
    good: "bg-emerald-500/15 text-emerald-500",
  }[tone];
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${toneClass}`}>
      {children}
    </span>
  );
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatDuration(seconds: number | undefined | null): string {
  if (seconds === undefined || seconds === null) return "?";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

export function pct(rate: number | null | undefined): string {
  return rate === null || rate === undefined ? "—" : `${Math.round(rate * 100)}%`;
}

export function dayLabel(isoDate: string): string {
  // A bare YYYY-MM-DD parses as UTC midnight, which shows as the
  // previous day west of UTC — pin it to local noon instead.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(isoDate) ? new Date(`${isoDate}T12:00:00`) : new Date(isoDate);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function platformLabel(platform: string | null, device?: string | null): string {
  const p = platform === "ios" ? "iOS" : platform === "android" ? "Android" : platform === "web" ? "Web" : "Unknown";
  return device ? `${p} · ${device}` : p;
}
