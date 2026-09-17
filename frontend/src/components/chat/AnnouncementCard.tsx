"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/api";
import { REACTION_CHOICES } from "@/components/chat/MessageBubble";
import { formatMessageTimestamp } from "@/lib/chatFormat";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";

// Commish's Corner reads as a feed of tappable announcement cards
// (matching History's own card list — see app/(app)/history/page.tsx)
// rather than a chat bubble stream: a commissioner's post is closer to
// a short article than a text message, and this is meant to feel like
// tapping into one. Collapsed state shows the headline + a preview;
// tapping expands the full body, reactions, and (for the owner) delete
// in place, closer to how a feed-style app handles this than a
// separate detail screen.
export function AnnouncementCard({
  message,
  mine,
  expanded,
  beta = false,
  onToggle,
  onReact,
  onDelete,
}: {
  message: ChatMessage;
  mine: boolean;
  expanded: boolean;
  // Settings > Labs > "Try the new look" — see ChatApp.tsx. Each card
  // in the feed carried its own glow ring, multiplying with feed
  // length; flat under beta, same as the rest of Chat.
  beta?: boolean;
  onToggle: () => void;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
}) {
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [openEmoji, setOpenEmoji] = useState<string | null>(null);
  const reactionsRef = useRef<HTMLDivElement>(null);
  const accent = message.owner_chat_color ?? SECTION_COLORS.chat;

  useEffect(() => {
    if (!openEmoji) return;
    function handlePointerDown(e: MouseEvent) {
      if (!reactionsRef.current?.contains(e.target as Node)) setOpenEmoji(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [openEmoji]);
  const previewBody = message.deleted
    ? "This announcement was deleted."
    : message.body || (message.image_url ? "📷 Photo" : "");

  return (
    <div
      className={
        beta
          ? "wl-card flex flex-col gap-1.5 rounded-xl p-4 transition-colors"
          : "neon-panel flex flex-col gap-1.5 rounded-xl bg-black/[0.015] p-4 transition-all dark:bg-white/[0.03]"
      }
      style={beta ? undefined : panelGlowStyle(accent)}
    >
      <button onClick={onToggle} className="flex flex-col gap-1 text-left active:scale-[0.99]">
        <span className="flex items-center gap-1.5 font-medium">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: accent, boxShadow: `0 0 5px ${accent}` }}
            aria-hidden
          />
          {message.deleted ? <span className="italic text-black/50 dark:text-white/50">Deleted</span> : message.title}
        </span>
        <span
          className={`text-sm text-black/60 dark:text-white/60 break-words ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}
        >
          {expanded && !message.deleted ? message.body : previewBody}
        </span>
        <span className="text-xs text-black/40 dark:text-white/40">
          {message.owner_name} · {formatMessageTimestamp(message.created_at)}
        </span>
      </button>

      {!message.deleted && message.reactions.length > 0 && (
        // Visible whether or not the card is expanded — real request:
        // see reactions "at the bottom of the messages... without
        // opening them". Tapping a pill shows who left it rather than
        // toggling your own (that still works via the 🙂 picker below,
        // only reachable once expanded — same as MessageBubble.tsx's
        // identical reaction-badge pattern in ordinary chat threads).
        <div ref={reactionsRef} className="mt-0.5 flex flex-wrap items-center gap-1.5">
          {message.reactions.map((r) => (
            <span key={r.emoji} className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenEmoji((cur) => (cur === r.emoji ? null : r.emoji));
                }}
                className={`rounded-full border px-1.5 py-0.5 text-xs ${
                  r.reacted_by_me
                    ? "border-sky-500/50 bg-sky-500/10"
                    : "border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]"
                }`}
              >
                {r.emoji} {r.count}
              </button>
              {openEmoji === r.emoji && (
                <div
                  className="absolute top-full left-0 z-20 mt-1 w-max max-w-[200px] rounded-lg border border-black/10 bg-white px-2 py-1 text-xs whitespace-normal text-black/70 shadow-lg dark:border-white/10 dark:bg-neutral-900 dark:text-white/70"
                  onClick={(e) => e.stopPropagation()}
                >
                  {r.reactor_names.join(", ")}
                </div>
              )}
            </span>
          ))}
        </div>
      )}

      {expanded && !message.deleted && (
        <div className="mt-1 flex flex-col gap-2">
          {message.image_url && (
            // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Blob URL, not a static/known-at-build-time asset next/image can optimize
            <img src={message.image_url} alt="" className="h-auto max-h-72 w-auto max-w-full rounded-xl" />
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowReactionPicker((v) => !v);
              }}
              aria-label="React"
              className="rounded-full p-1 text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
            >
              🙂
            </button>
            {mine && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(message.id);
                }}
                aria-label="Delete announcement"
                className="ml-auto rounded-full p-1 text-black/50 hover:bg-red-500/10 hover:text-red-500 dark:text-white/50"
              >
                🗑
              </button>
            )}
          </div>

          {showReactionPicker && (
            <div className="flex w-fit gap-1 rounded-full border border-black/10 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-neutral-900">
              {REACTION_CHOICES.map((emoji) => (
                <button
                  key={emoji}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReact(message.id, emoji);
                    setShowReactionPicker(false);
                  }}
                  className="rounded-full p-1 text-base hover:bg-black/5 dark:hover:bg-white/10"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}

          {message.seen_by.length > 0 && (
            <p className="text-xs text-black/40 dark:text-white/40">Seen by {message.seen_by.join(", ")}</p>
          )}
        </div>
      )}
    </div>
  );
}
