"use client";

import { useEffect, useState } from "react";
import {
  getWatchPartyRoomMembers,
  removeWatchPartyRoomMember,
  type WatchPartyRoom,
  type WatchPartyRoomMember,
} from "@/lib/api";

// Same modal shell as NewPartyModal.tsx/NewMessageModal.tsx. Only ever
// offered to a private room's own creator from WatchPartyBar — the
// backend also allows the league commissioner to remove someone from
// ANY private room, but there's no dedicated entry point into this
// modal for a commissioner managing someone else's party yet.
export function ManagePartyModal({ room, myOwnerId, onClose }: { room: WatchPartyRoom; myOwnerId: number; onClose: () => void }) {
  const [members, setMembers] = useState<WatchPartyRoomMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getWatchPartyRoomMembers(room.id)
      .then((data) => {
        if (!cancelled) setMembers(data.members);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't load members.");
      });
    return () => {
      cancelled = true;
    };
  }, [room.id]);

  async function remove(ownerId: number) {
    setRemovingId(ownerId);
    try {
      await removeWatchPartyRoomMember(room.id, ownerId);
      setMembers((prev) => prev?.filter((m) => m.owner_id !== ownerId) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't remove that person.");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 pt-20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-black/10 bg-[var(--background)] p-4 shadow-xl dark:border-white/10"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Manage &quot;{room.name}&quot;</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            ✕
          </button>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        {members === null && !error && <p className="py-4 text-center text-sm text-black/50 dark:text-white/50">Loading…</p>}

        {members && (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {members.map((m) => (
              <li key={m.owner_id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-semibold dark:bg-white/10">
                  {m.display_name.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex-1 truncate text-sm font-medium">
                  {m.display_name}
                  {m.owner_id === room.created_by_owner_id && (
                    <span className="ml-1.5 text-xs font-normal text-black/40 dark:text-white/40">Host</span>
                  )}
                </span>
                {m.owner_id !== room.created_by_owner_id && m.owner_id !== myOwnerId && (
                  <button
                    onClick={() => remove(m.owner_id)}
                    disabled={removingId === m.owner_id}
                    className="rounded-full border border-black/10 px-2.5 py-1 text-xs font-medium text-black/60 hover:bg-red-500/10 hover:text-red-500 disabled:opacity-40 dark:border-white/10 dark:text-white/60"
                  >
                    {removingId === m.owner_id ? "Removing…" : "Remove"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
