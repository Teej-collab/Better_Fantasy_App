"use client";

import { useEffect, useState } from "react";
import { getPreferences, updatePreferences, type OwnerPreferences } from "@/lib/api";
import { ToggleRow } from "@/components/settings/ToggleRow";
import { SavedIndicator } from "@/components/settings/SavedIndicator";

const CHAT_TOGGLES: { key: keyof OwnerPreferences; label: string; description: string }[] = [
  {
    key: "read_receipts_enabled",
    label: "Read Receipts",
    description: "Let others see when you've read their messages.",
  },
  {
    key: "typing_indicators_enabled",
    label: "Typing Indicators",
    description: "Let others see when you're typing a reply.",
  },
  {
    key: "message_previews_enabled",
    label: "Message Previews",
    description: "Show the actual message text in your conversation list, not just \"New message.\"",
  },
  {
    key: "mention_highlighting_enabled",
    label: "Mention Notifications",
    description: "Highlight messages in chat that @mention you.",
  },
];

export function ChatSection() {
  const [prefs, setPrefs] = useState<OwnerPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch(() => setError("Couldn't load your chat settings."));
  }, []);

  async function patch(key: keyof OwnerPreferences, checked: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: checked });
    setError(null);
    try {
      const updated = await updatePreferences({ [key]: checked });
      setPrefs(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch {
      setPrefs(previous);
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
          <h1 className="text-xl font-semibold">Chat</h1>
          <p className="text-sm text-black/50 dark:text-white/50">How League Chat behaves for you.</p>
        </div>
        <SavedIndicator show={saved} />
      </div>

      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}

      <section className="flex flex-col divide-y divide-black/5 rounded-xl border border-black/10 bg-black/[0.015] px-5 shadow-sm dark:divide-white/5 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        {CHAT_TOGGLES.map((t) => (
          <ToggleRow
            key={t.key}
            label={t.label}
            description={t.description}
            checked={Boolean(prefs[t.key])}
            onChange={(checked) => patch(t.key, checked)}
          />
        ))}
      </section>
    </div>
  );
}
