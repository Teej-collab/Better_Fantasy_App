"use client";

import { useEffect, useState } from "react";
import { getPreferences, updatePreferences, type OwnerPreferences } from "@/lib/api";
import { SavedIndicator } from "@/components/settings/SavedIndicator";
import { NEON_PALETTE } from "@/lib/neonPalette";

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

// Same idea as neon_intensity/reduced_motion above, but for a value
// (not a fixed enum) that also has to actually take effect immediately
// — every .neon-panel reads --user-accent, so setting it here is what
// makes every box on the page re-color the instant you pick a swatch,
// not just on the next full page load. null clears back to the app
// default (Neon Green, --wl-accent) by removing the override entirely
// rather than setting it to that hex explicitly — same value, but this
// way a future default change doesn't leave "cleared" accounts stuck
// on today's green.
function applyAccentColor(hex: string | null) {
  if (hex) {
    document.documentElement.style.setProperty("--user-accent", hex);
    setPreferenceCookie("wl_accent", hex);
  } else {
    document.documentElement.style.removeProperty("--user-accent");
    setPreferenceCookie("wl_accent", "");
  }
}

// Same idea, for the two narrower personal colors layered on top of
// Accent Color (2026-09): --your-week-color (just the Home page's
// Your Week card) and --border-glow-color (the moving ring on every
// card/countdown tile). Both fall back to --user-accent when cleared,
// same chain globals.css already reads.
function applyYourWeekColor(hex: string | null) {
  if (hex) {
    document.documentElement.style.setProperty("--your-week-color", hex);
    setPreferenceCookie("wl_your_week_color", hex);
  } else {
    document.documentElement.style.removeProperty("--your-week-color");
    setPreferenceCookie("wl_your_week_color", "");
  }
}

