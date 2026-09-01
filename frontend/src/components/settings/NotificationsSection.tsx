"use client";

import { useEffect, useState } from "react";
import {
  applySundayMode,
  getPreferences,
  updatePreferences,
  type OwnerPreferences,
  type SundayMode,
} from "@/lib/api";
import {
  getNotificationPermission,
  isIosDevice,
  isInstalledStandalone,
  isPushSupported,
  isSubscribedOnThisDevice,
  sendTestNotification,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push";
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

// FANTASY_TOGGLES (Game Alerts / My Players / My Fantasy Team / League)
// used to render here — removed 2026-09-01. They persisted to the
// database and looked fully functional, but no backend code path ever
// fired a push tagged with any of those categories: a user could
// enable "My Players" expecting a push when their RB scores and never
// receive one. A settings toggle that visibly claims a capability the
// product doesn't have is worse than not offering it at all (a finding
// from that day's competitive UX audit) — real event-driven triggers
// for these (scoring plays, matchup swings) are a bigger backend
// feature, tracked separately, not a quick settings-page fix.

type PushUiState = {
  supported: boolean;
  iosNeedsInstall: boolean;
  permission: NotificationPermission | "unsupported";
  subscribedHere: boolean;
};

export function NotificationsSection() {
  const [prefs, setPrefs] = useState<OwnerPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [push, setPush] = useState<PushUiState | null>(null);
  const [priming, setPriming] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    getPreferences()
      .then(setPrefs)
      .catch(() => setError("Couldn't load your notification settings."));
  }, []);

  useEffect(() => {
    refreshPushState();
  }, []);

  async function refreshPushState() {
    const supported = isPushSupported();
    if (!supported) {
      setPush({ supported: false, iosNeedsInstall: isIosDevice() && !isInstalledStandalone(), permission: "unsupported", subscribedHere: false });
      return;
    }
    const [permission, subscribedHere] = await Promise.all([
      Promise.resolve(getNotificationPermission()),
      isSubscribedOnThisDevice(),
    ]);
    setPush({
      supported: true,
      iosNeedsInstall: isIosDevice() && !isInstalledStandalone(),
      permission,
      subscribedHere,
    });
  }

  async function enablePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      await subscribeToPush();
      setPriming(false);
      await Promise.all([refreshPushState(), getPreferences().then(setPrefs)]);
      flashSaved();
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Couldn't enable push notifications.");
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    setPushError(null);
    try {
      await unsubscribeFromPush();
      await Promise.all([refreshPushState(), getPreferences().then(setPrefs)]);
      flashSaved();
    } catch {
      setPushError("Couldn't turn off push notifications — try again.");
    } finally {
      setPushBusy(false);
    }
  }

  async function testPush() {
    setPushBusy(true);
    setPushError(null);
    setTestResult(null);
    try {
      const { delivered, attempted } = await sendTestNotification();
      setTestResult(delivered > 0 ? "Sent — check this device." : `Couldn't deliver (0 of ${attempted} devices reachable).`);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : "Couldn't send a test notification.");
    } finally {
      setPushBusy(false);
      setTimeout(() => setTestResult(null), 4000);
    }
  }

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

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Push Notifications</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Real-time alerts on this device, even when Weekend League isn&apos;t open.
          </p>
        </div>

        {push === null && <p className="text-xs text-black/40 dark:text-white/40">Checking this device…</p>}

        {push && !push.supported && !push.iosNeedsInstall && (
          <p className="text-xs text-black/50 dark:text-white/50">
            Push notifications aren&apos;t supported in this browser.
          </p>
        )}

        {push && push.iosNeedsInstall && (
          <p className="text-xs text-black/50 dark:text-white/50">
            On iPhone/iPad, add Weekend League to your Home Screen first (Share → Add to Home Screen) — iOS only
            delivers push notifications to an installed app, not a browser tab.
          </p>
        )}

        {push && push.supported && !push.iosNeedsInstall && (
          <>
            {push.subscribedHere ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-black/60 dark:text-white/60">✓ Enabled on this device.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={testPush}
                    disabled={pushBusy}
                    className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.05]"
                  >
                    Send test notification
                  </button>
                  <button
                    type="button"
                    onClick={disablePush}
                    disabled={pushBusy}
                    className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.05]"
                  >
                    Turn off on this device
                  </button>
                  {testResult && <span className="text-xs text-black/50 dark:text-white/50">{testResult}</span>}
                </div>
              </div>
            ) : priming ? (
              <div className="flex flex-col gap-2 rounded-lg border border-[var(--wl-accent)]/30 bg-[color-mix(in_srgb,var(--wl-accent)_8%,transparent)] p-3">
                <p className="text-xs text-black/70 dark:text-white/70">
                  Your browser will ask for notification permission next — allow it to get real-time alerts for the
                  things you turn on below.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={enablePush}
                    disabled={pushBusy}
                    className="rounded-lg bg-[var(--wl-accent)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {pushBusy ? "Enabling…" : "Continue"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPriming(false)}
                    disabled={pushBusy}
                    className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-black/[0.03] disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/[0.05]"
                  >
                    Not now
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPriming(true)}
                className="self-start rounded-lg bg-[var(--wl-accent)] px-3 py-1.5 text-xs font-semibold text-white"
              >
                Enable push notifications
              </button>
            )}
            {push.permission === "denied" && !push.subscribedHere && (
              <p className="text-xs text-red-500">
                Notifications are blocked for this site in your browser settings — enable them there to turn this on.
              </p>
            )}
          </>
        )}

        {pushError && (
          <p role="alert" className="text-xs text-red-500">
            {pushError}
          </p>
        )}
      </section>

      <section className="neon-panel flex flex-col gap-1 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Fantasy Activity</h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          Alerts for your own players scoring, your matchup lead changing, and league-wide announcements —
          coming soon. Message notifications above are live today.
        </p>
      </section>

      <section className="neon-panel flex flex-col gap-3 rounded-xl bg-black/[0.015] p-5 dark:bg-white/[0.03]">
        <ToggleRow
          label="Quiet Hours"
          description="Saved now so it's ready the moment it's wired up — doesn't suppress today's message notifications yet."
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
