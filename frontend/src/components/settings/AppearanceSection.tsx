"use client";

import { useEffect, useState } from "react";
import { getPreferences, updatePreferences, type OwnerPreferences } from "@/lib/api";
import { SavedIndicator } from "@/components/settings/SavedIndicator";
import { ColorChoices, isHexColor } from "@/components/settings/ColorChoices";
import { getIntroSoundMode, setIntroSoundMode, type IntroSoundMode } from "@/lib/introSoundPreference";

const INTRO_SOUND_MODES: { key: IntroSoundMode; label: string }[] = [
  { key: "daily", label: "Once a Day" },
  { key: "always", label: "Every Time" },
  { key: "off", label: "Off" },
];

// The six looks (2026-10-28): each the whole site's background, panels
// and accent. Keep in step with the app's LOOKS (mobile
// SettingsSections.tsx) and globals.css's [data-wl-theme] blocks.
const LOOKS: { key: OwnerPreferences["theme"]; name: string; blurb: string; surface: string; bg: string; accent: string }[] = [
  { key: "calm", name: "Calm", blurb: "The classic: neon green on dark", surface: "#12161c", bg: "#0d1016", accent: "#39ff14" },
  { key: "cosmic", name: "Cosmic", blurb: "Deep purple, each section its own color", surface: "#171129", bg: "#0a0716", accent: "#39ffb0" },
  { key: "midnight", name: "Midnight", blurb: "Navy panels, ice-blue accent", surface: "#0e1526", bg: "#060a13", accent: "#5cc8ff" },
  { key: "graphite", name: "Graphite", blurb: "True black and silver", surface: "#121214", bg: "#000000", accent: "#f2f2f7" },
  { key: "ember", name: "Ember", blurb: "Warm charcoal, orange accent", surface: "#1a110c", bg: "#110a07", accent: "#ff7a2f" },
  { key: "gridiron", name: "Gridiron", blurb: "Field green, lime accent", surface: "#0c1a12", bg: "#06100a", accent: "#b4f03a" },
];

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
  if (isHexColor(hex)) {
    document.documentElement.style.setProperty("--user-accent", hex);
    setPreferenceCookie("wl_accent", hex);
  } else {
    document.documentElement.style.removeProperty("--user-accent");
    setPreferenceCookie("wl_accent", "");
  }
}

// Multi (2026-10) is stored like any choice but sets no CSS color here —
// the web's cards are flat, so it falls back to the default.

// Same idea, for the two narrower personal colors layered on top of
// Accent Color (2026-09): --your-week-color (just the Home page's
// Your Week card) and --border-glow-color (the moving ring on every
// card/countdown tile). Both fall back to --user-accent when cleared,
// same chain globals.css already reads.
function applyYourWeekColor(hex: string | null) {
  if (isHexColor(hex)) {
    document.documentElement.style.setProperty("--your-week-color", hex);
    setPreferenceCookie("wl_your_week_color", hex);
  } else {
    document.documentElement.style.removeProperty("--your-week-color");
    setPreferenceCookie("wl_your_week_color", "");
  }
}

function applyBorderGlowColor(hex: string | null) {
  if (isHexColor(hex)) {
    document.documentElement.style.setProperty("--border-glow-color", hex);
    setPreferenceCookie("wl_border_color", hex);
  } else {
    document.documentElement.style.removeProperty("--border-glow-color");
    setPreferenceCookie("wl_border_color", "");
  }
}

// The breathing honeycomb background (CinematicHoneycombBackground.tsx)
// — a hex color, "off" (hides it via data-honeycomb on <html>), or
// null for the default crimson. Same apply-now-and-mirror-to-a-cookie
// approach as the colors above.
const HONEYCOMB_DEFAULT = "#dc143c";

