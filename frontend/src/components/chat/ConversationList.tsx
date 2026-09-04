"use client";

import type { CSSProperties } from "react";
import type { ChatAvatar, ChatConversation } from "@/lib/api";
import { formatConversationListTimestamp } from "@/lib/chatFormat";
import { initialsFor, readableTextColor } from "@/components/chat/MessageBubble";

function Avatar({
  name,
  color,
  logoUrl,
  className,
  style,
}: {
  name: string;
  color: string | null;
  logoUrl: string | null;
  className: string;
  style?: CSSProperties;
}) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Blob URL, not a static/known-at-build-time asset next/image can optimize
    return <img src={logoUrl} alt="" aria-hidden className={`${className} object-cover`} style={style} />;
  }
  const bg = color ?? "#6b7280";
  return (
    <span
      className={`${className} flex items-center justify-center font-semibold`}
      style={{ backgroundColor: bg, color: readableTextColor(bg), ...style }}
      aria-hidden
    >
      {initialsFor(name)}
    </span>
  );
}

// Fixed fan-out offsets for up to 3 cluster members, top-left origin —
// later entries stack toward the bottom-right and sit on top, the same
// overlapping-circles shape the reference screenshots' group threads use.
const CLUSTER_OFFSETS = [
  { top: 0, left: 0, zIndex: 1 },
  { top: 6, left: 6, zIndex: 2 },
  { top: 12, left: 12, zIndex: 3 },
];

// A direct conversation gets one 36px avatar; the league and
// commish_corner conversations have no single "other person" to show,
// so they get a small overlapping cluster of up to 3 participants
// instead (matching the reference screenshots' group-thread treatment).
function ConversationAvatar({ conversation }: { conversation: ChatConversation }) {
  if (conversation.avatar_group) {
    const shown = conversation.avatar_group.slice(0, 3);
    return (
      <div className="relative h-[2.6rem] w-[2.6rem] shrink-0">
        {shown.map((m: ChatAvatar, i) => (
          <Avatar
            key={m.owner_id}
            name={m.display_name}
            color={m.chat_color}
            logoUrl={m.logo_url}
            className="absolute h-6 w-6 rounded-full text-[9px] ring-2 ring-white dark:ring-neutral-950"
            style={CLUSTER_OFFSETS[i]}
          />
        ))}
      </div>
    );
  }
  return (
    <Avatar
      name={conversation.other_owner_name ?? "?"}
      color={conversation.other_owner_chat_color}
      logoUrl={conversation.other_owner_logo_url}
      className="h-9 w-9 shrink-0 rounded-full text-xs"
    />
  );
}

export function ConversationList({
  conversations,
  selectedId,
  messagePreviewsEnabled,
  onSelect,
  onNewMessage,
}: {
  conversations: ChatConversation[];
  selectedId: number | null;
  // Settings > Chat > Message Previews — the viewer's own choice for
  // their own list, no one else is affected by it.
  messagePreviewsEnabled: boolean;
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
            const isGroup = c.type === "league" || c.type === "commish_corner";
            const title =
              c.type === "league" ? "Weekend League" : c.type === "commish_corner" ? "Commish's Corner" : (c.other_owner_name ?? "Direct Message");
            const subtitle = isGroup
              ? `${c.member_count} managers`
              : c.last_message && messagePreviewsEnabled
                ? c.last_message.body
                : "";
            const preview =
              c.last_message && messagePreviewsEnabled
                ? `${c.last_message.owner_name}: ${c.last_message.body}`
                : c.last_message
                  ? "New message"
                  : subtitle;

            return (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={`flex w-full items-center justify-between gap-2.5 px-4 py-3 text-left transition-colors ${
                    selectedId === c.id ? "bg-black/[0.04] dark:bg-white/[0.06]" : "hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
                  }`}
                >
                  <ConversationAvatar conversation={c} />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5">
                      {c.type === "league" && <span aria-hidden>🏈</span>}
                      {c.type === "commish_corner" && <span aria-hidden>📢</span>}
                      <span className={`truncate ${c.unread_count > 0 ? "font-semibold" : "font-medium"}`}>{title}</span>
                    </span>
                    <span
                      className={`truncate text-sm ${
                        c.unread_count > 0 ? "text-black/80 dark:text-white/80" : "text-black/50 dark:text-white/50"
                      }`}
                    >
                      {isGroup && c.last_message ? preview : isGroup ? subtitle : preview || "No messages yet"}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {c.last_message && (
                      <span className="text-xs text-black/50 dark:text-white/50">
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
