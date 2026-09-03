"use client";

// A real switch (role="switch", not a styled checkbox pretending to
// be one) — state is conveyed by thumb position as well as color, so
// it still reads correctly without relying on color alone.
//
// The track carries .glass-surface (globals.css) — a frosted-glass
// look (backdrop blur, inset top highlight) inspired by Apple's
// "Liquid Glass" material, using plain CSS backdrop-filter rather than
// an SVG-refraction library: reliable on every browser this app
// targets (including mobile Safari, where a true refraction effect
// degrades or disappears). It doesn't touch the checked/unchecked
// background logic below at all — .glass-surface deliberately sets no
// background-color or border of its own, so this component keeps full
// control of both.
export function ToggleRow({
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="flex min-w-0 flex-col">
        <span className={`text-sm ${disabled ? "text-black/50 dark:text-white/50" : ""}`}>{label}</span>
        {description && (
          <span className="text-xs text-black/50 dark:text-white/50">{description}</span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`glass-surface relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wl-accent)] disabled:cursor-not-allowed disabled:opacity-40 ${
          checked
            ? "border-[var(--wl-accent)]/60 bg-[var(--wl-accent)]"
            : "border-black/10 bg-black/20 dark:border-white/15 dark:bg-white/25"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}
