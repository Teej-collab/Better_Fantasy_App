"use client";

import { useState } from "react";
import type { ChatMember } from "@/lib/api";
import { usePresence } from "@/components/PresenceProvider";

// Pick one person for a DM, or several for a group chat. With
// `excludeIds` (Add People in a group's info) it adds instead, and the
// button says so.
export function NewMessageModal({
  members,
  onClose,
  onSelect,
  excludeIds,
  title = "New Message",
}: {
  members: ChatMember[];
  onClose: () => void;
  onSelect: (ownerIds: number[], groupName: string) => Promise<void> | void;
  excludeIds?: number[];
  title?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adding = excludeIds !== undefined;
  const filtered = members.filter(
    (m) => !excludeIds?.includes(m.owner_id) && m.display_name.toLowerCase().includes(query.toLowerCase()),
  );
  const isGroup = !adding && selected.length > 1;

  function toggle(ownerId: number) {
    setSelected((prev) => (prev.includes(ownerId) ? prev.filter((id) => id !== ownerId) : [...prev, ownerId]));
  }

  async function submit() {
    if (busy || selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await onSelect(selected, groupName.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  const label = adding
    ? `Add ${selected.length} ${selected.length === 1 ? "person" : "people"}`
    : isGroup
      ? `Start group (${selected.length + 1})`
      : "Chat";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-20" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl border border-black/10 bg-[var(--background)] p-4 shadow-xl dark:border-white/10"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
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
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search league members..."
          aria-label="Search league members"
          className="rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
        />
        {isGroup && (
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Group name (optional)"
            aria-label="Group name"
            maxLength={60}
            className="rounded-full border border-black/10 bg-transparent px-4 py-2 text-sm outline-none focus:border-[var(--wl-accent-dim)] dark:border-white/10"
          />
        )}

        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {filtered.map((m) => (
            <MemberRow key={m.owner_id} member={m} checked={selected.includes(m.owner_id)} onToggle={toggle} />
          ))}
          {filtered.length === 0 && (
            <p className="px-2 py-4 text-center text-sm text-black/50 dark:text-white/50">
              {adding && query === "" ? "Everyone is already here." : "No members found."}
            </p>
          )}
        </ul>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          onClick={() => void submit()}
          disabled={busy || selected.length === 0}
          className="min-h-11 rounded-full text-sm font-bold disabled:opacity-40"
          style={{ background: "var(--wl-accent)", color: "#06110a" }}
        >
          {busy ? "…" : label}
        </button>
      </div>
    </div>
  );
}

// Its own component, not inlined in the .map() above, since usePresence
// is a hook — each row needs its own call, one per member, not one
// shared call for the whole list.
function MemberRow({
  member,
  checked,
  onToggle,
}: {
  member: ChatMember;
  checked: boolean;
  onToggle: (ownerId: number) => void;
}) {
  const online = usePresence(member.owner_id, member.online);

  return (
    <li>
      <button
        onClick={() => onToggle(member.owner_id)}
        role="checkbox"
        aria-checked={checked}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-black/5 dark:hover:bg-white/10"
      >
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-semibold dark:bg-white/10">
          {member.display_name.slice(0, 2).toUpperCase()}
          {online && (
            <span
              className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-[var(--background)]"
              role="img"
              aria-label="Online now"
              title="Online now"
            />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="min-w-0 wrap-break-word text-sm font-medium">{member.display_name}</span>
          <span className="min-w-0 wrap-break-word text-xs text-black/50 dark:text-white/50">{member.team_name}</span>
        </span>
        <span
          aria-hidden
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold"
          style={
            checked
              ? { background: "var(--wl-accent)", borderColor: "var(--wl-accent)", color: "#06110a" }
              : { borderColor: "var(--wl-text-secondary)" }
          }
        >
          {checked ? "✓" : ""}
        </span>
      </button>
    </li>
  );
}
