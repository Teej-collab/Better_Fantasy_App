"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetDisplayName, updateChatColor, updateDisplayName, type MySettings } from "@/lib/api";

// Same palette family already used for section accents across the
// dashboard (SECTION_GLOW, (home)/page.tsx) — picking from it instead
// of inventing a new one keeps a self-chosen bubble color feeling like
// part of the same app, not an arbitrary color-wheel pick.
const COLOR_SWATCHES = [
  "#0ea5e9", // sky
  "#ec4899", // pink
  "#fbbf24", // amber
  "#f97316", // orange
  "#a855f7", // purple
  "#6366f1", // indigo
  "#84cc16", // lime
  "#22d3ee", // cyan
  "#ef4444", // red
  "#39ff6a", // the login screen's own neon green
];

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function SettingsForm({ initial }: { initial: MySettings }) {
  const router = useRouter();

  const [name, setName] = useState(initial.display_name);
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "error">("idle");
  const [nameError, setNameError] = useState<string | null>(null);

  const [color, setColor] = useState(initial.chat_color);
  const [colorStatus, setColorStatus] = useState<"idle" | "saving" | "error">("idle");
  const [customHex, setCustomHex] = useState(initial.chat_color ?? "#");

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Display name can't be empty.");
      setNameStatus("error");
      return;
    }
    setNameStatus("saving");
    setNameError(null);
    try {
      await updateDisplayName(trimmed);
      setNameStatus("idle");
      router.refresh();
    } catch (e) {
      setNameError(e instanceof Error ? e.message : "Failed to save");
      setNameStatus("error");
    }
  }

  async function handleResetName() {
    setNameStatus("saving");
    try {
      await resetDisplayName();
      router.refresh();
    } catch {
      setNameError("Failed to reset — try again.");
      setNameStatus("error");
    } finally {
      setNameStatus("idle");
    }
  }

  async function applyColor(next: string | null) {
    setColorStatus("saving");
    try {
      await updateChatColor(next);
      setColor(next);
      router.refresh();
    } catch {
      setColorStatus("error");
      return;
    }
    setColorStatus("idle");
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Display Name</h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          Shown across the league — standings, chat, chug leaderboard, everywhere.
          {!initial.display_name_is_custom && " Currently your real ESPN name."}
        </p>
        <form onSubmit={saveName} className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            className="min-w-0 flex-1 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-black/20"
          />
          <button
            type="submit"
            disabled={nameStatus === "saving"}
            className="rounded-full bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {nameStatus === "saving" ? "Saving…" : "Save"}
          </button>
          {initial.display_name_is_custom && (
            <button
              type="button"
              onClick={handleResetName}
              className="text-xs text-black/50 hover:underline dark:text-white/50"
            >
              Reset to ESPN name
            </button>
          )}
        </form>
        {nameError && <p className="text-xs text-red-500">{nameError}</p>}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <h2 className="text-sm font-semibold tracking-wide uppercase">Chat Bubble Color</h2>
        <p className="text-xs text-black/50 dark:text-white/50">
          Everyone in League Chat sees your messages in this color — pick one that&apos;s yours.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => applyColor(null)}
            className={`h-9 w-9 rounded-full border-2 bg-gradient-to-br from-black/10 to-black/20 dark:from-white/10 dark:to-white/20 ${
              color === null ? "border-black dark:border-white" : "border-transparent"
            }`}
            title="Default"
            aria-label="Use the default bubble color"
          />
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              onClick={() => applyColor(c)}
              className={`h-9 w-9 rounded-full border-2 ${
                color?.toLowerCase() === c ? "border-black dark:border-white" : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
              title={c}
              aria-label={`Use ${c} as my bubble color`}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={customHex}
            onChange={(e) => setCustomHex(e.target.value)}
            placeholder="#39ff6a"
            maxLength={7}
            className="w-28 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-black/20"
          />
          <button
            onClick={() => applyColor(customHex)}
            disabled={!HEX_PATTERN.test(customHex) || colorStatus === "saving"}
            className="rounded-full border border-black/10 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-white/10"
          >
            Use custom color
          </button>
        </div>
        {colorStatus === "error" && <p className="text-xs text-red-500">Failed to save — try again.</p>}
      </section>

      <section className="flex flex-col gap-1 rounded-xl border border-black/10 bg-black/[0.015] p-5 text-xs text-black/50 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none dark:text-white/50">
        <h2 className="text-sm font-semibold tracking-wide text-black/70 uppercase dark:text-white/70">Account</h2>
        <p>Signed in with Discord{initial.discord_username ? ` as @${initial.discord_username}` : ""}.</p>
        <p>Only you can see or change these settings.</p>
      </section>
    </div>
  );
}
