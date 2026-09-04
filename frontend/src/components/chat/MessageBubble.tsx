"use client";

import Image from "next/image";
import { useState } from "react";
import type { ChatMessage, ChatReaction } from "@/lib/api";
import { formatMessageTimestamp } from "@/lib/chatFormat";

const REACTION_CHOICES = ["😂", "🔥", "💀", "👍", "❤️", "😭"];

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Corner radii for one bubble in a same-sender run — full ("open") on
// the edge shared with nobody, tightened on the edge shared with a
// neighboring bubble from the same run, iMessage's own way of reading a
// burst as one connected shape instead of just closely-spaced rectangles.
// mine's outer edge is the right side (where a real tail would point);
// other's outer edge is the left.
const FULL_RADIUS = "1.15rem";
const TIGHT_RADIUS = "0.28rem";
function bubbleCorners(mine: boolean, firstInRun: boolean, lastInRun: boolean) {
  const outerTop = firstInRun ? FULL_RADIUS : TIGHT_RADIUS;
  const outerBottom = lastInRun ? FULL_RADIUS : TIGHT_RADIUS;
  return mine
    ? {
        borderTopLeftRadius: FULL_RADIUS,
        borderBottomLeftRadius: FULL_RADIUS,
        borderTopRightRadius: outerTop,
        borderBottomRightRadius: outerBottom,
      }
    : {
        borderTopRightRadius: FULL_RADIUS,
        borderBottomRightRadius: FULL_RADIUS,
        borderTopLeftRadius: outerTop,
        borderBottomLeftRadius: outerBottom,
      };
}

// A custom bubble color is a per-sender identity choice (see
// ChatSettings.tsx) — everyone sees it, not just the owner who picked
// it, so unlike .chat-bubble--mine's fixed white text, the text color
// has to adapt to whatever background an owner actually chose. Perceived
// luminance (ITU-R BT.601) is plenty accurate for "is this bubble light
// or dark," not aiming for color-managed precision.
export function readableTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#111111" : "#ffffff";
}

/** Highlights `@DisplayName` occurrences for every real mention on this
 * message — a plain string find/replace against known mentioned names,
 * not a full rich-text model. The composer already inserted the literal
 * display name into the body when the mention was chosen, so this only
 * needs to style what's already there, not reconstruct it. */
function renderBodyWithMentions(body: string, mentionedNames: string[]) {
  if (mentionedNames.length === 0) return body;
  const pattern = new RegExp(`(@(?:${mentionedNames.map(escapeRegExp).join("|")}))`, "g");
  const parts = body.split(pattern);
  return parts.map((part, i) =>
    mentionedNames.some((name) => part === `@${name}`) ? (
      <span key={i} className="chat-mention">
        {part}
      </span>
    ) : (
      part
    )
  );
}

