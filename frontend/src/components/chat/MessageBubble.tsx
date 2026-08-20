"use client";

import { useState } from "react";
import type { ChatMessage } from "@/lib/api";
import { formatMessageTimestamp } from "@/lib/chatFormat";

const REACTION_CHOICES = ["😂", "🔥", "💀", "👍", "❤️", "😭"];

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  memberNames,
  onReply,
  onReact,
  onDelete,
  onScrollToMessage,
}: {
  message: ChatMessage;
  mine: boolean;
  grouped: boolean;
  memberNames: Record<number, string>;
  onReply: (message: ChatMessage) => void;
  onReact: (messageId: number, emoji: string) => void;
  onDelete: (messageId: number) => void;
  onScrollToMessage: (messageId: number) => void;
}) {
  const [showActions, setShowActions] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const mentionedNames = message.mentions.map((id) => memberNames[id]).filter(Boolean) as string[];

  return (
    <div
      id={`chat-message-${message.id}`}
      className={`group flex flex-col ${mine ? "items-end" : "items-start"} ${grouped ? "mt-0.5" : "mt-3"}`}
      onClick={() => setShowActions((v) => !v)}
    >
      {!grouped && (
        <span className="mb-0.5 px-1 text-xs text-black/40 dark:text-white/40">
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

        <div className="flex flex-col gap-1">
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

          <span
            className={`chat-bubble rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap ${
              message.deleted
                ? "italic text-black/40 dark:text-white/40"
                : mine
                  ? "chat-bubble--mine"
                  : "chat-bubble--other"
            }`}
          >
            {message.deleted ? message.body : renderBodyWithMentions(message.body, mentionedNames)}
          </span>

          {message.reactions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {message.reactions.map((r) => (
                <button
                  key={r.emoji}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReact(message.id, r.emoji);
                  }}
                  className={`rounded-full border px-1.5 py-0.5 text-xs ${
                    r.reacted_by_me
                      ? "border-sky-500/50 bg-sky-500/10"
                      : "border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]"
                  }`}
                >
                  {r.emoji} {r.count}
                </button>
              ))}
            </div>
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
        className="rounded-full p-1.5 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
      >
        🙂
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onReply();
        }}
        title="Reply"
        className="rounded-full p-1.5 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
      >
        ↩
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCopy();
        }}
        title="Copy"
        className="rounded-full p-1.5 text-black/40 hover:bg-black/5 hover:text-black/70 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/70"
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
          className="rounded-full p-1.5 text-black/40 hover:bg-red-500/10 hover:text-red-500 dark:text-white/40"
        >
          🗑
        </button>
      )}
    </div>
  );
}
