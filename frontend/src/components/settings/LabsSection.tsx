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

      <section className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <span className="mb-2 inline-flex w-fit items-center rounded-full bg-[var(--wl-accent)]/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--wl-accent)] uppercase">
          Beta
        </span>
        <ToggleRow
          label="Try the new look"
          description="A redesigned nav (Home, League, Matchup, Chat, More), flatter cards, and a reordered Home & Matchup layout. You can switch back anytime."
          checked={prefs.beta_layout}
          onChange={setBetaLayout}
        />
      </section>
    </div>
  );
}