export function MessageBubble({
  message,
  mine,
  grouped,
  groupedWithNext,
  highlightMention,
  memberNames,
  onReply,
  onReact,
  onDelete,
  onScrollToMessage,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  // Mirror of `grouped`, looking forward instead of back — is this
  // bubble followed by another from the same sender within the group
  // window? Together the two flags place a bubble as first/middle/last
  // in its run, which drives corner shaping, the tail, and the avatar.
  groupedWithNext: boolean;
  // True only when this message mentions the viewer AND they have
  // Mention Notifications on (Settings > Chat) — see MessageThread.tsx,
  // which computes both halves before passing this down.
  highlightMention: boolean;
  memberNames: Record<number, string>;
  onReply: (message: ChatMessage) => void;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
  onScrollToMessage: (messageId: number) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const mentionedNames = message.mentions.map((id) => memberNames[id]).filter(Boolean) as string[];
  const lastInRun = !groupedWithNext;
  const avatarColor = message.owner_chat_color ?? "#6b7280";

  return (
    <div
      id={`chat-message-${message.id}`}
      className={`group flex flex-col ${mine ? "items-end" : "items-start"} ${grouped ? "mt-px" : "mt-3"}`}
      onClick={() => setShowActions((v) => !v)}
    >
      {!grouped && (
        <span className="mb-0.5 px-1 text-[11px] text-black/35 dark:text-white/35">
          {mine ? "You" : message.owner_name} · {formatMessageTimestamp(message.created_at)}
        </span>
      )}

      <div className="flex max-w-[85%] items-end gap-1.5">
        {mine && (
          <MessageActions
            visible={showActions}
            mine={mine}
            deleted={message.deleted}
            onReply={() => onReply(message)}
            onToggleReactionPicker={() => setShowReactionPicker((v) => !v)}
            onCopy={() => navigator.clipboard.writeText(message.body)}
            onDelete={() => onDelete(message.id)}
          />
        )}

        {/* Avatar sits next to the last bubble of an incoming run only
            (matching iMessage's own placement — not one per bubble); a
            same-width invisible spacer keeps every other bubble in the
            run left-aligned to the same edge instead of drifting. */}
        {!mine &&
          (lastInRun ? (
            message.owner_logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Blob URL, not a static/known-at-build-time asset next/image can optimize
              <img
                src={message.owner_logo_url}
                alt=""
                aria-hidden
                className="mb-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
              />
            ) : (
              <span
                className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
                style={{ backgroundColor: avatarColor, color: readableTextColor(avatarColor) }}
                aria-hidden
              >
                {initialsFor(message.owner_name)}
              </span>
            )
          ) : (
            <span className="w-6 shrink-0" aria-hidden />
          ))}

        <div className={`flex flex-col gap-1 ${message.reactions.length > 0 ? "mb-6" : ""}`}>
          {message.reply_to && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onScrollToMessage(message.reply_to!.id);
              }}
              className="flex flex-col rounded-lg border-l-2 border-black/15 bg-black/[0.03] px-2 py-1 text-left text-xs text-black/50 hover:bg-black/5 dark:border-white/15 dark:bg-white/[0.04] dark:text-white/50 dark:hover:bg-white/10"
            >
              <span className="font-medium">{message.reply_to.owner_name}</span>
              <span className="truncate">{message.reply_to.body}</span>
            </button>
          )}

          {/* The text bubble below is the real anchor for the reactions
              badge (text or a deleted-message placeholder); an image-only
              message — no body at all — falls back to anchoring the
              badge to the image instead. Whichever one renders last
              gets its own `relative w-fit` wrapper so the badge's
              `left-0`/`right-0`/`-bottom-5` below is always relative
              to THAT element's actual rendered box, not the whole
              flex column (which used to stretch to the widest sibling
              — reply preview or image — and silently misplaced a short
              text bubble's badge halfway over its own words). */}
          {!message.deleted && message.image_url && (
            <div className="relative w-fit">
              <a href={message.image_url} target="_blank" rel="noopener noreferrer">
                <Image
                  src={message.image_url}
                  alt="Attached image"
                  width={400}
                  height={400}
                  className="h-auto max-h-72 w-auto max-w-full rounded-xl"
                />
              </a>
              {!message.body && message.reactions.length > 0 && (
                <ReactionBadge mine={mine} reactions={message.reactions} messageId={message.id} onReact={onReact} />
              )}
            </div>
          )}

          {(message.deleted || message.body) && (
            <div className="relative w-fit">
              {/* A <div>, not a <span> — the previous inline-element
                  version needed an explicit `display: inline-block`
                  override (globals.css's .chat-bubble) to get one
                  continuous box around wrapped multi-line text instead
                  of one disconnected box per line, and that override
                  measurably wasn't taking effect for a reason a static
                  read of the CSS couldn't explain. A <div> is
                  block-level by its own element default, with no CSS
                  rule required to make it behave that way — the same
                  fix, just no longer dependent on one specific
                  stylesheet rule actually reaching the page. */}
              <div
                className={`chat-bubble px-3.5 py-2 text-sm break-words whitespace-pre-wrap ${
                  message.deleted
                    ? "italic text-black/50 dark:text-white/50"
                    : mine
                      ? "chat-bubble--mine"
                      : "chat-bubble--other"
                } ${highlightMention && !message.deleted ? "chat-bubble--mentions-me" : ""}`}
                style={{
                  ...bubbleCorners(mine, !grouped, lastInRun),
                  ...(!message.deleted && message.owner_chat_color
                    ? { backgroundColor: message.owner_chat_color, color: readableTextColor(message.owner_chat_color) }
                    : undefined),
                }}
              >
                {message.deleted ? message.body : renderBodyWithMentions(message.body, mentionedNames)}
              </div>
              {message.reactions.length > 0 && (
                <ReactionBadge mine={mine} reactions={message.reactions} messageId={message.id} onReact={onReact} />
              )}
            </div>
          )}

          {/* Tap-to-reveal timestamp for a grouped bubble — its own
              header is suppressed (only the burst's first bubble shows
              one), so this is the only way to see exactly when a later
              bubble in the run was sent, matching iMessage's own
              tap-for-time behavior. Reuses the same tap that already
              reveals the reply/react/copy/delete row. */}
          {grouped && showActions && !message.deleted && (
            <span className={`px-1 text-[10px] text-black/35 dark:text-white/35 ${mine ? "text-right" : "text-left"}`}>
              {formatMessageTimestamp(message.created_at)}
            </span>
          )}

          {showReactionPicker && (
            <div className="flex gap-1 rounded-full border border-black/10 bg-white p-1 shadow-sm dark:border-white/10 dark:bg-neutral-900">
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
        </div>

        {!mine && (
          <MessageActions
            visible={showActions}
            mine={mine}
            deleted={message.deleted}
            onReply={() => onReply(message)}
            onToggleReactionPicker={() => setShowReactionPicker((v) => !v)}
            onCopy={() => navigator.clipboard.writeText(message.body)}
            onDelete={() => onDelete(message.id)}
          />
        )}
      </div>
    </div>
  );
}

