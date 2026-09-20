"use client";

import type { CSSProperties, ReactNode } from "react";
import type { ChatAvatar, ChatConversation } from "@/lib/api";
import { formatConversationListTimestamp } from "@/lib/chatFormat";
import { initialsFor } from "@/components/chat/MessageBubble";
import { usePresence } from "@/components/PresenceProvider";

// Square, bordered "ID badge" avatar — the COMMS redesign's signature
// mark, replacing the old circular photo/initials avatar everywhere in
// chat (list rows, the thread header, message senders). Still shows a
// real uploaded team logo when one exists; falls back to initials on
// the same dark surface otherwise, just squared off instead of round.
function Avatar({
  name,
  logoUrl,
  className,
  style,
}: {
  name: string;
  logoUrl: string | null;
  className: string;
  style?: CSSProperties;
}) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Blob URL, not a static/known-at-build-time asset next/image can optimize
    return <img src={logoUrl} alt="" aria-hidden className={`${className} object-cover`} style={style} />;
  }
  return (
    <span
      className={`${className} font-mono flex items-center justify-center font-bold text-[color:var(--wl-text)]`}
      style={{
        background: "var(--wl-surface)",
        border: "1px solid color-mix(in srgb, var(--wl-accent) 35%, var(--wl-border))",
        ...style,
      }}
      aria-hidden
    >
      {initialsFor(name)}
    </span>
  );
}

// Fixed fan-out offsets for up to 3 cluster members, top-left origin —
// later entries stack toward the bottom-right and sit on top, the same
// overlapping shape the reference screenshots' group threads use.
const CLUSTER_OFFSETS = [
  { top: 0, left: 0, zIndex: 1 },
  { top: 6, left: 6, zIndex: 2 },
  { top: 12, left: 12, zIndex: 3 },
];

// A small "something's live here" dot on the avatar's corner — real
// presence for a direct conversation (the other owner is online right
// now), never shown for a group thread (league/commish_corner have no
// single person to report online status for, and there's no other
// real per-group "activity" signal to attach this to honestly).
function ConversationAvatar({ conversation }: { conversation: ChatConversation }) {
  const isDirect = conversation.type === "direct";
  // Hooks must run unconditionally — -1 never matches a real owner_id,
  // same harmless-always-false fallback MessageThread.tsx's own
  // otherOnline check uses for a group conversation.
  const otherOnline = usePresence(isDirect ? (conversation.other_owner_id ?? -1) : -1, false);

  if (conversation.avatar_group) {
    const shown = conversation.avatar_group.slice(0, 3);
    return (
      <div className="relative h-[2.6rem] w-[2.6rem] shrink-0">
        {shown.map((m: ChatAvatar, i) => (
          <Avatar
            key={m.owner_id}
            name={m.display_name}
            logoUrl={m.logo_url}
            className="absolute h-6 w-6 rounded-md text-[9px]"
            style={CLUSTER_OFFSETS[i]}
          />
        ))}
      </div>
    );
  }
  return (
    <span className="relative inline-flex shrink-0">
      <Avatar
        name={conversation.other_owner_name ?? "?"}
        logoUrl={conversation.other_owner_logo_url}
        className="h-10 w-10 shrink-0 rounded-lg text-xs"
      />
      {isDirect && otherOnline && (
        <span
          className="absolute -right-1 -top-1 h-3 w-3 rounded-full"
          style={{ background: "var(--wl-accent)", boxShadow: "0 0 0 2px var(--wl-bg)" }}
          role="img"
          aria-label="Online now"
          title="Online now"
        />
      )}
    </span>
  );
}

function ConversationRow({
  conversation,
  selected,
  messagePreviewsEnabled,
  onSelect,
}: {
  conversation: ChatConversation;
  selected: boolean;
  messagePreviewsEnabled: boolean;
  onSelect: (id: number) => void;
}) {
  const c = conversation;
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
    <li className="border-b" style={{ borderColor: "var(--wl-border)" }}>
      <button
        onClick={() => onSelect(c.id)}
        className="flex w-full items-center justify-between gap-3 border-l-2 px-4 py-3 text-left transition-colors"
        style={{
          borderLeftColor: selected ? "var(--wl-accent)" : "transparent",
          background: selected ? "color-mix(in srgb, var(--wl-accent) 7%, var(--wl-surface))" : "transparent",
        }}
      >
        <ConversationAvatar conversation={c} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            {c.type === "league" && <span aria-hidden>🏈</span>}
            {c.type === "commish_corner" && <span aria-hidden>📢</span>}
            <span
              className="truncate font-display font-semibold"
              style={{ color: "var(--wl-text)" }}
            >
              {title}
            </span>
          </span>
          <span
            className="truncate text-sm"
            style={{ color: c.unread_count > 0 ? "var(--wl-text)" : "var(--wl-text-secondary)" }}
          >
            {isGroup && c.last_message ? preview : isGroup ? subtitle : preview || "No messages yet"}
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {c.last_message && (
            <span className="font-mono text-[11px]" style={{ color: "var(--wl-text-secondary)" }}>
              {formatConversationListTimestamp(c.last_message.created_at)}
            </span>
          )}
          {c.unread_count > 0 && (
            <span
              className="flex h-5 min-w-5 items-center justify-center rounded px-1.5 font-mono text-xs font-bold"
              style={{ background: "var(--wl-accent)", color: "#06110a" }}
            >
              {c.unread_count}
            </span>
          )}
        </div>
      </button>
    </li>
  );
}

export function ConversationList({
  conversations,
  selectedId,
  messagePreviewsEnabled,
  onSelect,
  onNewMessage,
  topSlot,
}: {
  conversations: ChatConversation[];
  selectedId: number | null;
  // Settings > Chat > Message Previews — the viewer's own choice for
  // their own list, no one else is affected by it.
  messagePreviewsEnabled: boolean;
  onSelect: (id: number) => void;
  onNewMessage: () => void;
  // Watch Party's join/create bar (ChatApp.tsx owns the actual data
  // and handlers — this list only renders whatever it's handed, same
  // reasoning as any other slot prop) — optional so nothing changes
  // for a caller that doesn't pass one.
  topSlot?: ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col sm:w-80 sm:shrink-0 sm:border-r" style={{ borderColor: "var(--wl-border)" }}>
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--wl-border)" }}>
        <h1 className="flex items-center gap-2 font-mono text-xs font-semibold tracking-[0.2em] uppercase" style={{ color: "var(--wl-accent)" }}>
          {/* Two labels, one per breakpoint — the compact desktop rail
              reads "COMMS," the dedicated mobile screen reads
              "MESSAGES" in full, matching the Figma reference exactly
              rather than picking one for both. */}
          <span className="hidden sm:inline">Comms</span>
          <span className="sm:hidden">Messages</span>
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--wl-accent)" }} aria-hidden />
        </h1>
        <button
          onClick={onNewMessage}
          aria-label="New message"
          className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform active:scale-90"
          style={{ background: "var(--wl-accent)", color: "#06110a" }}
        >
          +
        </button>
      </div>

      {topSlot}

      {conversations.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="font-medium" style={{ color: "var(--wl-text)" }}>No conversations yet.</p>
          <p className="text-sm" style={{ color: "var(--wl-text-secondary)" }}>Start talking some trash.</p>
          <button
            onClick={onNewMessage}
            className="rounded-full px-4 py-2 text-sm font-medium"
            style={{ background: "var(--wl-accent)", color: "#06110a" }}
          >
            + New Message
          </button>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain">
          {conversations.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              selected={selectedId === c.id}
              messagePreviewsEnabled={messagePreviewsEnabled}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
