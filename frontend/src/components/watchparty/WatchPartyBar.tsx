"use client";

import type { WatchPartyRoom, WatchPartyRoomsResponse } from "@/lib/api";

// Compact entry point rendered above the conversation list — "join the
// video" is a lighter-weight action than opening a thread, so this is
// a slot ConversationList renders, not a conversation row itself (a
// Watch Party room isn't a conversation_id in this list's own data).
export function WatchPartyBar({
  rooms,
  onJoin,
  onStartParty,
}: {
  rooms: WatchPartyRoomsResponse | null;
  onJoin: (room: WatchPartyRoom) => void;
  onStartParty: () => void;
}) {
  if (!rooms) return null;

  return (
    <div className="flex flex-col gap-1 border-b px-2 py-2.5" style={{ borderColor: "var(--wl-border)" }}>
      <button
        onClick={() => onJoin(rooms.open_room)}
        className="flex items-center gap-2.5 rounded-xl px-2 py-2 text-left"
        style={{ background: "var(--wl-surface)" }}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
          style={{ background: "color-mix(in srgb, var(--wl-live) 18%, transparent)" }}
          aria-hidden
        >
          🎥
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold" style={{ color: "var(--wl-text)" }}>
            League Lounge
          </span>
          <span className="truncate text-xs" style={{ color: "var(--wl-text-secondary)" }}>
            {rooms.open_room.member_count} in your league · always open
          </span>
        </span>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ background: "var(--wl-accent)", color: "#06110a" }}
        >
          Join
        </span>
      </button>

      {rooms.private_rooms.map((r) => (
        <button
          key={r.id}
          onClick={() => onJoin(r)}
          className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
        >
          <span className="text-sm" aria-hidden>
            🔒
          </span>
          <span className="truncate text-sm font-medium" style={{ color: "var(--wl-text)" }}>
            {r.name}
          </span>
          <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--wl-text-secondary)" }}>
            {r.member_count}
          </span>
        </button>
      ))}

      <button
        onClick={onStartParty}
        className="rounded-lg px-2 py-1.5 text-left text-xs font-semibold"
        style={{ color: "var(--wl-accent)" }}
      >
        + Start a Party
      </button>
    </div>
  );
}