function applyBorderGlowColor(hex: string | null) {
  if (hex) {
    document.documentElement.style.setProperty("--border-glow-color", hex);
    setPreferenceCookie("wl_border_color", hex);
  } else {
    document.documentElement.style.removeProperty("--border-glow-color");
    setPreferenceCookie("wl_border_color", "");
  }
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

  async function setTheme(theme: OwnerPreferences["theme"]) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, theme });
    document.documentElement.setAttribute("data-wl-theme", theme);
    setPreferenceCookie("wl_theme", theme);
    try {
      const updated = await updatePreferences({ theme });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      document.documentElement.setAttribute("data-wl-theme", previous.theme);
      setPreferenceCookie("wl_theme", previous.theme);
      setError("Couldn't save that change — try again.");
    }
  }

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

  async function setAccentColor(hex: string | null) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, accent_color: hex });
    applyAccentColor(hex);
    try {
      const updated = await updatePreferences({ accent_color: hex });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      applyAccentColor(previous.accent_color);
      setError("Couldn't save that change — try again.");
    }
  }

  async function setYourWeekColor(hex: string | null) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, your_week_color: hex });
    applyYourWeekColor(hex);
    try {
      const updated = await updatePreferences({ your_week_color: hex });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      applyYourWeekColor(previous.your_week_color);
      setError("Couldn't save that change — try again.");
    }
  }

  async function setBorderGlowColor(hex: string | null) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, border_glow_color: hex });
    applyBorderGlowColor(hex);
    try {
      const updated = await updatePreferences({ border_glow_color: hex });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      applyBorderGlowColor(previous.border_glow_color);
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
          <h2 className="text-sm font-semibold tracking-wide uppercase">Look</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Calm is Weekend League&apos;s current look. Cosmic brings back the starfield background and a
            brighter accent — everything else (layout, pages, features) stays exactly the same either way.
          </p>
        </div>
        <div className="flex gap-2" role="radiogroup" aria-label="Look">
          <button
            type="button"
            role="radio"
            aria-checked={prefs.theme === "calm"}
            onClick={() => setTheme("calm")}
            className={`rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
              prefs.theme === "calm"
                ? "border-[var(--wl-accent)] text-black dark:text-white"
                : "border-transparent bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15"
            }`}
          >
            Calm
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={prefs.theme === "cosmic"}
            onClick={() => setTheme("cosmic")}
            className={`rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
              prefs.theme === "cosmic"
                ? "border-[var(--wl-accent)] text-black dark:text-white"
                : "border-transparent bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15"
            }`}
          >
            Cosmic
          </button>
        </div>
      </section>

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
          <span className="rounded-full border-2 border-transparent bg-black/5 px-3 py-1.5 text-sm text-black/50 dark:bg-white/10 dark:text-white/50">
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
        {/* Each pill carries .glass-surface (globals.css, ToggleRow.tsx's
            comment has the full rationale) for a frosted-glass look —
            purely additive on top of the selected/unselected border and
            background classes below, which stay exactly as they were. */}
        <div className="flex gap-2" role="radiogroup" aria-label="Neon Intensity">
          {NEON_LEVELS.map((level) => (
            <button
              key={level.key}
              type="button"
              role="radio"
              aria-checked={prefs.neon_intensity === level.key}
              onClick={() => setNeonIntensity(level.key)}
              className={`glass-surface rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
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
          <h2 className="text-sm font-semibold tracking-wide uppercase">Accent Color</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Colors the nav bar&apos;s current tab everywhere in the app, plus the glow on boxes that aren&apos;t
            already tied to a league section (Standings, Rivalries, and so on keep their own color regardless of
            this choice).
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent Color">
          <button
            type="button"
            role="radio"
            aria-checked={prefs.accent_color === null}
            onClick={() => setAccentColor(null)}
            className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
              prefs.accent_color === null ? "border-black dark:border-white" : "border-transparent"
            }`}
          >
            <span className="h-8 w-8 rounded-full" style={{ backgroundColor: "#39ff14" }} aria-hidden />
            <span className="text-[10px] text-black/50 dark:text-white/50">Default</span>
          </button>
          {NEON_PALETTE.filter((p) => p.name !== "Neon Green").map((preset) => (
            <button
              key={preset.hex}
              type="button"
              role="radio"
              aria-checked={prefs.accent_color?.toLowerCase() === preset.hex}
              onClick={() => setAccentColor(preset.hex)}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
                prefs.accent_color?.toLowerCase() === preset.hex ? "border-black dark:border-white" : "border-transparent"
              }`}
            >
              <span className="h-8 w-8 rounded-full" style={{ backgroundColor: preset.hex }} aria-hidden />
              <span className="max-w-[4.5rem] text-[10px] text-black/50 dark:text-white/50">{preset.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Your Week Card Color</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Just your own Your Week card on Home — independent of Accent Color. Default follows your Accent Color.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Your Week Card Color">
          <button
            type="button"
            role="radio"
            aria-checked={prefs.your_week_color === null}
            onClick={() => setYourWeekColor(null)}
            className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
              prefs.your_week_color === null ? "border-black dark:border-white" : "border-transparent"
            }`}
          >
            <span className="h-8 w-8 rounded-full" style={{ backgroundColor: prefs.accent_color ?? "#39ff14" }} aria-hidden />
            <span className="text-[10px] text-black/50 dark:text-white/50">Default</span>
          </button>
          {NEON_PALETTE.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              role="radio"
              aria-checked={prefs.your_week_color?.toLowerCase() === preset.hex}
              onClick={() => setYourWeekColor(preset.hex)}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
                prefs.your_week_color?.toLowerCase() === preset.hex ? "border-black dark:border-white" : "border-transparent"
              }`}
            >
              <span className="h-8 w-8 rounded-full" style={{ backgroundColor: preset.hex }} aria-hidden />
              <span className="max-w-[4.5rem] text-[10px] text-black/50 dark:text-white/50">{preset.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Border Animation Color</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            The moving neon ring on every card and countdown tile — independent of Accent Color and Your Week Card
            Color. Default follows your Accent Color.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Border Animation Color">
          <button
            type="button"
            role="radio"
            aria-checked={prefs.border_glow_color === null}
            onClick={() => setBorderGlowColor(null)}
            className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
              prefs.border_glow_color === null ? "border-black dark:border-white" : "border-transparent"
            }`}
          >
            <span className="h-8 w-8 rounded-full" style={{ backgroundColor: prefs.accent_color ?? "#39ff14" }} aria-hidden />
            <span className="text-[10px] text-black/50 dark:text-white/50">Default</span>
          </button>
          {NEON_PALETTE.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              role="radio"
              aria-checked={prefs.border_glow_color?.toLowerCase() === preset.hex}
              onClick={() => setBorderGlowColor(preset.hex)}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
                prefs.border_glow_color?.toLowerCase() === preset.hex ? "border-black dark:border-white" : "border-transparent"
              }`}
            >
              <span className="h-8 w-8 rounded-full" style={{ backgroundColor: preset.hex }} aria-hidden />
              <span className="max-w-[4.5rem] text-[10px] text-black/50 dark:text-white/50">{preset.name}</span>
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