// Tapback-style badge hanging off the bottom corner of whichever
// element (image or text bubble) it's attached to — the CALLER is
// responsible for wrapping that element in a `relative w-fit`
// container so this absolutely-positioned badge sizes against the
// real content box, not a stretched flex-column sibling.
//
// -bottom-5 (20px) is deliberately close to this badge's own rendered
// height (~22px: text-xs's 16px line-height + py-0.5's 4px + a 2px
// border) — the badge should hang almost entirely BELOW the bubble
// with only a couple px of clip at the very corner, not overlap
// meaningfully into the text above it (a short single-line bubble
// made that highly visible: an earlier, smaller offset here covered
// nearly half its own text). The wrapping flex column above reserves
// mb-6 (24px) whenever a message has reactions, so this hang has room
// without colliding with the next message below.
function ReactionBadge({
  mine,
  reactions,
  messageId,
  onReact,
}: {
  mine: boolean;
  reactions: ChatReaction[];
  messageId: number;
  onReact: (messageId: number, emoji: string) => void;
}) {
  return (
    <div className={`absolute -bottom-5 z-10 flex gap-0.5 ${mine ? "right-0" : "left-0"}`}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={(e) => {
            e.stopPropagation();
            onReact(messageId, r.emoji);
          }}
          className={`rounded-full border px-1.5 py-0.5 text-xs shadow-sm ${
            r.reacted_by_me
              ? "border-sky-500/50 bg-sky-500/10"
              : "border-black/10 bg-white dark:border-white/10 dark:bg-neutral-900"
          }`}
        >
          {r.emoji} {r.count}
        </button>
      ))}
    </div>
  );
}

function MessageActions({
  visible,
  mine,
  deleted,
  onReply,
  onToggleReactionPicker,
  onCopy,
  onDelete,
}: {
  visible: boolean;
  mine: boolean;
  deleted: boolean;
  onReply: () => void;
  onToggleReactionPicker: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  if (deleted) return null;
  return (
    <div
      className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
        visible ? "opacity-100" : "opacity-0 group-hover:opacity-100"
      }`}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleReactionPicker();
        }}
        title="React"
        className="rounded-full p-1.5 text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
      >
        🙂
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onReply();
        }}
        title="Reply"
        className="rounded-full p-1.5 text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
      >
        ↩
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
        title="Copy"
        className="rounded-full p-1.5 text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
      >
        📋
      </button>
      {mine && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete"
          className="rounded-full p-1.5 text-black/50 hover:bg-red-500/10 hover:text-red-500 dark:text-white/50"
        >
          🗑
        </button>
      )}
    </div>
  );
}
