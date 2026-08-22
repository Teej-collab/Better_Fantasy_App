"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resetDisplayName, updateChatColor, updateDisplayName, type MySettings } from "@/lib/api";
import { readableTextColor } from "@/components/chat/MessageBubble";

// Named, curated palette — drawn from the design system itself
// (Weekend Green is literally --wl-accent, White/Neutral is --wl-text)
// plus the most-used presets from the previous picker's swatch list,
// trimmed to a named seven instead of an arbitrary ten-plus-a-raw-
// color-wheel. No free-form <input type="color"> — every message
// stays readable because readableTextColor (the same function
// MessageBubble.tsx uses to render real chat bubbles) already adapts
// text color per background, so any color on this list is guaranteed
// legible by construction, not by hand-picking "safe" hues.
const CHAT_COLOR_PRESETS: { name: string; hex: string }[] = [
  { name: "Weekend Green", hex: "#39ff6a" },
  { name: "Electric Blue", hex: "#0ea5e9" },
  { name: "Hot Pink", hex: "#ec4899" },
  { name: "Golden Yellow", hex: "#fbbf24" },
  { name: "Orange", hex: "#f97316" },
  { name: "Purple", hex: "#a855f7" },
  { name: "White/Neutral", hex: "#f5f4ec" },
];

const DEFAULT_BUBBLE_COLOR = "#1c8a3e"; // --wl-accent-dim, the app's own default bubble color

export function ProfileSection({ initial }: { initial: MySettings }) {
  const router = useRouter();

  const [name, setName] = useState(initial.display_name);
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "error">("idle");
  const [nameError, setNameError] = useState<string | null>(null);

  const [color, setColor] = useState(initial.chat_color);
  const [colorStatus, setColorStatus] = useState<"idle" | "saving" | "error">("idle");

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

  const previewHex = color ?? DEFAULT_BUBBLE_COLOR;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Profile</h1>
        <p className="text-sm text-black/50 dark:text-white/50">How you appear throughout Weekend League.</p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Display Name</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Shown across the league — standings, chat, chug leaderboard, everywhere.
            {!initial.display_name_is_custom && " Currently your real ESPN name."}
          </p>
        </div>
        <form onSubmit={saveName} className="flex flex-wrap items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            aria-label="Display name"
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
        {nameError && (
          <p role="alert" className="text-xs text-red-500">
            {nameError}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[0.015] p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none">
        <div>
          <h2 className="text-sm font-semibold tracking-wide uppercase">Chat Bubble Color</h2>
          <p className="mt-1 text-xs text-black/50 dark:text-white/50">
            Everyone in League Chat sees your messages in this color.
          </p>
        </div>

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Chat bubble color">
          <button
            type="button"
            role="radio"
            aria-checked={color === null}
            onClick={() => applyColor(null)}
            className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
              color === null ? "border-black dark:border-white" : "border-transparent"
            }`}
          >
            <span
              className="h-8 w-8 rounded-full bg-gradient-to-br from-black/10 to-black/20 dark:from-white/10 dark:to-white/20"
              aria-hidden
            />
            <span className="text-[10px] text-black/50 dark:text-white/50">Default</span>
          </button>
          {CHAT_COLOR_PRESETS.map((preset) => (
            <button
              key={preset.hex}
              type="button"
              role="radio"
              aria-checked={color?.toLowerCase() === preset.hex}
              onClick={() => applyColor(preset.hex)}
              className={`flex flex-col items-center gap-1 rounded-lg border-2 p-1.5 text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--wl-accent)] ${
                color?.toLowerCase() === preset.hex ? "border-black dark:border-white" : "border-transparent"
              }`}
            >
              <span className="h-8 w-8 rounded-full" style={{ backgroundColor: preset.hex }} aria-hidden />
              <span className="max-w-[4.5rem] text-[10px] text-black/50 dark:text-white/50">{preset.name}</span>
            </button>
          ))}
        </div>
        {colorStatus === "error" && (
          <p role="alert" className="text-xs text-red-500">
            Failed to save — try again.
          </p>
        )}

        {/* Live preview — a real chat bubble, real copy, updates
            immediately on selection (no separate "apply" step). */}
        <div className="mt-1 flex flex-col gap-1.5">
          <span className="text-xs text-black/50 dark:text-white/50">Preview</span>
          <div className="flex justify-end">
            <span
              className="chat-bubble chat-bubble--mine max-w-[85%] rounded-2xl px-3.5 py-2 text-sm"
              style={{ backgroundColor: previewHex, color: readableTextColor(previewHex) }}
            >
              This is how your messages will appear in League Chat.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
