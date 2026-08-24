"use client";

import { useEffect, useState } from "react";
import { getPreferences, updatePreferences, type OwnerPreferences } from "@/lib/api";
import { SavedIndicator } from "@/components/settings/SavedIndicator";

const NEON_LEVELS: { key: OwnerPreferences["neon_intensity"]; label: string }[] = [
  { key: "subtle", label: "Subtle" },
  { key: "standard", label: "Standard" },
  { key: "high", label: "High" },
];

// Mirrors a preference into a small non-httpOnly cookie so the next
// full page load (app/layout.tsx reads it server-side) applies it
// before first paint — see that file's comment. Not sensitive data,
// just a UI preference, so no httpOnly/Secure needed.
function setPreferenceCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function AppearanceSection() {
  const [prefs, setPrefs] = useState<OwnerPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch(() => setError("Couldn't load your appearance settings."));
  }, []);

  async function setNeonIntensity(level: OwnerPreferences["neon_intensity"]) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, neon_intensity: level });
    document.documentElement.setAttribute("data-neon", level);
    setPreferenceCookie("wl_neon", level);
    try {
      const updated = await updatePreferences({ neon_intensity: level });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      document.documentElement.setAttribute("data-neon", previous.neon_intensity);
      setPreferenceCookie("wl_neon", previous.neon_intensity);
      setError("Couldn't save that change — try again.");
    }
  }

  async function setReducedMotion(reduced: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, reduced_motion: reduced });
    document.documentElement.classList.toggle("motion-reduced", reduced);
    setPreferenceCookie("wl_motion", reduced ? "reduced" : "full");
    try {
      const updated = await updatePreferences({ reduced_motion: reduced });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      document.documentElement.classList.toggle("motion-reduced", previous.reduced_motion);
      setPreferenceCookie("wl_motion", previous.reduced_motion ? "reduced" : "full");
      setError("Couldn't save that change — try again.");
    }
  }

  if (error && !prefs) {
    return <p className="text-sm text-red-500">{error}</p>;
  }
  if (!prefs) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Appearance</h1>
          <p className="text-sm text-black/50 dark:text-white/50">Weekend League&apos;s look, tuned to your taste.</p>
        </div>
        <SavedIndicator show={saved} />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Theme</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Weekend League&apos;s signature look is dark — Light mode isn&apos;t ready yet.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Theme">
          <span className="rounded-full border-2 border-black dark:border-white px-3 py-1.5 text-sm font-medium">
            Dark
          </span>
          <span className="rounded-full border-2 border-transparent bg-black/5 px-3 py-1.5 text-sm text-black/40 dark:bg-white/10 dark:text-white/40">
            System
          </span>
          <span
            className="flex items-center gap-1.5 rounded-full border-2 border-transparent bg-black/5 px-3 py-1.5 text-sm text-black/30 dark:bg-white/10 dark:text-white/30"
            title="Not available yet"
          >
            Light
            <span className="rounded-full bg-black/10 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide uppercase dark:bg-white/10">
              Soon
            </span>
          </span>
        </div>
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Neon Intensity</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            How strong Weekend League&apos;s decorative glow reads — never affects text or contrast.
          </p>
        </div>
        <div className="flex gap-2" role="radiogroup" aria-label="Neon Intensity">
          {NEON_LEVELS.map((level) => (
            <button
              key={level.key}
              type="button"
              role="radio"
              aria-checked={prefs.neon_intensity === level.key}
              onClick={() => setNeonIntensity(level.key)}
              className={`rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
                prefs.neon_intensity === level.key
                  ? "border-[var(--wl-accent)] text-black dark:text-white"
                  : "border-transparent bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15"
              }`}
            >
              {level.label}
            </button>
          ))}
        </div>
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Animations</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Your device&apos;s own reduced-motion setting is always respected regardless of this choice.
          </p>
        </div>
        <div className="flex gap-2" role="radiogroup" aria-label="Animations">
          <button
            type="button"
            role="radio"
            aria-checked={!prefs.reduced_motion}
            onClick={() => setReducedMotion(false)}
            className={`rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
              !prefs.reduced_motion
                ? "border-[var(--wl-accent)] text-black dark:text-white"
                : "border-transparent bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15"
            }`}
          >
            Full
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={prefs.reduced_motion}
            onClick={() => setReducedMotion(true)}
            className={`rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
              prefs.reduced_motion
                ? "border-[var(--wl-accent)] text-black dark:text-white"
                : "border-transparent bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15"
            }`}
          >
            Reduced
          </button>
        </div>
      </section>
    </div>
  );
}