function applyHoneycombColor(value: string | null) {
  const root = document.documentElement;
  if (value === "off") {
    root.setAttribute("data-honeycomb", "off");
  } else {
    root.removeAttribute("data-honeycomb");
  }
  if (value && value !== "off") {
    root.style.setProperty("--honeycomb-color", value);
  } else {
    root.style.removeProperty("--honeycomb-color");
  }
  setPreferenceCookie("wl_honeycomb", value ?? "");
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

  // A look (the same six as the app's Settings › Look & feel): the whole
  // palette, with the accent and color picks back to the look's own.
  async function applyLook(t: (typeof LOOKS)[number]) {
    if (!prefs) return;
    const previous = prefs;
    const fields = { theme: t.key, accent_color: null, honeycomb_color: null, your_week_color: null, border_glow_color: null };
    setPrefs({ ...prefs, ...fields });
    document.documentElement.setAttribute("data-wl-theme", t.key);
    setPreferenceCookie("wl_theme", t.key);
    applyAccentColor(null);
    applyHoneycombColor(null);
    applyYourWeekColor(null);
    applyBorderGlowColor(null);
    try {
      setPrefs(await updatePreferences(fields));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      document.documentElement.setAttribute("data-wl-theme", previous.theme);
      setPreferenceCookie("wl_theme", previous.theme);
      applyAccentColor(previous.accent_color);
      applyHoneycombColor(previous.honeycomb_color);
      applyYourWeekColor(previous.your_week_color);
      applyBorderGlowColor(previous.border_glow_color);
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

  async function setHoneycombColor(value: string | null) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, honeycomb_color: value });
    applyHoneycombColor(value);
    try {
      const updated = await updatePreferences({ honeycomb_color: value });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      applyHoneycombColor(previous.honeycomb_color);
      setError("Couldn't save that change — try again.");
    }
  }

  if (error && !prefs) {
    return <p className="text-sm text-red-500">{error}</p>;
  }
  if (!prefs) {
    return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;
  }

  // "Default" follows the accent: its hex, or the theme accent for Default/Multi.
  const accentSwatch = isHexColor(prefs.accent_color) ? prefs.accent_color : "var(--wl-accent)";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Look &amp; feel</h1>
          <p className="text-sm text-black/50 dark:text-white/50">Pick a theme in one click, or fine-tune it below.</p>
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
          <h2 className="text-sm font-semibold tracking-wide uppercase">Looks</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            The whole site&apos;s colors in one click. Fine-tune the accent and the rest below. The logo stays the same for
            everyone.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Looks">
          {LOOKS.map((t) => {
            const on = prefs.theme === t.key;
            return (
              <button
                key={t.name}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => void applyLook(t)}
                disabled={prefs.design_direction !== "default"}
                className="flex min-h-20 flex-col items-start justify-between rounded-xl border-2 p-2.5 text-left text-sm font-semibold text-white"
                style={{ background: t.bg, borderColor: on ? t.accent : "rgba(255,255,255,0.12)" }}
              >
                <span className="flex gap-1">
                  <span className="h-4 w-4 rounded-full" style={{ background: t.accent }} />
                  <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: t.surface }} />
                </span>
                <span className="flex flex-col">
                  {t.name}
                  <span className="text-[11px] font-medium text-white/60">{on ? "Current" : t.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <p className="text-xs font-bold tracking-[0.14em] text-black/50 dark:text-white/50">FINE-TUNE</p>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Neon Intensity</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            How strong The Weekend&apos;s decorative glow reads — never affects text or contrast.
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
        <ColorChoices label="Accent Color" value={prefs.accent_color} onChange={setAccentColor} defaultColor="var(--wl-accent)" without={["#39ff14"]} className="flex flex-wrap gap-2" />
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Background</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            The color of the faint breathing honeycomb behind every page. Multi gives the lights behind it different
            colors, so the lines between the hexagons glow in several.
          </p>
        </div>
        <ColorChoices label="Background Color" value={prefs.honeycomb_color} onChange={setHoneycombColor} defaultColor={HONEYCOMB_DEFAULT} defaultLabel="Crimson" offOption className="flex flex-wrap gap-2" />
      </section>

      {/* Settings > Labs > "Try the new look" collapses these two
          power-user color pickers behind a disclosure instead of
          always showing all three — Documentation/UX/00_UX_Audit.md's
          P3 finding was that most owners will only ever touch Accent
          Color, but every visit paid the cost (visual weight + 2 more
          .neon-panel glow rings) of the other two regardless. Legacy
          rendering (both sections always open) is unchanged. */}
      {prefs.beta_layout ? (
        <details className="wl-card group rounded-xl p-5">
          <summary className="cursor-pointer list-none text-sm font-semibold tracking-wide text-black/70 uppercase select-none dark:text-white/70">
            <span className="inline-flex items-center gap-1.5">
              Advanced colors
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className="transition-transform group-open:rotate-90"
                aria-hidden
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </summary>
          <div className="mt-4 flex flex-col gap-5">
            <div>
              <h3 className="text-xs font-semibold tracking-wide text-black/60 uppercase dark:text-white/60">
                Your Week Card Color
              </h3>
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                Just your own Your Week card on Home. Default follows your Accent Color.
              </p>
              <ColorChoices label="Your Week Card Color" value={prefs.your_week_color} onChange={setYourWeekColor} defaultColor={accentSwatch} className="mt-2 flex flex-wrap gap-2" />
            </div>

            <div>
              <h3 className="text-xs font-semibold tracking-wide text-black/60 uppercase dark:text-white/60">
                Border Animation Color
              </h3>
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                The moving neon ring on every card and countdown tile. Default follows your Accent Color.
              </p>
              <ColorChoices label="Border Animation Color" value={prefs.border_glow_color} onChange={setBorderGlowColor} defaultColor={accentSwatch} className="mt-2 flex flex-wrap gap-2" />
            </div>
          </div>
        </details>
      ) : (
        <>
          <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
            <div>
              <h2 className="text-sm font-semibold tracking-wide uppercase">Your Week Card Color</h2>
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                Just your own Your Week card on Home — independent of Accent Color. Default follows your Accent Color.
              </p>
            </div>
            <ColorChoices label="Your Week Card Color" value={prefs.your_week_color} onChange={setYourWeekColor} defaultColor={accentSwatch} className="flex flex-wrap gap-2" />
          </section>

          <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
            <div>
              <h2 className="text-sm font-semibold tracking-wide uppercase">Border Animation Color</h2>
              <p className="mt-1 text-xs text-black/50 dark:text-white/50">
                The moving neon ring on every card and countdown tile — independent of Accent Color and Your Week Card
                Color. Default follows your Accent Color.
              </p>
            </div>
            <ColorChoices label="Border Animation Color" value={prefs.border_glow_color} onChange={setBorderGlowColor} defaultColor={accentSwatch} className="flex flex-wrap gap-2" />
          </section>
        </>
      )}

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

// Sound (2026-10-28 cleanup): the intro sound, apart from the look.
export function SoundSection() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Sound</h1>
        <p className="text-sm text-black/50 dark:text-white/50">The intro when you open The Weekend.</p>
      </div>
      <IntroSoundSetting />
    </div>
  );
}

// Saved in this browser (introSoundPreference.ts), not the account.
// Only drawn once preferences load in the browser, so it can read
// localStorage straight away.
function IntroSoundSetting() {
  const [mode, setMode] = useState<IntroSoundMode>(getIntroSoundMode);
  return (
    <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
      <div>
        <h2 className="text-sm font-semibold tracking-wide uppercase">Intro Sound</h2>
        <p className="mt-1 text-xs text-black/50 dark:text-white/50">
          The full Welcome Back intro on Home: the lights clicking on, then a can cracking open and the pour. Every
          other load gets the quick version. Your browser may keep it quiet until you&apos;ve clicked on the page.
        </p>
      </div>
      <div className="flex gap-2" role="radiogroup" aria-label="Intro Sound">
        {INTRO_SOUND_MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={mode === m.key}
            onClick={() => {
              setMode(m.key);
              setIntroSoundMode(m.key);
            }}
            className={`rounded-full border-2 px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === m.key
                ? "border-[var(--wl-accent)] text-black dark:text-white"
                : "border-transparent bg-black/5 text-black/60 hover:bg-black/10 dark:bg-white/10 dark:text-white/60 dark:hover:bg-white/15"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </section>
  );
}
