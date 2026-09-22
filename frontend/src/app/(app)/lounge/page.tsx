"use client";

import { useEffect, useState } from "react";
import { closeLoungeRoom, createLoungeRoom, listMyLoungeRooms, type LoungeRoom } from "@/lib/api";

/**
 * "My Lounges" — create/manage standalone password-protected video
 * rooms (backend/app/routers/lounge.py). Deliberately not gated by
 * league membership, unlike most of (app)/ — any signed-in account can
 * use this, same as email/password signup itself requires no league.
 * Lives under (app)/ because, unlike the public /lounge/[slug] join
 * page, this management console DOES want the normal nav chrome.
 */
export default function LoungePage() {
  const [rooms, setRooms] = useState<LoungeRoom[] | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedRoomId, setCopiedRoomId] = useState<number | null>(null);

  async function refresh() {
    setRooms(await listMyLoungeRooms());
  }

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : "Couldn't load your lounges."));
  }, []);

  function shareUrl(slug: string) {
    return `${window.location.origin}/lounge/${slug}`;
  }

  function copyLink(roomId: number, slug: string) {
    navigator.clipboard.writeText(shareUrl(slug)).then(() => {
      setCopiedRoomId(roomId);
      setTimeout(() => setCopiedRoomId((current) => (current === roomId ? null : current)), 2000);
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await createLoungeRoom(name.trim(), password);
      setName("");
      setPassword("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the lounge.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(roomId: number) {
    try {
      await closeLoungeRoom(roomId);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't close the lounge.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="font-display text-2xl font-bold">Lounge</h1>
        <p className="text-sm text-black/60 dark:text-white/60">
          Create a password-protected video room and share the link with anyone — no league required.
        </p>
      </div>

      <form onSubmit={handleCreate} className="flex flex-col gap-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
        <input
          type="text"
          placeholder="Room name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm dark:border-white/10"
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy || !name.trim() || !password}
          className="self-start rounded-full px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: "var(--user-accent, var(--wl-accent))" }}
        >
          {busy ? "Creating…" : "Create lounge"}
        </button>
      </form>

      <div className="flex flex-col gap-3">
        {rooms === null && <p className="text-sm text-black/50 dark:text-white/50">Loading…</p>}
        {rooms?.length === 0 && <p className="text-sm text-black/50 dark:text-white/50">No lounges yet.</p>}
        {rooms?.map((room) => (
          <div key={room.id} className="flex flex-col gap-2 rounded-xl border border-black/10 p-4 dark:border-white/10">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{room.name}</span>
              {room.closed ? (
                <span className="text-xs text-black/40 dark:text-white/40">Closed</span>
              ) : (
                <button
                  onClick={() => handleClose(room.id)}
                  className="rounded-full border border-black/10 px-2.5 py-1 text-xs dark:border-white/10"
                >
                  Close
                </button>
              )}
            </div>
            {!room.closed && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-black/50 dark:text-white/50">
                <code className="font-mono">{shareUrl(room.slug)}</code>
                <button
                  onClick={() => copyLink(room.id, room.slug)}
                  className="rounded-full border border-black/10 px-2 py-0.5 text-[11px] dark:border-white/10"
                >
                  {copiedRoomId === room.id ? "Copied!" : "Copy link"}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
