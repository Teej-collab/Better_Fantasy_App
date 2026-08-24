"use client";

import { useEffect, useState } from "react";
import {
  applySundayMode,
  getPreferences,
  updatePreferences,
  type OwnerPreferences,
  type SundayMode,
} from "@/lib/api";
import { ToggleRow } from "@/components/settings/ToggleRow";
import { SavedIndicator } from "@/components/settings/SavedIndicator";

const SUNDAY_MODES: { key: SundayMode; emoji: string; label: string; description: string }[] = [
  { key: "full_send", emoji: "🔥", label: "Full Send", description: "Everything — every message notification on." },
  { key: "game_day", emoji: "🏈", label: "Game Day", description: "Direct messages and @mentions only." },
  { key: "leave_me_alone", emoji: "😎", label: "Leave Me Alone", description: "Only direct messages and @mentions." },
];

const MESSAGE_TOGGLES: { key: keyof OwnerPreferences; label: string; description: string }[] = [
  { key: "notify_direct_messages", label: "Direct messages", description: "Someone starts or sends you a DM." },
  { key: "notify_league_chat", label: "League chat", description: "New activity in the shared league room." },
  { key: "notify_mentions", label: "@Mentions", description: "Someone @mentions you anywhere in chat." },
  { key: "notify_replies", label: "Replies to my messages", description: "Someone replies directly to something you sent." },
];

const FANTASY_TOGGLES = [
  "Touchdowns",
  "Player scoring events",
  "Game starting",
  "Red-zone activity",
  "Matchup lead changes",
  "Final scores",
];

export function NotificationsSection() {
  const [prefs, setPrefs] = useState<OwnerPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch(() => setError("Couldn't load your notification settings."));
  }, []);

  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function patch(fields: Partial<OwnerPreferences>) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, ...fields }); // optimistic — toggles should feel instant
    setError(null);
    try {
      const updated = await updatePreferences(fields);
      setPrefs(updated);
      flashSaved();
    } catch {
      setPrefs(previous);
      setError("Couldn't save that change — try again.");
    }
  }

  async function choosePreset(preset: SundayMode) {
    if (!prefs) return;
    setError(null);
    try {
      const updated = await applySundayMode(preset);
      setPrefs(updated);
      flashSaved();
    } catch {
      setError("Couldn't apply that preset — try again.");
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
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-sm text-black/50 dark:text-white/50">
            What Weekend League lets you know about, and when.
          </p>
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
          <h2 className="text-sm font-semibold tracking-wide uppercase">Sunday Mode</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            A quick preset instead of tuning every toggle by hand — pick one, or keep customizing below.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {SUNDAY_MODES.map((mode) => (
            <button
              key={mode.key}
              type="button"
              onClick={() => choosePreset(mode.key)}
              aria-pressed={prefs.sunday_mode === mode.key}
              className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                prefs.sunday_mode === mode.key
                  ? "border-[var(--wl-accent)] bg-[color-mix(in_srgb,var(--wl-accent)_10%,transparent)]"
                  : "border-black/10 hover:bg-black/[0.02] dark:border-white/10 dark:hover:bg-white/[0.03]"
              }`}
            >
              <span className="text-sm font-medium">
                {mode.emoji} {mode.label}
              </span>
              <span className="text-xs text-black/50 dark:text-white/50">{mode.description}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-black/40 dark:text-white/40">
          {prefs.sunday_mode
            ? `Active: ${SUNDAY_MODES.find((m) => m.key === prefs.sunday_mode)?.label}`
            : "Customized — doesn't match a preset."}
        </p>
      </section>

      <section className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Messages</h2>
        <div className="mt-2 flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {MESSAGE_TOGGLES.map((t) => (
            <ToggleRow
              key={t.key}
              label={t.label}
              description={t.description}
              checked={Boolean(prefs[t.key])}
              onChange={(checked) => patch({ [t.key]: checked })}
            />
          ))}
        </div>
      </section>

      <section className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-wide uppercase">Fantasy Activity</h2>
          <span className="rounded-full bg-black/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-black/50 uppercase dark:bg-white/10 dark:text-white/50">
            Coming soon
          </span>
        </div>
        <p className="mb-2 text-xs text-black/50 dark:text-white/50">
          Live scoring events aren&apos;t wired up yet — these will turn on once they are.
        </p>
        <div className="flex flex-col divide-y divide-black/5 dark:divide-white/5">
          {FANTASY_TOGGLES.map((label) => (
            <ToggleRow key={label} label={label} checked={false} disabled onChange={() => {}} />
          ))}
        </div>
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <ToggleRow
          label="Quiet Hours"
          description="Saved now so it's ready the moment push notifications ship — Weekend League doesn't send push notifications yet, so there's nothing to suppress today."
          checked={prefs.quiet_hours_enabled}
          onChange={(checked) => patch({ quiet_hours_enabled: checked })}
        />
        {prefs.quiet_hours_enabled && (
          <div className="flex items-center gap-3 pl-1 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-black/50 dark:text-white/50">From</span>
              <input
                type="time"
                value={prefs.quiet_hours_start.slice(0, 5)}
                onChange={(e) => patch({ quiet_hours_start: `${e.target.value}:00` })}
                className="rounded-lg border border-black/10 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-black/20"
              />
            </label>
            <span className="mt-4 text-black/30 dark:text-white/30">→</span>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-black/50 dark:text-white/50">To</span>
              <input
                type="time"
                value={prefs.quiet_hours_end.slice(0, 5)}
                onChange={(e) => patch({ quiet_hours_end: `${e.target.value}:00` })}
                className="rounded-lg border border-black/10 bg-white px-2 py-1.5 dark:border-white/10 dark:bg-black/20"
              />
            </label>
          </div>
        )}
      </section>
    </div>
  );
}
