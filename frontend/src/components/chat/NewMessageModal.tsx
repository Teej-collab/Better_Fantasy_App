"use client";

import { useState } from "react";
import type { ChatMember } from "@/lib/api";

export function NewMessageModal({
  members,
  onClose,
  onSelect,
}: {
  members: ChatMember[];
  onClose: () => void;
  onSelect: (ownerId: number) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = members.filter((m) => m.display_name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 pt-20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-black/10 bg-[var(--background)] p-4 shadow-xl dark:border-white/10"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">New Message</h2>
          <button onClick={onClose} aria-label="Close" className="text-black/40 hover:text-black/70 dark:text-white/40 dark:hover:text-white/70">
            ✕
          </button>
        </div>

        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search league members..."
          className="rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
        />

        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {filtered.map((m) => (
            <li key={m.owner_id}>
              <button
                onClick={() => onSelect(m.owner_id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-semibold dark:bg-white/10">
                  {m.display_name.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-medium">{m.display_name}</span>
                  <span className="truncate text-xs text-black/50 dark:text-white/50">{m.team_name}</span>
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && <p className="px-2 py-4 text-center text-sm text-black/40 dark:text-white/40">No members found.</p>}
        </ul>
      </div>
    </div>
  );
}
