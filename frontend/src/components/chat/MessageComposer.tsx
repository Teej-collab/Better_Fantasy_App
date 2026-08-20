"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMember, ChatMessage } from "@/lib/api";

const MAX_LENGTH = 2000;
const TYPING_DEBOUNCE_MS = 2000;

export function MessageComposer({
  members,
  replyTo,
  onCancelReply,
  onSend,
  onTyping,
}: {
  members: ChatMember[];
  replyTo: ChatMessage | null;
  onCancelReply: () => void;
  onSend: (body: string, mentions: number[]) => void;
  onTyping: () => void;
}) {
  const [value, setValue] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [pendingMentions, setPendingMentions] = useState<Map<string, number>>(new Map());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingSentAt = useRef(0);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  const filteredMembers =
    mentionQuery === null
      ? []
      : members.filter((m) => m.display_name.toLowerCase().startsWith(mentionQuery.toLowerCase())).slice(0, 6);

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    setValue(text);

    const now = Date.now();
    if (now - lastTypingSentAt.current > TYPING_DEBOUNCE_MS) {
      lastTypingSentAt.current = now;
      onTyping();
    }

    const cursor = e.target.selectionStart ?? text.length;
    const beforeCursor = text.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@(\w*)$/);
    setMentionQuery(match ? match[1] : null);
  }

  function selectMention(member: ChatMember) {
    const cursor = inputRef.current?.selectionStart ?? value.length;
    const beforeCursor = value.slice(0, cursor);
    const afterCursor = value.slice(cursor);
    const replaced = beforeCursor.replace(/@(\w*)$/, `@${member.display_name} `);
    setValue(replaced + afterCursor);
    setPendingMentions((prev) => new Map(prev).set(member.display_name, member.owner_id));
    setMentionQuery(null);
    inputRef.current?.focus();
  }

  function send() {
    const body = value.trim();
    if (!body) return;
    const mentions = [...pendingMentions.entries()]
      .filter(([name]) => body.includes(`@${name}`))
      .map(([, id]) => id);
    onSend(body, mentions);
    setValue("");
    setPendingMentions(new Map());
    setMentionQuery(null);
  }

  return (
    <div className="relative border-t border-black/10 bg-[var(--background)] p-3 dark:border-white/10">
      {replyTo && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-black/[0.04] px-3 py-1.5 text-xs dark:bg-white/[0.06]">
          <span className="truncate text-black/60 dark:text-white/60">
            Replying to <span className="font-medium">{replyTo.owner_name}</span> — {replyTo.body}
          </span>
          <button
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="shrink-0 text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70"
          >
            ✕
          </button>
        </div>
      )}

      {filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-3 mb-1 flex w-56 flex-col overflow-hidden rounded-lg border border-black/10 bg-white shadow-lg dark:border-white/10 dark:bg-neutral-900">
          {filteredMembers.map((m) => (
            <button
              key={m.owner_id}
              onClick={() => selectMention(m)}
              className="flex flex-col px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              <span className="font-medium">{m.display_name}</span>
              <span className="text-xs text-black/50 dark:text-white/50">{m.team_name}</span>
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          ref={inputRef}
          value={value}
          onChange={handleChange}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Message..."
          maxLength={MAX_LENGTH}
          rows={1}
          aria-label="Message"
          className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
        />
        <button
          type="submit"
          disabled={!value.trim()}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] text-white transition-transform active:scale-90 disabled:opacity-30"
        >
          ➤
        </button>
      </form>
    </div>
  );
}
