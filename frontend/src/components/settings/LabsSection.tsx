"use client";

import { useEffect, useState } from "react";
import { getPreferences, updatePreferences, type OwnerPreferences } from "@/lib/api";
import { SavedIndicator } from "@/components/settings/SavedIndicator";
import { ToggleRow } from "@/components/settings/ToggleRow";

// Same cookie-mirroring pattern as AppearanceSection.tsx's
// setPreferenceCookie — the next full page load (app/layout.tsx reads
// it server-side, before first paint) applies data-wl-layout="beta"
// without a flash of the old layout. "1"/"" rather than a string enum
// since this is a plain boolean, unlike theme/neon_intensity.
function setBetaLayoutCookie(on: boolean) {
  document.cookie = `wl_beta_layout=${on ? "1" : ""}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

// Same cookie-mirroring pattern as theme/neon_intensity in
// AppearanceSection.tsx — a literal string value (not a "1"/"" boolean
// hack), since this is a 3-value enum like theme, not a toggle.
function setDirectionCookie(value: OwnerPreferences["design_direction"]) {
  document.cookie = `wl_direction=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

const DESIGN_DIRECTIONS: {
  key: OwnerPreferences["design_direction"];
  label: string;
  description: string;
  swatches: string[];
}[] = [
  { key: "default", label: "Default", description: "Weekend League's current look.", swatches: ["#39ff14", "#0d1016"] },
  {
    key: "broadcast",
    label: "Broadcast Desk",
    description: "Team red + championship gold on near-black. Bold, broadcast-graphic headlines.",
    swatches: ["#dc2626", "#eab308", "#0b0d10"],
  },
  {
    key: "stadium",
    label: "Stadium Lights",
    description: "OLED black, frosted glass, cyan + violet floodlight accents.",
    swatches: ["#22d3ee", "#a855f7", "#050507"],
  },
];

/**
 * Settings > Labs — currently just the one opt-in beta toggle for the
 * redesigned nav (Home/League/Matchup/Chat/More) and page layouts
 * proposed in Documentation/UX/. Kept as its own section rather than
 * folded into Appearance since it's a structural choice, not a
 * palette one (Documentation/UX/06_Implementation_Roadmap.md section
 * 0 has the full reasoning) — a visitor can run either look with
 * either theme.
 */
export function LabsSection() {
  const [prefs, setPrefs] = useState<OwnerPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch(() => setError("Couldn't load your Labs settings."));
  }, []);

  async function setBetaLayout(on: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, beta_layout: on });
    setBetaLayoutCookie(on);
    try {
      const updated = await updatePreferences({ beta_layout: on });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      setBetaLayoutCookie(previous.beta_layout);
      setError("Couldn't save that change — try again.");
    }
  }

  async function setDesignDirection(direction: OwnerPreferences["design_direction"]) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, design_direction: direction });
    document.documentElement.setAttribute("data-wl-direction", direction);
    setDirectionCookie(direction);
    try {
      const updated = await updatePreferences({ design_direction: direction });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      document.documentElement.setAttribute("data-wl-direction", previous.design_direction);
      setDirectionCookie(previous.design_direction);
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
          <h1 className="text-xl font-semibold">Labs</h1>
          <p className="text-sm text-black/50 dark:text-white/50">Early looks at what&apos;s next.</p>
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
          <span className="mb-2 inline-flex w-fit items-center rounded-full bg-[var(--wl-accent)]/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--wl-accent)] uppercase">
            Beta
          </span>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Design Direction</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            A full color-and-typography reskin, built from a real design-exploration pass — nothing about how the
            app works changes, only how it looks. Applies instantly; picking one disables the Appearance &gt; Look
            choice below (a Direction sets its own palette). The current tab bar / nav layout choice above still
            applies underneath whichever Direction you pick.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Design Direction">
          {DESIGN_DIRECTIONS.map((dir) => (
            <button
              key={dir.key}
              type="button"
              role="radio"
              aria-checked={prefs.design_direction === dir.key}
              onClick={() => setDesignDirection(dir.key)}
              className={`flex flex-col items-start gap-1.5 rounded-lg border-2 p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
                prefs.design_direction === dir.key ? "border-black dark:border-white" : "border-transparent"
              }`}
            >
              <span className="flex gap-1" aria-hidden>
                {dir.swatches.map((hex) => (
                  <span key={hex} className="h-5 w-5 rounded-full" style={{ backgroundColor: hex }} />
                ))}
              </span>
              <span className="text-xs font-semibold">{dir.label}</span>
              <span className="max-w-[11rem] text-[10px] text-black/50 dark:text-white/50">{dir.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <span className="mb-2 inline-flex w-fit items-center rounded-full bg-[var(--wl-accent)]/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--wl-accent)] uppercase">
          Beta
        </span>
        <ToggleRow
          label="Try the new look"
          description="A redesigned nav (Home, League, Chat, More) and flatter cards. Matchup pages already use the new look for everyone. You can switch back anytime."
          checked={prefs.beta_layout}
          onChange={setBetaLayout}
        />
      </section>
    </div>
  );
}
