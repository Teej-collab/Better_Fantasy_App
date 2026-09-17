"use client";

import { useState } from "react";
import type { ChatMember } from "@/lib/api";

// Same modal shell as NewMessageModal.tsx (search box + a scrollable
// member list) — a private Watch Party's invite list is the same
// "pick people from your league" interaction as starting a DM, just
// multi-select and paired with a name field.
export function NewPartyModal({
  members,
  onClose,
  onCreate,
}: {
  members: ChatMember[];
  onClose: () => void;
  onCreate: (name: string, invitedOwnerIds: number[]) => void;
}) {
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const filtered = members.filter((m) => m.display_name.toLowerCase().includes(query.toLowerCase()));

  function toggle(ownerId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ownerId)) next.delete(ownerId);
      else next.add(ownerId);
      return next;
    });
  }

  async function submit() {
    if (!name.trim() || selected.size === 0 || submitting) return;
    setSubmitting(true);
    try {
      await onCreate(name.trim(), Array.from(selected));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/40 px-4 pt-20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-black/10 bg-[var(--background)] p-4 shadow-xl dark:border-white/10"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Start a Party</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-full text-black/50 hover:bg-black/5 hover:text-black/70 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white/70"
          >
            ✕
          </button>
        </div>

        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Party name"
          aria-label="Party name"
          className="rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
        />

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search league members..."
          aria-label="Search league members"
          className="rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
        />

        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {filtered.map((m) => (
            <li key={m.owner_id}>
              <button
                onClick={() => toggle(m.owner_id)}
                className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
              >
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-semibold dark:bg-white/10">
                  {m.display_name.slice(0, 2).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{m.display_name}</span>
                  <span className="truncate text-xs text-black/50 dark:text-white/50">{m.team_name}</span>
                </span>
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
                    selected.has(m.owner_id)
                      ? "border-transparent bg-[var(--wl-accent)] text-[#06110a]"
                      : "border-black/20 dark:border-white/20"
                  }`}
                >
                  {selected.has(m.owner_id) && "✓"}
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-black/50 dark:text-white/50">No members found.</p>
          )}
        </ul>

        <button
          onClick={submit}
          disabled={!name.trim() || selected.size === 0 || submitting}
          className="rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
          style={{ background: "var(--wl-accent)", color: "#06110a" }}
        >
          {submitting ? "Starting…" : `Create & Start${selected.size > 0 ? ` (${selected.size + 1})` : ""}`}
        </button>
      </div>
    </div>
  );
}
