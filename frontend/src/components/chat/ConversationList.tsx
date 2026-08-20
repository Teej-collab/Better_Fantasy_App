"use client";

import type { ChatConversation } from "@/lib/api";
import { formatConversationListTimestamp } from "@/lib/chatFormat";

export function ConversationList({
  conversations,
  selectedId,
  onSelect,
  onNewMessage,
}: {
  conversations: ChatConversation[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onNewMessage: () => void;
}) {
  return (
    <div className="flex h-full w-full flex-col sm:w-80 sm:shrink-0 sm:border-r sm:border-black/10 sm:dark:border-white/10">
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
        <h1 className="text-lg font-semibold">Messages</h1>
        <button
          onClick={onNewMessage}
          aria-label="New message"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] text-lg text-white transition-transform active:scale-90"
        >
          +
        </button>
      </div>

      {conversations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="font-medium">No conversations yet.</p>
          <p className="text-sm text-black/50 dark:text-white/50">Start talking some trash.</p>
          <button
            onClick={onNewMessage}
            className="rounded-full bg-[var(--wl-accent-dim)] px-4 py-2 text-sm font-medium text-white"
          >
            + New Message
          </button>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-black/5 overflow-y-auto dark:divide-white/5">
          {conversations.map((c) => {
            const title = c.type === "league" ? "Weekend League" : (c.other_owner_name ?? "Direct Message");
            const subtitle =
              c.type === "league" ? `${c.member_count} managers` : c.last_message ? c.last_message.body : "";
            const preview = c.last_message ? `${c.last_message.owner_name}: ${c.last_message.body}` : subtitle;

            return (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={`flex w-full items-start justify-between gap-2 px-4 py-3 text-left transition-colors ${
                    selectedId === c.id ? "bg-black/[0.04] dark:bg-white/[0.06]" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      {c.type === "league" && <span aria-hidden>🏈</span>}
                      <span className={`truncate ${c.unread_count > 0 ? "font-semibold" : "font-medium"}`}>{title}</span>
                    </span>
                    <span
                      className={`truncate text-sm ${
                        c.unread_count > 0 ? "text-black/80 dark:text-white/80" : "text-black/50 dark:text-white/50"
                      }`}
                    >
                      {c.type === "league" && c.last_message ? preview : c.type === "league" ? subtitle : preview || "No messages yet"}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {c.last_message && (
                      <span className="text-xs text-black/40 dark:text-white/40">
                        {formatConversationListTimestamp(c.last_message.created_at)}
                      </span>
                    )}
                    {c.unread_count > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--wl-accent-dim)] px-1.5 text-xs font-semibold text-white">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
