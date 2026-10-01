"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getPreferences, updatePreferences, type OwnerPreferences } from "@/lib/api";
import { ToggleRow } from "@/components/settings/ToggleRow";
import { SavedIndicator } from "@/components/settings/SavedIndicator";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

// Settings > Bets: the switch for bet tracking (My Bets and the
// Gamecast's Your Bets card). Turning it off hides them; saved bets stay
// put for if it's turned back on.
export function BetsSection() {
  const [prefs, setPrefs] = useState<OwnerPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch(() => setError("Couldn't load your bet settings."));
  }, []);

  async function toggle(checked: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, bet_tracking_enabled: checked });
    setError(null);
    try {
      setPrefs(await updatePreferences({ bet_tracking_enabled: checked }));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
      setError("Couldn't save that change — try again.");
    }
  }

  if (error && !prefs) return <p className="text-sm text-red-500">{error}</p>;
  if (!prefs) return <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold">Bets</h1>
          <p className="text-sm text-black/50 dark:text-white/50">Track your bets live. Tracking only — nothing is ever placed.</p>
        </div>
        <SavedIndicator show={saved} />
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
      <section
        className="neon-panel flex flex-col rounded-xl bg-black/[0.015] px-5 dark:bg-white/[0.03]"
        style={panelGlowStyle(SECTION_COLORS.matchups)}
      >
        <ToggleRow
          label="Bet Tracking"
          description="Show My Bets and a Your Bets card on the Gamecast for games you have a leg in. Your bets are private — nobody else sees one unless you share it to league chat."
          checked={prefs.bet_tracking_enabled}
          onChange={toggle}
        />
      </section>
      {prefs.bet_tracking_enabled && (
        <Link href="/bets" className="self-start text-sm font-medium text-[var(--wl-accent-dim)] hover:underline">
          Go to My Bets →
        </Link>
      )}
      <p className="text-xs text-black/40 dark:text-white/40">21+. If gambling stops being fun, call or text 1-800-GAMBLER.</p>
    </div>
  );
}
