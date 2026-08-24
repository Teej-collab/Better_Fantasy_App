"use client";

// A real switch (role="switch", not a styled checkbox pretending to
// be one) — state is conveyed by thumb position as well as color, so
// it still reads correctly without relying on color alone.
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
        <span className={`text-sm ${disabled ? "text-black/40 dark:text-white/40" : ""}`}>{label}</span>
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
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--wl-accent)] disabled:cursor-not-allowed disabled:opacity-40 ${
          checked ? "bg-[var(--wl-accent)]" : "bg-black/20 dark:bg-white/25"
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
