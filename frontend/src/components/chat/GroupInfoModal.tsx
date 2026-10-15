"use client";

import { useEffect, useState } from "react";
import {
  addChatParticipants,
  deleteConversation,
  getConversationMembers,
  renameGroupChat,
  type ChatAvatar,
  type ChatConversation,
  type ChatMember,
} from "@/lib/api";
import { canDeleteConversation, conversationTitle } from "@/lib/chatFormat";
import { chatColorStyle, initialsFor, readableTextColor } from "@/components/chat/MessageBubble";
import { NewMessageModal } from "@/components/chat/NewMessageModal";

// The iMessage-style "who's in this chat" screen — a group conversation
// (league/commish_corner) only ever showed a small overlapping avatar
// cluster in the list, with no way to actually see who those people
// were. Fetches the real full roster (not the 3-avatar preview cluster
// ChatConversation.avatar_group already carries) the moment it opens.
// Group chats (2026-10) also get their name, Add People, and Delete
// Chat here; a DM gets Delete Chat.
export function GroupInfoModal({
  conversation,
  leagueMembers = [],
  onClose,
  onChanged,
  onDeleted,
}: {
  conversation: ChatConversation;
  leagueMembers?: ChatMember[];
  onClose: () => void;
  onChanged?: () => void;
  onDeleted?: () => void;
}) {
  const [members, setMembers] = useState<ChatAvatar[] | null>(null);
  const [name, setName] = useState(conversation.name ?? "");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isGroup = conversation.type === "group";
  const nameChanged = name.trim() !== (conversation.name ?? "");

  async function saveName() {
    if (!nameChanged) return;
    try {
      await renameGroupChat(conversation.id, name.trim());
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't rename the group.");
    }
  }

  async function remove() {
    if (!confirm(`Delete ${conversationTitle(conversation)}? It's removed from your chats with its messages. Everyone else keeps theirs, and a new message brings it back.`)) return;
    try {
      await deleteConversation(conversation.id);
      onDeleted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete that chat.");
    }
  }

  useEffect(() => {
    let cancelled = false;
    getConversationMembers(conversation.id).then((result) => {
      if (!cancelled) setMembers(result);
    });
    return () => {
      cancelled = true;
    };
  }, [conversation.id]);

  const title = conversationTitle(conversation);

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 pt-20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-black/10 bg-[var(--background)] p-4 shadow-xl dark:border-white/10"
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="text-lg font-semibold">{title}</h2>
            <span className="text-xs text-black/50 dark:text-white/50">
              {members ? `${members.length} ${isGroup ? "people" : members.length === 1 ? "manager" : "managers"}` : "Loading…"}
            </span>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            ✕
          </button>
        </div>

        {isGroup && (
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void saveName()}
              placeholder="Name this group"
              aria-label="Group name"
              maxLength={60}
              className="min-w-0 flex-1 rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
            />
            {nameChanged && (
              <button
                onClick={() => void saveName()}
                className="rounded-full px-4 text-sm font-bold"
                style={{ background: "var(--wl-accent)", color: "#06110a" }}
              >
                Save
              </button>
            )}
          </div>
        )}

        <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
          {members === null ? (
            <p className="py-4 text-center text-sm text-black/50 dark:text-white/50">Loading…</p>
          ) : (
            members.map((m) => (
              <div key={m.owner_id} className="flex items-center gap-3 rounded-lg px-2 py-1.5">
                {m.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a user-uploaded Blob URL, not a static/known-at-build-time asset next/image can optimize
                  <img src={m.logo_url} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
                ) : (
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                    style={chatColorStyle(m.chat_color) ?? { backgroundColor: "#6b7280", color: readableTextColor("#6b7280") }}
                  >
                    {initialsFor(m.display_name)}
                  </span>
                )}
                <span className="text-sm font-medium">{m.display_name}</span>
              </div>
            ))
          )}
        </div>

        {isGroup && (
          <button
            onClick={() => setAdding(true)}
            className="min-h-10 rounded-full border text-sm font-semibold"
            style={{ borderColor: "var(--wl-accent)", color: "var(--wl-accent)" }}
          >
            + Add people
          </button>
        )}
        {canDeleteConversation(conversation) && (
          <button onClick={() => void remove()} className="min-h-10 rounded-full border border-red-400 text-sm font-semibold text-red-400">
            Delete chat
          </button>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      {adding && (
        // Its own backdrop click shouldn't also close this modal.
        <div onClick={(e) => e.stopPropagation()}>
        <NewMessageModal
          title="Add People"
          members={leagueMembers}
          excludeIds={(members ?? []).map((m) => m.owner_id)}
          onClose={() => setAdding(false)}
          onSelect={async (ids) => {
            setMembers(await addChatParticipants(conversation.id, ids));
            setAdding(false);
            onChanged?.();
          }}
        />
        </div>
      )}
    </div>
  );
}
