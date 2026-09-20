"use client";

import type { WatchPartyRoom, WatchPartyRoomsResponse } from "@/lib/api";

// A small pulsing dot — real occupancy (Phase 4's is_live), not the
// static "how many could join" member_count next to it.
function LiveDot() {
  return (
    <span
      className="h-2 w-2 shrink-0 animate-pulse rounded-full"
      style={{ background: "var(--wl-live)" }}
      role="img"
      aria-label="Live now"
      title="Live now"
    />
  );
}

// Compact entry point rendered above the conversation list — "join the
// video" is a lighter-weight action than opening a thread, so this is
// a slot ConversationList renders, not a conversation row itself (a
// Watch Party room isn't a conversation_id in this list's own data).
export function WatchPartyBar({
  rooms,
  myOwnerId,
  onJoin,
  onStartParty,
  onManage,
}: {
  rooms: WatchPartyRoomsResponse | null;
  myOwnerId: number;
  onJoin: (room: WatchPartyRoom) => void;
  onStartParty: () => void;
  // Only offered for a private room this owner created — the league
  // commissioner can also manage any private room server-side (see
  // backend's remove_room_member), just not from this entry point yet.
  onManage: (room: WatchPartyRoom) => void;
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
          <span className="flex items-center gap-1.5 truncate text-sm font-semibold" style={{ color: "var(--wl-text)" }}>
            League Lounge
            {rooms.open_room.is_live && <LiveDot />}
          </span>
          <span className="truncate text-xs" style={{ color: "var(--wl-text-secondary)" }}>
            {rooms.open_room.is_live ? "Someone's in the room now" : `${rooms.open_room.member_count} in your league · always open`}
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
        <div key={r.id} className="flex items-center gap-1">
          <button
            onClick={() => onJoin(r)}
            className="flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
          >
            <span className="text-sm" aria-hidden>
              🔒
            </span>
            <span className="truncate text-sm font-medium" style={{ color: "var(--wl-text)" }}>
              {r.name}
            </span>
            {r.is_live && <LiveDot />}
            <span className="ml-auto shrink-0 text-xs" style={{ color: "var(--wl-text-secondary)" }}>
              {r.member_count}
            </span>
          </button>
          {r.created_by_owner_id === myOwnerId && (
            <button
              onClick={() => onManage(r)}
              aria-label={`Manage ${r.name}`}
              className="shrink-0 rounded-full p-1.5 text-black/40 hover:bg-black/5 dark:text-white/40 dark:hover:bg-white/10"
            >
              ⚙
            </button>
          )}
        </div>
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
