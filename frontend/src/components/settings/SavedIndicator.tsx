"use client";

// Subtle confirmation for settings that save immediately — a small
// fading "Saved" label, not a toast, per section 17 of the settings
// spec ("do not use giant toast notifications for every toggle").
export function SavedIndicator({ show }: { show: boolean }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`text-xs font-medium text-[var(--wl-accent)] transition-opacity duration-300 ${
        show ? "opacity-100" : "opacity-0"
      }`}
    >
      {show ? "Saved" : ""}
    </span>
  );
}
