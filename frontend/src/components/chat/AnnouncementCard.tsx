"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  getAnnouncementReceipts,
  recordAnnouncementLinkOpen,
  type AnnouncementReceipts,
  type ChatMessage,
} from "@/lib/api";
import { REACTION_CHOICES } from "@/components/chat/MessageBubble";
import { formatMessageTimestamp } from "@/lib/chatFormat";
import { SECTION_COLORS, panelGlowStyle } from "@/lib/sectionColors";
import { isHexColor, MULTI, MULTI_COLORS } from "@/components/settings/ColorChoices";

const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]])/g;

// Links in a post are tappable, and each tap is logged (link-open) so
// the commissioner can see who actually followed it. Links back into
// this app open in place; anything else opens a new tab.
function LinkedBody({ text, messageId }: { text: string; messageId: number }) {
  const router = useRouter();
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0];
    const at = match.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <a
        key={at}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-sky-600 underline underline-offset-2 dark:text-sky-400"
        onClick={(e) => {
          e.stopPropagation();
          recordAnnouncementLinkOpen(messageId, url);
          try {
            const target = new URL(url);
            if (target.host === window.location.host) {
              e.preventDefault();
              router.push(`${target.pathname}${target.search}${target.hash}`);
            }
          } catch {
            // Not a parseable URL — let the browser handle it.
          }
        }}
      >
        {url}
      </a>,
    );
    last = at + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

// "Seen by 7 of 11 · 4 opened the link" under a Commish Corner post,
// for the commissioner and the poster — tap for names (2026-10).
function ReceiptsLine({ messageId }: { messageId: number }) {
  const [data, setData] = useState<AnnouncementReceipts | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAnnouncementReceipts(messageId).then((r) => {
      if (!cancelled) setData(r);
    });
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  if (!data) return null;
  const summary = [
    `Seen by ${data.seen.length} of ${data.total}`,
    data.has_link ? `${data.opened.length} opened the link` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-1.5 text-xs text-black/50 dark:text-white/50">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex w-fit items-center gap-1 font-medium hover:text-black/70 dark:hover:text-white/70"
      >
        👁 {summary} <span aria-hidden>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 rounded-lg bg-black/[0.03] p-2.5 dark:bg-white/[0.04]">
          {data.has_link && (
            <p>
              <b>Opened:</b> {data.opened.length ? data.opened.map((p) => p.name).join(", ") : "nobody yet"}
            </p>
          )}
          <p>
            <b>Seen:</b> {data.seen.length ? data.seen.map((p) => p.name).join(", ") : "nobody yet"}
          </p>
          {data.not_seen.length > 0 && (
            <p>
              <b>Not yet:</b> {data.not_seen.map((p) => p.name).join(", ")}
            </p>
          )}
          {data.receipts_off > 0 && (
            <p>
              {data.receipts_off} {data.receipts_off === 1 ? "member has" : "members have"} read receipts off
            </p>
          )}
        </div>
      )}
    </div>
  );
}

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
  canSeeReceipts = false,
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
  // The league's commissioner (Commish Corner's can_post); the poster
  // always sees their own post's receipts.
  canSeeReceipts?: boolean;
  onToggle: () => void;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
}) {
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [openEmoji, setOpenEmoji] = useState<string | null>(null);
  const reactionsRef = useRef<HTMLDivElement>(null);
  // A single color is needed here; Multi uses its first.
  const accent = isHexColor(message.owner_chat_color) ? message.owner_chat_color : message.owner_chat_color === MULTI ? MULTI_COLORS[0] : SECTION_COLORS.chat;

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
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex cursor-pointer flex-col gap-1 text-left active:scale-[0.99]"
      >
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
          {expanded && !message.deleted ? <LinkedBody text={message.body ?? ""} messageId={message.id} /> : previewBody}
        </span>
        <span className="text-xs text-black/40 dark:text-white/40">
          {message.owner_name} · {formatMessageTimestamp(message.created_at)}
        </span>
      </div>

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
            <img src={message.image_url} alt="Image attached to announcement" className="h-auto max-h-72 w-auto max-w-full rounded-xl" />
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

          {mine || canSeeReceipts ? (
            <ReceiptsLine messageId={message.id} />
          ) : (
            message.seen_by.length > 0 && (
              <p className="text-xs text-black/40 dark:text-white/40">Seen by {message.seen_by.join(", ")}</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
