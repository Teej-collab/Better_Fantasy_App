// Pieces shared by the Commissioner Tools pages (2026-10-23 overhaul),
// server or client.

/** A section title with a colored line under it. */
export function GroupTitle({ title, color, right }: { title: string; color: string; right?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b-2 pb-1.5" style={{ borderBottomColor: color }}>
      <h2 className="font-display text-lg font-semibold tracking-wide uppercase">{title}</h2>
      {right && (
        <span className="text-xs font-bold" style={{ color }}>
          {right}
        </span>
      )}
    </div>
  );
}

export const panelClass = "rounded-2xl border border-black/10 bg-black/[0.02] dark:border-white/10 dark:bg-white/[0.03]";
export const inputClass =
  "min-h-11 rounded-lg border border-black/15 bg-white px-3 text-[15px] dark:border-white/15 dark:bg-white/[0.04] dark:text-white";
export const buttonClass = "min-h-11 rounded-xl px-5 text-[15px] font-extrabold text-black disabled:opacity-50";
